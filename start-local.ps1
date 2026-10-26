# Babata 本地部署启动脚本 (PowerShell)
# 用法: powershell -ExecutionPolicy Bypass -File .\start-local.ps1 [-Listen "127.0.0.1:3000"]

param(
    [string]$Listen = "127.0.0.1:3000"
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$runDir = Join-Path $root ".run"
New-Item -ItemType Directory -Force $runDir | Out-Null

$bunRuntime = Join-Path $root ".tools\bun-windows-x64\bun.exe"          # 运行 Web 服务 (Bun 1.4.3)
$bunCompile = Join-Path $root ".tools\bun-1.2.23-compile\bun.exe"       # 仅用于交叉编译 Linux solver 二进制
$pidFile = Join-Path $runDir "web.pid"
$outLog = Join-Path $runDir "web.out.log"
$errLog = Join-Path $runDir "web.err.log"

if (-not (Test-Path $bunRuntime)) { throw "缺少 Bun 运行时: $bunRuntime" }
if (-not (Test-Path $bunCompile)) { throw "缺少编译用 Bun: $bunCompile" }

# 结束旧进程
if (Test-Path $pidFile) {
    $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($oldPid) { Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue }
}
Get-Process bun -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# PATH 中把“可编译的 Bun”排在前面(仅影响编译 solver 二进制这一步)，并保留系统代理
$env:PATH = "$(Split-Path $bunCompile);$root\.tools\bun-windows-x64;$env:PATH"

# 宿主机代理(按需修改)
if (-not $env:HTTP_PROXY) { $env:HTTP_PROXY = "http://127.0.0.1:7890" }
if (-not $env:HTTPS_PROXY) { $env:HTTPS_PROXY = "http://127.0.0.1:7890" }

$proc = Start-Process -FilePath $bunRuntime `
    -ArgumentList @("run", "apps/cli/src/main.ts", "web", "--listen", $Listen) `
    -WorkingDirectory $root `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog `
    -PassThru -WindowStyle Hidden
$proc.Id | Out-File $pidFile

Write-Host "已启动 Babata，PID=$($proc.Id)，等待服务就绪..."
$port = [int]($Listen.Split(":")[-1])
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    if (Test-NetConnection -ComputerName 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue) { $ok = $true; break }
    if (-not (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue)) { break }
}
if ($ok) {
    Write-Host "Web UI 已就绪: http://$Listen"
    Write-Host "日志: $outLog / $errLog"
} else {
    Write-Host "服务未在预期时间内监听端口，请查看日志:"
    Get-Content $errLog -Tail 30 -ErrorAction SilentlyContinue
    exit 1
}
