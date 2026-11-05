import { detectPaychecks } from "@/lib/planner/paychecks";
import { route } from "@/server/api";
import { listTransactions } from "@/server/finances";

export const dynamic = "force-dynamic";

/** Paycheck patterns found in your imported transactions (employer, how often, weekday, amount). */
export const GET = route(async () => Response.json(detectPaychecks(await listTransactions())));
