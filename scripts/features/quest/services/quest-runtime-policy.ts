import setting from "../../system/services/setting";

export function isQuestSystemEnabled(): boolean {
  return setting.getState("quest") === true;
}

export function arePresetQuestsEnabled(): boolean {
  return isQuestSystemEnabled() && setting.getState("questPresets") === true;
}

export function subscribeQuestSystemEnabled(listener: (enabled: boolean) => void): () => void {
  return setting.subscribe("quest", (value) => listener(value === true));
}

export function whenQuestSettingsReady(listener: () => void): () => void {
  return setting.whenReady(listener);
}
