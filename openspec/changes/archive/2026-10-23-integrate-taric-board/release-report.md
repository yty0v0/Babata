# Taric 接入 BreachWeave 发布报告

## 结果

- 变更：`integrate-taric-board`
- 阶段：P0、P0.5、P1a、P1b、P2、P3、P4、P8 已验收
- 完成度：63/63 任务

## 验证证据

| 阶段 | 结果 |
| --- | --- |
| P0 环境闸门 | Docker named volume、`engagement.init`、`context.build`、`audit.doctor`、重启持久化 |
| P0.5 Host Bridge 安全 | role/action 白名单、JSONL 审计、限流、超时、scope 校验 |
| P1a 只读黑板 | loopback sidecar、分角色 token、只读操作、降级响应 |
| P1b 角色化提案 | 类型化 schema、proposal-only outbox、idempotency replay |
| P2 HITL | `hitl_l1` 默认、Web UI 审核、拒绝审计、fail-closed admission |
| P3 WorkRun/Checkpoint/Artifact | lease/generation、reclaim/resume、Artifact ACL/redaction/backup |
| P4 Coverage | 五态覆盖、`scanned` 兼容投影、影响传播、L2 独立复核 |
| P8 可观测性 | host.state 轮询、`/api/taric/status`、runbook、故障矩阵、P5 计划 |

## 测试与静态检查

- `tsc --noEmit -p packages/core`：通过
- `tsc --noEmit -p packages/ui-web`：通过
- Bun 容器内 Taric 相关测试：35+ pass / 0 fail
- `openspec validate integrate-taric-board`：通过

## 已知限制

- Taric CLI 的权威写入仍通过 Docker CLI 适配器调用，生产环境应固定镜像 digest。
- `auto_l1` 仅作为显式配置模式保留，默认不启用。
- PostgreSQL profile 留待 P5 规模验证后再评估。
