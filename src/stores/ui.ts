import { create } from "zustand";
import type { OrderRequest } from "@/lib/orders";

export type View = "dashboard" | "ticker" | "portfolio" | "movers" | "news" | "alerts" | "journal" | "settings";

export type TicketPrefill = Partial<Omit<OrderRequest, "source" | "tags" | "why">> & { why?: string; tags?: string[]; nonce: number };

interface UiState {
  view: View;
  symbol: string;
  ticket: TicketPrefill | null;
  searchOpen: boolean;
  paletteOpen: boolean;
  setView(v: View): void;
  openTicker(symbol: string): void;
  setSymbol(symbol: string): void;
  prefillTicket(p: Omit<TicketPrefill, "nonce">): void;
  setSearchOpen(open: boolean): void;
  setPaletteOpen(open: boolean): void;
}

export const useUi = create<UiState>((set) => ({
  view: "dashboard",
  symbol: "SPY",
  ticket: null,
  searchOpen: false,
  paletteOpen: false,
  setView: (view) => set({ view }),
  openTicker: (symbol) => set({ symbol: symbol.toUpperCase(), view: "ticker" }),
  setSymbol: (symbol) => set({ symbol: symbol.toUpperCase() }),
  prefillTicket: (p) => set({ ticket: { ...p, nonce: Date.now() }, symbol: p.symbol ? p.symbol.toUpperCase() : useUi.getState().symbol }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
}));
