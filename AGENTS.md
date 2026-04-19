# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Critical Next.js 16 Breaking Changes

- **`middleware.ts` is deprecated** — use `proxy.ts` at project root with `export function proxy(request)` and `export const config`
- **Params are async** — route params are `Promise<{...}>`, always `await params` before destructuring
- **Proxy runs in Node.js runtime** — Edge Runtime is no longer the default for proxy/middleware
- **No `export const runtime`** in proxy files — it will throw

## Critical Prisma v7 Breaking Changes

- **Generator**: `provider = "prisma-client"` (not `prisma-client-js`)
- **Output**: `output = "../app/generated/prisma"` — import from `@/app/generated/prisma/client`
- **URL**: moved from schema to `prisma.config.ts` — runtime requires `@prisma/adapter-pg`
- **Constructor**: `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })` — no `datasourceUrl`

## Session Conventions

- Read CLAUDE.md for full project context before any task
- Run `pnpm test` before and after any code change
- Use `pnpm seed` to reset fixture data after schema changes
- Dev database: `postgresql://taxlens:taxlens_dev@localhost:5433/taxlens` (Docker on port 5433)
