[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$ManagerTag = "canary",
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ManagerArgs
)

$ErrorActionPreference = "Stop"
if (-not [Environment]::Is64BitOperatingSystem) {
    throw "NeuroBook Manager v1 Stage 0 只支持 Windows x64。"
}
$bunVersion = "1.3.14"
$localAppData = $env:LOCALAPPDATA
if (-not $localAppData) {
    $localAppData = Join-Path $HOME "AppData\Local"
}
$cacheRoot = Join-Path $localAppData "NeuroBook\manager\runtime\bun\$bunVersion"
$bunExe = Join-Path $cacheRoot "bun-windows-x64\bun.exe"
$assetUrl = "https://github.com/oven-sh/bun/releases/download/bun-v$bunVersion/bun-windows-x64.zip"
$archiveSha256 = "0a0620930b6675d7ba440e81f4e0e00d3cfbe096c4b140d3fff02205e9e18922"
$bunSha256 = "0187f68d843f825a72ada4a7eca60db896ed753759a7f8252edcd31ac1bf1b9c"

$cachedValid = $false
if (Test-Path -LiteralPath $bunExe) {
    $actualBun = (Get-FileHash -LiteralPath $bunExe -Algorithm SHA256).Hash.ToLowerInvariant()
    $actualVersion = (& $bunExe --version 2>$null)
    $cachedValid = $actualBun -eq $bunSha256 -and $actualVersion -eq $bunVersion
}

if (-not $cachedValid) {
    Remove-Item -LiteralPath $cacheRoot -Recurse -Force -ErrorAction SilentlyContinue
    $stage = Join-Path ([System.IO.Path]::GetTempPath()) "neuro-book-stage0-$([guid]::NewGuid())"
    New-Item -ItemType Directory -Path $stage | Out-Null
    try {
        $archive = Join-Path $stage "bun-windows-x64.zip"
        Invoke-WebRequest -Uri $assetUrl -OutFile $archive
        $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $archiveSha256) {
            throw "Bun SHA256 校验失败。"
        }
        New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
        Expand-Archive -LiteralPath $archive -DestinationPath $cacheRoot -Force
    } finally {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$env:NEURO_BOOK_STAGE0_BUN_PATH = $bunExe
$env:NEURO_BOOK_STAGE0_BUN_VERSION = $bunVersion
$env:NEURO_BOOK_STAGE0_BUN_SOURCE_URL = $assetUrl
$env:NEURO_BOOK_STAGE0_BUN_ARCHIVE_SHA256 = $archiveSha256
$env:NEURO_BOOK_STAGE0_BUN_SHA256 = $bunSha256
& $bunExe x --bun "@notnotype/neuro-book-manager@$ManagerTag" install @ManagerArgs
exit $LASTEXITCODE
