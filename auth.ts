import NextAuth from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import Credentials from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"
import { z } from "zod"

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // Allow Google sign-in to link to a pre-existing User row by email.
      //
      // Why this is safe in our model:
      //   1. New User rows are NEVER created by untrusted input. They come
      //      from the SUPER_ADMIN-only bootstrap script or an authenticated
      //      CPA's createClientAccount/createCpaAccount server action.
      //   2. Google sets email_verified=true on every OIDC profile, so a
      //      successful Google sign-in proves the user owns the email.
      //   3. Without this flag, NextAuth refuses to link a Google sign-in
      //      to an existing User-by-email and returns OAuthAccountNotLinked,
      //      breaking the bootstrap-pre-create-then-sign-in flow.
      //
      // The "dangerous" name is for apps that allow unverified email signups;
      // we don't.
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials)
        if (!parsed.success) return null

        const { email, password } = parsed.data

        const user = await prisma.user.findUnique({ where: { email } })
        if (!user?.password) return null
        // Soft-suspended users cannot log in. Rows are preserved for audit.
        if (!user.isActive) return null

        const valid = await bcrypt.compare(password, user.password)
        if (!valid) return null

        return { id: user.id, email: user.email, name: user.name, role: user.role }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as { role?: string }).role ?? "CLIENT"
      }
      return token
    },
    session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = token.id as string
        ;(session.user as { id: string; role?: string }).role = token.role as string
      }
      return session
    },
  },
})
