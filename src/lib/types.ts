/** Shapes shared between API routes and the browser. Money stays as strings. */

export type TradeSession = "regular" | "pre" | "after" | "overnight";

export interface Quote {
  symbol: string;
  price: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  /** Today's volume on the IEX feed (a fraction of consolidated volume). */
  volume: number | null;
  bid: number | null;
  ask: number | null;
  tradeTime: string | null;
  /** Session the last trade printed in. */
  tradeSession: TradeSession | null;
}

export interface QuotesResponse {
  quotes: Record<string, Quote>;
  market: import("./market-session").MarketStatus;
  fetchedAt: string;
  stale: boolean;
  storedAt: string;
}

export interface AccountSummary {
  accountNumber: string;
  status: string;
  equity: string;
  lastEquity: string;
  cash: string;
  buyingPower: string;
  longMarketValue: string | null;
  dayPL: string;
  dayPLPct: string | null;
  allTimePL: string;
  allTimePLPct: string | null;
  startBalance: string;
  startDate: string;
  patternDayTrader: boolean;
  daytradeCount: number;
  tradingBlocked: boolean;
  shortingEnabled: boolean;
}

export interface PositionRow {
  symbol: string;
  side: "long" | "short";
  qty: string;
  avgEntry: string;
  last: string | null;
  marketValue: string | null;
  costBasis: string;
  unrealizedPL: string | null;
  unrealizedPLPct: string | null;
  todayPL: string | null;
  todayPLPct: string | null;
  pctOfPortfolio: string | null;
}

export interface OrderRow {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  orderClass: string | null;
  tif: string;
  qty: string | null;
  notional: string | null;
  filledQty: string;
  filledAvgPrice: string | null;
  limitPrice: string | null;
  stopPrice: string | null;
  status: string;
  submittedAt: string | null;
  filledAt: string | null;
  canceledAt: string | null;
  extendedHours: boolean;
  legs: OrderRow[];
  why: string | null;
  tags: string[];
}

export interface Watchlist {
  id: number;
  name: string;
  isActive: boolean;
  symbols: string[];
}

export interface AssetHit {
  symbol: string;
  name: string;
  exchange: string;
  fractionable: boolean;
  shortable: boolean;
  tradable: boolean;
}

export interface AppConfig {
  demoMode: boolean;
  quotePollMs: number;
  dataFeed: "iex" | "sip";
  finnhubEnabled: boolean;
  slippageBps: number;
  commissionPerTrade: number;
  login: string | null;
}
