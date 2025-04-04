import { world } from '@minecraft/server'
import { openServerMenuForm } from '../Modules/Forms/Forms'

world.afterEvents.itemUse.subscribe(event => {
  const { itemStack, source } = event
  if (itemStack.typeId.includes('yuehua:sm')) {
    openServerMenuForm(source)
  }
})
