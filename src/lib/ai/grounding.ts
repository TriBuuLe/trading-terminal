/**
 * Number check: every dollar amount in the assistant's reply should come from
 * your data (or simple arithmetic on it: ×12, ÷12, sums the reply shows). Amounts
 * that match nothing are listed so you know which numbers to double-check.
 */
export function collectNumbers(x: unknown, out: number[] = []): number[] {
  if (typeof x === "number" && Number.isFinite(x)) out.push(x);
  else if (Array.isArray(x)) for (const v of x) collectNumbers(v, out);
  else if (x && typeof x === "object") for (const v of Object.values(x)) collectNumbers(v, out);
  else if (typeof x === "string") for (const m of x.matchAll(/\$?(-?\d[\d,]*\.?\d*)/g)) out.push(Number(m[1]!.replace(/,/g, "")));
  return out;
}

const amounts = (text: string) => [...text.matchAll(/(−|-)?\$\s?(\d[\d,]*(?:\.\d+)?)(\s?[kK]\b)?/g)].map((m) => ({ raw: m[0], value: Number(m[2]!.replace(/,/g, "")) * (m[3] ? 1000 : 1) }));

export function ungroundedAmounts(reply: string, context: unknown, userText = ""): string[] {
  const known = collectNumbers(context).concat(collectNumbers(userText));
  const pool = new Set<number>();
  for (const n of known) {
    const a = Math.abs(n);
    pool.add(a).add(a * 12).add(a / 12);
  }
  // Numbers the reply itself derives (a − b, a + b of nearby amounts) are checked loosely: within 1% or $1.
  const found = amounts(reply);
  const values = found.map((f) => f.value);
  for (let i = 0; i < values.length; i++) for (let j = 0; j < values.length; j++) if (i !== j) pool.add(Math.abs(values[i]! - values[j]!)).add(values[i]! + values[j]!);
  const near = (v: number) => [...pool].some((k) => Math.abs(k - v) <= Math.max(1, Math.abs(k) * 0.01));
  return [...new Set(found.filter((f) => f.value >= 10 && !near(f.value)).map((f) => f.raw.trim()))];
}
