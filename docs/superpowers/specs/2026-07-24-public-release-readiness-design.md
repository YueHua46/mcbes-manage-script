# 苦力怕菜单公开发布整备设计

## 目标

将当前仓库整理为可公开发布的非商业源码项目：许可证一致、构建入口可复现、基础质量检查可运行、README 与当前功能匹配，并建立统一的苦力怕菜单品牌形象。

## 约束

- 采用 PolyForm Noncommercial License 1.0.0，禁止未经授权的商业使用。
- 完整保留游戏内 `resource_packs/CreeperMenu/textures/items/sm.png`。
- 所有 DOVA 音乐及其备份、署名记录必须保留，不删除、不替换、不改名、不重新压缩。
- 所有二次元角色资源必须保留，包括欢迎字形、设计源图、最终图、假人皮肤、实体映射和说明文档；不删除、不替换、不改名、不重新压缩。
- 不修改菜单功能图标、Backrooms 资源和其他运行时素材。
- 仅替换行为包/资源包的包图标并新增 README 品牌图。
- 仓库清理采取保守策略，只删除确认不参与运行、构建或维护的本机缓存、错误日志和重复备份。
- 不在本次公开发布整备中拆分超大业务文件。

## 发布与文档

- 根目录新增标准 PolyForm Noncommercial 1.0.0 `LICENSE`，README 不再声称 MIT。
- 新增 `THIRD_PARTY_NOTICES.md`，明确第三方音频与 Minecraft/Mojang 商标归属；第三方素材继续服从各自许可。
- README 使用“源码公开 / source-available”定位，包含非官方 Minecraft 项目声明、版本/兼容性、安装、功能、构建、测试、已知限制及完整文档入口。
- README 顶部使用苦力怕品牌横幅；真实菜单截图由维护者后续提供，不使用伪造实机图。

## 工程质量

- 将 `scripts/Events` 规范为小写 `scripts/events`，消除跨平台大小写冲突；无引用旧入口仅在确认后删除。
- 构建配置只在真正执行部署任务时要求 `BDS_SERVER_DEPLOY_PATH`，lint/build 不依赖本机部署目录。
- 提供 `.env.example`、`test`、`typecheck`、`check` 脚本和 GitHub Actions。
- 修复当前 TypeScript 错误，确保 `npm run lint`、`npm run typecheck`、`npm test` 和两种构建通过。

## 视觉系统

- 现有 `sm.png` 是不可变的中心标志，包括其黑色像素轮廓和白眼睛。
- 包图标为单层绿色主框、深绿色像素背景、少量角落装饰和克制光晕。
- README 横幅复用同一标志与配色，并以确定性排版加入项目名称。
- 品牌图不能引入二次元角色，也不能替换或重绘游戏内菜单道具。

## 验收

- Git 仅保留项目源代码、维护素材、文档和必要工具，不再跟踪 `.vs` 与错误日志；欢迎音乐备份继续保留。
- 新克隆仓库使用 Node.js 18+ 和 `.env.example` 的默认值即可运行质量检查与构建。
- 包图标在 256×256 和小尺寸预览下清晰，README 横幅在 GitHub 页面宽度下可读。
- 所有现有自动化测试通过，并新增发布整备守护测试覆盖许可证、README、脚本和品牌资源。
