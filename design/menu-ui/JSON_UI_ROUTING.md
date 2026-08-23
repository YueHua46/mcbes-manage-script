# JSON UI 表单互斥路由契约

## 目的

本项目需要让不同的 Script API `ActionFormData` 使用不同 JSON UI：

- `/CMROOT `：苦力怕菜单的拼图主界面。
- `/CMFORM `：项目内其他 ActionForm 的统一纵向卡片界面。
- `/CMMESSAGE `：项目内 MessageForm 的统一双按钮消息界面。
- `/CMMODAL `：项目内 ModalForm 的统一暖色表单控件界面。
- 无上述前缀：Minecraft 原生表单、其他附加包表单、JavaScript REPL、箱子和熔炉专用界面。

这套机制称为**按标题命名空间路由的互斥表单渲染**。标题前缀既是 SAPI 与资源包之间的协议，也是 JSON UI 的路由键，不是面向玩家显示的普通标题内容。

## 数据流

```text
SAPI 创建一个 ActionFormData
          |
          v
标题加 /CMROOT、/CMFORM 或 /CMMESSAGE 前缀
          |
          v
server_form_factory 生成 long_form_router
          |
          v
每个 form_type 实例直接绑定 #title_text
          |
          +-- /CMROOT 区间 --> creeper_menu.root
          |
          +-- /CMFORM 区间 --> creeper_menu.generic_long_form
          |
          +-- /CMMESSAGE 区间 --> creeper_message.form
          |
          +-- 均不命中 -----> Minecraft 原生 long_form
```

任何时刻只能有一个分支可见。

## 正确的 factory 结构

`resource_packs/CreeperMenu/ui/server_form.json` 必须向 `main_screen_content.controls` 的前端插入真正的 factory 控件：

```json
{
  "server_form_factory": {
    "type": "factory",
    "control_ids": {
      "long_form": "long_form_router@creeper_menu.long_form_router",
      "custom_form": "custom_form_router@creeper_modal.custom_form_router"
    }
  }
}
```

不要改成 `type: "panel"` 后再嵌套一个 `factory` 对象。那种结构不能保证 Bedrock 按预期建立表单工厂及其绑定上下文。

## 正确的互斥路由结构

`long_form_router` 只负责实例化路由。每个实例提供自己的标题区间和内容：

```json
{
  "main_menu@creeper_menu.form_type": {
    "$min": "/CMROOT ",
    "$max": "/CMROOT 􀐏",
    "$content": "creeper_menu.root"
  }
},
{
  "project_action_form@creeper_menu.form_type": {
    "$min": "/CMFORM ",
    "$max": "/CMFORM 􀐏",
    "$content": "creeper_menu.generic_long_form"
  }
},
{
  "project_message_form@creeper_menu.form_type": {
    "$min": "/CMMESSAGE ",
    "$max": "/CMMESSAGE 􀐏",
    "$content": "creeper_menu.message_form"
  }
}
```

共享的 `form_type` 必须在实例自身绑定标题并决定可见性：

```json
{
  "form_type": {
    "type": "panel",
    "visible": false,
    "bindings": [
      { "binding_name": "#title_text" },
      {
        "binding_type": "view",
        "source_property_name": "(#title_text = $min) or (#title_text > $min and #title_text < $max)",
        "target_property_name": "#visible"
      },
      {
        "binding_type": "view",
        "source_property_name": "(#title_text - $min)",
        "target_property_name": "#title"
      }
    ],
    "controls": [{ "content@$content": {} }]
  }
}
```

末尾的高位私用字符 `􀐏` 是标题命名空间的上界。普通中文、英文和数字标题均位于前缀与该上界之间。新增路由时必须分配不同的前缀，不能让两个区间相交。

## 为什么旧实现会重叠

旧实现让两个子路由通过 `source_control_name` 去读取父级或 factory 运行时控件中的 `#title_text`。Bedrock JSON UI 中，factory 实例化后的控件名和绑定作用域并不等同于静态 JSON 层级；跨层绑定可能读不到预期实例，导致两个 `#visible` 状态未被可靠、互斥地刷新。

这种错误通常不会产生 JSON UI 日志，因为 JSON 语法和绑定表达式本身仍然合法。它的表现是：

- 主菜单同时出现宽拼图面板和窄纵向面板；
- 出现两个边框、标题或关闭按钮；
- 主菜单背后出现来源不明的黑色背景；
- 进入子功能后，拼图主菜单仍用当前子菜单按钮集合继续渲染。

以上现象意味着**同一个表单 factory 内的多个自定义分支同时可见**，并不等同于 SAPI 调用了两次 `show()`。

## 禁止的实现方式

- 不要在父路由绑定一次 `#title_text`，再让子路由跨控件读取它。
- 不要用 `source_control_name: "long_form"` 或 `source_control_name: "long_form_router"` 控制路由可见性。
- 不要为根菜单和子菜单分别复制两套含糊的“字符串包含前缀”判断。
- 不要让 `/CMROOT`、`/CMFORM` 和 `/CMMESSAGE` 共用同一个前缀或相交的字典序区间。
- 不要在 JSON UI 重叠尚未排除前，先通过 SAPI 延迟、多次关闭或重复 `show()` 来掩盖问题。
- 不要只检查源码；本地部署后还要确认游戏加载目录中的 JSON 与源码一致。

## 新增第三种表单 UI

1. 为其分配唯一标题前缀，例如 `/CMNOTICE `。
2. 在 SAPI 包装器中统一添加该前缀，不要让业务表单自行拼接。
3. 在 `long_form_router` 中新增一个 `creeper_menu.form_type` 实例。
4. 使用 `/CMNOTICE ` 到 `/CMNOTICE 􀐏` 的区间，指定唯一 `$content`。
5. 更新原生 `long_form` 的可见性判断，使该前缀隐藏原生面板。
6. 添加测试，验证所有路由前缀和区间唯一且互不相交。
7. 分别在根菜单、目标子菜单和无标记原生表单中进行游戏内验证。

## 修改与排错清单

- SAPI 每次用户操作是否只调用一次目标表单的 `show()`？
- 当前标题是否准确使用 `/CMROOT `、`/CMFORM ` 或 `/CMMESSAGE `？
- factory 是否为直接的 `type: "factory"`？
- 每个 `form_type` 是否自行绑定 `#title_text`？
- 所有 `$min`/`$max` 是否唯一且不相交？
- 自定义路由命中时，原生 long form 是否隐藏？
- 无标记表单是否仍走原生 UI？
- `node --test tests/creeper-menu-json-ui.test.cjs` 是否通过？
- 构建后的资源包是否确实包含当前 JSON？

当前正确实现以以下文件及其测试为准：

- `resource_packs/CreeperMenu/ui/server_form.json`
- `resource_packs/CreeperMenu/ui/creeper_menu.json`
- `resource_packs/CreeperMenu/ui/creeper_message.json`
- `scripts/ui/creeper-action-form.ts`
- `scripts/ui/creeper-message-form.ts`
- `scripts/ui/forms/server/index.ts`
- `tests/creeper-menu-json-ui.test.cjs`

## MessageFormData 的唯一渲染入口

项目消息必须通过 `scripts/ui/creeper-message-form.ts` 创建。该包装器保留 MessageFormData 的
`title/body/button1/button2/show` 外观，但底层必须使用已验证会进入并行 JSON UI factory 的
`ActionFormData` 创建双按钮表单；不得直接实例化原生 `MessageFormData`。包装器统一添加
`/CMMESSAGE `，再由
`creeper_menu.long_form_router` 中独立的 `project_message_form@creeper_menu.form_type` 路由到
同命名空间的 `creeper_menu.message_form`。该控件再通过静态继承
`message_form@creeper_message.form` 接入独立消息 UI。不得让通用的 `content@$content`
直接动态跨命名空间解析消息控件。

`_ui_defs.json` 必须先注册 `creeper_message.json`，再注册引用它的 `creeper_menu.json`；禁止让
`message_form@creeper_message.form` 成为尚未定义的跨文件前向引用。

Message 路由必须同时满足两层互斥：

- 新增 factory 内，只有 `/CMMESSAGE ` 到 `/CMMESSAGE 􀐏` 的区间能够显示主题 Message UI；
- 原版 factory 的最终 `long_form@common_dialogs.main_panel_no_buttons` 节点必须排除
  `/CMMESSAGE `，与排除 `/CMROOT `、`/CMFORM ` 的方式完全一致。

双按钮仍使用原生 `form_buttons` 集合和 `button.form_button_click`：`button1` 固定绑定
`collection_index: 0`，`button2` 固定绑定 `collection_index: 1`。不得交换索引，也不得为了
换皮在脚本侧重写 `MessageFormResponse.selection`。ActionFormResponse 与 MessageFormResponse
在项目使用的 `canceled`、`cancelationReason`、`selection` 字段上保持同构，包装器直接透传响应。
无 `/CMMESSAGE ` 标记的游戏或其他附加包
MessageForm 继续只显示原版 long form。

## ModalFormData 的唯一渲染入口

`main_screen_content.modifications` 使用 `insert_front` 新增的 factory 不会替换原版
`server_form_factory`，两者会同时收到同一个表单数据。这一点与主菜单完全相同：新增
factory 的 `long_form` 指向 `creeper_menu.long_form_router`，`custom_form` 指向
`creeper_modal.custom_form_router`；原版 factory 仍分别实例化 `@server_form.long_form` 和
`@server_form.custom_form`。

互斥不能只在新增 factory 内部实现，必须像 `/CMROOT`、`/CMFORM` 一样同时关闭原版
factory 的最终渲染节点：

- `creeper_modal.custom_form_router` 只在标题位于 `/CMMODAL ` 到 `/CMMODAL 􀐏` 的区间时渲染主题表单。
- 原版 factory 使用的 `server_form.custom_form` 只包含原生与 REPL 渲染器，不得再包含主题分支。
- `native_custom_form@server_form.native_custom_form` 必须在自身实际渲染节点上以 global
  `#title_text` 排除 `/CMMODAL ` 和 `JavaScript REPL`。
- multiline renderer 只在 global 标题精确等于 `JavaScript REPL` 时可见。

这与主菜单在 `long_form@common_dialogs.main_panel_no_buttons` 上排除 `/CMROOT`、`/CMFORM`
是同一个模式。禁止把主题 Modal、原生 Modal 和 REPL 都塞入原版 factory 的一个
`custom_form_switch` 后仅靠子节点互斥；该结构仍可能让原版 renderer 与主题 renderer
同时收到并绘制同一份 `custom_form` 集合。

新增 factory 与原版 factory 会各自实例化 custom-form 数据，但任何标题只能有一边的
最终渲染节点可见；否则会出现开关、标签、输入框、边框和关闭按钮成对重叠。
项目代码必须通过 `scripts/ui/creeper-modal-form.ts` 创建 ModalFormData，避免主题资源包
接管其他附加包或游戏自身的 custom form。
