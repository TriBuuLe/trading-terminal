import type { Assumptions } from "./types";

/**
 * Default capital-market assumptions (real = after inflation). Deliberately
 * BELOW long-run history so plans aren't built on optimism. Editable in Settings.
 *
 * History used as the anchor (computed 2026-11-04 from Damodaran's yearly table,
 * 1928–2025, https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html):
 *   S&P 500 10.0% nominal geometric, σ 19.4%; 10-yr US T-bond 4.5%, σ 7.9%; 3-month T-bill 3.4%, σ 3.0%.
 */
const HIST = "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html";

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  inflationPct: 2.5,
  inflationSource:
    "Bank of Canada targets 2% inflation; its Oct 2026 Monetary Policy Report projects ~3% through 2027, near 2% by mid-2028 (https://www.bankofcanada.ca/core-functions/monetary-policy/inflation/). 2.5% long-run is a cautious middle.",
  classes: {
    equity: {
      key: "equity",
      label: "Diversified global stocks",
      realReturnPct: 4.5,
      volatilityPct: 17,
      source: `US stocks 1928–2025 returned 10.0%/yr nominal (≈6.5–7% real) with σ 19.4% (${HIST}). Assumed 4.5% real: a haircut for today's valuations and non-US markets; σ 17% reflects global diversification.`,
    },
    bonds: {
      key: "bonds",
      label: "Investment-grade bonds",
      realReturnPct: 1.5,
      volatilityPct: 6,
      source: `10-yr US T-bonds 1928–2025 returned 4.5%/yr nominal with σ 7.9% (${HIST}). Assumed 1.5% real for an aggregate (shorter-duration) bond fund.`,
    },
    cash: {
      key: "cash",
      label: "Cash, HISA, GICs/CDs, T-bills",
      realReturnPct: 0.5,
      volatilityPct: 1,
      source: `3-month T-bills 1928–2025 returned 3.4%/yr nominal, σ 3.0% (${HIST}), roughly 0–1% above inflation. Assumed 0.5% real.`,
    },
  },
  stockBondCorrelation: 0.1,
  correlationSource: "Long-run stock/bond correlation has been near zero to slightly positive; 0.1 assumed (editable).",
};
