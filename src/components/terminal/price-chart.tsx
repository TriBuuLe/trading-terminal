"use client";

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { rsi, sma, vwap, type OhlcvBar } from "@/lib/indicators";
import { compact, price } from "@/lib/format";
import { etParts } from "@/lib/time";

export interface Overlays {
  sma20: boolean;
  sma50: boolean;
  sma200: boolean;
  vwap: boolean;
  rsi: boolean;
  volume: boolean;
}

export interface FillMark {
  side: string;
  qty: string;
  price: string;
  time: string;
}

const C = {
  up: "#1fa7a0",
  down: "#e5534b",
  grid: "#1f2125",
  text: "#8b8d93",
  border: "#2a2c31",
  // Overlay lines use categorical slots (blue, yellow, violet, magenta), validated on this surface.
  sma20: "#3987e5",
  sma50: "#c98500",
  sma200: "#9085e9",
  vwap: "#d55181",
  rsi: "#3987e5",
};

/** Chart time: ET calendar day for daily bars; ET wall clock (as if UTC) for intraday so the axis reads in market time. */
function toTime(iso: string, daily: boolean): Time {
  if (daily) return etParts(new Date(iso)).date as Time;
  const d = new Date(iso);
  const { date, minutes } = etParts(d);
  const [y, m, day] = date.split("-").map(Number) as [number, number, number];
  return (Date.UTC(y, m - 1, day, Math.floor(minutes / 60), minutes % 60) / 1000 + d.getUTCSeconds()) as UTCTimestamp;
}

interface Hover {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  label: string;
}

export function PriceChart({
  bars,
  daily,
  visibleFrom,
  overlays,
  fills,
  avgEntry,
}: {
  bars: OhlcvBar[];
  daily: boolean;
  visibleFrom: string;
  overlays: Overlays;
  fills: FillMark[];
  avgEntry: number | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  useEffect(() => {
    if (!el.current || bars.length === 0) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: C.text,
        fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
        fontSize: 11,
        panes: { separatorColor: C.border, separatorHoverColor: "#3a3d44" },
      },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.border },
      timeScale: { borderColor: C.border, timeVisible: !daily, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartRef.current = chart;

    const times = bars.map((b) => toTime(b.t, daily));
    const closes = bars.map((b) => b.c);

    // Up candles hollow, down candles filled: direction is readable without color.
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "rgba(0,0,0,0)",
      downColor: C.down,
      borderUpColor: C.up,
      borderDownColor: C.down,
      wickUpColor: C.up,
      wickDownColor: C.down,
      priceLineColor: "#5b5e66",
    });
    candles.setData(bars.map((b, i) => ({ time: times[i]!, open: b.o, high: b.h, low: b.l, close: b.c })));

    if (overlays.volume) {
      const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(bars.map((b, i) => ({ time: times[i]!, value: b.v, color: b.c >= b.o ? "rgba(31,167,160,0.35)" : "rgba(229,83,75,0.35)" })));
    }

    const line = (values: (number | null)[], color: string, title: string, pane = 0) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: 2, title, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane);
      s.setData(values.flatMap((v, i) => (v === null ? [] : [{ time: times[i]!, value: v }])));
      return s;
    };
    if (overlays.sma20) line(sma(closes, 20), C.sma20, "SMA20");
    if (overlays.sma50) line(sma(closes, 50), C.sma50, "SMA50");
    if (overlays.sma200) line(sma(closes, 200), C.sma200, "SMA200");
    if (overlays.vwap && !daily) line(vwap(bars, (b) => etParts(new Date(b.t)).date), C.vwap, "VWAP");
    if (overlays.rsi) {
      const r = line(rsi(closes, 14), C.rsi, "RSI14", 1);
      r.createPriceLine({ price: 70, color: "#5b5e66", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "" });
      r.createPriceLine({ price: 30, color: "#5b5e66", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "" });
      chart.panes()[1]?.setStretchFactor(0.28);
    }

    if (avgEntry) {
      candles.createPriceLine({ price: avgEntry, color: "#c98500", lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true, title: "avg entry" });
    }

    // My fills as buy/sell markers, snapped to the bar that contains them.
    if (fills.length) {
      const barMs = bars.map((b) => new Date(b.t).getTime());
      const markers: SeriesMarker<Time>[] = [];
      for (const f of fills) {
        const ft = new Date(f.time).getTime();
        let idx = -1;
        for (let i = 0; i < barMs.length; i++) {
          if (barMs[i]! <= ft) idx = i;
          else break;
        }
        if (idx < 0) continue;
        const buy = f.side === "buy";
        markers.push({
          time: times[idx]!,
          position: buy ? "belowBar" : "aboveBar",
          shape: buy ? "arrowUp" : "arrowDown",
          color: buy ? C.up : C.down,
          text: `${buy ? "B" : "S"} ${Number(f.qty)}@${price(f.price)}`,
        });
      }
      markers.sort((a, b) => (String(a.time) < String(b.time) ? -1 : 1));
      createSeriesMarkers(candles, markers);
    }

    // Show the requested range; warm-up bars stay scrollable to the left.
    const fromIdx = bars.findIndex((b) => b.t >= visibleFrom);
    if (fromIdx > 0) chart.timeScale().setVisibleLogicalRange({ from: fromIdx, to: bars.length + 3 });
    else chart.timeScale().fitContent();

    const byTime = new Map(times.map((t, i) => [String(t), bars[i]!]));
    chart.subscribeCrosshairMove((p) => {
      if (!p.time) return setHover(null);
      const b = byTime.get(String(p.time));
      if (!b) return setHover(null);
      setHover({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, label: daily ? etParts(new Date(b.t)).date : new Date(b.t).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" });
    });

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, daily, visibleFrom, overlays, fills, avgEntry]);

  const last = bars.at(-1);
  const h = hover ?? (last ? { o: last.o, h: last.h, l: last.l, c: last.c, v: last.v, label: "last bar" } : null);
  return (
    <div className="relative h-full w-full">
      {h && (
        <div className="num pointer-events-none absolute top-1 left-2 z-10 flex gap-3 text-[11px] text-muted-foreground">
          <span>{h.label}</span>
          <span>
            O <span className="text-foreground">{price(h.o)}</span>
          </span>
          <span>
            H <span className="text-foreground">{price(h.h)}</span>
          </span>
          <span>
            L <span className="text-foreground">{price(h.l)}</span>
          </span>
          <span>
            C <span className={h.c >= h.o ? "text-up" : "text-down"}>{price(h.c)}</span>
          </span>
          <span>
            V <span className="text-foreground">{compact(h.v)}</span>
          </span>
        </div>
      )}
      <div ref={el} className="h-full w-full" />
    </div>
  );
}
