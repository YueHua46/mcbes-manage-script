const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "scripts", "features", "land", "services", "land-flight.ts"), "utf8");

test("land flight sessions retain the last guarded location", () => {
  assert.match(source, /lastLocation: \{ x: number; y: number; z: number \}/);
  assert.match(source, /lastLocation: \{ \.\.\.player\.location \}/);
  assert.match(source, /sess\.lastLocation = \{ \.\.\.loc \}/);
});

test("long-distance teleport outside trusted land bypasses leave grace", () => {
  assert.match(source, /LONG_DISTANCE_TELEPORT_BLOCKS = 32/);
  assert.match(
    source,
    /const teleportedFar = distanceSquared\(loc, sess\.lastLocation\) >= LONG_DISTANCE_TELEPORT_DISTANCE_SQUARED/
  );
  assert.match(
    source,
    /if \(onTrustedLand\)[\s\S]*?continue;[\s\S]*?if \(teleportedFar\) \{\s*revokeLandFlightImmediate\(player\)/
  );
});

test("land probing does not require the destination chunk block to be available", () => {
  assert.match(source, /function getLandProbeLocation\(player: Player\) \{\s*return player\.location;\s*\}/);
  assert.doesNotMatch(source, /player\.dimension\.getBlock\(player\.location\)/);
});
