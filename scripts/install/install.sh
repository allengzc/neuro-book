#!/bin/sh
set -eu

case "$(uname -s):$(uname -m)" in
    Linux:x86_64|Linux:amd64) ;;
    *) echo "NeuroBook Manager v1 Stage 0 只支持 Linux x64 glibc。" >&2; exit 1 ;;
esac

BUN_VERSION="1.3.14"
MANAGER_TAG="${NEURO_BOOK_MANAGER_TAG:-canary}"
CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
RUNTIME_ROOT="$CACHE_HOME/neuro-book-manager/runtime/bun/$BUN_VERSION"
BUN_BIN="$RUNTIME_ROOT/bun-linux-x64/bun"
ASSET_URL="https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-x64.zip"
ARCHIVE_SHA256="951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f"
BUN_SHA256="9fd36f87e4b90b07632b987a2e4ec81ca15a62c81bf983190cea6d715be2ad74"

if ! getconf GNU_LIBC_VERSION >/dev/null 2>&1; then
    echo "NeuroBook Manager v1 只支持 Linux x64 glibc。" >&2
    exit 1
fi

cached_valid=false
if [ -x "$BUN_BIN" ]; then
    actual_bun="$(sha256sum "$BUN_BIN" | awk '{print $1}')"
    actual_version="$($BUN_BIN --version 2>/dev/null || true)"
    if [ "$actual_bun" = "$BUN_SHA256" ] && [ "$actual_version" = "$BUN_VERSION" ]; then cached_valid=true; fi
fi

if [ "$cached_valid" != true ]; then
    rm -rf "$RUNTIME_ROOT"
    stage="$(mktemp -d)"
    trap 'rm -rf "$stage"' EXIT INT TERM
    curl -fsSL "$ASSET_URL" -o "$stage/bun-linux-x64.zip"
    actual="$(sha256sum "$stage/bun-linux-x64.zip" | awk '{print $1}')"
    test "$actual" = "$ARCHIVE_SHA256"
    mkdir -p "$RUNTIME_ROOT"
    unzip -q "$stage/bun-linux-x64.zip" -d "$RUNTIME_ROOT"
fi

export NEURO_BOOK_STAGE0_BUN_PATH="$BUN_BIN"
export NEURO_BOOK_STAGE0_BUN_VERSION="$BUN_VERSION"
export NEURO_BOOK_STAGE0_BUN_SOURCE_URL="$ASSET_URL"
export NEURO_BOOK_STAGE0_BUN_ARCHIVE_SHA256="$ARCHIVE_SHA256"
export NEURO_BOOK_STAGE0_BUN_SHA256="$BUN_SHA256"
exec "$BUN_BIN" x --bun "@notnotype/neuro-book-manager@$MANAGER_TAG" install "$@"
