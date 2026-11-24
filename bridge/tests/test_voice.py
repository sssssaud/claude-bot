"""Voice module, the parts that need no GPU and no microphone."""
import wave

import numpy as np
import pytest

from bridge import voice


def test_pcm16_to_float_scales_and_drops_a_torn_byte():
    raw = np.array([0, 16384, -32768, 32767], "<i2").tobytes() + b"\x01"
    out = voice.pcm16_to_float(raw)
    assert out.dtype == np.float32 and out.tolist() == [0.0, 0.5, -1.0, 32767 / 32768]


def test_read_wav_wants_16khz_16bit(tmp_path):
    ok = tmp_path / "ok.wav"
    with wave.open(str(ok), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(np.array([100, 300] * 8, "<i2").tobytes())  # stereo → mono by averaging
    assert np.allclose(voice.read_wav(ok), 200 / 32768)
    bad = tmp_path / "bad.wav"
    with wave.open(str(bad), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
        w.writeframes(b"\0\0" * 10)
    with pytest.raises(ValueError, match="16 kHz"):
        voice.read_wav(bad)


def test_transcriber_skips_silence_unloads_when_idle_and_reports_a_missing_model(tmp_path):
    t = voice.Transcriber(model_dir=tmp_path, idle_s=300)
    assert t.transcribe(np.zeros(100, np.float32)) == "", "a click, not speech: no model load needed"
    with pytest.raises(RuntimeError, match="model missing"):
        t.transcribe(np.zeros(16000, np.float32))
    t.model, t.last_used = object(), 1000.0  # pretend it's loaded
    assert t.unload_if_idle(now=1299) is False and t.model is not None
    assert t.unload_if_idle(now=1300) is True and t.model is None
