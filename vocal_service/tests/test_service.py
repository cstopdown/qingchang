import io
from pathlib import Path
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
import numpy as np
import soundfile as sf

from vocal_service.app import MAX_BODY_BYTES, create_app
from vocal_service.audio import SAMPLE_RATE, prepare_audio


def wav(samples, rate=SAMPLE_RATE):
    output = io.BytesIO()
    sf.write(output, samples, rate, format="WAV", subtype="PCM_16")
    return output.getvalue()


class ControlledScorer:
    def __init__(self):
        self.called = 0
        self.started = threading.Event()
        self.finish = threading.Event()
        self.finish.set()
        self.fail = False

    def load(self):
        pass

    def infer(self, samples):
        self.called += 1
        self.started.set()
        self.finish.wait(timeout=10)
        if self.fail:
            raise RuntimeError("测试模型真实失败")
        return 63.125


def ready(client):
    for _ in range(100):
        health = client.get("/health").json()
        if health["status"] == "ready":
            return health
        time.sleep(0.01)
    raise AssertionError("测试评分器未就绪")


def test_authenticated_score_flow_preserves_raw_score_and_rejects_unusable_audio():
    scorer = ControlledScorer()
    audio = wav(0.1 * np.sin(2 * np.pi * 330 * np.arange(SAMPLE_RATE * 2) / SAMPLE_RATE))
    with TestClient(create_app(Path("/unused"), "test-token", scorer=scorer)) as client:
        assert client.get("/health").status_code == 401
        client.headers["Authorization"] = "Bearer test-token"
        health = ready(client)
        assert health["apiVersion"] == 2 and health["backend"] == "pytorch-cpu"
        assert client.get("/health", headers={"Origin": "https://untrusted.example"}).status_code == 403
        response = client.post("/v2/score", files={"audio": ("dry.wav", audio)},
                               data={"recordingId": "record-1", "title": "测试"})
        assert response.status_code == 200
        report = response.json()
        assert report["score"] == 63.125 and report["scorable"]
        assert report["scoreRange"] == [0, 100] and report["schemaVersion"] == 2
        assert report["analysis"] == {"sourceDurationSeconds": 2, "startSeconds": 0,
                                      "durationSeconds": 2, "inputKind": "dry-vocal", "modelCalled": True}
        assert "63.12/100" in report["summary"] and len(report["limitations"]) == 3
        for data in [wav(np.zeros(SAMPLE_RATE)), wav(np.ones(1000) * 0.1)]:
            result = client.post("/v2/score", files={"audio": ("dry.wav", data)},
                                 data={"recordingId": "quiet", "title": ""}).json()
            assert not result["scorable"] and result["score"] is None
            assert not result["analysis"]["modelCalled"]
        assert scorer.called == 1
        assert client.post("/v2/score", files={"audio": ("bad.wav", b"not wav")},
                           data={"recordingId": "bad", "title": ""}).status_code == 422
        assert client.post("/v2/score", content=b"x" * (MAX_BODY_BYTES + 1)).status_code == 413


def test_model_failures_and_single_concurrency_remain_visible():
    scorer = ControlledScorer()
    audio = wav(0.1 * np.sin(2 * np.pi * 440 * np.arange(SAMPLE_RATE) / SAMPLE_RATE))
    with TestClient(create_app(Path("/unused"), "test-token", scorer=scorer),
                    headers={"Authorization": "Bearer test-token"}) as client:
        ready(client)
        scorer.finish.clear()

        def request_score():
            return client.post("/v2/score", files={"audio": ("dry.wav", audio)},
                               data={"recordingId": "record", "title": ""})

        with ThreadPoolExecutor(max_workers=1) as pool:
            running = pool.submit(request_score)
            assert scorer.started.wait(timeout=10)
            assert request_score().status_code == 429
            scorer.finish.set()
            assert running.result().status_code == 200
        scorer.fail = True
        assert request_score().status_code == 502


def test_audio_preprocessing_keeps_official_loudness_and_stable_90_second_window():
    import pyloudnorm as pyln
    rate = 16000
    samples = 0.1 * np.sin(2 * np.pi * 220 * np.arange(rate * 95) / rate)
    data = wav(samples, rate)
    first = prepare_audio(data, "stable-recording")
    repeated = prepare_audio(data, "stable-recording")
    assert first.source_duration == 95 and first.duration == 90
    assert 0 <= first.start <= 5 and first.start == repeated.start
    np.testing.assert_array_equal(first.samples, repeated.samples)
    assert abs(pyln.Meter(SAMPLE_RATE).integrated_loudness(first.samples) + 12) < 0.02
