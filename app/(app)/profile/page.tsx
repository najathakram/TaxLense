import { redirect } from "next/navigation"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import ProfileEditClient from "./profile-edit-client"
import type { WizardData, TripFormData, KnownEntityFormData, IncomeSourceFormData } from "@/app/(app)/onboarding/types"

export default async function ProfilePage() {
  const session = await requireAuth()
  const userId = session.user!.id!

  // Find the most recently active profile (any status except CREATED — i.e., wizard complete)
  const taxYear = await prisma.taxYear.findFirst({
    where: { userId, status: { not: "ARCHIVED" } },
    orderBy: { year: "desc" },
    include: {
      businessProfile: {
        include: { trips: true, knownEntities: true },
      },
    },
  })

  if (!taxYear || !taxYear.businessProfile) {
    redirect("/onboarding")
  }

  const profile = taxYear.businessProfile

  const profileData: Partial<WizardData> = {
    year: taxYear.year,
    entityType: profile.entityType as WizardData["entityType"],
    primaryState: profile.primaryState,
    accountingMethod: profile.accountingMethod as WizardData["accountingMethod"],
    firstYear: profile.firstYear,
    businessDescription: profile.businessDescription ?? "",
    naicsCode: profile.naicsCode ?? "",
    revenueStreams: profile.revenueStreams,
    grossReceiptsEstimate: profile.grossReceiptsEstimate ? Number(profile.grossReceiptsEstimate) : 0,
    homeOfficeConfig: profile.homeOfficeConfig as WizardData["homeOfficeConfig"],
    vehicleConfig: profile.vehicleConfig as WizardData["vehicleConfig"],
    inventoryConfig: profile.inventoryConfig as WizardData["inventoryConfig"],
    trips: profile.trips.map((t): TripFormData => ({
      id: t.id,
      name: t.name,
      destination: t.destination,
      startDate: t.startDate.toISOString().slice(0, 10),
      endDate: t.endDate.toISOString().slice(0, 10),
      purpose: t.purpose,
      deliverableDescription: t.deliverableDescription ?? "",
      isConfirmed: t.isConfirmed,
    })),
    knownEntities: profile.knownEntities.map((e): KnownEntityFormData => ({
      id: e.id,
      kind: e.kind as KnownEntityFormData["kind"],
      displayName: e.displayName,
      matchKeywords: e.matchKeywords,
      defaultCode: e.defaultCode ?? null,
      notes: e.notes ?? "",
    })),
    incomeSources: Array.isArray(profile.incomeSources)
      ? (profile.incomeSources as IncomeSourceFormData[])
      : [],
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Business Profile</h1>
          <p className="text-muted-foreground">TY {taxYear.year} — edits create an audit event</p>
        </div>
        <Badge variant={taxYear.status === "LOCKED" ? "default" : "secondary"}>{taxYear.status}</Badge>
      </div>

      <ProfileEditClient profileData={profileData} />
    </div>
  )
}
