import { ActionFormData } from '@minecraft/server-ui';
function createErrorForm(title, body) {
    const form = new ActionFormData();
    form.title(title);
    form.body(body);
    form.button('返回');
    return form;
}
function openDialogForm(player, err, cb) {
    const form = createErrorForm(err.title, err.desc);
    form.show(player).then(() => {
        cb && cb();
    });
}
function openConfirmDialogForm(player, title, desc, cb) {
    const form = new ActionFormData();
    form.title(title);
    form.body(desc);
    form.button('取消', 'font/images/deny.png');
    form.button('确认', 'font/images/accept.png');
    form.show(player).then(res => {
        if (res.canceled || res.cancelationReason)
            return;
        res.selection === 1 && cb();
    });
}
export { openDialogForm, openConfirmDialogForm };
//# sourceMappingURL=Dialog.js.map