import { describe, expect, it } from "vitest";

import { LEAVE_ENTITLEMENTS } from "@/lib/admin/leave-entitlements";
import { LEAVE_TYPES } from "@/lib/admin/leave-types";
import {
  isRosterLeaveKind,
  ROSTER_LEAVE_KIND_LABEL,
  ROSTER_LEAVE_KINDS,
  ROSTER_LEAVE_WALLET_CARD,
  rosterLeaveKindForCard,
} from "@/lib/roster/leave-kinds";
import { leaveWorkItems } from "@/lib/work-search/items";

describe("Roster leave kinds", () => {
  it("holds annual, conference or PD, exam and personal leave, each with a name", () => {
    expect(ROSTER_LEAVE_KINDS).toEqual(["annual", "pd_leave", "exam", "personal"]);
    expect(ROSTER_LEAVE_KIND_LABEL).toEqual({
      annual: "Annual leave",
      pd_leave: "Conference or PD leave",
      exam: "Exam leave",
      personal: "Personal leave",
    });
  });

  it("pairs every kind with a Leave wallet card that carries signed-off lines, each with a clause", () => {
    for (const kind of ROSTER_LEAVE_KINDS) {
      const card = ROSTER_LEAVE_WALLET_CARD[kind];
      expect(rosterLeaveKindForCard(card)).toBe(kind);
      const lines = LEAVE_ENTITLEMENTS[card].flatMap((group) => group.lines);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line.clause).toMatch(/\S/);
    }
  });

  it("links exactly the wallet cards Roster holds to Roster, starting on their own kind", () => {
    for (const type of LEAVE_TYPES) {
      const kind = rosterLeaveKindForCard(type.id);
      expect(type.rosterHref).toBe(kind ? `/roster/requests?start=leave&kind=${kind}` : undefined);
    }
  });

  it("refuses anything else, including a reason-like kind", () => {
    expect(isRosterLeaveKind("exam")).toBe(true);
    expect(isRosterLeaveKind("sick")).toBe(false);
    expect(isRosterLeaveKind("conference")).toBe(false);
    expect(isRosterLeaveKind(null)).toBe(false);
  });

  it("names exam and personal leave in work search, with the words a doctor would type", () => {
    const [exam, personal] = leaveWorkItems([
      { id: "e", kind: "exam", startsOn: "2026-11-09", endsOn: "2026-11-10", status: "planned", serviceId: null },
      { id: "p", kind: "personal", startsOn: "2026-11-12", endsOn: "2026-11-12", status: "applied", serviceId: null },
    ]);
    expect(exam).toMatchObject({ title: "Exam leave", kind: "leave" });
    expect(exam!.tags).toContain("exam");
    expect(personal).toMatchObject({ title: "Personal leave", kind: "leave" });
    expect(personal!.tags).toContain("sick leave");
  });
});
