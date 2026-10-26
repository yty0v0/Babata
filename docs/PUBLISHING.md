# Babata 发布与 GitHub 上传说明

本文件只说明哪些内容应提交、哪些应保留在本地，以及首次上传前需要完成的检查。发布前请先阅读仓库根目录的 `.gitignore`。

## 1. 应提交的内容

| 路径 | 说明 |
|---|---|
| `apps/` | CLI 与应用入口 |
| `packages/core/` | Core、Planner、Solver、Runtime、Taric 集成 |
| `packages/ui-web/` | Web UI 与 REST API |
| `packages/ui-tui/` | 终端 UI |
| `packages/libs/pi-mcp-adapter/` | vendored MCP adapter 源码 |
| `deploy/` | 容器部署定义 |
| `scripts/` | 安装、构建、校验脚本 |
| `docs/` | 架构、Taric、API 与部署文档 |
| `openspec/` | 规格、变更记录与归档 |
| `README.md` | 项目入口 |
| `ARCHITECTURE.md` | 架构说明 |
| `DEPLOY-LOCAL.md` | 本地部署说明 |
| `AGENTS.md` | 项目约定 |
| `CLAUDE.md` | 项目约定入口 |
| `LICENSE` | Apache 2.0 许可证 |
| `package.json` | 根包与 workspace 定义 |
| `bun.lock` | 锁定的依赖版本 |
| `bunfig.toml` | Bun 配置 |
| `tsconfig.json` | TypeScript 配置 |
| `start-local.ps1` / `stop-local.ps1` | Windows 本地启动/停止脚本 |
| `changed.md` | 变更说明，确认无内部信息后可提交 |

直接提交源码时，仓库约 119 MB，其中包含内置字典和 payload 参考库。建议按第 4 节决定是否使用 Git LFS。

## 2. 不应提交的内容

以下路径已在 `.gitignore` 中排除，禁止用 `git add -f` 强制加入：

| 路径/文件 | 原因 |
|---|---|
| `node_modules/` | 依赖，可由 `bun install` 重建 |
| `.local-home/` | 本地数据、用户、API Key、JWT Secret |
| `.run/` | PID、日志、challenge、checkpoint、JWT |
| `.tools/` | 本地 Bun 可执行文件 |
| `.bun-cache/` | 本地缓存 |
| `.codex/`、`.claude/` | 本地 Agent 工具状态 |
| `.env`、`.env.*` | 环境变量与凭据（`.env.example` 例外） |
| `dist/`、`dist-test/`、`bin/` | 构建产物 |
| `*.log` | 运行日志 |
| `*.exe`、`*.dll`、`*.so`、`*.dylib` | 平台二进制 |
| `*.tsbuildinfo` | TypeScript 增量构建缓存 |
| `~/.tch-agent/` | 用户级运行数据和凭据，不在仓库内，但也不要复制进来 |

本次审计确认以下真实敏感内容存在于被排除目录中：

- `.local-home/.tch-agent/config/auth.json`：真实 API Key
- `.local-home/.tch-agent/config/provider-prefs.json`：真实 API Key
- `.local-home/.tch-agent/config/settings.json`：真实 JWT Secret
- `.local-home/.tch-agent/config/users.json`：用户密码哈希
- `.run/jwt.txt`：可用 JWT

如果曾经把以上内容提交到 Git 历史，仅加入 `.gitignore` 不够，必须轮换密钥并清理历史。

## 3. 发布前检查

```powershell
# 1. 确认工作区只包含预期文件
git status --short

# 2. 检查是否误加入私有目录
git ls-files | Select-String -Pattern '^(.local-home|.run|.tools|.bun-cache|node_modules|.env|.codex|.claude)/'

# 3. 检查高置信度凭据格式（结果应为空）
git grep -n -I -E 'sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----'

# 4. 运行验证
bun run typecheck
bun test packages/ui-web/src/guardrail-ui.test.tsx packages/ui-web/src/guardrail-api.test.ts scripts/create-user.test.ts
```

## 4. 内置字典与 payload 体积

`packages/core/src/config/skills/builtin/fuzz-dicts-skills/` 约 74 MB，包含密码、用户名、子域和目录字典；其中最大的 RAR 约 10.6 MB：

```text
passwordDict/RW_Password/密码字典4952222条.rar
SHA256 5B0C06FFB9C558C761C962A80821E7AA6930608A0CA805C70FF5E209911A47F2
```

`payloads-everything/` 约 21 MB，是 PayloadsAllTheThings 的本地导航与参考语料。

推荐二选一：

### 方案 A：Git LFS（保留开箱即用）

```powershell
git lfs install
git lfs track "packages/core/src/config/skills/builtin/fuzz-dicts-skills/passwordDict/RW_Password/*.rar"
git lfs track "packages/core/src/config/skills/builtin/fuzz-dicts-skills/subdomainDicts/*.txt"
git lfs track "packages/core/src/config/skills/builtin/fuzz-dicts-skills/userNameDict/ChinaUserName.txt"
git add .gitattributes
```

### 方案 B：不提交大字典（推荐用于普通源码仓库）

将 `fuzz-dicts-skills/` 作为可选资源，在 README 说明下载方式；仓库只保留 `SKILL.md`、`README.md` 和小型示例。`payloads-everything` 若不希望包含第三方语料，也应改为外部资源或在文档中注明来源与许可证。

无论采用哪种方案，在使用第三方字典/payload 语料前都应核对原始项目的许可证并在 `THIRD_PARTY_NOTICES.md` 中注明来源。

## 5. 文档中的本地环境信息

发布前不要把本机绝对路径、真实账号密码、内网地址或靶场地址写进公开文档。当前 `DEPLOY-LOCAL.md` 已改为占位符；如后续新增部署记录，请使用：

```text
<project-root>
<configured-password>
<TARGET>
```

## 6. 首次上传流程

当前工作目录没有 `.git` 元数据。若这是一个全新的 GitHub 仓库：

```powershell
# 初始化仓库
git init
git branch -M main

# 在 GitHub 创建空仓库后设置地址（替换为你的仓库）
git remote add origin https://github.com/<你的账号>/<仓库名>.git

# 只添加非忽略内容
git add .

# 检查暂存内容，尤其是私有配置和大文件
git status --short
git diff --cached --stat

# 提交并推送
git commit -m "Initial Babata project import"
git push -u origin main
```

如果 GitHub 仓库已有历史，不要直接 `git init`/强推；应先克隆原仓库，再将 Babata 的源码变更合并进去，避免覆盖远程历史。

## 7. 建议补充的仓库元数据

上传前建议确认：

- `LICENSE`：当前为 Apache 2.0
- `THIRD_PARTY_NOTICES.md`：记录内置字典、payload 与 vendored 依赖来源
- `.gitattributes`：若使用 Git LFS，提交 LFS 规则
- `README.md`：Babata 名称、安装步骤、仓库地址
- `DEPLOY-LOCAL.md`：不包含真实密码与本机路径
- CI：至少运行 `bun run typecheck` 和 UI/用户相关测试

## 8. 一句话结论

**提交源码、文档、部署定义和必要配置；不提交依赖、缓存、运行数据、日志、二进制、本机路径和任何凭据。内置字典要么用 Git LFS，要么明确作为外部可选资源，不要用普通 Git 静默塞入仓库。**
