# Taric 黑板接入可行性评估（恢复版）

- 生成时间：2026-10-21
- 触发说明：2026-10-21 17:01 的会话在输出最终结论时被客户端代理拦截（`Invalid function_call arguments ... EOF while parsing a string`），
  最终答复未落盘。本文件依据该会话的 rollout 记录（`~/.codex/sessions/2026/10/21/rollout-2026-10-21T17-01-38-*.jsonl`，
  243 行，含 8 条中间结论与全部工具输出）重建成文，并对关键兼容性结论重新做了本机验证。
- 结论性质：**评估 + 接入设计**，未改动任何业务代码。

---

## 0. 一句话结论

用 Taric 做"黑板 + 状态持久化"在**架构上成立、在价值上对症**，但**不能把 `@taric/core` 直接 import 进当前 Bun 进程**，
也**不能在 Windows 原生文件系统上直接跑 Taric 的 SQLite authority**（其自身的安全断言会拒绝写入）。
唯一低风险落地形态是：**Taric 作为 Linux 侧 sidecar（Docker/WSL）+ 宿主侧薄 HTTP facade + 现有 Host Bridge 扩展**，
模型侧永远只做"读 + 提案"，权威写入全部由宿主完成。

---

## 1. 当前项目的状态边界（已核实）

### 1.1 运行时事实

| 项 | 事实 |
|---|---|
| 宿主运行时 | Bun 1.4.3（`.tools\bun-windows-x64\bun.exe`），`bun` 不在 PATH |
| 本机 Node | v24.13.0 |
| Solver | Kali 容器（`tch-agent:latest`），与宿主通过 JSONL over stdio 通信 |
| 数据库 | **没有**。全部状态是 JSON 文件 |

### 1.2 持久化实现

- 根目录：`~/.tch-agent/challenge/<encodeURIComponent(id)>/`（`packages/core/src/challenge/store.ts`）。
- 挑战主记录：`challenge.json`，写入路径 `saveChallengeRecord()`（`store.ts:391`）：
  `ensureChallengeDirs` → 目录锁 → 读旧值 → 合并 `created_at` → **tmp 文件 + rename** 原子替换。
- 并发保护：`withDirectoryLock()`（`challenge/memory.ts`），`mkdir` 抢占式锁，5s 获取超时、60s 判定陈旧。
- Windows 抖动处理：rename 遇 `EPERM/EACCES` 时按 50/100/250/500/1000/2000ms 重试，最终退化为直接覆盖写。
- 共享记忆：`memory/entries/*.json`（一文件一条）+ `ideas/index.json`（单索引，读改写）。
- 运行日志：`logs/attempts/*.json`、`logs/submissions/*.json`（append-only 文件）。
- Solver 本地黑板：`<solver session>/.observer/`（`solver/board-store.ts`，命名空间固定为 `board`）。
- Observer 运行态：`.observer/state.json`、`.observer/rounds/NNNNNN.json`、`.observer/review-queue/*.json`（`observer-store.ts`）。
  这是现有代码里**最接近"黑板"的雏形**，但只服务单个 solver，跨 solver 不可见。

### 1.3 只在内存里、重启即丢的状态

- `RuntimeManager` 的 solver 表与 `SolverInstance.status`（starting/running/stopping/stopped/error）。
  `startup.json` 只存启动参数，不含运行态与进度。
- 所有定时器、后台任务（`runPlannerInBackground`、`finishChallenge` 的 `setTimeout`）、广播订阅。
- Solver 会话上下文：崩溃后**无法续跑**，只能重新拉一个 solver 从头开始。
- 挑战"进度"本身：只有 `assets[].scanned: boolean`（`store.ts` `ChallengeAssetRecord`），
  没有"未测 / 阻断 / 阴性 / 不确定"，`coverage_gaps` 在 `ingest-sub-agent-output.ts` 被折叠成标量分数。

### 1.4 唯一的写入口（关键接入点）

```
Solver 工具 (memory_add / idea_add / submit_report / get_hint)
  → requestHostBridge()  stdout 写 JSONL: {type:"host_bridge_request", request_id, action, params}
  → RuntimeManager.handleHostBridgeRequest()  (runtime.ts:326)
  → executeHostBridgeAction() 遍历 HostBridgeHandler  (runtime.ts:307)
  → createChallengeHostBridgeHandler()  (challenge/host-bridge-handler.ts:207)
  → ChallengeManager.appendMemory() / addIdea() / submitReport()
  → 文件写入 + broadcastChallengeBoardUpdateToRunningSolvers()
```

- Action 白名单只有 9 个（`challenge/host-bridge-types.ts`）：
  `challenge_get_state|get_hint|submit_report|is_completed|memory_list|memory_add|idea_list|idea_search|idea_add`。
- `memory_add` 的校验强度：**kind 枚举 + content 非空**，没有证据、没有信任级、没有准入
  （`host-bridge-handler.ts:170-179`）。
- 结论：**模型可以直写共享事实层**。这是 Taric 最能对症解决的一处。

---

## 2. Taric 的权威层与接入面（已核实）

| 接入面 | 形态 | 对本项目的意义 |
|---|---|---|
| `@taric/core` 库调用 | Node + `node:sqlite`（同步 API） | 最"薄"，但要求进同进程 → Bun 不认证 |
| CLI | `node packages/cli/dist/bin.js <operation> [json]` | 每条命令一个进程，读 stdout / `ok:false` |
| MCP (stdio) | 只有 6 个只读/提案工具，无 resources、无 notification | 天然适合"模型只读 + 提案" |
| Proxy | 认证 Unix socket，固定 host principal，`chmod 0600` | **Windows 不可直接用**（见 §3） |

- CLI 操作面很全（`packages/cli/src/cli.ts` `cliCommands`）：`engagement.init/status`、`context.build`、`query`、
  `proposal.submit/list`、`review.submit`、`admission.evaluate/promote_l2`、`capture.observation`、
  `work.claim/renew/reclaim/resume`、`checkpoint.propose/commit`、`action.*`、`artifact.*`、`audit.*`、`resource.*`。
- 身份：model 侧只有 read/propose；`capture.observation` 是 host-only；L2 必须独立 reviewer。
- 已知限制（Taric 官方文档自述）：同步 SQLite 会阻塞调用进程；无 snapshot 导入；MCP 无推送，只能轮询。
- Taric 仓库里已有一份针对本宿主的差距分析：`docs/taric-gap-analysis-breachweave-integration.md`（2026-10-16，
  2026-10-18 更新）。其结论与本评估一致，且已指出 BreachWeave"模型直写共享记忆"的结构性问题。
---

## 3. 兼容性硬约束（2026-10-21 本机实测）

这些是本轮评估中**最容易被纸面方案忽略、但会直接卡死**的点。全部在本机重新跑过。

| # | 验证项 | 命令要点 | 结果 | 影响 |
|---|---|---|---|---|
| 1 | Bun 能否 `require("node:sqlite")` | `.tools\bun-windows-x64\bun.exe -e "require('node:sqlite')"` | **OK**（Bun 1.4.3 已内置，`DatabaseSync/StatementSync/Session/backup`） | 与 Taric 文档中"Bun 不支持"的旧结论**已经不同**，需要实测复核而非照抄文档 |
| 1b | Bun 内嵌 Core 是否真能跑 | 未验证（仅验证了驱动可用） | 未知 | `require` 成功 ≠ Core 语义等价；Taric 使用 `DatabaseSync` 的自定义 wrapper 与大量 PRAGMA，需单独 conformance，不作为推荐路径 |
| 2 | Bun 打开 SQLite + WAL | `new DatabaseSync(f); PRAGMA journal_mode=WAL` | **OK**，`journal_mode=wal`，读写正常 | 技术上库内嵌不再是"绝对不可能" |
| 3 | Windows 上 Taric 的文件权限断言 | `writeFileSync(f,{mode:0o600})` 后 `stat.mode & 0o777` | **恒为 666**（Node 与 Bun 相同） | **致命**：`store.ts` `assertAuthorityWritable()` 与 `authorityDrift()` 会判定 `writable by group or other users`，**所有写操作被 conflict 拒绝**；`cursor-key.ts` 要求 `(mode & 0o777) === 0o600`，否则 `invalid_cursor`，**context.build/resume 直接不可用** |
| 4 | Windows 上 Taric 的 Unix socket | `net.listen("C:\\...\\x.sock")` | **EACCES** | proxy 不可用；不能用`\\.\pipe\...` 顶替（见 #5） |
| 5 | 命名管道能否通过 Taric 的 socket 生命周期 | `listen("\\\\.\\pipe\\x")` → `access` → `stat` → `unlink` | listen OK / access OK / **`stat.isSocket() === false`** / **`unlink` 返回 EINVAL**（`close()` 里 `unlink().catch(()=>{})` 吞掉，但 `unlink(options.socket_path).catch(cause => { if (cause.code !== "ENOENT") throw })` 在**启动阶段**会抛） | 命名管道**不是**可替换方案，验证必须落到真实 socket 语义 |
| 6 | Docker 可用性 | `docker version` | `permission denied ... dockerDesktopLinuxEngine` | 当前 shell 无 docker 权限；接入前需先解决（加 docker 用户组 / 以管理员运行 / 用 Docker Desktop 的 WSL 发行版） |

**结论**：文件权限模型（#3）是比运行时（#1/#2）更硬的阻断点，而且**只在 Windows 原生 NTFS 上出现**。
在 Linux（含 Docker Desktop 的 WSL2 发行版、Kali solver 容器）里同一份代码是正常的。

> 补充：`cursor-key.ts` 的 `0o600` 断言意味着——即便把 SQLite 文件权限问题绕过，
> 只要 authority 目录位于 NTFS 且 Node/Bun 返回 666，`context.build` 的 cursor 也会失败。
> 因此"在 Windows 宿主内嵌 Taric"这条路，无论用 Node 还是 Bun，都**不建议作为主路径**。

---

## 4. 目标架构（推荐形态）

```
┌──────────────────────────── Windows 宿主 (Bun 1.4.3) ────────────────────────────┐
│  ui-web / api                                                                    │
│  ChallengeManager（现有 JSON 存储保持不动）                                        │
│  RuntimeManager ── HostBridgeHandler[] ──┐                                       │
│                                          │  ① TaricBoardHandler（新增）            │
│                                          │     action: taric_*                    │
│                                          ↓                                       │
│                                    TaricFacade（新增，Bun 侧薄客户端）             │
│                                      · HTTP/JSON over 127.0.0.1:<port>            │
│                                      · 超时、重试、幂等键、错误映射                 │
│                                      · 本地缓存（离线降级）                        │
└──────────────────────────────────────┬───────────────────────────────────────────┘
                                       │ ② 只走 TCP loopback（不依赖 socket/权限模型）
┌──────────────────────────────────────▼───────────────────────────────────────────┐
│  Taric sidecar（Linux 容器 / WSL2 发行版，Node 22+）                               │
│   packages/core  →  SQLite WAL authority（ext4 卷，权限断言可满足）                │
│   packages/cli   →  被 facade 以进程内/短进程方式调用                               │
│   或 一个 200 行 Node HTTP 包装（推荐，避免每请求 fork）                            │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 为什么是 sidecar + HTTP，而不是内嵌

1. **绕开权限断言**：Linux ext4/overlayfs 上 `0o600` 语义成立，Taric 的 fail-closed 检查自然通过。
2. **绕开 socket**：Windows 与容器之间走 TCP loopback + token，语义简单、可观测。
3. **隔离同步阻塞**：Taric 的 SQLite 是同步的，长操作会阻塞整个进程。放进容器，卡住的是 sidecar，不是 Bun 宿主。
4. **可回滚**：facade 后面可以随时换回 CLI 直调，或换 PostgreSQL profile，宿主代码不动。
5. **CPU 架构匹配**：solver 已经在 Docker 里跑，说明本机 Docker 链路（镜像/卷/网络）是通的。

### 4.2 为什么模型侧仍然走 Host Bridge，不让 solver 直连 Taric

- Solver 在容器内，网络到宿主需要额外端口与凭据下发；而 Host Bridge 已经是一条**已认证、已审计、已限流**的通道。
- 模型只需要"读 + 提案"，宿主做 `capture.observation` / `admission` / `work.*` / `artifact.*`。
  这与 Taric 的零模型直写不变量完全一致，也顺带修掉了当前 `memory_add` 可直写共享事实层的问题。
- 权限矩阵（`方案 §5.2`）可以**在 HostBridgeHandler 里硬编码**，不依赖模型自觉。

---

## 5. 黑板分区映射（Taric 实体 ↔ 现有概念）

| 黑板分区 | Taric 实体 | 现状 | 写入方 |
|---|---|---|---|
| 规划区 | WorkItem | 无（planner 只是自由文本 prompt） | planner 提案 → 宿主 admission |
| 执行区 | WorkRun / Attempt（lease + generation） | `solver` 表（内存）+ `startup.json` | 宿主 `work.claim/renew/reclaim` |
| 观察区 | Observation / Negative / Control / AccessDecision | `challenge_memory_add(kind=evidence/fact)` | 宿主 `capture.observation` |
| 证据区 | Artifact（spool 原文）+ Evidence（引用） | `submissions/*.json` 里整段报告正文 | 宿主 `artifact.store.*` |
| 事实区 | Claim / Finding / AttackPath | `submitReport()` 一份文本 + `assets[].scanned` | 提案 → L1 → L2 独立复核 |
| 覆盖区 | CoverageCell（资源×类别×身份×操作×条件） | 布尔 `scanned` | 随观察更新 |
| 纠偏区 | Proposal(reject) / Review / Conflict / ImpactEvent | `.observer/review-queue` | observer 评审 + 宿主 impact |
| 恢复区 | Checkpoint（read_seq + manifest） | 无 | `checkpoint.propose` → `checkpoint.commit` |
| 演进区 | ResourceRevision / PatchSet | 无 | `resource.revise/patch` |

要点：**不要一次性替换现有 JSON 存储**。让 Taric 成为"权威事实层"，现有 JSON 继续作为"运行态与 UI 投影"，
两边的连接点是 Host Bridge。这样即使 Taric 侧故障，现有功能也不至于全灭。
---

## 6. 接入点清单（改哪里、加什么）

### 6.1 新增（不改现有语义）

| 文件 | 作用 |
|---|---|
| `packages/core/src/challenge/taric/facade.ts` | Taric HTTP 客户端：`query`、`proposalSubmit`、`captureObservation`、`workClaim`、`checkpoint`、`artifact*`；统一 `{ok,data,error}` 解包（注意 Taric 存在 `ok:true` + `data.ok:false` 的业务失败形态） |
| `packages/core/src/challenge/taric/handler.ts` | `HostBridgeHandler` 实现；`action` 前缀 `taric_`；**在这里硬编码角色权限**（planner/executor/observer 各自可调的子集） |
| `packages/core/src/challenge/taric/mapping.ts` | 现有 `MemoryEntry/IdeaRecord/ChallengeAssetRecord` ↔ Taric `Observation/Evidence/Claim/CoverageCell` 的双向映射 |
| `packages/core/src/challenge/taric/outbox.ts` | 本地 append-only JSONL 缓冲：Taric 不可达时先落盘，恢复后按幂等键补投（保证"宿主永远不丢观察"） |
| `packages/core/src/config/tools/taric-tools.ts` | 新增 **只读 + 提案** 工具：`board_query`、`board_evidence_query`、`board_propose`、`board_checkpoint_propose`。不含任何 `capture_*` / `admit_*` |
| `packages/ui-web/src/server.ts` | 新增 `/api/challenges/:id/board/*` 只读投影，供 UI 展示覆盖矩阵与提案状态 |

### 6.2 修改（小范围、可回滚）

| 位置 | 改动 |
|---|---|
| `packages/core/src/index.ts:29` | `new RuntimeManager(config, [createChallengeHostBridgeHandler(challenge), createTaricHostBridgeHandler(facade)])` |
| `packages/core/src/challenge/host-bridge-types.ts` | `HostBridgeAction` 增加 `taric_*` 联合项 |
| `packages/core/src/config/tools/challenge-tools.ts` | 保留原有 9 个 action 不动（阶段一），阶段三再让 `challenge_memory_add` 走"提案→准入" |
| `packages/core/src/challenge/manager.ts` `appendMemory()` | 阶段三：插入 `admission` 前置；`source` 由宿主注入而非模型自报 |

### 6.3 明确不改

- `withDirectoryLock` / `atomicWriteJson` / `saveChallengeRecord`：现有文件锁与原子写在 Windows 上是**可用**的，Taric 不替代它们。
- Solver 容器网络：不给 solver 开任何到 Taric 的直连。
- `submitReport` 的资产完成语义：阶段二之后再映射到 CoverageCell，先保持布尔。

---

## 7. 分阶段落地（每阶段都可独立验收、可停）

### P0 可行性闸门（0.5–1 天，**必须先做**）

1. 解决 Docker 权限（当前 `docker version` 报 `permission denied`）。
2. 在 Linux 侧构建 Taric：`npm ci && npm run build`，`node packages/cli/dist/bin.js --help`。
3. 跑通最小闭环：
   ```sh
   export TARIC_DB=/data/taric/authority.sqlite
   export TARIC_CONTENT_ROOT=/data/taric/content
   node packages/cli/dist/bin.js engagement.init '{"name":"tch","scope":{"allowed_targets":["example.test"]}}'
   node packages/cli/dist/bin.js context.build '{}'
   node packages/cli/dist/bin.js audit.doctor '{}'
   ```
4. 验收：`context.build` 返回含 `read_seq` 的 Pack；`audit.doctor` 无 drift；重启容器后数据仍在。
5. **闸门判据**：这一步不通，就不要进入 P1，改走 §9 的 Option B。

### P1 只读黑板（3–5 天）

- sidecar 起一个 Node HTTP 包装（`/dispatch` 转发到 Core，带 token），只暴露 `context.build`、`query`、`resource.query`、`evidence.query`。
- 宿主加 `TaricFacade` + `taric_board_query` 工具。
- Planner/Observer 的 prompt 增加"先查黑板"的硬约束。
- 验收：三个角色的 Context Pack 内容正确；**跨 engagement 读取必须失败**；Taric 停机时，现有功能零报错（走 outbox / 降级）。

### P2 提案闭环（5–8 天）

- `board_propose` → `proposal.submit`（L0 pending）。
- 宿主 `admission.evaluate`（可先"人在回路"：UI 上一个按钮走 `operator` principal）。
- 验收：模型自报 `accept:true` / `trust_level` 无效；审计链可查到 proposal→admission 的事件；L1 候选默认不出现在普通召回。

### P3 执行协作 + Artifact（1–2 周）

- `work.claim/renew/reclaim`，`generation` 与 `SolverInstance` 绑定；`checkpoint.propose/commit`。
- 工具输出原文 → `artifact.store.begin/append/commit`（spool 落在 sidecar 卷，模型只见引用的元数据）。
- 验收：两个 solver 并发不同资产无冲突；reclaim 后旧 solver 写入被 `stale_version` 拒绝；原文不出现在任何模型视图。

### P4 观察纠偏 + 质量门槛（1–2 周）

- Observer 异常矩阵：动作 denied 连续、心跳超时、checkpoint 停滞、同资源冲突、覆盖格回退。
- `resource.impact` 有界传播；`review.submit` 独立复核（reviewer_id 必须来自已验证 principal）。
- 验收：高危 Finding 无独立复核不进 L2；崩溃恢复演练通过（resume 后 read_seq 对得上）。

### P5 规模与韧性（按需）

- 覆盖矩阵压测、故障注入、漏报金标集。
- 此时再评估是否需要 PostgreSQL profile（默认关闭，需 conformance report 匹配才启用）。

---

## 8. 风险与缓解

| 风险 | 级别 | 缓解 |
|---|---|---|
| Windows 权限断言阻断（§3 #3） | **高** | 权威层只跑 Linux；不在 NTFS 上放 authority 目录 |
| Windows socket 不可用（§3 #4/#5） | 高 | 不用 proxy，用 TCP loopback + token；facade 侧做连接池 |
| Docker 权限不足（§3 #6） | 中 | P0 前置条件；或退到 WSL2 直接跑 Node |
| Taric 同步 SQLite 阻塞 | 中 | 隔离在 sidecar；facade 设 3–5s 超时 + 熔断 |
| 双写不一致（JSON vs Taric） | 中 | 明确单向：Taric 是事实层，JSON 是投影；投影失败可重建 |
| Taric 无 MCP 推送 | 中 | 宿主轮询 `host.state`（有退避），或 facade 层做 SSE |
| 学习/维护成本 | 中 | 先只接 P1+P2，收益（防幻觉污染）已经能兑现 |
| 版本漂移（Taric 0.1.0，质量门槛仍 blocked） | 中 | 固定 commit + 只依赖 CLI/Core 公开 operation；不碰内部表结构 |

---

## 9. Option B：如果 P0 闸门不过

不引入 Taric 运行时，但**照搬它的语义**在当前项目内做一个"Taric-lite 黑板内核"，工作量约 3–5 天：

1. **append-only 事件日志**：`challenge/<id>/board/events.jsonl`，每条 `{commit_seq, event_id, event_type, subject_id, payload_hash, actor}`。
2. **`read_seq` 快照**：每次读取返回 `read_seq`，客户端带 `read_seq` 请求增量（对应 `ResumeContextDelta` 的最小版）。
3. **提案/准入分离**：新增 `proposal.json`（pending/candidate/verified），模型只能 `propose`，宿主 `admit`。
4. **证据硬门**：`kind=fact` 必须带 `refs` 且 refs 能解析到同 challenge 的 evidence 条目；否则拒绝。
5. **覆盖单元**：把 `assets[].scanned` 扩成 `{state: untested|blocked|negative|positive|unknown, method, identity, updated_at}`。

这套东西不解决"多进程并发 + 崩溃恢复"的完整问题，但能**立刻**堵住"模型直写共享事实层"这个最大的洞，
且将来迁移到 Taric 时字段语义是对齐的（`commit_seq` / `read_seq` / proposal 状态机可直接映射）。

---

## 10. 建议的决策

1. **先做 P0 闸门**（构建 + 最小闭环 + audit.doctor），用数据而不是文档决定可行性。
2. 闸门通过 → 走 P1/P2，这两阶段投入产出比最高（防幻觉污染、可审计、可回滚）。
3. 闸门不通过或时间紧 → 走 Option B，同时保持字段语义对齐，为后续迁移留门。
4. 无论哪条路，**不要**把 `@taric/core` import 进 Bun 宿主，**不要**把 authority 放在 NTFS。

---

## 附录：证据索引

| 结论 | 证据位置 |
|---|---|
| 现有持久化为 JSON + 目录锁 | `packages/core/src/challenge/store.ts:391`、`challenge/memory.ts:withDirectoryLock` |
| 模型可直写共享记忆 | `packages/core/src/challenge/host-bridge-handler.ts:170-179`、`manager.ts:1345-1350` |
| Host Bridge 是唯一通道 | `runtime.ts:307,326`、`host-bridge-types.ts`（9 个 action） |
| Observer 已是最接近黑板的结构 | `solver/extension/challenge-observer/observer-store.ts` |
| 资产状态是布尔 | `challenge/store.ts` `ChallengeAssetRecord`、`manager.ts:1261-1281` |
| Taric 权限断言 | `packages/core/src/store.ts` `authorityDrift/assertAuthorityWritable`、`cursor-key.ts:35` |
| Taric socket 生命周期 | `packages/core/src/adapter-rpc.ts:26-33` |
| Taric 能力边界 | `Taric-main/readme.md`「核心限制」、`docs/agent-integration.md`「Supported Profile」 |
| 既有差距分析 | `Taric-main/docs/taric-gap-analysis-breachweave-integration.md` |
| 本机实测 | 2026-10-21，Bun 1.4.3 / Node v24.13.0（见 §3 表格） |