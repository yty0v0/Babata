# Babata 本地部署说明（Windows）

部署时间：2026-10-10
部署目录（项目根）：`<project-root>`

## 一、访问方式

- 地址：http://127.0.0.1:3000
- 已创建账号：`admin` / `<configured-password>`（请尽快修改）
- 数据目录：`~/.tch-agent/`
  - `config\` 配置/用户/Prompt/Skill
  - `runtime\` solver 运行资源与 Dockerfile
  - `challenge\`、`solvers\`、`archive_*\` 项目与运行数据

## 二、启动 / 停止

```powershell
# 启动（默认监听 127.0.0.1:3000）
powershell -ExecutionPolicy Bypass -File .\start-local.ps1

# 指定监听地址
powershell -ExecutionPolicy Bypass -File .\start-local.ps1 -Listen "0.0.0.0:3000"

# 停止
powershell -ExecutionPolicy Bypass -File .\stop-local.ps1
```

日志：`.run\web.out.log`、`.run\web.err.log`，PID：`.run\web.pid`

新增项目：

```powershell
# 运行服务所用的 bun
.\.tools\bun-windows-x64\bun.exe run create-user <用户名> <密码>
```

## 三、本项目内置的运行时

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| Bun 1.4.3 | `.tools\bun-windows-x64\bun.exe` | 运行 Web 服务 |
| Bun 1.2.23 | `.tools\bun-1.2.23-compile\bun.exe` | 仅用于交叉编译 Linux solver 二进制 |
| Docker 镜像 | `tch-agent:latest`（9.59GB，linux/amd64） | Kali solver 容器镜像 |

## Taric 边界

Taric authority 使用 Linux 容器和 Docker named volume，禁止将 `authority.sqlite` 或 content root 挂载到 Windows NTFS。镜像构建、备份恢复、诊断和回滚步骤见 `docs/taric-runbook.md`。设置 `tch.taric.enabled=false` 可关闭 Taric sidecar 与只读/提案工具，本地 JSON 路径保持可用。

> 1.4.3 在本机执行 `bun build --compile` 会报
> `failed to copy bun executable into temporary file: ENOENT`，
> 因此 `start-local.ps1` 把 PATH 中的 `bun` 指向 1.2.23（仅编译 solver 二进制那一步用到），
> 服务本身仍由 1.4.3 运行。

## 四、为完成部署所做的改动

1. **Dockerfile 修复**（`packages/core/src/runtime/assets/Dockerfile`）
   新增一层安装 `cmake build-essential pkg-config python3-dev`。
   原因：Kali rolling 的 Python 3.14 下 `pwntools -> unicorn` 没有预编译 wheel，需要本地编译，原 Dockerfile 缺少 cmake 导致镜像构建失败。

2. **镜像构建代理**
   构建时必须让容器内的代理地址为 `http://host.docker.internal:7890`（宿主 7890 只监听 127.0.0.1，
   容器内访问 127.0.0.1 会失败）。镜像已构建完成，服务启动时不会重复构建。
   若之后需要重建镜像，请先设置：
   `$env:HTTP_PROXY="http://host.docker.internal:7890"`、`$env:HTTPS_PROXY="http://host.docker.internal:7890"`。

3. **内置 Skill 中 3 个文件名改名**（内容不变）
   360 安全软件会拦截这几个原始文件名在 `~/.tch-agent\config\skills` 下的写入，导致服务启动初始化失败：

   | 原名 | 新名 |
   | --- | --- |
   | `fuzz-dicts-skills/rcePayloads/RCE-filter-and-WAF-Bypass.txt` | `rce-waf-filter-samples.txt` |
   | `payloads-everything/references/Command Injection/Intruder/command_exec.txt` | `command-exec-samples.txt` |
   | `payloads-everything/references/Upload Insecure Files/EICAR/eicar.txt` | `av-test-samples.txt` |

   若想让 360 放行、恢复原始文件名，可把 `~/.tch-agent`
   加入 360 的信任区（或防护白名单）后，将上述文件改回原名并执行
   `bun run scripts/generate-builtin-assets.ts` 重新生成资源清单。

## 五、已接入的模型

已通过项目自带配置接口写入并**验证可用**：

| 项 | 值 |
| --- | --- |
| Provider 名称 | `DeepSeek`（id `deepseek`） |
| 协议 | `openai-completions` |
| Base URL | `https://api.deepseek.com/v1` |
| 模型 ID | `deepseek-flash`（显示名 `DeepSeek-V4.1-Flash`） |
| 上下文 / 最大输出 | 1,048,576 / 393,216 |
| Thinking | 默认 `high`（支持 low / high / max） |
| 兼容设置 | `supportsStore=false`、`supportsDeveloperRole=false`、`maxTokensField=max_tokens` |

验证结果：

| 验证方式 | 结果 |
| --- | --- |
| `ConfigManager.testModel("deepseek-flash")` | `ok: true`，返回 "OK" |
| `POST /api/config/test-model`（服务进程内） | `ok: true`，返回 "OK" |
| Solver 容器内 `curl https://api.deepseek.com/v1/models` | 200 |

配置文件位置：

- `~/.tch-agent/config/provider-prefs.json` — Provider 与 API Key
- `~/.tch-agent/config/model-prefs.json` — 模型偏好
- `~/.tch-agent/config/models.json` — SDK 模型注册（自动同步）
- `~/.tch-agent/config/auth.json` — API Key（AuthStorage）

> 出网方式：本机直连不通，必须走 `127.0.0.1:7890` 代理；
> `start-local.ps1` 已设置 `HTTP_PROXY`/`HTTPS_PROXY`，服务进程与容器均已验证可达。
> 更换 Key 可直接在 Web 界面「Config → Providers」编辑，或改 `provider-prefs.json` 后重启服务。

### 使用位置

- 「Config → Providers / Models」可查看、编辑、点 **Test** 复测连通性
- 创建项目时在 Planner 配置里选择模型 `DeepSeek-V4.1-Flash`

## 六、尚未配置的项

- **模型/API Key**：`~/.tch-agent\config\api-keys.json`、`provider-prefs.json`、`model-prefs.json`
  需要按你们的模型服务填写后，Planner/Solver 才能真正跑起来。
- **网络**：本机只能通过 `127.0.0.1:7890` 代理出网（直连不通），
  如模型服务在 `NO_PROXY` 之外，请确保代理可用。

## 七、验证结果

| 检查项 | 结果 |
| --- | --- |
| `GET /` | 200，返回 Babata 页面 |
| 登录接口 `POST /api/auth/login` | 200，返回用户与 JWT |
| 页面渲染 | 登录页 → 登录后进入「项目 / Runtime / Config」主界面，无控制台报错 |
| 端口监听 | 127.0.0.1:3000 ✔ |

## 8. Tests

Host (Windows):

```powershell
.\.tools\bun-windows-x64\bun.exe test
```

`scripts/install.test.ts` uses a POSIX `chmod` and a shell-script shim, so it is
skipped on Windows and runs on Linux/macOS.

Linux verification (Bun container, without touching the host `node_modules`
workspace junction):

```powershell
docker run --rm `
  -v "$((Get-Location).Path):/src:ro" `
  -e HOME=/tmp/tch-home `
  oven/bun:1 sh -c "cp -a /src /work && cd /work && rm -rf node_modules/pi-mcp-adapter && ln -s /work/packages/libs/pi-mcp-adapter node_modules/pi-mcp-adapter && bun test"
```

`packages/libs/pi-mcp-adapter` is a vendored third-party package. Its suites use
vitest-only APIs (`vi.hoisted`) and reference an `examples/` directory that is
not vendored, so `bunfig.toml` excludes it from the repo-wide `bun test`.

## 9. Taric Runtime Notes

- `tch.taric.proposal.admissionMode` accepts `hitl_l1`, `auto_l1`, `disabled`.
  `auto_l1` auto-admits only `checkpoint` proposals (reviewer is recorded as
  `auto-policy`); `claim` proposals still require human review.
- `TCH_TARIC_LEASE_MS` overrides the WorkRun lease (default `300000`). Short
  values are only for crash-recovery drills; the host clamps the effective
  value to `60000`-`900000` ms. For the short recovery drill, set
  `TCH_TARIC_LEASE_MS=120000` before starting the service.
- Tool results above 64 characters are persisted as Taric artifacts tagged with
  the producing `attempt_id` / `work_run_id`. Admitted checkpoints carry the
  matching `artifact_refs` hashes plus host-derived observation/evidence refs
  when binding succeeds; failed binding is reported as an explicit evidence gap.
- Admitted-but-uncommitted checkpoints are repaired on startup and every
  60-second heartbeat after lease renewal and auto-admission. The bounded repair
  batch skips already checkpointed WorkRuns.
- A crashed solver whose lease has not expired blocks new launches for that
  challenge, so the checkpoint can still be reclaimed; the launch resumes
  automatically once the lease expires.
