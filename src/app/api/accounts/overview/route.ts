import { route } from "@/server/api";
import { rulesStatus } from "@/server/mock-broker";
import { planVsSandbox } from "@/server/mock-history";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const [compare, rules] = await Promise.all([planVsSandbox(), rulesStatus()]);
  return Response.json({ compare, rules });
});
