import { describe, expect, it } from "vitest";

import { calculateGsm7 } from "@/lib/caring-contacts/message-policy";
import {
  AUTOMATED_REPLY_GSM7,
  AUTOMATED_REPLY_RESPONSE,
  EXACT_MESSAGE_GSM7,
  EXACT_PATIENT_VISIBLE_MESSAGE,
  PATIENT_VISIBLE_NO_REPLY_NOTICE,
} from "@/lib/caring-contacts/message-copy";
import {
  DESIGNATED_FICTIONAL_MOBILE_NUMBERS,
  FICTIONAL_CONTACTS_BY_ROLE,
} from "@/lib/caring-contacts/synthetic-contacts";

describe("caring-contacts patient-visible copy", () => {
  it("keeps the pinned GSM-7 evidence for both patient-visible strings", () => {
    expect(EXACT_MESSAGE_GSM7).toEqual({ invalidCharacters: [], segments: 2, septets: 252, valid: true });
    expect(AUTOMATED_REPLY_GSM7).toEqual({ invalidCharacters: [], segments: 2, septets: 218, valid: true });
  });

  it("derives its evidence from the single domain GSM-7 calculator", () => {
    expect(EXACT_MESSAGE_GSM7).toEqual(calculateGsm7(EXACT_PATIENT_VISIBLE_MESSAGE));
    expect(AUTOMATED_REPLY_GSM7).toEqual(calculateGsm7(AUTOMATED_REPLY_RESPONSE));
  });

  it("names the staffed line and crisis support in both strings and neither patient mobile", () => {
    for (const text of [EXACT_PATIENT_VISIBLE_MESSAGE, AUTOMATED_REPLY_RESPONSE]) {
      expect(text).toContain(FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine);
      expect(text).toContain(FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact);
      expect(text).not.toContain(FICTIONAL_CONTACTS_BY_ROLE.rowanPatientMobile);
      expect(text).not.toContain(FICTIONAL_CONTACTS_BY_ROLE.miraPatientMobile);
    }
  });

  it("states only that nobody reads replies, never that replies are not received", () => {
    expect(EXACT_PATIENT_VISIBLE_MESSAGE).toContain(PATIENT_VISIBLE_NO_REPLY_NOTICE);
    expect(PATIENT_VISIBLE_NO_REPLY_NOTICE).toBe("No one reads replies to this number");
    for (const text of [EXACT_PATIENT_VISIBLE_MESSAGE, AUTOMATED_REPLY_RESPONSE]) {
      expect(text).not.toMatch(/replies are not received|we monitor|monitored/i);
    }
  });

  it("uses four distinct reserved fictional numbers", () => {
    expect(new Set(DESIGNATED_FICTIONAL_MOBILE_NUMBERS).size).toBe(4);
    expect(DESIGNATED_FICTIONAL_MOBILE_NUMBERS).toHaveLength(4);
  });
});
