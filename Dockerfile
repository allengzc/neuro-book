FROM oven/bun:1-debian AS runtime-base
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        coreutils \
        findutils \
        git \
        python3 \
        ripgrep \
    && rm -rf /var/lib/apt/lists/*

FROM runtime-base AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/neuro-book-manager/package.json ./packages/neuro-book-manager/package.json
RUN cp bun.lock /tmp/bun.lock \
    && bun install --frozen-lockfile --linker hoisted \
    && cmp bun.lock /tmp/bun.lock

FROM runtime-base AS build
WORKDIR /app

ENV DATABASE_KIND=sqlite
ENV DATABASE_URL=file:./workspace/.nbook/neuro-book.sqlite

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run nuxt:build

FROM runtime-base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=build /app/.output ./.output
COPY --from=build /app/.nuxt/tsconfig.json ./.nuxt/tsconfig.json
COPY --from=build /app/.nuxt/tsconfig.server.json ./.nuxt/tsconfig.server.json
COPY --from=build /app/app ./app
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/assets ./assets
COPY --from=build /app/world-engine ./world-engine
COPY --from=build /app/plugins ./plugins
COPY --from=build /app/datasets ./datasets
COPY --from=build /app/AGENTS.md ./AGENTS.md
COPY --from=build /app/reference ./reference
COPY --from=build /app/docs ./docs
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/bun.lock ./bun.lock
COPY --from=build /app/nuxt.config.ts ./nuxt.config.ts
COPY --from=build /app/uno.config.ts ./uno.config.ts
COPY --from=build /app/vitest.config.ts ./vitest.config.ts
COPY --from=build /app/bun-sqlite.d.ts /app/proper-lockfile.d.ts /app/vue-shim.d.ts /app/yazl.d.ts ./
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
RUN bun -e 'const fs = require("node:fs"); const config = JSON.parse(fs.readFileSync("tsconfig.json", "utf8")); config.compilerOptions = {...config.compilerOptions, baseUrl: ".", paths: {...(config.compilerOptions && config.compilerOptions.paths ? config.compilerOptions.paths : {}), "nbook/*": [".output/server/node_modules/nbook/*"], "neuro_book/*": [".output/server/node_modules/nbook/*"]}}; fs.writeFileSync("tsconfig.json", `${JSON.stringify(config, null, 4)}\n`, "utf8");'

EXPOSE 3000

ENTRYPOINT ["sh", "./scripts/deploy/docker-product-entrypoint.sh"]
