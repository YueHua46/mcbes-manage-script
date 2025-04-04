import { world } from '@minecraft/server'
import setting from '../Modules/System/Setting'

world.afterEvents.playerSpawn.subscribe(event => {
  const { player } = event
  const isFirstJoin = player?.getDynamicProperty('isFirst')
  const worldInit = world.getDynamicProperty('init')
  if (!isFirstJoin) {
    player?.setDynamicProperty('isFirst', true)
    player?.sendMessage(
      '§e欢迎你加入服务器！使用服务器菜单可以快捷执行一些服务器操作，如果你丢失了菜单，可以在聊天栏里输入：服务器菜单，然后点击功能：给予服务器菜单即可。',
    )
    player?.runCommand('give @s yuehua:sm')
  }
  if (!worldInit) {
    world.setDynamicProperty('init', true)
    setting.init()
  }
})
