import { Player, world } from '@minecraft/server'
import { ActionFormData, ModalFormData } from '@minecraft/server-ui'
import { openServerMenuForm } from '../Forms/Forms'
import { useGetAllPlayer } from '../../hooks/hooks'
import { color } from '../../utils/color'
import PlayerSetting, { EFunNames } from './PlayerSetting'
import { openDialogForm } from '../Forms/Dialog'

// 创建传送请求表单
function createRequestTpaForm(title: string, requestPlayer: Player, targetPlayer: Player, type: 'to' | 'come') {
  const form = new ActionFormData()
  form.title(title)
  form.body({
    rawtext: [
      {
        text:
          type === 'to'
            ? `${color.green('玩家')} ${color.yellow(requestPlayer.name)} ${color.green('请求传送到你的旁边\n')}`
            : `${color.green('玩家')} ${color.yellow(requestPlayer.name)} ${color.green('请求你传送到他的旁边\n')}`,
      },
      {
        text: `${color.green('是否接受?')}`,
      },
    ],
  })
  form.button('接受', 'textures/ui/realms_green_check')
  form.button('拒绝', 'textures/ui/realms_red_x')
  return form
}
function teleportPlayer(requestPlayer: Player, targetPlayer: Player, type: 'to' | 'come') {
  if (type === 'to') {
    requestPlayer.teleport(targetPlayer.location, {
      dimension: targetPlayer.dimension,
    })
    requestPlayer.sendMessage(
      `${color.green('你已')}${color.green('传送到')} ${color.yellow(targetPlayer.name)} ${color.green('的旁边')}`,
    )
    targetPlayer.sendMessage(
      `${color.green('玩家')} ${color.yellow(requestPlayer.name)} ${color.green('已传送到你的旁边')}`,
    )
  } else {
    targetPlayer.teleport(requestPlayer.location, {
      dimension: requestPlayer.dimension,
    })
    requestPlayer.sendMessage(
      `${color.green('你已')}${color.green('传送到')} ${color.yellow(targetPlayer.name)} ${color.green('的旁边')}`,
    )
    targetPlayer.sendMessage(
      `${color.green('玩家')} ${color.yellow(requestPlayer.name)} ${color.green('已传送到你的旁边')}`,
    )
  }
}

export function openRequestTpaForm(requestPlayer: Player, targetPlayer: Player, type: 'to' | 'come') {
  const title = `${'玩家传送请求'}`
  const form = createRequestTpaForm(title, requestPlayer, targetPlayer, type)

  form.show(targetPlayer).then(data => {
    if (data.cancelationReason) {
      return requestPlayer.sendMessage(color.red('用户正处于其他UI界面！传送失败'))
    }
    switch (data.selection) {
      case 0:
        teleportPlayer(requestPlayer, targetPlayer, type)
        break
      case 1:
        requestPlayer.sendMessage(
          `${color.red('玩家')} ${color.yellow(targetPlayer.name)} ${color.red('拒绝了你的传送请求')}`,
        )
        targetPlayer.sendMessage(
          `${color.red('你已')}${color.red('拒绝了')} ${color.yellow(requestPlayer.name)} ${color.red('的传送请求')}`,
        )
        break
    }
  })
}

// 创建玩家传送表单
function createPlayerTpaForm(allPlayer: Player[]) {
  const form = new ModalFormData()
  form.title(`${'玩家传送'}`)
  form.dropdown(
    '§w选择玩家',
    allPlayer.map(player => ` ${player.name}`),
  )
  form.dropdown('§w选择传送方式', ['§w传送到玩家', '§w请求玩家传送到你'])
  form.submitButton('§w确认')
  return form
}

export function openPlayerTpaForm(player: Player) {
  const allPlayer = useGetAllPlayer()
  const form = createPlayerTpaForm(allPlayer)

  form.show(player).then(data => {
    const { formValues } = data
    if (formValues) {
      const targetPlayer = allPlayer[Number(formValues[0])]
      if (player.name === targetPlayer.name) {
        return player.sendMessage('§c不能传送到自己')
      }
      const type = Number(formValues[1]) === 0 ? 'to' : 'come'
      player.sendMessage(color.green('已发送传送请求'))
      openRequestTpaForm(player, targetPlayer, type)
    } else {
      player.sendMessage(color.red('传送请求失败'))
    }
  })
}

// 玩家操作
// 创建玩家操作表单
function createPlayerActionForm() {
  const form = new ActionFormData()
  form.title('§w玩家操作')
  form.button('§wTPA玩家传送', 'textures/ui/enable_editor')
  form.button('§w聊天栏配置', 'font/images/chat')
  form.button('§w返回', 'textures/ui/dialog_bubble_point')
  return form
}

// 打开玩家操作表单
export function openPlayerActionForm(player: Player) {
  const form = createPlayerActionForm()

  form.show(player).then(data => {
    if (data.cancelationReason || data.canceled) return
    switch (data.selection) {
      case 0:
        openPlayerTpaForm(player)
        break
      case 1:
        openChatForm(player)
        break
      case 2:
        openServerMenuForm(player)
        break
    }
  })
}

// 聊天栏配置表单
export function openChatForm(player: Player) {
  const form = new ActionFormData()
  form.title('§w聊天栏')

  const buttons = [
    {
      text: '聊天黑名单配置',
      icon: 'font/images/chatBlockText',
      action: () => openChatBlackForm(player),
    },
    {
      text: '静音聊天栏配置',
      icon: 'font/images/chatSpam',
      action: () => openMuteChatForm(player),
    },
  ]

  buttons.forEach(button => {
    form.button(button.text, button.icon)
  })
  form.button('返回', 'textures/ui/dialog_bubble_point')
  form.show(player).then(data => {
    if (data.cancelationReason || data.canceled) return
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

// 移除聊天黑名单
export function openDeleteChatBlackListForm(player: Player) {
  const form = new ActionFormData()
  form.title('§w聊天黑名单列表')
  const blackList = player.getDynamicProperty('ChatBlackList') as string | undefined
  const _blackList = JSON.parse(blackList ?? '[]') as string[]
  _blackList.forEach(name => {
    form.button(name, 'textures/ui/Friend2')
  })
  form.button('§w返回', 'textures/ui/dialog_bubble_point')
  form.show(player).then(data => {
    if (data.cancelationReason || data.canceled) return
    if (typeof data.selection !== 'number') return
    switch (data.selection) {
      case _blackList.length:
        openChatBlackForm(player)
        break
      default:
        const targetPlayer = _blackList[data.selection]
        const index = _blackList.indexOf(targetPlayer)
        _blackList.splice(index, 1)
        player.setDynamicProperty('ChatBlackList', JSON.stringify(_blackList))
        openDialogForm(player, {
          title: '删除成功',
          desc: `§a已成功将 §b${targetPlayer} §a从聊天黑名单中移除！`,
        })
        break
    }
  })
}
// 添加聊天黑名单
export function openAddChatBlackListForm(player: Player) {
  const form = new ModalFormData()
  form.title('§w添加聊天黑名单')
  const allPlayers = useGetAllPlayer()
  form.dropdown(
    '§w选择对应玩家',
    allPlayers.map(p => p.name),
  )
  form.submitButton('§w确认')
  form.show(player).then(data => {
    if (data.cancelationReason || data.canceled) return
    const { formValues } = data
    if (formValues) {
      const blackList = player.getDynamicProperty('ChatBlackList') as string | undefined
      const targetPlayer = allPlayers[formValues[0] as number].name

      if (blackList && blackList.length) {
        const _blackList = JSON.parse(blackList)
        _blackList.push(targetPlayer)
        player.setDynamicProperty('ChatBlackList', JSON.stringify(_blackList))
      } else {
        player.setDynamicProperty('ChatBlackList', JSON.stringify([targetPlayer]))
      }
      openDialogForm(player, {
        title: '添加成功',
        desc: `§a已成功将 §b${targetPlayer} §a添加到聊天黑名单中！`,
      })
    }
  })
}
// 聊天黑名单配置
export function openChatBlackForm(player: Player) {
  const form = new ActionFormData()
  form.title('§w聊天拉黑配置')
  const buttons = [
    {
      text: '§w添加聊天黑名单',
      icon: 'textures/ui/color_plus',
      action: () => openAddChatBlackListForm(player),
    },
    {
      text: '§w删除聊天黑名单',
      icon: 'textures/ui/cancel',
      action: () => openDeleteChatBlackListForm(player),
    },
  ]
  buttons.forEach(button => {
    form.button(button.text, button.icon)
  })
  form.button('返回', 'textures/ui/dialog_bubble_point')
  form.show(player).then(data => {
    if (data.cancelationReason || data.canceled) return
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
// 静音聊天栏配置
export function openMuteChatForm(player: Player) {
  const form = new ModalFormData()
  form.title('§w聊天栏')
  const isOpenChat = player.getDynamicProperty('Chat') as string | undefined
  if (isOpenChat === undefined) {
    player.setDynamicProperty('Chat', true)
  }
  const _isOpenChat = JSON.parse(player.getDynamicProperty('Chat') as string) as boolean
  form.toggle('§w是否开启聊天栏', _isOpenChat)
  form.submitButton('§w确认')
  form.show(player).then(data => {
    if (data.cancelationReason || data.canceled) return
    const { formValues } = data
    if (formValues) {
      PlayerSetting.turnPlayerFunction(EFunNames.Chat, player, formValues[0] as boolean)
      player.sendMessage(`§b已${formValues[0] ? ' §a开启 ' : ' §c关闭 '}§b聊天栏`)
    }
  })
}
