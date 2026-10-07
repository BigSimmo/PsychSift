import { describe, expect, it } from "vitest";

import {
  checkLeaveMessage,
  EMPTY_LEAVE_FIELDS,
  LEAVE_AGREEMENT,
  LEAVE_TYPES,
  leaveFieldsHaveErrors,
  leaveMessage,
  leaveMessageGaps,
  leaveTypeById,
  leaveWalletSearchRecords,
  messageDate,
  validateLeaveFields,
} from "@/lib/admin/leave-types";

const annual = leaveTypeById("annual")!;
const confidential = leaveTypeById("confidential")!;

describe("leave wallet cards", () => {
  it("holds the eight leave types in the mockup's order", () => {
    expect(LEAVE_TYPES.map((type) => type.id)).toEqual([
      "annual",
      "personal",
      "exam",
      "conference",
      "compassionate",
      "confidential",
      "long-service",
      "parental",
    ]);
  });

  it("shows no entitlement figure anywhere and points to the agreement", () => {
    for (const type of LEAVE_TYPES) {
      const words = [
        type.front,
        type.fullName,
        type.line,
        ...type.steps.flatMap((step) => [step.text, step.hint ?? ""]),
      ].join(" ");
      expect(words).not.toMatch(/\d+\s*(?:days?|weeks?|hours?)/i);
    }
    expect(LEAVE_AGREEMENT.url).toMatch(/^https:\/\//);
  });

  it("keeps the confidential card's full name inside and its message plain", () => {
    expect(confidential.front).toBe("Confidential leave");
    expect(confidential.fullName).toBe("Family and domestic violence leave");
    const message = leaveMessage(confidential, {
      ...EMPTY_LEAVE_FIELDS,
      firstDay: "2026-11-02",
      lastDay: "2026-11-04",
    });
    expect(message).toContain("confidential leave");
    expect(message).not.toMatch(/violence|domestic|family/i);
  });

  it("never offers the confidential card to search, by name or keyword", () => {
    const records = leaveWalletSearchRecords();
    const text = JSON.stringify(records).toLowerCase();
    expect(text).not.toContain("confidential");
    expect(text).not.toContain("violence");
    expect(records).toHaveLength(8);
  });
});

describe("ready messages", () => {
  it("shows gaps in square brackets until they are filled", () => {
    const empty = leaveMessage(annual, EMPTY_LEAVE_FIELDS);
    expect(leaveMessageGaps(empty)).toBe(2);
    const filled = leaveMessage(annual, { ...EMPTY_LEAVE_FIELDS, firstDay: "2026-11-09", lastDay: "2026-11-13" });
    expect(filled).toContain("from Mon 9 Nov to Fri 13 Nov");
    expect(leaveMessageGaps(filled)).toBe(0);
  });

  it("says one day once when the first and last day match", () => {
    expect(leaveMessage(annual, { ...EMPTY_LEAVE_FIELDS, firstDay: "2026-10-10", lastDay: "2026-10-10" })).toContain(
      "annual leave on Sat 10 Oct.",
    );
  });

  it("names the contract end on the parental message, with no year", () => {
    const message = leaveMessage(
      leaveTypeById("parental")!,
      { ...EMPTY_LEAVE_FIELDS, firstDay: "2027-03-01" },
      {
        contractEndsOn: "2027-01-31",
      },
    );
    expect(message).toContain("from about Mon 1 Mar");
    expect(message).toContain("which ends on Sun 31 Jan");
    expect(message).not.toMatch(/20\d\d/);
  });

  it("drops the year from message dates", () => {
    expect(messageDate("2026-12-21")).toBe("Mon 21 Dec");
  });
});

describe("checks before Copy", () => {
  it("refuses a last day before the first day", () => {
    const errors = validateLeaveFields(leaveTypeById("exam")!, {
      ...EMPTY_LEAVE_FIELDS,
      firstDay: "2026-11-10",
      lastDay: "2026-11-09",
    });
    expect(errors.lastDay).toBe("Last day is before the first day.");
    expect(leaveFieldsHaveErrors(errors)).toBe(true);
  });

  it("catches a patient detail in the free detail field", () => {
    const errors = validateLeaveFields(leaveTypeById("conference")!, { ...EMPTY_LEAVE_FIELDS, detail: "MRN 1234567" });
    expect(errors.detailProblem).toBeTruthy();
  });

  it("catches a record number typed into an edited message, ignoring the gaps", () => {
    expect(checkLeaveMessage("Hi,\n\nI am unwell. Patient UMRN 7654321 needs handover.")).toBeTruthy();
    expect(checkLeaveMessage(leaveMessage(annual, EMPTY_LEAVE_FIELDS))).toBeNull();
    // Hidden by invisible or full-width characters, or written as words.
    expect(checkLeaveMessage("Hi,\n\nCover for UR１２３４５６７ please.")).toBeTruthy();
    expect(checkLeaveMessage("Hi,\n\nMrs\u200BSmith needs handover.")).toBeTruthy();
    expect(checkLeaveMessage("Hi,\n\nThe 45 year old woman in bed twelve needs review.")).toBeTruthy();
    expect(checkLeaveMessage("Hi,\n\nI have an RDO and the ALS course at RPH.")).toBeNull();
  });
});
