/**
 * The ONE list of spending categories, shared by budget lines (My finances) and
 * transactions, so every budget line matches its transactions exactly.
 */
export const SPENDING_CATEGORIES = [
  { name: "Rent", kind: "need" },
  { name: "Groceries", kind: "need" },
  { name: "Utilities", kind: "need" },
  { name: "Phone & internet", kind: "need" },
  { name: "Insurance", kind: "need" },
  { name: "Transportation", kind: "need" },
  { name: "Health", kind: "need" },
  { name: "Education", kind: "need" },
  { name: "Fees & interest", kind: "need" },
  { name: "Dining out", kind: "want" },
  { name: "Subscriptions", kind: "want" },
  { name: "Entertainment", kind: "want" },
  { name: "Shopping", kind: "want" },
  { name: "Travel", kind: "want" },
  { name: "Other", kind: "want" },
] as const satisfies readonly { name: string; kind: "need" | "want" }[];

export type SpendingCategory = (typeof SPENDING_CATEGORIES)[number]["name"];

export const SPENDING_CATEGORY_NAMES: string[] = SPENDING_CATEGORIES.map((c) => c.name);

/** Transactions can also be money in, moves between your own accounts, or not yet sorted. */
export const TRANSACTION_CATEGORIES: string[] = [...SPENDING_CATEGORY_NAMES, "Income", "Transfers", "Uncategorized"];

export const defaultKind = (name: string): "need" | "want" => SPENDING_CATEGORIES.find((c) => c.name === name)?.kind ?? "want";
