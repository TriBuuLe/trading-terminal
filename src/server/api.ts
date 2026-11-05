import { auth } from "@/auth";
import { demoAuthBypass, hasCronBearer, isAllowedLogin } from "./auth-rules";
import { errorResponse } from "./http";

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/**
 * Wrap every /api route handler. Defense in depth: proxy.ts already blocks
 * logged-out requests, but each route checks again here.
 *  - default: requires the allowed GitHub user's session
 *  - { cron: "only" }: requires `Authorization: Bearer $CRON_SECRET`
 *  - { cron: "also" }: session OR cron bearer (health check)
 */
export function route<C = unknown>(handler: Handler<C>, opts: { cron?: "only" | "also" } = {}): Handler<C> {
  return async (req, ctx) => {
    try {
      const bearerOk = opts.cron ? hasCronBearer(req.headers.get("authorization")) : false;
      if (opts.cron === "only" && !bearerOk) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (!bearerOk && !demoAuthBypass()) {
        const session = await auth();
        if (!session || !isAllowedLogin(session.login)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
      }
      return await handler(req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
