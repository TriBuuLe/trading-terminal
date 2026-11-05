# Folio

Personal finance planner (budget, real spending from your bank and card CSVs, goals, Roth/TFSA-style accounts) plus a paper-trading terminal.

A trading terminal on **real, live US stock data** with a **paper (fake-money) account**. Its purpose is to answer one question honestly: *if I made these trades for real, would I make money?*

It does that by:
- trading against Alpaca's paper account at real prices;
- recomputing your P&L with realistic slippage and commissions;
- measuring the actual slippage on every order;
- comparing you against simply buying SPY.

> Paper trading only. The trading endpoint is hard-coded to `https://paper-api.alpaca.markets`, and the app refuses to start if any setting points at Alpaca's live endpoint.

## Setup (local)

You need Node 22+, pnpm, and Docker.

1. **Alpaca paper account:** sign up at <https://app.alpaca.markets/signup>. Free, and no funding is needed.
2. **Paper API keys:** in the dashboard (top-left switcher set to **Paper**), go to Home → API Keys → *Generate New Keys*. The Key ID starts with `PK`.
3. **Finnhub key (optional):** free at <https://finnhub.io/register>. It adds P/E, market cap, margins, earnings dates and analyst trends.
4. **GitHub OAuth app for localhost:** at <https://github.com/settings/developers> → New OAuth App, set homepage `http://localhost:3000` and callback `http://localhost:3000/api/auth/callback/github`.
5. `cp .env.example .env.local`, then fill in the Alpaca keys, `AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET`, `ALLOWED_GITHUB_USER` (your GitHub username), and:
   - `AUTH_SECRET`: `openssl rand -base64 33`
   - `CRON_SECRET`: `openssl rand -hex 32`
6. `pnpm i`
7. `pnpm db:up` starts Postgres in Docker on `localhost:5433`.
8. `pnpm db:migrate`
9. `pnpm dev`, then open <http://localhost:3000> and sign in with GitHub.
10. Optional: `pnpm cron:daily` runs the daily job by hand (equity snapshot, order/fill sync, earnings check).

**Make the test honest.** Paper accounts start at $100,000. Reset yours in the Alpaca dashboard to the amount you'd actually trade, then set the same balance and date in **Settings**. A reset creates a new paper account, so generate new keys afterwards.

## Using it

| Key | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Command palette: search tickers, jump to views, or type an order like `buy 10 AAPL limit 180` (opens a filled ticket to review; never auto-submits) |
| `/` | Ticker search |
| `b` / `s` | Buy / sell the current ticker (prefills the ticket) |
| `g` then `d p m n a j t s` | Dashboard, Portfolio, Movers, News, Alerts, Journal, Chart, Settings |

- **Order ticket:** market, limit, stop, stop-limit and bracket orders; size by shares or dollars (fractional where allowed). It shows a pre-trade preview, warnings (wide spread, market closed, day-trade rule, concentration), a required "why" with tags, and a confirmation step. The quote at the moment you submit is saved, so slippage can be measured against the fill.
- **Portfolio:** your equity curve against SPY buy-and-hold from the same starting dollars, plus return, max drawdown, Sharpe, win rate, profit factor, and allocation.
- **Would this work for real?:** paper P&L next to realistic P&L, which applies `SLIPPAGE_BPS` against you on every fill plus `COMMISSION_PER_TRADE`. It also shows measured slippage, a plain-language verdict against SPY, and a warning while you have fewer than 30 closed trades.
- **Journal:** every order with its why and tags, its outcome once closed, and realized P&L per strategy tag.

## Commands

```
pnpm dev          # app on :3000
pnpm check        # typecheck + lint + unit tests (unit tests use the docker Postgres)
pnpm test:e2e     # Playwright smoke test in DEMO_MODE (own DB + port 3100)
pnpm cron:daily   # call /api/cron/daily on the running app with CRON_SECRET
pnpm db:generate  # after editing src/db/schema.ts
pnpm db:migrate
```

`DEMO_MODE=true` runs a simulated broker and price model, with a **DEMO DATA** banner, so no Alpaca keys are needed. Its login bypass only works in local development; it never applies on Vercel or in a production build.

## What the free tiers mean

- **Prices come from IEX only** (Alpaca's free feed). IEX handles a few percent of US volume, so prices can differ slightly from the consolidated tape, volumes look small, and after-hours quotes can be very wide or missing. The app labels this ("Data: IEX real-time (free tier)") and warns about wide spreads.
- **Alpaca allows 200 requests a minute** for data and for trading. A token bucket stored in Postgres keeps every tab and server instance under that, with automatic back-off on 429 responses. Settings → *Upstream request budget* shows live usage.
- **Prices update by polling, not streaming.** One batched snapshot call every 3s during market hours (about 20 calls a minute), every 30s in extended hours, and none when the market is closed or the tab is hidden. The `PriceFeed` interface lets a WebSocket relay replace polling later.
- **Finnhub allows 60 calls a minute.** Fundamentals are cached for 24 hours.

## Known limitations

- **Price alerts only fire while the app is open** in a browser tab. Alerts while it's closed would need an always-on server, which the free hosting tier doesn't provide. Earnings-soon alerts come from the daily job and appear as a banner on your next visit.
- **Paper fills are optimistic.** Alpaca's simulator fills at the quote, with no queue position or market impact, and it fills orders even for illiquid stocks. That's why the realistic-P&L and measured-slippage numbers exist. Trust them more than raw paper P&L.
- **Measured slippage only covers market orders filled within 5 minutes of submitting.** Orders that queued overnight fill at the open, so comparing them to the submit quote would mix slippage with overnight gaps.
- **The SPY comparison ignores dividends** on both sides, and it starts at the prior close before your first fill.
- **The daily equity curve begins when your paper account began.** Alpaca's history resets when you reset the account, but this app keeps its own copy of orders, fills, and snapshots.
- **Separate local and production databases each track their own request budget.** Running both against the same Alpaca keys at the same time can exceed the limit briefly; the 429 back-off handles it.

## Deploy

Vercel + Neon deployment, Docker (`./open_terminal`), and the cron workflows are the next build phases (9 and 10). This section will be completed then.
