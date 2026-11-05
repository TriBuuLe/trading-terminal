"use client";

import { AlertTriangle } from "lucide-react";
import { PriceFeedProvider } from "@/hooks/price-feed";
import { useConfig } from "@/hooks/queries";
import { useShortcuts } from "@/hooks/shortcuts";
import { useAlertEngine } from "@/hooks/alert-engine";
import { cn } from "@/lib/utils";
import { useUi, type View } from "@/stores/ui";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { PlannerApp } from "../planner/planner-app";
import { DashboardView } from "./dashboard";
import { EarningsBanner } from "./earnings-banner";
import { OrderTicket } from "./order-ticket";
import { StatusBar } from "./status-bar";
import { CommandPalette } from "./symbol-search";
import { TopBar } from "./top-bar";
import { WatchlistPanel } from "./watchlist-panel";
import { AlertsView } from "./views/alerts";
import { JournalView } from "./views/journal";
import { MoversView } from "./views/movers";
import { NewsView } from "./views/news";
import { PortfolioView } from "./views/portfolio";
import { SettingsView } from "./views/settings";
import { TickerView } from "./views/ticker";

const NAV: { view: View; label: string; key: string }[] = [
  { view: "dashboard", label: "Dashboard", key: "g d" },
  { view: "ticker", label: "Chart", key: "g t" },
  { view: "portfolio", label: "Portfolio", key: "g p" },
  { view: "movers", label: "Movers", key: "g m" },
  { view: "news", label: "News", key: "g n" },
  { view: "alerts", label: "Alerts", key: "g a" },
  { view: "journal", label: "Journal", key: "g j" },
  { view: "settings", label: "Settings", key: "g s" },
];

function CenterView() {
  const view = useUi((s) => s.view);
  const symbol = useUi((s) => s.symbol);
  const setView = useUi((s) => s.setView);
  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <nav className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-2" aria-label="Views">
        {NAV.map((n) => (
          <button
            key={n.view}
            onClick={() => setView(n.view)}
            title={`${n.label} (${n.key})`}
            className={cn(
              "rounded px-2.5 py-1 text-xs",
              view === n.view ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {n.view === "ticker" ? <span className="font-mono">{symbol}</span> : n.label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1">
        {view === "dashboard" && <DashboardView />}
        {view === "ticker" && <TickerView />}
        {view === "portfolio" && <PortfolioView />}
        {view === "movers" && <MoversView />}
        {view === "news" && <NewsView />}
        {view === "alerts" && <AlertsView />}
        {view === "journal" && <JournalView />}
        {view === "settings" && <SettingsView />}
      </div>
    </div>
  );
}

/** Mounted inside the price-feed provider so alert symbols join the poll. */
function AlertEngine() {
  useAlertEngine();
  return null;
}

function DemoBanner() {
  return (
    <div className="flex h-6 shrink-0 items-center justify-center gap-2 bg-amber-500 text-[11px] font-semibold tracking-wider text-black uppercase">
      <AlertTriangle className="size-3.5" /> Demo data: prices and fills are simulated, not real market data
    </div>
  );
}

export function Terminal() {
  const { data: cfg } = useConfig();
  const mode = useUi((s) => s.mode);
  useShortcuts();
  return (
    <PriceFeedProvider pollMs={cfg?.quotePollMs ?? 3000}>
      <div className="flex h-full flex-col">
        {cfg?.demoMode && <DemoBanner />}
        <TopBar />
        <EarningsBanner />
        <AlertEngine />
        {mode === "planner" ? (
          <div className="min-h-0 flex-1">
            <PlannerApp />
          </div>
        ) : (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel id="watchlist" defaultSize={430} minSize={300} maxSize={640} collapsible collapsedSize={0}>
            <WatchlistPanel />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="center" minSize={420}>
            <CenterView />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="ticket" defaultSize={320} minSize={280} maxSize={460} collapsible collapsedSize={0}>
            <OrderTicket />
          </ResizablePanel>
        </ResizablePanelGroup>
        )}
        <StatusBar />
        <CommandPalette />
      </div>
    </PriceFeedProvider>
  );
}
