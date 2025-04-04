import { Player, RawMessage, system, world } from '@minecraft/server'
import { color } from '../utils/color'
import { ActionFormData, MessageFormData, ModalFormData } from '@minecraft/server-ui'
import { MinecraftDimensionTypes } from '../types'

export function useGetAllPlayer() {
  return world.getAllPlayers()
}

export function useGetAllPlayerNames() {
  return world.getAllPlayers().map(player => player.name)
}

export function usePlayerByName(name: string) {
  return world.getAllPlayers().find(player => player.name === name)
}

export function useNotify(type: 'chat' | 'actionbar' | 'title', player: Player, message: string) {
  switch (type) {
    case 'chat':
      player.sendMessage(message)
      break
    case 'actionbar':
      player.onScreenDisplay.setActionBar(message)
      break
    case 'title':
      player.onScreenDisplay.setTitle(message)
      break
  }
}
interface IFormatListInfo {
  title: string
  desc: string
  list?: string[]
}
export function useFormatListInfo(infos: IFormatListInfo[]) {
  const formatInfo: RawMessage = {
    rawtext: [], // 初始化为空数组
  }

  infos.forEach(info => {
    if (info.title)
      formatInfo?.rawtext?.push({
        text: `${color.green.bold(info.title)}\n`,
      })
    if (info.desc)
      formatInfo?.rawtext?.push({
        text: `   ${color.yellow(info.desc)}\n`,
      })
    if (info?.list?.length)
      info.list.forEach(item => {
        formatInfo?.rawtext?.push({
          text: `   - ${color.green(item)}\n`,
        })
      })
  })

  return formatInfo
}

interface IFormatInfo {
  title?: string
  desc?: string
}
export function useFormatInfo(info: IFormatInfo) {
  const formatInfo: RawMessage = {
    rawtext: [],
  }
  if (info.title) {
    formatInfo.rawtext?.push({
      text: color.green.bold(info.title) + '\n',
    })
  }
  if (info.desc) {
    formatInfo.rawtext?.push({
      text: color.yellow(info.desc) + '\n',
    })
  }
  return formatInfo
}

export const useForceOpen = async (player: Player, form: ActionFormData | MessageFormData, timeout = 1200) => {
  let startTick = system.currentTick
  while (system.currentTick - startTick < timeout) {
    const response = await form.show(player)
    if (response.cancelationReason !== 'UserBusy') return response
  }
  return undefined
}

export const useItems = () => {
  const owItems = world
    .getDimension(MinecraftDimensionTypes.Overworld)
    .getEntities()
    .filter(e => e.typeId === 'minecraft:item')
  const netherItems = world
    .getDimension(MinecraftDimensionTypes.Nether)
    .getEntities()
    .filter(e => e.typeId === 'minecraft:item')
  const endItems = world
    .getDimension(MinecraftDimensionTypes.TheEnd)
    .getEntities()
    .filter(e => e.typeId === 'minecraft:item')
  const allItems = owItems.concat(netherItems).concat(endItems)
  return allItems
}
