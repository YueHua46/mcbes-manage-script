import type { QuestRarity } from "../domain";
import { GENERATED_PRESET_QUEST_ICONS } from "./generated-quest-icon-map";

export type QuestFeedbackKind = "accept" | "progress" | "complete" | "claim";

export interface QuestExperienceTheme {
  rarity: QuestRarity;
  label: string;
  icon: string;
  color: string;
  marker: string;
  soundPrefix: string;
  priority: number;
}

const THEMES: Record<QuestRarity, QuestExperienceTheme> = {
  common: {
    rarity: "common",
    label: "普通",
    icon: "◆",
    color: "§2",
    marker: "[CMQUEST_COMMON]",
    soundPrefix: "creeper.quest.common",
    priority: 30,
  },
  rare: {
    rarity: "rare",
    label: "稀有",
    icon: "✦",
    color: "§3",
    marker: "[CMQUEST_RARE]",
    soundPrefix: "creeper.quest.rare",
    priority: 36,
  },
  epic: {
    rarity: "epic",
    label: "史诗",
    icon: "❖",
    color: "§5",
    marker: "[CMQUEST_EPIC]",
    soundPrefix: "creeper.quest.epic",
    priority: 42,
  },
  legendary: {
    rarity: "legendary",
    label: "传说",
    icon: "✹",
    color: "§6",
    marker: "[CMQUEST_LEGENDARY]",
    soundPrefix: "creeper.quest.legendary",
    priority: 50,
  },
};

export const QUEST_HUD_MARKERS = Object.values(THEMES).map((theme) => theme.marker);

export const QUEST_ICON_MARKERS = Object.values(GENERATED_PRESET_QUEST_ICONS).map((icon) => icon.marker);

export function getQuestIconMarker(questId: string | undefined): string {
  return questId ? (GENERATED_PRESET_QUEST_ICONS[questId]?.marker ?? "") : "";
}

export function getQuestExperienceTheme(rarity: QuestRarity | undefined): QuestExperienceTheme {
  return THEMES[rarity ?? "common"];
}

export function getQuestFeedbackSound(rarity: QuestRarity | undefined, kind: QuestFeedbackKind): string {
  return `${getQuestExperienceTheme(rarity).soundPrefix}.${kind}`;
}

export function sanitizeQuestDisplayText(value: string): string {
  return value
    .replace(/§./g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\[(?:CMHUD|CMQUEST_[A-Z]+)\]/g, "")
    .trim()
    .slice(0, 80);
}
