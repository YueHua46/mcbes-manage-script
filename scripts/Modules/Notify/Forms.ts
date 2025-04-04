import { Player } from '@minecraft/server'
import { ActionFormData, ModalFormData } from '@minecraft/server-ui'
import { color } from '../../utils/color'
import { openDialogForm } from '../Forms/Dialog'
import notify from './Notify'
import { openSystemSettingForm } from '../System/Forms'

export const openAddNotifyForm = (player: Player) => {
  const form = new ModalFormData()
  form.title('添加通知')
  form.textField('通知名称', '请输入通知名称')
  form.textField('通知内容', '请输入通知内容')
  form.textField('通知间隔', '请输入通知间隔，单位为秒（默认1小时）')
  form.submitButton('确定')
  form.show(player).then(data => {
    if (data.cancelationReason) return
    const { formValues } = data
    if (formValues?.[0] && formValues?.[1]) {
      notify.createNotify({
        title: formValues[0].toString(),
        content: formValues[1].toString(),
        interval: formValues[2] ? Number(formValues[2]) * 20 : 72000,
      })
      openDialogForm(player, { title: '添加成功', desc: color.green('通知添加成功！') })
    } else
      openDialogForm(player, { title: '添加失败', desc: color.red('表单未填写完整，请填写完整！') }, () =>
        openAddNotifyForm(player),
      )
  })
}

export const openDeleteNotifyForm = (player: Player) => {
  const form = new ModalFormData()
  form.title('删除通知')
  const notifys = notify.getNotifys()
  form.dropdown(
    '选择通知',
    notifys.map(n => n.title),
  )
  form.submitButton('确定')
  form.show(player).then(data => {
    if (data.cancelationReason) return
    const { formValues } = data
    if (typeof formValues?.[0] === 'number') {
      notify.deleteNotify(notifys[Number(formValues[0])].id)
      openDialogForm(player, { title: '删除成功', desc: color.green('通知删除成功！') })
    }
  })
}

export const openUpdateNotifyForm = (player: Player) => {
  const form = new ActionFormData()
  form.title('更新通知')
  const notifys = notify.getNotifys()
  notifys.forEach(n => {
    form.button(n.title, 'textures/ui/icon_bell')
  })
  form.button('§w返回', 'textures/ui/dialog_bubble_point')
  form.show(player).then(data => {
    if (data.cancelationReason || data.canceled) return
    if (typeof data.selection === 'number') {
      const _notify = notifys[data.selection]
      const form = new ModalFormData()
      form.title('更新通知')
      form.textField('通知名称', '', _notify.title)
      form.textField('通知内容', '', _notify.content)
      form.textField('通知间隔（单位：秒）', '', (_notify.interval / 20).toString())
      form.submitButton('确定')
      form.show(player).then(data => {
        if (data.cancelationReason) return
        const { formValues } = data
        if (formValues?.[0] && formValues?.[1]) {
          notify.updateNotify(_notify.id, {
            title: formValues[0].toString(),
            content: formValues[1].toString(),
            interval: formValues[2] ? Number(formValues[2]) * 20 : 72000,
          })
          openDialogForm(player, { title: '更新成功', desc: color.green('通知更新成功！') })
        } else
          openDialogForm(player, { title: '更新失败', desc: color.red('表单未填写完整，请填写完整！') }, () =>
            openUpdateNotifyForm(player),
          )
      })
    } else if (data.selection === notifys.length) {
      openNotifyForms(player)
    }
  })
}

export const openNotifyForms = (player: Player) => {
  const form = new ActionFormData()
  form.title('通知设置')

  const buttons = [
    {
      text: '添加通知',
      icon: 'textures/ui/color_plus',
      action: () => openAddNotifyForm(player),
    },
    {
      text: '更新通知',
      icon: 'textures/ui/pencil_edit_icon',
      action: () => openUpdateNotifyForm(player),
    },
    {
      text: '删除通知',
      icon: 'textures/ui/redX1',
      action: () => openDeleteNotifyForm(player),
    },
  ]

  buttons.forEach(({ text, icon }) => form.button(text, icon))

  form.button('§w返回', 'textures/ui/dialog_bubble_point')
  form.show(player).then(data => {
    if (data.cancelationReason || data.canceled) return
    switch (data.selection) {
      case buttons.length:
        openSystemSettingForm(player)
        break
      default:
        if (typeof data.selection === 'number') buttons[data.selection].action()
        break
    }
  })
}
