# CreeperMenu 全屏 JSON UI

这一版借鉴 DogeUI 的高级卡片拼图信息架构，但不复用它的素材。所有功能场景图、暗绿品牌背景、按钮状态和布局都为苦力怕菜单单独设计。

## 视觉与交互约束

- 左侧为 3×3 非等宽功能拼图，右侧为菜单道具、悬浮文字、帮助和服务器设置快捷区。
- 13 个卡片索引与 `scripts/ui/forms/server/index.ts` 保持固定契约；关闭的模块和无权限入口保留空槽，不会导致后续按钮错位。
- 每个卡片使用独立像素场景图，文字由 JSON UI 实时绘制，不烘焙进素材。
- 默认、悬停、按下均有独立九宫格背景；鼠标、触屏和手柄共用同一点击映射。
- 只有带路由标记的苦力怕主菜单使用全屏 UI，其他服务器表单保持兼容。

## 素材来源与重建

- `source/creeper-feature-atlas-imagegen.png`：使用内置 ImageGen 生成的 4×4 原创像素素材母版。
- `build.py`：切分透明卡片图、生成九宫格状态纹理和 `preview.png`。
- `preview.png` / `submenu-preview.png`：主菜单拼图和通用子菜单的设计预览。

```powershell
python design/menu-ui/build.py
```
