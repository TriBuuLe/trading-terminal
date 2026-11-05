import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { AssetHit } from "@/lib/types";
import { route } from "@/server/api";
import { syncAssets } from "@/server/orders";
import { searchParams } from "@/server/req";

export const dynamic = "force-dynamic";

/** Symbol search over Alpaca's tradable US equities (synced into Postgres). */
export const GET = route(async (req) => {
  const q = (searchParams(req).get("q") ?? "").trim().toUpperCase().slice(0, 40);
  if (!q) return Response.json([]);

  const count = await db().execute<{ n: number }>(sql`select count(*)::int as n from assets`);
  if ((count[0]?.n ?? 0) === 0) await syncAssets(); // first run: populate

  const like = `${q.replace(/[%_\\]/g, "\\$&")}%`;
  const contains = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  const rows = await db().execute<AssetHit & { rank: number } & Record<string, unknown>>(sql`
    select * from (
      select symbol, name, exchange, fractionable, shortable, tradable,
        case when symbol = ${q} then 0
             when symbol like ${like} then 1
             when upper(name) like ${like} then 2
             else 3 end as rank
      from assets
      where tradable and exchange <> 'OTC'
        and (symbol like ${like} or upper(name) like ${contains})
    ) hits
    order by rank, case when rank <= 1 then length(symbol) else length(name) end, symbol
    limit 12`);
  return Response.json(rows.map(({ rank: _rank, ...r }) => r));
});
