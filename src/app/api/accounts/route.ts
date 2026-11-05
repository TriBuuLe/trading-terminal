import { z } from "zod";
import { route } from "@/server/api";
import { householdLocation, listAccounts, listSchedules, openAccount, rulesStatus } from "@/server/mock-broker";
import { body } from "@/server/req";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const [accounts, schedules, rules, location] = await Promise.all([listAccounts(), listSchedules(), rulesStatus(), householdLocation()]);
  return Response.json({
    accounts,
    schedules,
    rules: { year: rules.year, lastVerified: rules.lastVerified, missing: rules.missing },
    location: { target: location.target, perAccount: location.loc.perAccount, combined: location.loc.combined, reasons: location.loc.reasons },
  });
});

export const POST = route(async (req) => {
  const b = await body(req, z.object({ type: z.enum(["ROTH_IRA", "TRADITIONAL_IRA", "401K", "HSA", "TFSA", "RRSP", "FHSA", "TAXABLE"]), name: z.string().trim().min(1).max(60) }));
  return Response.json({ id: await openAccount(b.type, b.name) }, { status: 201 });
});
