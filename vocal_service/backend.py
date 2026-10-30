"""固定官方模型私有副本的 CPU 调用；不生成四维或文字点评。"""

import hashlib
import json
import math
from pathlib import Path
import sys
import time

from .audio import prepare_audio

ROOT = Path(__file__).parent
MANIFEST = json.loads((ROOT / "model-manifest.json").read_text())
MODEL_NAME = "VocalVerse2 MuQ KTV v2"
MODEL_ID = MANIFEST["modelId"]
MODEL_REVISION = MANIFEST["modelRevision"]


def verify_files(home: Path) -> None:
    for entry in MANIFEST["files"]:
        path = home / entry["destination"]
        if path.stat().st_size != entry["size"]:
            raise ValueError(f"模型文件大小不一致：{path.name}")
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
                digest.update(block)
        if digest.hexdigest() != entry["sha256"]:
            raise ValueError(f"模型文件哈希不一致：{path.name}")


class VocalVerseScorer:
    def __init__(self, home: Path):
        self.home = home

    def load(self) -> None:
        load_started = time.monotonic()
        print(json.dumps({"event": "model_load_started"}), flush=True)
        import torch
        verify_files(self.home)
        torch.set_num_threads(4)
        torch.set_num_interop_threads(1)
        sys.path.insert(0, str(self.home / "upstream" / "audioscore" / "src"))
        from audioscore.model_regression_audio import MuQRegressionAudioLora
        checkpoint = self.home / "models" / "step3"
        config = json.loads((checkpoint / "config.json").read_text())
        self.model = MuQRegressionAudioLora(
            lora_r=config["lora_r"], lora_alpha=config["lora_alpha"],
            hidden_state_index=config["hidden_state_index"],
        )
        self.model.load_model(str(checkpoint))
        self.model = self.model.float().cpu().eval()
        clip = prepare_audio((self.home / "fixtures" / "readiness.wav").read_bytes(), "readiness")
        if clip.rejection:
            raise ValueError(clip.rejection)
        started = time.monotonic()
        score = self.infer(clip.samples)
        print(json.dumps({"event": "model_verified", "score": score,
                          "durationSeconds": clip.duration,
                          "loadAndWarmupSeconds": time.monotonic() - load_started,
                          "inferenceSeconds": time.monotonic() - started}), flush=True)

    def infer(self, samples) -> float:
        import torch
        with torch.inference_mode():
            score = float(self.model(torch.from_numpy(samples).unsqueeze(0)).item())
        if not math.isfinite(score) or not 0 <= score <= 100:
            raise ValueError("模型未返回有效的0至100原始评分")
        return score
