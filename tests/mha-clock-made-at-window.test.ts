import { describe, expect, it } from "vitest";

import timeframes from "../data/mha-timeframes.json";
import {
  MHA_CLOCK_FUTURE_TOLERANCE_MS,
  MHA_CLOCK_MAX_PAST_MS,
  mhaClockMadeAtProblem,
} from "@/lib/psychiatry-hub/mha-clocks";

// Owner ruling, via Grok Bot, 2026-10-20 07:33 AWST: refuse a made-at time more than 7 days in
// the past or in the future, allowing a few minutes of clock skew.
const HOUR = 60 * 60_000;
const now = new Date("2026-10-20T00:00:00Z").getTime();

describe("MHA clock made-at window", () => {
  it("is 7 days back and 5 minutes forward", () => {
    expect(MHA_CLOCK_MAX_PAST_MS).toBe(7 * 24 * HOUR);
    expect(MHA_CLOCK_FUTURE_TOLERANCE_MS).toBe(5 * 60_000);
  });

  it("accepts now, the past edge exactly and the skew edge exactly", () => {
    expect(mhaClockMadeAtProblem(now, now)).toBeNull();
    expect(mhaClockMadeAtProblem(now - MHA_CLOCK_MAX_PAST_MS, now)).toBeNull();
    expect(mhaClockMadeAtProblem(now + MHA_CLOCK_FUTURE_TOLERANCE_MS, now)).toBeNull();
  });

  it("refuses one millisecond past either edge", () => {
    expect(mhaClockMadeAtProblem(now - MHA_CLOCK_MAX_PAST_MS - 1, now)).toBe("too-old");
    expect(mhaClockMadeAtProblem(now + MHA_CLOCK_FUTURE_TOLERANCE_MS + 1, now)).toBe("future");
    expect(mhaClockMadeAtProblem(now + HOUR, now)).toBe("future");
    expect(mhaClockMadeAtProblem(new Date("2025-10-20T00:00:00Z").getTime(), now)).toBe("too-old");
  });

  it("accepts a Form 3A made 144 hours ago, the longest limit in the timeframe data", () => {
    const hours = timeframes.entries.map((entry) =>
      entry.duration.unit === "hours" ? entry.duration.value : Number.POSITIVE_INFINITY,
    );
    const longest = Math.max(...hours);
    expect(longest).toBe(144);
    const form3a = timeframes.entries.find((entry) => entry.formCodes.includes("3A") && entry.duration.value === 144);
    expect(form3a?.section).toBe("28");
    expect(mhaClockMadeAtProblem(now - 144 * HOUR, now)).toBeNull();
    // Every limit in the data still fits inside the window, so no running clock is refused.
    for (const value of hours) expect(value * HOUR).toBeLessThanOrEqual(MHA_CLOCK_MAX_PAST_MS);
  });
});
