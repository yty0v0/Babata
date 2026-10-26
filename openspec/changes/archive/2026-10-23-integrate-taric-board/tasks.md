## 1. P0 环境闸门（不改业务代码）

- [x] 1.1 调研并记录本机 Docker daemon、Docker endpoint、named volume 与镜像构建权限，形成可重复的部署命令和诊断输出。
- [x] 1.2 在 Taric-main 基线执行 `npm ci`、`npm run typecheck`、`npm run build`、`npm test`，并固定可用的 Taric commit 与构建产物。
- [x] 1.3 编写多阶段 Dockerfile/构建说明：Node 22 运行层、非 root 进程、`/data/authority.sqlite`、`/data/content` named volume，禁止 NTFS bind mount。
- [x] 1.4 构建并启动最小 Taric 容器，执行 `engagement.init`、`context.build`、`audit.doctor`，记录 UUID/read_seq/doctor 输出。
- [x] 1.5 重启 Taric 容器并重复 `context.build`，验证 authority 数据、read_seq 与 content root 均未丢失。
- [x] 1.6 编写 P0 闸门报告；任一验收失败则停止后续任务并评估 Taric-lite 备选方案。

## 2. P0.5 Host Bridge 安全加固

- [x] 2.1 梳理现有 Host Bridge 请求链路、action 清单、solver 生命周期和错误返回路径，形成角色-操作矩阵。
- [x] 2.2 为 `SolverInstance` 与 startup 配置增加宿主拥有的 role 字段，确保模型请求体中的 role/source/principal_id 不被信任。
- [x] 2.3 实现 challenge → engagement binding 文件/注册表，包含 pending/active/failed 状态、scope 快照与 Taric 引用。
- [x] 2.4 实现 Host Bridge 统一响应与错误码：authorization_error、validation_error、rate_limited、timeout、unavailable、conflict/stale_version。
- [x] 2.5 实现 Host Bridge JSONL 审计：request_id、solver_id、host-owned role、action、challenge/engagement、耗时、结果、错误码。
- [x] 2.6 实现 action 级请求大小、频率、并发与超时限制，并确保超限请求不进入业务 handler。
- [x] 2.7 为无角色 solver、跨角色 action、跨 engagement、伪造身份、超限和超时编写自动化测试。
- [x] 2.8 在 `tch.taric.enabled=false` 下运行现有核心回归，确认 ChallengeManager、solver 和 Web 服务零回归；未通过则停止后续任务。

## 3. P1a 只读黑板

- [x] 3.1 设计并实现 Taric sidecar/facade 的 loopback 传输、分角色 token、健康检查和连接熔断；端口仅绑定 127.0.0.1。
- [x] 3.2 实现统一响应解包逻辑，同时校验 HTTP 状态、外层 `ok`、内层 `data.ok`，并保留 Taric 错误码与 follow_up。
- [x] 3.3 实现按 planner/executor/observer 构造 scoped model principal 的宿主映射，禁止共享全局 host principal。
- [x] 3.4 实现 `taric_board_query`、`taric_evidence_query` 等只读工具，仅暴露 context/query/resource/evidence 读操作。
- [x] 3.5 实现模型侧返回投影：L0 不进入普通召回、L1/L2 标注 trust level、证据只返回引用/摘要/hash、无原始 Artifact 字节。
- [x] 3.6 实现 Taric 停止、禁用、binding 缺失时的显式降级响应，确保现有工作流不出现未处理异常。
- [x] 3.7 更新 prompt/tool 白名单与工具启用过滤，仅注册 P1a 允许的读工具。
- [x] 3.8 编写跨 engagement、禁止写操作、降级模式、响应解包和 scoped Context Pack 的自动化测试。

## 4. P1b 角色化提案

- [x] 4.1 定义 `work_item` / `claim` / `checkpoint` / `correction` 类型化提案 schema 与校验规则，拒绝任意 board 写入。
- [x] 4.2 实现 `taric_proposal_submit` 工具与 Host Bridge handler，将模型请求映射为 scoped model principal 的 `proposal.submit`。
- [x] 4.3 确保模型提供的 accept、trust_level、reviewer attestation、principal 字段被忽略或拒绝，提案固定为 pending L0。
- [x] 4.4 设计并实现 proposal-only outbox：idempotency_key、payload、状态、重试计数、ack 时间和最后错误。
- [x] 4.5 实现 Taric 恢复后的幂等重放，处理重试、确认与 idempotency conflict；重放不产生重复提案。
- [x] 4.6 实现宿主权威写入 fail-closed 语义，确保 observation/capture/admission/work/checkpoint 失败不会被 outbox 静默排队。
- [x] 4.7 为提案 schema、越权 kind、outbox 重放、幂等冲突、fail-closed 和审计记录编写自动化测试。

## 5. P2 类型化提案审核与 HITL L1

- [x] 5.1 实现 admission 模式配置 `hitl_l1` / `auto_l1` / `disabled`，默认 `hitl_l1`，并写入 settings 与启动校验。
- [x] 5.2 实现 Web UI pending proposal 列表：类型、提案者、证据引用、scope、limitations、状态、审核结果与审计事件。
- [x] 5.3 实现授权 reviewer 审核动作，由宿主调用 `admission.evaluate`，禁止模型或 observer 自审。
- [x] 5.4 实现拒绝路径：保留 rejection 审计、原因与 pending 状态，不产生权威写入。
- [x] 5.5 实现 L0→L1 审计链和 Taric→JSON 单向投影，使 UI 与权威层状态一致且可重建。
- [x] 5.6 编写 HITL 默认模式、未审核不写入、批准/拒绝、审计链和投影重建的自动化测试。

## 6. P3 WorkRun / Checkpoint / Artifact

- [x] 6.1 将 SolverInstance 与 Host Bridge 上下文扩展为包含 workRunId、attemptId、generation、read_seq 和 lease 状态。
- [x] 6.2 实现宿主控制的 work.claim/renew/reclaim/resume 调用与本地 Runtime 状态投影，禁止模型直接调用 host work 操作。
- [x] 6.3 实现 checkpoint.propose/commit：next_steps、facts_used、open_questions 必填，宿主补充运行元数据与 read_seq。
- [x] 6.4 实现 stale attempt 隔离与 generation 校验，确保旧 generation 写入返回 stale_version/conflict。
- [x] 6.5 实现崩溃恢复流程：reclaim 旧 attempt → 新 attempt claim/resume → checkpoint 读取 → 续跑或 blocked/replan_required。
- [x] 6.6 实现 Artifact begin/append/commit 分片上传、expected hash、ordinal、total bytes 与失败清理。
- [x] 6.7 实现工具输出原文捕获：大文件/敏感输出进入 Artifact spool，模型仅获得 content_ref、hash 和 bounded summary。
- [x] 6.8 配置 Artifact ACL、保留期、脱敏/备份策略，并确保模型默认无法读取原文。
- [x] 6.9 编写并发 claim、lease 过期、stale 写入、崩溃恢复、Artifact hash 校验和原文访问控制的端到端测试。

## 7. P4 Coverage / Impact / 纠偏闭环

- [x] 7.1 定义资产覆盖五态语义：untested/blocked/negative/positive/unknown，以及 coverage_reason 与 Taric 引用字段。
- [x] 7.2 扩展 challenge asset schema 与 JSON 投影，保留 `scanned` 兼容字段但将完成判定切到 coverage state 单一语义。
- [x] 7.3 实现 Taric 覆盖提案 → admission → JSON 投影同步，支持从权威层重建 `scanned` 与 coverage 字段。
- [x] 7.4 实现 observer 异常/覆盖缺口矩阵查询，供 planner 生成纠偏与重验 WorkItem。
- [x] 7.5 实现 resource.impact 有界传播：前提失效时依赖记录降级并生成重验任务。
- [x] 7.6 建立 L2 Finding 独立 reviewer 流程，确保 observer 无法自审，高危 Finding 无独立复核不得进入 L2。
- [x] 7.7 编写覆盖兼容、完成判定、影响传播、纠偏任务和 L2 独立复核的自动化测试。

## 8. 可观测性、运维与韧性

- [x] 8.1 实现 host.state 轮询、超时熔断、1s→5s→15s 退避和健康状态投影，避免阻塞 UI。
- [x] 8.2 实现 Taric 集成状态页/接口：容器、sidecar、authority、doctor、binding、outbox、最近错误与降级原因。
- [x] 8.3 实现 audit.doctor、audit.verify 和 reconcile 的 operator-only 调用与结果记录。
- [x] 8.4 建立 `tch.taric.enabled=false` 一键回滚测试：不启动 sidecar、不注册 Taric 工具、现有 JSON 路径保持可用。
- [x] 8.5 编写集成 runbook：镜像构建、启动、停止、备份/恢复 named volume、诊断、升级和版本 pin 校验。
- [x] 8.6 建立性能与韧性基准：sidecar 延迟、host.state 轮询预算、authority 写入耗时、outbox 重放和容器重启恢复。
- [x] 8.7 建立故障注入矩阵：Taric 停止/恢复、sidecar 慢响应、Docker 重启、SQLite 锁、网络代理失效、audit drift。
- [x] 8.8 定义 P5 规模验证计划：资产数量 × solver 数 × 时长矩阵、漏报金标集和 PostgreSQL profile 再评估条件。

## 9. 发布闸门与文档归档

- [x] 9.1 汇总各阶段验收结果，生成包含 P0/P0.5/P1a/P1b/P2/P3/P4 证据的 release report。
- [x] 9.2 运行完整 `bun run typecheck`、`bun test`、核心 Web/solver 回归与 Taric 集成测试。
- [x] 9.3 审查并更新 README/DEPLOY/架构文档，明确部署边界、安全边界、回滚方式与已知限制。
- [x] 9.4 使用 OpenSpec 校验变更并归档规格，确认每个 requirement 至少有一个可追踪测试或人工验收记录。
