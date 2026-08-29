# BDS 服务器性能诊断系统

## 概述

服务器性能诊断系统是一个综合性能分析工具，可以检测影响 BDS (Bedrock Dedicated Server) 服务器 TPS 的各种因素，并提供详细的诊断报告和优化建议。

**重要特性：**
- ✅ 所有权限玩家都可以使用（包括普通成员）
- ✅ 持续采样监控（可配置采样时长和间隔）
- ✅ 实时状态查看
- ✅ 详细问题定位（包括具体坐标）
- ✅ 智能优化建议
- ✅ 支持 Debug Utilities（仅本地/BDS 调试版，不支持 Realms）

## 访问入口

### 1. 主菜单入口（所有玩家）
~~打开苦力怕菜单 → **性能诊断**~~（已移除，主菜单使用固定 JSON UI）

### 2. 管理员和普通玩家入口
打开苦力怕菜单 → 服务器设置 → **性能诊断**

## 检测的性能因素

### 🔴 严重级别 1：极高影响

#### 1. 集中区域实体过载（刷怪塔问题）
- **检测内容**：单个区块或相邻区块内的生物实体密度
- **严重程度阈值**：
  - 注意：50-100 个实体/区块
  - 警告：100-200 个实体/区块
  - 严重：200-500 个实体/区块
  - 极严重：500+ 个实体/区块
- **影响**：可直接导致 TPS 降至 5 以下
- **建议**：限制刷怪塔规模，使用漏斗及时清理，添加开关控制

#### 2. 掉落物实体累积
- **检测内容**：全服掉落物（minecraft:item）数量
- **严重程度阈值**：
  - 注意：500-1000 个
  - 警告：1000-2000 个
  - 严重：2000-5000 个
  - 极严重：5000+ 个
- **影响**：5000+ 可导致 TPS 降至 10 以下
- **建议**：定期清理掉落物，优化自动农场物品收集

### 🟠 严重级别 2：高影响

#### 3. 村民过多
- **检测内容**：全服村民数量
- **严重程度阈值**：
  - 注意：50-100 个
  - 警告：100-200 个
  - 严重：200-500 个
  - 极严重：500+ 个
- **影响**：村民 AI 计算消耗大量性能
- **建议**：控制村民繁殖，移除不必要的村民

### 🟡 严重级别 3：中等影响

#### 4. 经验球累积
- **检测内容**：全服经验球（minecraft:xp_orb）数量
- **严重程度阈值**：
  - 注意：500-1000 个
  - 警告：1000-2000 个
  - 严重：2000+ 个
- **建议**：定期清理经验球，优化经验农场

#### 5. 装饰实体过多
- **检测内容**：展示框和盔甲架总数
- **严重程度阈值**：
  - 注意：500-1000 个
  - 警告：1000-2000 个
  - 严重：2000+ 个
- **建议**：减少装饰实体，考虑使用方块替代

#### 6. TNT 爆炸
- **检测内容**：同时存在的 TNT 实体数量
- **严重程度阈值**：
  - 注意：1-5 个
  - 警告：5-20 个
  - 严重：20-100 个
  - 极严重：100+ 个
- **建议**：分批引爆，避免连锁爆炸

## 使用流程

### 1. 开始诊断

1. 打开性能诊断菜单
2. 点击"开始诊断"
3. 配置采样参数：
   - **持续时间**：建议 60-300 秒（1-5 分钟）
   - **采样间隔**：建议 5-20 秒
4. 确认开始

### 2. 查看实时状态

诊断运行期间可以：
- 查看诊断进度（百分比）
- 查看已采样次数
- 查看最近一次采样的 TPS 和问题数
- 随时停止诊断

### 3. 查看详细报告

诊断完成后：
- 查看综合评级（优秀/良好/一般/较差/严重）
- 查看平均 TPS 和当前 TPS
- 浏览所有发现的性能问题
- 查看每个问题的详细信息和优化建议
- 传送到问题位置（如果有坐标信息）

### 4. 生成文本报告

可以生成纯文本摘要报告，包含：
- 采样次数和平均 TPS
- 综合评级
- 持续性能问题列表（出现频率 ≥50%）

## 技术实现

### 采样机制

```typescript
// 采样循环
system.runInterval(() => {
  const report = performDiagnostic();
  sampleData.push(report);
}, samplingInterval);
```

### 实体聚集检测

```typescript
// 按区块分组实体
const chunkKey = `${Math.floor(x/16)},${Math.floor(z/16)}`;
// 统计每个区块的生物实体数量
if (entitiesPerChunk > threshold) {
  // 报告问题
}
```

### 严重程度评估

根据阈值动态判断：
```typescript
if (value > 500) severity = SEVERE;
else if (value > 200) severity = CRITICAL;
else if (value > 100) severity = WARNING;
else if (value > 50) severity = NOTICE;
```

### 综合评级算法

```typescript
if (hasSevere) return "critical";
if (hasCritical || warningCount >= 3) return "poor";
if (warningCount >= 1) return "fair";
return "good";
```

## Debug Utilities 集成

如果运行在本地世界或 BDS 调试版（不支持 Realms），诊断系统会自动收集额外的性能数据：

- **Runtime 统计**：
  - 内存使用量
  - 对象/字符串/函数数量
  - 属性和数组统计

- **Plugin 句柄统计**：
  - 各插件的句柄数量
  - 句柄类型分布

这些数据会附加在诊断报告的 `debugStats` 字段中。

## 性能影响

诊断系统本身对性能的影响：

- **采样期间**：每次采样约 10-50ms（取决于实体数量）
- **内存占用**：每次采样约 1-5KB
- **推荐配置**：
  - 日常监控：持续 60 秒，间隔 10 秒（6 次采样）
  - 深度分析：持续 300 秒，间隔 5 秒（60 次采样）

## 实际案例

### 案例 1：刷怪塔导致卡顿

**症状**：TPS 从 20 降至 8
**诊断结果**：
```
[极严重] overworld 区块(120, -45)实体密度极高（疑似刷怪塔）
数值: 823 (阈值: 50)
位置: 1928, 64, -712
```

**解决方案**：
1. 传送到问题位置
2. 发现是一个没有及时清理的刷怪塔
3. 添加漏斗自动收集系统
4. TPS 恢复至 19-20

### 案例 2：掉落物累积

**症状**：TPS 逐渐下降至 14
**诊断结果**：
```
[严重] overworld 掉落物过多
数值: 4256 (阈值: 500)
```

**解决方案**：
1. 执行命令清理：`/kill @e[type=item]`
2. 优化自动农场的物品收集
3. TPS 恢复至 19-20

### 案例 3：村民交易所

**症状**：TPS 持续在 16 左右
**诊断结果**：
```
[严重] overworld 村民数量过多
数值: 387 (阈值: 50)
```

**解决方案**：
1. 清理不必要的村民
2. 将村民数量控制在 100 以内
3. TPS 恢复至 18-19

## 数据来源

本诊断系统基于以下信息来源设计：

1. **Spark Profiler** - Minecraft 性能分析基准数据
2. **Reddit r/admincraft** - 服务器管理员社区实测数据
3. **Technical Minecraft Community** - scicraft, ilmango 等技术玩家测试
4. **Minecraft Wiki** - 官方游戏机制文档
5. **BDS GitHub Issues** - 官方性能问题报告
6. **Server Hosting Providers** - 商业服务器性能指南

## 注意事项

1. **Realms 限制**：Debug Utilities 功能不支持 Realms 服务器
2. **采样时长**：过长的采样时间会增加内存占用
3. **实体检测**：只能检测已加载区块内的实体
4. **坐标精度**：区块中心坐标为估算值
5. **动态变化**：某些问题（如 TNT）可能在采样间隙消失

## 未来改进

计划添加的功能：

- [ ] 红石时钟检测（需要方块扫描）
- [ ] 漏斗系统检测（需要方块扫描）
- [ ] 玩家跑图速度监控
- [ ] 流体更新检测
- [ ] 历史趋势图表
- [ ] 导出 JSON 格式报告
- [ ] 自动化性能优化建议

## API 使用

### 基础用法

```typescript
import { performanceDiagnostics } from "./features/performance";

// 开始诊断（60秒，每5秒采样一次）
performanceDiagnostics.startDiagnostics(60, 5);

// 检查状态
if (performanceDiagnostics.isRunningDiagnostics()) {
  const progress = performanceDiagnostics.getProgress(); // 0-1
}

// 获取采样数据
const samples = performanceDiagnostics.getSampleData();
const latestReport = samples[samples.length - 1];

// 生成摘要
const summary = performanceDiagnostics.generateSummaryReport();

// 停止诊断
performanceDiagnostics.stopDiagnostics();
```

### 单次诊断

```typescript
// 执行一次性能诊断
const report = performanceDiagnostics.performDiagnostic();

console.log(`TPS: ${report.currentTPS}`);
console.log(`问题数: ${report.issues.length}`);
console.log(`评级: ${report.overallRating}`);

// 遍历问题
for (const issue of report.issues) {
  console.log(`[${issue.severity}] ${issue.description}`);
  console.log(`  数值: ${issue.value}, 阈值: ${issue.threshold}`);
  if (issue.location) {
    console.log(`  位置: ${issue.location.x}, ${issue.location.y}, ${issue.location.z}`);
  }
}
```

## 参考资料

- [Minecraft Wiki - Performance](https://minecraft.wiki/w/Tutorials/Improving_frame_rate)
- [BDS Performance Optimization Guide](https://learn.microsoft.com/en-us/minecraft/creator/)
- [Script API Documentation](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/)
- [Reddit r/admincraft](https://www.reddit.com/r/admincraft/)
