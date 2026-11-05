import { route } from "@/server/api";
import { netWorthHistory } from "@/server/finances";

export const dynamic = "force-dynamic";

export const GET = route(async () => Response.json(await netWorthHistory()));
