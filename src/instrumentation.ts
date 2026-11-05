/**
 * Runs once when the Next.js server starts. Validates env and enforces the
 * paper-only guard: if anything points at live trading, startup fails.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { env } = await import("./server/env");
    const e = env();
    console.log(
      `[paper-terminal] env OK: paper trading only, feed=${e.ALPACA_DATA_FEED}, demo=${e.DEMO_MODE}, quote poll=${e.QUOTE_POLL_MS}ms`,
    );
  }
}
