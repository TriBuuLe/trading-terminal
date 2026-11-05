import { route } from "@/server/api";
import { getJournal } from "@/server/journal";

export const dynamic = "force-dynamic";

export const GET = route(async () => Response.json(await getJournal()));
