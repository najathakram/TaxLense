/**
 * Promote a user to SUPER_ADMIN.
 *
 * Usage (from project root, with DATABASE_URL set):
 *   pnpm tsx scripts/promote-admin.ts <email>
 *
 * This is intentionally a CLI-only operation — there is no UI path to grant
 * SUPER_ADMIN. The audit-defense rationale is that admin promotion is a
 * platform-operator decision that should not be reachable via a phished CPA
 * session, so it stays on the server side.
 *
 * Idempotent: re-running for an already-admin user is a no-op (apart from
 * audit log entry).
 */
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

async function main() {
  const email = process.argv[2]
  if (!email) {
    console.error("Usage: pnpm tsx scripts/promote-admin.ts <email>")
    process.exit(1)
  }

  const connectionString = process.env["DATABASE_URL"]
  if (!connectionString) {
    console.error("DATABASE_URL not set in environment.")
    process.exit(1)
  }

  const adapter = new PrismaPg({ connectionString })
  const prisma = new PrismaClient({ adapter })

  try {
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      console.error(`User with email ${email} not found.`)
      process.exit(1)
    }

    if (user.role === "SUPER_ADMIN") {
      console.log(`User ${email} is already SUPER_ADMIN. No-op.`)
      return
    }

    const previousRole = user.role
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { role: "SUPER_ADMIN" },
      })
      await tx.auditEvent.create({
        data: {
          userId: user.id,
          actorType: "SYSTEM",
          eventType: "USER_PROMOTED_TO_ADMIN",
          entityType: "User",
          entityId: user.id,
          beforeState: { role: previousRole },
          afterState: { role: "SUPER_ADMIN" },
          rationale: `Promoted via scripts/promote-admin.ts on ${new Date().toISOString()}`,
        },
      })
    })

    console.log(`✓ ${email} promoted to SUPER_ADMIN (was ${previousRole}).`)
    console.log(`  Sign in normally; the /admin route group is now reachable.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
