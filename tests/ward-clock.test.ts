import { describe, expect, it } from "vitest";

import {
  clockState,
  elapsedMinutesSinceMount,
  formatElapsed,
  formatInstant,
  formatRemaining,
  minutesUntil,
  MINUTES_PER_DAY,
} from "../src/components/ward-management/ward-clock";

const NOW = 10 * 60 + 42; // 10:42 on the synthetic day

describe("ward clock", () => {
  it("counts minutes forward and backward from now", () => {
    expect(minutesUntil(NOW + 93, NOW)).toBe(93);
    expect(minutesUntil(NOW - 42, NOW)).toBe(-42);
  });

  it("classifies a deadline by how much time is left", () => {
    expect(clockState(NOW - 1, NOW)).toBe("breached");
    expect(clockState(NOW + 30, NOW)).toBe("critical");
    expect(clockState(NOW + 120, NOW)).toBe("due");
    expect(clockState(NOW + 400, NOW)).toBe("clear");
  });

  it("formats a remaining duration for a coordinator, not a machine", () => {
    expect(formatRemaining(93)).toBe("1h 33m left");
    expect(formatRemaining(45)).toBe("45m left");
    expect(formatRemaining(-42)).toBe("42m overdue");
    expect(formatRemaining(-93)).toBe("1h 33m overdue");
  });

  it("formats an instant as a wall-clock time", () => {
    expect(formatInstant(NOW)).toBe("10:42");
    expect(formatInstant(9 * 60 + 5)).toBe("09:05");
  });

  it("wraps a negative instant into a valid wall-clock time instead of printing -1:-14", () => {
    // A synthetic movement can be authored with openedAt before the day began; the audit
    // timeline must still render a real time, not a negative fragment.
    expect(formatInstant(-14)).toBe("23:46");
    expect(formatInstant(-1440)).toBe("00:00");
    expect(formatInstant(-310)).toBe("18:50");
  });

  it("formats an elapsed duration as a wait, never as a breach", () => {
    // A movement opened 95 minutes ago: minutesUntil(now, openedAt) = now - openedAt.
    expect(formatElapsed(minutesUntil(NOW, NOW - 95))).toBe("1h 35m waiting");
    expect(formatElapsed(45)).toBe("45m waiting");
    // formatRemaining would call this "overdue"; formatElapsed must not, and must not go
    // negative even if given a future instant by mistake.
    expect(formatElapsed(-10)).toBe("0m waiting");
  });

  it("measures elapsed minutes across two same-day readings without wrapping", () => {
    expect(elapsedMinutesSinceMount(NOW, NOW + 93)).toBe(93);
    // Mounted and read at the exact same minute: no elapsed time, not a wrap.
    expect(elapsedMinutesSinceMount(NOW, NOW)).toBe(0);
  });

  it("unwraps a midnight rollover instead of freezing the clock", () => {
    // Mounted late in the day (23:50) and read again after the wallClockNow() wrap to 0 at
    // midnight (00:10): a plain subtraction (10 - 1430) is negative, and clamping that at zero
    // — the pre-fix behaviour — makes every deadline on every screen look frozen at the
    // moment of the wrap. 20 real minutes passed; this must report 20, not 0.
    const mountedAt = 23 * 60 + 50; // 23:50
    const readAfterMidnight = 10; // 00:10 the next day
    expect(elapsedMinutesSinceMount(mountedAt, readAfterMidnight)).toBe(20);
  });

  it("unwraps the boundary case: mounted and read at exactly the same minute across the wrap", () => {
    // A session mounted at 23:59 and read one minute later, at 00:00, must report 1 minute
    // elapsed, not a full day.
    expect(elapsedMinutesSinceMount(23 * 60 + 59, 0)).toBe(1);
    // The wrap is exactly `MINUTES_PER_DAY` wide: mounted at minute 0, read at the last
    // minute of the day before rolling over, is the whole day minus one minute — no wrap
    // needed since `current` is still greater than `mountedAt`.
    expect(elapsedMinutesSinceMount(0, MINUTES_PER_DAY - 1)).toBe(MINUTES_PER_DAY - 1);
  });
});
