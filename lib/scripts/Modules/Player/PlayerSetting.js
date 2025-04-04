export var EFunNames;
(function (EFunNames) {
    EFunNames["TPA"] = "TPA";
    EFunNames["Chat"] = "Chat";
})(EFunNames || (EFunNames = {}));
class PlayerSetting {
    // 功能开关
    // 玩家传送和聊天功能开关
    turnPlayerFunction(funName, player, value) {
        switch (funName) {
            case EFunNames.TPA:
                player.setDynamicProperty('TPA', value);
                break;
            case EFunNames.Chat:
                player.setDynamicProperty('Chat', value);
                break;
        }
    }
}
export default new PlayerSetting();
//# sourceMappingURL=PlayerSetting.js.map