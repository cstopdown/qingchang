"""只接受已认证网关请求的 v2 干声评分 API。"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
import hmac
import json
import logging
from pathlib import Path
import time
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException
import soundfile as sf

from .audio import MAX_AUDIO_BYTES, prepare_audio
from .backend import MODEL_ID, MODEL_NAME, MODEL_REVISION, VocalVerseScorer

LOGGER = logging.getLogger("qingchang.vocalverse")
MAX_BODY_BYTES = MAX_AUDIO_BYTES + 65536


class RequestBoundary:
    def __init__(self, app, token: str):
        self.app, self.token = app, token

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        if b"origin" in headers:
            return await JSONResponse({"detail": "仅接受网关请求"}, 403)(scope, receive, send)
        expected = ("Bearer " + self.token).encode()
        if not hmac.compare_digest(headers.get(b"authorization", b""), expected):
            return await JSONResponse({"detail": "身份验证失败"}, 401)(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message["body"])
            if len(body) > MAX_BODY_BYTES:
                return await JSONResponse({"detail": "请求超过100MiB音频加64KiB表单限制"}, 413)(scope, receive, send)
            if not message.get("more_body", False):
                break
        delivered = False

        async def buffered_receive():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, buffered_receive, send)


def create_app(home: Path, token: str, *, scorer=None) -> FastAPI:
    if not token:
        raise ValueError("必须设置 QINGCHANG_AI_TOKEN")
    scorer = VocalVerseScorer(home) if scorer is None else scorer
    state = {"status": "loading", "message": "正在加载并验证 VocalVerse CPU 评分模型"}
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="vocalverse")
    busy = False

    async def initialize():
        try:
            await asyncio.get_running_loop().run_in_executor(executor, scorer.load)
        except (RuntimeError, OSError, ValueError, ImportError):
            # 服务生命周期边界：记录真实失败，健康状态不可伪装就绪。
            LOGGER.exception("VocalVerse 模型初始化失败")
            state.update(status="error", message="模型加载或真实推理验证失败，请查看服务日志")
        else:
            state.update(status="ready", message="CPU 模型已完成真实音频推理验证")

    @asynccontextmanager
    async def lifespan(app):
        task = asyncio.create_task(initialize())
        yield
        await task
        executor.shutdown(wait=True)

    app = FastAPI(lifespan=lifespan)
    app.add_middleware(RequestBoundary, token=token)

    @app.get("/health")
    async def health():
        return {"service": "qingchang-score", "apiVersion": 2, **state,
                "engine": "vocalverse", "model": MODEL_NAME, "modelId": MODEL_ID,
                "modelRevision": MODEL_REVISION, "backend": "pytorch-cpu",
                "audioInput": True, "scoreRange": [0, 100]}

    @app.post("/v2/score")
    async def score(request: Request):
        nonlocal busy
        if state["status"] != "ready":
            raise HTTPException(503, state["message"])
        if busy:
            raise HTTPException(429, "模型正在评价另一份录音")
        busy = True
        try:
            try:
                form = await request.form(max_files=1, max_fields=2, max_part_size=65536)
            except (MultiPartException, ValueError) as error:
                raise HTTPException(422, "需要 multipart 干声 WAV、recordingId 和 title") from error
            try:
                if set(form) != {"audio", "recordingId", "title"} or len(form.multi_items()) != 3:
                    raise HTTPException(422, "需要唯一的 audio、recordingId 和 title 字段")
                audio, recording_id, title = form["audio"], form["recordingId"], form["title"]
                if not isinstance(audio, UploadFile) or not isinstance(recording_id, str) or not isinstance(title, str):
                    raise HTTPException(422, "表单字段类型不正确")
                if not recording_id or len(recording_id) > 4096 or len(title) > 4096:
                    raise HTTPException(422, "recordingId 和 title 长度不符合要求")
                data = await audio.read(MAX_AUDIO_BYTES + 1)
                if len(data) > MAX_AUDIO_BYTES:
                    raise HTTPException(413, "音频超过100MiB")
                try:
                    clip = await asyncio.to_thread(prepare_audio, data, recording_id)
                except (ValueError, sf.LibsndfileError) as error:
                    raise HTTPException(422, "无效的干声 WAV：" + str(error)) from error
            finally:
                await form.close()
            limitations = ["同源加噪和失真对照中，模型分数可能抬高；本实验分数不适合判断唱功或录音质量。",
                           "模型不提供四维分数或文字点评，也不自动辨别人声和器乐。"]
            if clip.duration < 10:
                limitations.append("评价片段不足10秒，评分可能不稳定。")
            result = None
            if clip.rejection:
                summary = clip.rejection
            else:
                try:
                    result = await asyncio.get_running_loop().run_in_executor(executor, scorer.infer, clip.samples)
                except (RuntimeError, OSError, ValueError) as error:
                    # HTTP/I/O 边界将真实模型异常映射502；日志保留原因，不生成兜底分数。
                    LOGGER.exception("VocalVerse 真实推理失败")
                    raise HTTPException(502, "VocalVerse 模型推理失败") from error
                summary = f"VocalVerse 对 {clip.start:.2f} 秒起、时长 {clip.duration:.2f} 秒的干声片段给出整体参考分 {result:.2f}/100。"
            return {"schemaVersion": 2, "id": str(uuid.uuid4()), "recordingId": recording_id,
                    "createdAt": int(time.time() * 1000), "engine": "vocalverse", "model": MODEL_NAME,
                    "modelId": MODEL_ID, "modelRevision": MODEL_REVISION, "scorable": result is not None,
                    "score": result, "scoreRange": [0, 100], "summary": summary, "limitations": limitations,
                    "analysis": {"sourceDurationSeconds": clip.source_duration, "startSeconds": clip.start,
                                 "durationSeconds": clip.duration, "inputKind": "dry-vocal",
                                 "modelCalled": result is not None}}
        finally:
            busy = False

    return app
