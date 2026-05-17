# Full Site Auth

## User Request

- 快速实现全站鉴权，保留后续扩展能力。
- 需要独立管理员后台页面做用户管理。
- 需要登录页，登录后可直接访问全站。
- 需要能通过配置文件启用或关闭，默认开启。

## Goal

- 提供 cookie session 形式的全站登录保护。
- 提供管理员用户管理页，支持创建、编辑、禁用和重置密码。
- 提供 `config.yaml` 开关，默认开启，关闭时整站退化为无遮罩访问。

## Current State

- 项目是 Nuxt 4 + Nitro + Prisma + Postgres 单体应用。
- 运行时已经有 `config.yaml` 作为可写业务配置真值源。
- 部署侧已经有 Docker Compose 和生产入口。

## Walkthrough

- 在 `prisma/schema.prisma` 增加 `User`、`UserRole`、`UserStatus` 和 `sessionVersion`。
- 新增登录、登出、当前会话查询与管理员用户管理 API。
- 新增服务端中间件和前端全局路由中间件，服务端负责权威守卫，前端负责跳转体验。
- 新增 `/login` 登录页和 `/admin/users` 用户管理页。
- 新增 `scripts/create-admin.ts`，用于部署后创建首个管理员。
- 在 `config.example.yaml` 和 `server/utils/app-config.ts` 中加入 `auth.enabled`，未配置时默认开启。

## Decisions

- 采用应用内 session，而不是 HTTP Basic Auth。
- 登录态只存轻量用户信息，不存密码或额外 token。
- `auth.enabled=false` 时，整套认证守卫和管理员限制都关闭。
- 第一版不开放公开注册。

## Files Changed

- `server/utils/auth.ts`
- `server/utils/app-config.ts`
- `server/middleware/auth.ts`
- `app/middleware/auth.global.ts`
- `server/api/auth/*`
- `server/api/admin/users/*`
- `app/pages/login.vue`
- `app/pages/admin/users.vue`
- `prisma/schema.prisma`
- `prisma/migrations/20260517120000_add_users_auth/migration.sql`
- `config.example.yaml`
- `scripts/create-admin.ts`

## Verification

- `bun run nuxt:prepare`
- `bun run generate`
- `bunx vitest run server/utils/app-config.test.ts server/utils/auth.test.ts server/api/auth/login.post.test.ts`
- `bun run typecheck`

## TODO / Follow-ups

- 把 auth 开关做成设置页可视化开关。
- 如需更强权限模型，再加细粒度权限表和资源级校验。
