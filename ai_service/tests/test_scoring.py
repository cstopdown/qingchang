import io
import json

import numpy as np
from pydantic import ValidationError
import pytest
import soundfile as sf

from ai_service.scoring import (
    MODEL_REVISION, NO_REFERENCE_LIMITATION, make_report,
    parse_decision, prepare_audio, silent_report,
)


def wav(samples, sample_rate):
    buffer = io.BytesIO()
    sf.write(buffer, samples, sample_rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


def test_wav_to_representative_clip_and_unscorable_silence():
    rate = 48000
    time = np.arange(rate * 45) / rate
    signal = np.where(time >= 10, 0.2 * np.sin(2 * np.pi * 440 * time), 0).astype(np.float32)
    clip = prepare_audio(wav(np.stack([signal, signal], axis=1), rate))
    assert clip.total_seconds == 45
    assert clip.seconds == 30
    assert 9.5 <= clip.start_seconds <= 15
    assert clip.rms == pytest.approx(0.2 / np.sqrt(2), abs=0.002)
    assert len(clip.samples) == 480000

    silence = prepare_audio(wav(np.zeros(rate * 2), rate))
    report = silent_report(silence, "silence-recording", "dry-vocal")
    assert report["scorable"] is False
    assert report["overall"] is None
    assert all(value is None for value in report["dimensions"].values())
    assert "未调用" in report["model"]
    assert report["totalSeconds"] == report["analyzedSeconds"] == 2


def test_model_json_to_report_enforces_equal_weighted_scores_and_no_fake_defaults():
    raw = {
        "scorable": True,
        "dimensions": {"clarity": 80, "steadiness": 90, "expression": 70, "recordingQuality": 100},
        "summary": "这段演唱的人声可辨，表现力仍有提升空间。",
        "strengths": ["声音清晰"], "improvements": ["注意乐句变化"], "limitations": [],
    }
    clip = prepare_audio(wav(np.full(16000, 0.1), 16000))
    report = make_report(parse_decision(json.dumps(raw)), clip, "recording-1", "mixed")
    assert report["overall"] == 85
    assert report["recordingId"] == "recording-1"
    assert report["modelRevision"] == MODEL_REVISION
    assert NO_REFERENCE_LIMITATION in report["limitations"]
    assert any("混音" in item for item in report["limitations"])
    raw["dimensions"]["clarity"] = 101
    with pytest.raises(ValidationError):
        parse_decision(json.dumps(raw))
    raw["scorable"] = False
    raw["dimensions"] = dict.fromkeys(raw["dimensions"], None)
    denied = make_report(parse_decision(json.dumps(raw)), clip, "instrumental", "mixed")
    assert denied["overall"] is None
    assert denied["scorable"] is False
