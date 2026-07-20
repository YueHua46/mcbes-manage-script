const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const soundsRoot = path.join(root, "resource_packs", "CreeperMenu", "sounds");
const ambiencePath = path.join(root, "scripts", "features", "backrooms", "ambience.ts");

function readWave(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF", `${filePath} is not RIFF`);
  assert.equal(bytes.toString("ascii", 8, 12), "WAVE", `${filePath} is not WAVE`);
  let offset = 12;
  let format;
  let data;
  while (offset + 8 <= bytes.length) {
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
      data = bytes.subarray(start, start + size);
    }
    offset = start + size + (size & 1);
  }
  assert.ok(format && data, `${filePath} lacks fmt/data chunks`);
  assert.deepEqual(
    { encoding: format.encoding, channels: format.channels, bitsPerSample: format.bitsPerSample },
    { encoding: 1, channels: 1, bitsPerSample: 16 },
    `${filePath} must be mono PCM16`,
  );
  const samples = new Float64Array(data.length / 2);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = data.readInt16LE(index * 2) / 32768;
  }
  return {
    ...format,
    samples,
    durationSeconds: samples.length / format.sampleRate,
    peak: samples.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0),
  };
}

function powerSpectrum(wave, transformSize = 65_536) {
  assert.ok(wave.samples.length >= transformSize, "hum is too short for spectral analysis");
  const start = Math.floor((wave.samples.length - transformSize) / 2);
  const real = new Float64Array(transformSize);
  const imaginary = new Float64Array(transformSize);
  for (let index = 0; index < transformSize; index++) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (transformSize - 1));
    real[index] = wave.samples[start + index] * window;
  }

  for (let i = 1, j = 0; i < transformSize; i++) {
    let bit = transformSize >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let length = 2; length <= transformSize; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let base = 0; base < transformSize; base += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let index = 0; index < length / 2; index++) {
        const even = base + index;
        const odd = even + length / 2;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
  const power = new Float64Array(transformSize / 2 + 1);
  for (let index = 0; index < power.length; index++) {
    power[index] = real[index] ** 2 + imaginary[index] ** 2;
  }
  return { power, binHz: wave.sampleRate / transformSize };
}

function spectralRatios(wave) {
  const { power, binHz } = powerSpectrum(wave);
  let audible = 0;
  let above2k = 0;
  let oldSpikeBands = 0;
  for (let index = Math.ceil(20 / binHz); index < power.length; index++) {
    const frequency = index * binHz;
    audible += power[index];
    if (frequency >= 2_000) above2k += power[index];
    if (Math.abs(frequency - 2_850) <= 35 || Math.abs(frequency - 4_720) <= 35) {
      oldSpikeBands += power[index];
    }
  }
  return { above2k: above2k / audible, oldSpikeBands: oldSpikeBands / audible };
}

function numericConstant(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*([0-9_]+)`));
  assert.ok(match, `missing numeric constant ${name}`);
  return Number(match[1].replaceAll("_", ""));
}

test("music lock is a valid silent non-positional music event", () => {
  const definitions = JSON.parse(fs.readFileSync(path.join(soundsRoot, "sound_definitions.json"), "utf8"));
  const lock = definitions.sound_definitions["yuehua.backrooms.music_lock"];
  assert.ok(lock, "missing yuehua.backrooms.music_lock definition");
  assert.equal(lock.category, "music");
  assert.equal(lock.sounds.length, 1);
  assert.equal(lock.sounds[0].is3D, false);
  const lockPath = path.join(root, "resource_packs", "CreeperMenu", `${lock.sounds[0].name}.wav`);
  const wave = readWave(lockPath);
  assert.ok(wave.durationSeconds >= 1, "music lock should be long enough to loop reliably");
  assert.equal(wave.peak, 0, "music lock must contain only zero-amplitude PCM");
});

test("Backrooms entry acquires and exit releases the zero-volume music lock", () => {
  const ambience = fs.readFileSync(ambiencePath, "utf8");
  const enterStart = ambience.indexOf("function enterAmbience");
  const leaveStart = ambience.indexOf("function leaveAmbience");
  assert.ok(enterStart >= 0 && leaveStart > enterStart);
  const enter = ambience.slice(enterStart, leaveStart);
  const leave = ambience.slice(leaveStart, ambience.indexOf("function spatialLocation", leaveStart));
  const stopIndex = enter.indexOf("player.stopMusic()");
  const playIndex = enter.indexOf("player.playMusic(");
  assert.ok(stopIndex >= 0 && playIndex > stopIndex, "entry must stop existing music before acquiring lock");
  assert.match(enter, /player\.playMusic\(\s*["']yuehua\.backrooms\.music_lock["']/);
  assert.match(enter, /volume:\s*0/);
  assert.match(enter, /fade:\s*0/);
  assert.match(enter, /loop:\s*true/);
  assert.match(leave, /player\.stopMusic\(\)/, "exit must release the music lock");
});

test("hum replay interval is never shorter than either hum asset", () => {
  const ambience = fs.readFileSync(ambiencePath, "utf8");
  const replayTicks = numericConstant(ambience, "HUM_REPLAY_TICKS");
  const humFiles = ["fluorescent_hum_a.wav", "fluorescent_hum_b.wav"];
  for (const file of humFiles) {
    const wave = readWave(path.join(soundsRoot, "backrooms", file));
    assert.ok(
      replayTicks / 20 >= wave.durationSeconds,
      `${file} lasts ${wave.durationSeconds}s but replays after ${replayTicks / 20}s`,
    );
  }
});

test("hum has no dominant legacy high-frequency ballast spikes", () => {
  for (const file of ["fluorescent_hum_a.wav", "fluorescent_hum_b.wav"]) {
    const wave = readWave(path.join(soundsRoot, "backrooms", file));
    const ratios = spectralRatios(wave);
    assert.ok(ratios.above2k < 0.004, `${file} >2kHz power ratio is ${ratios.above2k}`);
    assert.ok(
      ratios.oldSpikeBands < 0.0005,
      `${file} legacy 2.85/4.72kHz band ratio is ${ratios.oldSpikeBands}`,
    );
  }
});

test("hum and surge playback are quieter and electrical surges are rare", () => {
  const ambience = fs.readFileSync(ambiencePath, "utf8");
  const hum = ambience.match(/player\.playSound\(SOUNDS\.hum,[\s\S]*?volume:\s*([0-9.]+)\s*\+[^*]+\*\s*([0-9.]+)/);
  const surge = ambience.match(/player\.playSound\(SOUNDS\.surge,[\s\S]*?volume:\s*([0-9.]+)\s*\+[^*]+\*\s*([0-9.]+)/);
  const firstSurge = ambience.match(/randomTicks\(player,\s*["']first-surge["'],\s*([0-9_]+),\s*([0-9_]+)\)/);
  const nextSurge = ambience.match(/randomTicks\(player,\s*["']next-surge["'],\s*([0-9_]+),\s*([0-9_]+)\)/);
  assert.ok(hum && surge && firstSurge && nextSurge, "unable to inspect ambience playback policy");
  assert.ok(Number(hum[1]) + Number(hum[2]) <= 0.24, "hum maximum playback volume must be <= 0.24");
  assert.ok(Number(surge[1]) + Number(surge[2]) <= 0.32, "surge maximum playback volume must be <= 0.32");
  assert.ok(Number(firstSurge[1].replaceAll("_", "")) >= 4_800, "first surge must wait at least four minutes");
  assert.ok(Number(nextSurge[1].replaceAll("_", "")) >= 6_000, "later surges must be at least five minutes apart");
});

test("Backrooms mixer categories separate ambience, music lock, and hostile Lifeform sounds", () => {
  const definitions = JSON.parse(fs.readFileSync(path.join(soundsRoot, "sound_definitions.json"), "utf8"));
  for (const [id, definition] of Object.entries(definitions.sound_definitions)) {
    if (!id.startsWith("yuehua.backrooms.")) continue;
    const expectedCategory = id === "yuehua.backrooms.music_lock"
      ? "music"
      : id.startsWith("yuehua.backrooms.lifeform.") ? "hostile" : "ambient";
    assert.equal(
      definition.category,
      expectedCategory,
      `${id} has incorrect mixer category`,
    );
  }
});

test("dry and damp walk/run footsteps each provide multiple valid spatial variants", () => {
  const definitions = JSON.parse(fs.readFileSync(path.join(soundsRoot, "sound_definitions.json"), "utf8"));
  const events = ["dry_walk", "dry_run", "damp_walk", "damp_run"];
  for (const suffix of events) {
    const id = `yuehua.backrooms.footstep_${suffix}`;
    const definition = definitions.sound_definitions[id];
    assert.ok(definition, `missing ${id}`);
    assert.equal(definition.category, "ambient");
    assert.ok(definition.max_distance <= 14);
    assert.ok(definition.sounds.length >= 3, `${id} needs at least three variants`);
    for (const sound of definition.sounds) {
      assert.equal(sound.is3D, true);
      const wave = readWave(path.join(root, "resource_packs", "CreeperMenu", `${sound.name}.wav`));
      assert.ok(wave.durationSeconds >= 0.25 && wave.durationSeconds <= 0.8);
      assert.ok(wave.peak >= 0.15 && wave.peak <= 0.5);
    }
  }
  assert.equal(definitions.sound_definitions["yuehua.backrooms.carpet_squelch"], undefined);
  assert.equal(fs.existsSync(path.join(soundsRoot, "backrooms", "carpet_squelch.wav")), false);
});

test("footsteps accumulate grounded horizontal distance and classify gait by sampled speed", () => {
  const ambience = fs.readFileSync(ambiencePath, "utf8");
  assert.ok(numericConstant(ambience, "AMBIENCE_INTERVAL_TICKS") <= 5);
  assert.match(ambience, /distanceSinceStep/);
  assert.match(ambience, /horizontalDistance/);
  assert.match(ambience, /horizontalSpeed/);
  assert.match(ambience, /RUN_SPEED_THRESHOLD/);
  assert.match(ambience, /player\.isOnGround/);
  assert.match(ambience, /dimension\.getBlock\(/);
  assert.match(ambience, /yuehua:backrooms_carpet_damp/);
  assert.match(ambience, /yuehua:backrooms_carpet/);
  assert.match(ambience, /lastFootstepTick\s*===\s*system\.currentTick/);
  assert.match(ambience, /distanceSinceStep\s*\+=\s*horizontalDistance/);
  assert.doesNotMatch(ambience, /carpet-roll/);
  assert.doesNotMatch(ambience, /carpet_squelch/);
});
