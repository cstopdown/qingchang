"""显式提供实际服务与音频素材后，验收真实听音接口的完整行为。"""

import os
import json
from pathlib import Path

import httpx
import pytest


@pytest.mark.skipif("QINGCHANG_REAL_API_URL" not in os.environ, reason="需运行中的真实音频模型服务")
def test_real_audio_scoring_contract():
    fixtures = Path(os.environ["QINGCHANG_REAL_FIXTURES"])
    token = Path(os.environ["QINGCHANG_REAL_TOKEN_FILE"]).read_text().strip()
    with httpx.Client(base_url=os.environ["QINGCHANG_REAL_API_URL"], timeout=300) as client:
        health = client.get("/health").raise_for_status().json()
        assert health["status"] == "ready"
        assert health["backend"] == "transformers" and health["audioInput"]
        assert health["modelId"] == "openbmb/MiniCPM-o-4_5"
        data = {"recordingId": "real-contract", "title": "音频验收", "inputKind": "dry-vocal"}
        positive = (fixtures / "vocalset-f1-dona-16k.wav").read_bytes()
        assert client.post("/v1/score", data=data, files={"audio": ("audio.wav", positive, "audio/wav")}).status_code == 401
        client.headers["Authorization"] = f"Bearer {token}"
        for name, scorable in [("vocalset-f1-dona-16k.wav", True), ("instrumental.wav", False), ("silence.wav", False)]:
            response = client.post("/v1/score", data=data, files={"audio": (name, (fixtures / name).read_bytes(), "audio/wav")})
            report = response.raise_for_status().json()
            print(json.dumps({"fixture": name, "elapsedSeconds": response.elapsed.total_seconds(), "report": report}, ensure_ascii=False), flush=True)
            assert report["recordingId"] == "real-contract"
            assert report["modelRevision"] == health["modelRevision"]
            assert report["scorable"] is scorable
            assert report["summary"] and report["limitations"]
            assert set(report["dimensions"]) == {"clarity", "steadiness", "expression", "recordingQuality"}
            if scorable:
                assert all(0 <= v <= 100 for v in report["dimensions"].values())
                assert report["overall"] == round(sum(report["dimensions"].values()) / 4, 1)
            else:
                assert report["overall"] is None
                assert all(v is None for v in report["dimensions"].values())
        assert client.post("/v1/score", data=data, files={"audio": ("bad.wav", b"not audio", "audio/wav")}).status_code == 422
