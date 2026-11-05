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
      [200, "Transfers"],
    ]);
  });
  it("explains a missing header", () => {
    expect(() => importCsv("foo,bar\n1,2")).toThrow(/header/);
  });
});

import { flipSigns, looksLikeCardStatement } from "@/lib/planner/csv";

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
    const rows = flipSigns(importCsv(amex).rows);
    expect(rows.find((x) => x.description.includes("TAQUERIA"))!.amount).toBe(-17.36);
    expect(rows.find((x) => x.description.includes("MOBILE PAYMENT"))!.amount).toBe(510.7);
  });
  it("a normal bank account export is not mistaken for a card", () => {
    expect(importCsv("Date,Description,Amount\n2026-10-03,STARBUCKS,-5.25\n2026-10-04,PAYROLL ACME,1500.00\n2026-10-05,LOBLAWS,-80\n").looksLikeCard).toBe(false);
    expect(looksLikeCardStatement([], false)).toBe(false);
  });
});
