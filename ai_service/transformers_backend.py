"""固定官方 MiniCPM-o 4.5 的 CPU 音频推理，不使用 GPU、视觉或语音输出。"""

from contextlib import redirect_stdout
import json
import os
from pathlib import Path
import sys
import time
from uuid import uuid4

import soundfile as sf

from .scoring import SAMPLE_RATE


MANIFEST = json.loads((Path(__file__).parent / "transformers-manifest.json").read_text())


class TransformersScorer:
    def __init__(self, home: Path):
        self.home = home
        self.model_dir = Path(os.environ.get("QINGCHANG_AI_MODEL_DIR", home / "models" / MANIFEST["directory"]))

    def load(self) -> None:
        import torch
        from transformers import AutoModel

        verified = json.loads((self.model_dir / "qingchang-verified.json").read_text())
        if verified["revision"] != MANIFEST["revision"] or verified["modelId"] != MANIFEST["modelId"]:
            raise ValueError("官方模型校验记录与固定版本不一致")
        torch.set_num_threads(4)
        torch.set_num_interop_threads(1)
        with redirect_stdout(sys.stderr):
            self.model = AutoModel.from_pretrained(
                str(self.model_dir), trust_remote_code=True, local_files_only=True,
                attn_implementation="sdpa", torch_dtype=torch.bfloat16,
                init_vision=False, init_audio=True, init_tts=False,
                low_cpu_mem_usage=True, device_map="cpu",
            ).eval()
            self.model.prepare_processor()
        assert self.model.device.type == "cpu"
        assert self.model.config.init_audio and not self.model.config.init_vision and not self.model.config.init_tts

    def infer(self, clip_path: Path, prompt: str) -> str:
        import torch

        samples, rate = sf.read(clip_path, dtype="float32")
        assert rate == SAMPLE_RATE and samples.ndim == 1
        started = time.monotonic()
        with torch.inference_mode(), redirect_stdout(sys.stderr):
            text = self.model.chat(
                msgs=[{"role": "user", "content": [samples, prompt]}],
                generate_audio=False, enable_thinking=False, do_sample=False,
                max_new_tokens=1200,
            )
        diagnostics = self.home / "diagnostics"
        diagnostics.mkdir(parents=True, exist_ok=True)
        (diagnostics / f"{time.time_ns()}-{uuid4()}.json").write_text(json.dumps({
            "modelId": MANIFEST["modelId"], "revision": MANIFEST["revision"],
            "backend": "transformers", "device": "cpu", "promptVersion": "2",
            "inferenceSeconds": time.monotonic() - started, "text": text,
        }, ensure_ascii=False, indent=2))
        return text
