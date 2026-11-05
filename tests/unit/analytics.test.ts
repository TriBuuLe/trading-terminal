import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  arrivalPrice,
  closedTrades,
  dailyReturns,
  fifo,
  maxDrawdown,
  realistic,
  sharpe,
  slippageBps,
  tradeStats,
  unrealized,
  verdict,
  type Fill,
} from "@/lib/analytics";

/*
 * Hand-computed example
 *  o1  buy  10 AAPL @ 100
 *  o2  buy   5 AAPL @ 110
 *  o3  sell 12 AAPL @ 120   → closes 10@100 (+200) and 2@110 (+20)   = +220; 3@110 left
 *  o4  sell_short 4 MSFT @ 50 → opens short −4@50
 *  o5  buy   4 MSFT @ 45    → covers short: (50−45)·4               = +20
 *  o6  sell  5 AAPL @ 105   → closes 3@110: (105−110)·3 = −15, then flips to short −2@105
 *  Realized: AAPL 205, MSFT 20, total 225.  Open: AAPL −2 @105.
 *  Unrealized @ AAPL=100: (105−100)·2 = +10.
 */
const F = (id: string, side: string, symbol: string, qty: string, price: string, minute: number): Fill => ({
  id,
  orderId: `o${id}`,
  symbol,
  side,
  qty,
  price,
  time: `2026-01-05T15:${String(minute).padStart(2, "0")}:00Z`,
});
const fills: Fill[] = [
  F("1", "buy", "AAPL", "10", "100", 1),
  F("2", "buy", "AAPL", "5", "110", 2),
  F("3", "sell", "AAPL", "12", "120", 3),
  F("4", "sell_short", "MSFT", "4", "50", 4),
  F("5", "buy", "MSFT", "4", "45", 5),
  F("6", "sell", "AAPL", "5", "105", 6),
];

describe("FIFO realized P&L", () => {
  const r = fifo(fills);

  it("matches the hand-computed realized totals", () => {
    expect(r.realizedBySymbol.AAPL!.toString()).toBe("205");
    expect(r.realizedBySymbol.MSFT!.toString()).toBe("20");
    expect(r.realizedTotal.toString()).toBe("225");
  });

  it("closes oldest lots first and handles the long→short flip", () => {
    expect(r.matches.map((m) => [m.symbol, m.qty.toString(), m.openPrice.toString(), m.closePrice.toString(), m.pnl.toString()])).toEqual([
      ["AAPL", "10", "100", "120", "200"],
      ["AAPL", "2", "110", "120", "20"],
      ["MSFT", "4", "50", "45", "20"],
      ["AAPL", "3", "110", "105", "-15"],
    ]);
    expect(r.openLots).toHaveLength(1);
    expect(r.openLots[0]!.qty.toString()).toBe("-2");
    expect(r.openLots[0]!.price.toString()).toBe("105");
  });

  it("is order-independent of input order (sorts by time)", () => {
    expect(fifo([...fills].reverse()).realizedTotal.toString()).toBe("225");
  });

  it("marks open lots to market, including shorts", () => {
    expect(unrealized(r.openLots, { AAPL: 100 }).total.toString()).toBe("10");
    expect(unrealized(r.openLots, {}).missing).toEqual(["AAPL"]);
  });

  it("no float drift: 0.1 + 0.2 style prices stay exact", () => {
    const f = fifo([F("a", "buy", "X", "3", "0.1", 1), F("b", "sell", "X", "3", "0.3", 2)]);
    expect(f.realizedTotal.toString()).toBe("0.6");
  });
});

describe("realistic P&L (slippage + commission)", () => {
  it("applies 10 bps against me on every fill and $1/order (hand-computed)", () => {
    /*
     * Adjusted: buys ×1.001, sells ×0.999
     *   o1 100.1  o2 110.11  o3 119.88  o4 49.95  o5 45.045  o6 104.895
     * Realized: 10·(119.88−100.1)=197.8 ; 2·(119.88−110.11)=19.54 ; 4·(49.95−45.045)=19.62 ; 3·(104.895−110.11)=−15.645
     *           = 221.315
     * Open short −2 @104.895, exit buy at 100·1.001=100.1 → (104.895−100.1)·2 = 9.59
     * Commissions: 6 orders + 1 open position exit = 7
     * Total = 221.315 + 9.59 − 7 = 223.905
     */
    const r = realistic(fills, { AAPL: 100 }, 10, 1);
    expect(r.realized.toString()).toBe("221.315");
    expect(r.unrealized.toString()).toBe("9.59");
    expect(r.commissions.toString()).toBe("7");
    expect(r.total.toString()).toBe("223.905");
  });

  it("zero slippage and commission equals raw P&L", () => {
    const r = realistic(fills, { AAPL: 100 }, 0, 0);
    expect(r.total.toString()).toBe("235"); // 225 realized + 10 unrealized
  });
});

describe("trade stats", () => {
  it("groups by closing order and computes win rate / avg win/loss / profit factor", () => {
    const trades = closedTrades(fifo(fills).matches);
    // o3: +220, o5: +20, o6: −15
    expect(trades.map((t) => [t.closeOrderId, t.pnl.toString()])).toEqual([
      ["o3", "220"],
      ["o5", "20"],
      ["o6", "-15"],
    ]);
    const s = tradeStats(trades.map((t) => t.pnl));
    expect(s.trades).toBe(3);
    expect(s.winRate).toBeCloseTo(2 / 3);
    expect(s.avgWin!.toString()).toBe("120");
    expect(s.avgLoss!.toString()).toBe("-15");
    expect(s.profitFactor).toBe(16); // 240 / 15
    expect(s.net.toString()).toBe("225");
  });

  it("edge cases", () => {
    expect(tradeStats([]).profitFactor).toBeNull();
    expect(tradeStats([new Decimal(5)]).profitFactor).toBe(Infinity);
    expect(tradeStats([new Decimal(0)]).winRate).toBe(0);
  });
});

describe("Sharpe and drawdown", () => {
  it("Sharpe: equity 100→110→99→108.9 gives returns +10%, −10%, +10%", () => {
    const r = dailyReturns([100, 110, 99, 108.9]);
    expect(r.map((x) => +x.toFixed(10))).toEqual([0.1, -0.1, 0.1]);
    // mean = 1/30; sample var = ((1/15)²·2 + (2/15)²)/2 = 1/75; sd = 0.11547; ×√252
    const expected = (1 / 30 / Math.sqrt(1 / 75)) * Math.sqrt(252);
    expect(sharpe(r)).toBeCloseTo(expected, 6);
    expect(expected).toBeCloseTo(4.5826, 3);
  });

  it("Sharpe is null for flat or too-short series", () => {
    expect(sharpe([0.01])).toBeNull();
    expect(sharpe([0, 0, 0])).toBeNull();
  });

  it("max drawdown picks the deepest peak-to-trough", () => {
    // 120 → 90 is −25%; 130 → 117 is only −10%
    expect(maxDrawdown([100, 120, 90, 130, 117])).toEqual({ maxDd: 0.25, peakIndex: 1, troughIndex: 2 });
    expect(maxDrawdown([1, 2, 3]).maxDd).toBe(0);
  });
});

describe("verdict + slippage", () => {
  it("matches the spec's example sentence", () => {
    expect(verdict(3.1, 4.0)).toBe("You're up 3.1%, SPY is up 4.0% over the same period → you're underperforming by 0.9%.");
    expect(verdict(-2, -5)).toBe("You're down 2.0%, SPY is down 5.0% over the same period → you're outperforming by 3.0%.");
  });

  it("slippage in bps, positive = cost", () => {
    expect(slippageBps("buy", 100, 100.05)).toBeCloseTo(5);
    expect(slippageBps("sell", 100, 99.9)).toBeCloseTo(10);
    expect(slippageBps("buy", 100, 99.98)).toBeCloseTo(-2); // price improvement
  });

  it("arrival price uses mid unless the quote is missing or absurd", () => {
    expect(arrivalPrice(99.9, 100.1, 100)).toEqual({ price: 100, basis: "mid" });
    expect(arrivalPrice(740.12, 785.95, 766.9)).toEqual({ price: 766.9, basis: "last" }); // 6% wide after-hours IEX quote
    expect(arrivalPrice(null, null, null)).toBeNull();
  });
});
