// Synthetic calendar text only; no network.
import { describe, expect, it, vi } from "vitest";

// The doctor has chosen Sydney as their work zone on this phone. A calendar's own
// times must still read the same as they do on the server, which is always Perth.
vi.mock("@/lib/work-time/current-zone", () => ({ currentWorkTimeZone: () => "Australia/Sydney" }));

import { parseRosterIcs } from "@/lib/roster/shifts/parse-ics";

function calendar(start: string, end: string): string {
  return ["BEGIN:VCALENDAR", "BEGIN:VEVENT", start, end, "SUMMARY:Clinic", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}

describe("reading an .ics roster on a phone set to another work zone", () => {
  it("reads Perth-labelled, floating and unknown-zone times as Perth, not the work zone", () => {
    const perth = { startsAt: "2026-10-05T00:00:00.000Z", endsAt: "2026-10-05T09:00:00.000Z" };
    for (const [start, end] of [
      ["DTSTART;TZID=Australia/Perth:20261005T080000", "DTEND;TZID=Australia/Perth:20261005T170000"],
      ["DTSTART:20261005T080000", "DTEND:20261005T170000"],
      [
        'DTSTART;TZID="W. Australia Standard Time":20261005T080000',
        'DTEND;TZID="W. Australia Standard Time":20261005T170000',
      ],
      ["DTSTART;TZID=Not/AZone:20261005T080000", "DTEND;TZID=Not/AZone:20261005T170000"],
    ]) {
      expect(parseRosterIcs(calendar(start!, end!)).shifts[0]).toMatchObject(perth);
    }
  });

  it("reads a Windows eastern zone name as Sydney time", () => {
    // 08:00-17:00 AEDT (UTC+11) on Monday 5 October 2026.
    const result = parseRosterIcs(
      calendar(
        'DTSTART;TZID="AUS Eastern Standard Time":20261005T080000',
        'DTEND;TZID="AUS Eastern Standard Time":20261005T170000',
      ),
    );
    expect(result.shifts[0]).toMatchObject({
      startsAt: "2026-10-04T21:00:00.000Z",
      endsAt: "2026-10-05T06:00:00.000Z",
    });
  });
});
