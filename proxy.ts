/**
 * TaxLens — Next.js 16 Proxy (replaces deprecated middleware.ts)
 *
 * Runs in Node.js runtime (default in Next.js 16).
 * Checks the NextAuth JWT session cookie and redirects unauthenticated
 * requests to /login.
 *
 * Note: Do NOT import Prisma or heavy server modules here even though the
 * proxy runs in Node.js — keep boot time fast. Session validation uses
 * next-auth/jwt which only reads the JWT cookie.
 */

import { getToken } from "next-auth/jwt"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const PUBLIC_PATHS = ["/login", "/signup", "/api/auth"]

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Always allow public paths through
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Validate JWT session token (reads from cookie; no DB call)
  const token = await getToken({
    req: request,
    secret: process.env["AUTH_SECRET"]!,
  })

  if (!token) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
