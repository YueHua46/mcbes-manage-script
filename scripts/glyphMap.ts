// 此文件由脚本自动生成，映射 myEmojis 中的文件名到私有 Unicode
export const glyphMap: Record<string, string> = {
  "365880": "",
  "408136": "",
  "408137": "",
  "408138": "",
  "408145": "",
  "408157": "",
  "408167": "",
  "465236": "",
  "465270": "",
  "12065264": "",
  "12453852": "",
  "12751922": "",
  "12872934": "",
  "12873003": "",
  "13107521": "",
  "13107591": "",
  "13107603": "",
  "13305226": "",
  "14321632": "",
  "14321635": "",
  "14321654": "",
  "14321660": "",
  "14321662": "",
  "14827849": "",
  "14828093": "",
  "15090570": "",
  "15090582": "",
  "15090588": "",
  "15174541": "",
  "15174544": "",
  "15174556": "",
  "15174557": "",
  "15174597": "",
  "15360196": "",
  "16329342": "",
  "16329407": "",
  "16329456": "",
  "18636307": "",
  "001-pizza": "",
  "002-robot": "",
  "003-angel": "",
  "004-trophy": "",
  "005-crown": "",
  "006-tree": "",
  "007-bottle": "",
  "008-book": "",
  "009-blink": "",
  "010-gift-box": "",
  "011-confetti": "",
  "012-label": "",
  "013-mask": "",
  "014-pansexual": "",
  "015-parfume": "",
  "016-music": "",
  "017-star": "",
  "018-mail": "",
  "019-rainbow": "",
  "020-slaughter": "",
  "021-heart-eyes": "",
  "022-flask": "",
  "023-caution": "",
  "024-disco-ball": "",
  "025-winter": "",
  "026-ice-cube": "",
  "027-location": "",
  "028-candy": "",
  "029-mist": "",
  "030-snowman": "",
  "031-gift-box-1": "",
  "032-sparkling-drink": "",
  "033-gift-box-2": "",
  "034-balloon": "",
  "035-cyclone": "",
  "036-drought": "",
  axe: "",
  beryl: "",
  diamond: "",
  emeralb_2: "",
  emerald: "",
  mineral: "",
  orange_diamond: "",
  pearl: "",
  pickaxe: "",
  red_diamond: "",
  sapphire: "",
  seed: "",
  shovel: "",
  sword: "",
  sword_2: "",
  wood: "",
  wood_2: "",
};

// 头像（名字前缀）
export const namePrefixMap: string[] = ["", "", "", ""];

// 欢迎语装饰
export const welcomeGlyphs: string[] = ["", "", "", "", "", "", "", "", "", ""];

// thedn装饰
// T H E D N
export const thendGlyphs: string[] = ["", "", "", "", ""];

// socials or 其他
export const socials: Record<string, string> = {
  youtube: "",
  reddit: "",
  note: "",
  twitter: "",
  discord: "",
  mcpedl: "",
};

// 其他
export const otherGlyphMap: Record<string, string> = {
  cat: "",
  gear: "",
  wrench: "",
};

// welcome fox
export const welcomeFoxGlyphs: string[] = [""];

export const glyphKeys = Object.keys(glyphMap) as GlyphKey[];

export const glyphList = Object.values(glyphMap);

export type GlyphKey = keyof typeof glyphMap;
