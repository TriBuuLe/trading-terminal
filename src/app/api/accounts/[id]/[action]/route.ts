import { z } from "zod";
import { DEFAULT_ASSUMPTIONS } from "@/lib/planner/assumptions";
import { wrapperValue } from "@/lib/accounts/projection";
import { equityForRisk, riskScore } from "@/lib/planner/core";
import { route } from "@/server/api";
import { getAssumptions, getProfile } from "@/server/finances";
import {
  addSchedule,
  closeAccount,
  contribute,
  executeFund,
  getAccountState,
  previewContribution,
  previewWithdrawal,
  proposeFund,
  trade,
  withdraw,
} from "@/server/mock-broker";
import { accountHistory } from "@/server/mock-history";
import { body } from "@/server/req";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; action: string }> };

const amount = z.number().positive().max(10_000_000);
const sym = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9.\-/]{0,9}$/);

/** Read-only views. */
export const GET = route<Ctx>(async (req, { params }) => {
  const { id, action } = await params;
  const accountId = z.coerce.number().int().positive().parse(id);
  if (action === "history") return Response.json(await accountHistory(accountId));
  if (action === "projection") {
    const q = new URL(req.url).searchParams;
    const [profile, assumptions, acct] = await Promise.all([getProfile(), getAssumptions(), getAccountState(accountId)]);
    const eq = equityForRisk(profile ? (profile.riskOverride ?? riskScore(profile.risk)) : 6);
    const age = profile?.age ?? 30;
    const retireAge = z.coerce.number().int().min(age + 1).max(90).catch(65).parse(q.get("retireAge") ?? 65);
    const monthly = z.coerce.number().min(0).max(100_000).catch(0).parse(q.get("monthly") ?? 0);
    const r = wrapperValue({
      current: acct.value ?? acct.cash,
      monthly,
      years: retireAge - age,
      mix: { equity: eq, bonds: 1 - eq, cash: 0 },
      assumptions: assumptions ?? DEFAULT_ASSUMPTIONS,
      dividendYieldPct: z.coerce.number().min(0).max(10).catch(2).parse(q.get("divYield") ?? 2),
      dividendTaxPct: z.coerce.number().min(0).max(60).catch(25).parse(q.get("divTax") ?? 25),
      capitalGainsTaxPct: z.coerce.number().min(0).max(60).catch(15).parse(q.get("cgTax") ?? 15),
    });
    return Response.json({ retireAge, years: retireAge - age, monthly, equity: eq, ...r, taxFree: undefined });
  }
  return Response.json({ error: "unknown view" }, { status: 404 });
});

/** Actions (previews never change anything). */
export const POST = route<Ctx>(async (req, { params }) => {
  const { id, action } = await params;
  const accountId = z.coerce.number().int().positive().parse(id);
  try {
    switch (action) {
      case "contribute-preview": {
        const b = await body(req, z.object({ amount, taxYear: z.number().int().optional() }));
        return Response.json(await previewContribution(accountId, b.amount, b.taxYear));
      }
      case "contribute": {
        const b = await body(req, z.object({ amount, taxYear: z.number().int().optional(), acceptExcess: z.boolean().optional() }));
        return Response.json(await contribute(accountId, b.amount, b));
      }
      case "withdraw-preview":
        return Response.json(await previewWithdrawal(accountId, (await body(req, z.object({ amount }))).amount));
      case "withdraw":
        return Response.json(await withdraw(accountId, (await body(req, z.object({ amount }))).amount));
      case "trade": {
        const b = await body(req, z.object({ symbol: sym, side: z.enum(["buy", "sell"]), qty: z.number().positive().max(1e7) }));
        return Response.json(await trade(accountId, b.symbol, b.side, b.qty));
      }
      case "fund-preview":
        return Response.json(await proposeFund(accountId, (await body(req, z.object({ amount }))).amount));
      case "fund": {
        const b = await body(req, z.object({ amount, taxYear: z.number().int().optional() }));
        return Response.json({ buys: await executeFund(accountId, b.amount, { taxYear: b.taxYear }) });
      }
      case "schedule": {
        const b = await body(req, z.object({ amount, dayOfMonth: z.number().int().min(1).max(28) }));
        return Response.json(await addSchedule(accountId, b.amount, b.dayOfMonth), { status: 201 });
      }
      case "close":
        await closeAccount(accountId);
        return Response.json({ ok: true });
      default:
        return Response.json({ error: "unknown action" }, { status: 404 });
    }
  } catch (e) {
    if (e instanceof z.ZodError) throw e;
    // Rule violations, insufficient cash, etc.: show the reason plainly.
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422 });
  }
});
