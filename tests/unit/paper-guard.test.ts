import { describe, expect, it } from "vitest";
import {
  ALPACA_PAPER_TRADING_URL,
  assertPaperOnly,
  LiveTradingRefusedError,
  pointsAtLiveTrading,
} from "@/server/paper-guard";
import { parseEnv } from "@/server/env-schema";

describe("paper-only guard", () => {
  it("hardcodes the paper trading host", () => {
    expect(ALPACA_PAPER_TRADING_URL).toBe("https://paper-api.alpaca.markets");
  });

  it.each([
    "https://api.alpaca.markets",
    "https://api.alpaca.markets/v2",
    "api.alpaca.markets",
    "http://API.ALPACA.MARKETS",
    "wss://api.alpaca.markets/stream",
  ])("flags live host %s", (v) => {
    expect(pointsAtLiveTrading(v)).toBe(true);
  });

  it.each([
    "https://paper-api.alpaca.markets",
    "paper-api.alpaca.markets/v2",
    "https://data.alpaca.markets",
    "wss://stream.data.alpaca.markets/v2/iex",
    "some-key-value",
  ])("allows %s", (v) => {
    expect(pointsAtLiveTrading(v)).toBe(false);
  });

  it("throws on any env var pointing at live trading", () => {
    expect(() => assertPaperOnly({ APCA_API_BASE_URL: "https://api.alpaca.markets" })).toThrow(LiveTradingRefusedError);
    expect(() => assertPaperOnly({ RANDOM: "x", ALPACA_ENDPOINT: "api.alpaca.markets" })).toThrow(/ALPACA_ENDPOINT/);
  });

  it("passes with paper/data URLs", () => {
    expect(() =>
      assertPaperOnly({ APCA_API_BASE_URL: "https://paper-api.alpaca.markets", DATA: "https://data.alpaca.markets" }),
    ).not.toThrow();
  });
});

describe("env schema", () => {
  const base = {
    DATABASE_URL: "postgres://u:p@localhost:5433/db",
    AUTH_SECRET: "x".repeat(40),
    CRON_SECRET: "y".repeat(32),
    ALLOWED_GITHUB_USER: "me",
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  };

  it("requires Alpaca keys unless DEMO_MODE", () => {
    expect(() => parseEnv(base)).toThrow(/ALPACA_API_KEY_ID/);
    expect(parseEnv({ ...base, DEMO_MODE: "true" }).DEMO_MODE).toBe(true);
  });

  it("requires database, auth secret, cron secret, allowed user", () => {
    expect(() => parseEnv({ DEMO_MODE: "true" })).toThrow(/DATABASE_URL[\s\S]*AUTH_SECRET[\s\S]*CRON_SECRET/);
    expect(() => parseEnv({ ...base, DEMO_MODE: "true", ALLOWED_GITHUB_USER: "" })).toThrow(/ALLOWED_GITHUB_USER/);
    expect(() => parseEnv({ ...base, DEMO_MODE: "true", CRON_SECRET: "short" })).toThrow(/CRON_SECRET/);
    expect(() => parseEnv({ ...base, DEMO_MODE: "true", DATABASE_URL: "mysql://x/y" })).toThrow(/DATABASE_URL/);
  });

  it("applies defaults and coerces numbers", () => {
    const e = parseEnv({ ...base, ALPACA_API_KEY_ID: "k", ALPACA_API_SECRET_KEY: "s", SLIPPAGE_BPS: "7", FINNHUB_API_KEY: "" });
    expect(e.ALPACA_DATA_FEED).toBe("iex");
    expect(e.SLIPPAGE_BPS).toBe(7);
    expect(e.QUOTE_POLL_MS).toBe(3000);
    expect(e.FINNHUB_API_KEY).toBeUndefined();
  });

  it("rejects unknown feed", () => {
    expect(() => parseEnv({ ...base, DEMO_MODE: "true", ALPACA_DATA_FEED: "otc" })).toThrow();
  });
});
