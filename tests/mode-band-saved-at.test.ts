import { describe, expect, it } from "vitest";

import { savedAtLabel } from "@/components/mode-band/mode-band";

describe("mode band save time", () => {
  const now = new Date("2026-10-05T06:12:00Z"); // 14:12 Monday in Perth

  it("shows the 24-hour Perth time for a save today", () => {
    expect(savedAtLabel(new Date("2026-10-05T06:12:00Z"), now)).toBe("14:12");
    expect(savedAtLabel(new Date("2026-10-04T16:05:00Z"), now)).toBe("00:05");
  });

  it("adds the date for an earlier day, by the Perth calendar", () => {
    expect(savedAtLabel(new Date("2026-10-04T15:59:00Z"), now)).toBe("4 Oct 23:59");
  });
});
