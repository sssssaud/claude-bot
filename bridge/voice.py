"""Voice → text for claude-bot: Saud speaks (Hinglish), it becomes text. Local, on the RTX 3050.
The bot never speaks (no text-to-speech, by design).

Model: Oriserve/Whisper-Hindi2Hinglish-Prime (Whisper large-v3 fine-tuned to write Hindi speech in Roman
script), converted once to int8 at models/hinglish-prime-int8 (1.5 GB, ~2 GB VRAM; see docs/STATUS.md).
It loads on first use and unloads after IDLE_S, so the dGPU can go back to sleep.

    .venv/bin/python -m bridge.voice --smoke        # sample clip, checks the GPU path (no microphone)
    .venv/bin/python -m bridge.voice --try 6        # speak for 6 s, see the text and the timing
"""
import argparse
import ctypes
import glob
import os
import subprocess
import sys
import threading
import time
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "models" / "hinglish-prime-int8"
RATE = 16000
IDLE_S = 300  # unload the model after 5 quiet minutes: frees ~2 GB VRAM and lets the dGPU sleep
# words Saud says often; Whisper spells them right more often when it has seen them in the prompt
VOCAB = "Claude, octo, kitty, terminal, git commit, git push, pytest, bridge, popup, Hinglish, bhai, karo, kya, hai."


def _load_cuda_libs():
    """ctranslate2 needs CUDA 12 cuBLAS + cuDNN 9; pip put them inside the venv, not on the library path."""
    site = glob.glob(os.path.join(sys.prefix, "lib*", "python3*", "site-packages"))
    for pat in ("nvidia/cublas/lib/libcublasLt.so.12", "nvidia/cublas/lib/libcublas.so.12", "nvidia/cudnn/lib/libcudnn*.so.9"):
        for f in sorted(p for s in site for p in glob.glob(os.path.join(s, pat))):
            ctypes.CDLL(f, mode=ctypes.RTLD_GLOBAL)


def pcm16_to_float(raw: bytes) -> np.ndarray:
    """Little-endian 16-bit mono PCM → float32 in [-1, 1) (what Whisper wants)."""
    raw = raw[: len(raw) // 2 * 2]  # a recorder stopped mid-sample leaves an odd byte
    return (np.frombuffer(raw, "<i2") / 32768).astype(np.float32)


def read_wav(path) -> np.ndarray:
    with wave.open(str(path)) as w:
        if w.getframerate() != RATE or w.getsampwidth() != 2:
            raise ValueError(f"{path}: need 16 kHz 16-bit audio, got {w.getframerate()} Hz {8 * w.getsampwidth()}-bit")
        pcm = np.frombuffer(w.readframes(w.getnframes()), "<i2").reshape(-1, w.getnchannels()).mean(axis=1)
    return (pcm / 32768).astype(np.float32)


def record(seconds: float) -> np.ndarray:
    """Record from the default microphone through PipeWire."""
    # --raw: without it pw-record writes a Sun .au file to stdout (header + big-endian samples) = loud noise here
    cmd = ["pw-record", "--raw", "--rate", str(RATE), "--channels", "1", "--format", "s16", "-"]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except FileNotFoundError:
        raise RuntimeError("pw-record not found (it comes with PipeWire)")
    try:
        raw, err = proc.communicate(timeout=seconds)
    except subprocess.TimeoutExpired:
        proc.terminate()
        raw, err = proc.communicate()
    if not raw:
        raise RuntimeError(f"no audio from the microphone: {err.decode(errors='replace').strip()[:200]}")
    return pcm16_to_float(raw)


class Transcriber:
    """Loads the model on first use, unloads it after IDLE_S without use."""

    def __init__(self, model_dir=MODEL_DIR, idle_s=IDLE_S):
        self.model_dir, self.idle_s = Path(model_dir), idle_s
        self.model = None
        self.last_used = 0.0
        self.lock = threading.Lock()

    def _ensure(self):
        if self.model is None:
            if not (self.model_dir / "model.bin").exists():
                raise RuntimeError(f"speech model missing at {self.model_dir} (see docs/STATUS.md, voice)")
            _load_cuda_libs()
            from faster_whisper import WhisperModel  # heavy import, only when voice is used
            self.model = WhisperModel(str(self.model_dir), device="cuda", compute_type="int8_float16")

    def transcribe(self, audio: np.ndarray) -> str:
        if audio.size < RATE // 4:  # under a quarter second: nothing was said
            return ""
        with self.lock:
            self._ensure()
            segments, _ = self.model.transcribe(audio, beam_size=1, vad_filter=True, initial_prompt=VOCAB)
            text = " ".join(s.text.strip() for s in segments).strip()
            self.last_used = time.monotonic()
        return text

    def unload_if_idle(self, now=None) -> bool:
        """Call now and then; True if the model was unloaded (GPU free to sleep)."""
        now = time.monotonic() if now is None else now
        with self.lock:
            if self.model is not None and now - self.last_used >= self.idle_s:
                self.model = None
                return True
        return False


def main():
    ap = argparse.ArgumentParser(description="claude-bot voice → text")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--smoke", action="store_true", help="transcribe whisper.cpp's sample clip (no microphone)")
    g.add_argument("--try", dest="seconds", type=float, metavar="SECONDS", help="record from the microphone, then transcribe")
    args = ap.parse_args()
    if args.seconds is not None and not 1 <= args.seconds <= 30:
        sys.exit("--try takes 1 to 30 seconds")
    t = Transcriber()
    print("loading the model…", flush=True)
    t.transcribe(np.zeros(RATE, np.float32))  # warm up, so the timing below is what dictation will feel like
    if args.smoke:
        audio = read_wav(Path.home() / ".local/src/whisper.cpp/samples/jfk.wav")
    else:
        print(f"🎙  speak now, {args.seconds:g} s…", flush=True)
        audio = record(args.seconds)
        print("…done, transcribing", flush=True)
    start = time.monotonic()
    text = t.transcribe(audio)
    print(f"[{time.monotonic() - start:.2f} s for {audio.size / RATE:.1f} s of audio]")
    print(text or "(heard nothing)")


if __name__ == "__main__":
    main()
