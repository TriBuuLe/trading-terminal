import { route } from "@/server/api";
import { finnhubConfigured } from "@/server/finnhub";
import { getFundamentals } from "@/server/fundamentals";

export const dynamic = "force-dynamic";

export const GET = route<{ params: Promise<{ symbol: string }> }>(async (_req, { params }) => {
  if (!finnhubConfigured()) return Response.json({ enabled: false });
  const { symbol } = await params;
  return Response.json({ enabled: true, ...(await getFundamentals(symbol)) });
});
