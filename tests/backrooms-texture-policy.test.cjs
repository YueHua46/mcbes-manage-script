const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const textureRoot = path.join(root, "resource_packs", "Backrooms", "textures", "blocks", "backrooms");
const textureNames = [
  "wallpaper.png",
  "wallpaper_stained.png",
  "carpet.png",
  "carpet_damp.png",
  "ceiling_tile.png",
  "fluorescent_on.png",
  "fluorescent_dead.png",
];

function decodeRgbPng(filename, directory = textureRoot) {
  const bytes = fs.readFileSync(path.join(directory, filename));
  assert.equal(bytes.toString("ascii", 1, 4), "PNG", `${filename} must be a PNG`);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  assert.equal(bitDepth, 8, `${filename} must use 8-bit channels`);
  assert.ok(colorType === 2 || colorType === 6, `${filename} must use RGB or RGBA`);
  const channels = colorType === 2 ? 3 : 4;
  const idat = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * channels);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const encoded = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upperLeft);
      pixels[y * stride + x] = (encoded + predictor) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function statistics(image) {
  const sums = [0, 0, 0];
  const squared = [0, 0, 0];
  let maximum = 0;
  let neighborDifference = 0;
  let neighborSamples = 0;
  const at = (x, y, channel) => image.pixels[(y * image.width + x) * image.channels + channel];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const value = at(x, y, channel);
        sums[channel] += value;
        squared[channel] += value * value;
        maximum = Math.max(maximum, value);
        if (x > 0) { neighborDifference += Math.abs(value - at(x - 1, y, channel)); neighborSamples += 1; }
        if (y > 0) { neighborDifference += Math.abs(value - at(x, y - 1, channel)); neighborSamples += 1; }
      }
    }
  }
  const count = image.width * image.height;
  const mean = sums.map((sum) => sum / count);
  const deviation = squared.map((sum, channel) => Math.sqrt(sum / count - mean[channel] ** 2));
  return { mean, deviation, maximum, highFrequency: neighborDifference / neighborSamples };
}

function distance(a, b) {
  return Math.hypot(...a.map((value, index) => value - b[index]));
}

function assertPixelEquivalent(filename, generatedDirectory) {
  const generated = decodeRgbPng(filename, generatedDirectory);
  const checkedIn = decodeRgbPng(filename);
  assert.equal(generated.width, checkedIn.width, `${filename} width changed`);
  assert.equal(generated.height, checkedIn.height, `${filename} height changed`);
  assert.equal(generated.channels, checkedIn.channels, `${filename} channel count changed`);

  let totalDifference = 0;
  let maximumDifference = 0;
  for (let index = 0; index < checkedIn.pixels.length; index += 1) {
    const difference = Math.abs(generated.pixels[index] - checkedIn.pixels[index]);
    totalDifference += difference;
    maximumDifference = Math.max(maximumDifference, difference);
  }
  const meanDifference = totalDifference / checkedIn.pixels.length;
  assert.ok(maximumDifference <= 1, `${filename} differs by up to ${maximumDifference} channel levels`);
  assert.ok(meanDifference <= 0.15, `${filename} mean channel difference is ${meanDifference}`);
}

function chroma(mean) {
  const total = mean.reduce((sum, value) => sum + value, 0);
  return mean.map((value) => value / total);
}

function luminance(mean) {
  return mean[0] * 0.2126 + mean[1] * 0.7152 + mean[2] * 0.0722;
}

function periodicCorrelation(image, period) {
  const values = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * image.channels;
      values.push(
        image.pixels[index] * 0.2126
        + image.pixels[index + 1] * 0.7152
        + image.pixels[index + 2] * 0.0722
      );
    }
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width - period; x += 1) {
      const a = values[y * image.width + x] - mean;
      const b = values[y * image.width + x + period] - mean;
      covariance += a * b;
      varianceA += a * a;
      varianceB += b * b;
    }
  }
  return covariance / Math.sqrt(varianceA * varianceB);
}

function boundaryDifference(image) {
  const at = (x, y, channel) => image.pixels[(y * image.width + x) * image.channels + channel];
  let leftRight = 0;
  let topBottom = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      leftRight += Math.abs(at(0, y, channel) - at(image.width - 1, y, channel));
    }
  }
  for (let x = 0; x < image.width; x += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      topBottom += Math.abs(at(x, 0, channel) - at(x, image.height - 1, channel));
    }
  }
  const samples = image.width * 3;
  return { leftRight: leftRight / samples, topBottom: topBottom / samples };
}

function sha256(filename) {
  return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

test("Backrooms physical albedos stay pale on one desaturated yellow-olive chroma axis", () => {
  const targets = {
    "wallpaper.png": [194, 191, 145],
    "ceiling_tile.png": [178, 174, 128],
    "carpet.png": [164, 155, 116],
  };
  const stats = Object.fromEntries(Object.entries(targets).map(([name, target]) => {
    const image = decodeRgbPng(name);
    assert.equal(image.width, 64);
    assert.equal(image.height, 64);
    const value = statistics(image);
    assert.ok(value.mean[0] > value.mean[1] && value.mean[1] > value.mean[2], `${name} must be warm yellow`);
    assert.ok(distance(value.mean, target) <= 13, `${name} mean ${value.mean.map(Math.round)} is too dark or left the pale shared palette`);
    assert.ok(Math.max(...value.mean) - Math.min(...value.mean) <= 58, `${name} is too saturated for aged physical albedo`);
    return [name, value];
  }));

  const wall = stats["wallpaper.png"];
  const ceiling = stats["ceiling_tile.png"];
  const carpet = stats["carpet.png"];
  assert.ok(distance(chroma(wall.mean), chroma(ceiling.mean)) < 0.022, "wall and ceiling hue families diverged");
  assert.ok(distance(chroma(wall.mean), chroma(carpet.mean)) < 0.026, "wall and carpet hue families diverged");
  assert.ok(luminance(wall.mean) > luminance(ceiling.mean), "wallpaper should read slightly brighter than ceiling tile");
  assert.ok(luminance(ceiling.mean) > luminance(carpet.mean), "ceiling tile should read brighter than carpet");
});

test("wallpaper repeats subtly, carpet stays low-frequency, and ceiling keeps fine matte speckle", () => {
  const wallpaperImage = decodeRgbPng("wallpaper.png");
  const wallpaper = statistics(wallpaperImage);
  const carpet = statistics(decodeRgbPng("carpet.png"));
  const damp = statistics(decodeRgbPng("carpet_damp.png"));
  const ceiling = statistics(decodeRgbPng("ceiling_tile.png"));

  assert.ok(wallpaper.deviation.every((value) => value >= 3.0 && value <= 11), "wallpaper motif must stay subtle");
  assert.ok(periodicCorrelation(wallpaperImage, 8) >= 0.28, "wallpaper needs a restrained eight-pixel repeating motif");
  assert.ok(carpet.highFrequency < 3.4, `carpet detail is too sharp: ${carpet.highFrequency}`);
  assert.ok(damp.highFrequency < 3.0, `damp carpet detail is too sharp: ${damp.highFrequency}`);
  assert.ok(ceiling.highFrequency >= 1.8 && ceiling.highFrequency <= 5.0, `ceiling speckle frequency is invalid: ${ceiling.highFrequency}`);
  assert.ok(ceiling.deviation.every((value) => value >= 2.0 && value <= 8.5), "ceiling must have fine low-contrast matte variation");
});

test("variants retain their base hue family and the live fluorescent diffuser is warm ivory", () => {
  const wallpaper = statistics(decodeRgbPng("wallpaper.png"));
  const stained = statistics(decodeRgbPng("wallpaper_stained.png"));
  const carpet = statistics(decodeRgbPng("carpet.png"));
  const damp = statistics(decodeRgbPng("carpet_damp.png"));
  const lamp = statistics(decodeRgbPng("fluorescent_on.png"));
  const dead = statistics(decodeRgbPng("fluorescent_dead.png"));

  assert.ok(distance(chroma(wallpaper.mean), chroma(stained.mean)) < 0.024, "stains must not create a new hue family");
  assert.ok(distance(chroma(carpet.mean), chroma(damp.mean)) < 0.024, "moisture must not create a new hue family");
  assert.ok(distance(chroma(lamp.mean), chroma(dead.mean)) < 0.03, "dead diffuser must preserve aged lamp chroma");
  assert.ok(luminance(stained.mean) < luminance(wallpaper.mean));
  assert.ok(luminance(damp.mean) < luminance(carpet.mean));
  assert.ok(luminance(dead.mean) < luminance(lamp.mean));
  assert.ok(luminance(stained.mean) >= 145, "stained wallpaper must not bake room darkness into its albedo");
  assert.ok(luminance(damp.mean) >= 115, "damp carpet must stay a readable physical material under local light");
  assert.ok(luminance(dead.mean) >= 125, "dead diffuser must stay pale enough to receive environmental light");
  assert.ok(lamp.mean[0] > lamp.mean[1] && lamp.mean[1] > lamp.mean[2]);
  assert.ok(lamp.mean[0] - lamp.mean[2] >= 20 && lamp.mean[0] - lamp.mean[2] <= 48, "lamp must be aged warm ivory, not white or orange");
  assert.ok(luminance(lamp.mean) >= 218, "live diffuser must be pale ivory before block light is applied");
  assert.ok(lamp.maximum <= 244, "lamp must not contain near-pure white pixels");
});

test("all seven tiles join continuously across opposite boundaries", () => {
  for (const name of textureNames) {
    const seam = boundaryDifference(decodeRgbPng(name));
    assert.ok(seam.leftRight <= 3.0, `${name} left/right seam is visible: ${seam.leftRight}`);
    assert.ok(seam.topBottom <= 3.0, `${name} top/bottom seam is visible: ${seam.topBottom}`);
  }
});

test("the processor is deterministic and reproduces every checked-in texture across platforms", { timeout: 60_000 }, () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "backrooms-textures-"));
  try {
    const python = process.env.PYTHON || "python3";
    const firstOutput = path.join(temporaryRoot, "first");
    const secondOutput = path.join(temporaryRoot, "second");
    for (const output of [firstOutput, secondOutput]) {
      const result = childProcess.spawnSync(
        python,
        [
          path.join(root, "tools", "process-backrooms-textures.py"),
          path.join(root, "assets", "backrooms", "source_material_atlas_v4.png"),
          output,
        ],
        { cwd: root, encoding: "utf8", timeout: 25_000 }
      );
      assert.equal(result.status, 0, `texture processor failed:\n${result.stdout}\n${result.stderr}`);
    }
    for (const name of textureNames) {
      const first = path.join(firstOutput, name);
      const second = path.join(secondOutput, name);
      assert.ok(fs.existsSync(first), `processor did not create ${name}`);
      assert.equal(sha256(first), sha256(second), `${name} is not deterministic`);
      assertPixelEquivalent(name, firstOutput);
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
