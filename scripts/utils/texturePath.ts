import { iconPathMap, IconPath } from "../Modules/Economic/data/iconPath";

// 生成所有可能的排列组合
function generatePermutations(arr: string[]): string[] {
  if (arr.length <= 1) return arr;

  const result: string[] = [];

  for (let i = 0; i < arr.length; i++) {
    const current = arr[i];
    const remaining = [...arr.slice(0, i), ...arr.slice(i + 1)];
    const perms = generatePermutations(remaining);

    for (const perm of perms) {
      result.push(current + "_" + perm);
    }
  }

  return result;
}

// 动态匹配iconPath
export function dynamicMatchIconPath(itemId: string): string {
  // 首先尝试直接匹配
  const iconPath = iconPathMap[itemId as IconPath];
  if (iconPath) {
    return iconPath;
  }

  // 如果直接匹配失败，则尝试通过_分割单词，然后生成所有可能的排列组合
  const splitItemId = itemId.split("_");

  // 如果只有一个单词，直接返回空字符串
  if (splitItemId.length <= 1) {
    return "";
  }

  // 生成所有可能的排列组合
  const permutations = generatePermutations(splitItemId);

  // 尝试每个排列组合
  for (const perm of permutations) {
    const matchedPath = iconPathMap[perm as IconPath];
    if (matchedPath) {
      return matchedPath;
    }
  }

  // 如果所有排列组合都没有匹配到，返回空字符串
  return "";
}
