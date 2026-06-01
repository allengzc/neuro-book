$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$PortableRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Node = Join-Path $PortableRoot "runtime\node\node.exe"
$Bootstrap = Join-Path $PortableRoot "bootstrap\bootstrap.mjs"

if (-not (Test-Path $Node)) {
    throw "缺少内置 Node.js runtime：$Node"
}
if (-not (Test-Path $Bootstrap)) {
    throw "缺少 Windows bootstrap 入口：$Bootstrap"
}

& $Node $Bootstrap update
exit $LASTEXITCODE
