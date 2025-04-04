import { Dimension, Player, Vector3, world } from '@minecraft/server'
import { ActionFormData, MessageFormData, ModalFormData } from '@minecraft/server-ui'
import { openServerMenuForm } from '../Forms/Forms'
import { RandomTp } from './RandomTp'
import server from '../Server'
import prefix from './Prefix'
import { openDialogForm } from '../Forms/Dialog'
import { color } from '../../utils/color'
import leaveMessage from './LeaveMessage'
import { useNotify } from '../../hooks/hooks'

function createServerInfoForm() {
  const form = new MessageFormData()
  form.title('§w服务器信息')
  form.body({
    rawtext: [
      { text: `§a---------------------------------\n` },
      { text: `§eTPS: §c${server.TPS}\n` },
      { text: `§e实体数量: §c${server.organismLength}\n` },
      { text: `§e掉落物数量: §c${server.itemsLength}\n` },
      { text: `§a---------------------------------\n` },
      { text: `§c腐竹留言\n` },
      { text: `§a---------------------------------\n` },
    ],
  })
  form.button1('§w刷新')
  form.button2('§w返回')
  return form
}

function openServerInfoForm(player: Player) {
  let form = createServerInfoForm()

  form.show(player).then(data => {
    switch (data.selection) {
      case 0:
        form = createServerInfoForm()
        openServerInfoForm(player)
        break
      case 1:
        openServerMenuForm(player)
        break
    }
  })
}

export function openBaseFunctionForm(player: Player) {
  const form = new ActionFormData()
  const buttons = [
    { text: '§w留言板', icon: 'textures/ui/mute_off', action: () => openLeaveMessageForms(player) },
    { text: '§w修改名称前缀', icon: 'textures/ui/icon_panda', action: () => openPrefixForm(player) },
    { text: '§w随机传送', icon: 'textures/ui/gift_square', action: () => RandomTp(player) },
    { text: '§w自杀', icon: 'textures/ui/bad_omen_effect', action: () => player.kill() },
    {
      text: '§w回到上次死亡地点',
      icon: 'textures/ui/icon_fall',
      action: () => {
        const deathData = player.getDynamicProperty('lastDeath') as string | undefined
        if (deathData?.length) {
          const death = JSON.parse(deathData) as { location: Vector3; dimension: Dimension }
          player.teleport(death.location, { dimension: world.getDimension(death.dimension.id) })
          useNotify('actionbar', player, '§a你已回到上次死亡地点！')
        } else {
          openDialogForm(player, { title: '失败', desc: color.red('未找到上次死亡地点！') })
        }
      },
    },
    { text: '§w服务器状态', icon: 'textures/ui/servers', action: () => openServerInfoForm(player) },
  ]
  form.title('§w其他功能')

  buttons.forEach((button, index) => {
    form.button(button.text, button.icon)
  })

  form.button('§w返回', 'textures/ui/dialog_bubble_point')

  form.show(player).then(data => {
    switch (data.selection) {
      case buttons.length:
        openServerMenuForm(player)
        break
      default:
        if (typeof data.selection !== 'number') return
        buttons[data.selection].action()
        break
    }
  })
}

export const openPrefixForm = (player: Player) => {
  const form = new ModalFormData()

  form.title('§w修改名称前缀')
  form.dropdown('§w选择名称前缀', ['', '', '', ''], 0)
  form.submitButton('§w确认')

  form.show(player).then(data => {
    if (data.cancelationReason) return
    const { formValues } = data
    if (formValues) {
      prefix.setPrefix(player, Number(formValues[0]))
      openDialogForm(
        player,
        {
          title: '前缀修改成功',
          desc: color.green('前缀修改成功！'),
        },
        () => openBaseFunctionForm(player),
      )
    }
  })
}

// 留言板
export const openLeaveMessageForms = (player: Player) => {
  const form = new ActionFormData()
  form.title('§w留言板')
  const buttons = [
    {
      text: '§w留言列表',
      icon: 'textures/ui/realmsStoriesIcon',
      action: () => openLeaveMessageListForm(player),
    },
    { text: '§w添加留言', icon: 'textures/ui/color_plus', action: () => openAddLeaveMessageForm(player) },
    { text: '§w删除留言', icon: 'textures/ui/redX1', action: () => openDeleteLeaveMessageForm(player) },
  ]
  buttons.forEach(({ text, icon }) => form.button(text, icon))
  form.button('§w返回', 'textures/ui/dialog_bubble_point')
  form.show(player).then(data => {
    if (data.canceled || data.cancelationReason) return
    switch (data.selection) {
      case buttons.length:
        openServerMenuForm(player)
        break
      default:
        if (typeof data.selection !== 'number') return
        buttons[data.selection].action()
        break
    }
  })
}
// 留言列表
export const openLeaveMessageListForm = (player: Player, page: number = 1) => {
  const form = new ActionFormData()
  form.title('§w留言列表')

  const lms = leaveMessage.getLeaveMessages()
  const totalPages = Math.ceil(lms.length / 10)
  const start = (page - 1) * 10
  const end = start + 10
  const currentPageMessages = lms.slice(start, end)

  form.body(`第 ${page} 页 / 共 ${totalPages} 页`)

  currentPageMessages.forEach(lm => {
    form.button(` ${lm.title}`)
  })

  let previousButtonIndex = currentPageMessages.length
  let nextButtonIndex = currentPageMessages.length
  if (page > 1) {
    form.button('上一页', 'textures/ui/arrow_left')
    previousButtonIndex++
    nextButtonIndex++
  }
  if (page < totalPages) {
    form.button('下一页', 'textures/ui/arrow_right')
    nextButtonIndex++
  }

  form.button('§w返回', 'textures/ui/dialog_bubble_point')

  form.show(player).then(data => {
    if (data.cancelationReason) return
    const selectionIndex = data.selection
    if (selectionIndex === null || selectionIndex === undefined) return

    // 当前页的留言数量
    const currentPageMessagesCount = currentPageMessages.length

    if (selectionIndex < currentPageMessagesCount) {
      // 选择的是某个留言
      openDialogForm(
        player,
        {
          title: '留言内容',
          desc: `${currentPageMessages[selectionIndex].content}\n§b留言人： §e${currentPageMessages[selectionIndex].creator}\n§b留言时间： §e${currentPageMessages[selectionIndex].time}\n`,
        },
        () => openLeaveMessageListForm(player, page),
      )
    } else if (selectionIndex === previousButtonIndex - 1 && page > 1) {
      // 选择的是“上一页”
      openLeaveMessageListForm(player, page - 1)
    } else if (selectionIndex === nextButtonIndex - 1 && page < totalPages) {
      // 选择的是“下一页”
      openLeaveMessageListForm(player, page + 1)
    } else if (selectionIndex === nextButtonIndex) {
      // 选择的是“返回”
      openLeaveMessageForms(player)
    }
  })
}

// 添加留言
export const openAddLeaveMessageForm = (player: Player) => {
  const form = new ModalFormData()
  form.title('§w添加留言')
  form.textField('标题', '', '')
  form.textField('内容', '', '')
  form.submitButton('§w确定')
  form.show(player).then(data => {
    if (data.cancelationReason) return
    const { formValues } = data
    if (formValues?.[0] && formValues?.[1]) {
      if (formValues[0].toString().length > 8)
        return openDialogForm(player, { title: '添加失败', desc: color.red('标题长度不能超过8个字符！') }, () =>
          openAddLeaveMessageForm(player),
        )
      leaveMessage.createLeaveMessage({
        title: formValues[0].toString(),
        content: formValues[1].toString(),
        creator: player.name,
      })
      openDialogForm(player, { title: '添加成功', desc: color.green('留言添加成功！') }, () =>
        openLeaveMessageForms(player),
      )
    } else {
      openDialogForm(player, { title: '添加失败', desc: color.red('表单未填写完整，请填写完整！') }, () =>
        openAddLeaveMessageForm(player),
      )
    }
  })
}
// 删除留言
export const openDeleteLeaveMessageForm = (player: Player, isAdmin: boolean = false) => {
  const form = new ModalFormData()
  form.title('§w删除留言')
  const lms = isAdmin ? leaveMessage.getLeaveMessages() : leaveMessage.getPlayerLeaveMessages(player)
  form.dropdown(
    '选择留言',
    lms.map(lm => lm.title),
  )
  form.submitButton('§w确定')
  form.show(player).then(data => {
    if (data.cancelationReason) return
    const { formValues } = data
    if (typeof formValues?.[0] === 'number') {
      leaveMessage.deleteLeaveMessage(lms[Number(formValues[0])].id)
      openDialogForm(player, { title: '删除成功', desc: color.green('留言删除成功！') }, () =>
        openLeaveMessageForms(player),
      )
    }
  })
}
