import { redirect } from "next/navigation"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { Section, Card } from "@/components/v2/primitives"
import { createTaxYear } from "./actions"

/**
 * /years/new — pick a year, create a TaxYear, route to upload (B-14).
 */
export default async function NewTaxYearPage() {
  await requireAuth()
  const userId = await getCurrentUserId()

  // Pull the user's existing years so the form can grey them out (already
  // created → idempotent route to /upload).
  const existing = await prisma.taxYear.findMany({
    where: { userId },
    orderBy: { year: "desc" },
    select: { year: true, status: true },
  })
  const existingSet = new Set(existing.map((y) => y.year))

  const currentYear = new Date().getUTCFullYear()
  const yearOptions: number[] = []
  for (let y = currentYear + 1; y >= currentYear - 5; y--) yearOptions.push(y)

  // First-time users get redirected to the wizard so they don't land on this
  // form before any profile exists. The action's profile-carryover logic
  // assumes at least one prior profile exists.
  const anyProfile = await prisma.businessProfile.findFirst({ where: { userId }, select: { id: true } })
  if (!anyProfile) redirect("/onboarding")

  return (
    <Section sub="DASHBOARD" title="New tax year">
      <Card pad={28}>
        <p className="text-sm" style={{ color: "var(--fg-2)", marginBottom: 18 }}>
          Pick a year to set up. We&rsquo;ll roll the following forward from your most recent
          year automatically:
        </p>
        <ul className="text-sm" style={{ color: "var(--fg-2)", marginLeft: 18, marginBottom: 18, listStyle: "disc" }}>
          <li>Business profile (entity type, NAICS, accounting method, state, home office, vehicle, revenue streams)</li>
          <li>Owners list (names, ownership %, SSN/EIN, mailing address) — year-specific cash flows reset</li>
          <li>Known entities (contractors, clients, exclusion patterns)</li>
          <li>Carryforward (NOL, §179, depreciation schedule, basis) — only when the prior year is LOCKED</li>
        </ul>
        <p className="text-sm" style={{ color: "var(--fg-2)", marginBottom: 18 }}>
          Trips and merchant rules stay year-specific (the agent re-derives merchant rules each
          year so stale codings don&rsquo;t carry forward).
        </p>
        <form action={async (fd: FormData) => { "use server"; await createTaxYear(String(fd.get("year") ?? "")) }}>
          <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
            {yearOptions.map((y) => {
              const exists = existingSet.has(y)
              return (
                <label
                  key={y}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--hairline)",
                    cursor: exists ? "default" : "pointer",
                    opacity: exists ? 0.55 : 1,
                  }}
                >
                  <input
                    type="radio"
                    name="year"
                    value={y}
                    defaultChecked={y === currentYear - 1 && !exists}
                    disabled={exists}
                    required
                  />
                  <span className="num" style={{ fontWeight: 700, fontSize: 15 }}>{y}</span>
                  {exists && (
                    <span style={{ fontSize: 11, color: "var(--fg-3)" }}>
                      already exists — opens upload
                    </span>
                  )}
                </label>
              )
            })}
          </div>
          <button
            type="submit"
            style={{
              padding: "9px 16px",
              borderRadius: 8,
              background: "var(--tl-accent)",
              color: "white",
              fontWeight: 600,
              border: 0,
              cursor: "pointer",
            }}
          >
            Create year & upload statements →
          </button>
        </form>
      </Card>
    </Section>
  )
}
