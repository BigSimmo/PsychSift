import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { detectOwnConflicts } from "@/lib/roster/shifts/conflicts";
import { diffRoster } from "@/lib/roster/shifts/diff";
import type { OnCallShiftInput } from "@/lib/roster/shifts/model";
import { perthWallToIso } from "@/lib/roster/shifts/perth-time";
import { checkManualShiftConflicts } from "@/lib/roster/shifts/repository";

function shift(
  date: string,
  start: string,
  end: string,
  title = "Registrar on call",
  endDate = end <= start ? nextDay(date) : date,
): OnCallShiftInput {
  return {
    startsAt: perthWallToIso(date, start)!,
    endsAt: perthWallToIso(endDate, end)!,
    title,
    location: "Example Hospital",
    sourceUid: null,
  };
}

function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return utc.toISOString().slice(0, 10);
}

describe("Roster own-shift double-booking conflict detector (#MS6VXW)", () => {
  it("detects strictly overlapping shifts and orders conflicts deterministically by start time", () => {
    const morning = shift("2026-10-05", "08:00", "16:30", "Ward cover");
    const afternoon = shift("2026-10-05", "14:00", "22:00", "ED consults");
    const conflicts = detectOwnConflicts([afternoon, morning]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      first: {
        startsAt: morning.startsAt,
        endsAt: morning.endsAt,
        title: "Ward cover",
        location: "Example Hospital",
      },
      second: {
        startsAt: afternoon.startsAt,
        endsAt: afternoon.endsAt,
        title: "ED consults",
        location: "Example Hospital",
      },
    });
  });

  it("does not flag adjacent back-to-back shifts (08:00-16:00 and 16:00-22:00)", () => {
    const first = shift("2026-10-05", "08:00", "16:00", "Day shift");
    const second = shift("2026-10-05", "16:00", "22:00", "Evening shift");
    expect(detectOwnConflicts([first, second])).toEqual([]);
  });

  it("detects an overnight shift overlapping a next-morning shift", () => {
    const night = shift("2026-10-05", "21:00", "08:30", "Night registrar", "2026-10-06");
    const nextMorning = shift("2026-10-06", "08:00", "16:30", "Morning ward round");
    const conflicts = detectOwnConflicts([night, nextMorning]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.first.title).toBe("Night registrar");
    expect(conflicts[0]?.second.title).toBe("Morning ward round");
  });

  it("surfaces own-shift conflicts on diffRoster as non-blocking warnings", () => {
    const window = { start: "2026-10-05", end: "2026-10-06" };
    const stored = [shift("2026-10-05", "08:00", "16:00", "Day shift")];
    const incoming = [
      shift("2026-10-05", "08:00", "16:30", "Day shift"),
      shift("2026-10-05", "16:00", "22:00", "Evening cover"),
    ];
    const diff = diffRoster(stored, incoming, window);

    expect(diff.added).toBe(1);
    expect(diff.changed).toBe(1);
    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0]?.first.title).toBe("Day shift");
    expect(diff.conflicts[0]?.second.title).toBe("Evening cover");
  });

  it("checks newly added manual shifts against stored owner shifts", async () => {
    const existingRow = {
      id: "shift-1",
      starts_at: perthWallToIso("2026-10-05", "08:00")!,
      ends_at: perthWallToIso("2026-10-05", "17:00")!,
      title: "Imported day shift",
      location: "Example Hospital",
      source_uid: null,
      kind: "day",
      workplace: "Example Hospital",
      source: "import",
      series_id: null,
    };
    const fakeClient = {
      from: vi.fn(() => {
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          gt: vi.fn(() => chain),
          lt: vi.fn(() => chain),
          order: vi.fn(() => chain),
          limit: vi.fn(async () => ({ data: [existingRow], error: null })),
        };
        return chain;
      }),
    };

    const manualShift = shift("2026-10-05", "15:00", "21:00", "Manual evening clinic");
    const conflicts = await checkManualShiftConflicts(
      fakeClient as unknown as Parameters<typeof checkManualShiftConflicts>[0],
      "owner-1",
      [manualShift],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.first.title).toBe("Imported day shift");
    expect(conflicts[0]?.second.title).toBe("Manual evening clinic");
  });

  it("returns [] without throwing RangeError when checkManualShiftConflicts receives invalid timestamps", async () => {
    const fakeClient = { from: vi.fn() };
    const result = await checkManualShiftConflicts(
      fakeClient as unknown as Parameters<typeof checkManualShiftConflicts>[0],
      "owner-1",
      [
        {
          startsAt: "not-a-valid-date",
          endsAt: "also-invalid",
          title: "Broken shift",
          location: null,
          sourceUid: null,
        },
      ],
    );
    expect(result).toEqual([]);
    expect(fakeClient.from).not.toHaveBeenCalled();
  });
});
