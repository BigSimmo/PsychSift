import { describe, expect, it } from "vitest";

import {
  PATIENT_CHECK_OFFLINE_MESSAGE,
  PATIENT_CHECK_UNAVAILABLE_MESSAGE,
  patientCheckUnavailableMessage,
} from "@/lib/patient-check-unavailable-copy";

// D26-11: offline, the old wording read as if the question had broken the patient-detail rule.
describe("patientCheckUnavailableMessage", () => {
  it("says offline plainly when there is no connection", () => {
    expect(patientCheckUnavailableMessage(false)).toBe(PATIENT_CHECK_OFFLINE_MESSAGE);
    expect(PATIENT_CHECK_OFFLINE_MESSAGE).not.toMatch(/patient details/);
    expect(PATIENT_CHECK_OFFLINE_MESSAGE).toMatch(/nothing was sent/);
  });

  it("keeps the check wording when online but the check could not load", () => {
    expect(patientCheckUnavailableMessage(true)).toBe(PATIENT_CHECK_UNAVAILABLE_MESSAGE);
  });
});
