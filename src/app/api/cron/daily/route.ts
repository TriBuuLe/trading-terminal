import { route } from "@/server/api";
import { runDailyJob } from "@/server/cron/daily";

export const dynamic = "force-dynamic";

// Vercel Cron sends GET with `Authorization: Bearer $CRON_SECRET`.
const handler = route(
  async () => {
    const result = await runDailyJob();
    return Response.json(result, { status: result.ok ? 200 : 500 });
  },
  { cron: "only" },
);

export const GET = handler;
export const POST = handler;
