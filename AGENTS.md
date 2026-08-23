# AI 协作约束

修改本项目代码前，请遵守受影响目录中的现有契约和测试。涉及菜单资源包、`ActionFormData` 包装器或 `server_form.json` 时，必须先阅读：

- [`design/menu-ui/JSON_UI_ROUTING.md`](design/menu-ui/JSON_UI_ROUTING.md)
- [`design/menu-ui/README.md`](design/menu-ui/README.md)
- [`tests/creeper-menu-json-ui.test.cjs`](tests/creeper-menu-json-ui.test.cjs)

## JSON UI 路由是不可破坏的运行时契约

苦力怕菜单使用“按标题命名空间路由的互斥表单渲染”。根菜单标题以 `/CMROOT ` 开头，项目子表单标题以 `/CMFORM ` 开头。一个运行时表单只能命中一个自定义 UI 路由。

必须保持以下规则：

1. `server_form_factory` 必须是直接插入 `main_screen_content.controls` 的原生 `type: "factory"` 控件。
2. 每个路由实例必须通过共享的 `creeper_menu.form_type` 自己绑定 `#title_text`。
3. 可见性必须使用互不重叠的 `$min`/`$max` 标题区间判断。
4. 不得通过 `source_control_name` 跨父子控件读取 `#title_text` 来控制路由可见性。
5. 不得使用两个独立的“包含前缀”表达式充当互斥路由。
6. `/CMROOT` 只渲染拼图主菜单；`/CMFORM` 只渲染纵向子菜单；无标记表单继续使用原生 UI。
7. 修改路由后至少运行 `node --test tests/creeper-menu-json-ui.test.cjs`；提交前运行 `npm test`。
8. 项目 ModalForm 必须复用主菜单已经验证的双 factory 互斥模式：新增 factory 的 `custom_form` 指向 `creeper_modal.custom_form_router`，原版 factory 继续使用 `server_form.custom_form`。主题路由只渲染 `/CMMODAL `；原版 `native_custom_form@server_form.native_custom_form` 必须在实际 `common_dialogs` 渲染节点上通过 global `#title_text` 排除 `/CMMODAL ` 和 JavaScript REPL，REPL renderer 只匹配精确标题。不得把主题、原生和 REPL 再混入原版 factory 的同一个 `custom_form_switch`。

如果画面同时出现两个边框、两个关闭按钮、主菜单背后有窄列表，或进入子菜单后拼图仍存在，应首先判定为 JSON UI 路由同时可见，而不是先归因于 SAPI 重复调用、缓存或打包失败。
