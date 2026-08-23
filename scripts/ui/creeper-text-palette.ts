import type { RawMessage } from "@minecraft/server";

const MINECRAFT_FORMATTING_CODE = /§[0-9a-u]/gi;
const MINECRAFT_COLOR_CODE = /§([0-9a-jmnpqstu])/gi;

/**
 * Low-saturation, paper-safe Minecraft text palette used by CreeperMenu forms.
 * Formatting such as bold, italic, obfuscated, and reset remains untouched.
 */
export const CREEPER_TEXT_COLOR_CODES: Readonly<Record<string, string>> = {
  "0": "j", // black -> netherite ink
  "1": "t", // dark blue -> lapis
  "2": "2", // dark green -> dark green
  "3": "t", // dark aqua -> lapis
  "4": "m", // dark red -> redstone
  "5": "5", // dark purple -> dark purple
  "6": "n", // gold -> copper
  "7": "8", // gray -> dark gray
  "8": "8", // dark gray -> dark gray
  "9": "t", // blue -> lapis
  a: "2", // green -> dark green
  b: "t", // aqua -> lapis
  c: "m", // red -> redstone
  d: "5", // light purple -> dark purple
  e: "n", // yellow -> copper
  f: "j", // white -> netherite ink
  g: "n", // minecoin gold -> copper
  h: "8", // quartz -> dark gray
  i: "8", // iron -> dark gray
  j: "j", // netherite -> netherite ink
  m: "m", // redstone -> redstone
  n: "n", // copper -> copper
  p: "n", // material gold -> copper
  q: "2", // emerald -> dark green
  s: "t", // diamond -> lapis
  t: "t", // lapis -> lapis
  u: "5", // amethyst -> dark purple
};

function transformStrings<T>(value: T, transform: (text: string) => string): T {
  const visit = (node: unknown): unknown => {
    if (typeof node === "string") return transform(node);
    if (Array.isArray(node)) return node.map(visit);
    if (node !== null && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, visit(child)]));
    }
    return node;
  };

  return visit(value) as T;
}

/** Remap only color codes; preserve the business text and text emphasis. */
export function applyCreeperTextPalette<T>(value: T): T {
  return transformStrings(value, (text) =>
    text.replace(MINECRAFT_COLOR_CODE, (_match, code: string) => `§${CREEPER_TEXT_COLOR_CODES[code.toLowerCase()]}`)
  );
}

/** Keep private routing titles visually neutral and free of formatting state. */
export function neutralizeCreeperTitle(value: RawMessage | string): RawMessage | string {
  return transformStrings(value, (text) => text.replace(MINECRAFT_FORMATTING_CODE, ""));
}

export function unformattedCreeperText(value: string): string {
  return value.replace(MINECRAFT_FORMATTING_CODE, "");
}
