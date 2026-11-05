// Next.js 16 renamed middleware.ts to proxy.ts. Auth.js's `auth` export works as
// the proxy function; the `authorized` callback in src/auth.ts decides access.
export { auth as proxy } from "./auth";

export const config = {
  // Everything except Next's static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
