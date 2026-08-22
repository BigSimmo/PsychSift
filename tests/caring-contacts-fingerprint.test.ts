// tests/caring-contacts-fingerprint.test.ts
//
// The idempotency fingerprint is the one value both stores persist verbatim, and the input it is
// computed over carries patient detail (`createPlan`'s `patientDetail`) and responder free text
// (`stopService`'s and `resolveDispatchDiscrepancy`'s notes). So the fingerprint has exactly two
// obligations, and they pull in opposite directions:
//
//   * it must still distinguish a genuine replay from a key reused for a different write, which is
//     an equality question and nothing more;
//   * it must not carry the request's contents anywhere, because the store writes it into a row a
//     whole team can read.
//
// Both are asserted here rather than only through a store, because a store test can only observe
// the value that reaches a table -- it cannot show that two different requests still fingerprint
// differently once the value is opaque.
import { describe, expect, it } from "vitest";

import { fingerprintOf } from "@/lib/caring-contacts/fingerprint";

const PATIENT_DETAIL = {
  patientName: "Jordan Nguyen",
  patientMobileNumber: "+61 491 570 156",
  patientIdentifiers: ["UR-00219384"],
  culturalIdentity: null,
};

describe("fingerprintOf", () => {
  it("carries none of its input's text, so a fingerprint row cannot be read back as patient detail", () => {
    const fingerprint = fingerprintOf({ method: "createPlan", input: { patientDetail: PATIENT_DETAIL } });

    // Positive control: something was computed at all, so the absences below mean something.
    expect(fingerprint.length).toBeGreaterThan(0);

    expect(fingerprint).not.toContain("Jordan");
    expect(fingerprint).not.toContain("Nguyen");
    expect(fingerprint).not.toContain("491 570 156");
    expect(fingerprint).not.toContain("UR-00219384");
    expect(fingerprint).not.toContain("patientName");
  });

  it("carries none of a responder's incident note, which the domain labels patient data", () => {
    const note = "Message went to Jordan's old number, 0491 570 156, at 09:12";
    const fingerprint = fingerprintOf({ method: "stopService", input: { reason: "wrong-recipient", note } });

    expect(fingerprint.length).toBeGreaterThan(0);
    expect(fingerprint).not.toContain("Jordan");
    expect(fingerprint).not.toContain("570 156");
    expect(fingerprint).not.toContain("wrong-recipient");
  });

  it("is a fixed-width opaque digest rather than a rendering of the request", () => {
    const small = fingerprintOf({ method: "a", input: 1 });
    const large = fingerprintOf({
      method: "createPlan",
      input: { patientDetail: PATIENT_DETAIL, extra: "x".repeat(500) },
    });

    expect(small).toMatch(/^[0-9a-f]{64}$/);
    expect(large).toHaveLength(small.length);
  });

  // The replay semantics the stores depend on. Equality is the ONLY comparison either store makes
  // on this value, so these four cases are the whole contract.
  it("is stable, order-independent, and drops undefined entries", () => {
    expect(fingerprintOf({ a: 1, b: 2 })).toBe(fingerprintOf({ b: 2, a: 1 }));
    expect(fingerprintOf({ a: 1, b: undefined })).toBe(fingerprintOf({ a: 1 }));
    expect(fingerprintOf({ at: new Date("2026-03-02T02:00:00.000Z") })).toBe(
      fingerprintOf({ at: new Date("2026-03-02T02:00:00.000Z") }),
    );
    expect(fingerprintOf({ list: [1, 2] })).toBe(fingerprintOf({ list: [1, 2] }));
  });

  it("separates two different requests, including ones that differ only in type or in method", () => {
    expect(fingerprintOf({ method: "createPlan", input: 1 })).not.toBe(
      fingerprintOf({ method: "activatePlan", input: 1 }),
    );
    expect(fingerprintOf({ list: [1, 2] })).not.toBe(fingerprintOf({ list: [2, 1] }));
    expect(fingerprintOf({ value: 1 })).not.toBe(fingerprintOf({ value: "1" }));
    expect(fingerprintOf({ patientDetail: PATIENT_DETAIL })).not.toBe(
      fingerprintOf({ patientDetail: { ...PATIENT_DETAIL, patientMobileNumber: "+61 491 570 157" } }),
    );
    expect(fingerprintOf(null)).not.toBe(fingerprintOf(undefined));
  });
});
