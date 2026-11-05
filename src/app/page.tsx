import { auth, signOut } from "@/auth";
import { HealthPanel } from "@/components/shell/health-panel";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className="flex items-center gap-4">
        <h1 className="font-mono text-lg tracking-tight">PAPER TERMINAL</h1>
        <span className="font-mono text-xs text-muted-foreground">signed in as {session?.login}</span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <Button variant="ghost" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </div>
      <HealthPanel />
    </main>
  );
}
