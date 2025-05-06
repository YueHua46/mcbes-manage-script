import { ActionFormData } from "@minecraft/server-ui";
import { Player, RawMessage } from "@minecraft/server";

function createErrorForm(title: string | RawMessage, body: string | RawMessage) {
  const form = new ActionFormData();
  form.title(title);
  form.body(body);
  form.button("返回");
  return form;
}

function openDialogForm(
  player: Player,
  err: { title: string | RawMessage; desc: string | RawMessage },
  cb?: () => void
) {
  const form = createErrorForm(err.title, err.desc);
  form.show(player).then(() => {
    cb && cb();
  });
}

function openConfirmDialogForm(
  player: Player,
  title: string,
  desc: string,
  acceptCb: () => void,
  cancelCb?: () => void
) {
  const form = new ActionFormData();
  form.title(title);
  form.body(desc);
  form.button("取消", "textures/icons/deny.png");
  form.button("确认", "textures/icons/accept.png");
  form.show(player).then((res) => {
    if (res.canceled || res.cancelationReason) return;
    res.selection === 1 && acceptCb();
    res.selection === 0 && cancelCb && cancelCb();
  });
}

export { openDialogForm, openConfirmDialogForm };
