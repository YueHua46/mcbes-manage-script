"""Generate the original CreeperMenu quest feedback sound family.

Usage: python tools/generate_quest_sounds.py --ffmpeg /path/to/ffmpeg
The synthesis is deterministic and uses no sampled or third-party audio.
"""

from __future__ import annotations

import argparse
import math
import struct
import subprocess
import tempfile
import wave
from pathlib import Path

SAMPLE_RATE = 44_100
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "resource_packs" / "CreeperMenu" / "sounds" / "quest"

RARITIES = {
    "common": (523.25, 659.25, 783.99),
    "rare": (587.33, 739.99, 880.00),
    "epic": (698.46, 880.00, 1046.50),
    "legendary": (783.99, 987.77, 1174.66),
}

PATTERNS = {
    "progress": ((0, 0.00, 0.13),),
    "accept": ((0, 0.00, 0.19), (1, 0.13, 0.24)),
    "complete": ((0, 0.00, 0.24), (1, 0.12, 0.29), (2, 0.25, 0.38)),
    "claim": ((2, 0.00, 0.20), (1, 0.10, 0.22), (2, 0.20, 0.24)),
}


def envelope(age: float, duration: float) -> float:
    attack = min(1.0, age / 0.012)
    release = max(0.0, min(1.0, (duration - age) / 0.085))
    return attack * release * math.exp(-2.2 * age / duration)


def render(notes: tuple[float, ...], pattern: tuple[tuple[int, float, float], ...]) -> list[float]:
    total = max(start + duration for _, start, duration in pattern) + 0.06
    frames = [0.0] * int(total * SAMPLE_RATE)
    for note_index, start, duration in pattern:
        frequency = notes[note_index]
        begin = int(start * SAMPLE_RATE)
        end = min(len(frames), begin + int(duration * SAMPLE_RATE))
        for frame in range(begin, end):
            age = (frame - begin) / SAMPLE_RATE
            phase = 2.0 * math.pi * frequency * age
            bell = math.sin(phase) + 0.25 * math.sin(phase * 2.01) + 0.10 * math.sin(phase * 3.98)
            frames[frame] += bell * envelope(age, duration) * 0.42
    peak = max((abs(value) for value in frames), default=1.0)
    return [value * 0.72 / max(peak, 1e-9) for value in frames]


def write_wave(path: Path, frames: list[float]) -> None:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(b"".join(struct.pack("<h", round(value * 32767)) for value in frames))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg", required=True, type=Path)
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="creeper-quest-audio-") as temp_name:
        temp = Path(temp_name)
        for rarity, notes in RARITIES.items():
            for kind, pattern in PATTERNS.items():
                wave_path = temp / f"{rarity}_{kind}.wav"
                ogg_path = OUTPUT / f"{rarity}_{kind}.ogg"
                write_wave(wave_path, render(notes, pattern))
                subprocess.run(
                    [
                        str(args.ffmpeg),
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-y",
                        "-i",
                        str(wave_path),
                        "-c:a",
                        "libvorbis",
                        "-q:a",
                        "5",
                        str(ogg_path),
                    ],
                    check=True,
                )


if __name__ == "__main__":
    main()
