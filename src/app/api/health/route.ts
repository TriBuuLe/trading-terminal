import { route } from "@/server/api";
import { runHealthChecks } from "@/server/health";

export const dynamic = "force-dynamic";

export const GET = route(
  async () => {
    const result = await runHealthChecks();
    return Response.json(result, { status: result.ok ? 200 : 503 });
  },
  { cron: "also" },
);
