import { cache } from "react"
import { cookies } from "next/headers"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"

export const CLIENT_CONTEXT_COOKIE = "taxlens_client_ctx"

export interface ClientContext {
  cpaId: string
  clientId: string
  clientName: string
  clientEmail: string
}

export const getClientContext = cache(async (): Promise<ClientContext | null> => {
  const session = await auth()
  if (!session?.user?.id) return null

  const cookieStore = await cookies()
  const val = cookieStore.get(CLIENT_CONTEXT_COOKIE)?.value
  if (!val) return null

  const [cpaId, clientId] = val.split(":")
  if (!cpaId || !clientId || cpaId !== session.user.id) return null

  const rel = await prisma.cpaClient.findUnique({
    where: { cpaUserId_clientUserId: { cpaUserId: cpaId, clientUserId: clientId } },
    include: { client: { select: { id: true, name: true, email: true } } },
  })
  if (!rel) return null

  return {
    cpaId,
    clientId: rel.clientUserId,
    clientName: rel.client.name ?? rel.client.email,
    clientEmail: rel.client.email,
  }
})
