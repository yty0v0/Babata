# BreachWeave 全面信息收集、三维攻击面构建与终局覆盖门禁实施方案

- 日期：2026-10-28
- 状态：基于当前源码的可实施设计
- 目标环境：经授权的靶场与渗透测试项目
- 核心目标：提升攻击面发现率、测试覆盖率和有效漏洞产出，避免 Solver 因局部突破或过早提交报告而结束测试
- 设计原则：首次探索前强制完成可执行的信息收集和攻击面基线；自由探索阶段保留 Solver 自主性，只由 Observer 软提醒；结束前由 Host 执行唯一硬性覆盖门禁

## 0. 本地项目与参考资源定位

后续实施模型必须先读取本节所列本地文件，不能仅凭本文中的摘要重新猜测 CyberStrike、Hackbrowser、WSTG、STRIDE 或 BREAK 的实现。路径均为当前机器的绝对路径。

### 0.1 当前改造项目

| 内容 | 本地路径 |
|---|---|
| BreachWeave 仓库根目录 | `C:\Users\Administrator\Desktop\AI自动化渗透测试\重构参考\BreachWeave-pentest\BreachWeave-pentest` |
| 本方案仓库副本 | `C:\Users\Administrator\Desktop\AI自动化渗透测试\重构参考\BreachWeave-pentest\BreachWeave-pentest\docs\BreachWeave-全面信息收集与攻击面构建实施方案-2026-10-28.md` |
| 用户提供的原始参考方案 | `C:\Users\Administrator\Desktop\BreachWeave-信息收集与攻击面构建改造计划-2026-10-27.md` |

### 0.2 CyberStrike 与 Hackbrowser（简称 CY）

| 用途 | 必须查看的本地路径 |
|---|---|
| CyberStrike 根目录 | `C:\Users\Administrator\Desktop\AI自动化渗透测试\参考资源\CyberStrike-main` |
| CyberStrike 主包 | `C:\Users\Administrator\Desktop\AI自动化渗透测试\参考资源\CyberStrike-main\packages\cyberstrike` |
| 工具选择与安装清单 | `C:\Users\Administrator\Desktop\AI自动化渗透测试\参考资源\CyberStrike-main\packages\cyberstrike\src\tool\ensure-tools.ts` |
| CyberStrike 的 Hackbrowser 工具适配层 | `C:\Users\Administrator\Desktop\AI自动化渗透测试\参考资源\CyberStrike-main\packages\cyberstrike\src\tool\hackbrowser.ts` |
| Web Agent 的工具使用策略 | `C:\Users\Administrator\Desktop\AI自动化渗透测试\参考资源\CyberStrike-main\packages\cyberstrike\src\agent\prompt\web-application.txt` |
| 评估阶段与 scope 类型 | `C:\Users\Administrator\Desktop\AI自动化渗透测试\参考资源\CyberStrike-main\packages\cyberstrike\src\methodology\phase.ts` |
| Intel 实体与覆盖线索 | `C:\Users\Administrator\Desktop\AI自动化渗透测试\参考资源\CyberStrike-main\packages\cyberstrike\src\tool\intel.ts` |
| Hackbrowser 独立包根目录 | `C:\Users\Administrator\Desktop\AI自动化渗透测试\参考资源\CyberStrike-main\packages\hackbrowser` |
| Hackbrowser 源码 | `C:\Users\Administrator\Desktop\AI自动化渗透测试\参考资源\CyberStrike-main\packages\hackbrowser\src` |
| 浏览器规划器 Prompt | `C:\Users\Administrator\Desktop\AI自动化渗透测试\参考资源\CyberStrike-main\packages\hackbrowser\src\prompt\planner.txt` |
| 重点模块 | `agent.ts`、`auth.ts`、`capture.ts`、`executor.ts`、`navigator.ts`、`scanner.ts`、`scope.ts`、`state.ts`、`ingest.ts`、`types.ts`（均位于上述 Hackbrowser `src` 目录） |

CY 仅作为工具选择、浏览器采集、认证介入、Intel 结构和方法论编排参考；不要整体复制它的 CLI、运行时自动安装和 ingest 架构。BreachWeave 应使用固定镜像版本、Provider 接口、Artifact/Taric 证据与自己的 Host 生命周期。

### 0.3 三维攻击面方法论

| 维度 | 本地根目录 | 实施要求 |
|---|---|---|
| 第一维 WSTG | `C:\Users\Administrator\Desktop\AI自动化渗透测试\重构参考\wstg-master` | 读取源码场景与 checklist，构建固定版本 Catalog，不用 OWASP Top 10 摘要替代 |
| 第二维 STRIDE | `C:\Users\Administrator\Desktop\AI自动化渗透测试\重构参考\threat-modeling-main` | 使用 DFD、Trust Boundary、STRIDE library、映射和 completeness rules |
| 第三维 Lateral | `C:\Users\Administrator\Desktop\AI自动化渗透测试\重构参考\BREAK-main` | 使用业务风险实体、typed relation 和有限跳数扩展，不做全库笛卡尔积 |

如果上述路径不存在或版本变化，实施必须停止并记录 reference block；不得静默退化成模型内置常识。

## 1. 结论

推荐采用以下控制流：

```text
SCOPE
  -> RECON_BASELINE（Host 强制）
  -> SURFACE_BASELINE（Host 强制，WSTG + STRIDE + Lateral）
  -> EXPLORE（Solver 自由探索，Observer 只做软提醒）
  -> FINAL_GATE（Host 唯一终局硬门禁）
       -> PASS -> VERIFIED_COMPLETE
       -> GAP  -> FOCUSED_REMEDIATION -> FINAL_GATE
       -> EXTERNAL_BLOCK/BUDGET_LIMIT -> INCOMPLETE_STOPPED
```

不建议把攻击面变成 Solver 必须逐条执行的固定任务队列。攻击面应承担三个作用：

1. 给 Solver 提供高价值地图和当前盲区。
2. 给 Observer 提供可计算的软提醒依据。
3. 在最终结束前给 Host 提供覆盖缺口的确定性判断依据。

强制点仅放在首次探索前和最终结束前。EXPLORE 阶段不因 RiskPoint 未完成而拒绝工具调用，不限制 Solver 攻击路线，也允许发现攻击面模型之外的新漏洞。

## 2. 当前代码基线与必须先解决的问题

### 2.1 当前完成语义会造成过早结束

`packages/core/src/challenge/store.ts` 的 `computeChallengeCompleted()` 只检查所有入口资产是否为 `positive` 或 `negative`。它不知道是否完成了信息收集、是否构建攻击面、是否覆盖关键角色、是否遗漏 Bundle/API/业务流程。

`packages/core/src/challenge/manager.ts` 的 `submitReport()` 在调用方未传 `coverageState` 时默认写入 `positive`，随后计算资产全部完成并异步调用 `finishChallenge()`。`packages/core/src/config/tools/challenge-tools.ts` 的工具描述也明确告诉模型 coverage 默认 positive。

这意味着当前最危险的漏测路径是：

```text
Solver 对每个入口提交一份报告
  -> coverage_state 默认 positive
  -> computeChallengeCompleted() = true
  -> finishChallenge() 停止目标与全部 Solver
```

第一优先级必须拆开以下三种概念：

- 报告已提交。
- 某个入口完成了一轮测试。
- 整个 Challenge 已经过终局 Gate，可以完成。

### 2.2 当前 Planner 不具备阶段准入能力

`ChallengeManager.runPlannerOnce()` 生成快照后，Planner 的核心动作仍是 `planner_launch_solver`，最终直接进入 `launchSolver()`。Planner 可以选择入口和 prompt，但没有 Recon Gate、Surface Gate 或 assessment revision。

因此不能仅在 Planner Prompt 中写“先侦察”。阶段推进必须由 Host 状态机控制：Planner 请求启动普通 Solver 时，Host 应先调用 `ensureAssessmentBaseline()`；基线未完成时启动 Recon，而不是普通 Solver。

### 2.3 当前 Observer 看不到足够的覆盖上下文

当前 Observer：

- 每 6 个 assistant round 周期复核一次。
- 只看最近 10 轮。
- tool args 和 tool result 各截断到 160 字。
- 主要维护 ideas/memory，并通过 `send_efficiency_reminder` 纠正持续低效行为。

它适合做路线纠偏，但无法仅靠现有日志可靠判断：

- 哪些 Recon 来源没有运行。
- Bundle 是否全部分类和分析。
- 新发现的 API 是否已经进入攻击面。
- 当前 Surface 是否落后于 Recon revision。
- WSTG 测试域还缺哪些必要结论。

Observer 必须读取 Host 生成的紧凑 Assessment Snapshot，而不是从截断日志中猜覆盖率。

### 2.4 当前扫描约束与“强制全量 Recon”冲突

主 Solver 会启用 `scopeGuardExtension(... agentRole: "targeted-pentest", mode: "enforce")`。默认 `run-policy.json` 中：

- `no_scan: true`
- 禁止 nmap、masscan、naabu、ffuf、gobuster、feroxbuster、dirsearch、nikto 等命令

不应为了 Recon 全面性全局关闭该保护。更好的方案是新增 Host 管理的 ReconCoordinator：它只接受经过 scope 校验的目标，调用固定 ReconProvider，并分别设置超时、并发、速率和证据落盘。普通 Solver 继续使用现有 scope guard。

### 2.5 Browser sidecar 当前不足以承担深度攻击面采集

当前 `browser-sidecar.mjs` 只保存：

- method
- URL
- status
- resourceType

它没有保存请求头、请求体、响应摘要、触发控件、表单字段、readonly/disabled/hidden 状态、页面角色和动作序列。并且 Dockerfile 将文件复制到 `/opt/browser-sidecar/browser-sidecar.mjs`，`native-runtime.ts` 却尝试启动 `/opt/browser-sidecar.mjs`，路径不一致。

必须先修复启动路径和 smoke test，然后扩展采集协议。

### 2.6 当前 Findings 不是 Host 验证的统一事实

`report_vulnerability` 将结果写入 Solver 工作区 `.native-findings.json`。`triage_vulnerability` 也只修改该本地文件。Challenge 报告、Taric evidence、Assessment coverage 和本地 finding 目前不是一个统一状态机。

新的终局 Gate 只能信任 Host 已接收并通过证据检查的 finding，不能直接把 Solver 工作区文本当作 verified vulnerability。

### 2.7 当前 Taric 能复用，但不能假设覆盖门禁已经存在

现有 Taric 集成已经提供了有价值的基础：

- engagement binding
- WorkItem/WorkRun
- checkpoint
- tool result artifact
- observation/evidence 绑定
- report 前的 checkpoint/evidence gate
- Host Bridge 审计、角色权限、限流和超时

但是当前所谓 `coverageGaps` 主要表示缺少 checkpoint/evidence，不是 WSTG/实体/角色/攻击类别的覆盖矩阵。方案一期不应直接依赖一个尚未接入的 Taric CoverageCell Gate。

### 2.8 当前项目到底支持哪些测试场景

当前项目不是纯 Web 扫描器，而是以 CTF/授权安全测试为入口的多角色 Agent 平台。代码、Runtime 和内置 Skill 覆盖 Web/API、URL 与 IP 资产、已知产品验证，也包含内网/AD、Linux/Windows/macOS 后渗透、云/Kubernetes/CI/CD 和 LLM Security 等知识与工具。Challenge 资产模型同时接受 URL 和 IP，默认 Prompt 也启用了 `intranet-pentest`、`known-product-exploit`、`recon`、`targeted-pentest`、`ffuf`、`nuclei`、浏览器等能力。

但“仓库里有 Skill”不等于该场景已经具备完整编排、覆盖账本和终局门禁。按当前代码成熟度应这样理解：

| 场景 Profile | 当前成熟度 | 本次改造定位 |
|---|---|---|
| Web Application / API 黑盒 | 主链最成熟，具备 HTTP、浏览器、目录/模板/定向验证工具 | 本方案一期的明确目标 |
| Domain / Wildcard Web 资产 | 有子域、历史 URL、HTTP 探测工具基础，但未统一编排 | 在 Web Profile 上扩展 Provider |
| Host / Network 服务 | Runtime 有 Nmap/fscan 等，Challenge 支持 IP，但默认 `no_scan` 会限制 Solver | 后续单独建立 Host Profile，不能直接套 Web Gate |
| Internal / AD | 有 Skill 和部分工具知识，缺少成熟的资产图、身份/信任关系覆盖模型 | 后续独立 Profile |
| Cloud / Kubernetes / CI/CD | 有知识型 Skill，当前 Challenge 生命周期不是完整云评估编排 | 后续独立 Profile |
| 移动原生、无线、硬件/IoT、完整白盒 SAST | 没有足够的端到端实现证据 | 不宣称支持 |

因此本方案应实现为 `WebApplicationAssessmentProfile`，目标是授权黑盒 Web 渗透测试；不要把 Web 的 Bundle、页面和 WSTG 门限强塞给其他场景。Assessment 数据模型保留 `profile` 字段，未来由 Host 按 Profile 选择 Recon sources、Surface 方法论和 FinalGate。

## 3. 总体架构

### 3.1 职责边界

| 组件 | 职责 |
|---|---|
| ChallengeManager | Challenge 生命周期、Assessment 阶段推进、Solver 调度、终局完成判定 |
| ReconCoordinator | 强制基线侦察、Provider 调度、增量补采、Recon Gate |
| BundleAnalyzer | Bundle 获取、分类、静态分析、API 前缀候选生成 |
| BrowserProbeService | 基础浏览器采集和按需深度爬取 |
| SurfaceBuilder | 基于 WSTG + STRIDE + Lateral 生成风险点和覆盖义务；禁止发探测请求 |
| AssessmentStore | 阶段、revision、实体、RiskPoint、CoverageObligation、Gap 和终止状态 |
| Taric/Artifact | 原始工具输出、Observation、Evidence、Checkpoint 的权威证据层 |
| Solver | EXPLORE 阶段自由验证、发现漏洞、提交候选 finding 和新攻击面线索 |
| Observer | 读取 Assessment Snapshot；默认在自然边界排队软提醒，极少数持续低效情形才使用 steer |
| FinalGate | 唯一 Challenge 完成硬门禁；生成定向补缺任务 |

### 3.2 一期权威数据边界

为了贴合现有代码，建议一期采用：

```text
AssessmentStore = 流程与覆盖账本权威
Taric           = Artifact/Observation/Evidence/Checkpoint 权威
Challenge JSON  = UI 与旧 API 兼容投影
```

Assessment 中只保存 evidence ref、artifact ref 和摘要，不复制大型响应体。后续如果 Taric 的 Resource/Relation/CoverageCell 能力完成稳定接入，再把 AssessmentStore 降级为 Taric 投影。

这不是建立第二套证据系统，而是在当前 Taric 尚未承载覆盖语义时，为 Host Gate 提供确定性索引。

## 4. Assessment 数据模型

### 4.1 ChallengeAssessment

```ts
type AssessmentPhase =
  | "scope"
  | "recon_baseline"
  | "surface_baseline"
  | "explore"
  | "final_gate"
  | "focused_remediation"
  | "terminal"

type TerminationStatus =
  | "verified_complete"
  | "incomplete_stopped"
  | "user_waived"

interface ChallengeAssessment {
  schema_version: 1
  challenge_id: string
  phase: AssessmentPhase
  recon_revision: number
  surface_revision: number
  gate_revision: number
  surface_dirty: boolean
  remediation_round: number
  termination_status?: TerminationStatus
  created_at: string
  updated_at: string
}
```

关键不变量：

- `surface_revision <= recon_revision`
- 接受新的 ReconFact 后递增 `recon_revision`
- SurfaceBuilder 读取 revision N 的一致快照，成功后写入 `surface_revision = N`
- `recon_revision > surface_revision` 时自动设置 `surface_dirty = true`
- 只有 FinalGate PASS 才能写 `verified_complete`

### 4.2 ReconSourceState

```ts
type ReconSourceStatus =
  | "pending"
  | "running"
  | "complete"
  | "partial"
  | "blocked"
  | "failed"
  | "not_applicable"

interface ReconSourceState {
  source: "http" | "route" | "bundle" | "browser_baseline"
        | "browser_deep" | "scanner" | "system_feature"
  scope_key: string
  auth_scope: string
  required: boolean
  status: ReconSourceStatus
  attempts: number
  discovered_count: number
  evidence_refs: string[]
  reason?: string
  last_run_at?: string
}
```

`scope_key` 用于区分 origin、应用区域或角色，例如：

```text
https://target.example|anonymous
https://target.example|role:user
https://target.example/admin|role:admin
```

### 4.3 ReconFact 与 SurfaceEntity

```ts
type ReconFactKind =
  | "origin" | "host" | "page" | "route" | "endpoint"
  | "parameter" | "form" | "workflow" | "bundle" | "websocket"
  | "graphql_operation" | "role" | "menu" | "system_feature"

interface ReconFact {
  id: string
  kind: ReconFactKind
  locator: string
  method?: string
  auth_scope: string
  source_kinds: string[]
  evidence_refs: string[]
  confidence: number
  attributes: Record<string, unknown>
  first_seen_revision: number
  last_seen_revision: number
}
```

稳定 ID 建议：

```text
sha256(kind + canonical_locator + method + auth_scope)
```

`SurfaceEntity` 是去重、归一化后的攻击面实体，额外包含：

- capabilities：upload、download、search、login、reset、admin、payment、webhook 等
- inputs：参数位置、类型、来源、客户端约束
- roles：可见角色、可调用角色、未知角色
- relations：page -> endpoint、menu -> role、workflow -> step、bundle -> endpoint
- source_fact_ids
- evidence_refs
- active/retired 状态

### 4.4 RiskPoint

```ts
interface RiskPoint {
  id: string
  entity_id: string
  vulnerability_class: string
  title: string
  role_context: string
  preconditions: string[]
  trigger_signals: string[]
  test_strategy: string
  expected_secure_behavior: string
  differential_oracle: string
  impact: string
  priority: "critical" | "high" | "medium" | "low"
  dimensions: Array<"wstg" | "stride" | "lateral">
  methodology_refs: string[]
  wstg_refs: string[]
  stride_refs: string[]
  break_refs: string[]
  trust_boundary_refs: string[]
  evidence_refs: string[]
  surface_revision: number
}
```

去重键：

```text
entity_id + vulnerability_class + role_context + attack_window
```

### 4.5 CoverageObligation

RiskPoint 是测试建议，CoverageObligation 是终局 Gate 的判断单元，两者不能混为一谈。

```ts
type CoverageDisposition =
  | "pending"
  | "testing"
  | "tested_negative"
  | "verified_finding"
  | "not_applicable"
  | "blocked"

interface CoverageObligation {
  id: string
  entity_id?: string
  scope: "entity" | "workflow" | "role_pair" | "site"
  class_id: string
  dimensions: Array<"wstg" | "stride" | "lateral">
  methodology_refs: string[]
  wstg_refs: string[]
  stride_refs: string[]
  break_refs: string[]
  trust_boundary_refs: string[]
  role_context: string
  disposition: CoverageDisposition
  reason?: string
  evidence_refs: string[]
  finding_refs: string[]
  required: boolean
  surface_revision: number
}
```

语义：

- `tested_negative`：执行过有意义的测试，当前未发现漏洞，必须有证据。
- `verified_finding`：已验证 finding，必须有请求/响应或等价证据。
- `not_applicable`：本质不适用，必须给出实体级理由。
- `blocked`：适用但缺少凭据、角色、稳定环境或其他外部条件。
- `blocked` 不能伪装成 `not_applicable`。

## 5. 强制信息收集设计

### 5.1 “全量”的可执行定义

全量不是无限爬取，也不是必须命中所有隐藏路径。全量定义为：在当前 scope、当前可用身份和预算内，所有规定信息源均已经执行并闭环；每个未获得结果的来源都有明确失败原因和证据。

初始 Recon Gate 有三种结果：

| 结果 | 含义 | 是否进入 Surface |
|---|---|---|
| PASS | 所有 required source 在可用上下文中完成 | 是 |
| PASS_WITH_EXTERNAL_BLOCKS | 仅剩缺少凭据/MFA/外部依赖等无法自动解决的 block | 是，但终局不能 verified_complete |
| FAIL | 仍有可执行但未执行、无证据失败或结果未归类的 required source | 否，继续 Recon |

这样既符合“先全量信息收集”，又不会因为用户没有 admin 凭据而让整个测试永远无法开始。

### 5.2 ReconProvider

```ts
interface ReconProvider {
  id: string
  supports(target: ReconTarget): boolean
  collect(input: ReconInput, signal: AbortSignal): Promise<ReconProviderResult>
}
```

建议 Provider：

1. `HttpBaselineProvider`
   - 入口、跳转链、状态、Header、Cookie、TLS 摘要
   - robots.txt、sitemap、well-known、表单和静态资源
2. `RouteProvider`
   - HTML 链接、菜单、路由表、manifest、source map 引用
3. `ScannerProvider`
   - 调度经过批准的组合扫描/采集工具；“AIPTS”只作为能力层的参考名称，不要求存在同名程序
   - 输出必须规范化为 ReconFact，原始输出进入 Artifact
4. `BundleProvider`
   - 下载、hash、分类、静态分析、候选端点和系统特征
5. `BrowserBaselineProvider`
   - 每个可用角色的首页、菜单、页面和 Network 基线
6. `SystemFeatureProvider`
   - WAF、验证码、CSRF、签名、加密、自定义 Header、客户端证书等
7. `BrowserDeepProvider`
   - 非初始全站必跑；由 gap/finding/动态流程按需触发

#### 5.2.1 当前项目实际可用的扫描/采集能力

当前 Runtime 镜像已经安装不少 Web 渗透工具，但它们目前主要由 Solver 通过 shell 零散调用，不是统一的 ReconProvider：

| 能力 | 当前工具 | 适合产出 | 当前限制 |
|---|---|---|---|
| 指纹/服务基线 | WhatWeb、Nmap、sslscan、fscan | 技术栈、Web 端口、TLS、已知产品候选 | Web-only 场景应限制在目标 origin 和必要端口 |
| 路径/参数发现 | ffuf、gobuster、dirsearch、wfuzz | 路径、虚拟主机、隐藏参数 | 默认 `no_scan=true` 禁止 nmap/ffuf/gobuster/dirsearch 等命令 |
| 已知漏洞模板 | Nuclei 3.7.1 + nuclei-templates | CVE、错误配置、泄漏和弱点候选 | 不等于全局路由爬取；输出尚未规范化为 ReconFact |
| 定向验证 | sqlmap | SQL 注入候选验证 | 应在发现参数后定向使用，不属于初始路由扫描 |
| HTTP/历史入口 | `http_replay`、`csrf_extract`、`attack_script.wayback_extract` | 基线请求、CSRF、历史 URL | 是单点工具，不是 crawler |
| 浏览器采集 | `agent-browser`、原生 `browser_action` | 页面、交互、Network | sidecar 当前仅有基础动作，尚无深爬调度和完整 body/HAR 模型 |
| 旧式目录扫描 | Skill 资源中的 `ctf-wscan` | 简单目录探测 | 不宜作为新架构主扫描器 |

代码中没有 AIPTS 实现、适配器或可执行文件。`tch-headless-skill` 虽然存在，但仓库和镜像没有它声明的 `./scripts/tch-headless` 二进制，因此当前不能当成可用扫描器。

用户所说的“AIPTS 扫描”应落地为 `CompositeWebReconProvider` 能力层，不新增虚构的 `AiptsProvider`。CyberStrike 的 `ensure-tools.ts` 已给出适合复用的工具选型：Nmap、Nuclei、ffuf、ProjectDiscovery httpx、subfinder、amass、waybackurls、gau、hakrawler、katana、dalfox、sqlmap、nikto、wpscan、gospider、arjun、paramspider、commix、ssrfmap、nosqlmap、crlfuzz、git-dumper。复用的是工具组合与结果归一化思路，不建议移植其运行时自动安装机制；BreachWeave 应在镜像构建阶段固定版本并生成 tool manifest/SBOM。

建议按能力拆成以下 Provider：

| Provider | 首选工具 | 运行阶段 | 说明 |
|---|---|---|---|
| `PassiveReconProvider` | subfinder、amass passive、gau、waybackurls | Domain/Wildcard 基线 | 单 URL 目标按 scope 裁剪，不无界扩资产 |
| `HttpProbeProvider` | ProjectDiscovery httpx、WhatWeb、sslscan | 初始强制 | 当前镜像的 Python `httpx` 库不能冒充 PD httpx CLI，需要显式加入镜像 |
| `WebCrawlerProvider` | katana；hakrawler/gospider fallback | 初始强制 | 获取全局页面、脚本、表单和路由；它承担参考流程中的“全局路由扫描” |
| `ContentDiscoveryProvider` | ffuf；dirsearch/gobuster fallback | 初始强制但受预算控制 | 发现隐藏目录、备份和入口；字典、速率、递归深度必须记录 |
| `TemplateScanProvider` | nuclei | 初始基线 | 产出配置/CVE/泄漏候选，不承担路由全集，也不直接等于 verified finding |
| `ParameterDiscoveryProvider` | arjun、paramspider | 初始或区域补采 | 归一化参数及来源证据 |
| `BundleProvider` | 自建 AST/grep 分流 | 初始强制 | 业务 Bundle 深读、vendor grep、runtime 忽略、API prefix 反推 |
| `BrowserBaseline/DeepProvider` | BreachWeave browser + Hackbrowser 设计 | 基线/按需 | 认证后菜单、动态请求、多步骤 workflow；需要人工登录时走 UserRequest |
| `TargetedVerifierProvider` | sqlmap、dalfox、commix、ssrfmap、nosqlmap、crlfuzz 等 | Solver 探索/定向补缺 | 只在端点、参数或 finding 信号存在后运行，不属于无差别初始扫描 |

用户给出的七类工具名应视为产品能力分类，而不是必须同名实现的 API：`web_scan` 对应 crawler + template + baseline，`port_scan` 对应 Host/Network Profile，`subdomain_enum` 对应 Domain/Wildcard Profile，`dir_bruteforce` 对应 ContentDiscovery，`network_recon` 对应资产画像，`vuln_verify` 对应 TargetedVerifier。`password_bruteforce` 不应作为 Web 初始强制 Recon；它只能在明确授权、明确账号域、限速/锁定保护和已有认证风险信号下成为定向验证任务。

推荐顺序固定为：

```text
CompositeWebReconProvider 全局路由采集（crawler + HTTP probe + content discovery + template candidate）
-> Bundle 强制下载、分类、解析、API prefix 反推与端点验证
-> Recon Gate
-> Surface baseline
-> Solver 自由探索
-> 信息稀薄区域或 finding 相邻面触发 BrowserDeepProvider
```

Recon Gate 检查的是能力来源是否闭环，而不是某个品牌工具是否存在。例如 crawler source 可以由 katana 完成，也可以由等价 Provider 完成；但 Nuclei 不能冒充 crawler，目录爆破也不能冒充认证后浏览器覆盖。每个 source 都必须记录 provider、版本、配置摘要、scope、开始/结束时间、结果/失败证据和 Artifact 引用。

Host ReconCoordinator 不受普通 Solver 的 `no_scan` 影响，但必须执行更严格的：

- Challenge scope 校验
- 精确目标绑定
- 最大并发和速率
- 单 Provider 超时
- 最大响应/Artifact 大小
- 幂等 key
- 审计日志

### 5.3 Bundle 分流

Bundle Manifest：

```ts
interface BundleRecord {
  id: string
  source_url: string
  final_url: string
  content_hash?: string
  size?: number
  content_type?: string
  auth_scope: string
  classification: "application" | "business_chunk" | "vendor" | "runtime" | "unknown"
  acquisition: "http" | "browser_response" | "blocked" | "partial"
  analysis: "deep" | "grep" | "ignored" | "failed"
  evidence_refs: string[]
  reason?: string
}
```

处理策略：

| Bundle 类型 | 策略 |
|---|---|
| app/main/业务 chunk | AST/字符串联合深度分析 |
| vendors/第三方库 | 高价值关键字 grep，不逐模块阅读 |
| runtime/polyfill/webpack bootstrap | 忽略或低优先级 grep |
| unknown | 先根据体积、依赖特征、路径和符号重新分类 |

深度分析提取：

- 相对/绝对 API 路径
- `baseURL`、`API_BASE`、代理前缀
- 路由、菜单、角色和 feature flag
- GraphQL operation、WebSocket、上传下载、导入导出
- API Key、Secret、JWT 常量和调试配置
- 请求签名、加密、nonce、timestamp、自定义 Header
- source map、WASM 和 worker 入口

每个发现的 Bundle 必须最终处于 deep、grep、ignored、blocked 或 failed 之一。仅“发现了文件”不算完成。

### 5.4 API 前缀反推

输入：

- Bundle 相对路径，例如 `sysuser/list`
- Browser/HTTP 捕获的真实 API，例如 `/sys/api/sysuser/list`
- Bundle 常量，例如 `API_BASE=/sys/api`

算法：

1. 规范化真实请求 path 和候选相对 path。
2. 计算 suffix match，生成 base prefix 候选。
3. 与 `baseURL/API_BASE/publicPath/proxy` 常量交叉打分。
4. 按 origin、auth scope、API family 分组，避免把不同后端前缀混为一个。
5. 对每个高置信 base prefix 至少验证一个低副作用端点。
6. 2xx/3xx/401/403 可证明路由存在；404 否决当前拼接；WAF/超时记 blocked，不能记 verified。
7. 保存验证请求证据和候选淘汰理由。

不要只验证全站任意一个端点。至少应按 `origin + base_prefix + auth_scope` 验证。

### 5.5 浏览器采集与 Hackbrowser 复用

从 `CyberStrike-main/packages/hackbrowser` 复用设计和经过测试的局部模块，不整体移植其 CLI、Provider 和 ingest 架构。

优先复用：

- 交互元素语义扫描和稳定 selector
- BFS 页面队列
- 数字 ID 路径模板限额
- 未探索元素二次规划
- 动作前 UI snapshot
- 动作与请求时间窗关联
- hidden/readonly/disabled/display-only 字段识别
- 多角色 page/element availability 差异
- 空状态页面在成功 mutation 后定向重访
- overlay、动态菜单和 DOM 变化后的重新规划

扩展 sidecar 返回：

```ts
interface BrowserCapturedExchange {
  request_id: string
  method: string
  url: string
  request_headers: Record<string, string>
  request_body_ref?: string
  status: number
  response_headers: Record<string, string>
  response_body_ref?: string
  resource_type: string
  page_url: string
  trigger_element?: string
  auth_scope: string
  ui_context?: UIContext
  timestamp: string
}
```

浏览器深爬的触发器：

- 菜单存在但没有对应 API
- Bundle 有入口但无法还原真实调用
- 动态角色菜单未覆盖
- 多步表单或 workflow 无法静态恢复
- 新 finding 暗示同资源族、相邻对象或隐藏管理接口
- 某功能区实体密度显著低于同类区域
- 页面声明能力但 HTTP/Bundle 没有对应端点

深爬任务必须带：area、auth scope、reason、已知实体、预算、禁止副作用和期望产物。

浏览器动作采用风险分级，但不让审批打断普通浏览：

- L0 读取动作：导航、刷新、展开菜单、切换页签、读取 DOM/Network，自动执行。
- L1 可控测试写入：使用明确测试数据、可回滚的表单提交/上传，授权策略允许时自动执行并留证。
- L2 外部或高副作用：短信/邮件、支付、审批、删除、发布、账号锁定、不可逆状态改变，默认不自动执行；只有它对当前高价值义务不可替代时才请求用户。

BrowserDeepProvider 应先尝试只读验证、草稿、测试账号、拦截请求、构造但不提交等替代方案；替代方案不足且该动作实质影响覆盖结论时，才进入第 10.5 节的 `waiting_user` 流程。

## 6. 攻击面构建：三个固定版本的本地方法论源

三维攻击面都必须从本地参考库构建机器可读 Catalog，并在 BreachWeave 版本中固定；运行时只读已生成 Catalog，不直接读取会变化的外部目录。三个来源分别是：

| 维度 | 本地来源 | 用途 |
|---|---|---|
| 第一维 | `重构参考/wstg-master` | Web 技术测试场景、Objectives 和测试方法 |
| 第二维 | `重构参考/threat-modeling-main` | DFD、信任边界、STRIDE-per-element、CWE/控制/验证映射 |
| 第三维 | `重构参考/BREAK-main` | 业务风险、相邻风险、攻击能力、业务场景和控制局限性 |

每条 RiskPoint 和 CoverageObligation 必须保留具体条目 ID、本地相对路径、源版本和 manifest hash；不能只写笼统的 `STRIDE` 或 `BREAK`。

### 6.1 第一维：以本地 OWASP WSTG 为唯一方法论源

第一维不再使用笼统 OWASP Top 10 扫描，而使用：

```text
C:\Users\Administrator\Desktop\AI自动化渗透测试\重构参考\wstg-master
```

该副本是 WSTG master、正在开发 5.0；本地 `checklists/checklist.json` 有 13 个测试域、115 个测试项，但源码目录中能识别到 118 个带 WSTG ID 的场景文件，且包含 checklist 尚未列出的内容，例如 `WSTG-CONF-15`。因此实现不能只读取 checklist.json。

建议新增构建脚本生成版本化 Catalog：

```text
scripts/build-wstg-catalog.ts
docs/methodology/wstg-catalog.json
docs/methodology/wstg-manifest.json
```

Catalog 构建规则：

1. 扫描 `document/4-Web_Application_Security_Testing/**.md`。
2. 提取 `WSTG-<category>-<number>`、标题、Objectives、适用描述和本地相对路径。
3. 识别 `[merged]` 场景并映射到替代 ID，不生成重复义务。
4. 用 `checklists/checklist.json` 补充结构化 objectives，但以源码场景为覆盖全集。
5. 对所有参与文件计算 SHA-256 manifest，作为 methodology version。
6. Catalog 随 BreachWeave 版本固定，不在运行时静默跟随外部目录变化。

建议方法论版本格式：

```text
wstg-local-master-2026-10-28+<manifest_sha256_prefix>
```

WSTG 测试域：

| 域 | ID | 主要关联实体 |
|---|---|---|
| Information Gathering | WSTG-INFO | origin、page、bundle、architecture、entry point |
| Configuration/Deployment | WSTG-CONF | origin、server、header、framework、feature flag |
| Identity Management | WSTG-IDNT | registration、account provisioning、role model |
| Authentication | WSTG-ATHN | login、MFA、reset、lockout、remember-me |
| Authorization | WSTG-ATHZ | endpoint、object ID、role pair、admin function |
| Session Management | WSTG-SESS | cookie、token、logout、concurrency、JWT |
| Injection | WSTG-INJT | input、header、query、body、file、template |
| Error Handling | WSTG-ERRH | endpoint、parser、exception path |
| Weak Cryptography | WSTG-CRYP | transport、token、encrypted field、crypto primitive |
| Business Logic | WSTG-BUSL | workflow、quota、price、approval、state transition |
| Client-side | WSTG-CLNT | DOM sink、storage、CORS、messaging、redirect |
| API Testing | WSTG-APIT | REST/GraphQL endpoint、object/function authorization |
| WebAssembly | WSTG-WASM | wasm module、exports/imports、source map/debug symbol |

### 6.2 WSTG 适用性不是全量笛卡尔积

不能对每个 endpoint 机械生成 115 条义务。需要以实体 capability 和触发信号做适用性映射。

示例：

```text
IF entity.kind = endpoint
AND parameters contain object identifier
AND roles >= 2 or auth_scope != anonymous
THEN applicable:
  WSTG-ATHZ-02
  WSTG-ATHZ-03
  WSTG-ATHZ-04
  WSTG-APIT-02 / WSTG-APIT-04（API 时）

IF capability contains upload
THEN applicable:
  相关 WSTG-INJT 测试项
  WSTG-ATHZ 授权检查
  WSTG-BUSL 文件处理流程检查

IF entity.kind = login/reset/mfa
THEN applicable:
  WSTG-IDNT
  WSTG-ATHN
  WSTG-SESS
  WSTG-BUSL

IF entity.kind = bundle/page and signals contain wasm
THEN applicable:
  WSTG-WASM-01
  WSTG-INFO-05
```

适用性引擎由代码规则产生候选，LLM 负责结合业务上下文细化 RiskPoint。LLM 不能自行删除 required obligation，只能建议 `not_applicable`，最终由 Host 校验理由。

### 6.3 WSTG-INFO 与 Recon 的关系

WSTG-INFO 不应在攻击阶段重复执行一遍。SurfaceBuilder 应把 Recon 证据映射为 WSTG-INFO 的已有 disposition：

- 已完成并有证据 -> `tested_negative` 或 `verified_finding`
- 发现信息泄漏 -> `verified_finding/candidate`
- 未执行但可执行 -> `pending`，退回 Recon
- 外部条件缺失 -> `blocked`

因此 WSTG 同时提供 Recon Gate 的方法论检查和 Surface 第一维的风险点来源。

### 6.4 第二维：基于 threat-modeling-main 的 STRIDE

STRIDE 的固定来源为：

```text
C:\Users\Administrator\Desktop\AI自动化渗透测试\重构参考\threat-modeling-main
```

已核查的本地版本是 `3.2.0 (20260512a)`。应使用其中的 `P2-DFD-ANALYSIS.md`、`P3-TRUST-BOUNDARY.md`、`P5-STRIDE-ANALYSIS.md`、`stride-library.yaml`、`stride-controls-mapping.yaml`、`stride_cwe_mapping.json`、`verification-mappings.yaml`、`phase2/completeness-rules.yaml` 和 `stride_matrix.py`，而不是只把 STRIDE 六个问题写进 Prompt。

建议新增：

```text
scripts/build-stride-catalog.ts
docs/methodology/stride-catalog.json
docs/methodology/stride-manifest.json
```

Catalog 至少包含：

- 源版本、许可证、本地相对路径和逐文件 SHA-256。
- 四类 DFD 元素：Process、DataStore、DataFlow、ExternalInteractor。
- STRIDE-per-element 矩阵：Process=`S,T,R,I,D,E`；DataStore=`T,R,I,D`；DataFlow=`T,I,D`；ExternalInteractor=`S,R`。
- 交互规则：以 target 元素适用类别为基线；ExternalInteractor 作为 source 时补 `S,R`。
- 类别问题、触发/排除条件、primary CWE/CAPEC、控制、mitigation pattern 和 test pattern。
- completeness rules 及原始规则引用；规则冲突时记录来源，不静默覆盖。

#### 6.4.1 先把黑盒攻击面投影成轻量 DFD

BreachWeave 是动态渗透测试系统，通常没有完整源码和部署架构，不能照搬白盒 DFD。SurfaceBuilder 应从已收集事实生成“证据支持的运行时 DFD”：

```ts
interface RuntimeDFDElement {
  id: string
  type: "process" | "data_store" | "data_flow" | "external_interactor"
  entity_refs: string[]
  zone_id: string
  auth_scope: string
  data_classes: string[]
  controls_observed: string[]
  confidence: "observed" | "inferred" | "unknown"
  evidence_refs: string[]
}

interface TrustBoundary {
  id: string
  from_zone: string
  to_zone: string
  crossing_flow_refs: string[]
  authn_observed?: boolean
  authz_observed?: boolean
  encryption_observed?: boolean
  integrity_observed?: boolean
  evidence_refs: string[]
}
```

映射例：浏览器/移动端/第三方回调方是 ExternalInteractor；API family、认证服务、异步 worker 是 Process；cookie/token/localStorage、可观察到的数据库/对象存储/队列是 DataStore；HTTP/WebSocket/消息/文件传输是 DataFlow。无法证明的内部组件标 `inferred` 或 `unknown`，不能伪装成事实。

Trust Boundary 至少按 anonymous/authenticated/admin/tenant、browser/server、internet/internal、third-party/first-party 和不同 origin 划 zone。每个跨区 DataFlow 必须记录可观察到的认证、授权、加密、完整性/签名、限速和审计控制；未知也是结论，会生成待验证义务。

#### 6.4.2 按元素和跨边界流生成义务

对每个 DFD 元素先套用确定性矩阵，再让 LLM 基于证据把类别细化为可执行风险点：

- Spoofing：调用者、角色、token、设备或上游服务是否可伪造。
- Tampering：客户端字段、状态、价格、角色、路径或跨边界数据是否被信任。
- Repudiation：关键操作是否缺少可验证审计，日志身份/时间/关联 ID 是否可伪造。
- Information Disclosure：响应、错误、时序、缓存和跨角色/跨租户差异是否泄漏。
- Denial of Service：无界输入、高代价查询、批量接口、压缩/解析/工作流是否可放大。
- Elevation of Privilege：低权限元素或低信任 zone 是否能到达高权限 Process。

跨 Trust Boundary 的风险点提高初始优先级，但不能仅凭“跨边界”认定漏洞。RiskPoint 应保留 `stride_refs`、`trust_boundary_refs`、CWE/control/verification refs，并与同实体、同漏洞类、同角色窗口的 WSTG RiskPoint 合并。

#### 6.4.3 STRIDE 完整性门限

本项目应比参考库默认的 80% 最低阈值更严格：

- DFD 元素覆盖必须为 100%；每个元素至少有风险点或合法 disposition。
- 每个元素的所有适用 STRIDE 类别必须有 RiskPoint、`not_applicable` 或 `blocked`。
- 缺失类别不能只写“未发现”；`not_applicable` 必须给出本质理由，`blocked` 必须说明缺少的外部条件。
- P0/P1 风险点必须有 CWE 或明确的人工分类理由，并带验证方法引用。
- 每个跨边界 flow 必须有控制记录；控制未知不能被当作控制存在。
- Catalog、矩阵、DFD 投影和 completeness 结果都进入 Gate evidence。

### 6.5 第三维：基于 BREAK-main 的业务 Lateral 扩展

Lateral 的固定来源为：

```text
C:\Users\Administrator\Desktop\AI自动化渗透测试\重构参考\BREAK-main
```

已核查的知识库版本为 `2.46.6`，许可证为 Apache 2.0。它是业务风险知识图谱，不是 Web 漏洞字典：当前结构包含 400 个 Risk（含子风险）、350 个 Avoidance、125 个 AttackTool、83 个 ThreatActor、20 个 BusinessDomain 和 1781 个 Case。实现时必须尊重这个定位，不能把全部 BREAK 风险机械套到每个 endpoint。

建议新增：

```text
scripts/build-break-catalog.ts
docs/methodology/break-catalog.json
docs/methodology/break-manifest.json
```

构建器以 `src/validation/breakSchema.ts` 和 `src/BREAK/**/*.json` 为权威输入，不能依赖可能滞后的说明文档计数。Catalog 保留：

- Risk 的 title/keywords/definition/description/complexity/influence/riskAssessment/observables。
- `relatedRisks` 的 `prerequisite | co-occurrence | escalation | variant` 有向关系。
- AttackTool 的 `directCauseRisks`、`indirectSupportRisks` 和 `prerequisite | co-used | alternative | capability-upgrade`。
- ThreatActor 的 build/use tool、direct/indirect risk，用于构造角色能力，不用于臆测现实攻击者身份。
- BusinessDomain -> riskDimension -> riskScene -> Risk 的场景结构。
- Avoidance 的 prevention/perception/detection/disposition、effectiveness 和 limitation。
- Case 只保留 ID、关联和来源索引，默认不把 1781 个摘要全部塞进模型上下文；需要核对现实攻击链时按需检索。
- 实体 version、updated、源路径、关系完整性、全库 manifest hash。

#### 6.5.1 两段式检索，避免泛化和矩阵爆炸

第一段用确定性 signal matcher，从 SurfaceEntity capability、workflow、业务词、参数语义、system-feature、finding 和页面菜单中检索 seed Risk/BusinessDomain/AttackTool。第二段只沿有类型的关系扩展：

1. seed Risk 的 prerequisite、escalation、variant 和 co-occurrence 各最多一跳。
2. 与 seed 直接致险/间接支持的 AttackTool，再沿 capability-upgrade/prerequisite 最多一跳。
3. 同一 riskScene 的 sibling risk 只作为候选，必须有目标业务证据才升级为 required。
4. Avoidance limitation 只在 Recon 已观察到相应控制时触发绕过义务。
5. 默认图深度不超过 2、每个 seed 候选有上限；超限按 evidence relevance、P0/P1、业务影响、攻击成本和新颖度排序。

LLM 可以做语义匹配和描述细化，但不能凭常识新造 BREAK ID，也不能把无目标证据的图邻居提升为 required。

#### 6.5.2 Lateral 义务的四种来源

| 来源 | 触发方式 | 产物示例 |
|---|---|---|
| 能力 sibling sweep | upload/export/reset/payment 等 capability | 同资源族、同 workflow、同对象字段的相邻测试 |
| 风险图扩展 | BREAK prerequisite/escalation/variant/co-occurrence | 从自动化登录扩展到撞库、养号和账号聚合前置条件核查 |
| 工具/能力扩展 | direct/indirect risk、capability-upgrade | 已观察无头浏览器防护时检查协议级自动化与模拟器路径差异 |
| 控制局限性 | 已观察到的 Avoidance + limitation | 验证验证码、设备指纹、签名、限速或风控在当前流程的绕过窗口 |

技术能力规则仍保留，作为 BREAK 检索 seed 和最低安全网：

| 能力 | 主要风险之外必须顺带检查 |
|---|---|
| upload | 文件名注入、路径穿越、SVG/HTML XSS、内容类型绕过、解析器、存储越权 |
| download/export | IDOR、路径穿越、公式注入、敏感数据、缓存隔离 |
| webhook/callback/url fetch | SSRF、重定向绕过、签名、重放、DNS/解析差异 |
| login/reset/MFA | 枚举、限速、token 重用、session fixation、流程跳步及自动化业务滥用 |
| GraphQL | introspection、BOLA/BFLA、alias/batch、深度/复杂度、字段级泄漏 |
| WebSocket | 握手授权、订阅越权、重放、跨租户消息、消息注入 |
| payment/approval/order | 价格篡改、状态跳步、竞态、重复提交、负数/边界值和批量套利 |
| search/filter/template | SQL/NoSQL/LDAP/template/expression 注入、资源消耗和批量枚举 |

BREAK 生成的义务必须保留 `break_refs`、触发事实、关系路径和 hop count。若与 WSTG/STRIDE 指向同一测试，只合并来源和优先级，不重复派发。

### 6.6 SurfaceBuilder 必须无探测能力

SurfaceBuilder 输入：

- Recon snapshot revision N
- 全部实体和 relation
- system features
- 已有 findings
- WSTG Catalog
- STRIDE Catalog、运行时 DFD、Trust Boundary 和 completeness rules
- BREAK Catalog、关系路径和 Lateral 规则
- 业务场景 Playbook 摘要

输出：

- SurfaceEntity revision
- RiskPoint
- CoverageObligation
- `coverage-skip` 建议
- `coverage-block` 建议

它不允许：

- 发 HTTP 请求
- 操作浏览器
- 调用漏洞扫描器
- 修改 ReconFact
- 直接把风险点标成 verified finding

建议使用无工具 LLM session 或只提供一个严格结构化 `surface_build_submit` 工具。Host 对输出做 schema、引用、去重和质量校验。

质量门槛：每条 RiskPoint 必须指向具体实体、角色/前置条件、测试方法、预期安全行为、差异 oracle、真实影响和触发证据。拒绝“测试常见漏洞”一类泛化条目。

## 7. EXPLORE 阶段：保留 Solver 自由探索

### 7.1 Solver 初始上下文

进入 EXPLORE 时，Solver 获得：

- Recon 摘要，不直接塞入全部原始结果
- 按优先级压缩的攻击面地图
- 高价值 system features
- 当前 verified/candidate findings
- 最高价值未覆盖区域
- Assessment revision
- 明确声明攻击面只是参考，不是白名单或固定任务列表

Solver 可以：

- 完全偏离推荐 RiskPoint
- 使用任意现有允许工具和方法
- 发现新 endpoint/page/workflow/role/system feature
- 提交候选 finding
- 提交测试结果和 negative evidence

Host 不因某次工具调用没有关联 RiskPoint 而拒绝执行。

### 7.2 新发现回流

新增 Host Bridge 动作：

```text
assessment_snapshot_get
assessment_discovery_submit
assessment_test_result_submit
finding_candidate_submit
```

权限建议：

| 动作 | executor | observer | reviewer | planner |
|---|---:|---:|---:|---:|
| assessment_snapshot_get | 读 | 读 | 读 | 读 |
| assessment_discovery_submit | 提案 | 否 | 否 | 否 |
| assessment_test_result_submit | 提案 | 否 | 审查 | 否 |
| finding_candidate_submit | 提案 | 否 | 审查 | 否 |

模型写入只能产生 candidate/proposal。Host 校验 scope、实体引用、证据、幂等键和 revision 后再写权威账本。

接受新发现后：

```text
recon_revision++
surface_dirty = true
```

根据变化触发局部或全量 Surface rebuild。

STRIDE 的建模粒度必须控制：API family/后端能力域作为 DFD Process，单个 endpoint 继续作为 SurfaceEntity。若把 300 个 endpoint 全部当成 Process，再机械套 `S,T,R,I,D,E`，会生成近 1800 个高度重复的类别格。正确做法是用 Process 检查身份、审计、可用性和信任边界，再把对象授权、参数篡改、输入和 workflow 验证落到具体 endpoint。

BREAK 也分候选与强制义务：语义命中只产生 `candidate`；存在目标流程、参数、菜单、控制或 finding 证据时升级为 `supported`；能够说明具体入口、前置条件和验证方法时才成为 `required`。例如看到 `/login` 只能证明存在登录面，不能直接断言撞库、养号、账号交易全部适用；只有批量登录能力、营销流程、设备/验证码控制或相邻 finding 等证据支持时，相关 BREAK 路径才进入 Gate。

## 8. Observer 软提醒设计

### 8.0 当前 Observer 的真实执行逻辑与最小改造边界

当前实现已经符合“旁路观察、少干预 Solver”的方向：

```text
Solver tool/message events
  -> observer-store 持久化 round 与截断 tool log
  -> 每 6 个 assistant round / 成功获取 hint / agent_end 入 review queue
  -> 独立 Observer session 读取最近 10 轮
  -> 维护 ideas/memory
  -> 仅在持续低效时调用 send_efficiency_reminder
  -> cooldown + message/activity fingerprint 通过后，以 steer 注入 Solver
```

具体代码事实：Observer 的 `state.json`、`review-queue/*.json`、`rounds/*.json` 已位于 Solver session 下的 `.observer/`，具备跨 turn 恢复基础；普通 Solver 对 ideas/memory 只读；提醒有 6 round 冷却、12 round 重复模式窗口，并在 Challenge 完成后抑制。`agent_end` 同时还会触发 Ralph continuation：Host 明确返回未完成时，Ralph 会自动开启下一 turn，最多容忍 5 次无工具活动 continuation 和 10 次连续错误。

因此不应修改 Solver 的工具循环或把覆盖任务变成强制白名单。最小侵入改造只有四处：

1. Host Bridge 新增只读 `assessment_get_snapshot`，Observer review 入队时取得紧凑快照；不让 Observer 从 160 字符工具摘要猜覆盖率。
2. 扩展 `ObserverReviewPayload` 和 Observer prompt，加入 snapshot、pending reminder 与 revision；保留 sidecar session、ideas/memory 和现有 review queue。
3. 将现有通用 reminder 指纹扩展为 `category + recon_revision + surface_revision + locator`。普通覆盖提醒排到下一轮，在当前 turn/路线结束后投递；只有长期重复低效且确有更高价值方向时沿用 `steer`，不在工具执行中打断。
4. Ralph 的 completion 查询升级为 lifecycle decision：`running` 才 continuation；`pausing/paused/waiting_user/resuming/terminal` 一律不自动续跑。否则用户暂停后 Ralph 仍可能重启 Solver。

不建议让 Observer 自己运行 Recon、重建 Surface、判定 Challenge 完成或直接写 coverage disposition；这些仍由 Host 负责。Observer 只提出“当前路线结束后建议补哪里”，Solver 可基于实际证据决定何时采纳。

### 8.1 Assessment Snapshot

Observer 每次 review 额外获得：

```ts
interface ObserverAssessmentSnapshot {
  phase: string
  recon_revision: number
  surface_revision: number
  surface_dirty: boolean
  unresolved_recon_sources: GapSummary[]
  new_entities_since_surface: number
  high_value_unmodeled_entities: EntitySummary[]
  pending_high_risk_obligations: ObligationSummary[]
  blocked_requirements: GapSummary[]
  recent_new_findings: FindingSummary[]
  predicted_final_gate_gaps: GapSummary[]
}
```

### 8.2 四类提醒

| 前缀 | 触发条件 | 提醒方向 |
|---|---|---|
| `[RECON_GAP]` | required source partial/failed，或 finding 暗示漏采 | 补采具体来源/区域 |
| `[SURFACE_DIRTY]` | 新实体未建模，或新角色/workflow/system feature 出现 | 完成当前路线后刷新攻击面 |
| `[TEST_STUCK]` | 重复低增量行为，已有更高价值盲区 | 切换到具体高价值方向 |
| `[FINAL_PREP]` | Solver 准备报告且 Gate 预测有 gap | 先补最小必要缺口 |

`SURFACE_DIRTY` 推荐触发阈值：

- 新增高价值实体、角色、workflow、GraphQL、WebSocket 或 system feature：立即提醒。
- 普通实体累计新增 >= 5 个或相对增长 >= 15%：提醒。
- 同一 revision、同一类别只提醒一次。
- 每次最多 1-3 条建议。
- 保留现有 6 round 冷却思想，但改为 `category + revision + locator` 指纹去重。

Observer 不在 Solver 正在思考、调用工具或验证 finding 时强行 steer。它持续计算 gap，但先放入 `pending_reminders`，只在 Solver 一轮探索/验证结束、finding checkpoint、主动换方向/idle、准备提交报告前投递。

普通提醒使用 `follow_up` 排到下一轮，不打断当前路线；只有 scope 安全问题或用户明确按下暂停才使用 `abort`。同一 `category + revision + locator` 只投递一次。Surface 重建采用 debounce：普通参数和低价值 URL 先批量合并，只有新 endpoint、角色、workflow、system-feature 或高价值 capability 才立即标记 dirty。Observer 是“探索后复盘提醒”，不是实时遥控 Solver。

## 9. Finding 验证与漏洞产出

### 9.1 Finding 状态

```text
candidate -> verifying -> verified
                      -> rejected
                      -> blocked
candidate -> duplicate
```

Host 接受 candidate 的最低要求：

- title、class、severity proposal
- 具体 entity/endpoint/workflow
- 角色和前置条件
- 复现步骤
- evidence refs
- 差异或安全边界说明
- 影响

### 9.2 提高漏洞产出的策略

全面性不能只追求“测过”。调度优先级建议：

```text
priority_score =
  asset_value
  * exploitability_signal
  * role_boundary_weight
  * evidence_confidence
  * lateral_multiplier
  * novelty_factor
  / estimated_cost
```

高价值优先信号：

- 跨角色/跨租户对象 ID
- 客户端可控 role、price、status、owner 字段
- 上传、导入、导出、模板、回调
- 管理菜单或隐藏 API
- Bundle 中存在但 UI 不可达的接口
- 签名/加密只在客户端实现
- 多步骤审批、支付、重置、MFA
- GraphQL/WebSocket/WASM
- 新 finding 的相邻资源族

发现一个有效漏洞后，不应立即结束；应自动派生 sibling sweep：

- 同一路由族
- 同对象不同操作
- 同操作不同角色
- 同参数在其他入口
- 同类能力的横向实体

这通常比继续随机 fuzz 更能增加有效漏洞数量。

## 10. Final Coverage Gate

### 10.1 Gate 维度

| 维度 | 检查 |
|---|---|
| D0 Recon 完整性 | required source 均 complete/not_applicable，或为有证据的 external block |
| D1 Surface 新鲜度 | `surface_revision == recon_revision`，无 high-value unmodeled entity |
| D2 WSTG 覆盖 | 所有 required WSTG obligation 有合法 disposition |
| D3 STRIDE/BREAK-Lateral 覆盖 | DFD 元素适用 STRIDE 分类、跨边界 flow、BREAK seed 派生的 required 义务均有合法 disposition |
| D4 角色/流程覆盖 | 关键 role pair、对象边界、workflow step 有测试或 block |
| D5 证据质量 | negative、verified、skip、block 均满足各自证据/理由要求 |
| D6 Finding 状态 | 无高价值 candidate 长期未验证，报告包含全部 verified finding |
| D7 System Feature | WAF/签名/加密/header 等已 promote 为义务或 retire |

### 10.2 Gate 结果

```ts
interface CoverageGateResult {
  can_close: boolean
  exit_code: 0 | 3
  revision: number
  discovery_gaps: CoverageGap[]
  surface_gaps: CoverageGap[]
  test_gaps: CoverageGap[]
  evidence_gaps: CoverageGap[]
  blocked_needs_user_input: CoverageGap[]
  generated_at: string
}
```

Gap 必须包含：

- locator/entity id
- dimension/WSTG ref
- reason
- required action
- expected evidence
- priority
- whether auto-remediable

### 10.3 报告与完成解耦

建议保留工具名 `challenge_submit_report` 以减少兼容改动，但改变语义：

1. 写入 report draft。
2. 不更新资产为 positive。
3. 不调用 `finishChallenge()`。
4. Host 自动进入 FINAL_GATE。
5. Gate PASS 后由 Host 内部 `finalizeChallenge()` 更新终止状态并停止 Solver。
6. Gate FAIL 时返回 gap 摘要并进入 FOCUSED_REMEDIATION。

Solver 不获得直接调用 `coverage_gate_run` 或 `challenge_finalize` 的权限。

### 10.4 Focused Remediation

补缺任务按 gap 聚合，避免把几十个 CoverageCell 原样塞给 Solver：

```text
区域: /admin/users
原因: 新发现 8 个管理 API 未完成 user/admin 差异验证
必须回答:
  - 普通用户能否访问对象读取/修改/删除接口
  - 批量接口是否复用相同授权
期望证据:
  - 两个角色的同构请求/响应
参考 WSTG:
  - WSTG-ATHZ-02/03/04
```

补缺仍允许 Solver 自由选择工具和具体测试顺序。

自动补缺轮数暂不固定为 2。第一版保留可配置预算和防死循环上限，但默认值通过靶场实测确定；停止条件综合新攻击面增量、新 finding 增量、连续无收益轮次、剩余时间和未完成义务价值，而不是只数轮次。

UI 顶层状态按产品语义简化：只要流程正常跑到终止点，无论是否仍有 block、用户跳过项或预算缺口，都显示“已完成”。内部仍保留 `completion_detail`、coverage gap、block 和证据状态，用于报告、审计和后续继续测试，但不把 `user_waived`、`incomplete_blocked` 等内部术语作为用户可见状态。取消、运行错误和仍在等待用户不属于“已完成”。

### 10.5 用户暂停、插入对话与必要请求

当前项目只有部分基础能力：Solver RPC 已支持 `prompt/steer/follow_up/abort`，UI 也有通用 command 入口；Solver session/workspace 位于宿主持久化目录；Taric WorkRun 支持崩溃后的 reclaim/resume。但是现有 Stop 会停止 `--rm` 容器，Planner 可能因资产仍 pending 再次调度；`planner_enabled` 是配置开关，不是暂停状态；也没有持久化的 challenge 级对话、用户请求和显式安全 checkpoint。因此不能把 Stop 按钮改名就当成可靠暂停。

#### 10.5.1 Challenge 生命周期

新增独立于 `planner_enabled` 和 `instance_status` 的执行状态：

```ts
type ExecutionStatus =
  | "running"
  | "pausing"
  | "paused"
  | "waiting_user"
  | "resuming"
  | "completed"
  | "cancelled"
  | "error"
```

所有自动调度入口，包括 planner tick、background planner、remediation、BrowserDeepProvider 和 WorkRun recovery，首先检查 `execution_status`。只有 `running/resuming` 可创建新工作；暂停或等待用户时不得因 pending asset 自动拉起 Solver。

#### 10.5.2 暂停协议

用户点击暂停时采用“立即硬暂停”，不等待当前工具自然结束：

1. Host 先原子写入 `pausing`、递增 `pause_generation` 并建立写栅栏；Planner、Ralph、Recon、BrowserDeep、remediation 和 recovery 立即停止派发。
2. Host 发送 RPC `abort`、取消工具 AbortSignal，并终止当前工具进程组；短暂清理后仍未退出则强制停止/杀死整个 Solver 容器，保证 shell、扫描器、浏览器及其子进程全部停止。
3. Host 拒绝旧 `pause_generation`、旧 attempt 或旧 WorkRun generation 的迟到写入。
4. 保存最后一个 durable checkpoint，并额外写 `InterruptionRecord`：中断阶段、tool call、参数摘要、已有 Artifact、外部副作用是否可能发生、Browser storageState ref 和待核对项。强制中断不能伪装成完整 checkpoint。
5. 宿主 session、workspace、Assessment、Artifact 和凭据 vault 保留，状态变为 `paused`。
6. 恢复时不尝试恢复进程现场；先检查工具输出和目标外部状态，把中断动作判为 `completed/partial/uncertain/not_started`，再补测、重做或跳过。对 mutation 必须先核对，禁止盲目重放。

Taric 不能只依赖 lease 过期恢复。应增加 Host/operator 专用的 `work.suspend` 与 `work.takeover`（或等价 revoke + generation takeover），使暂停立即封存旧 attempt，恢复时无需等待 lease。Taric 不可用时由 Assessment 写栅栏先保证不偷跑，恢复建立新 attempt 并引用旧 checkpoint。

#### 10.5.3 恢复和用户插话

用户可在 paused/waiting_user 状态添加文本、结构化输入或 secret。Host 先把它持久化为 ConversationEvent，然后：校验 pause generation；加载 checkpoint 和已有 session；重新校验 scope、目标、认证及前提；重建 browser context 并载入 storageState；外部状态变化时局部重建 Surface；以同一逻辑 Solver identity 创建新 attempt，把用户消息作为 `follow_up` 注入已有 session，不重发初始 task；成功接管后再标记 `running`。

运行中普通插话不必暂停：写入 conversation outbox，在当前 `agent_end` 后投递。只有用户选择“立即暂停并插入”，或消息改变 scope、凭据、L2 副作用授权时，才走完整暂停协议。

#### 10.5.4 必要用户请求，而不是处处审批

新增持久化 `UserRequest`：

```ts
interface UserRequest {
  id: string
  kind: "credential" | "mfa" | "captcha" | "scope" | "side_effect" | "business_context" | "choice"
  blocking_scope: "task" | "role" | "challenge"
  question: string
  why_needed: string
  requested_fields: Array<{ name: string; secret: boolean; required: boolean }>
  alternatives_tried: string[]
  fallback: string
  related_obligation_ids: string[]
  status: "open" | "answered" | "declined" | "expired" | "cancelled"
  dedupe_key: string
}
```

只在以下情况请求用户：高价值角色覆盖缺凭据/MFA/验证码且不可替代；需要不可替代的 L2 动作；scope 真正歧义且继续可能越界；必须由用户补充会实质改变结果的业务语义或选择。

普通工具选择、低价值猜测、一次超时、可自动重试、可从 Recon 推断的信息、仍有其他可测试方向时，禁止请求用户。每个请求必须带 `alternatives_tried`、fallback、关联义务和 dedupe key，并限制每阶段/每 Challenge 的请求数量。

`blocking_scope=task/role` 时只挂起相关分支，继续测试其他区域；只有输入阻塞强制阶段或所有剩余高价值工作时，整个 Challenge 才进入 `waiting_user`。审批框允许自定义文本；secret 字段进入 credential vault，模型只收到 `credential_ref/auth_context_id` 和使用结果。用户拒绝或不回应时执行 fallback，把对应义务记为 blocked，然后继续其余流程。

## 11. 与当前源码的具体落点

### 11.1 新增模块

```text
packages/core/src/challenge/assessment-types.ts
packages/core/src/challenge/assessment-store.ts
packages/core/src/challenge/assessment-manager.ts
packages/core/src/challenge/execution-lifecycle.ts
packages/core/src/challenge/checkpoint-manager.ts
packages/core/src/challenge/conversation-store.ts
packages/core/src/challenge/user-request-store.ts
packages/core/src/challenge/auth-context-store.ts
packages/core/src/challenge/recon/recon-coordinator.ts
packages/core/src/challenge/recon/recon-provider.ts
packages/core/src/challenge/recon/http-provider.ts
packages/core/src/challenge/recon/route-provider.ts
packages/core/src/challenge/recon/scanner-provider.ts
packages/core/src/challenge/recon/bundle-provider.ts
packages/core/src/challenge/recon/bundle-analyzer.ts
packages/core/src/challenge/recon/api-prefix-resolver.ts
packages/core/src/challenge/recon/browser-probe.ts
packages/core/src/challenge/recon/recon-gate.ts
packages/core/src/challenge/surface/wstg-catalog.ts
packages/core/src/challenge/surface/stride-catalog.ts
packages/core/src/challenge/surface/runtime-dfd.ts
packages/core/src/challenge/surface/trust-boundary.ts
packages/core/src/challenge/surface/applicability-rules.ts
packages/core/src/challenge/surface/stride-rules.ts
packages/core/src/challenge/surface/break-catalog.ts
packages/core/src/challenge/surface/break-retriever.ts
packages/core/src/challenge/surface/lateral-rules.ts
packages/core/src/challenge/surface/surface-builder.ts
packages/core/src/challenge/surface/surface-quality-gate.ts
packages/core/src/challenge/coverage/final-gate.ts
packages/core/src/challenge/coverage/remediation-planner.ts
packages/core/src/challenge/findings/finding-manager.ts
scripts/build-wstg-catalog.ts
scripts/build-stride-catalog.ts
scripts/build-break-catalog.ts
docs/methodology/wstg-catalog.json
docs/methodology/wstg-manifest.json
docs/methodology/stride-catalog.json
docs/methodology/stride-manifest.json
docs/methodology/break-catalog.json
docs/methodology/break-manifest.json
```

### 11.2 修改模块

| 文件 | 修改 |
|---|---|
| `challenge/manager.ts` | `launchSolver` 前调用 baseline；提交报告改为 draft；完成判定改用 termination status；增加 remediation 调度 |
| `challenge/store.ts` | `computeChallengeCompleted` 只认 `verified_complete`；旧资产 scanned 仅作兼容投影 |
| `runtime/runtime.ts`、`solver/rpc/*` | 增加 suspend/checkpoint/restore；恢复已有 session 时不重复初始 task |
| `challenge/host-bridge-types.ts` | 增加 assessment/finding 动作 |
| `challenge/host-bridge-handler.ts` | 路由 snapshot、discovery、test result、finding candidate |
| `challenge/host-bridge-security.ts` | 按角色增加新动作，保持审计/限流/超时 |
| `challenge/coverage-governance.ts` | 从资产布尔覆盖升级为 Assessment Gate 投影；保留旧 API 兼容 |
| `solver/extension/challenge-observer/*` | 注入 Assessment Snapshot、四类提醒和 revision 冷却 |
| `runtime/assets/browser-sidecar.mjs` | 修复路径、扩展请求/响应/UI context/角色/动作采集 |
| `config/tools/native-runtime.ts` | sidecar 路径、browser deep probe 动作和 Artifact 引用 |
| `config/tools/native-report.ts` | 本地写入改为 Host candidate submit；本地文件只作缓存 |
| `ui-web/src/server.ts` | Assessment summary/recon/surface/findings/progress API |
| `ui-web/src/components/challenge/page.tsx` | 增加 Assessment 入口，不移除现有页面 |

### 11.3 Assessment 文件布局

建议继续沿用现有 Challenge 目录和锁：

```text
challenge/<id>/
  challenge.json
  assessment/
    state.json
    execution.json
    checkpoints/<generation>.json
    conversation/events.jsonl
    conversation/outbox.jsonl
    user-requests/open.json
    auth/contexts.json
    sources.json
    recon-facts.jsonl
    entity-index.json
    bundles/manifest.json
    surface/current.json
    surface/revisions/<revision>.json
    surface/runtime-dfd.json
    surface/trust-boundaries.json
    surface/methodology-lock.json
    surface/break-paths.jsonl
    coverage/obligations.jsonl
    findings/candidates.jsonl
    findings/verified.json
    gates/<gate-revision>.json
```

大响应、Bundle 和浏览器 body 不进入这里，放 Artifact/Taric，只保存 hash/ref。

复用 `store.ts` 的目录锁和原子写思路，但应抽成共享 store helper；不要在多个新模块复制锁实现。

## 12. 分阶段实施

### 12.1 实施纪律与阶段准入

任务必须按阶段串行验收，不以“代码已合并”视为完成。每阶段依次通过：单元测试、集成测试、固定靶场效果对比、状态持久化/重启测试和回滚验证；任何关键断言失败，都不得启用下一阶段的生产开关。所有新能力使用 feature flag，先单 Challenge、再小比例、最后全量启用。

测试分为两类：`正确性测试` 防止状态错乱、漏写和提前结束；`效果测试` 验证 endpoint/workflow/role/vulnerability recall 是否真的提升。阶段基线使用同一组授权靶场、相同模型、相同预算和至少三次重复运行，避免把随机波动误判成改造收益。

### 12.2 推荐实施顺序

| 阶段 | 交付范围 | 本阶段必须测试 | 效果观察与退出条件 |
|---|---|---|---|
| S0 基线与回归框架 | 固定靶场真值、运行配置、指标采集和改造前结果 | 重复运行稳定性、指标计算、已知 endpoint/finding 真值校验 | 得到可重复 baseline；否则不能判断后续是否有效 |
| S1 完成语义 | report draft/finalize 分离，FinalGate 成为唯一完成入口，兼容旧数据 | 提交全部报告、重复提交、重启、旧 Challenge 迁移 | 不再因报告提交提前停止；原有报告/finding 不丢失 |
| S2 硬暂停与审批底座 | lifecycle、pause generation、强杀工具/容器、InterruptionRecord、conversation/UserRequest、Taric suspend/takeover | 分别在模型思考、shell、crawler、浏览器、写文件和 mutation 中暂停；立即恢复与重启后恢复；旧代迟到写入 | 所有执行在限定时间内停止；恢复不偷跑、不重复 mutation；审批可挂起 task/role/challenge |
| S3 Assessment 与并发账本 | ReconFact 追加账本、稳定 entity key、单写队列、revision、CAS、Artifact ref | 两个 Solver 同时报同一 endpoint、不同 endpoint、乱序写、重复写、构建中新增事实、进程崩溃 | 不丢事实、不重复实体；旧 Surface 不能覆盖新 revision；dirty 状态正确 |
| S4 最小 Recon 基线 | HTTP probe、katana crawler、受控 content discovery、发现型 Nuclei、匿名 Browser baseline、Recon Gate | Provider 超时/失败/重试、scope、限速、幂等、Artifact、重启续跑 | 对基础 Web 靶场 endpoint/page recall 明显高于 baseline，且不能以一个工具冒充其他 source |
| S5 Bundle 与 API 闭环 | Bundle 分类、业务深读/vendor grep/runtime 忽略、secret/system feature、API prefix 反推和真实端点验证 | SPA、chunk、source map、相对 API、多 baseURL、401/403/404/WAF、下载失败 fallback | 隐藏 API recall 提升；错误 prefix 不进入 verified；每个 Bundle 有最终 disposition |
| S6 WSTG Surface | 固定 Catalog、merged 映射、capability applicability、实体级义务 | Catalog hash、场景增删、实体映射、not_applicable reason、规模上限、无网络保证 | 适用 WSTG 域无系统性遗漏，义务数量可控且可追溯 |
| S7 STRIDE Surface | Runtime DFD、Trust Boundary、STRIDE-per-element、CWE/control/verification refs | DFD 元素矩阵、跨边界 flow、unknown 置信度、完整性规则、与 WSTG 去重 | 能发现 WSTG 未直接表达的信任边界/身份/审计风险，不产生端点×六类笛卡尔积 |
| S8 BREAK Lateral | BREAK Catalog、seed、typed path、有限 hop、supported/required 升级 | 上传、认证、支付等场景的 sibling/capability 路径；无 seed、循环关系和预算上限 | 找到相邻攻击面，同时保持低误扩展；每条义务能回溯 seed 与关系路径 |
| S9 自由探索联动 | Solver 继续自由选路；新发现回流；Observer Snapshot、自然边界 outbox、冷却；Ralph lifecycle-aware | Observer/Ralph 竞态、当前工具不被普通提醒打断、重复提醒、暂停期间消息、finding 回流 | 不降低 Solver 自主性；高价值 gap 能被提醒；无刷屏、无暂停后续跑 |
| S10 FinalGate 与补缺 | D0-D7、多层 skip/block/evidence 校验、定向 remediation、可配置停止条件 | 无证据 positive、滥用 skip、external block、预算耗尽、补缺后 revision、报告 finalize | 已知漏洞 recall 和覆盖率高于 S9；Gate 不制造死循环，也不把缺口伪装成完成 |
| S11 BrowserDeep 与 UI 灰度 | 仅由信息稀薄或 finding 相邻面触发的区域深爬，多角色差异；进度/暂停/审批 UI | 触发与不触发样例、动态菜单、多步骤流程、MFA、L2 动作、storageState 恢复、灰度回滚 | 深爬带来新增有效 endpoint/finding，成本可接受；未触发区域绝不全站强跑 |

依赖关系是硬约束：`S0→S1→S2→S3→S4→S5→S6→S7→S8→S9→S10→S11`。开发可并行准备 Catalog 或 UI，但上线开关必须遵循该顺序。特别是 S3 未通过前不得并行接入多个 Recon Provider；S5 未通过前不得声称信息收集全面；S8 未通过前不得启用终局覆盖 Gate。

### 12.3 功能包与代码改动清单

以下功能包用于代码拆分和多人协作，实际启用顺序以上述 S0-S11 阶段准入为准。

### 功能包 A：消除假完成与修复浏览器运行时

改动：

- `challenge_submit_report` 不再默认 positive
- 报告提交不再触发 Challenge 完成
- 新增 termination status，旧数据迁移为 unknown/incomplete
- 修复 sidecar 路径
- 添加 open/snapshot/click/fill/network/response body smoke test

验收：

- Solver 提交所有入口报告后 Challenge 仍不会绕过 FinalGate
- 旧 finding/report 不丢失
- sidecar 容器内可稳定启动并抓取 Network

### 功能包 B：AssessmentStore、并发账本与 Host 生命周期

改动：

- phase、revision、source state、termination status
- `ensureAssessmentBaseline()` 接入 `launchSolver()`
- Assessment summary API
- execution lifecycle、用户暂停、checkpoint、持久化 conversation/user request
- 立即硬暂停、工具进程组/容器终止、InterruptionRecord、恢复核对
- Taric `work.suspend/work.takeover` 或等价 Host revoke + generation takeover
- ReconFact 稳定键、单写队列、revision 与 Surface CAS
- 失败恢复、原子写、幂等更新

验收：

- 重启后阶段和 revision 可恢复
- 初始 Recon 未闭环时普通 Solver 不启动
- external block 不会造成死循环
- paused/waiting_user 时 Planner、remediation 和 recovery 不会偷跑
- 任何工具执行中均可强制暂停；恢复检查中断状态后补测，不盲目重放 mutation
- 两个 Solver 并发发现同一/不同 endpoint 时不重复、不丢失，旧 Surface 不能覆盖新 revision

### 功能包 C：强制 Recon 与 Bundle 闭环

改动：

- CompositeWebReconProvider 组合 crawler、HTTP probe、content discovery、template candidate 和参数发现；AIPTS 仅为参考能力名称
- Runtime 固定引入 katana、ProjectDiscovery httpx、subfinder/amass、gau/waybackurls、arjun/paramspider 等选定工具版本
- HTTP、Route、Bundle、Browser baseline、SystemFeature Provider
- Bundle 分流、API 前缀反推和验证
- Recon Gate
- Artifact/Taric evidence 引用

验收：

- 各 Provider 原始结果可追溯，路由/参数/脚本/表单被规范化入账；不得用 Nuclei 或目录爆破冒充 crawler 覆盖
- 每个 Bundle 有最终分类和分析状态
- 每个 API prefix 有验证或 block 证据
- 重跑不产生重复实体
- 可用角色均有浏览器/Network 基线

### 功能包 D：三维方法论 SurfaceBuilder

改动：

- 构建并固定 WSTG Catalog
- 构建并固定 threat-modeling-main STRIDE Catalog
- 从动态事实生成运行时 DFD、Trust Boundary 和跨边界 flow
- 构建并固定 BREAK Catalog，加入带类型、有限跳数的业务风险检索
- applicability rules
- STRIDE completeness 和 Lateral 规则
- RiskPoint 合并和质量门槛
- CoverageObligation 初始化

验收：

- WSTG 源码新增场景不会因 checklist 滞后而漏入 Catalog
- merged WSTG 场景不重复
- 三个 Catalog 均有源版本、逐文件 hash、manifest 和许可证记录
- 每个 DFD 元素与跨边界 flow 均有适用 STRIDE disposition
- BREAK 候选可回溯到 seed fact 和完整关系路径，且无实体笛卡尔积
- 同一风险被多维命中时合并
- 不生成“测试常见漏洞”式空泛任务
- SurfaceBuilder 无网络能力

### 功能包 E：自由探索联动

改动：

- Assessment Host Bridge 动作
- 新发现回流、surface dirty 和局部重建
- Observer Snapshot 与四类提醒
- candidate finding 统一进入 Host

验收：

- 自由探索工具不受攻击面白名单限制
- 新 endpoint 不丢失
- Observer 提醒有 revision 冷却、不刷屏
- high-value 新实体会触发 Surface 更新提示

### 功能包 F：FinalGate 与定向补缺

改动：

- D0-D7 Gate
- report draft/finalize 解耦
- remediation planner
- incomplete/user-waived 状态

验收：

- 无证据 positive 被拒绝
- blocked 不能冒充 skip
- Gate 失败不删除 finding
- 预算耗尽不自动 complete
- 补缺后 revision 和 obligation 正确更新

### 功能包 G：深度浏览器与前端

改动：

- Hackbrowser 关键能力集成
- 按区域 dispatch
- 多角色差异采集
- Assessment Recon/Surface/Findings/Progress 页面

验收：

- 深爬只在明确触发条件下运行
- 动态菜单、多步流程和动作触发 API 可入账
- UI 可查看 gap、证据和最终状态

## 13. 测试策略

### 13.1 单元测试

- lifecycle 合法转换、pause generation 栅栏和旧 attempt 写入拒绝
- InterruptionRecord 分类与恢复决策，mutation 不可盲目重放
- ReconFact 并发幂等、实体模板化、单写队列和 Surface CAS
- URL、endpoint、参数、角色规范化
- ReconFact 稳定 ID 和幂等合并
- Bundle 分类
- API prefix 候选评分和 404 否决
- WSTG Catalog 解析、merged 映射和 manifest
- WSTG applicability rules
- STRIDE Catalog 解析、per-element/per-interaction 矩阵和 manifest
- Runtime DFD 投影、Trust Boundary、跨边界控制未知处理
- STRIDE 元素/分类完整性与 CWE/control/verification refs
- BREAK Catalog 解析、实体/关系完整性和 manifest
- BREAK seed 检索、typed relation、hop/budget 限制和 sibling 升级规则
- 三维命中与 RiskPoint 去重
- skip/block 区分
- FinalGate D0-D7
- Observer reminder 指纹和冷却

### 13.2 集成测试

- 在模型、shell、crawler、浏览器和 mutation 执行中硬暂停，验证容器/子进程停止、Ralph 不续跑、恢复先核对再补测
- task/role 审批只挂起对应分支，scope 审批使 Challenge 全局 waiting_user
- 两个 Solver 并发写同一/不同 endpoint；Surface 构建期间注入新事实并验证 dirty + 增量重建
- `RECON -> SURFACE -> EXPLORE -> FINAL_GATE`
- Recon external block 后仍进入探索，但不能 verified complete
- Bundle 下载 -> 分析 -> prefix -> 真实验证
- 下载失败 -> browser response body fallback
- finding -> sibling discovery -> surface dirty -> rebuild
- Recon facts -> runtime DFD -> trust boundary -> STRIDE obligation
- workflow/capability -> BREAK seed -> typed path -> lateral obligation
- report draft -> gate fail -> remediation -> gate pass
- 进程重启与 WorkRun 恢复
- Taric 暂时不可用时 Artifact/outbox 降级

### 13.3 靶场回归集

至少准备以下带已知真值的靶场：

1. SPA + 隐藏 API + source map
2. 多角色 RBAC/IDOR
3. 文件上传及 lateral 漏洞
4. 密码重置/MFA/会话流程
5. GraphQL
6. WebSocket
7. 动态菜单和多步业务流程
8. 客户端签名/加密 API
9. WAF/验证码/自定义 Header
10. WebAssembly

比较改造前后：

- endpoint recall
- page/workflow recall
- role boundary recall
- 已知漏洞 recall
- 有效 finding 数
- 重复 finding 比例
- 无证据 finding 比例
- Recon/Surface/总耗时
- Browser deep crawl 成本
- FinalGate 补缺贡献的新增漏洞数

核心成功指标不是 RiskPoint 数量，而是：已知漏洞召回率、攻击面实体召回率、角色/业务流程覆盖率和最终有效漏洞数量提升。

### 13.4 每阶段效果判定

每个阶段保存独立实验报告，至少包含：代码/镜像/Catalog 版本、模型与预算、运行次数、成功率、耗时、请求数、实体与 finding 真值对比、重复与无证据比例、失败样例和是否允许进入下一阶段。正确性断言必须全部通过；效果指标以 S0 为基线，若召回率下降或成本异常上升，保持 feature flag 关闭并先修复，不把问题带入下一阶段。

## 14. 风险与控制

| 风险 | 控制 |
|---|---|
| “全量”导致无限运行 | 来源闭环定义、Provider 预算、路径模板限额、稳定 revision |
| WSTG/STRIDE/BREAK 产生矩阵爆炸 | capability applicability、STRIDE-per-element、BREAK seed+有限跳数，不做实体×全库笛卡尔积 |
| 黑盒 DFD 被误当成真实内部架构 | observed/inferred/unknown 置信度，所有节点和边必须有证据引用 |
| BREAK 业务风险被误当成已存在漏洞 | 只生成验证义务；必须经过实际测试才能成为 finding |
| LLM 生成泛化风险点 | 确定性规则先生成适用项，结构化质量门槛拒绝空泛条目 |
| Observer 刷屏 | category+revision+locator 去重和冷却 |
| Browser 深爬副作用 | 动作分级、禁用删除/支付等破坏性动作、使用测试数据和区域预算 |
| Taric 不可用阻塞测试 | Assessment 本地权威索引、Artifact outbox、恢复后补投 |
| 旧数据被误判已完成 | 迁移为 legacy/incomplete，不自动 verified_complete |
| 缺少 admin/MFA 凭据 | external block，继续可测试部分，终局明确 incomplete 或用户 waiver |
| 发现很多低价值端点挤占测试 | 风险/证据/角色/新颖度/成本联合排序 |

## 15. 最终验收标准

以下条件全部满足才认为本次改造成功：

1. 普通 Solver 启动前，Host 已完成 Recon Gate 和 Surface baseline。
2. 所有发现的 Bundle 有分类、处理状态和证据。
3. 相对 API 完成按 origin/base/auth scope 的前缀推导与验证。
4. 攻击面第一维来自固定版本的本地 WSTG Catalog，不再使用笼统 Top 10 替代。
5. STRIDE 来自固定版本的 threat-modeling-main Catalog，并完成运行时 DFD、Trust Boundary、STRIDE-per-element 与缺口 disposition。
6. Lateral 来自固定版本的 BREAK Catalog；每条扩展可追溯到 seed fact、BREAK ID 和有类型的关系路径。
7. EXPLORE 阶段 Solver 的工具和攻击路线不受 RiskPoint 白名单限制。
8. Observer 只做带冷却的软提醒。
9. 新发现能进入 Recon revision，并触发局部或全量 Surface 更新。
10. 报告提交不再等于 Challenge 完成。
11. FinalGate 是唯一完成硬门禁。
12. blocked、skip、negative、verified 有严格不同的证据语义。
13. 预算耗尽、Taric 故障或缺少凭据不会被伪装成完成。
14. 靶场回归中 endpoint/workflow/role/vulnerability recall 明显高于改造前。

## 16. 实施优先级总结

实施顺序以第 12 节阶段 Gate 为唯一依据：

```text
S0 回归基线
-> S1 完成语义
-> S2 硬暂停/审批/Taric takeover
-> S3 Assessment 并发账本
-> S4 最小 Recon
-> S5 Bundle/API 闭环
-> S6 WSTG
-> S7 STRIDE
-> S8 BREAK Lateral
-> S9 Solver/Observer 联动
-> S10 FinalGate/补缺
-> S11 BrowserDeep/UI 灰度
```

每阶段必须先完成自动化测试和固定靶场效果验证。BrowserDeep 只在信息稀薄或 finding 暗示相邻接口时按区域触发，不属于初始全量必跑；Prompt、Observer 或 UI 不能替代 Host 的阶段状态和终局判定。

最终架构原则：

```text
Host 决定流程与完成
ReconCoordinator 保证来源闭环
固定版本 WSTG + threat-modeling-main + BREAK 保证攻击面系统性与可追溯性
Taric/Artifact 保证证据可追溯
Solver 保持自由探索和实际验证能力
Observer 只做软约束
FinalGate 防止漏测后过早收工
```
