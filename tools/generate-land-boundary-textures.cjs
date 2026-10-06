"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.resolve(__dirname, "..");
const TEXTURE_DIR = path.join(ROOT, "resource_packs", "CreeperMenu", "textures", "particle");
const PREVIEW_PATH = path.join(ROOT, "design", "land-boundary-concepts", "arcane-ward-shadow-study.png");

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

class Raster {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  fill(red, green, blue, alpha = 255) {
    for (let index = 0; index < this.width * this.height; index++) {
      const offset = index * 4;
      this.data[offset] = red;
      this.data[offset + 1] = green;
      this.data[offset + 2] = blue;
      this.data[offset + 3] = alpha;
    }
  }

  over(x, y, red, green, blue, alpha) {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height || alpha <= 0) return;
    const offset = (py * this.width + px) * 4;
    const sourceAlpha = clamp(alpha / 255);
    const destinationAlpha = this.data[offset + 3] / 255;
    const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
    if (outputAlpha <= 0) return;
    this.data[offset] = Math.round(
      (red * sourceAlpha + this.data[offset] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha
    );
    this.data[offset + 1] = Math.round(
      (green * sourceAlpha + this.data[offset + 1] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha
    );
    this.data[offset + 2] = Math.round(
      (blue * sourceAlpha + this.data[offset + 2] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha
    );
    this.data[offset + 3] = Math.round(outputAlpha * 255);
  }
}

function makeMask(width, height) {
  return new Float32Array(width * height);
}

function stamp(mask, width, height, x, y, radius, opacity = 1) {
  const minX = Math.max(0, Math.floor(x - radius - 1));
  const maxX = Math.min(width - 1, Math.ceil(x + radius + 1));
  const minY = Math.max(0, Math.floor(y - radius - 1));
  const maxY = Math.min(height - 1, Math.ceil(y + radius + 1));
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const distance = Math.hypot(px + 0.5 - x, py + 0.5 - y);
      const coverage = clamp(radius + 0.75 - distance) * opacity;
      const index = py * width + px;
      if (coverage > mask[index]) mask[index] = coverage;
    }
  }
}

function line(mask, width, height, startX, startY, endX, endY, thickness, opacity = 1) {
  const minX = Math.max(0, Math.floor(Math.min(startX, endX) - thickness));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(startX, endX) + thickness));
  const minY = Math.max(0, Math.floor(Math.min(startY, endY) - thickness));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(startY, endY) + thickness));
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  const radius = thickness / 2;
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const sampleX = px + 0.5;
      const sampleY = py + 0.5;
      const t = lengthSquared === 0 ? 0 : clamp(((sampleX - startX) * dx + (sampleY - startY) * dy) / lengthSquared);
      const nearestX = startX + dx * t;
      const nearestY = startY + dy * t;
      const distance = Math.hypot(sampleX - nearestX, sampleY - nearestY);
      const coverage = clamp(radius + 0.75 - distance) * opacity;
      const index = py * width + px;
      if (coverage > mask[index]) mask[index] = coverage;
    }
  }
}

function polyline(mask, width, height, points, thickness, closed = false, opacity = 1) {
  for (let index = 1; index < points.length; index++) {
    line(
      mask,
      width,
      height,
      points[index - 1][0],
      points[index - 1][1],
      points[index][0],
      points[index][1],
      thickness,
      opacity
    );
  }
  if (closed && points.length > 2) {
    const first = points[0];
    const last = points[points.length - 1];
    line(mask, width, height, last[0], last[1], first[0], first[1], thickness, opacity);
  }
}

function arc(mask, width, height, centerX, centerY, radius, startAngle, endAngle, thickness, opacity = 1) {
  const sweep = endAngle - startAngle;
  const steps = Math.max(8, Math.ceil((Math.abs(sweep) * radius) / 5));
  const points = [];
  for (let index = 0; index <= steps; index++) {
    const angle = startAngle + (sweep * index) / steps;
    points.push([centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius]);
  }
  polyline(mask, width, height, points, thickness, false, opacity);
}

function cubic(mask, width, height, points, thickness, opacity = 1) {
  const samples = [];
  for (let index = 0; index <= 40; index++) {
    const t = index / 40;
    const inverse = 1 - t;
    samples.push([
      inverse ** 3 * points[0][0] +
        3 * inverse ** 2 * t * points[1][0] +
        3 * inverse * t ** 2 * points[2][0] +
        t ** 3 * points[3][0],
      inverse ** 3 * points[0][1] +
        3 * inverse ** 2 * t * points[1][1] +
        3 * inverse * t ** 2 * points[2][1] +
        t ** 3 * points[3][1],
    ]);
  }
  polyline(mask, width, height, samples, thickness, false, opacity);
}

function regularPolygon(centerX, centerY, radius, sides, rotation = -Math.PI / 2) {
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (Math.PI * 2 * index) / sides;
    return [centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius];
  });
}

function boxBlur(mask, width, height, radius, passes = 2) {
  let source = Float32Array.from(mask);
  for (let pass = 0; pass < passes; pass++) {
    const horizontal = new Float32Array(source.length);
    const diameter = radius * 2 + 1;
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) {
        if (x >= 0 && x < width) sum += source[y * width + x];
      }
      for (let x = 0; x < width; x++) {
        horizontal[y * width + x] = sum / diameter;
        const removeX = x - radius;
        const addX = x + radius + 1;
        if (removeX >= 0) sum -= source[y * width + removeX];
        if (addX < width) sum += source[y * width + addX];
      }
    }
    const vertical = new Float32Array(source.length);
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) {
        if (y >= 0 && y < height) sum += horizontal[y * width + x];
      }
      for (let y = 0; y < height; y++) {
        vertical[y * width + x] = sum / diameter;
        const removeY = y - radius;
        const addY = y + radius + 1;
        if (removeY >= 0) sum -= horizontal[removeY * width + x];
        if (addY < height) sum += horizontal[addY * width + x];
      }
    }
    source = vertical;
  }
  return source;
}

function dilate(mask, width, height, radius) {
  const horizontal = makeMask(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maximum = 0;
      for (let sampleX = Math.max(0, x - radius); sampleX <= Math.min(width - 1, x + radius); sampleX++) {
        maximum = Math.max(maximum, mask[y * width + sampleX]);
      }
      horizontal[y * width + x] = maximum;
    }
  }
  const output = makeMask(width, height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let maximum = 0;
      for (let sampleY = Math.max(0, y - radius); sampleY <= Math.min(height - 1, y + radius); sampleY++) {
        maximum = Math.max(maximum, horizontal[sampleY * width + x]);
      }
      output[y * width + x] = maximum;
    }
  }
  return output;
}

function shifted(mask, width, height, offsetX, offsetY) {
  const output = makeMask(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceX = x - offsetX;
      const sourceY = y - offsetY;
      if (sourceX >= 0 && sourceY >= 0 && sourceX < width && sourceY < height) {
        output[y * width + x] = mask[sourceY * width + sourceX];
      }
    }
  }
  return output;
}

function softEllipseMask(width, height, centerX, centerY, radiusX, radiusY) {
  const output = makeMask(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x + 0.5 - centerX) / radiusX;
      const dy = (y + 0.5 - centerY) / radiusY;
      const opacity = Math.exp(-(dx * dx + dy * dy) * 2.4);
      output[y * width + x] = opacity < 0.006 ? 0 : opacity;
    }
  }
  return output;
}

function maximumMask(weightedMasks) {
  const output = new Float32Array(weightedMasks[0][0].length);
  for (let index = 0; index < output.length; index++) {
    for (const [mask, weight] of weightedMasks) {
      output[index] = Math.max(output[index], mask[index] * weight);
    }
  }
  return output;
}

function layer(raster, mask, color, opacity) {
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      const alpha = mask[y * raster.width + x] * opacity * 255;
      if (alpha > 0.35) raster.over(x, y, color[0], color[1], color[2], alpha);
    }
  }
}

function wardTexture(core, width, height, options = {}) {
  const raster = new Raster(width, height);
  const brightCore = dilate(core, width, height, 2);
  const auraSource = dilate(core, width, height, 2);
  const shadowSource = shifted(
    dilate(core, width, height, options.shadowSpread || 1),
    width,
    height,
    options.shadowX || 5,
    options.shadowY || 8
  );
  const outerGlow = boxBlur(auraSource, width, height, options.glowRadius || 18, 3);
  const ambientShadow = boxBlur(shadowSource, width, height, 25, 3);
  const nearShadow = boxBlur(shadowSource, width, height, 12, 3);
  const airGlow = softEllipseMask(width, height, width / 2 + 3, height / 2 + 5, width * 0.43, height * 0.41);
  const backdrop = maximumMask([
    [ambientShadow, 0.9],
    [nearShadow, 0.72],
    [outerGlow, 0.62],
    [airGlow, 0.22],
  ]);
  const edgeGlow = boxBlur(brightCore, width, height, 5, 2);
  layer(raster, backdrop, [132, 38, 236], options.glowOpacity || 0.72);
  layer(raster, edgeGlow, [186, 94, 255], 0.38);
  layer(raster, brightCore, [244, 250, 255], 1);
  return raster;
}

function runeOne() {
  const size = 256;
  const mask = makeMask(size, size);
  polyline(
    mask,
    size,
    size,
    [
      [128, 39],
      [210, 128],
      [128, 217],
      [46, 128],
    ],
    7,
    true
  );
  polyline(
    mask,
    size,
    size,
    [
      [128, 78],
      [173, 128],
      [128, 178],
      [83, 128],
    ],
    6,
    true
  );
  polyline(
    mask,
    size,
    size,
    [
      [128, 98],
      [153, 128],
      [128, 158],
      [103, 128],
    ],
    5,
    true
  );
  for (const pair of [
    [
      [128, 45],
      [128, 78],
    ],
    [
      [205, 128],
      [173, 128],
    ],
    [
      [128, 211],
      [128, 178],
    ],
    [
      [51, 128],
      [83, 128],
    ],
  ]) {
    line(mask, size, size, pair[0][0], pair[0][1], pair[1][0], pair[1][1], 7);
  }
  stamp(mask, size, size, 128, 128, 7);
  return wardTexture(mask, size, size);
}

function runeTwo() {
  const size = 256;
  const mask = makeMask(size, size);
  polyline(mask, size, size, regularPolygon(128, 128, 87, 8, Math.PI / 8), 7, true);
  polyline(
    mask,
    size,
    size,
    [
      [75, 75],
      [112, 75],
      [112, 96],
      [96, 112],
      [75, 112],
    ],
    7
  );
  polyline(
    mask,
    size,
    size,
    [
      [181, 75],
      [144, 75],
      [144, 96],
      [160, 112],
      [181, 112],
    ],
    7
  );
  polyline(
    mask,
    size,
    size,
    [
      [181, 181],
      [144, 181],
      [144, 160],
      [160, 144],
      [181, 144],
    ],
    7
  );
  polyline(
    mask,
    size,
    size,
    [
      [75, 181],
      [112, 181],
      [112, 160],
      [96, 144],
      [75, 144],
    ],
    7
  );
  polyline(
    mask,
    size,
    size,
    [
      [128, 91],
      [165, 128],
      [128, 165],
      [91, 128],
    ],
    6,
    true
  );
  stamp(mask, size, size, 128, 128, 6);
  return wardTexture(mask, size, size);
}

function runeThree() {
  const size = 256;
  const mask = makeMask(size, size);
  arc(mask, size, size, 128, 128, 84, Math.PI * 0.1, Math.PI * 0.9, 7);
  arc(mask, size, size, 128, 128, 84, Math.PI * 1.1, Math.PI * 1.9, 7);
  polyline(
    mask,
    size,
    size,
    [
      [128, 42],
      [128, 190],
      [96, 158],
    ],
    7
  );
  line(mask, size, size, 128, 190, 160, 158, 7);
  polyline(
    mask,
    size,
    size,
    [
      [73, 104],
      [128, 70],
      [183, 104],
    ],
    7
  );
  polyline(
    mask,
    size,
    size,
    [
      [83, 145],
      [128, 116],
      [173, 145],
    ],
    6
  );
  polyline(
    mask,
    size,
    size,
    [
      [128, 105],
      [151, 128],
      [128, 151],
      [105, 128],
    ],
    5,
    true
  );
  stamp(mask, size, size, 128, 202, 6);
  return wardTexture(mask, size, size);
}

function runeFour() {
  const size = 256;
  const mask = makeMask(size, size);
  for (let index = 0; index < 6; index++) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 6;
    const perpendicular = angle + Math.PI / 2;
    const inner = [128 + Math.cos(angle) * 28, 128 + Math.sin(angle) * 28];
    const outer = [128 + Math.cos(angle) * 88, 128 + Math.sin(angle) * 88];
    const left = [
      128 + Math.cos(angle) * 61 + Math.cos(perpendicular) * 19,
      128 + Math.sin(angle) * 61 + Math.sin(perpendicular) * 19,
    ];
    const right = [
      128 + Math.cos(angle) * 61 - Math.cos(perpendicular) * 19,
      128 + Math.sin(angle) * 61 - Math.sin(perpendicular) * 19,
    ];
    polyline(mask, size, size, [inner, left, outer, right], 6, true);
  }
  polyline(mask, size, size, regularPolygon(128, 128, 38, 6), 6, true);
  polyline(mask, size, size, regularPolygon(128, 128, 17, 6, 0), 5, true);
  return wardTexture(mask, size, size);
}

function runeFive() {
  const size = 256;
  const mask = makeMask(size, size);
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    const start = (quadrant * Math.PI) / 2 + 0.16;
    const end = ((quadrant + 1) * Math.PI) / 2 - 0.16;
    arc(mask, size, size, 128, 128, 86, start, end, 8);
    arc(mask, size, size, 128, 128, 59, start + 0.1, end - 0.1, 5);
  }
  polyline(
    mask,
    size,
    size,
    [
      [128, 77],
      [179, 128],
      [128, 179],
      [77, 128],
    ],
    6,
    true
  );
  polyline(
    mask,
    size,
    size,
    [
      [128, 101],
      [155, 128],
      [128, 155],
      [101, 128],
    ],
    5,
    true
  );
  for (const point of [
    [128, 35],
    [221, 128],
    [128, 221],
    [35, 128],
  ])
    stamp(mask, size, size, point[0], point[1], 6);
  stamp(mask, size, size, 128, 128, 7);
  return wardTexture(mask, size, size);
}

function anchorTexture() {
  const size = 256;
  const mask = makeMask(size, size);
  polyline(
    mask,
    size,
    size,
    [
      [128, 38],
      [179, 128],
      [128, 218],
      [77, 128],
    ],
    8,
    true
  );
  polyline(
    mask,
    size,
    size,
    [
      [128, 75],
      [157, 128],
      [128, 181],
      [99, 128],
    ],
    6,
    true
  );
  arc(mask, size, size, 128, 128, 79, Math.PI * 0.08, Math.PI * 0.42, 5);
  arc(mask, size, size, 128, 128, 79, Math.PI * 0.58, Math.PI * 0.92, 5);
  arc(mask, size, size, 128, 128, 79, Math.PI * 1.08, Math.PI * 1.42, 5);
  arc(mask, size, size, 128, 128, 79, Math.PI * 1.58, Math.PI * 1.92, 5);
  stamp(mask, size, size, 128, 128, 8);
  return wardTexture(mask, size, size, { glowRadius: 14, glowOpacity: 0.82 });
}

function groundSigilTexture() {
  const size = 256;
  const mask = makeMask(size, size);
  for (const radius of [101, 85, 57]) {
    for (let quadrant = 0; quadrant < 4; quadrant++) {
      const start = (quadrant * Math.PI) / 2 + 0.08 + (radius === 85 ? 0.08 : 0);
      const end = ((quadrant + 1) * Math.PI) / 2 - 0.08 - (radius === 85 ? 0.08 : 0);
      arc(mask, size, size, 128, 128, radius, start, end, radius === 57 ? 4 : 5, radius === 85 ? 0.76 : 1);
    }
  }
  polyline(mask, size, size, regularPolygon(128, 128, 69, 8, Math.PI / 8), 4, true, 0.8);
  polyline(
    mask,
    size,
    size,
    [
      [128, 83],
      [173, 128],
      [128, 173],
      [83, 128],
    ],
    5,
    true
  );
  for (let index = 0; index < 12; index++) {
    const angle = (Math.PI * 2 * index) / 12;
    stamp(mask, size, size, 128 + Math.cos(angle) * 94, 128 + Math.sin(angle) * 94, index % 3 === 0 ? 4.5 : 2.5);
  }
  return wardTexture(mask, size, size, { shadowX: 3, shadowY: 4, glowRadius: 16, glowOpacity: 0.9 });
}

function spireTexture() {
  const width = 128;
  const height = 256;
  const mask = makeMask(width, height);
  cubic(
    mask,
    width,
    height,
    [
      [63, 233],
      [18, 183],
      [103, 122],
      [59, 36],
    ],
    7
  );
  cubic(
    mask,
    width,
    height,
    [
      [68, 230],
      [112, 171],
      [26, 125],
      [72, 57],
    ],
    6,
    0.9
  );
  cubic(
    mask,
    width,
    height,
    [
      [62, 215],
      [40, 176],
      [84, 146],
      [62, 92],
    ],
    4,
    0.85
  );
  arc(mask, width, height, 64, 221, 37, Math.PI * 0.05, Math.PI * 0.95, 5);
  arc(mask, width, height, 64, 221, 37, Math.PI * 1.05, Math.PI * 1.95, 5);
  polyline(
    mask,
    width,
    height,
    [
      [64, 181],
      [77, 157],
      [64, 132],
      [51, 157],
    ],
    4,
    true
  );
  stamp(mask, width, height, 64, 32, 4);
  return wardTexture(mask, width, height, { shadowX: 3, shadowY: 4, glowRadius: 10, glowOpacity: 0.95 });
}

function orbTexture() {
  const size = 128;
  const raster = new Raster(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x + 0.5 - 64, y + 0.5 - 64) / 64;
      const outer = clamp(1 - distance) ** 2.4;
      const core = clamp(1 - distance * 3.2) ** 1.6;
      if (outer > 0) raster.over(x, y, 112, 50, 255, outer * 160);
      if (core > 0) raster.over(x, y, 239, 255, 255, core * 255);
    }
  }
  return raster;
}

function drawImage(
  target,
  source,
  centerX,
  centerY,
  targetWidth,
  targetHeight,
  opacity = 1,
  rotation = 0,
  tint = [255, 255, 255]
) {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const halfWidth = targetWidth / 2;
  const halfHeight = targetHeight / 2;
  const radius = Math.ceil(Math.hypot(halfWidth, halfHeight));
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(target.width - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(target.height - 1, Math.ceil(centerY + radius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const relativeX = x + 0.5 - centerX;
      const relativeY = y + 0.5 - centerY;
      const localX = relativeX * cosine + relativeY * sine;
      const localY = -relativeX * sine + relativeY * cosine;
      const u = localX / targetWidth + 0.5;
      const v = localY / targetHeight + 0.5;
      if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
      const sourceX = Math.min(source.width - 1, Math.floor(u * source.width));
      const sourceY = Math.min(source.height - 1, Math.floor(v * source.height));
      const offset = (sourceY * source.width + sourceX) * 4;
      target.over(
        x,
        y,
        (source.data[offset] * tint[0]) / 255,
        (source.data[offset + 1] * tint[1]) / 255,
        (source.data[offset + 2] * tint[2]) / 255,
        source.data[offset + 3] * opacity
      );
    }
  }
}

function previewTexture(textures) {
  const width = 1600;
  const height = 900;
  const raster = new Raster(width, height);
  for (let y = 0; y < height; y++) {
    const t = y / height;
    for (let x = 0; x < width; x++) {
      const vignette = clamp(1 - Math.hypot((x - 800) / 1000, (y - 470) / 720) * 0.45);
      const red = Math.round((7 + 10 * t) * vignette);
      const green = Math.round((10 + 13 * t) * vignette);
      const blue = Math.round((18 + 15 * t) * vignette);
      const offset = (y * width + x) * 4;
      raster.data[offset] = red;
      raster.data[offset + 1] = green;
      raster.data[offset + 2] = blue;
      raster.data[offset + 3] = 255;
    }
  }

  const grid = makeMask(width, height);
  for (let index = 0; index < 11; index++) {
    const y = 350 + index * 42;
    line(grid, width, height, 120, y, 1490, y + 55, 2, 0.18);
  }
  for (let index = 0; index < 17; index++) {
    const x = 80 + index * 100;
    line(grid, width, height, x, 850, 800 + (x - 800) * 0.28, 250, 2, 0.13);
  }
  layer(raster, grid, [67, 93, 111], 0.42);

  const bottom = [
    [175, 720],
    [1190, 770],
    [1450, 410],
    [485, 365],
  ];
  const top = bottom.map((point) => [point[0], point[1] - 270]);
  const edgePairs = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ];

  for (const pair of edgePairs) {
    const start = bottom[pair[0]];
    const end = bottom[pair[1]];
    const count = Math.max(6, Math.round(Math.hypot(end[0] - start[0], end[1] - start[1]) / 68));
    for (let index = 0; index <= count; index++) {
      const t = index / count;
      const x = start[0] + (end[0] - start[0]) * t;
      const y = start[1] + (end[1] - start[1]) * t;
      if (index > 0 && index < count) {
        const rune = textures.runes[(index + pair[0] * 2) % textures.runes.length];
        const perspective = 0.78 + (y / height) * 0.32;
        const tint = index % 3 === 0 ? [78, 232, 255] : [192, 105, 255];
        drawImage(raster, rune, x, y - 22, 62 * perspective, 62 * perspective, 0.95, 0, tint);
      }
    }
  }

  for (let corner = 0; corner < 4; corner++) {
    drawImage(raster, textures.ground, bottom[corner][0], bottom[corner][1] + 10, 160, 58, 0.9, 0, [132, 207, 255]);
    drawImage(raster, textures.spire, bottom[corner][0], bottom[corner][1] - 80, 74, 184, 0.82, 0, [190, 92, 255]);
    drawImage(raster, textures.anchor, bottom[corner][0], bottom[corner][1] - 20, 58, 58, 0.95, 0, [200, 160, 255]);
    for (let index = 1; index <= 4; index++) {
      const t = index / 5;
      const x = bottom[corner][0] + (top[corner][0] - bottom[corner][0]) * t;
      const y = bottom[corner][1] + (top[corner][1] - bottom[corner][1]) * t;
      const tint = index % 2 === 0 ? [90, 218, 255] : [184, 100, 255];
      drawImage(raster, textures.runes[(corner + index) % 5], x, y, 58, 58, 0.95, 0, tint);
    }
    drawImage(raster, textures.anchor, top[corner][0], top[corner][1], 58, 58, 0.95, 0, [200, 160, 255]);
  }

  for (const pair of edgePairs) {
    const start = top[pair[0]];
    const end = top[pair[1]];
    const count = Math.max(3, Math.round(Math.hypot(end[0] - start[0], end[1] - start[1]) / 68));
    for (let index = 1; index < count; index++) {
      const t = index / count;
      const x = start[0] + (end[0] - start[0]) * t;
      const y = start[1] + (end[1] - start[1]) * t;
      const tint = index % 3 === 0 ? [78, 232, 255] : [192, 105, 255];
      drawImage(raster, textures.runes[(index + pair[1]) % 5], x, y, 58, 58, 0.95, 0, tint);
    }
  }

  drawImage(raster, textures.orb, 1035, 744, 48, 48, 1);
  return raster;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(raster) {
  const scanlines = Buffer.alloc((raster.width * 4 + 1) * raster.height);
  for (let y = 0; y < raster.height; y++) {
    const destination = y * (raster.width * 4 + 1);
    scanlines[destination] = 0;
    Buffer.from(raster.data.buffer, raster.data.byteOffset + y * raster.width * 4, raster.width * 4).copy(
      scanlines,
      destination + 1
    );
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(raster.width, 0);
  header.writeUInt32BE(raster.height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function writeRaster(filename, raster) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, encodePng(raster));
}

function main() {
  const runes = [runeOne(), runeTwo(), runeThree(), runeFour(), runeFive()];
  const textures = {
    runes,
    anchor: anchorTexture(),
    ground: groundSigilTexture(),
    spire: spireTexture(),
    orb: orbTexture(),
  };
  runes.forEach((rune, index) =>
    writeRaster(path.join(TEXTURE_DIR, "rbb_land_boundary_rune_" + (index + 1) + ".png"), rune)
  );
  writeRaster(path.join(TEXTURE_DIR, "rbb_land_boundary_anchor.png"), textures.anchor);
  writeRaster(path.join(TEXTURE_DIR, "rbb_land_boundary_ground_sigil.png"), textures.ground);
  writeRaster(path.join(TEXTURE_DIR, "rbb_land_boundary_spire.png"), textures.spire);
  writeRaster(path.join(TEXTURE_DIR, "rbb_land_boundary_orb.png"), textures.orb);
  writeRaster(PREVIEW_PATH, previewTexture(textures));
  process.stdout.write("Generated 9 particle textures and " + path.relative(ROOT, PREVIEW_PATH) + "\n");
}

main();
