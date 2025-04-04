import { system, world } from '@minecraft/server'
import { openServerMenuForm } from '../Modules/Forms/Forms'

world.beforeEvents.chatSend.subscribe(event => {
  const { sender, message } = event
  if (message === '服务器菜单') {
    system.run(() => {
      event.cancel = true
      openServerMenuForm(sender)
    })
  }
})
