$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$PortableRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Node = Join-Path $PortableRoot "runtime\node\node.exe"
$Launcher = Join-Path $PortableRoot "launcher\launcher.mjs"

if (-not (Test-Path $Node)) {
    throw "缺少内置 Node.js runtime：$Node"
}
if (-not (Test-Path $Launcher)) {
    throw "缺少 Windows Launcher 入口：$Launcher"
}

& $Node $Launcher start
exit $LASTEXITCODE
