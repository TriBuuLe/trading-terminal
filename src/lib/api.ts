/** Browser -> our own /api routes only. Throws ApiError with the server's message. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly problems: string[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
    cache: "no-store",
  });
  if (res.status === 401) {
    // Full reload on purpose: the login page is server-rendered and sets auth cookies.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (typeof window !== "undefined") window.location.href = `/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
    throw new ApiError("Signed out", 401);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const obj = (json ?? {}) as { error?: unknown; problems?: unknown };
    const msg = typeof obj.error === "string" ? obj.error : `Request failed (HTTP ${res.status})`;
    const problems = Array.isArray(obj.problems) ? obj.problems.filter((p): p is string => typeof p === "string") : [];
    throw new ApiError(msg, res.status, problems);
  }
  return json as T;
}
