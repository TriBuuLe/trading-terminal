import { route } from "@/server/api";
import { deleteAll, exportAll } from "@/server/finances";
import { searchParams } from "@/server/req";

export const dynamic = "force-dynamic";

/** "Export my data": JSON (everything) or CSV (transactions). */
export const GET = route(async (req) => {
  const data = await exportAll();
  const day = new Date().toISOString().slice(0, 10);
  if (searchParams(req).get("format") === "csv") {
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const csv = ["date,description,amount,category", ...data.transactions.map((t) => [t.date, esc(t.description), t.amount.toFixed(2), esc(t.category)].join(","))].join("\n");
    return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="folio-transactions-${day}.csv"` } });
  }
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="folio-finances-${day}.json"` },
  });
});

/** "Delete all my financial data". */
export const DELETE = route(async () => {
  await deleteAll();
  return Response.json({ ok: true });
});
