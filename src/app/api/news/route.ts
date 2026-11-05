import { z } from "zod";
import { route } from "@/server/api";
import { getNews } from "@/server/alpaca/market";
import { searchParams, symbolsParam } from "@/server/req";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const symbols = symbolsParam(req, "symbols", 60);
  const limit = z.coerce.number().int().min(1).max(50).default(20).parse(searchParams(req).get("limit") ?? undefined);
  const news = await getNews(symbols, limit);
  return Response.json(
    news.map((n) => ({
      id: n.id,
      headline: n.headline,
      summary: n.summary ?? null,
      source: n.source ?? null,
      url: n.url ?? null,
      symbols: n.symbols,
      createdAt: n.created_at,
      image: n.images?.find((i) => i.size === "thumb")?.url ?? null,
    })),
  );
});
