import type { Country } from "./types";

/**
 * Example low-cost index ETFs per asset class. Fees are only shown as verified
 * when read from the issuer's own page (date + URL). Others say "verify" and
 * link to the issuer: we don't state fees from memory.
 */
export interface FundExample {
  ticker: string;
  name: string;
  assetClass: "equity" | "bonds" | "cash";
  region: string;
  feePct: number | null; // MER / expense ratio
  feeSource: string | null; // URL read
  feeVerified: string | null; // YYYY-MM-DD
  issuerUrl: string;
}

export const FUNDS: Record<Country, FundExample[]> = {
  CA: [
    { ticker: "XEQT", name: "iShares Core Equity ETF Portfolio (all-in-one, ~100% stocks)", assetClass: "equity", region: "Global", feePct: null, feeSource: null, feeVerified: null, issuerUrl: "https://www.blackrock.com/ca" },
    { ticker: "VCN", name: "Vanguard FTSE Canada All Cap Index ETF", assetClass: "equity", region: "Canada", feePct: null, feeSource: null, feeVerified: null, issuerUrl: "https://www.vanguard.ca" },
    { ticker: "XUU", name: "iShares Core S&P U.S. Total Market Index ETF", assetClass: "equity", region: "US", feePct: null, feeSource: null, feeVerified: null, issuerUrl: "https://www.blackrock.com/ca" },
    { ticker: "XEF", name: "iShares Core MSCI EAFE IMI Index ETF", assetClass: "equity", region: "Developed ex-NA", feePct: null, feeSource: null, feeVerified: null, issuerUrl: "https://www.blackrock.com/ca" },
    { ticker: "XEC", name: "iShares Core MSCI Emerging Markets IMI Index ETF", assetClass: "equity", region: "Emerging", feePct: null, feeSource: null, feeVerified: null, issuerUrl: "https://www.blackrock.com/ca" },
    { ticker: "ZAG", name: "BMO Aggregate Bond Index ETF", assetClass: "bonds", region: "Canada", feePct: null, feeSource: null, feeVerified: null, issuerUrl: "https://www.bmo.com/gam/ca" },
    { ticker: "CASH", name: "Global X High Interest Savings ETF (or a HISA / GIC)", assetClass: "cash", region: "Canada", feePct: null, feeSource: null, feeVerified: null, issuerUrl: "https://www.globalx.ca" },
  ],
  US: [
    { ticker: "VTI", name: "Vanguard Total Stock Market ETF", assetClass: "equity", region: "US", feePct: null, feeSource: null, feeVerified: null, issuerUrl: "https://investor.vanguard.com" },
    { ticker: "VXUS", name: "Vanguard Total International Stock ETF", assetClass: "equity", region: "International", feePct: null, feeSource: null, feeVerified: null, issuerUrl: "https://investor.vanguard.com" },
    { ticker: "BND", name: "Vanguard Total Bond Market ETF", assetClass: "bonds", region: "US", feePct: null, feeSource: null, feeVerified: null, issuerUrl: "https://investor.vanguard.com" },
    {
      ticker: "SGOV",
      name: "iShares 0-3 Month Treasury Bond ETF (or a high-yield savings account / CDs)",
      assetClass: "cash",
      region: "US",
      feePct: 0.09,
      feeSource: "https://www.ishares.com/us/products/314116/ishares-0-3-month-treasury-bond-etf",
      feeVerified: "2026-11-04",
      issuerUrl: "https://www.ishares.com",
    },
  ],
};

/** Example funds for a mix (only classes with weight > 0). */
export function fundsForMix(country: Country, mix: { equity: number; bonds: number; cash: number }): FundExample[] {
  return FUNDS[country].filter((f) => mix[f.assetClass] > 0);
}
