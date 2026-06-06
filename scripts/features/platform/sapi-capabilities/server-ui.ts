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

export interface LiveFormCapabilities {
  CustomForm: CustomFormFactory;
  Observable: ObservableFactory;
}

/**
 * 检测当前运行时是否支持 CustomForm + Observable 实时表单。
 * 不支持时调用方应降级为 ActionFormData 等稳定 API。
 */
export async function getLiveFormCapabilities(): Promise<LiveFormCapabilities | null> {
  try {
    const ui = await import("@minecraft/server-ui");
    const CustomForm = (ui as Record<string, unknown>).CustomForm as CustomFormFactory | undefined;
    const Observable = (ui as Record<string, unknown>).Observable as ObservableFactory | undefined;

    if (!CustomForm?.create || !Observable?.create) return null;
    return { CustomForm, Observable };
  } catch {
    return null;
  }
}

export function isLiveFormAvailable(): boolean {
  // 构建期无法确定运行时 preview API；由 getLiveFormCapabilities 在运行时检测。
  return true;
}
