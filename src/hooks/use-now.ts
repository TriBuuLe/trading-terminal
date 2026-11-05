"use client";

import { useEffect, useState } from "react";

/** Current time that re-renders every `ms` (keeps Date.now() out of render). */
export function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
