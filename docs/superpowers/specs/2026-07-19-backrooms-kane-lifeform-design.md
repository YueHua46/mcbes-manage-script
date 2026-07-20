# Kane-style Backrooms Lifeform and Voices Design

## Canon and intent

本项目以 Kane Pixels 影像体系为主要连续性。实体采用影片中可观察到的 Lifeform 特征：远处或转角短暂显形、异常高瘦的深色人形轮廓、僵硬而快速的追击、失真人声诱饵、强烈吼叫和长臂扑抓。不得把社区推测（必然由尸体生成、精确物种、穿墙、成群、必定一击杀）写成事实。

模型、贴图、动画和声音必须原创，不直接提取或复制影片资产。内部 ID 为 `yuehua:backrooms_lifeform`，游戏中不显示血条、Boss 条或常驻名称。

Research basis:

- Kane Pixels, [The Backrooms (Found Footage)](https://www.youtube.com/watch?v=H4dGpz6cnHo)
- Kane Pixels, [Backrooms - Pitfalls](https://www.youtube.com/watch?v=0XwlWXtpaCM)
- Kane Pixels, [Backrooms - Found Footage #2](https://www.youtube.com/watch?v=sA5PxGHqpTo)
- Supplemental compatible ambience: [Wikidot Level 0](https://backrooms-wiki.wikidot.com/level-0)

## Voice phenomena

- 普通无来源人声与实体诱饵必须是两个系统。
- 普通人声首次在 3–6 分钟后出现，此后间隔 90–180 秒；声源位于视野外、隔墙、距离 28–48 格。
- 普通人声表现为两人含混讨论、熟悉语气呼唤、短促求助或墙后低语。玩家接近到 7–10 格时，70% 消失、20% 转移至另一条走廊、10% 才有资格成为 Lifeform 诱饵。
- 绝大多数人声永远没有实体来源，不能让玩家把声音当作可靠刷怪预警。
- 不读取玩家麦克风、不克隆真实玩家或熟人的声音；所有音频为原创合成或本地 TTS 后处理。

## Encounter frequency

- 玩家进入本次 Backrooms session 至少 8 分钟且探索至少 12 个唯一 64×64 区域后才有资格。
- 每 20 秒进行一次确定性判定，初始概率 2.5%，每次落空增加 0.5%，上限 8%。
- 进入满 25 分钟或探索 35 个唯一区域后进入保底；保底仍必须等到存在合法、不可见且已加载的出生点。
- 每个 manifestation 同时最多 1 只；每名玩家每次 session 最多一次完整追击；全维度最多 4 只。
- 遭遇结束后现实时间冷却 30 分钟；重新进入后的前 3 分钟绝不生成。
- 实体绝不通过自然 spawn rules 生成，也不成群、无战利品、无经验。

## Model and materials

- 可见高度 2.70–2.85 格，碰撞箱宽 0.76、高 2.72，可通过当前四格高空间。
- 原创轮廓：极窄不对称肋笼、绞合软管般四肢、一侧更长的手臂、反曲小腿、分裂颚、背部与头部丝束；没有明确眼睛。
- 35–42 根骨骼，不超过 90 个 cubes；单张 128×128 不透明贴图。
- 颜色为炭黑、褐黑和潮湿暖黄反光，避免大面积纯黑导致暗区完全失去体积。
- 不使用透明排序、发光眼睛或粒子特效制造廉价怪物感。

## Animation completeness

必须提供并接入：

- `idle`：4–5 秒循环，肋笼呼吸、手指抽动、丝束错相摆动。
- `walk`：约 0.95 秒循环，不均匀长步、一侧手臂拖行。
- `run`：约 0.48 秒循环，前倾、长步、丝束滞后。
- `turn`：加法扭转骨盆、脊柱、颈部和头部。
- `inspect`：2.4 秒冻结审视，给予玩家识别轮廓的时间。
- `roar`：1.45 秒，先预备再展开颚与肋笼。
- `attack`：1.25 秒长臂扑抓，约 0.45 秒命中。
- `stagger`：0.55 秒，且 3 秒内不得再次硬直。
- `death`：约 1 秒，膝部先塌、脊柱折叠、丝束最后落地。

动画优先级为 `death > stagger > attack > roar > inspect > run > walk > idle`。声音关键帧不得与 SAPI 重复播放同一事件。

## Entity attributes and combat

- 生命值 48，攻击伤害 7，击退抗性 0.68，follow range 36。
- 追击速度目标 4.8–5.1 格/秒：普通步行无法逃脱，持续冲刺可以拉开距离，但走错转角会被追上。
- 使用原生 walk navigation，不能跳跃、爬墙、开门、破墙、穿墙或在玩家视野内传送。
- 使用 delayed attack：周期 1.25 秒、命中延迟约 36%。
- 不附加中毒、饥饿或长时间减速；不一击必杀。
- 没有 loot 和经验；死亡或退场后不留下可刷取资源。

## State machine

`dormant → lure → stalk → inspect → roar → chase → search → retreat`

- `dormant`：生成后至少等待一个 tick，让所有者属性写入。
- `lure`：隐藏在墙后，播放 0–3 次仅所有者能听到的人声诱饵。
- `stalk`：低速靠近，仍避免直接暴露。
- `inspect`：首次明确互相看见后冻结 2.4 秒。
- `roar`：1.45 秒无伤害攻击预警。
- `chase`：原生寻路和延迟扑抓，最长 6 分钟。
- `search`：失去视线 6 秒后巡视 10–14 秒；重新发现则恢复 chase。
- `stagger`：单次伤害至少 6 时触发，带 3 秒冷却。
- `retreat`：失去玩家、超时、玩家离开/死亡时退出；必须离开视野后才 remove。

## Spawn-site safety

- 从当前与相邻已加载区域的确定性布局中选择候选，绝不为实体主动生成新区或创建 ticking area。
- 候选欧氏距离 36–56 格、路径距离 44–96 格；必须 walkable、三格净空、地面有效、与玩家之间至少有一面逻辑墙、无直接视线。
- 距出生安全垫和出口至少 24 格，距其他玩家至少 32 格，不在 void cluster 中。
- 有界 BFS 最多评估 48 个候选，优先玩家前方侧向、暗房和死灯区域；前五名按确定性权重选择。
- 实际 spawn 前再次检查 `dimension.isChunkLoaded`、地面、净空和视线；失败则放弃本轮，不在别处强行生成。

## Audio set

- 普通幻听：`voice_discussion`、`voice_call`，类别 `ambient`。
- Lifeform：`idle`、`step_walk`、`step_run`、`inspect`、`lure`、`roar`、`attack`、`hurt`、`death`，类别 `hostile`。
- Lifeform 追逐使用间歇吼叫、干燥关节声、线缆拖动和不规则重步；不得连续循环尖叫。
- 诱饵比普通幻听稍清晰，但包含重复、异常停顿和尾音失真。

## Lifecycle and protection

- 实体使用 `minecraft:transient`，不持久化、不创建 ticking area；区块卸载即视为遭遇结束。
- 玩家 ID 放 entity dynamic property，manifestation slot 放非同步 entity property。
- 玩家离开、死亡、断线或 owner 不匹配时进入 retreat/清理。
- `protection.ts` 只对白名单 `yuehua:backrooms_lifeform` 放行，仍删除其他非玩家实体。
- 世界加载时清理缺 owner、owner 不在 Backrooms、重复 slot 或无运行期 encounter 的孤儿实体。

## Performance limits

- 遭遇资格每 400 tick 检查；活跃实体每 10 tick 审计。
- 同时最多 4 只；仅 active encounter 执行低频 LOS。
- 不用脚本逐 tick 移动实体，不做每 tick raycast，不创建实体 ticking area。
- 模型不超过 42 bones/90 cubes；一个 128×128 贴图、一个 render controller、最多三个 animation controllers。

## Verification

- JSON 资源交叉引用、几何骨骼、全部九类动画、声音 shortname 和行为事件均可解析。
- 8 分钟/12 区域前概率为零，25 分钟/35 区域后保底生效。
- 同 slot 不产生第二实体，全局上限 4，退出/死亡/卸载无孤儿。
- 出生点必须可达、墙后、已加载、有净空且不在出生垫/洞群。
- 攻击约 0.45 秒命中、1.25 秒内不重复；持续冲刺可以逃脱。
- 资源包和行为包构建无内容日志错误。
