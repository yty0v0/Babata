## Why

BreachWeave 当前的挑战记录、共享记忆、运行态与覆盖状态主要依赖 JSON 文件和内存态，模型可以通过 Host Bridge 直接写入共享事实，缺少版本化事实层、审计链、提案治理、崩溃恢复和覆盖语义。接入 Taric 可以引入权威 Engagement 记忆、提案/准入分离、证据引用、WorkRun/Checkpoint 与 Artifact 治理，但必须先补齐 BreachWeave 的身份、审计与授权边界，避免把现有“模型直写事实层”的通道平移到新的权威状态库。

## What Changes

- 新增 Taric 独立容器部署与环境闸门：只使用 Linux 容器、named volume 和 Node 22，Windows 宿主只保留 BreachWeave/Bun。
- 新增分角色 Host Bridge 安全边界：planner/executor/observer 等 solver 身份由宿主构造，模型自报身份无效；请求具备 action 白名单、限流、超时、审计和 challenge/engagement 绑定校验。
- 新增只读 Taric 黑板：模型只能读取 scoped Context Pack、证据和资源查询结果，不能调用权威写入、admission、WorkRun 或 Artifact 管理操作。
- 新增角色化提案通道：模型只能提交类型化 `work_item` / `claim` / `checkpoint` / `correction` 提案，无法自定准入结果或 trust level；宿主负责权威写入与准入。
- 新增 Web UI 提案审核与 HITL L1 准入流程，默认 `hitl_l1`，稳定后再考虑 `auto_l1`。
- 新增 WorkRun / Checkpoint / Artifact 集成：宿主负责调度与授权，Taric 负责 lease、generation、恢复元数据与 opaque Artifact 引用；原文不进入模型视图。
- 新增覆盖状态兼容投影：保留现有 `scanned`，增加 `coverage_state` / `coverage_reason` / Taric 引用字段，避免双完成判定。
- 新增 Taric 不可用或 `tch.taric.enabled=false` 时的一键回滚：现有 JSON/ChallengeManager 路径继续可用。
- **BREAKING**：模型不再被允许直接调用 `challenge_memory_add` 添加权威共享事实；该路径在 Taric 启用后改为提案治理。
- **BREAKING**：Taric 启用后的资产完成语义不再只由 `scanned: boolean` 决定，而以兼容投影 + 覆盖状态为准。

## Capabilities

### New Capabilities

- `taric-runtime-gateway`: Taric 容器部署、配置、环境闸门、健康检查、持久化卷和降级回滚。
- `host-bridge-security`: Host Bridge 的 solver 角色身份、授权、审计、限流、超时和 challenge/engagement 绑定。
- `taric-read-board`: 模型侧 scoped 只读黑板查询与 Context Pack、证据、资源读取。
- `taric-proposal-governance`: 类型化提案、角色化 principal、outbox 重放、HITL 准入和审计。
- `taric-work-recovery`: WorkRun、Attempt/generation、lease、checkpoint 与崩溃恢复。
- `taric-artifact-store`: 工具输出原文的 Artifact 引用、分片上传、脱敏/保留边界和只授权读取。
- `coverage-state-projection`: 五态覆盖状态、`scanned` 兼容投影和完成判定。
- `taric-observability`: host.state 轮询、audit.doctor、审计查询、故障降级和回归验证。

### Modified Capabilities

- 无。当前仓库尚无已归档 OpenSpec 规格，本变更全部以新能力规格建立。

## Impact

- 主要影响 `packages/core` 的 Runtime/Host Bridge/Challenge/Config 注册链路，`packages/ui-web` 的服务端与提案审核 UI，以及内置 prompt/tool 白名单。
- 新增部署依赖：Docker、Node 22 容器、Taric named volume、TCP loopback sidecar 与分角色 token；不把 Taric authority 数据挂载到 NTFS。
- 集成参考：`Taric-main` 的 Core API、agent integration 与 API boundary 文档；实施顺序遵循 `Taric接入BreachWeave二开方案-v2.md` 的 P0 → P0.5 → P1a → P1b → P2 → P3 → P4 → P5 闸门。
- 现有 JSON 投影保留为 UI/运行态投影，单向从 Taric 权威事实层同步，可重建；`tch.taric.enabled=false` 时回退原有路径。
