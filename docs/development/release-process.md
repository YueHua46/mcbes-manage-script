# 发布流程

1. 更新 `package.json`、行为包与资源包 manifest、启动日志中的版本号。
2. 将用户可见变化整理到 `CHANGELOG.md`。
3. 执行：

```bash
npm ci
npm run lint
npx tsc --noEmit
npm run build
npm run build:bds-admin
npm run mcaddon:all
```

4. 在测试世界验证普通兼容版，并在 BDS 环境验证增强版。
5. 检查旧世界升级、动态属性、资源包缓存和数据兼容性。
6. 创建版本标签与 GitHub Release。
7. Release 同时附上普通兼容版和 BDS 增强版 `.mcaddon`，并明确支持的 Minecraft 版本、升级注意事项和已知限制。

在自动发布流程稳定前，Release 保持人工确认，避免错误构建直接进入生产服务器。