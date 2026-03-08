# 杜绝熊孩服务器插件

## 介绍

杜绝熊孩服务器插件是我的世界基岩版服务器插件，支持最新1.21.70版本

## 主要功能

- 玩家传送
- 坐标传送
- 领地
- PVP系统
- 随机传送
- 回到上一次死亡地点
- 其他外观改善

## 后期计划

- 经济系统（含商店）
- 其他计划...（可在 issues 补充）

## 开发

### 前言

如果你想要帮忙贡献一份力，请确保你会一点 js 基础，如果你看不懂 ts 可直接问 AI
fork 本项目后，在做出一些修改后，提交 PR 即可，提交时确保你明确描述了你做了什么修改
欢迎大家贡献自己的一份力为我的世界基岩版服务器做出贡献

### 如何运行
1. fork 项目到你自己的仓库
2. clone 项目到本地
3. 运行 `npm install` 安装依赖
4. 运行 `npm run mcaddon` 打包项目为 mcaddon 附加包

### 更新物品 ID 映射（供服主 / 无编译环境用户）

菜单等 UI 使用的物品 typeId → 数字 ID 来自 **`scripts/assets/runtime_map.js`**（可读、未压缩）。构建会在 `dist/scripts/assets/` 下生成两个文件：

- **runtime_map.js**：纯数据，格式为 `export const runtimeMap = { "typeId": 数字, ... };`。**替换映射时只需用最新的 runtime_map.js 覆盖该文件即可，无需改 runtime-id-map.js。**
- **runtime-id-map.js**：固定包装（import runtime_map.js 并 export runtimeIdMap），请勿修改。

有编译环境时：改完 `scripts/assets/runtime_map.ts` 后执行 `npm run build` 或 `npm run build:runtime-map`，再把 `dist/scripts/assets/runtime_map.js` 覆盖到行为包内同路径。无编译环境时：直接替换行为包里的 `scripts/assets/runtime_map.js`，保持 `export const runtimeMap = { ... };` 格式即可。

## 版权
本插件遵循 MIT 协议，你可以在遵守协议的前提下自由使用本插件的代码
本插件的版权归作者所有，作者保留对本插件的所有权和最终解释权
请不要将本插件应用于商业用途，否则后果自负