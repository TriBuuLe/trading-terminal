import { describe, expect, it } from "vitest";
import { classifySession } from "@/lib/market-session";
import { etToDate, etParts, formatCountdown } from "@/lib/time";

const day = { date: "2026-11-04", open: "09:30", close: "16:00", session_open: "0400", session_close: "2000" };
const closedClock = { is_open: false, next_open: "2026-11-05T14:30:00Z", next_close: "2026-11-05T21:00:00Z" };

describe("market session", () => {
  it("converts ET wall time to UTC across DST", () => {
    expect(etToDate("2026-11-04", "09:30").toISOString()).toBe("2026-11-04T14:30:00.000Z"); // EST
    expect(etToDate("2026-07-01", "09:30").toISOString()).toBe("2026-07-01T13:30:00.000Z"); // EDT
    expect(etParts(new Date("2026-11-04T14:30:00Z")).minutes).toBe(570);
  });

  it("open when the clock says so", () => {
    const s = classifySession(new Date("2026-11-04T15:00:00Z"), { ...closedClock, is_open: true, next_close: "2026-11-04T21:00:00Z" }, day);
    expect(s.session).toBe("open");
    expect(s.nextEvent).toBe("close");
  });

  it("pre-market between 4:00 and 9:30 ET", () => {
    const s = classifySession(new Date("2026-11-04T12:00:00Z"), closedClock, day); // 7:00 ET
    expect(s.session).toBe("pre");
    expect(s.nextEventAt).toBe("2026-11-04T14:30:00.000Z");
  });

  it("after-hours between close and 20:00 ET, incl. early close days", () => {
    expect(classifySession(new Date("2026-11-04T22:00:00Z"), closedClock, day).session).toBe("after"); // 17:00
    const early = { ...day, close: "13:00" };
    expect(classifySession(new Date("2026-11-04T19:00:00Z"), closedClock, early).session).toBe("after"); // 14:00
  });

  it("closed overnight, weekends and holidays", () => {
    expect(classifySession(new Date("2026-11-05T02:00:00Z"), closedClock, day).session).toBe("closed"); // 21:00 ET
    expect(classifySession(new Date("2026-11-07T15:00:00Z"), closedClock, null).session).toBe("closed");
  });

  it("formats countdowns", () => {
    expect(formatCountdown(65_000)).toBe("1m 05s");
    expect(formatCountdown(3 * 3600_000 + 120_000)).toBe("3h 2m");
    expect(formatCountdown(26 * 3600_000)).toBe("1d 2h 0m");
  });
});
