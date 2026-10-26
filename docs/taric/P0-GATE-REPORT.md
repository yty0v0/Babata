# P0 环境闸门报告（2026-10-23）

## 结论

**P0 通过。** Taric 可在 Linux Docker 容器中以 Node 22 运行，named volume 可持久化 authority 数据；`engagement.init`、`context.build`、`audit.doctor`、reconcile 与容器重启验证均通过。

P0 仅验证运行环境，不代表完整 Taric 测试套件已全部通过，也不允许跳过 P0.5 Host Bridge 安全加固。

## 环境证据

| 项 | 结果 |
| --- | --- |
| Docker client/server | 29.4.3 / 29.4.3 |
| Docker server | Linux, amd64, Docker Desktop, overlayfs |
| 可用 Docker endpoint | `npipe:////./pipe/docker_engine` |
| 默认 endpoint 问题 | `dockerDesktopLinuxEngine` 在当前受限会话下被拒绝，后续命令必须显式使用 `DOCKER_HOST=npipe:////./pipe/docker_engine` |
| Node 基础镜像 | `node:22-slim` digest `sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d` |
| Node 版本 | v22.23.4 |
| Taric 构建镜像 | `taric-p0:local`，image id `sha256:1b5e0754095e7cc5eb838d8b576b6bbd0409465258a0c284d3954fedb81b039c` |
| named volume | `breachweave-taric-p0` |
| 运行用户 | `uid=10001(taric) gid=10001(taric)`，非 root |
| authority 路径 | `/data/authority.sqlite` |
| content root | `/data/content` |

## 构建与基线

Windows 直接执行 `npm run typecheck` 会先因 schemas 尚未构建而失败，且 schemas 的 build 脚本使用 `cp`，Windows cmd 不兼容。因此 P0 基线必须在 Linux 容器内执行。

在 `node:22-slim` 容器中执行：

```sh
npm ci
npm run build
npm run typecheck
npm test
```

结果：

- `npm ci`：通过，29 packages，无漏洞
- `npm run build`：通过
- `npm run typecheck`：通过
- `npm test`：CLI/MCP/schemas 相关测试通过；core 测试存在环境依赖差异：
  - 初始 `node:22-slim` 缺 `git`，导致 projection 测试 `spawn git ENOENT`
  - 初始镜像缺 `python3`，导致 Hermes plugin 测试失败
  - 安装 `git` 后 core 测试为 281 pass / 1 fail / 9 skipped
  - 剩余失败：`support documentation and capability diagnostics match the runtime manifest`，原因是当前 Taric-main 副本没有 OpenSpec 存储，而测试要求 `harden-taric-authority-runtime/proposal.md` 存在。这是源码包完整性/测试环境问题，不属于 authority 运行时能力失败。

P0 最小 authority 闭环不依赖上述测试环境项，已通过。后续若要完整验收 Taric 基线，应使用带 `.git`/OpenSpec 存储的原始 Taric 源码并固定 commit。

## 镜像构建

镜像定义：`deploy/taric/Dockerfile`

构建命令（Windows PowerShell）：

```powershell
$env:DOCKER_HOST='npipe:////./pipe/docker_engine'
docker build -f deploy\taric\Dockerfile -t taric-p0:local "C:\Users\Administrator\Desktop\AI自动化渗透测试\重构参考\Taric-main"
```

多阶段行为：

1. `node:22-slim` build stage
2. 先复制源码并执行 `npm ci`
3. `npm run build` 编译 schemas/core/cli/mcp
4. runtime stage 创建非 root `taric` 用户
5. 仅复制 package、lock、node_modules、packages
6. 设置 `/data/authority.sqlite` 与 `/data/content`
7. `USER taric`
8. `ENTRYPOINT ["node", "packages/cli/dist/bin.js"]`

安全边界：

- 不使用 NTFS bind mount 保存 authority
- 只使用 Docker named volume
- 运行进程为非 root
- 不把 build 工具和源码调试资产带入运行层

## P0 最小闭环

### 创建 volume

```powershell
docker volume create breachweave-taric-p0
```

### engagement.init

```powershell
docker run --rm -v breachweave-taric-p0:/data taric-p0:local engagement.init '{\"name\":\"tch-p0\",\"scope\":{\"allowed_targets\":[\"https://example.test\"],\"excluded_targets\":[],\"rules_of_engagement_ref\":\"roe:tch-p0\"}}'
```

返回：

```json
{
  "ok": true,
  "data": {
    "id": "01a167a1-521e-7ef1-88d0-ef049c750502",
    "engagement_id": "01a167a1-521e-7ef1-88d0-ef049c750502",
    "kind": "engagement",
    "name": "tch-p0",
    "status": "active",
    "version": 1,
    "trust_level": "L2",
    "display_id": "TAR-000002",
    "commit_seq": 2
  }
}
```

UUIDv7 校验：通过。

### context.build

```powershell
docker run --rm -e TARIC_ENGAGEMENT_ID=01a167a1-521e-7ef1-88d0-ef049c750502 -v breachweave-taric-p0:/data taric-p0:local context.build '{\"engagement_id\":\"01a167a1-521e-7ef1-88d0-ef049c750502\"}'
```

结果：

- outer `ok: true`
- `read_seq: 2`
- Context Pack 包含 scope 与 engagement
- `omitted_count: 0`
- `truncated_count: 0`

### audit.doctor 初始结果

初始 doctor 报告：

- authority valid: true
- audit valid: true
- derived valid: false
- pending_outbox: 2
- projected_seq 0 < committed_seq 2

按 doctor 提示执行：

```powershell
docker run --rm -e TARIC_ENGAGEMENT_ID=01a167a1-521e-7ef1-88d0-ef049c750502 -v breachweave-taric-p0:/data taric-p0:local audit.reconcile '{\"engagement_id\":\"01a167a1-521e-7ef1-88d0-ef049c750502\",\"action\":\"preview\"}'

docker run --rm -e TARIC_ENGAGEMENT_ID=01a167a1-521e-7ef1-88d0-ef049c750502 -v breachweave-taric-p0:/data taric-p0:local audit.reconcile '{\"engagement_id\":\"01a167a1-521e-7ef1-88d0-ef049c750502\",\"action\":\"replay\"}'
```

replay 结果：

- `applied: 2`
- `pending_outbox: 0`
- `committed_seq: 3`
- `projected_seq: 3`
- doctor 内嵌结果 `valid: true`

### reconcile 后 audit.doctor

结果：

```json
{
  "ok": true,
  "data": {
    "valid": true,
    "committed_seq": 3,
    "projected_seq": 3,
    "pending_outbox": 0,
    "authority": { "valid": true, "errors": [] },
    "derived": { "valid": true, "errors": [], "repair_actions": [] },
    "audit": { "valid": true, "errors": [], "read_seq": 3 },
    "errors": []
  }
}
```

### 重启持久化验证

每次 `docker run --rm` 都代表一次独立容器生命周期。完成 reconcile 后再次执行 `context.build`：

- `read_seq: 3`
- scope 与 engagement 记录仍存在
- authority 数据未丢失

新容器中再次执行 `context.build`：

- `read_seq: 3`
- `context_snapshot_id` 变化，属于每次构建的正常快照 ID
- items、manifest、mandatory constraints 与前次一致

结论：named volume 持久化通过。

## 后续要求

1. P0.5 必须先完成 Host Bridge 角色、审计、限流、超时与 binding 校验，未通过不得进入 P1。
2. Taric-main 当前不是 Git 仓库且缺少 OpenSpec 存储，无法固定 commit；后续应从原始仓库获取带提交历史的版本并记录 commit/digest。
3. 后续正式部署不得使用 P0 测试 volume，应创建独立 named volume 和配置。
4. 完整测试基线需补齐 Git/OpenSpec 存储后重跑。
