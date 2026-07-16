# 普通兼容版与 BDS 增强版

| 变体 | 适用环境 | 额外能力 |
|---|---|---|
| 普通兼容版 | 本地世界、Realms、BDS | 不依赖 BDS 专属模块，覆盖绝大多数功能 |
| BDS 增强版 | 仅 BDS | `asyncPlayerJoin` 进服前拦截、XUID 解析、HTTP 出站 |

普通兼容版不包含 `@minecraft/server-admin` 和 `@minecraft/server-net`，因此可以在 Realms 与普通本地世界运行。

BDS 增强版会额外加载上述模块，不能直接用于 Realms 或普通本地世界。无法确认环境时，优先选择普通兼容版。

构建命令：

```bash
npm run mcaddon
npm run mcaddon:bds
npm run mcaddon:all
```