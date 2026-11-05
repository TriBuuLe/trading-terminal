import { route } from "@/server/api";
import { getPositionRows } from "@/server/account";

export const dynamic = "force-dynamic";

export const GET = route(async () => Response.json(await getPositionRows()));
