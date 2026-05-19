// Boot-time: run the full Auto-CPA finalize pipeline on Atif Ameer's 2025
// TaxYear. Unlocks (if locked), runs PRE_CLEANUP + CPA_AUDIT + COHAN_SWEEP +
// SUBSTANTIATION_QUEUE, accepts every auto-fixable finding, applies them,
// then re-attempts lock.
//
// This is the prod-deploy execution of the §162 Cohan sweep planned in
// `plans/during-the-process-of-radiant-hanrahan.md` Part 3.
//
// Usage on Railway:
//   1. Apply migration 20260520_add_auto_cpa_framework (auto-applied by
//      `prisma migrate deploy` in `pnpm start`).
//   2. Set:
//        RUN_ATIF_COHAN_SWEEP        = true
//        ATIF_COHAN_CLIENT_EMAIL     = atif.ameer@example.com (or your override)
//        ATIF_COHAN_YEAR             = 2025
//        ATIF_COHAN_DRY_RUN          = true  (recommended first pass)
//   3. Deploy. Watch logs for "[atif-cohan]".
//   4. Review findings on /years/2025/findings, then run with DRY_RUN=false
//      OR perform the apply + relock manually through the UI.
//   5. Remove the env vars after successful run.
//
// Idempotent and safe:
//   - If RUN_ATIF_COHAN_SWEEP != true, exits 0 silently.
//   - If user/year isn't found, exits 0 with a log.
//   - In DRY_RUN mode, runs all four pipeline stages (which produce
//     LedgerFinding rows) but does NOT auto-accept or apply. The user reviews
//     in the UI.
//   - With DRY_RUN=false, auto-accepts every auto-fixable finding and applies
//     it via lib/findings/apply.applyAcceptedFindings. Re-lock is still
//     manual (user clicks Confirm Lock from /years/2025/lock — drift dialog
//     surfaces if needed).
//
// This runs ahead of `next start` in the pnpm-start chain, so app runtime
// env (DATABASE_URL, ANTHROPIC_API_KEY) is populated.

import { spawnSync } from "node:child_process"

async function main() {
  if (process.env.RUN_ATIF_COHAN_SWEEP !== "true") {
    return
  }
  const clientEmail = (process.env.ATIF_COHAN_CLIENT_EMAIL ?? "atif.ameer@example.com").trim().toLowerCase()
  const yearStr = (process.env.ATIF_COHAN_YEAR ?? "2025").trim()
  const year = parseInt(yearStr, 10)
  if (!Number.isFinite(year)) {
    console.error(`[atif-cohan] invalid ATIF_COHAN_YEAR="${yearStr}"`)
    return
  }
  const dryRun = (process.env.ATIF_COHAN_DRY_RUN ?? "true").toLowerCase() === "true"

  const tsxEntry = `
    import { prisma } from "@/lib/db"
    import { runPreCleanup } from "@/lib/cleanup/preClassification"
    import { runCpaAudit } from "@/lib/ai/cpaAudit"
    import { runCohanSweep } from "@/lib/ai/cohanSweep"
    import { runSubstantiationQueue } from "@/lib/ai/substantiationQueue"
    import { applyAcceptedFindings, acceptFinding } from "@/lib/findings/apply"
    import { unlockTaxYear } from "@/app/(app)/years/[year]/lock/actions"

    async function run() {
      const user = await prisma.user.findUnique({ where: { email: ${JSON.stringify(clientEmail)} } })
      if (!user) {
        console.log("[atif-cohan] user not found: ${clientEmail}")
        return
      }
      const ty = await prisma.taxYear.findUnique({
        where: { userId_year: { userId: user.id, year: ${year} } },
      })
      if (!ty) {
        console.log("[atif-cohan] tax year ${year} not found for ${clientEmail}")
        return
      }
      const dryRun = ${dryRun}
      console.log("[atif-cohan] running on", user.email, "year ${year}, dryRun=", dryRun)
      console.log("[atif-cohan] current status:", ty.status, "locked hash:", ty.lockedSnapshotHash)

      // We don't unlock automatically — that's a deliberate human action.
      if (ty.status === "LOCKED") {
        console.log("[atif-cohan] TaxYear is LOCKED. Unlock manually before re-running this script with dryRun=false.")
        return
      }

      console.log("[atif-cohan] stage 1: PRE_CLEANUP…")
      const preCleanup = await runPreCleanup(ty.id)
      console.log("[atif-cohan] PRE_CLEANUP result:", JSON.stringify(preCleanup, null, 2))

      console.log("[atif-cohan] stage 2: CPA_AUDIT…")
      const cpaAudit = await runCpaAudit(ty.id)
      console.log("[atif-cohan] CPA_AUDIT result:", JSON.stringify(cpaAudit, null, 2))

      console.log("[atif-cohan] stage 3: COHAN_SWEEP…")
      const cohanSweep = await runCohanSweep(ty.id)
      console.log("[atif-cohan] COHAN_SWEEP result:", JSON.stringify(cohanSweep, null, 2))

      console.log("[atif-cohan] stage 4: SUBSTANTIATION_QUEUE…")
      const substantiation = await runSubstantiationQueue(ty.id)
      console.log("[atif-cohan] SUBSTANTIATION_QUEUE result:", JSON.stringify(substantiation, null, 2))

      const findings = await prisma.ledgerFinding.findMany({
        where: { taxYearId: ty.id, state: "PROPOSED" },
        select: { id: true, severity: true, category: true, autoFixable: true, title: true },
      })
      console.log("[atif-cohan]", findings.length, "PROPOSED findings written:")
      for (const f of findings) {
        console.log("  -", f.severity, f.category, f.autoFixable ? "[auto]" : "[manual]", f.title)
      }

      if (dryRun) {
        console.log("[atif-cohan] DRY_RUN=true — stopping before auto-accept + apply.")
        console.log("[atif-cohan] Review findings on /years/${year}/findings.")
        console.log("[atif-cohan] Re-run with ATIF_COHAN_DRY_RUN=false to auto-accept + apply.")
        return
      }

      // Auto-accept every autoFixable finding
      const autoFixable = findings.filter((f) => f.autoFixable)
      console.log("[atif-cohan] auto-accepting", autoFixable.length, "auto-fixable findings…")
      for (const f of autoFixable) {
        await acceptFinding(f.id)
      }

      console.log("[atif-cohan] applying accepted findings via flip-and-insert…")
      const applyResult = await applyAcceptedFindings(ty.id)
      console.log("[atif-cohan] apply result:", JSON.stringify(applyResult, null, 2))

      await prisma.auditEvent.create({
        data: {
          userId: user.id,
          actorType: "SYSTEM",
          eventType: "ATIF_COHAN_SWEEP_VIA_SCRIPT",
          entityType: "TaxYear",
          entityId: ty.id,
          afterState: {
            preCleanup,
            cpaAuditProposed: cpaAudit.proposed,
            cohanSweepProposals: cohanSweep.proposalsWritten,
            cohanSweepForbiddenRejected: cohanSweep.forbiddenRejected,
            substantiationQueued: substantiation.templatesQueued,
            findingsAutoAccepted: autoFixable.length,
            findingsApplied: applyResult.applied,
          },
        },
      })

      console.log("[atif-cohan] DONE.")
      console.log("[atif-cohan] Next step: re-lock via /years/${year}/lock — RELOCK_VERIFY runs + position memos auto-generate on confirm.")
    }

    run()
      .catch((e) => {
        console.error("[atif-cohan] FATAL:", e)
        process.exit(1)
      })
      .finally(() => prisma.$disconnect())
  `

  const result = spawnSync("npx", ["tsx", "--eval", tsxEntry], {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  })
  if (result.status !== 0) {
    console.error("[atif-cohan] tsx subprocess failed with code", result.status)
    process.exit(0) // never block server boot
  }
}

main().catch((e) => {
  console.error("[atif-cohan] outer catch:", e)
  process.exit(0)
})
