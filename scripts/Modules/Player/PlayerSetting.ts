import { Player } from '@minecraft/server'

export enum EFunNames {
  TPA = 'TPA',
  Chat = 'Chat',
}
class PlayerSetting {
  // 功能开关
  // 玩家传送和聊天功能开关
  turnPlayerFunction(funName: EFunNames, player: Player, value?: boolean) {
    switch (funName) {
      case EFunNames.TPA:
        player.setDynamicProperty('TPA', value)
        break
      case EFunNames.Chat:
        player.setDynamicProperty('Chat', value)
        break
    }
  }
}

export default new PlayerSetting()
