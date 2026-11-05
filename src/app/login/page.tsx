import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const errors: Record<string, string> = {
  AccessDenied: "That GitHub account isn't allowed. Only ALLOWED_GITHUB_USER can sign in.",
  Configuration: "Auth is misconfigured. Check AUTH_SECRET, AUTH_GITHUB_ID and AUTH_GITHUB_SECRET.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const session = await auth();
  const callbackUrl = typeof sp.callbackUrl === "string" && sp.callbackUrl.startsWith("/") ? sp.callbackUrl : "/";
  if (session?.login) redirect(callbackUrl);

  const error = typeof sp.error === "string" ? (errors[sp.error] ?? `Sign-in failed (${sp.error}).`) : null;
  const configured = Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);

  return (
    <main className="flex h-full items-center justify-center p-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-mono text-sm tracking-tight">PAPER TERMINAL</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">Single-user paper trading terminal. Sign in with GitHub.</p>
          {error && <p className="rounded-md bg-red-500/10 p-2 text-red-400">{error}</p>}
          {!configured && (
            <p className="rounded-md bg-amber-500/10 p-2 text-amber-400">
              GitHub OAuth isn&apos;t configured yet: set AUTH_GITHUB_ID and AUTH_GITHUB_SECRET in .env.local.
            </p>
          )}
          <form
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: callbackUrl });
            }}
          >
            <Button type="submit" className="w-full" disabled={!configured}>
              Sign in with GitHub
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
