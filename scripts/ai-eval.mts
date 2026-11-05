/**
 * pnpm ai:eval — ask the finance assistant fixed questions against YOUR real data
 * and check the answers for the failure modes we've seen: calling you by someone
 * else's name, made-up numbers, wrong arithmetic, pretend memory, and proposing
 * changes nobody asked for. Prints pass/fail per check; no data is changed.
 */
import { createRedactor } from "../src/lib/ai/redact";
import { askAssistant, financeContext } from "../src/server/ai/assistant";

const ctx = await financeContext();
if (!ctx) {
  console.log("No profile yet.");
  process.exit(1);
}
const red = createRedactor();
red.redact(JSON.stringify(ctx));
const others = [...red.people.keys()]; // real names of other people in your transactions

interface Case {
  q: string;
  expectActions?: "none" | "some" | ((types: string[]) => boolean);
  mustNot?: RegExp[];
  must?: RegExp[];
}
const CASES: Case[] = [
  { q: "who are you and what can you do", expectActions: "none" },
  { q: "what is my name?", expectActions: (t) => t.every((x) => x === "set_name"), mustNot: [/noted/i] },
  { q: "my name is Tri Le, call me Tri", expectActions: (t) => t.includes("set_name"), mustNot: [/\bnoted\b/i, /I'?ve saved/i] },
  { q: "look into my current income stream, where does the planned income in my plan tab come from?", expectActions: "none" },
  { q: "How much did I spend on dining out this year and how does it compare to my budget?", expectActions: "none" },
  { q: "Set up my 2026 plan: save and invest targets I can actually hit, and trim my wants.", expectActions: "some" },
];

let fails = 0;
for (const c of CASES) {
  let r;
  try {
    r = await askAssistant([{ role: "user", text: c.q }]);
  } catch (e) {
    console.log(`\n✗ ${c.q}\n  error: ${(e as Error).message}`);
    fails++;
    continue;
  }
  const types = r.actions.map((a) => a.action.type);
  const problems: string[] = [];
  const leaked = others.filter((n) => new RegExp(`\\b(you|your name|you're|you are|hi|hello)\\b[^.]{0,40}${n}`, "i").test(r.reply) || new RegExp(`${n}'s (current|income|plan|finances)`, "i").test(r.reply));
  if (leaked.length) problems.push(`treats you as someone else: ${leaked.join(", ")}`);
  if (r.ungrounded.length) problems.push(`numbers not in your data: ${r.ungrounded.join(", ")}`);
  if (r.wrongMath.length) problems.push(`wrong math: ${r.wrongMath.join("; ")}`);
  if (r.rejected.length) problems.push(`invalid changes: ${r.rejected.join("; ")}`);
  if (c.expectActions === "none" && types.length) problems.push(`proposed changes nobody asked for: ${types.join(", ")}`);
  if (c.expectActions === "some" && !types.length) problems.push("no changes proposed");
  if (typeof c.expectActions === "function" && !c.expectActions(types)) problems.push(`unexpected changes: [${types.join(", ")}]`);
  for (const re of c.mustNot ?? []) if (re.test(r.reply)) problems.push(`says ${re}`);
  for (const re of c.must ?? []) if (!re.test(r.reply)) problems.push(`missing ${re}`);
  if (problems.length) fails++;
  console.log(`\n${problems.length ? "✗" : "✓"} ${c.q}  [${r.model}]`);
  for (const p of problems) console.log(`  - ${p}`);
  if (process.argv.includes("--show")) console.log(r.reply.split("\n").map((l) => `    | ${l}`).join("\n"));
}
console.log(`\n${CASES.length - fails}/${CASES.length} passed`);
process.exit(fails ? 1 : 0);
