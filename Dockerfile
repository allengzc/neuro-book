FROM oven/bun:1-debian AS runtime-base
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        coreutils \
        findutils \
        git \
        nodejs \
        python3 \
        ripgrep \
    && rm -rf /var/lib/apt/lists/*

FROM runtime-base AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM runtime-base AS build
WORKDIR /app

ENV DATABASE_KIND=postgres
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/neuro_book

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run nuxt:prepare
RUN bun run generate
RUN bun run nuxt:build

FROM runtime-base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=build /app/.output ./.output
COPY --from=build /app/.nuxt ./.nuxt
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/app ./app
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/assets ./assets
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/bun.lock ./bun.lock
COPY --from=build /app/nuxt.config.ts ./nuxt.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

EXPOSE 3000

ENTRYPOINT ["sh", "./scripts/docker-entrypoint.sh"]
