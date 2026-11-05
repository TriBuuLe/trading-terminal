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
