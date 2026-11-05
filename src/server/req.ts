import type { z } from "zod";

export async function body<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = undefined;
  }
  return schema.parse(json);
}

export function searchParams(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}

/** Parse a comma-separated symbol list, uppercased, de-duplicated, capped. */
export function symbolsParam(req: Request, name = "symbols", max = 200): string[] {
  const raw = searchParams(req).get(name) ?? "";
  const out = [...new Set(raw.split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z][A-Z0-9.\-/]{0,9}$/.test(s)))];
  return out.slice(0, max);
}
