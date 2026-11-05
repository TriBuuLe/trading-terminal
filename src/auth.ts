import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { NextResponse } from "next/server";
import { demoAuthBypass, isAllowedLogin, isSelfAuthenticatingPath } from "./server/auth-rules";

declare module "next-auth" {
  interface Session {
    login?: string;
  }
}

/**
 * Single-user auth: GitHub OAuth, and only ALLOWED_GITHUB_USER may sign in.
 * Sessions are JWTs in an encrypted cookie (no DB tables needed).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  callbacks: {
    signIn({ profile }) {
      // Returning false shows /login?error=AccessDenied.
      return isAllowedLogin(profile?.login);
    },
    jwt({ token, profile }) {
      if (profile && typeof profile.login === "string") token.login = profile.login;
      return token;
    },
    session({ session, token }) {
      session.login = typeof token.login === "string" ? token.login : undefined;
      return session;
    },
    /** Used by proxy.ts. Route handlers re-check with requireAuth(). */
    authorized({ auth: session, request }) {
      const { pathname } = request.nextUrl;
      if (isSelfAuthenticatingPath(pathname) || demoAuthBypass()) return true;
      if (session && isAllowedLogin(session.login)) return true;
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return false; // redirect to /login
    },
  },
});
