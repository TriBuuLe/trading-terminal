import { describe, expect, it } from "vitest";
import { checkAlert, type AlertDef } from "@/lib/alerts";
import type { Quote } from "@/lib/types";

const q = (p: number, chg: number | null = null): Quote => ({
  symbol: "AAPL", price: p, prevClose: null, change: null, changePct: chg, open: null, high: null, low: null, volume: null, bid: null, ask: null, tradeTime: null, tradeSession: null,
});
const A = (kind: AlertDef["kind"], threshold: number, active = true): AlertDef => ({
  id: 1, symbol: "AAPL", kind, threshold, note: null, active, repeat: false, lastFiredAt: null, createdAt: "",
});

describe("checkAlert", () => {
  it("above / below trigger at the threshold, inclusive", () => {
    expect(checkAlert(A("above", 200), q(199.99))).toBeNull();
    expect(checkAlert(A("above", 200), q(200))).toContain("above");
    expect(checkAlert(A("below", 150), q(150.01))).toBeNull();
    expect(checkAlert(A("below", 150), q(149))).toContain("below");
  });
  it("% move triggers on absolute daily change", () => {
    expect(checkAlert(A("pct_move", 5), q(1, 4.9))).toBeNull();
    expect(checkAlert(A("pct_move", 5), q(1, -5.2))).toContain("−5.20%");
  });
  it("ignores inactive alerts, missing prices, and earnings alerts", () => {
    expect(checkAlert(A("above", 1, false), q(10))).toBeNull();
    expect(checkAlert(A("above", 1), undefined)).toBeNull();
    expect(checkAlert(A("earnings", 7), q(10))).toBeNull();
  });
});
