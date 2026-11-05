/**
 * Before financial context goes to a cloud model: people's names become
 * "Person A", "Person B"…, and account / card / reference numbers and emails are
 * removed. Amounts, dates, categories and merchant / employer names stay (the
 * analysis needs them). The mapping stays on the server to restore names in the reply.
 */
export interface Redactor {
  redact: (s: string) => string;
  restore: (s: string) => string;
  people: Map<string, string>; // real name → alias
}

const PERSON = /\bzelle (?:payment )?(?:to|from) ([a-z][a-z .'-]*?)(?= for |;| conf| on |$|\s*\||")/gi;
const label = (k: number) => `Person ${String.fromCharCode(65 + (k % 26))}${k >= 26 ? Math.floor(k / 26) : ""}`;

export function createRedactor(names: string[] = []): Redactor {
  const people = new Map<string, string>();
  const add = (raw: string) => {
    const n = raw.trim().replace(/\s+/g, " ");
    if (n.length < 2) return;
    const key = n.toLowerCase();
    if (![...people.keys()].some((k) => k.toLowerCase() === key)) people.set(n, label(people.size));
  };
  for (const n of names) add(n);
  const redact = (s: string) => {
    for (const m of s.matchAll(PERSON)) add(m[1]!);
    let out = s;
    // longest names first so "Hau Le" is replaced before "Le"
    for (const [name, alias] of [...people.entries()].sort((a, b) => b[0].length - a[0].length)) {
      out = out.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), alias);
    }
    return out
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
      .replace(/\b(?:\d[ -]?){8,}\d\b/g, "[number]") // account / card / reference numbers
      .replace(/\b(?:ID|INDN|CO ID|Conf#?|Confirmation#?)[:#]?\s*[A-Z0-9]{4,}\b/gi, "")
      .replace(/\s{2,}/g, " ");
  };
  const restore = (s: string) => {
    let out = s;
    for (const [name, alias] of [...people.entries()].sort((a, b) => b[1].length - a[1].length)) out = out.replaceAll(alias, name);
    return out;
  };
  return { redact, restore, people };
}
