/** `pnpm cron:daily`: call the running app's daily cron route with the secret. */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set in .env.local");
  const res = await fetch(`${base}/api/cron/daily`, { headers: { Authorization: `Bearer ${secret}` } });
  const body = await res.text();
  console.log(`HTTP ${res.status}\n${body}`);
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
