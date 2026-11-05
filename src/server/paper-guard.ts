/**
 * Paper-trading-only guard.
 *
 * The trading base URL is hardcoded below and is the ONLY trading endpoint this
 * codebase knows about. There is intentionally no live-trading code path.
 *
 * As a second line of defense, on startup we scan every environment variable /
 * config value for anything that points at Alpaca's LIVE trading host
 * (`api.alpaca.markets` without the `paper-` prefix) and refuse to start.
 */

export const ALPACA_PAPER_TRADING_URL = "https://paper-api.alpaca.markets" as const;

// Matches `api.alpaca.markets` when it is NOT preceded by `paper-` (or any other
// hostname character), i.e. the live trading host. `data.alpaca.markets` and
// `stream.data.alpaca.markets` are market-data hosts and are allowed.
const LIVE_HOST_RE = /(^|[^a-z0-9.-])api\.alpaca\.markets/i;

export class LiveTradingRefusedError extends Error {
  constructor(source: string) {
    super(
      `REFUSING TO START: "${source}" points at the LIVE Alpaca trading endpoint (api.alpaca.markets). ` +
        `Paper Terminal is paper-trading only and always uses ${ALPACA_PAPER_TRADING_URL}. ` +
        `Remove or fix that value.`,
    );
    this.name = "LiveTradingRefusedError";
  }
}

export function pointsAtLiveTrading(value: string): boolean {
  // Strip a scheme so "https://api.alpaca.markets" is caught by the leading boundary.
  const stripped = value.replace(/^[a-z]+:\/\//i, " ");
  return LIVE_HOST_RE.test(stripped);
}

/** Throws if any value in the given record points at the live trading host. */
export function assertPaperOnly(config: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string" && pointsAtLiveTrading(value)) {
      throw new LiveTradingRefusedError(key);
    }
  }
  // Belt and braces: the hardcoded constant itself must be the paper host.
  if (new URL(ALPACA_PAPER_TRADING_URL).hostname !== "paper-api.alpaca.markets") {
    throw new LiveTradingRefusedError("ALPACA_PAPER_TRADING_URL");
  }
}
