import { describe, expect, it } from "vitest";
import { cleanDescription, importCsv, parseCsv, suggestCategory } from "@/lib/planner/csv";

describe("CSV import", () => {
  it("parses quoted fields, escaped quotes and CRLF", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });
  it("strips card/account/reference numbers", () => {
    expect(cleanDescription("POS PURCHASE 4519 0312 3456 7890 STARBUCKS #1234 REF: AB12CD34")).toBe("POS PURCHASE STARBUCKS #1234");
    expect(cleanDescription("PAYMENT ****9876 THANK YOU")).toBe("PAYMENT THANK YOU");
  });
  it("suggests categories from merchant keywords", () => {
    expect(suggestCategory("LOBLAWS #1023 TORONTO").category).toBe("Groceries");
    expect(suggestCategory("NETFLIX.COM").category).toBe("Subscriptions");
    expect(suggestCategory("XYZ LLC").confidence).toBe("none");
    for (const d of ["EXPEDIA 72384923", "AIR CANADA 0142", "MARRIOTT CHARLOTTE", "AIRBNB * HM4X", "DELTA AIR LINES ATLANTA", "HERTZ RENT-A-CAR"]) expect(suggestCategory(d).category, d).toBe("Travel");
    // words hiding inside other words aren't travel
    expect(suggestCategory("AplPay SHOPPERS DRUGHAMILTON").category).toBe("Health");
    expect(suggestCategory("TEXACO 0386519/CHEVRBOCA RATON FL").category).toBe("Transportation");
    // still commuting / car, not travel
    expect(suggestCategory("UBER TRIP").category).toBe("Transportation");
    expect(suggestCategory("SHELL OIL 5741").category).toBe("Transportation");
  });
  it("maps signed-amount and debit/credit layouts", () => {
    const a = importCsv("Date,Description,Amount\n2026-10-03,STARBUCKS,-5.25\n10/04/2026,PAYROLL ACME,1500.00\nbad,row,\n");
    expect(a.rows).toEqual([
      { date: "2026-10-03", description: "STARBUCKS", amount: -5.25, category: "Dining out", confidence: "rule" },
      { date: "2026-10-04", description: "PAYROLL ACME", amount: 1500, category: "Income", confidence: "rule" },
    ]);
    expect(a.skipped).toBe(1);
    const b = importCsv('Transaction Date,Merchant,Debit,Credit\n2026-10-05,"SHELL OIL",45.10,\n2026-10-06,E-TRANSFER FROM MOM,,200\n');
    expect(b.rows.map((r) => [r.amount, r.category])).toEqual([
      [-45.1, "Transportation"],
      [200, "Income"], // money in
    ]);
  });
  it("explains a missing header", () => {
    expect(() => importCsv("foo,bar\n1,2")).toThrow(/header/);
  });
});

import { flipPreview, looksLikeCardStatement, suggestCategory as sc } from "@/lib/planner/csv";

describe("credit-card statements", () => {
  // Shaped like an Amex export: purchases positive, the payment negative.
  const amex =
    "Date,Description,Amount\n" +
    "11/03/2026,AplPay IBMBLDG500CAFDURHAM NC,2.42\n" +
    "11/01/2026,AplPay TAQUERIA HWY Durham NC,17.36\n" +
    "10/30/2026,NIKE INC E-COMMERCE,91.38\n" +
    "10/23/2026,AplPay REGAL CINEMASKNOXVILLE TN,23.04\n" +
    "10/16/2026,MOBILE PAYMENT - THANK YOU,-510.70\n" +
    "10/13/2026,ANTHROPIC* CLAUDE SUSAN FRANCISCO CA,20.00\n" +
    "10/13/2026,AplPay SECOND CUP 21TORONTO,3.97\n" +
    "10/12/2026,AplPay PRESTO MOBI/STORONTO,3.51\n";
  it("detects the card layout and categorizes these merchants", () => {
    const r = importCsv(amex);
    expect(r.looksLikeCard).toBe(true);
    expect(Object.fromEntries(r.rows.map((x) => [x.description.split(" ").slice(0, 2).join(" "), x.category]))).toEqual({
      "AplPay IBMBLDG500CAFDURHAM": "Dining out",
      "AplPay TAQUERIA": "Dining out",
      "NIKE INC": "Shopping",
      "AplPay REGAL": "Entertainment",
      "MOBILE PAYMENT": "Transfers",
      "ANTHROPIC* CLAUDE": "Subscriptions",
      "AplPay SECOND": "Dining out",
      "AplPay PRESTO": "Transportation",
    });
  });
  it("flipping makes purchases money OUT and the payment a (positive) transfer in", () => {
    const rows = flipPreview(importCsv(amex).rows);
    expect(rows.find((x) => x.description.includes("TAQUERIA"))!.category).toBe("Dining out");
    expect(rows.find((x) => x.description.includes("MOBILE PAYMENT"))!.category).toBe("Transfers");
    expect(rows.find((x) => x.description.includes("TAQUERIA"))!.amount).toBe(-17.36);
    expect(rows.find((x) => x.description.includes("MOBILE PAYMENT"))!.amount).toBe(510.7);
  });
  it("a normal bank account export is not mistaken for a card", () => {
    expect(importCsv("Date,Description,Amount\n2026-10-03,STARBUCKS,-5.25\n2026-10-04,PAYROLL ACME,1500.00\n2026-10-05,LOBLAWS,-80\n").looksLikeCard).toBe(false);
    expect(looksLikeCardStatement([], false)).toBe(false);
  });
});

describe("Bank of America checking export (summary block above the header)", () => {
  const csv = [
    "Description,,Summary Amt.",
    'Beginning balance as of 09/25/2026,,"901.62"',
    'Total credits,,"7,172.34"',
    'Total debits,,"-4,304.36"',
    'Ending balance as of 10/26/2026,,"3,769.60"',
    "",
    "Date,Description,Amount,Running Bal.",
    '09/25/2026,Beginning balance as of 09/25/2026,,"901.62"',
    '09/25/2026,"ACME 3141 DES:PAYROLL ID:1000200669 INDN:Sam Doe CO ID:2130871985 PPD PMT INFO:TRN*1*1000200669\\","1,325.48","2,227.10"',
    '09/28/2026,"Zelle payment to Alex Kim for "Trip"; Conf# utu3vhdzp","-41.85","2,185.25"',
    '10/01/2026,"APTS Le DES:APTS Le ID:ST-V9E1T9U6E7M6 INDN:SAM DOE CO ID:1800948598 WEB","-880.00","1,305.25"',
    '10/01/2026,"AMERICAN EXPRESS DES:ACH PMT ID:M0006 INDN:SAM DOE CO ID:1133133497 WEB","-310.67","994.58"',
    '10/02/2026,"LA FITNESS 10/02 PURCHASE IRVINE CA","-42.99","2,181.36"',
    '10/07/2026,"FID BKG SVC LLC DES:MONEYLINE ID:Z53603640 QIQRM INDN:SAM DOE CO ID:1035141375 WEB","508.99","2,105.66"',
    '10/13/2026,"Mobile Banking payment to CRD 5590 Confirmation# zpkbwmbih","-16.28","3,414.85"',
    '10/14/2026,"UBER CANADA/UBERE 10/12 PURCHASE TORONTO ON","-16.76","2,196.10"',
    '10/14/2026,"MEGUMI MAZESOBA 10/13 PURCHASE TORONTO ON","-18.87","2,172.55"',
    '10/14/2026,"INTERNATIONAL TRANSACTION FEE 10/13 UBER CANADA/UBERE TORONTO ON","-0.50","2,170.52"',
    '10/16/2026,"TST-Tahinis - 190 10/15 MOBILE PURCHASE Hamilton ON","-7.98","3,422.55"',
    '10/21/2026,"ATT DES:PAYMENT ID:356010002EPAYQ INDN:SAM DOE CO ID:9864031004 PPD","-57.03","2,780.62"',
    '10/26/2026,"UBER *ONE MEMBE 10/23 PURCHASE 8665761039 CA","-9.99","3,807.37"',
    '10/26/2026,"UBER *EATS HELP.U 10/25 PURCHASE 8005928996 CA","-26.77","3,769.60"',
  ].join("\n");
  const r = importCsv(csv);

  it("finds the header below the summary and skips balance lines", () => {
    expect(r.rows).toHaveLength(14);
    expect(r.skipped).toBe(0);
    expect(r.looksLikeCard).toBe(false);
    expect(r.rows[0]).toMatchObject({ date: "2026-09-25", amount: 1325.48, category: "Income" });
  });

  it("sorts checking-account rows (card payments and brokerage moves are transfers)", () => {
    expect(r.rows.map((x) => x.category)).toEqual([
      "Income",
      "Other", // Zelle out: money out is spending
      "Rent", // APTS
      "Transfers", // Amex ACH payment: the card's own statement has the purchases
      "Health", // LA Fitness
      "Income", // Fidelity MoneyLine in: money in
      "Transfers", // payment to card 5590
      "Transportation",
      "Dining out",
      "Fees & interest",
      "Dining out", // Toast POS
      "Phone & internet",
      "Subscriptions", // Uber One
      "Dining out", // Uber Eats
    ]);
  });
});

describe("sign decides: money out = spending, money in = income", () => {
  it("peer payments", () => {
    expect(sc("Zelle payment to Alex Kim", -41.85).category).toBe("Other");
    expect(sc("Zelle payment from Alex Kim", 20).category).toBe("Income");
    expect(sc("RMTLY* B2044 PMNT SENT SEATTLE WA", -201.99).category).toBe("Other");
  });
  it("a positive amount at a store is a refund in that category; unknown money in is income", () => {
    expect(sc("AMAZON.COM RETURN", 25).category).toBe("Shopping");
    expect(sc("SOME DEPOSIT XYZ", 300).category).toBe("Income");
  });
  it("card payments stay transfers either way", () => {
    expect(sc("AMERICAN EXPRESS DES:ACH PMT ID:M0006", -310.67).category).toBe("Transfers");
    expect(sc("MOBILE PAYMENT - THANK YOU", 510.7).category).toBe("Transfers");
  });
  it("an unknown card purchase listed as positive becomes Uncategorized spending after flipping, not income", () => {
    const [r] = flipPreview([{ date: "2026-10-01", description: "XYZ LLC", amount: 12, ...sc("XYZ LLC", 12) }]);
    expect(r).toMatchObject({ amount: -12, category: "Uncategorized" });
  });
});
