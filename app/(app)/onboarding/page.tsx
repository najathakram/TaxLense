import { redirect } from "next/navigation"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import Wizard from "./wizard"
import type { WizardData, TripFormData, KnownEntityFormData, IncomeSourceFormData } from "./types"

export default async function OnboardingPage() {
  const userId = await getCurrentUserId()

  // Find the active (CREATED) tax year for this user
  const taxYear = await prisma.taxYear.findFirst({
    where: { userId, status: "CREATED" },
    orderBy: { year: "desc" },
    include: {
      businessProfile: {
        include: { trips: true, knownEntities: true },
      },
    },
  })

  // If the user has tax years but none are CREATED (all past wizard), the
  // wizard is done — send them to the dashboard. A brand-new user with zero
  // tax years falls through and sees Step 1, which creates the TaxYear row.
  if (!taxYear) {
    const anyTaxYear = await prisma.taxYear.findFirst({ where: { userId }, select: { id: true } })
    if (anyTaxYear) redirect("/dashboard")
  }

  const profile = taxYear?.businessProfile ?? null

  // Default new users to the most recent past tax year (the one currently
  // being prepared). Users can still change it in Step 1 before it's saved.
  const defaultYear = new Date().getFullYear() - 1

  // Map DB profile → WizardData for pre-filling the wizard
  const initialData: Partial<WizardData> = {
    year: taxYear?.year ?? defaultYear,
    ...(profile
      ? {
          entityType: profile.entityType as WizardData["entityType"],
          primaryState: profile.primaryState,
          accountingMethod: profile.accountingMethod as WizardData["accountingMethod"],
          firstYear: profile.firstYear,
          businessDescription: profile.businessDescription ?? "",
          naicsCode: profile.naicsCode ?? "",
          revenueStreams: profile.revenueStreams,
          grossReceiptsEstimate: profile.grossReceiptsEstimate
            ? Number(profile.grossReceiptsEstimate)
            : 0,
          homeOfficeConfig: profile.homeOfficeConfig as WizardData["homeOfficeConfig"],
          vehicleConfig: profile.vehicleConfig as WizardData["vehicleConfig"],
          inventoryConfig: profile.inventoryConfig as WizardData["inventoryConfig"],
          trips: profile.trips.map(
            (t): TripFormData => ({
              id: t.id,
              name: t.name,
              destination: t.destination,
              startDate: t.startDate.toISOString().slice(0, 10),
              endDate: t.endDate.toISOString().slice(0, 10),
              purpose: t.purpose,
              deliverableDescription: t.deliverableDescription ?? "",
              isConfirmed: t.isConfirmed,
            })
          ),
          knownEntities: profile.knownEntities.map(
            (e): KnownEntityFormData => ({
              id: e.id,
              kind: e.kind as KnownEntityFormData["kind"],
              displayName: e.displayName,
              matchKeywords: e.matchKeywords,
              defaultCode: e.defaultCode ?? null,
              notes: e.notes ?? "",
            })
          ),
          incomeSources: Array.isArray(profile.incomeSources)
            ? (profile.incomeSources as IncomeSourceFormData[])
            : [],
        }
      : {}),
  }

  const initialStep = profile?.draftStep ?? 1

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Profile Wizard</h1>
        <p className="text-muted-foreground mt-1">
          This takes 10–15 minutes. Your answers give the AI the context it needs to correctly
          classify your transactions. Finished once, reused every year.
        </p>
      </div>
      <Wizard initialStep={initialStep} initialData={initialData} />
    </div>
  )
}
