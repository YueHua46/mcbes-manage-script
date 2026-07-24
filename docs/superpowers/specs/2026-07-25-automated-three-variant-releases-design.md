# 三版本附加包自动发布设计

## 目标与范围

为苦力怕菜单建立统一、可复现的发行流程。每次正式发行同时构建并发布三个
互斥的 CreeperMenu `.mcaddon`：

| 变体 | 面向用户的名称 | 适用环境 |
| --- | --- | --- |
| `standard` | 普通兼容版 | 本地世界、普通基岩版环境及不使用专属能力的 BDS |
| `realms` | Realms 兼容版 | Minecraft Realms，仅支持旧版实体假人 |
| `bds` | BDS 增强版 | BDS 专用服务器，包含服务器专属能力 |

独立的 Backrooms Level 0 附加包继续维护自己的版本，不读取 CreeperMenu
发行版本，也不作为本发布流程的第四个产物。

## 统一版本模型

新增机器可读的发行配置，作为 CreeperMenu 的唯一版本源。配置至少包含：

- 项目发行版本，例如 `3.2.13`；
- 精确 Minecraft 构建基线，例如 `1.26.30`。

发行版本必须同步到根 `package.json`，以及 CreeperMenu 行为包、资源包的
所有 header 和 module version。普通、Realms、BDS 与源码默认 manifest
必须完全一致。构建前的版本检查发现任意差异时立即失败，不生成 Release。

提供版本同步命令，让维护者只输入一次新版本即可更新发行配置、`package.json`
和全部 CreeperMenu manifest。同步命令只接受 `x.y.z` 三段数字版本，并在
写入后执行一致性检查。CI 只检查一致性，不在构建期间自动修复已提交的版本，
以免发布未经评审的内容。

精确构建基线用于锁定依赖和复现构建；对外兼容标签按 Minecraft 小版本族
生成。`1.26.30` 显示为 `1.26.3x`，表示适配正常的 `1.26.30` 至
`1.26.39` 系列。转换必须由工具从精确基线计算，文件名和文档不能另存一份
容易漂移的手工标签。

## 产物命名

三个发行文件使用项目版本、MCBE 兼容族和中文变体名：

```text
CreeperMenu-v3.2.13-MCBE-1.26.3x-普通兼容版.mcaddon
CreeperMenu-v3.2.13-MCBE-1.26.3x-Realms兼容版.mcaddon
CreeperMenu-v3.2.13-MCBE-1.26.3x-BDS增强版.mcaddon
```

CI 内部可继续使用稳定的英文变体 ID，GitHub Actions artifact 也可使用
ASCII 名称；最终 `.mcaddon` 文件名、Release 标题、下载说明和工作流摘要
必须使用上述中文用户名称。

Release 标题格式为：

```text
苦力怕菜单 v3.2.13（适配 MCBE 1.26.3x）
```

## CI 与 Release 触发

沿用日常 CI，并把三变体打包纳入自动化：

- pull request 和普通 branch push：运行质量检查、版本一致性检查和三个
  `.mcaddon` 打包；上传短期 Actions artifacts 供维护者验证，但不创建
  GitHub Release；
- `v*` Git tag push：执行相同质量门禁和三变体打包，全部成功后创建或更新
  对应 GitHub Release，并上传三个最终文件；
- 工作流手动触发：仅用于重新发布一个已经存在、且指向当前仓库 commit 的
  `v*` tag。它不能接受任意版本字符串，也不能绕过 tag 与版本校验。

正式发行的 tag 必须严格等于 `v` 加发行配置版本，例如配置为 `3.2.13`
时只接受 `v3.2.13`。发布 job 只在 tag 验证、质量检查和全部矩阵构建成功
后获得 `contents: write`；其他 job 保持只读权限。

使用 tag 作为显式发行决定，避免每次合并文档或 CI 修复时产生无意义 Release。
普通 CI 仍持续证明三个下载包可以从当前源码构建。

## 工作流与数据流

发布工作流按以下边界组织：

1. `verify` 检出源码、安装锁定依赖，执行版本/tag 校验和现有 `npm run check`。
2. `package` 使用 `standard`、`realms`、`bds` 矩阵，在相互隔离的 runner
   中调用各自打包命令，避免 manifest 切换互相污染。
3. 每个矩阵项检查恰好生成一个目标菜单包，读取包内 manifest，确认发行版本、
   入口脚本和变体依赖符合预期，然后重命名并上传 workflow artifact。
4. `release` 下载三个 artifact，拒绝缺失、重复或名称不符合配置的文件，
   再创建对应 GitHub Release 并上传附件。

Release 正文包含三版本选择说明、精确构建基线、兼容版本族、安装提醒及从
上一 tag 自动生成的变更记录。若 Release 已由同一 tag 创建，重跑流程应
幂等地替换同名附件，而不是创建第二个 Release。

## 构建工具边界

发行元数据工具只负责以下职责：

- 读取和校验唯一发行配置；
- 计算 `v` tag、Release 标题、MCBE `x` 兼容族和三个中文文件名；
- 检查或同步 CreeperMenu 版本；
- 校验构建目录中三个最终产物。

现有 `mcaddon:standard`、`mcaddon:realms` 和 `mcaddon:bds` 保持为单变体
底层命令。新增面向 CI/维护者的三版本发行打包入口，但不调用
`mcaddon:backrooms`。默认源码 manifest 在组合打包完成后恢复为普通兼容版；
失败时也应通过隔离构建或清理逻辑避免把其他变体 manifest 留在工作区。

## 错误处理与安全

以下情况必须让工作流失败且不创建或更新 Release：

- tag 与统一发行版本不一致；
- `package.json` 或任一 CreeperMenu manifest 版本不一致；
- Minecraft 构建基线不是三段数字，或无法推导兼容族；
- 任一变体构建、测试或包内容验证失败；
- 三个最终文件缺失、重复或名称不符合约定；
- Realms 包包含 GameTest/BDS 专属依赖；
- BDS 包缺少 BDS 专属依赖，或普通版使用了错误 manifest；
- 手动发布输入不是仓库中已存在的 `v*` tag。

工作流不使用长期个人令牌，只使用 GitHub 自动提供的短期 token；写权限仅授予
最终发布 job。PR（包括来自 fork 的 PR）绝不执行发布 job。

## 文档与维护流程

README 增加三版本下载表、中文文件名示例、统一版本更新命令和正式发布步骤：

1. 运行版本同步命令；
2. 提交并合并版本及更新日志；
3. 在该提交上创建匹配的 `vX.Y.Z` tag；
4. 推送 tag，等待 CI 自动发布；
5. 在 Release 页面检查三个中文附件。

README 同时说明 `1.26.30` 与 `1.26.3x` 的关系，避免把精确构建基线误解
为只支持一个补丁版本，也避免把 `1.26.x` 误解为整个 1.26 系列均已验证。

## 测试与验收

实施时先增加失败测试，再修改构建和 CI。至少覆盖：

1. 发行配置能生成预期 tag、标题、`1.26.3x` 标签和三个中文文件名。
2. 非三段项目版本、非三段 Minecraft 基线和未知变体会被拒绝。
3. `package.json` 与全部 CreeperMenu manifest 的 header/module version
   必须等于统一版本；Backrooms 版本不参与检查或同步。
4. tag 不匹配时发布校验失败，普通 push/PR 校验不要求 tag。
5. 三个单变体打包命令均成功，并产生名称正确的 `.mcaddon`。
6. 包内 BP/RP 版本一致；普通、Realms、BDS 使用正确 manifest 和脚本能力。
7. Realms 产物继续通过现有无 GameTest 验证。
8. 组合发行入口只产生三个 CreeperMenu 包，不包含 Backrooms。
9. GitHub Actions 对 PR/push 上传构建 artifact，但只有合法 `v*` tag 或合法
   手动重跑进入 Release job。
10. `npm run check`、三变体构建和现有 Backrooms 专项构建继续通过。

验收时在本地执行完整质量检查与三版本打包，检查最终文件名和包内 manifest；
工作流 YAML 通过静态测试锁定事件、权限、矩阵、依赖关系和 Release 门禁。
