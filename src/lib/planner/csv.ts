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
export const CARD_PAYMENT = /payment.{0,20}thank ?you|mobile payment|online payment|autopay|auto pay|payment received|credit card payment|card payment|american express.{0,12}pmt|\bach pmt\b|payment to crd/i;

export const CATEGORY_RULES: [string, RegExp][] = [
  ["Transfers", CARD_PAYMENT],
  ["Income", /payroll|direct dep|salary|pay ?cheque|paycheck|deposit from/i],
  // "INTERNATIONAL TRANSACTION FEE … UBER CANADA" is a fee, not a ride
  ["Fees & interest", /international transaction fee|foreign transaction fee|foreign exchange fee|\bfx fee|wire fee/i],
  ["Insurance", /insurance|assurance|\bins\b|progressive|geico|state farm|allstate|lemonade/i],
  // Before rent/dining/transportation ("rent-a-car" is travel): flights, hotels, car rentals and trip bookings are travel, not commuting.
  [
    "Travel",
    /expedia|booking\.com|airbnb|\bvrbo\b|hotels\.com|priceline|kayak|trip\.com|\bhopper\b|\bhotel|marriott|hilton|hyatt|\bihg\b|holiday inn|best western|sheraton|westin|hostel|air canada|westjet|porter air|flair air|delta air|united air|united\.com|american air|\baa\.com|southwest air|southwest\.com|jetblue|spirit air|frontier air|alaska air|air france|british airways|lufthansa|klm\b|emirates|airlines?\b|amtrak|via rail|greyhound|flixbus|megabus|hertz|avis\b|enterprise rent|budget rent|national car|turo\b/i,
  ],
  ["Rent", /\brent\b|property mgmt|landlord|\bapts?\b|apartment/i],
  ["Groceries", /grocer|loblaw|no frills|sobeys|metro\b|safeway|kroger|costco|walmart|wal-mart|sprouts|lien hoa|saigon market|asian market|oriental market|h mart|\blotte\b|whole foods|trader joe|freshco|food basics|aldi|harris teeter|food lion|publix/i],
  [
    "Dining out",
    /restauran|hot ?pot|gyro|teriyaki|buffet|tst\*|ramen|cafe|cafeteria|bldg\d*caf|coffee|starbucks|tim hortons|second cup|dunkin|mcdonald|uber ?\*?eats|noodle|soba\b|mazesoba|\btst-|tahini|doordash|grubhub|skip ?the|pizza|sushi|burger|chipotle|subway|taqueria|taco|\bpho\b|pho\b|ramen|thai|grill|kitchen|bistro|\bdeli\b|bakery|boba|bubble tea|wings|chick-fil-a|wendy|panera/i,
  ],
  ["Subscriptions", /uber \*?one|netflix|apple com bill|linkedin|fansly|onlyfans|spotify|disney|apple\.com|icloud|prime video|youtube premium|crave|hulu|patreon|anthropic|claude\.ai|openai|chatgpt|github|notion|adobe|microsoft 365|google one|google storage/i],
  ["Transportation", /\buber\b|lyft|presto|transit|ttc|go transit|shell|esso|petro|chevron|chevr|texaco|marathon|speedway|circle ?k|citgo|quiktrip|sheetz|exxon|parking|gas station|\bbp\b|sunoco|wawa/i],
  ["Phone & internet", /rogers|bell\b|telus|fido|koodo|freedom mobile|verizon|at&t|\batt\b|t-mobile|comcast|xfinity|spectrum/i],
  ["Utilities", /hydro|electric|enbridge|water|utility|duke energy/i],
  ["Entertainment", /strikers|cinema|regal|\bamc\b|cineplex|theatre|theater|steam|playstation|xbox|nintendo|ticketmaster|eventbrite|bowling/i],
  ["Shopping", /amazon|best buy|ikea|winners|h&m|uniqlo|shopify|etsy|target\b|nike|dick'?s sporting|ups store|it'?sugar|adidas|zara|lululemon|sephora|e-commerce|ulta|tommy hilfiger|ralph lauren|calvin klein|old navy|\bgap\b|nordstrom|macy|tj ?maxx|marshalls|ross stores|kohl|foot locker|urban outfitters|american eagle|abercrombie|hollister/i],
  ["Health", /campus rec|barber|fitness|\bgym\b|ymca|pharma|shoppers drug|rexall|cvs|walgreens|clinic|dental|physio/i],
  ["Education", /tuition|university|college|bookstore|coursera/i],
  ["Insurance", /insurance|assurance/i],
  ["Fees & interest", /interest charge|service fee|\bnsf\b|overdraft|annual fee/i],
];

/** Money sent to people or other accounts (Zelle, Remitly, brokerage...). Out = spending (Other), in = income. */
export const PEER_PAYMENT = /e-?transfer|interac|zelle|venmo|paypal|cash ?app|remitly|rmtly|western union|\bwise\b|transfer/i;

/** Moving money to/from your own investment account: saving, not spending or earning. */
export const BROKERAGE = /fid bkg|fidelity|moneyline|schwab|vanguard|robinhood|wealthsimple|questrade|e\*?trade|webull/i;

/**
 * Sign decides first: money OUT (−) is spending, money IN (+) is income. The one
 * exception is paying your credit card: the card's own statement already has the
 * purchases, so the payment is a transfer (counting both would double spending).
 * A positive amount at a store is a refund and goes back to that store's category.
 */
/** Your own rules, saved with your profile: they win over the built-in ones. */
export interface MyRules {
  /** "anh trieu" → Rent: money OUT whose description (or merchant name) contains `match`. */
  rules?: { match: string; category: string }[];
  /** Category for money you send people (Zelle, Venmo...) when the memo doesn't say what it was. Default Other. */
  peerOutCategory?: string;
}

export function ruleMatches(match: string, description: string): boolean {
  const m = match.trim().toLowerCase();
  return m.length > 0 && (description.toLowerCase().includes(m) || merchantName(description).toLowerCase() === m);
}

export function suggestCategory(description: string, amount?: number, mine: MyRules = {}): { category: string; confidence: "rule" | "none" } {
  if (CARD_PAYMENT.test(description)) return { category: "Transfers", confidence: "rule" };
  if (amount === undefined || amount < 0) {
    const r = mine.rules?.find((x) => ruleMatches(x.match, description));
    if (r) return { category: r.category, confidence: "rule" };
  }
  // Cash: an ATM deposit is money in; a withdrawal is spending you can't see the details of.
  if (amount !== undefined && /\batm\b/i.test(description)) return { category: amount > 0 ? "Income" : "Other", confidence: "rule" };
  if (BROKERAGE.test(description)) return { category: "Transfers", confidence: "rule" };
  // People next: a name in "Zelle to Sam Grill" isn't a restaurant. But the memo after "for" says what it was:
  // "Zelle payment to Akshit for July Rent" is rent.
  if (amount !== undefined && PEER_PAYMENT.test(description)) {
    if (amount > 0) return { category: "Income", confidence: "rule" };
    const memo = / for (.+)$/i.exec(description)?.[1] ?? "";
    const fromMemo = memo ? CATEGORY_RULES.find(([cat, re]) => cat !== "Income" && cat !== "Transfers" && re.test(memo))?.[0] : undefined;
    // Your "money sent to people" choice is for person-to-person apps; remittance services (Remitly...) stay Other.
    const remittance = /remitly|rmtly|western union|\bwise\b/i.test(description);
    return { category: fromMemo ?? (remittance ? "Other" : (mine.peerOutCategory ?? "Other")), confidence: "rule" };
  }
  const spending = CATEGORY_RULES.find(([cat, re]) => cat !== "Income" && cat !== "Transfers" && re.test(description))?.[0];
  if (amount !== undefined && amount > 0) return { category: spending ?? "Income", confidence: "rule" };
  if (amount === undefined && /payroll|direct dep|salary|pay ?cheque|paycheck|deposit from/i.test(description)) return { category: "Income", confidence: "rule" };
  if (spending) return { category: spending, confidence: "rule" };
  if (PEER_PAYMENT.test(description)) return { category: "Other", confidence: "rule" };
  return { category: "Uncategorized", confidence: "none" };
}

/**
 * Flip signs on a preview (credit-card statements) and re-suggest categories that
 * were automatic, since the sign changes what a row is. Categories you picked stay.
 */
export function flipPreview(rows: ParsedTx[], mine: MyRules = {}): ParsedTx[] {
  return rows.map((r) => {
    const amount = -r.amount;
    return r.category === suggestCategory(r.description, r.amount, mine).category ? { ...r, amount, ...suggestCategory(r.description, amount, mine) } : { ...r, amount };
  });
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

export function importCsv(text: string, mine: MyRules = {}): { rows: ParsedTx[]; skipped: number; columns: Record<string, number>; looksLikeCard: boolean } {
  const grid = parseCsv(text);
  if (grid.length < 2) return { rows: [], skipped: 0, columns: {}, looksLikeCard: false };
  // Some banks (e.g. Bank of America) put a summary block above the real header: use the first row that has the columns.
  const columnsOf = (row: string[]) => {
    const header = row.map((h) => h.trim().toLowerCase());
    const find = (...names: RegExp[]) => header.findIndex((h) => names.some((n) => n.test(h)));
    return {
      date: find(/date/),
      description: find(/desc|merchant|payee|details|name|memo/),
      amount: find(/^amount$|amount \(|^value$|^cad\$?$|^usd\$?$/),
      debit: find(/debit|withdraw|money out|outflow/),
      credit: find(/credit|deposit|money in|inflow/),
    };
  };
  const ok = (c: ReturnType<typeof columnsOf>) => c.date >= 0 && c.description >= 0 && (c.amount >= 0 || c.debit >= 0 || c.credit >= 0);
  const headerAt = grid.slice(0, 30).findIndex((r) => ok(columnsOf(r)));
  if (headerAt < 0) throw new Error("Couldn't find a header row with date, description and amount columns (e.g. Date, Description, Amount).");
  const cols = columnsOf(grid[headerAt]!);
  const rows: ParsedTx[] = [];
  let skipped = 0;
  for (const r of grid.slice(headerAt + 1)) {
    if (/^(beginning|ending|opening|closing) balance/i.test((r[cols.description] ?? "").trim())) continue; // balance lines, not transactions
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
    rows.push({ date, description: desc, amount: Math.round(amount * 100) / 100, ...suggestCategory(desc, amount, mine) });
  }
  return { rows, skipped, columns: cols, looksLikeCard: looksLikeCardStatement(rows, cols.debit >= 0 || cols.credit >= 0) };
}

const GENERIC = new Set(["the", "st", "sq", "tst", "aplpay", "pos", "debit", "purchase", "online", "www"]);
const titleCase = (w: string) => w.toLowerCase().replace(/(^|[\s\-./])\w/g, (c) => c.toUpperCase());

/** A readable merchant name to group by: "AplPay PUBLIX BOCA RATON FL" → "Publix", "Zelle payment to Akshit Kurani for July Rent" → "Zelle to Akshit Kurani". */
export function merchantName(description: string): string {
  const d = description.trim();
  const zelle = /zelle payment (to|from) ([a-z][a-z .'-]*?)(?: for |;| conf|$)/i.exec(d);
  if (zelle) return `Zelle ${zelle[1]!.toLowerCase()} ${titleCase(zelle[2]!.trim())}`;
  if (/rmtly|remitly/i.test(d)) return "Remitly";
  if (/apple\.?com|apple com bill/i.test(d)) return "Apple";
  if (/\buber\b.*eats|uber \*?eats/i.test(d)) return "Uber Eats";
  if (/\buber\b/i.test(d)) return "Uber";
  if (/wire (type|out)|wire out/i.test(d)) return "Wire transfer";
  if (/international transaction fee|foreign transaction fee/i.test(d)) return "Foreign transaction fees";
  const head = d
    .replace(/^((aplpay|sq ?\*|tst ?[*-]|pp\*|paypal ?\*)\s*)+/i, "")
    .split(/ DES:| ID:| PURCHASE|#| \d{2}\/\d{2}|\*|,/i)[0]!
    // "IBMBLDG500CAFDURHAM NC": keep the letters before the digits of the first word ("IBMBLDG")
    .replace(/^([a-z]{3,})\d\S*/i, "$1")
    .replace(/\S*\d\S*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = head.split(" ").filter((w) => w && !GENERIC.has(w.toLowerCase().replace(/[^a-z]/g, "")));
  if (!words.length) return titleCase(d.slice(0, 24));
  // One distinctive word is usually the brand (PUBLIX, TARGET, AMAZON); short first words need the second (BEST BUY, LA FITNESS).
  const name = words[0]!.replace(/[^a-z]/gi, "").length >= 6 ? words[0]! : words.slice(0, 2).join(" ");
  return titleCase(name.replace(/[,;:]+$/, ""));
}
