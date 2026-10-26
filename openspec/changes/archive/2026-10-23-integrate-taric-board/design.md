## Context

BreachWeave 是 Windows/Bun 宿主，当前以 JSON 文件、目录锁和内存 Runtime 管理挑战、共享记忆、资产覆盖与 solver 运行态。Taric 是独立状态与治理层，默认使用 Linux 容器内的 SQLite WAL authority、principal 权限、提案/准入分离、WorkRun/Checkpoint 与 Artifact spool。两者不能直接共享文件型 authority：Taric 的权限断言依赖 Linux 文件语义，Windows NTFS bind mount 会破坏 authority 与 cursor key 的安全假设。

现有 Host Bridge 仅通过 stdout JSON 和 `solverId` 传递请求，缺少请求级身份、角色、审计、限流、超时和 scope 校验。若直接接入 Taric，会把模型直写共享事实的问题扩展到新的权威状态库。因此本设计采用严格分阶段闸门：先验证 Taric 运行环境，再加固 Host Bridge，之后才开放只读黑板、提案、HITL 准入、WorkRun/Checkpoint/Artifact 与覆盖闭环。

## Goals / Non-Goals

**Goals:**

- Taric 独立容器部署，authority 与 content root 保存在 Docker named volume，宿主只通过 loopback HTTP sidecar 访问。
- 宿主拥有身份构造权：按 solver 角色创建 model/host/operator/reviewer principal，模型自报身份无效。
- 模型只能读 scoped Context Pack/证据/资源，或提交类型化提案；权威写入和准入由宿主/UI 完成。
- 保留现有 JSON 为 UI/运行态投影，单向从 Taric 同步，可重建。
- 支持 `tch.taric.enabled=false` 与 Taric 不可用时的降级/回滚，现有功能不因 Taric 故障阻塞。
- 建立可审计的分阶段验收：P0 环境闸门、P0.5 Host Bridge 加固、P1a 只读、P1b 提案、P2 HITL、P3 恢复与 Artifact、P4 覆盖闭环。

**Non-Goals:**

- 不迁移 BreachWeave 到 Linux，不在 Windows 上直接运行 Taric authority。
- 不让 Taric 调度模型、启动 agent、执行目标系统操作或授权高风险动作。
- 不用 PostgreSQL 多主机模式作为初始部署；P5 再评估。
- 不删除现有 JSON 存储和 ChallengeManager，也不做存量项目批量导入。
- 不在 P2 之前开放 WorkRun、Checkpoint、Artifact 或 L2 Finding 通道。
- 不把 `snapshot.import` 作为迁移入口。

## Decisions

### 1. Taric 只跑 Linux 容器，数据使用 named volume

Taric 的 authority 权限断言、SQLite WAL 和 cursor key 依赖 Linux 文件语义。Windows 宿主直接运行或 C 盘 bind mount 都会破坏安全假设。

选择：多阶段 Docker 镜像 + Node 22 运行层 + Docker named volume。

替代方案：Windows 直接运行或 NTFS bind mount，均因权限语义失效被拒绝；PostgreSQL 多主机模式被推迟，因为当前是单宿主部署且质量门槛仍需验证。

### 2. Sidecar 使用 TCP loopback，不使用 Unix socket 或全局 host principal

Windows 的 Unix socket 支持不稳定，且 Taric 自带 proxy 是固定 host principal，不适合多角色 BreachWeave solver。

选择：BreachWeave 进程内或独立 sidecar 暴露 `127.0.0.1` HTTP API，按调用方映射 principal；端口只绑定 loopback，使用分角色 token。模型侧工具只进入 Host Bridge，不持有 authority DB 或 adapter token。

替代方案：直接把 MCP 或 authority token 放进 solver 容器，被拒绝，因为会扩大敏感凭据暴露面并绕过宿主授权。

### 3. 身份由宿主和 sidecar 构造，不信请求体

Host Bridge 请求中的 `source`、`principal_id`、`role`、`accept`、`trust_level` 均不可信。宿主根据 SolverInstance 的角色和 challenge/engagement binding 构造 principal。

选择：`SolverInstance` 增加 role；startup 注入角色；sidecar 根据 token/调用方映射 principal；所有请求写审计 JSONL。

替代方案：沿用 `solverId` 或让模型声明身份，被拒绝，因为无法区分 planner/executor/observer，也无法防止越权。

### 4. 分阶段开放操作面

P1a 只开放 model 读操作；P1b 只开放 `proposal.submit`；P2 由宿主/UI 执行 admission；P3 才开放 WorkRun/Checkpoint/Artifact。每阶段有明确闸门，前一阶段失败不得进入下一阶段。

选择：先读后写、先提案后准入、先恢复后覆盖。

替代方案：一次性接入全部能力，被拒绝，因为身份边界未验证时风险过高，且失败难以定位。

### 5. Outbox 只缓冲模型提案，权威写入 fail-closed

Taric 不可用时，读操作返回降级标记；模型提案可进入 outbox 并以 idempotency key 幂等重放。宿主权威写入（observation/capture/admission/work 状态）失败必须立即失败，不得静默排队，避免 UI 与 authority 长期分叉。

选择：proposal-only outbox + idempotency key + ack 状态 + 冲突按已成功处理。

替代方案：缓冲全部写入，被拒绝，因为会掩盖权威写入失败并产生不可审计的状态漂移。

### 6. 默认 HITL L1，不默认自动准入

模型提案只能形成 L0 pending。P2 默认 `hitl_l1`，由 Web UI 审核后由宿主调用 `admission.evaluate`；`auto_l1` 作为后续可选模式。L2 Finding 必须独立 reviewer，不允许 observer 自审。

选择：HITL 优先，稳定后再评估自动准入。

替代方案：默认 `auto_l1`，被拒绝，因为会放大幻觉和错误观察进入权威记忆的风险。

### 7. 覆盖状态采用兼容投影，不双写完成判定

现有 `assets[].scanned` 保留为兼容投影；新增 `coverage_state`（untested/blocked/negative/positive/unknown）、`coverage_reason` 与 Taric 引用。完成判定统一读取新语义，`scanned` 仅作为旧投影，不参与第二套判定。

选择：单一事实语义 + 兼容字段投影。

替代方案：同时维护 `scanned` 与 CoverageCell 两套完成判定，被拒绝，因为必然产生漂移。

### 8. Artifact 原文只存引用，模型视图永不包含原始字节

工具输出、HTTP 交换、截图等原文进入 Taric Artifact spool 或宿主管理的引用，模型只拿到摘要、hash、content_ref 与授权读取入口。大文件使用分片和外部存储模式，不通过普通 JSON-RPC 大 payload 传输。

选择：原文与模型上下文分离，读取需显式授权。

替代方案：把原文嵌入报告或模型上下文，被拒绝，因为会造成上下文膨胀和敏感信息泄露。

## Risks / Trade-offs

- [Taric 环境闸门失败] → 停止后续阶段，评估 Taric-lite 或修正部署；不修改业务写入路径。
- [Host Bridge 加固不足] → P0.5 不通过则禁止接入 Taric；先补角色、审计、限流、scope 和错误码测试。
- [Docker 服务权限不稳定] → P0 使用最小 `node:22-slim` 镜像验证；不依赖 Desktop 管道细节，必要时显式配置 Docker endpoint。
- [Sidecar 成为单点] → 请求超时、熔断、降级标记与 `tch.taric.enabled=false` 回滚；现有 JSON 路径始终可用。
- [Outbox 重复提交] → idempotency key、ack 状态、重放上限与幂等冲突按成功处理。
- [双状态漂移] → Taric 为权威事实层，JSON 只做单向投影；提供重建投影和 audit.doctor 检查。
- [Artifact 含敏感内容] → named volume/ACL、保留期、脱敏策略、显式 content_read 授权；模型只读引用和摘要。
- [Taric 版本漂移] → 固定 Taric commit/镜像 digest，只依赖公开 Core operation；升级需重跑环境闸门与回归。
- [覆盖语义迁移争议] → 先新增字段并保持 `scanned` 兼容投影，完成判定统一后再移除旧依赖。
- [Windows 编码/路径问题] → 容器内使用 POSIX 路径；宿主配置显式使用 UTF-8 JSON，不把 Windows 路径写入 authority。

## Migration Plan

1. **P0 环境闸门**：构建并运行最小 Taric 容器；验证 `engagement.init`、`context.build`、`audit.doctor`、重启持久化。失败即停止。
2. **P0.5 Host Bridge 加固**：增加角色、审计、限流、超时、scope 校验和统一错误码；验证现有功能零回归。失败即停止。
3. **P1a 只读黑板**：接入 scoped 读工具与降级逻辑，不改变任何权威写入路径。
4. **P1b 角色化提案**：接入类型化提案、proposal-only outbox 与角色 principal。
5. **P2 HITL L1**：Web UI 展示 pending 提案，宿主执行 admission；默认 `hitl_l1`。
6. **P3 WorkRun / Checkpoint / Artifact**：接入 lease/generation/checkpoint 与原文引用。
7. **P4 Coverage / Impact / 纠偏**：接入覆盖五态、异常矩阵、影响传播与独立复核。
8. **P5 规模与韧性**：按需压测、故障注入、漏报金标集和 PostgreSQL profile 评估。

回滚：设置 `tch.taric.enabled=false`，不注册 Taric 工具，不启动 Facade/sidecar；现有 ChallengeManager 和 JSON 路径继续工作。Taric 容器可独立停止，named volume 保留为审计档案；outbox 标记 `rolled_back`，不再重放。

## Open Questions

- P0 通过后，Taric 镜像应固定到哪个 commit/digest，以及是否需要在 BreachWeave 仓库保存构建脚本或仅引用外部镜像？
- Sidecar 与 BreachWeave Web 服务同进程还是独立进程部署？P0.5 需要以审计和故障隔离测试结果决定。
- `auto_l1` 的启用标准需要哪些审计样本量和误报/漏报指标？
- 存量 challenge 是否需要逐个手工创建 engagement binding，还是仅新 challenge 启用 Taric？
- Artifact 保留期、加密与备份策略由宿主配置的默认值尚未确定。
