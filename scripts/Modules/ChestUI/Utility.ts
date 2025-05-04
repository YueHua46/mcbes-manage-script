import * as mc from "@minecraft/server";
const Utility: Record<string, any> = {};

const ExtractResult = {
  name: "",
  string: "",
};
/**
 * Extract Name from String
 * @param {string} string
 * @param {number} index
 * @returns {ExtractResult}
 */
Utility.ExtractNameFromString = async (string: string, index: number) => {
  return new Promise((resolve, reject) => {
    let splitText = string.split(" ");
    let result = {
      name: "",
      string: "",
    };
    if (splitText[index].startsWith(`"`)) {
      result.name += splitText[index];
      let trimed = 1;
      if (!splitText[index].endsWith(`"`)) {
        for (let i = index + 1; i <= splitText.length - 1; i++) {
          result.name += " " + splitText[i];
          trimed += 1;
          if (splitText[i].endsWith(`"`)) break;
        }
      }
      if (!result.name.endsWith(`"`)) {
        resolve(null);
      }
      result.name = (result.name as any).replaceAll(`"`, "");
      splitText.splice(index, trimed);
      result.string = splitText.join(" ");
    } else {
      result.name = splitText[index];
      splitText.splice(index, 1);
      result.string = splitText.join(" ");
    }
    resolve(result);
  });
};

/**
 * Get Item name from ItemStack
 * @param {mc.ItemStack} item
 * @returns {string}
 */
Utility.getItemname = (item: any) => {
  return item.nameTag
    ? "§o" + item.nameTag
    : item.typeId
        .split(":")[1]
        .split("_")
        .map((v: any) => v[0].toUpperCase() + v.slice(1).toLowerCase())
        .join(" ");
};

/**
 * Capitalized String
 * @param {string} string
 * @returns {string}
 */
Utility.capitalized = (string: string) => {
  return string
    .split("_")
    .map((v) => v[0].toUpperCase() + v.slice(1).toLowerCase())
    .join(" ");
};

/**
 * Calculate all number in array
 * @param {number[]} array
 * @returns {number}
 */
Utility.CalculateAverage = (array: any[]) => {
  return Utility.MathSum(array) / array.length;
};

export default Utility;
