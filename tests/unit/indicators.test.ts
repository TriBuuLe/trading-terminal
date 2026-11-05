import { describe, expect, it } from "vitest";
import { rsi, sma, vwap } from "@/lib/indicators";

describe("indicators", () => {
  it("SMA", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("RSI uses Wilder smoothing (hand-computed)", () => {
    // closes 1,2,1,2,3 → changes +1,-1,+1,+1; n=3
    // first: avgG=(1+0+1)/3=2/3, avgL=1/3 → RS=2 → RSI=66.67
    // next:  avgG=(2/3·2+1)/3=7/9, avgL=(1/3·2+0)/3=2/9 → RS=3.5 → RSI=77.78
    const r = rsi([1, 2, 1, 2, 3], 3);
    expect(r.slice(0, 3)).toEqual([null, null, null]);
    expect(r[3]).toBeCloseTo(66.6667, 3);
    expect(r[4]).toBeCloseTo(77.7778, 3);
  });

  it("RSI is 100 when there are no losses", () => {
    expect(rsi([1, 2, 3, 4], 3)[3]).toBe(100);
  });

  it("VWAP resets each session", () => {
    const bars = [
      { t: "d1a", o: 10, h: 12, l: 8, c: 10, v: 100 }, // typical 10
      { t: "d1b", o: 10, h: 22, l: 18, c: 20, v: 300 }, // typical 20
      { t: "d2a", o: 30, h: 33, l: 27, c: 30, v: 50 }, // new session
    ];
    const v = vwap(bars, (b) => b.t.slice(0, 2));
    expect(v[0]).toBe(10);
    expect(v[1]).toBe((10 * 100 + 20 * 300) / 400);
    expect(v[2]).toBe(30);
  });
});
