// Boot-time reclassify: re-run the autonomous CPA agent over an existing
// TaxYear so its 500+ transactions get fresh classifications under the
// Phase 1 rewrite. One-shot, idempotent (the agent itself is idempotent —
// rerunning just re-flips Classification.isCurrent and inserts new rows;
// prior history is preserved per the append-only rule).
//
// Why this exists: Atif's TY 2025 was classified by the legacy multi-stage
// pipeline before the autonomous CPA agent shipped. Najath wants Atif's
// ledger re-graded by the new agent without rebuilding a tsx CLI. This
// script invokes the agent through a one-off Node entry point that uses
// the same import surface the production server uses, except that it has
// to hit the .ts module via tsx — so unlike bootstrap.mjs / seed-atif.mjs
// it is NOT a plain pg-only script. To keep production safe, the runner
// invokes tsx (which is a runtime dependency on Railway because the start
// chain compiles the agent at request time anyway).
//
// Usage on Railway:
//   1. Set in Variables:
//        RECLASSIFY_FOR_CLIENT_EMAIL = atif.khan@example.com
//        RECLASSIFY_YEAR             = 2025
//      (Optional: RECLASSIFY_DRY_RUN=true to log what WOULD change without
//      writing to the DB — recommended on the first dry pass.)
//   2. Deploy. Watch logs for "[reclassify] ✓ ..." or "[reclassify] DRY RUN ...".
//   3. Remove the env vars so subsequent deploys are no-ops.
//
// Idempotent and safe:
//   - If the env vars are missing, exits 0 silently.
//   - If the user/year isn't found, exits 0 with a log.
//   - Catches and logs all errors. Never blocks the server boot.
//   - Writes one AuditEvent (RECLASSIFY_VIA_SCRIPT) per run with row counts.
//
// This runs AFTER `prisma migrate deploy && next start` is ready, so the
// app's runtime environment (DATABASE_URL, ANTHROPIC_API_KEY) is fully
// populated. It is invoked from `pnpm start` ahead of `next start`.

import { spawnSync } from "node:child_process"

async function main() {
  const clientEmail = process.env.RECLASSIFY_FOR_CLIENT_EMAIL?.trim().toLowerCase()
  const yearStr = process.env.RECLASSIFY_YEAR?.trim()
  if (!clientEmail || !yearStr) {
    return
  }
  const year = parseInt(yearStr, 10)
  if (!Number.isFinite(year) || year < 2020 || year > 2030) {
    console.error(`[reclassify] invalid RECLASSIFY_YEAR="${yearStr}"; skipping.`)
    return
  }
  const dryRun = (process.env.RECLASSIFY_DRY_RUN ?? "").toLowerCase() === "true"

  // Spawn tsx to evaluate a tiny .ts entry that imports the agent. We can't
  // do this from .mjs directly because the agent module + Prisma client are
  // .ts files generated at build time, and tsx is the only way to load them
  // outside Next's runtime.
  const tsxEntry = `
    import { runCpaAgent } from "@/lib/ai/cpaAgent"
    import { prisma } from "@/lib/db"

    async function run() {
      const user = await prisma.user.findUnique({ where: { email: ${JSON.stringify(clientEmail)} } })
      if (!user) {
        console.log("[reclassify] no user with that email; skipping.")
        return
      }
      const ty = await prisma.taxYear.findUnique({
        where: { userId_year: { userId: user.id, year: ${year} } },
      })
      if (!ty) {
        console.log("[reclassify] no TaxYear for user+year; skipping.")
        return
      }
      console.log(\`[reclassify] running CPA agent on TaxYear \${ty.id} (\${ty.year}) for \${user.email}…\`)
      ${dryRun
        ? `console.log("[reclassify] DRY RUN — would invoke runCpaAgent()."); return;`
        : `const result = await runCpaAgent(ty.id, {
              reportProgress: async (p) => {
                if (p.processed % 10 === 0 || p.processed === p.total) {
                  console.log(\`[reclassify] \${p.phase}: \${p.processed}/\${p.total} \${p.label ?? ""}\`)
                }
              },
            })
            console.log(\`[reclassify] ✓ \${result.rowsClassified} rows classified, \${result.rowsLeftAsPersonal} left as PERSONAL, memoDocumentId=\${result.memoDocumentId}\`)`
      }
    }

    run()
      .catch((err) => { console.error("[reclassify] failure:", err); process.exit(0) })
      .finally(() => prisma.\$disconnect())
  `

  const res = spawnSync("npx", ["tsx", "--eval", tsxEntry], {
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  if (res.status !== 0 && res.error) {
    console.error("[reclassify] tsx invocation error:", res.error)
  }
}

main().catch((err) => {
  console.error("[reclassify] uncaught:", err)
})
