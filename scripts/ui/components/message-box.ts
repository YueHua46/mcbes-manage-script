/**
 * MessageBox 相关辅助工具
 *
 * 在当前运行环境中：
 * - 顶部按钮返回 selection = 1
 * - 底部按钮返回 selection = 0
 *
 * 统一通过这里封装，避免业务代码里反复手写 magic number。
 */

export const MESSAGEBOX_TOP_BUTTON_SELECTION = 1;
export const MESSAGEBOX_BOTTOM_BUTTON_SELECTION = 0;

export interface MessageBoxSelectionLike {
  selection?: number;
}

export function isMessageBoxTopButton(result: MessageBoxSelectionLike | null | undefined): boolean {
  return result?.selection === MESSAGEBOX_TOP_BUTTON_SELECTION;
}

export function isMessageBoxBottomButton(result: MessageBoxSelectionLike | null | undefined): boolean {
  return result?.selection === MESSAGEBOX_BOTTOM_BUTTON_SELECTION;
}
