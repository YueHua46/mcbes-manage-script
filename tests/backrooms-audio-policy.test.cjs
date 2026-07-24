const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const soundsRoot = path.join(root, "resource_packs", "Backrooms", "sounds");
const ambiencePath = path.join(root, "scripts", "addons", "backrooms", "ambience.ts");

function readWave(filePath, expectedChannels = 1) {
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
    { encoding: 1, channels: expectedChannels, bitsPerSample: 16 },
    `${filePath} must be ${expectedChannels === 1 ? "mono" : "stereo"} PCM16`,
  );
  const samples = new Float64Array(data.length / 2);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = data.readInt16LE(index * 2) / 32768;
  }
  return {
    ...format,
    samples,
    durationSeconds: samples.length / format.channels / format.sampleRate,
    peak: samples.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0),
  };
}

function numericConstant(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*([0-9_]+)`));
  assert.ok(match, `missing numeric constant ${name}`);
  return Number(match[1].replaceAll("_", ""));
}

test("Backrooms ambience is a quiet streamed non-positional music track", () => {
  const definitions = JSON.parse(fs.readFileSync(path.join(soundsRoot, "sound_definitions.json"), "utf8"));
  const ambience = definitions.sound_definitions["music.game.yuehua_backrooms"];
  assert.ok(ambience, "missing music.game.yuehua_backrooms definition");
  assert.match("music.game.yuehua_backrooms", /^(?:music\.game|record)\./);
  assert.equal(definitions.sound_definitions["yuehua.backrooms.ambience"], undefined);
  assert.equal(ambience.category, "music");
  assert.equal(ambience.sounds.length, 1);
  assert.equal(ambience.sounds[0].is3D, false);
  assert.equal(ambience.sounds[0].stream, true, "music ambience must stream from its OGG asset");
  assert.equal(ambience.sounds[0].load_on_low_memory, true);
  assert.equal(ambience.sounds[0].volume, 0.3);
  assert.equal(ambience.sounds[0].name, "sounds/music/game/yuehua_backrooms_loop");
  const ambiencePath = path.join(root, "resource_packs", "Backrooms", `${ambience.sounds[0].name}.ogg`);
  const ogg = fs.readFileSync(ambiencePath);
  assert.equal(ogg.subarray(0, 4).toString("ascii"), "OggS");
  assert.ok(ogg.length >= 2_000_000, "extended seamless ambience is unexpectedly small");
  assert.equal(
    fs.existsSync(path.join(root, "resource_packs", "Backrooms", `${ambience.sounds[0].name}.wav`)),
    false,
    "music channel must use the OGG asset rather than the retired PCM WAV",
  );
  const processor = fs.readFileSync(path.join(root, "tools/process-backrooms-background-audio.ps1"), "utf8");
  assert.match(processor, /Get-FileHash\s+-Algorithm\s+SHA256/i);
  assert.match(processor, /-c:a\s+libvorbis/);
  assert.match(processor, /acrossfade=d=2/);
  assert.match(processor, /aloop=loop=-1:size=793800/);
  assert.match(processor, /atrim=duration=180/);
  assert.match(processor, /loudnorm=I=-18:TP=-3:LRA=7/);

  const attribution = fs.readFileSync(path.join(soundsRoot, "ATTRIBUTION.txt"), "utf8");
  assert.match(attribution, /626096/);
  assert.match(attribution, /Resaural/i);
  assert.match(attribution, /CC0/);

  assert.equal(definitions.sound_definitions["yuehua.backrooms.music_lock"], undefined);
  assert.equal(fs.existsSync(path.join(soundsRoot, "backrooms", "music_lock.wav")), false);
  assert.equal(definitions.sound_definitions["yuehua.backrooms.hum"], undefined);
  for (const file of ["fluorescent_hum_a.wav", "fluorescent_hum_b.wav"]) {
    assert.equal(fs.existsSync(path.join(soundsRoot, "backrooms", file)), false);
  }
});

test("Backrooms entry stops current music before a delayed replacement start", () => {
  const ambience = fs.readFileSync(ambiencePath, "utf8");
  const startMusicStart = ambience.indexOf("function startBackroomsMusic");
  const enterStart = ambience.indexOf("function enterAmbience");
  const leaveStart = ambience.indexOf("function leaveAmbience");
  assert.ok(startMusicStart >= 0 && enterStart > startMusicStart && leaveStart > enterStart);
  const startMusic = ambience.slice(startMusicStart, enterStart);
  const enter = ambience.slice(enterStart, leaveStart);
  const leave = ambience.slice(leaveStart, ambience.indexOf("function spatialLocation", leaveStart));
  assert.match(enter, /player\.stopMusic\(\)/);
  assert.match(enter, /startBackroomsMusic\(player\)/);
  assert.match(startMusic, /system\.runTimeout\([\s\S]*?,\s*2\s*\)/);
  assert.match(startMusic, /player\.playMusic\(\s*["']music\.game\.yuehua_backrooms["']/);
  assert.match(startMusic, /volume:\s*1/);
  assert.match(startMusic, /fade:\s*0/);
  assert.match(startMusic, /loop:\s*true/);
  assert.match(leave, /player\.stopMusic\(\)/, "exit must release the Backrooms ambience");
});

test("retired fluorescent hum and silent music lock cannot compete with replacement music", () => {
  const ambience = fs.readFileSync(ambiencePath, "utf8");
  const generator = fs.readFileSync(path.join(root, "tools", "generate-backrooms-audio.py"), "utf8");
  assert.doesNotMatch(ambience, /SOUNDS\.hum|nextHumTick|HUM_REPLAY_TICKS/);
  assert.match(ambience, /RETIRED_SOUND_IDS\s*=\s*\["yuehua\.backrooms\.hum"\]/);
  assert.doesNotMatch(ambience, /playSound\([^\n]*yuehua\.backrooms\.hum/);
  assert.doesNotMatch(generator, /fluorescent_hum/);
  assert.doesNotMatch(generator, /music_lock/);
});

test("electrical surges remain rare subordinate detail over the music ambience", () => {
  const ambience = fs.readFileSync(ambiencePath, "utf8");
  const surge = ambience.match(/player\.playSound\(SOUNDS\.surge,[\s\S]*?volume:\s*([0-9.]+)\s*\+[^*]+\*\s*([0-9.]+)/);
  const firstSurge = ambience.match(/randomTicks\(player,\s*["']first-surge["'],\s*([0-9_]+),\s*([0-9_]+)\)/);
  const nextSurge = ambience.match(/randomTicks\(player,\s*["']next-surge["'],\s*([0-9_]+),\s*([0-9_]+)\)/);
  assert.ok(surge && firstSurge && nextSurge, "unable to inspect ambience playback policy");
  assert.ok(Number(surge[1]) + Number(surge[2]) <= 0.32, "surge maximum playback volume must be <= 0.32");
  assert.ok(Number(firstSurge[1].replaceAll("_", "")) >= 4_800, "first surge must wait at least four minutes");
  assert.ok(Number(nextSurge[1].replaceAll("_", "")) >= 6_000, "later surges must be at least five minutes apart");
});

test("Backrooms mixer categories separate replacement music, local effects, and hostile Lifeform sounds", () => {
  const definitions = JSON.parse(fs.readFileSync(path.join(soundsRoot, "sound_definitions.json"), "utf8"));
  assert.equal(definitions.sound_definitions["music.game.yuehua_backrooms"].category, "music");
  for (const [id, definition] of Object.entries(definitions.sound_definitions)) {
    if (!id.startsWith("yuehua.backrooms.")) continue;
    const expectedCategory = id.startsWith("yuehua.backrooms.lifeform.") ? "hostile" : "ambient";
    assert.equal(
      definition.category,
      expectedCategory,
      `${id} has incorrect mixer category`,
    );
  }
});

test("retired scripted player footsteps are absent from assets, definitions, runtime, and generator", () => {
  const definitions = JSON.parse(fs.readFileSync(path.join(soundsRoot, "sound_definitions.json"), "utf8"));
  const events = ["dry_walk", "dry_run", "damp_walk", "damp_run"];
  for (const suffix of events) {
    const id = `yuehua.backrooms.footstep_${suffix}`;
    assert.equal(definitions.sound_definitions[id], undefined, `${id} still exists`);
    for (let variant = 1; variant <= 3; variant++) {
      assert.equal(
        fs.existsSync(path.join(soundsRoot, "backrooms", `footstep_${suffix}_${variant}.wav`)),
        false,
        `footstep_${suffix}_${variant}.wav still exists`,
      );
    }
  }
  const ambience = fs.readFileSync(ambiencePath, "utf8");
  const generator = fs.readFileSync(path.join(root, "tools", "generate-backrooms-audio.py"), "utf8");
  assert.doesNotMatch(ambience, /footstep|distanceSinceStep|getFootstepSurface/i);
  assert.doesNotMatch(generator, /footstep|carpet_footstep/i);
});

test("corner events use semantic mono PCM16 assets and the requested repeat counts", () => {
  const definitions = JSON.parse(fs.readFileSync(path.join(soundsRoot, "sound_definitions.json"), "utf8"));
  const policies = [
    ["corner_is_anybody", 5.5, 6.2],
    ["corner_creepy_ambient", 21.0, 22.5],
    ["corner_radio_recording", 10.5, 11.6],
  ];
  for (const [suffix, minDuration, maxDuration] of policies) {
    const definition = definitions.sound_definitions[`yuehua.backrooms.${suffix}`];
    assert.ok(definition, `missing corner event ${suffix}`);
    assert.equal(definition.category, "ambient");
    assert.ok(definition.max_distance >= 30 && definition.max_distance <= 44);
    assert.equal(definition.sounds.length, 1);
    assert.equal(definition.sounds[0].is3D, true);
    assert.equal(definition.sounds[0].name, `sounds/backrooms/events/${suffix}`);
    const wave = readWave(path.join(root, "resource_packs", "Backrooms", `${definition.sounds[0].name}.wav`));
    assert.equal(wave.sampleRate, 16_000);
    assert.ok(wave.durationSeconds >= minDuration && wave.durationSeconds <= maxDuration);
    assert.ok(wave.peak >= 0.25 && wave.peak <= 0.9);
  }

  const voices = fs.readFileSync(path.join(root, "scripts", "addons", "backrooms", "voices.ts"), "utf8");
  assert.match(voices, /corner_is_anybody[\s\S]*repeats:\s*3/);
  assert.match(voices, /corner_creepy_ambient[\s\S]*repeats:\s*1/);
  assert.match(voices, /corner_radio_recording[\s\S]*repeats:\s*1/);
  assert.match(voices, /system\.runTimeout/);
  assert.match(voices, /isLogicalCorner/);
  assert.match(voices, /findCornerLocation/);
  assert.match(voices, /minRadius:\s*8/);
  assert.match(voices, /maxRadius:\s*18/);
  assert.match(voices, /CORNER_EVENT_RETRY_TICKS/);
  assert.doesNotMatch(voices, /const radius = 28 \+/);
});

test("imported event audio is reproducible, hash-pinned, and ships no source MP3 files", () => {
  const metadata = JSON.parse(fs.readFileSync(path.join(
    root,
    "assets/backrooms/audio/imported-event-sources.json",
  ), "utf8"));
  assert.equal(metadata.sources.length, 5);
  assert.ok(metadata.sources.every((source) => /^[A-F0-9]{64}$/.test(source.sha256)));
  assert.deepEqual(metadata.sources.map((source) => source.role), [
    "corner_is_anybody",
    "corner_creepy_ambient",
    "lifeform_smiler",
    "lifeform_wail",
    "corner_radio_recording",
  ]);

  const processor = fs.readFileSync(path.join(root, "tools/process-backrooms-event-audio.ps1"), "utf8");
  assert.match(processor, /Get-FileHash\s+-Algorithm\s+SHA256/i);
  assert.equal((processor.match(/-ac\s+1\s+-ar\s+16000\s+-c:a\s+pcm_s16le/g) ?? []).length, 1);
  assert.match(processor, /corner_is_anybody\.wav/);
  assert.match(processor, /corner_creepy_ambient\.wav/);
  assert.match(processor, /corner_radio_recording\.wav/);
  assert.match(processor, /lifeform_smiler\.wav/);
  assert.match(processor, /lifeform_wail\.wav/);
  assert.equal(
    fs.readdirSync(path.join(soundsRoot, "backrooms", "events")).some((name) => name.endsWith(".mp3")),
    false,
  );
  assert.equal(
    fs.readdirSync(path.join(soundsRoot, "backrooms", "lifeform")).some((name) => name.endsWith(".mp3")),
    false,
  );
});
