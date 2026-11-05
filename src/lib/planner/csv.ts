/** Bank/credit-card CSV import: parse, normalize, strip identifiers, suggest categories. */

export interface ParsedTx {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // negative = money out
  category: string;
  confidence: "rule" | "none";
}

/** RFC-4180-ish CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

/** Remove card/account/reference numbers and collapse whitespace. */
export function cleanDescription(s: string): string {
  return s
    .replace(/\b(?:\d[ -]?){8,}\b/g, "") // long digit runs (card/account numbers)
    .replace(/[#*x]{2,}\d{2,}/gi, "") // masked numbers like ****1234 / xx1234
    .replace(/\b(ref|auth|trace|conf)[:#]?\s*[a-z0-9]{4,}\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(t); // assume MM/DD/YYYY (North American banks)
  if (m) return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const num = (s: string | undefined) => {
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s.trim()) || s.trim().startsWith("-");
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && s.replace(/[^0-9]/g, "") !== "" ? (neg ? -n : n) : null;
};

/** Keyword rules → category. The user confirms or corrects every suggestion. */
/** Paying off a credit card from your bank: a transfer between your own accounts, not income or spending. */
export const CARD_PAYMENT = /payment.{0,20}thank ?you|mobile payment|online payment|autopay|auto pay|payment received|credit card payment|card payment/i;

export const CATEGORY_RULES: [string, RegExp][] = [
  ["Transfers", CARD_PAYMENT],
  ["Income", /payroll|direct dep|salary|pay ?cheque|paycheck|deposit from/i],
  ["Transfers", /e-?transfer|interac|transfer|zelle|venmo|paypal transfer/i],
  ["Rent", /\brent\b|property mgmt|landlord/i],
  ["Groceries", /grocer|loblaw|no frills|sobeys|metro\b|safeway|kroger|costco|walmart|whole foods|trader joe|freshco|food basics|aldi|harris teeter|food lion|publix/i],
  [
    "Dining out",
    /restaurant|cafe|cafeteria|bldg\d*caf|coffee|starbucks|tim hortons|second cup|dunkin|mcdonald|uber ?eats|doordash|grubhub|skip ?the|pizza|sushi|burger|chipotle|subway|taqueria|taco|\bpho\b|pho\b|ramen|thai|grill|kitchen|bistro|\bdeli\b|bakery|boba|bubble tea|wings|chick-fil-a|wendy|panera/i,
  ],
  ["Transportation", /\buber\b|lyft|presto|transit|ttc|go transit|shell|esso|petro|chevron|exxon|parking|gas station|\bbp\b|sunoco|wawa/i],
  ["Phone & internet", /rogers|bell\b|telus|fido|koodo|freedom mobile|verizon|at&t|t-mobile|comcast|xfinity|spectrum/i],
  ["Utilities", /hydro|electric|enbridge|water|utility|duke energy/i],
  ["Subscriptions", /netflix|spotify|disney|apple\.com|icloud|prime video|youtube premium|crave|hulu|patreon|anthropic|claude\.ai|openai|chatgpt|github|notion|adobe|microsoft 365|google one|google storage/i],
  ["Entertainment", /cinema|regal|\bamc\b|cineplex|theatre|theater|steam|playstation|xbox|nintendo|ticketmaster|eventbrite|bowling/i],
  ["Shopping", /amazon|best buy|ikea|winners|h&m|uniqlo|shopify|etsy|target\b|nike|adidas|zara|lululemon|sephora|e-commerce|ulta/i],
  ["Health", /pharma|shoppers drug|rexall|cvs|walgreens|clinic|dental|physio/i],
  ["Education", /tuition|university|college|bookstore|coursera/i],
  ["Insurance", /insurance|assurance/i],
  ["Fees & interest", /interest charge|service fee|nsf|overdraft|annual fee/i],
];

export function suggestCategory(description: string): { category: string; confidence: "rule" | "none" } {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(description)) return { category: cat, confidence: "rule" };
  return { category: "Uncategorized", confidence: "none" };
}

/**
 * Map a bank CSV to transactions. Finds date/description/amount columns by header
 * name; supports a single signed amount column or separate debit/credit columns.
 */
/**
 * Credit-card exports usually list purchases as POSITIVE and your payments as
 * negative (the opposite of a bank account). Detect that: no debit/credit columns,
 * most amounts positive, and a negative card-payment line or no negatives at all.
 */
export function looksLikeCardStatement(rows: ParsedTx[], hasDebitCreditColumns: boolean): boolean {
  if (hasDebitCreditColumns || rows.length === 0) return false;
  const spendRows = rows.filter((r) => !CARD_PAYMENT.test(r.description) && r.category !== "Income" && r.category !== "Transfers");
  const positive = spendRows.filter((r) => r.amount > 0).length;
  const paymentsNegative = rows.some((r) => CARD_PAYMENT.test(r.description) && r.amount < 0);
  return spendRows.length > 0 && positive / spendRows.length >= 0.7 && (paymentsNegative || rows.every((r) => r.amount >= 0));
}

/** Flip signs so money out is negative (use for credit-card statements). */
export const flipSigns = <T extends { amount: number }>(rows: T[]): T[] => rows.map((r) => ({ ...r, amount: -r.amount }));

export function importCsv(text: string): { rows: ParsedTx[]; skipped: number; columns: Record<string, number>; looksLikeCard: boolean } {
  const grid = parseCsv(text);
  if (grid.length < 2) return { rows: [], skipped: 0, columns: {}, looksLikeCard: false };
  const header = grid[0]!.map((h) => h.trim().toLowerCase());
  const find = (...names: RegExp[]) => header.findIndex((h) => names.some((n) => n.test(h)));
  const cols = {
    date: find(/date/),
    description: find(/desc|merchant|payee|details|name|memo/),
    amount: find(/^amount$|amount \(|^value$|^cad\$?$|^usd\$?$/),
    debit: find(/debit|withdraw|money out|outflow/),
    credit: find(/credit|deposit|money in|inflow/),
  };
  if (cols.date < 0 || cols.description < 0 || (cols.amount < 0 && cols.debit < 0 && cols.credit < 0)) {
    throw new Error("Couldn't find date, description and amount columns. The first row must be a header (e.g. Date, Description, Amount).");
  }
  const rows: ParsedTx[] = [];
  let skipped = 0;
  for (const r of grid.slice(1)) {
    const date = parseDate(r[cols.date] ?? "");
    const desc = cleanDescription(r[cols.description] ?? "");
    let amount: number | null = null;
    if (cols.amount >= 0) amount = num(r[cols.amount]);
    else {
      const d = num(r[cols.debit]);
      const c = num(r[cols.credit]);
      amount = d ? -Math.abs(d) : c ? Math.abs(c) : null;
    }
    if (!date || !desc || amount === null) {
      skipped++;
      continue;
    }
    rows.push({ date, description: desc, amount: Math.round(amount * 100) / 100, ...suggestCategory(desc) });
  }
  return { rows, skipped, columns: cols, looksLikeCard: looksLikeCardStatement(rows, cols.debit >= 0 || cols.credit >= 0) };
}
