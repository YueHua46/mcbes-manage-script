# 命令参考

本页作为游戏命令的统一索引。当前已整理的自定义维度命令如下：

```text
/yuehua:dimension add <别名> <维度ID> [显示名称]
/yuehua:dimension add_here <别名> [显示名称]
/yuehua:dimension list
/yuehua:dimension info <别名>
/yuehua:dimension current
/yuehua:dimension remove <别名>
/yuehua:dimension rename <别名> <新显示名称>
/yuehua:dimension reset <custom1至custom5>
/yuehua:dimension_setspawn <别名> <x> <y> <z>
/yuehua:dimension_setspawn_here <别名>
/yuehua:dimension test <别名>
/yuehua:dimension_tp <玩家选择器> <别名> [x y z]
```

后续新增或修改自定义命令时，应在同一个 PR 中同步更新本页，包括权限要求、参数、示例和适用构建变体。