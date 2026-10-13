import { describe, expect, it } from "vitest";

import { savedLine } from "@/lib/offline-line";

const PERTH = "Australia/Perth";
// 12 Oct 2026, 19:02 in Perth (UTC+8).
const now = Date.parse("2026-10-12T11:30:00Z");

describe("savedLine", () => {
  it("names the Perth time of a copy saved today", () => {
    expect(savedLine({ savedAt: "2026-10-12T11:02:00Z", now, zone: PERTH })).toBe(
      "Offline, showing what was saved at 19:02",
    );
  });

  it("names the day of a copy from an earlier day, so a bare time never reads as today", () => {
    expect(savedLine({ savedAt: "2026-10-11T11:02:00Z", now, zone: PERTH })).toBe(
      "Offline, showing what was saved on Sun 11 Oct at 19:02",
    );
  });

  it("says a failed refresh is not lost signal", () => {
    expect(savedLine({ reason: "failed", savedAt: Date.parse("2026-10-12T11:02:00Z"), now, zone: PERTH })).toBe(
      "Couldn't refresh, showing what was saved at 19:02",
    );
  });

  it("never invents a time it does not know", () => {
    expect(savedLine({ savedAt: null, now, zone: PERTH })).toBe("Offline, showing what was saved earlier");
    expect(savedLine({ savedAt: "not a date", now, zone: PERTH })).toBe("Offline, showing what was saved earlier");
  });
});
