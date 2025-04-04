import { Player, system, world } from '@minecraft/server'

export function oneSecondRunInterval(callback: () => void) {
  system.runInterval(callback, 20)
}

export function SystemLog(message: string | string[]) {
  return console.warn(`[System] ${Array.isArray(message) ? message.join(' ') : message}`)
}

export function debounce(fn: Function, delay: number, player: Player) {
  const key = 'debounce'
  const lastTime = Number(player.getDynamicProperty(key))
  if (lastTime && Date.now() - lastTime < delay) return
  player.setDynamicProperty(key, Date.now())
  fn()
}

export function getNowDate() {
  // 创建一个Date对象
  const date = new Date()

  // 增加8小时
  date.setHours(date.getHours() + 8)

  const year = date.getFullYear()
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${year}/${month}/${day} ${hours}:${minutes}`
}


export function getDiamensionName(dimention: string) {
  switch (dimention) {
    case 'minecraft:overworld':
      return '主世界'
    case 'minecraft:the_nether':
      return '地狱'
    case 'minecraft:the_end':
      return '末地'
    default:
      return dimention
  }
}