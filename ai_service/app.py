"""仅监听本机的 MiniCPM HTTP 服务；显式配置 token 后才可对外监听。"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
import hmac
import json
import logging
import os
from pathlib import Path
import tempfile
import threading
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import soundfile as sf

from .scoring import (
    MANIFEST, MAX_AUDIO_BYTES, MODEL_NAME, InputKind, MiniCpmScorer, SAMPLE_RATE,
    make_report, parse_decision, prepare_audio, scoring_prompt, silent_report,
)


ALLOWED_ORIGINS = [
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:4173", "http://127.0.0.1:4173",
    "capacitor://localhost", "https://localhost", "http://localhost", "file://", "null",
]
LOGGER = logging.getLogger("qingchang.ai")


class BodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message["body"])
                if received > MAX_AUDIO_BYTES + 65536:
                    raise HTTPException(413, "上传超过 100MB 音频限制")
            return message

        await self.app(scope, limited_receive, send)


def create_app(home: Path, token: str = "", *, backend: str = "mlx") -> FastAPI:
    if backend not in {"mlx", "transformers"}:
        raise ValueError("QINGCHANG_AI_BACKEND 必须为 mlx 或 transformers")
    if backend == "transformers":
        from .transformers_backend import MANIFEST as manifest, TransformersScorer
        scorer = TransformersScorer(home)
    else:
        manifest = MANIFEST
        scorer = MiniCpmScorer(home)
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="minicpm")
    busy = threading.Lock()
    state = {"status": "loading", "message": "正在加载 MiniCPM 音频模型"}
    work_dir = home / "work"

    @asynccontextmanager
    async def lifespan(_app):
        work_dir.mkdir(parents=True, exist_ok=True)

        async def load_model():
            try:
                await asyncio.get_running_loop().run_in_executor(executor, scorer.load)
                state.update(status="ready", message="本机 MiniCPM 音频模型已加载")
                print(json.dumps({"event": "ready", "stage": "model", "message": state["message"]}, ensure_ascii=False), flush=True)
            except (RuntimeError, ValueError, OSError, KeyError, ImportError) as error:
                LOGGER.exception("MiniCPM 模型加载失败")
                state.update(status="error", message=f"模型加载失败：{error}")
                print(json.dumps({"event": "error", "stage": "model", "message": state["message"]}, ensure_ascii=False), flush=True)

        task = asyncio.create_task(load_model())
        yield
        await task
        executor.shutdown(wait=True)

    app = FastAPI(title="轻唱本机 AI", lifespan=lifespan)
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["GET", "POST"], allow_headers=["Content-Type", "Authorization"])

    @app.middleware("http")
    async def check_access(request, call_next):
        origin = request.headers.get("origin")
        if origin is not None and origin not in ALLOWED_ORIGINS:
            return JSONResponse({"detail": "不接受此页面来源"}, status_code=403)
        if request.url.path == "/v1/score" and request.method != "OPTIONS" and token:
            authorization = request.headers.get("authorization", "")
            if not hmac.compare_digest(authorization, f"Bearer {token}"):
                return JSONResponse({"detail": "评分服务访问令牌无效"}, status_code=401)
        length = request.headers.get("content-length")
        if length is not None and int(length) > MAX_AUDIO_BYTES + 65536:
            return JSONResponse({"detail": "上传超过 100MB 音频限制"}, status_code=413)
        return await call_next(request)

    @app.get("/health")
    async def health():
        return {
            "service": "qingchang-ai", "apiVersion": 1, **state,
            "model": MODEL_NAME, "modelId": manifest["modelId"], "modelRevision": manifest["revision"],
            "backend": backend, "audioInput": True,
        }

    @app.post("/v1/score")
    async def score(
        audio: Annotated[UploadFile, File()],
        recordingId: Annotated[str, Form(min_length=1, max_length=100)],
        title: Annotated[str, Form(min_length=1, max_length=300)],
        inputKind: Annotated[InputKind, Form()],
        lyrics: Annotated[str, Form(max_length=20000)] = "",
    ):
        if state["status"] != "ready":
            raise HTTPException(503, state["message"])
        if not busy.acquire(blocking=False):
            raise HTTPException(429, "模型正在评价另一份作品，请稍后再试")
        try:
            data = await audio.read(MAX_AUDIO_BYTES + 1)
            if len(data) > MAX_AUDIO_BYTES:
                raise HTTPException(413, "音频超过 100MB，请截取片段后重试")
            try:
                clip = await asyncio.to_thread(prepare_audio, data)
            except (RuntimeError, ValueError) as error:
                raise HTTPException(422, f"音频无法读取：{error}") from error
            if clip.rms < 0.0001:
                return silent_report(clip, recordingId, inputKind, model_revision=manifest["revision"])
            with tempfile.TemporaryDirectory(prefix="score-", dir=work_dir) as directory:
                clip_path = Path(directory) / "audio.wav"
                sf.write(clip_path, clip.samples, SAMPLE_RATE, subtype="PCM_16")
                prompt = scoring_prompt(title, lyrics, inputKind)
                try:
                    text = await asyncio.get_running_loop().run_in_executor(executor, scorer.infer, clip_path, prompt)
                    decision = parse_decision(text)
                except (RuntimeError, ValueError) as error:
                    LOGGER.exception("MiniCPM 听音评分失败")
                    raise HTTPException(502, f"MiniCPM 无法生成有效听音评价：{error}") from error
            return make_report(decision, clip, recordingId, inputKind, model_revision=manifest["revision"])
        finally:
            await audio.close()
            busy.release()

    return app


def app_from_environment() -> FastAPI:
    home = Path(os.environ.get("QINGCHANG_AI_HOME", Path(__file__).resolve().parent.parent / ".tools" / "ai")).resolve()
    return create_app(home, os.environ.get("QINGCHANG_AI_TOKEN", ""), backend=os.environ.get("QINGCHANG_AI_BACKEND", "mlx"))
