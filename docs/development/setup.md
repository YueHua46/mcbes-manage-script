# 开发环境

## 要求

- Node.js 18+
- npm
- Minecraft Bedrock 1.26.x 测试环境
- 测试 BDS 增强版时需要 BDS 环境

## 初始化

```bash
npm install
```

## 本地检查

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run build:bds-admin
```

## 打包

```bash
npm run mcaddon
npm run mcaddon:bds
npm run mcaddon:all
```

## 本地部署

```bash
npm run local-deploy
npm run local-deploy:bds
```

提交 PR 前至少完成 lint、类型检查和两个构建变体。涉及游戏行为时，还应说明实际测试世界、Minecraft 版本和验证步骤。