# Taric 集成运行手册

## 镜像构建与版本 pin

- 构建镜像前固定 `TARIC_IMAGE_DIGEST` 和 `TARIC_COMMIT`，只允许使用已通过 P0 环境闸门的 digest。
- 构建示例：

```powershell
docker build -t taric-p0:local -f packages/core/src/runtime/assets/Dockerfile .
```

- 升级后必须重新执行环境闸门：

```powershell
docker run --rm -v breachweave-taric-p0:/data -e TARIC_DB=/data/authority.sqlite -e TARIC_CONTENT_ROOT=/data/content taric-p0:local engagement.init
docker run --rm -v breachweave-taric-p0:/data -e TARIC_DB=/data/authority.sqlite -e TARIC_CONTENT_ROOT=/data/content taric-p0:local audit.doctor
```

## 启动与停止

```powershell
Start-Service com.docker.service
docker volume create breachweave-taric-p0
docker run -d --name taric-p0 -v breachweave-taric-p0:/data taric-p0:local
docker stop taric-p0
```

## 备份与恢复 named volume

```powershell
docker run --rm -v breachweave-taric-p0:/data -v ${PWD}:/backup alpine tar -czf /backup/taric-authority.tar.gz -C /data .
docker run --rm -v breachweave-taric-p0:/data -v ${PWD}:/backup alpine tar -xzf /backup/taric-authority.tar.gz -C /data
```

恢复后执行 `context.build` 和 `audit.doctor` 确认 `read_seq`、authority 数据与 content root 一致。

## 诊断

- 检查宿主状态接口：`GET /api/taric/status`。
- 查看 proposal outbox：`GET /api/taric/proposals`。
- 查看 Host Bridge 审计日志：`~/.tch-agent/logs/host-bridge-audit.jsonl`。
- 检查 authority：

```powershell
docker run --rm -v breachweave-taric-p0:/data -e TARIC_DB=/data/authority.sqlite -e TARIC_CONTENT_ROOT=/data/content taric-p0:local audit.doctor
```

## 回滚

设置 `tch.taric.enabled=false` 后：

- 不启动 Taric sidecar。
- 不注册 `taric_board_query` / `taric_proposal_submit`。
- 现有 ChallengeManager、JSON memory/ideas 与 solver 工作流继续使用原路径。
- proposal outbox 标记 `rolled_back`，不再重放。

## 性能与韧性基准

| 指标 | 预算 |
| --- | --- |
| sidecar 读延迟 | P95 < 250ms |
| host.state 轮询 | 1s / 5s / 15s 退避 |
| authority 写入 | P95 < 500ms |
| outbox 重放 | 100 条待重放 < 10s |
| 容器重启恢复 | named volume 数据不丢失 |

## 故障注入矩阵

| 故障 | 预期 |
| --- | --- |
| Taric 容器停止 | 读操作降级，outbox 缓冲提案，恢复后幂等重放 |
| sidecar 慢响应 | 超时熔断，15s 重试 |
| Docker 重启 | named volume 保留，重启后 doctor 校验 |
| SQLite 锁 | 返回 `unavailable`，不阻塞 Web UI |
| 网络代理失效 | Docker CLI 调用超时并记录审计 |
| audit drift | `audit.verify` 返回漂移项，operator 执行 reconcile |

## P5 规模验证计划

- 资产数量 x solver 数量 x 时长方阵：`{10, 50, 200} x {1, 3, 7} x {30m, 2h, 8h}`。
- 漏报金标集：按 OWASP Top 10 与 CTF 靶标注入已知漏洞，测量覆盖率与误报。
- PostgreSQL profile 再评估条件：
  - 单宿主 authority 写入 P95 持续超过 500ms。
  - 多宿主或跨团队并发审计成为正式需求。
  - SQLite WAL 备份/恢复窗口不满足 RPO/RTO。
