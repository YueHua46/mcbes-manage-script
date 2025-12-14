/**
 * 对话框UI组件
 */

import { ActionFormData } from "@minecraft/server-ui";
import { Player, RawMessage } from "@minecraft/server";

/**
 * 创建错误提示表单
 */
function createErrorForm(title: string | RawMessage, body: string | RawMessage): ActionFormData {
  const form = new ActionFormData();
  form.title(title);
  form.body(body);
  form.button("返回");
  return form;
}

/**
 * 打开对话框
 * @param player 玩家
 * @param err 错误信息
 * @param cb 回调函数
 */
export function openDialogForm(
  player: Player,
  err: { title: string | RawMessage; desc: string | RawMessage },
  cb?: () => void
): void {
  const form = createErrorForm(err.title, err.desc);
  form.show(player).then(() => {
    cb && cb();
  });
}

/**
 * 打开确认对话框
 * @param player 玩家
 * @param title 标题
 * @param desc 描述
 * @param acceptCb 确认回调
 * @param cancelCb 取消回调
 */
export function openConfirmDialogForm(
  player: Player,
  title: string,
  desc: string,
  acceptCb: () => void,
  cancelCb?: () => void
): void {
  const form = new ActionFormData();
  form.title(title);
  form.body(desc);
  form.button("取消", "textures/icons/deny");
  form.button("确认", "textures/icons/accept");

  form.show(player).then((res) => {
    if (res.canceled || res.cancelationReason) return;
    res.selection === 1 && acceptCb();
    res.selection === 0 && cancelCb && cancelCb();
  });
}
