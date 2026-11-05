import { route } from "@/server/api";
import { getPerformance } from "@/server/portfolio";

export const dynamic = "force-dynamic";

export const GET = route(async () => Response.json(await getPerformance()));
