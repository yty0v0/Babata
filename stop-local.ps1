# Babata 本地部署停止脚本
$root = $PSScriptRoot
$pidFile = Join-Path $root ".run\web.pid"
if (Test-Path $pidFile) {
    $p = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; Write-Host "已停止 PID=$p" }
}
Get-Process bun -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "Babata 已停止。"
