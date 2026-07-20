"""Generate original, deterministic Level 0 ambience without third-party samples."""

from __future__ import annotations

import math
import wave
from pathlib import Path

import numpy as np


SAMPLE_RATE = 16_000
OUTPUT = Path(__file__).resolve().parents[1] / "resource_packs" / "CreeperMenu" / "sounds" / "backrooms"


def envelope(length: int, attack: float = 0.05, release: float = 0.08) -> np.ndarray:
    result = np.ones(length, dtype=np.float64)
    attack_samples = max(1, int(SAMPLE_RATE * attack))
    release_samples = max(1, int(SAMPLE_RATE * release))
    result[:attack_samples] = np.linspace(0.0, 1.0, attack_samples)
    result[-release_samples:] = np.linspace(1.0, 0.0, release_samples)
    return result


def lowpass(noise: np.ndarray, width: int) -> np.ndarray:
    kernel = np.ones(width, dtype=np.float64) / width
    return np.convolve(noise, kernel, mode="same")


def write_wave(name: str, signal: np.ndarray, peak: float = 0.86) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    signal = np.nan_to_num(signal)
    maximum = float(np.max(np.abs(signal))) or 1.0
    pcm = np.clip(signal / maximum * peak, -1.0, 1.0)
    destination = OUTPUT / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(destination), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes((pcm * 32767).astype("<i2").tobytes())


def fluorescent_hum(name: str, seed: int, mains: float, phase: float) -> None:
    rng = np.random.default_rng(seed)
    duration = 24.0
    t = np.arange(int(SAMPLE_RATE * duration)) / SAMPLE_RATE
    signal = np.zeros_like(t)
    for harmonic, strength in [(1, 0.30), (2, 0.52), (3, 0.16), (4, 0.11), (6, 0.05)]:
        signal += strength * np.sin(2 * math.pi * mains * harmonic * t + phase * harmonic)
    modulation = 0.72 + 0.12 * np.sin(2 * math.pi * 0.125 * t + phase)
    modulation += 0.06 * np.sin(2 * math.pi * 0.25 * t + 1.7)
    room_noise = lowpass(rng.normal(0, 1, len(t)), 121) * 0.10
    signal = (signal + room_noise) * modulation
    write_wave(name, signal * envelope(len(t), 0.35, 0.6), 0.42)


def ballast_surge() -> None:
    rng = np.random.default_rng(7103)
    duration = 7.0
    t = np.arange(int(SAMPLE_RATE * duration)) / SAMPLE_RATE
    rise = np.clip(t / 2.6, 0, 1) * np.clip((duration - t) / 1.0, 0, 1)
    beating = 0.58 * np.sin(2 * math.pi * 60 * t) + 0.72 * np.sin(2 * math.pi * 120.7 * t)
    transformer = 0.12 * np.sin(2 * math.pi * (360 + 8 * np.sin(2 * math.pi * 0.7 * t)) * t)
    grit = lowpass(rng.normal(0, 1, len(t)), 31) * (0.03 + 0.08 * rise)
    write_wave("ballast_surge.wav", (beating + transformer + grit) * rise * envelope(len(t)), 0.44)


def music_lock() -> None:
    """Silent loop used only to reserve Bedrock's music mixer while inside Level 0."""
    write_wave("music_lock.wav", np.zeros(SAMPLE_RATE * 2, dtype=np.float64), 0.0)


def tube_flicker() -> None:
    rng = np.random.default_rng(901)
    duration = 1.35
    count = int(SAMPLE_RATE * duration)
    t = np.arange(count) / SAMPLE_RATE
    signal = 0.05 * np.sin(2 * math.pi * 120 * t)
    for center, strength in [(0.08, 1.0), (0.19, 0.55), (0.47, 0.85), (0.53, 0.45), (0.94, 0.72)]:
        offset = t - center
        burst = np.exp(-np.maximum(offset, 0) * 90) * (offset >= 0)
        signal += burst * rng.normal(0, strength, count)
    write_wave("tube_flicker.wav", signal * envelope(count, 0.005, 0.16), 0.75)


def wall_scratch() -> None:
    rng = np.random.default_rng(4401)
    duration = 3.4
    count = int(SAMPLE_RATE * duration)
    t = np.arange(count) / SAMPLE_RATE
    raw = rng.normal(0, 1, count)
    rasp = raw - lowpass(raw, 18)
    pulses = np.zeros(count)
    for center in [0.34, 0.73, 1.14, 1.85, 2.13, 2.78]:
        pulses += np.exp(-((t - center) / 0.085) ** 2)
    resonance = np.sin(2 * math.pi * (690 + 80 * np.sin(2 * math.pi * 2.1 * t)) * t)
    write_wave("wall_scratch.wav", (0.72 * rasp + 0.14 * resonance) * pulses * envelope(count), 0.62)


def indistinct_breath() -> None:
    rng = np.random.default_rng(8817)
    duration = 4.6
    count = int(SAMPLE_RATE * duration)
    t = np.arange(count) / SAMPLE_RATE
    breath = lowpass(rng.normal(0, 1, count), 9)
    slow = 0.5 + 0.5 * np.sin(2 * math.pi * 0.43 * t + 0.8)
    formant = 0.12 * np.sin(2 * math.pi * 430 * t + 1.4 * np.sin(2 * math.pi * 0.31 * t))
    write_wave("indistinct_breath.wav", (breath * 0.9 + formant) * slow * envelope(count, 0.55, 0.8), 0.44)


def carpet_footstep(name: str, seed: int, damp: bool, running: bool) -> None:
    """Synthesize a close, muffled shoe contact without game-like transient clicks."""
    rng = np.random.default_rng(seed)
    duration = 0.36 if running else 0.46
    count = int(SAMPLE_RATE * duration)
    t = np.arange(count) / SAMPLE_RATE
    impact_center = 0.055 if running else 0.075
    impact = np.exp(-((t - impact_center) / (0.038 if running else 0.052)) ** 2)
    settle = np.exp(-((t - (0.20 if running else 0.27)) / 0.09) ** 2)
    carpet = lowpass(rng.normal(0, 1, count), 29 if running else 39)
    body_frequency = (92 if running else 72) - (34 if running else 22) * t
    body = np.sin(2 * math.pi * body_frequency * t + seed * 0.013) * np.exp(-t * (9 if running else 7))
    signal = carpet * (0.54 * impact + 0.19 * settle) + 0.30 * body * impact
    if damp:
        suction = lowpass(rng.normal(0, 1, count), 67) * np.exp(-((t - 0.24) / 0.105) ** 2)
        low_wet = np.sin(2 * math.pi * (48 - 13 * t) * t) * np.exp(-t * 6.5)
        signal = signal * 0.72 + suction * 0.72 + low_wet * 0.20
    peak = 0.42 if damp and running else 0.36 if running else 0.34 if damp else 0.30
    write_wave(name, signal * envelope(count, 0.008, 0.11), peak)


VOWELS = (
    (430.0, 980.0, 2480.0),
    (560.0, 1320.0, 2320.0),
    (690.0, 1080.0, 2460.0),
    (390.0, 1760.0, 2580.0),
)


def add_synthetic_syllable(
    target: np.ndarray,
    start: float,
    duration: float,
    seed: int,
    base_pitch: float,
    vowel: tuple[float, float, float],
    clarity: float,
) -> None:
    """Add an original formant-shaped murmur; it encodes no recorded or cloned speech."""
    first = max(0, int(start * SAMPLE_RATE))
    last = min(len(target), first + int(duration * SAMPLE_RATE))
    if last <= first:
        return
    rng = np.random.default_rng(seed)
    local_t = np.arange(last - first) / SAMPLE_RATE
    f0 = base_pitch * (1.0 + 0.018 * np.sin(2 * math.pi * (3.1 + seed % 5 * 0.2) * local_t))
    phase_base = np.cumsum(f0) / SAMPLE_RATE
    voiced = np.zeros(last - first, dtype=np.float64)
    for harmonic in range(1, 34):
        frequency = base_pitch * harmonic
        resonance = 0.18
        for index, formant in enumerate(vowel):
            bandwidth = (115.0, 180.0, 260.0)[index]
            resonance += (1.0, 0.72, 0.34)[index] * math.exp(-((frequency - formant) / bandwidth) ** 2)
        voiced += resonance / harmonic * np.sin(2 * math.pi * harmonic * phase_base + rng.uniform(-0.2, 0.2))
    consonant = rng.normal(0, 1, last - first)
    consonant -= lowpass(consonant, 19)
    onset = np.exp(-local_t * 18) * (0.035 + 0.035 * clarity)
    shape = np.sin(np.pi * np.clip(local_t / duration, 0, 1)) ** 0.65
    target[first:last] += (voiced * 0.36 + consonant * onset) * shape


def room_muffle(signal: np.ndarray, width: int, echo_seconds: float = 0.075) -> np.ndarray:
    result = lowpass(signal, width)
    delay = int(echo_seconds * SAMPLE_RATE)
    if delay < len(result):
        result[delay:] += result[:-delay] * 0.18
    second = delay * 2 + int(0.013 * SAMPLE_RATE)
    if second < len(result):
        result[second:] += result[:-second] * 0.08
    return result


def synthetic_voice_track(
    duration: float,
    seed: int,
    speakers: tuple[float, ...],
    line_span: tuple[float, float],
    clarity: float,
) -> np.ndarray:
    rng = np.random.default_rng(seed)
    signal = np.zeros(int(SAMPLE_RATE * duration), dtype=np.float64)
    cursor = rng.uniform(0.35, 0.7)
    speaker_index = 0
    syllable_seed = seed * 100
    while cursor < duration - 0.5:
        line_end = min(duration - 0.25, cursor + rng.uniform(*line_span))
        pitch = speakers[speaker_index % len(speakers)]
        while cursor < line_end:
            syllable_duration = rng.uniform(0.20, 0.43)
            add_synthetic_syllable(
                signal,
                cursor,
                syllable_duration,
                syllable_seed,
                pitch * rng.uniform(0.96, 1.04),
                VOWELS[int(rng.integers(0, len(VOWELS)))],
                clarity,
            )
            syllable_seed += 1
            cursor += syllable_duration + rng.uniform(0.045, 0.15)
        speaker_index += 1
        cursor += rng.uniform(0.32, 0.78)
    return room_muffle(signal, 13 if clarity < 0.7 else 8)


def voice_discussion(variant: int, duration: float) -> None:
    signal = synthetic_voice_track(duration, 5100 + variant, (82.0, 112.0), (1.15, 2.2), 0.48)
    rng = np.random.default_rng(5150 + variant)
    wall_noise = lowpass(rng.normal(0, 1, len(signal)), 181) * 0.035
    write_wave(f"voices/voice_discussion_{variant}.wav", (signal + wall_noise) * envelope(len(signal), 0.35, 0.7), 0.34)


def voice_call(variant: int, duration: float) -> None:
    signal = synthetic_voice_track(duration, 5300 + variant, (92.0 + variant * 4,), (0.65, 1.05), 0.68)
    write_wave(f"voices/voice_call_{variant}.wav", signal * envelope(len(signal), 0.18, 0.48), 0.39)


def lifeform_idle(variant: int, duration: float) -> None:
    rng = np.random.default_rng(6100 + variant)
    t = np.arange(int(SAMPLE_RATE * duration)) / SAMPLE_RATE
    breath = np.sin(2 * math.pi * (39 + variant * 1.5) * t + 0.7 * np.sin(2 * math.pi * 0.24 * t))
    cable = lowpass(rng.normal(0, 1, len(t)), 27)
    movement = 0.30 + 0.34 * (0.5 + 0.5 * np.sin(2 * math.pi * 0.24 * t + variant))
    write_wave(f"lifeform/idle_{variant}.wav", (breath * 0.34 + cable * 0.22) * movement * envelope(len(t), 0.3, 0.45), 0.32)


def lifeform_step(variant: int, running: bool) -> None:
    rng = np.random.default_rng((6300 if running else 6200) + variant)
    duration = 0.43 if running else 0.62
    t = np.arange(int(SAMPLE_RATE * duration)) / SAMPLE_RATE
    center = 0.07 if running else 0.11
    impact = np.exp(-((t - center) / (0.035 if running else 0.052)) ** 2)
    drag = np.exp(-((t - (0.25 if running else 0.39)) / 0.10) ** 2)
    thump = np.sin(2 * math.pi * ((68 if running else 54) - 22 * t) * t) * np.exp(-t * 9)
    joint = rng.normal(0, 1, len(t)) - lowpass(rng.normal(0, 1, len(t)), 15)
    cable = lowpass(rng.normal(0, 1, len(t)), 25)
    signal = 0.50 * thump * impact + 0.15 * joint * impact + 0.32 * cable * drag
    gait = "run" if running else "walk"
    write_wave(f"lifeform/step_{gait}_{variant}.wav", signal * envelope(len(t), 0.006, 0.12), 0.56 if running else 0.42)


def lifeform_inspect(variant: int) -> None:
    rng = np.random.default_rng(6400 + variant)
    duration = 2.4 + (variant - 1) * 0.18
    t = np.arange(int(SAMPLE_RATE * duration)) / SAMPLE_RATE
    tension = np.sin(2 * math.pi * (43 + 3 * t) * t) * np.clip(t / 1.4, 0, 1)
    ticks = np.zeros_like(t)
    for center in (0.48, 1.12, 1.88 + variant * 0.06):
        ticks += rng.normal(0, 1, len(t)) * np.exp(-((t - center) / 0.025) ** 2)
    write_wave(f"lifeform/inspect_{variant}.wav", (0.26 * tension + 0.12 * ticks) * envelope(len(t), 0.12, 0.3), 0.38)


def lifeform_lure(variant: int) -> None:
    duration = 4.0 + variant * 0.25
    count = int(SAMPLE_RATE * duration)
    phrase = synthetic_voice_track(1.55, 6500 + variant, (76.0 + variant * 3,), (0.72, 1.0), 0.86)
    signal = np.zeros(count, dtype=np.float64)
    starts = (0.28, 2.12 + variant * 0.05)
    for repetition, start in enumerate(starts):
        first = int(start * SAMPLE_RATE)
        length = min(len(phrase), count - first)
        copy = phrase[:length].copy()
        if repetition:
            local_t = np.arange(length) / SAMPLE_RATE
            copy *= 0.88 + 0.12 * np.sin(2 * math.pi * (29 + variant) * local_t)
            tail_start = int(length * 0.67)
            copy[tail_start:] *= np.linspace(1.0, 0.25, length - tail_start)
        signal[first:first + length] += copy
    growl_t = np.arange(count) / SAMPLE_RATE
    signal += 0.035 * np.sin(2 * math.pi * 38 * growl_t) * envelope(count, 0.2, 0.4)
    write_wave(f"lifeform/lure_{variant}.wav", room_muffle(signal, 6, 0.052), 0.43)


def lifeform_roar(variant: int) -> None:
    rng = np.random.default_rng(6600 + variant)
    duration = 1.45 + (variant - 1) * 0.18
    t = np.arange(int(SAMPLE_RATE * duration)) / SAMPLE_RATE
    preparation = np.clip(t / 0.22, 0, 1)
    release = np.clip((duration - t) / 0.34, 0, 1)
    shape = preparation * release
    f0 = 46 + 18 * np.clip((t - 0.18) / 0.45, 0, 1) - 11 * np.clip((t - 0.9) / 0.4, 0, 1)
    phase = np.cumsum(f0) / SAMPLE_RATE
    throat = sum((1 / harmonic) * np.sin(2 * math.pi * harmonic * phase) for harmonic in range(1, 12))
    rasp = rng.normal(0, 1, len(t)) - lowpass(rng.normal(0, 1, len(t)), 9)
    signal = lowpass(throat * 0.62 + rasp * 0.14, 5) * shape
    write_wave(f"lifeform/roar_{variant}.wav", signal, 0.88)


def lifeform_attack(variant: int) -> None:
    rng = np.random.default_rng(6700 + variant)
    duration = 1.02 + variant * 0.06
    t = np.arange(int(SAMPLE_RATE * duration)) / SAMPLE_RATE
    whoosh = lowpass(rng.normal(0, 1, len(t)), 19) * np.exp(-((t - 0.43) / 0.18) ** 2)
    snap = (rng.normal(0, 1, len(t)) - lowpass(rng.normal(0, 1, len(t)), 13)) * np.exp(-((t - 0.56) / 0.028) ** 2)
    lunge = np.sin(2 * math.pi * (61 - 25 * t) * t) * np.exp(-((t - 0.34) / 0.22) ** 2)
    write_wave(f"lifeform/attack_{variant}.wav", (0.58 * whoosh + 0.15 * snap + 0.34 * lunge) * envelope(len(t), 0.03, 0.18), 0.68)


def lifeform_hurt(variant: int) -> None:
    rng = np.random.default_rng(6800 + variant)
    duration = 0.68 + variant * 0.08
    t = np.arange(int(SAMPLE_RATE * duration)) / SAMPLE_RATE
    f0 = 71 - 28 * t
    phase = np.cumsum(f0) / SAMPLE_RATE
    voice = sum(np.sin(2 * math.pi * harmonic * phase) / harmonic for harmonic in range(1, 9))
    crack = rng.normal(0, 1, len(t)) * np.exp(-t * 18)
    write_wave(f"lifeform/hurt_{variant}.wav", (0.50 * voice + 0.10 * crack) * envelope(len(t), 0.018, 0.22), 0.61)


def lifeform_death(variant: int) -> None:
    rng = np.random.default_rng(6900 + variant)
    duration = 1.35 + variant * 0.16
    t = np.arange(int(SAMPLE_RATE * duration)) / SAMPLE_RATE
    collapse = np.zeros_like(t)
    for center, frequency, strength in ((0.28, 67, 0.46), (0.72, 51, 0.64), (1.08, 39, 0.38)):
        collapse += strength * np.sin(2 * math.pi * frequency * (t - center)) * np.exp(-np.maximum(t - center, 0) * 9) * (t >= center)
    cable = lowpass(rng.normal(0, 1, len(t)), 31) * np.clip((t - 0.5) / 0.5, 0, 1)
    write_wave(f"lifeform/death_{variant}.wav", (collapse + 0.22 * cable) * envelope(len(t), 0.02, 0.28), 0.67)


if __name__ == "__main__":
    fluorescent_hum("fluorescent_hum_a.wav", 1409, 60.0, 0.2)
    fluorescent_hum("fluorescent_hum_b.wav", 2381, 59.7, 1.1)
    ballast_surge()
    tube_flicker()
    wall_scratch()
    indistinct_breath()
    for variant in range(1, 4):
        carpet_footstep(f"footstep_dry_walk_{variant}.wav", 3100 + variant, False, False)
        carpet_footstep(f"footstep_dry_run_{variant}.wav", 3200 + variant, False, True)
        carpet_footstep(f"footstep_damp_walk_{variant}.wav", 3300 + variant, True, False)
        carpet_footstep(f"footstep_damp_run_{variant}.wav", 3400 + variant, True, True)
    for variant, duration in enumerate((9.4, 10.8, 12.2), start=1):
        voice_discussion(variant, duration)
    for variant, duration in enumerate((3.0, 3.6, 4.3), start=1):
        voice_call(variant, duration)
    lifeform_idle(1, 3.8)
    lifeform_idle(2, 4.4)
    for variant in range(1, 4):
        lifeform_step(variant, False)
        lifeform_step(variant, True)
        lifeform_lure(variant)
        lifeform_attack(variant)
    for variant in range(1, 3):
        lifeform_inspect(variant)
        lifeform_roar(variant)
        lifeform_hurt(variant)
        lifeform_death(variant)
    music_lock()
