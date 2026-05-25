#!/bin/sh
set -eu

if [ -z "${DATABASE_KIND:-}" ]; then
    if [ -n "${DATABASE_URL:-}" ]; then
        case "$DATABASE_URL" in
            file:*) DATABASE_KIND=sqlite ;;
            postgres://*|postgresql://*) DATABASE_KIND=postgres ;;
            *) echo "DATABASE_URL does not match sqlite/postgres: $DATABASE_URL" >&2; exit 1 ;;
        esac
    else
        DATABASE_KIND=sqlite
    fi
fi

export DATABASE_KIND

if [ "$DATABASE_KIND" = "sqlite" ] && [ -z "${DATABASE_URL:-}" ]; then
    DATABASE_URL="file:./workspace/.nbook/neuro-book.sqlite"
    export DATABASE_URL
fi

if [ "$DATABASE_KIND" = "sqlite" ]; then
    mkdir -p ./workspace/.nbook
fi

bun run generate
bun run migrate:deploy

exec bun .output/server/index.mjs
