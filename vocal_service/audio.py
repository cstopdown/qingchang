"""干声 WAV 的外部输入转换和官方音频预处理。"""

from dataclasses import dataclass
import hashlib
import io
import math

import librosa
import numpy as np
import pyloudnorm as pyln
import soundfile as sf

SAMPLE_RATE = 24000
MAX_AUDIO_BYTES = 100 * 1024 * 1024


@dataclass
class AudioClip:
    samples: np.ndarray
    source_duration: float
    start: float
    duration: float
    rejection: str | None


def prepare_audio(data: bytes, recording_id: str) -> AudioClip:
    if len(data) > MAX_AUDIO_BYTES:
        raise ValueError("音频超过100MiB")
    with sf.SoundFile(io.BytesIO(data)) as source:
        if source.format not in {"WAV", "WAVEX"}:
            raise ValueError("只接受干声 WAV 文件")
        if source.channels not in {1, 2} or not 8000 <= source.samplerate <= 192000:
            raise ValueError("WAV 需要单声道或双声道，采样率8000至192000Hz")
        rate = source.samplerate
        duration = source.frames / rate
        samples = source.read(dtype="float32", always_2d=True).mean(axis=1)
    if not np.isfinite(samples).all():
        raise ValueError("WAV 包含无效数值")
    if duration < 1:
        return AudioClip(samples, duration, 0, duration, "录音不足1秒；这是产品输入要求，并非模型有效性阈值。")
    rms = math.sqrt(float(np.mean(samples.astype(np.float64) ** 2)))
    if rms < 0.0001:
        return AudioClip(samples, duration, 0, duration, "录音接近静音，未调用评分模型。")
    samples = librosa.resample(samples, orig_sr=rate, target_sr=SAMPLE_RATE)
    loudness = pyln.Meter(SAMPLE_RATE).integrated_loudness(samples)
    if not math.isfinite(loudness):
        return AudioClip(samples, duration, 0, duration, "录音没有可用的响度，未调用评分模型。")
    samples = pyln.normalize.loudness(samples, loudness, -12.0)
    length = 90 * SAMPLE_RATE
    start = 0
    if samples.size > length:
        digest = hashlib.sha1(recording_id.encode()).hexdigest()
        start = int(digest[:12], 16) % (samples.size - length + 1)
        samples = samples[start:start + length]
    return AudioClip(samples.astype(np.float32), duration, start / SAMPLE_RATE,
                     samples.size / SAMPLE_RATE, None)
