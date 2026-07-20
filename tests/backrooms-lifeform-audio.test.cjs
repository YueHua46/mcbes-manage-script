const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const packRoot = path.join(root, "resource_packs", "CreeperMenu");
const soundsRoot = path.join(packRoot, "sounds");
const definitions = JSON.parse(
  fs.readFileSync(path.join(soundsRoot, "sound_definitions.json"), "utf8"),
).sound_definitions;

function readWave(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF", `${filePath} is not RIFF`);
  assert.equal(bytes.toString("ascii", 8, 12), "WAVE", `${filePath} is not WAVE`);
  let format;
  let pcm;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      format = {
        encoding: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        bitsPerSample: bytes.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      pcm = bytes.subarray(start, start + size);
    }
    offset = start + size + (size & 1);
  }
  assert.ok(format && pcm, `${filePath} lacks fmt/data chunks`);
  assert.deepEqual(format, { encoding: 1, channels: 1, sampleRate: 16_000, bitsPerSample: 16 });
  let peak = 0;
  let squareSum = 0;
  const sampleCount = pcm.length / 2;
  for (let index = 0; index < sampleCount; index++) {
    const sample = pcm.readInt16LE(index * 2) / 32768;
    peak = Math.max(peak, Math.abs(sample));
    squareSum += sample * sample;
  }
  return {
    duration: sampleCount / format.sampleRate,
    peak,
    rms: Math.sqrt(squareSum / sampleCount),
  };
}

function inspectEvent(id, policy) {
  const definition = definitions[id];
  assert.ok(definition, `missing sound event ${id}`);
  assert.equal(definition.category, policy.category, `${id} category`);
  assert.ok(definition.max_distance >= policy.minDistance, `${id} max_distance too short`);
  assert.ok(definition.max_distance <= policy.maxDistance, `${id} max_distance too long`);
  assert.ok(definition.sounds.length >= policy.minVariants, `${id} needs more variants`);
  assert.equal(definition.loop, undefined, `${id} must not be a continuous scream/loop`);

  const paths = new Set();
  const metrics = [];
  for (const sound of definition.sounds) {
    assert.equal(sound.is3D, true, `${id} must be spatial`);
    assert.equal(sound.stream, undefined, `${id} should be preloaded`);
    assert.equal(paths.has(sound.name), false, `${id} repeats the same asset path`);
    paths.add(sound.name);
    const filePath = path.join(packRoot, `${sound.name}.wav`);
    assert.ok(fs.existsSync(filePath), `missing ${filePath}`);
    const wave = readWave(filePath);
    assert.ok(wave.duration >= policy.minDuration, `${sound.name} is too short: ${wave.duration}`);
    assert.ok(wave.duration <= policy.maxDuration, `${sound.name} is too long: ${wave.duration}`);
    assert.ok(wave.peak >= policy.minPeak, `${sound.name} is too quiet: ${wave.peak}`);
    assert.ok(wave.peak <= 0.96, `${sound.name} risks clipping: ${wave.peak}`);
    assert.ok(wave.rms >= 0.004, `${sound.name} is effectively silent: ${wave.rms}`);
    metrics.push(wave);
  }
  return metrics;
}

test("ordinary wall-hidden voices are long, varied ambient phenomena", () => {
  const discussions = inspectEvent("yuehua.backrooms.voice_discussion", {
    category: "ambient",
    minDistance: 40,
    maxDistance: 56,
    minVariants: 3,
    minDuration: 8,
    maxDuration: 14,
    minPeak: 0.18,
  });
  const calls = inspectEvent("yuehua.backrooms.voice_call", {
    category: "ambient",
    minDistance: 36,
    maxDistance: 52,
    minVariants: 3,
    minDuration: 2,
    maxDuration: 6,
    minPeak: 0.20,
  });
  assert.ok(discussions.every((wave) => wave.rms < 0.16), "discussion should remain distant/muffled");
  assert.ok(calls.every((wave) => wave.rms < 0.20), "calls should not sound close-miked");
});

test("Lifeform exposes the complete non-looping hostile sound library", () => {
  const policies = {
    idle: [2, 2.5, 5.5, 0.20, 16, 32],
    step_walk: [3, 0.35, 0.9, 0.22, 12, 24],
    step_run: [3, 0.25, 0.7, 0.28, 16, 28],
    inspect: [2, 1.4, 3.0, 0.24, 20, 36],
    lure: [3, 2.5, 6.0, 0.26, 32, 48],
    roar: [2, 1.0, 2.3, 0.68, 36, 56],
    attack: [3, 0.6, 1.5, 0.48, 16, 30],
    hurt: [2, 0.4, 1.2, 0.38, 20, 36],
    death: [2, 0.9, 2.2, 0.46, 28, 44],
  };
  for (const [event, values] of Object.entries(policies)) {
    const [minVariants, minDuration, maxDuration, minPeak, minDistance, maxDistance] = values;
    inspectEvent(`yuehua.backrooms.lifeform.${event}`, {
      category: "hostile",
      minDistance,
      maxDistance,
      minVariants,
      minDuration,
      maxDuration,
      minPeak,
    });
  }
});

test("processed Pixabay cues stay spatial, short, and subordinate to the original library", () => {
  const distant = inspectEvent("yuehua.backrooms.lifeform.distant", {
    category: "hostile",
    minDistance: 44,
    maxDistance: 60,
    minVariants: 1,
    minDuration: 3.5,
    maxDuration: 6.8,
    minPeak: 0.30,
  });
  assert.ok(distant.every((wave) => wave.rms < 0.16), "distant cue must remain muffled and behind-wall-like");

  const roar = definitions["yuehua.backrooms.lifeform.roar"];
  const hurt = definitions["yuehua.backrooms.lifeform.hurt"];
  const importedRoar = roar.sounds.find((sound) => sound.name.endsWith("pixabay_glitch_roar"));
  const importedHurt = hurt.sounds.find((sound) => sound.name.endsWith("pixabay_hurt_wail"));
  assert.ok(importedRoar, "rare processed Pixabay roar is not mixed into the roar event");
  assert.ok(importedHurt, "processed Pixabay wail is not mixed into the hurt event");
  assert.ok(importedRoar.weight < roar.sounds[0].weight, "Pixabay roar must remain rarer than an original variant");
  assert.ok(importedHurt.weight < hurt.sounds[0].weight, "Pixabay hurt must remain rarer than an original variant");
  assert.ok(importedRoar.volume <= 0.75, "processed roar needs an in-game gain ceiling");
  assert.ok(importedHurt.volume <= 0.75, "processed hurt needs an in-game gain ceiling");
  assert.ok(roar.sounds.filter((sound) => !sound.name.includes("pixabay_")).length >= 2);
  assert.ok(hurt.sounds.filter((sound) => !sound.name.includes("pixabay_")).length >= 2);
});

test("Pixabay processing is reproducible, high-frequency limited, and ships no raw downloads", () => {
  const processor = fs.readFileSync(
    path.join(root, "tools", "process-pixabay-lifeform-audio.ps1"),
    "utf8",
  );
  assert.match(processor, /Get-FileHash\s+-Algorithm\s+SHA256/i);
  assert.match(processor, /-ac\s+1\s+-ar\s+16000\s+-c:a\s+pcm_s16le/i);
  assert.equal((processor.match(/lowpass=f=(?:3000|4300|4800)/g) ?? []).length, 3);
  assert.equal((processor.match(/alimiter=limit=/g) ?? []).length, 3);

  const metadata = JSON.parse(fs.readFileSync(
    path.join(root, "assets", "backrooms", "audio", "pixabay-lifeform-sources.json"),
    "utf8",
  ));
  assert.equal(metadata.license.name, "Pixabay Content License");
  assert.equal(metadata.author, "CJB123");
  assert.equal(metadata.sources.length, 3);
  assert.ok(metadata.sources.every((source) => /^[A-F0-9]{64}$/.test(source.sha256)));
  assert.equal(
    fs.readdirSync(path.join(soundsRoot, "backrooms", "lifeform")).some((name) => name.endsWith(".mp3")),
    false,
    "raw Pixabay downloads must not be shipped in the resource pack",
  );
});

function directoryHashes(directory) {
  assert.ok(fs.existsSync(directory), `missing generated directory ${directory}`);
  const files = fs.readdirSync(directory).filter((name) => name.endsWith(".wav")).sort();
  assert.ok(files.length > 0, `no generated WAV files in ${directory}`);
  return files.map((name) => {
    const bytes = fs.readFileSync(path.join(directory, name));
    return `${name}:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  });
}

test("voice and Lifeform synthesis is byte-for-byte deterministic", () => {
  const generator = path.join(root, "tools", "generate-backrooms-audio.py");
  const run = () => spawnSync("python", [generator], { cwd: root, encoding: "utf8" });
  const firstRun = run();
  assert.equal(firstRun.status, 0, firstRun.stderr || firstRun.stdout);
  const voiceDirectory = path.join(soundsRoot, "backrooms", "voices");
  const lifeformDirectory = path.join(soundsRoot, "backrooms", "lifeform");
  const first = [...directoryHashes(voiceDirectory), ...directoryHashes(lifeformDirectory)];
  const secondRun = run();
  assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.stdout);
  const second = [...directoryHashes(voiceDirectory), ...directoryHashes(lifeformDirectory)];
  assert.deepEqual(second, first);
});

test("attribution separates original synthesis from licensed processed Lifeform derivatives", () => {
  const attribution = fs.readFileSync(path.join(soundsRoot, "ATTRIBUTION.txt"), "utf8");
  assert.match(attribution, /Lifeform/i);
  assert.match(attribution, /幻听|人声/);
  assert.match(attribution, /原创/);
  assert.match(attribution, /不包含[^\n]*(影片|电影)[^\n]*采样/);
  assert.match(attribution, /Pixabay Content License/i);
  assert.match(attribution, /CJB123/);
  assert.match(attribution, /creature wail/i);
  assert.match(attribution, /creature screams in the distance/i);
  assert.match(attribution, /glitchy roar/i);
  assert.match(attribution, /license-summary/);
});
