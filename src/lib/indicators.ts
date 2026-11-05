/** Technical indicators. Pure functions over arrays; null where not enough data yet. */

export function sma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= n) sum -= values[i - n]!;
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** RSI with Wilder's smoothing (the standard definition). */
export function rsi(closes: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / n;
  let avgL = loss / n;
  out[n] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    avgG = (avgG * (n - 1) + Math.max(d, 0)) / n;
    avgL = (avgL * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

export interface OhlcvBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Session VWAP: resets when `sessionKey` changes (e.g. the ET date). */
export function vwap(bars: OhlcvBar[], sessionKey: (b: OhlcvBar) => string): (number | null)[] {
  let key = "";
  let pv = 0;
  let vol = 0;
  return bars.map((b) => {
    const k = sessionKey(b);
    if (k !== key) {
      key = k;
      pv = 0;
      vol = 0;
    }
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * b.v;
    vol += b.v;
    return vol > 0 ? pv / vol : null;
  });
}

/** Summary stats used by the ticker header. */
export function summarize(daily: OhlcvBar[]) {
  const closes = daily.map((b) => b.c);
  const last = closes.at(-1) ?? null;
  const yr = daily.slice(-252);
  const hi52 = yr.length ? Math.max(...yr.map((b) => b.h)) : null;
  const lo52 = yr.length ? Math.min(...yr.map((b) => b.l)) : null;
  const vols = daily.slice(-21, -1).map((b) => b.v);
  const avgVol20 = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null;
  return {
    last,
    sma20: sma(closes, 20).at(-1) ?? null,
    sma50: sma(closes, 50).at(-1) ?? null,
    sma200: sma(closes, 200).at(-1) ?? null,
    rsi14: rsi(closes, 14).at(-1) ?? null,
    hi52,
    lo52,
    pctFromHi52: last !== null && hi52 ? ((last - hi52) / hi52) * 100 : null,
    avgVol20,
    relVol: avgVol20 && daily.at(-1) ? daily.at(-1)!.v / avgVol20 : null,
  };
}
