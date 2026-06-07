$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$PortableRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Bun = Join-Path $PortableRoot "runtime\bun\bun.exe"
$Launcher = Join-Path $PortableRoot "launcher\launcher.mjs"

if (-not (Test-Path $Bun)) {
    throw "缺少内置 Bun runtime：$Bun"
}
if (-not (Test-Path $Launcher)) {
    throw "缺少 Windows Launcher 入口：$Launcher"
}

& $Bun $Launcher admin
exit $LASTEXITCODE
