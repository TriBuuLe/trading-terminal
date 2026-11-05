import { Terminal } from "@/components/terminal/terminal";

export const dynamic = "force-dynamic";

// Auth is enforced by proxy.ts (redirects to /login) and every /api route.
export default function Home() {
  return <Terminal />;
}
