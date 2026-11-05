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

/**
 * Arithmetic the reply shows ("$486.49 × 7 = $3,405.43", "$5,301.88 + $3,976.41 = $9,278.29",
 * chains like "a + b + c = d"): flag every equation that doesn't hold (within 1% or $1).
 * × and ÷ bind tighter than + and −.
 */
const NUM = String.raw`\$?\s?\d[\d,]*(?:\.\d+)?`;
const OP = String.raw`[×x*+−\-÷/]`;
const WORDS = String.raw`(?:\s*\(?[a-z][a-z .&'()-]{0,24}?\)?)?`; // "7 deposits", "(Nov)"
const EQUATION = new RegExp(`(${NUM}${WORDS}(?:\\s*${OP}\\s*${NUM}${WORDS})+)\\s*=\\s*(${NUM})`, "gi");

function evaluate(expr: string): number | null {
  const tokens = [...expr.matchAll(new RegExp(`(${NUM})|(${OP})`, "gi"))].map((m) => m[0].trim());
  const nums: number[] = [];
  const ops: string[] = [];
  for (const t of tokens) {
    if (/\d/.test(t)) nums.push(Number(t.replace(/[$,\s]/g, "")));
    else ops.push(t);
  }
  if (nums.length !== ops.length + 1) return null;
  // × ÷ first
  const n2 = [nums[0]!];
  const o2: string[] = [];
  ops.forEach((o, k) => {
    const b = nums[k + 1]!;
    if (/[×x*]/i.test(o)) n2[n2.length - 1]! *= b;
    else if (/[÷/]/.test(o)) n2[n2.length - 1] = b ? n2[n2.length - 1]! / b : NaN;
    else {
      n2.push(b);
      o2.push(o);
    }
  });
  return o2.reduce((acc, o, k) => (o === "+" ? acc + n2[k + 1]! : acc - n2[k + 1]!), n2[0]!);
}

export function wrongMath(reply: string): string[] {
  const out: string[] = [];
  for (const m of reply.matchAll(EQUATION)) {
    const v = evaluate(m[1]!);
    const c = Number(m[2]!.replace(/[$,\s]/g, ""));
    if (v === null || !Number.isFinite(v)) continue;
    if (!(Math.abs(v - c) <= Math.max(1, Math.abs(c) * 0.01))) out.push(m[0].trim());
  }
  return [...new Set(out)];
}
