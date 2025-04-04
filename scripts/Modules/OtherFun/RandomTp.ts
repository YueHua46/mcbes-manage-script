import { Player } from '@minecraft/server'
import { useNotify } from '../../hooks/hooks'
import { MinecraftEffectTypes } from '../../types'
import setting from '../System/Setting'

// 根据两个大小参数区间，来生成随机数
export const RandomNumber = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1) + min)
}

export const RandomTp = (player: Player) => {
  const range = setting.getState('randomTpRange')
  const x = RandomNumber(-Math.abs(Number(range)), Math.abs(Number(range)))
  const z = RandomNumber(-Math.abs(Number(range)), Math.abs(Number(range)))
  let y = player.dimension.heightRange.max
  player.teleport({
    x,
    y,
    z,
  })
  const addEffects: MinecraftEffectTypes[] = [
    MinecraftEffectTypes.FireResistance,
    MinecraftEffectTypes.NightVision,
    MinecraftEffectTypes.Resistance,
  ]
  addEffects.forEach(effect => {
    player.addEffect(effect, 600, {
      showParticles: false,
      amplifier: 255,
    })
  })
  useNotify('actionbar', player, `§a你已传送到了坐标: §e${x} ${y} ${z}`)
}
