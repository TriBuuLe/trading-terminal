"use client";

import { useEffect } from "react";
import { useUi, type View } from "@/stores/ui";

const GOTO: Record<string, View> = { d: "dashboard", p: "portfolio", m: "movers", n: "news", a: "alerts", j: "journal", t: "ticker", s: "settings" };

function typing(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * Global keys: ⌘K / Ctrl+K palette, "/" search, "b"/"s" buy/sell the focused
 * ticker (opens a ticket; never submits), "g <letter>" to switch views, Esc closes.
 */
export function useShortcuts() {
  useEffect(() => {
    let g = false;
    let gTimer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
        return;
      }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (ui.paletteOpen || ui.searchOpen) return;
      if (g) {
        g = false;
        const v = GOTO[e.key.toLowerCase()];
        if (v) {
          e.preventDefault();
          ui.setView(v);
        }
        return;
      }
      switch (e.key) {
        case "/":
          e.preventDefault();
          ui.setSearchOpen(true);
          break;
        case "b":
        case "s":
          e.preventDefault();
          ui.prefillTicket({ symbol: ui.symbol, side: e.key === "b" ? "buy" : "sell" });
          break;
        case "g":
          g = true;
          if (gTimer) clearTimeout(gTimer);
          gTimer = setTimeout(() => (g = false), 1200);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
