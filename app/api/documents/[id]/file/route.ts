import { NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { getCurrentCpaContext } from "@/lib/cpa/clientContext"
import { getAdminCpaContext } from "@/lib/admin/adminContext"

interface Params {
  params: Promise<{ id: string }>
}

/**
 * GET /api/documents/[id]/file
 *
 * Streams the underlying PDF/CSV/etc back inline so it renders in the browser
 * tab instead of forcing a download. Authorized for:
 *   1. The Document's owner (client viewing their own statements).
 *   2. Any CPA who has a CpaClient relationship with the owner.
 *   3. A SUPER_ADMIN currently impersonating one of the above.
 *
 * Anything else returns 404 (no information leak).
 */
export async function GET(_req: Request, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) {
    return new NextResponse(null, { status: 401 })
  }
  const { id } = await params

  const doc = await prisma.document.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      filePath: true,
      originalFilename: true,
      mimeType: true,
    },
  })
  if (!doc) {
    return new NextResponse("Not found", { status: 404 })
  }

  const allowedUserIds = new Set<string>()
  allowedUserIds.add(session.user.id)
  // CPA tier — any client of the logged-in user counts.
  const cpaCtx = await getCurrentCpaContext()
  const adminCpaCtx = await getAdminCpaContext()
  const effectiveCpaId = adminCpaCtx?.cpaId ?? cpaCtx?.cpaId ?? null
  if (effectiveCpaId) {
    const rels = await prisma.cpaClient.findMany({
      where: { cpaUserId: effectiveCpaId },
      select: { clientUserId: true },
    })
    for (const r of rels) allowedUserIds.add(r.clientUserId)
  }
  if (!allowedUserIds.has(doc.userId)) {
    return new NextResponse("Not found", { status: 404 })
  }

  let buffer: Buffer
  try {
    buffer = await readFile(doc.filePath)
  } catch {
    return new NextResponse("File missing on disk", { status: 410 })
  }

  const mime = doc.mimeType ?? "application/octet-stream"
  // Inline disposition so PDFs render in the browser; filename is a hint for
  // when the user chooses Save As.
  const safeName = doc.originalFilename.replace(/"/g, "")
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(buffer.byteLength),
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  })
}
