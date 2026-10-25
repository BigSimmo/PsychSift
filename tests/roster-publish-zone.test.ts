import { expect, it, vi } from "vitest";

const work = vi.hoisted(() => ({ zone: "Australia/Sydney" }));
vi.mock("@/lib/work-time/current-zone", () => ({ currentWorkTimeZone: () => work.zone }));

import { buildPublishPayload, type RosterPublishRow } from "@/lib/roster/publish/build";

// Synthetic rows only. The server and the database count a publish period in Perth dates, so the
// browser must too, even when the manager's work zone is Sydney.
const period = { start: "2026-10-01", end: "2026-10-31" };
const row = (startsAt: string, endsAt: string): RosterPublishRow => ({
  rowName: "Jordan Example",
  userId: "5e000000-0000-4000-8000-000000000001",
  rosterName: null,
  siteId: null,
  startsAt,
  endsAt,
  shiftCode: "N",
  kind: "night",
  grade: "registrar",
});

it("refuses a shift on 1 October in Sydney that is still 30 September in Perth", () => {
  // 00:30 AEST on 1 October is 22:30 AWST on 30 September.
  expect(() =>
    buildPublishPayload({ period, sourceName: null, rows: [row("2026-09-30T14:30:00Z", "2026-09-30T22:30:00Z")] }),
  ).toThrow(/outside the chosen period/);
});

it("accepts a shift on 31 October in Perth that is already 1 November in Sydney", () => {
  // 23:30 AWST on 31 October is 02:30 AEDT on 1 November.
  const payload = buildPublishPayload({
    period,
    sourceName: null,
    rows: [row("2026-10-31T15:30:00Z", "2026-10-31T23:30:00Z")],
  });
  expect(payload.assignments).toHaveLength(1);
});
