import { describe, expect, it } from "vitest";

import { adminFreeTextProblem } from "@/lib/on-call/free-text-guard";

describe("the server refuses patient identifiers in Admin's free text (spec review 11)", () => {
  it("accepts a note that says where the proof is", () => {
    expect(
      adminFreeTextProblem({
        section: "logistics",
        title: "Registration",
        details: { category: "Registration", proofNote: "Email from Ahpra, 3 Oct" },
      }),
    ).toBeNull();
    expect(adminFreeTextProblem({ section: "logistics", title: "Pay", details: { category: "Pay" } })).toBeNull();
  });

  it("refuses a note that looks like a record number, a date of birth or an email address", () => {
    for (const proofNote of ["MRN: 1234567", "DOB: 01/02/1990", "jane.citizen@example.com"]) {
      expect(
        adminFreeTextProblem({
          section: "logistics",
          title: "Registration",
          details: { category: "Registration", proofNote },
        }),
      ).toBe("Keep patient details out of Admin records. Say where your proof is, for example: email from Ahpra.");
    }
  });

  it("refuses identifiers in Quick Add names and Help title, subtitle and body", () => {
    for (const field of ["title", "subtitle", "body"] as const) {
      expect(
        adminFreeTextProblem({
          section: "logistics",
          title: "Guide",
          details: { category: "Pay" },
          [field]: "MRN: 1234567",
        }),
      ).not.toBeNull();
    }
    expect(
      adminFreeTextProblem({ section: "contacts", title: "Workforce", details: { role: "MRN: 1234567" } }),
    ).not.toBeNull();
  });

  const sections = [
    "escalation",
    "ward",
    "logistics",
    "contacts",
    "handover",
    "notes",
    "playbook",
    "referrals",
    "orientation",
    "education",
  ] as const;

  const piiCanaries = [
    ["Medicare number", "2345 67890 1"],
    ["UMRN/MRN", "UMRN A1234567"],
    ["bare WA UMRN", "A1234567"],
    ["DOB with colon", "DOB: 14/03/1985"],
    ["DOB without colon", "DOB 14/03/1985"],
    ["phone/name pattern", "Patient: Jane Citizen (0412 345 678)"],
  ] as const;

  it.each(sections)("refuses synthetic PII canaries across section %s (title, body, and nested details)", (section) => {
    for (const [, canary] of piiCanaries) {
      expect(
        adminFreeTextProblem({
          section,
          title: `Operational note ${canary}`,
          details: {},
        }),
      ).not.toBeNull();

      expect(
        adminFreeTextProblem({
          section,
          title: "Safe title",
          body: `Handover context: ${canary}`,
          details: {},
        }),
      ).not.toBeNull();

      expect(
        adminFreeTextProblem({
          section,
          title: "Safe title",
          details: {
            escalationSteps: [{ order: 1, whoToCall: "Registrar", when: canary }],
            accepts: ["General adult", canary],
          },
        }),
      ).not.toBeNull();
    }

    expect(
      adminFreeTextProblem({
        section,
        title: "After-hours escalation pathway",
        subtitle: "Page duty registrar via switchboard ext 4400",
        body: "Policy reviewed 15/06/2018. Call inpatient coordinator before bed transfer.",
        details: {
          escalationSteps: [{ order: 1, whoToCall: "Duty Registrar", when: "Immediate" }],
          accepts: ["Voluntary inpatient referrals"],
        },
      }),
    ).toBeNull();
  });

  it("handles circular references and deeply nested details without throwing RangeError", () => {
    const circular: Record<string, unknown> = { label: "Policy effective 15/06/2018" };
    circular.self = circular;
    expect(
      adminFreeTextProblem({
        section: "orientation",
        title: "Ward handbook",
        details: circular,
      }),
    ).toBeNull();

    let deep: Record<string, unknown> = { leaf: "MRN: 1234567" };
    for (let i = 0; i < 20; i++) {
      deep = { child: deep };
    }
    expect(() =>
      adminFreeTextProblem({
        section: "notes",
        title: "Deep object",
        details: deep,
      }),
    ).not.toThrow();
  });
});
