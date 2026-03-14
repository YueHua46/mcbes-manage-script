/**
 * MessageFormData 双按钮结果辅助
 *
 * 适用于 @minecraft/server-ui 的 MessageFormData.show() 返回的 MessageFormResponse：
 * - button1（第一个按钮）→ selection = 0
 * - button2（第二个按钮）→ selection = 1
 *
 * 统一通过这里封装，避免业务代码里反复手写 magic number。
 */

export const MESSAGEBOX_TOP_BUTTON_SELECTION = 0;
export const MESSAGEBOX_BOTTOM_BUTTON_SELECTION = 1;

export interface MessageBoxSelectionLike {
  selection?: number;
}

export function isMessageBoxTopButton(result: MessageBoxSelectionLike | null | undefined): boolean {
  return result?.selection === MESSAGEBOX_TOP_BUTTON_SELECTION;
}

export function isMessageBoxBottomButton(result: MessageBoxSelectionLike | null | undefined): boolean {
  return result?.selection === MESSAGEBOX_BOTTOM_BUTTON_SELECTION;
}
