"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Check {
  status: "ok" | "error" | "skipped" | "demo";
  latencyMs?: number;
  detail?: string;
}
interface Health {
  ok: boolean;
  demoMode: boolean;
  tradingBaseUrl: string;
  dataFeed: string;
  checks: Record<string, Check>;
  checkedAt: string;
}

const tone: Record<Check["status"], string> = {
  ok: "bg-emerald-500/15 text-emerald-400",
  error: "bg-red-500/15 text-red-400",
  skipped: "bg-zinc-500/15 text-zinc-400",
  demo: "bg-amber-500/15 text-amber-400",
};

export function HealthPanel() {
  const q = useQuery({
    queryKey: ["health"],
    queryFn: async (): Promise<Health> => {
      const r = await fetch("/api/health");
      const j: unknown = await r.json();
      if (!j || typeof j !== "object" || !("checks" in j)) throw new Error("Health endpoint failed");
      return j as Health;
    },
  });

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="font-mono text-sm">System health</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 font-mono text-xs">
        {q.isPending && Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-5 w-full" />)}
        {q.isError && <p className="text-red-400">Health check failed: {q.error.message}</p>}
        {q.data &&
          Object.entries(q.data.checks).map(([name, c]) => (
            <div key={name} className="flex items-start gap-3">
              <Badge className={tone[c.status]}>{c.status}</Badge>
              <span className="w-28 shrink-0 text-muted-foreground">{name}</span>
              <span className="break-all">{c.detail}</span>
            </div>
          ))}
        {q.data && <p className="pt-2 text-muted-foreground">Trading endpoint: {q.data.tradingBaseUrl} · checked {new Date(q.data.checkedAt).toLocaleTimeString()}</p>}
      </CardContent>
    </Card>
  );
}
