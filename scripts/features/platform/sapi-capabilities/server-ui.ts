/**
 * @minecraft/server-ui 扩展能力检测（CustomForm / Observable 等 preview API）。
 */

import type { Player } from "@minecraft/server";

export interface CustomFormHandle {
  label: (observable: unknown) => CustomFormHandle;
  divider: () => CustomFormHandle;
  button: (label: string, callback: () => void) => CustomFormHandle;
  show: () => Promise<void>;
  close?: () => void;
  isShowing: () => boolean;
}

export interface ObservableHandle {
  setData: (value: string) => void;
}

export interface CustomFormFactory {
  create: (player: Player, title: string) => CustomFormHandle;
}

export interface ObservableFactory {
  create: (initial: string) => ObservableHandle;
}

interface CustomFormConstructor {
  new (player: Player, title: string): CustomFormHandle;
  create?: (player: Player, title: string) => CustomFormHandle;
}

interface ObservableStringConstructor {
  new (initial: string): ObservableHandle;
}

export interface LiveFormCapabilities {
  CustomForm: CustomFormFactory;
  Observable: ObservableFactory;
}

/**
 * 检测当前运行时是否支持 CustomForm + ObservableString 实时表单。
 * 不支持时调用方应降级为 ActionFormData 等稳定 API。
 */
export async function getLiveFormCapabilities(): Promise<LiveFormCapabilities | null> {
  try {
    const ui = await import("@minecraft/server-ui");
    const CustomForm = (ui as Record<string, unknown>).CustomForm as CustomFormConstructor | undefined;
    const ObservableString = (ui as Record<string, unknown>).ObservableString as
      | ObservableStringConstructor
      | undefined;

    if (!CustomForm || !ObservableString) return null;
    return {
      CustomForm: {
        create: (player, title) =>
          typeof CustomForm.create === "function" ? CustomForm.create(player, title) : new CustomForm(player, title),
      },
      Observable: {
        create: (initial) => new ObservableString(initial),
      },
    };
  } catch {
    return null;
  }
}

export function isLiveFormAvailable(): boolean {
  // 构建期无法确定运行时 preview API；由 getLiveFormCapabilities 在运行时检测。
  return true;
}
