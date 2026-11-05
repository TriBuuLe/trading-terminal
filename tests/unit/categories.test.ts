import { describe, expect, it } from "vitest";
import { SPENDING_CATEGORY_NAMES, TRANSACTION_CATEGORIES } from "@/lib/planner/categories";
import { CATEGORY_RULES, suggestCategory } from "@/lib/planner/csv";
import { matchPlanCategory } from "@/lib/planner/spending";

describe("one shared category list", () => {
  it("every category the importer can suggest is in the list", () => {
    for (const [c] of CATEGORY_RULES) expect(TRANSACTION_CATEGORIES, c).toContain(c);
    expect(TRANSACTION_CATEGORIES).toContain(suggestCategory("XYZ LLC").category);
  });

  it("every budget category matches its own transactions exactly", () => {
    for (const c of SPENDING_CATEGORY_NAMES) expect(matchPlanCategory(c, SPENDING_CATEGORY_NAMES)).toBe(c);
  });

  it("an old free-text name finds its standard category", () => {
    expect(SPENDING_CATEGORY_NAMES.find((c) => matchPlanCategory(c, ["Fun"]) === "Fun")).toBe("Entertainment");
    expect(SPENDING_CATEGORY_NAMES.find((c) => matchPlanCategory(c, ["Vacation"]) === "Vacation")).toBe("Travel");
  });
});
