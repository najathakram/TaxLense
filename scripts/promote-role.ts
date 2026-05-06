/**
 * Promote (or demote) a user to one of the three platform roles.
 *
 * Usage (from project root, with DATABASE_URL set):
 *   pnpm tsx scripts/promote-role.ts <email> <SUPER_ADMIN|CPA|CLIENT>
 *
 * Examples:
 *   pnpm tsx scripts/promote-role.ts najath@nexezt.com SUPER_ADMIN
 *   pnpm tsx scripts/promote-role.ts najathakram1@gmail.com CPA
 *
 * Generic counterpart to scripts/promote-admin.ts. Same rationale: role
 * grants are a CLI-only operation, never reachable through any UI, to
 * prevent privilege escalation via a phished/compromised browser session.
 *
 * Idempotent — re-running for a user already at the target role logs
 * "no-op" and exits 0.
 *
 * If the user does NOT exist yet, we INSERT a minimal row (email + role).
 * NextAuth's PrismaAdapter will then link the Google OAuth account by
 * email on first sign-in. This unblocks "promote first, sign in second"
 * for fresh-account onboarding.
 */
import { PrismaClient, type UserRole } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const VALID_ROLES: UserRole[] = ["SUPER_ADMIN", "CPA", "CLIENT"]

async function main() {
  const email = process.argv[2]?.trim().toLowerCase()
  const targetRoleArg = process.argv[3]?.trim().toUpperCase()
  if (!email || !targetRoleArg) {
    console.error("Usage: pnpm tsx scripts/promote-role.ts <email> <SUPER_ADMIN|CPA|CLIENT>")
    process.exit(1)
  }
  if (!VALID_ROLES.includes(targetRoleArg as UserRole)) {
    console.error(`Invalid role "${targetRoleArg}". Must be one of: ${VALID_ROLES.join(", ")}`)
    process.exit(1)
  }
  const targetRole = targetRoleArg as UserRole

  const connectionString = process.env["DATABASE_URL"]
  if (!connectionString) {
    console.error("DATABASE_URL not set in environment.")
    process.exit(1)
  }

  const adapter = new PrismaPg({ connectionString })
  const prisma = new PrismaClient({ adapter })

  try {
    const existing = await prisma.user.findUnique({ where: { email } })

    if (!existing) {
      // Pre-create a row so NextAuth links the OAuth account on first sign-in.
      const created = await prisma.user.create({
        data: { email, role: targetRole },
      })
      await prisma.auditEvent.create({
        data: {
          userId: created.id,
          actorType: "SYSTEM",
          eventType: "USER_PROMOTED_VIA_SCRIPT",
          entityType: "User",
          entityId: created.id,
          afterState: { email, role: targetRole, prefilled: true },
          rationale: `Pre-created via scripts/promote-role.ts on ${new Date().toISOString()}. Will be linked when user signs in via Google OAuth.`,
        },
      })
      console.log(`✓ ${email} created with role ${targetRole}.`)
      console.log(`  Sign in with Google to link the OAuth account; the role will already be set.`)
      return
    }

    if (existing.role === targetRole) {
      console.log(`User ${email} is already ${targetRole}. No-op.`)
      return
    }

    const previousRole = existing.role
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: existing.id },
        data: { role: targetRole },
      })
      await tx.auditEvent.create({
        data: {
          userId: existing.id,
          actorType: "SYSTEM",
          eventType: "USER_PROMOTED_VIA_SCRIPT",
          entityType: "User",
          entityId: existing.id,
          beforeState: { role: previousRole },
          afterState: { role: targetRole },
          rationale: `Promoted via scripts/promote-role.ts on ${new Date().toISOString()}`,
        },
      })
    })

    console.log(`✓ ${email} promoted to ${targetRole} (was ${previousRole}).`)
    if (targetRole === "SUPER_ADMIN") {
      console.log(`  Sign in normally; /admin is now reachable.`)
    } else if (targetRole === "CPA") {
      console.log(`  Sign in normally; /workspace is now reachable.`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
