// One-shot: recompute every TaxYear's status via deriveStage().
//
// Why this exists: pre-Tier-1 deploys, TaxYear.status was set in only a few
// places (CREATED → INGESTION on first upload, INGESTION → LOCKED on lock).
// Years stayed on INGESTION even when 100% of rows were classified, which
// made the status chip in the breadcrumb a lie. After Tier 1 ships,
// recomputeStatus() runs at the end of every state-mutating action — but
// existing data only refreshes on the next mutation. This script forces a
// one-time refresh so the chip jumps to the correct stage immediately.
//
// Idempotent. Safe to run multiple times.
//
// Usage on Railway:
//   1. Set in Variables: RUN_STATUS_RECOMPUTE = true
//      (Optional: RECOMPUTE_USER_EMAIL = atif.khan@example.com to scope to
//      a single user; otherwise it processes all TaxYears.)
//   2. Deploy. Watch logs for "[recompute-status]" lines.
//   3. Remove the env var so subsequent deploys are no-ops.
//
// Local usage (if your dev DB credentials work):
//   pnpm dlx tsx scripts/recompute-tax-year-statuses.mjs

import "dotenv/config"
import { spawn } from "node:child_process"

if (process.env.RUN_STATUS_RECOMPUTE !== "true" && !process.argv.includes("--force")) {
  console.log("[recompute-status] RUN_STATUS_RECOMPUTE != true — skipping")
  process.exit(0)
}

const tsxArgs = ["tsx", "scripts/_recompute-impl.ts"]
const child = spawn("pnpm", ["dlx", ...tsxArgs], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
})

child.on("exit", (code) => {
  process.exit(code ?? 0)
})
