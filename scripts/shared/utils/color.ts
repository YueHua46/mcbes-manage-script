/**
 * 颜色工具函数
 */

export const SECTION_SIGN = "§";
export const colorCodes = {
  black: "0",
  darkBlue: "1",
  darkGreen: "2",
  darkAqua: "3",
  darkRed: "4",
  darkPurple: "5",
  gold: "6",
  gray: "7",
  darkGray: "8",
  blue: "9",
  green: "a",
  aqua: "b",
  red: "c",
  lightPurple: "d",
  yellow: "e",
  white: "f",
  minecoinGold: "g",
  materialQuartz: "h",
  materialIron: "i",
  materialNetherite: "j",
  obfuscated: "k",
  bold: "l",
  materialRedstone: "m",
  materialCopper: "n",
  italic: "o",
  materialGold: "p",
  materialEmerald: "q",
  reset: "r",
  materialDiamond: "s",
  materialLapis: "t",
  materialAmethyst: "u",
};

for (const key in colorCodes) {
  const _key = key as keyof typeof colorCodes;
  colorCodes[_key] = SECTION_SIGN + colorCodes[_key];
}

type StyleId = keyof typeof colorCodes;

export type Stylizer = {
  (...strings: string[]): string;
} & {
  [P in StyleId]: Stylizer;
};

function createStylizer(extend: string[]): Stylizer {
  const handlerColor = (...args: string[]) => [...extend, ...args].join("");

  const proxy = new Proxy(handlerColor, {
    get(target, key: string, receiver) {
      const _key = key as keyof typeof colorCodes;
      const code = colorCodes[_key];

      if (code) return createStylizer([...extend, code]);

      return Reflect.get(target, key, receiver);
    },
  });

  return proxy as Stylizer;
}

export const color = createStylizer([]);


