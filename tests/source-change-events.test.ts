import { describe, expect, it } from "vitest";

import { isNamedPerson } from "@/lib/admin/rule-sign-off";
import { sourceAcquisitionRecords } from "@/lib/sources/acquisition-ledger";
import {
  confirmedSourceChangesAfter,
  parseSourceChangeRegister,
  sourceChangeEvents,
} from "@/lib/sources/source-change-events";

const event = {
  sourceId: "wa-monitored-medicines-prescribing-code",
  changedOn: "2026-11-14",
  summary: "Part 3 stimulant authorisation wording revised.",
  detectedBy: "source-watch",
  confirmedBy: "Dr Alex Morgan",
  confirmedOn: "2026-11-16",
};

describe("source change register", () => {
  it("names only register sources, confirmed by a named person, never before the change", () => {
    const ids = new Set(sourceAcquisitionRecords.map((record) => record.id));
    for (const entry of sourceChangeEvents) {
      expect(ids.has(entry.sourceId), `unknown register record ${entry.sourceId}`).toBe(true);
      expect(isNamedPerson(entry.confirmedBy), `confirmedBy must name a person: ${entry.confirmedBy}`).toBe(true);
      expect(entry.confirmedOn >= entry.changedOn, `${entry.sourceId} confirmed before it changed`).toBe(true);
    }
  });

  it("refuses a malformed register instead of dropping the entry", () => {
    expect(() =>
      parseSourceChangeRegister({ version: 1, note: "", events: [{ ...event, changedOn: "14/11/2026" }] }),
    ).toThrow();
    expect(() =>
      parseSourceChangeRegister({ version: 1, note: "", events: [{ ...event, confirmedBy: "" }] }),
    ).toThrow();
    expect(() => parseSourceChangeRegister({ version: 1, note: "", events: [{ ...event, extra: true }] })).toThrow();
    expect(() => parseSourceChangeRegister({ version: 2, note: "", events: [] })).toThrow();
    expect(parseSourceChangeRegister({ version: 1, note: "", events: [event] })).toHaveLength(1);
  });

  it("returns only changes to cited sources made after the review date", () => {
    const events = parseSourceChangeRegister({ version: 1, note: "", events: [event] });
    expect(confirmedSourceChangesAfter(["wa-monitored-medicines-prescribing-code"], "2026-05-01", events)).toHaveLength(
      1,
    );
    expect(confirmedSourceChangesAfter(["wa-monitored-medicines-prescribing-code"], "2026-11-14", events)).toHaveLength(
      0,
    );
    expect(confirmedSourceChangesAfter(["wa-monitored-medicines-prescribing-code"], null, events)).toHaveLength(1);
    expect(confirmedSourceChangesAfter(["wa-health-scriptcheckwa"], null, events)).toHaveLength(0);
    expect(confirmedSourceChangesAfter([], null, events)).toHaveLength(0);
  });
});
