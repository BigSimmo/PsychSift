import { describe, expect, it } from "vitest";

import { AuditEventContainsPatientDataError } from "@/lib/caring-contacts/audit";
import { accessActionName, buildAccessAuditEvent } from "@/lib/caring-contacts/access-audit";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { actorId, teamId } from "@/lib/caring-contacts/ids";

const clock = fixedClock("2026-08-19T02:00:00.000Z");
const base = {
  actorId: actorId("ACTOR-1"),
  actorRoles: ["coordinator"],
  teamId: teamId("TEAM-A"),
  outcome: "allowed" as const,
};

describe("access auditing", () => {
  it("names a view distinctly from a write", () => {
    expect(accessActionName("view", "plan")).toBe("access:view:plan");
    expect(accessActionName("search", "patientDirectory")).toBe("access:search:patientDirectory");
  });

  it("records a view through the one shared audit constructor", () => {
    const event = buildAccessAuditEvent({ ...base, kind: "view", objectType: "plan", objectId: "SYN-PLAN-001" }, clock);
    expect(event.action).toBe("access:view:plan");
    expect(event.objectId).toBe("SYN-PLAN-001");
    expect(event.outcome).toBe("allowed");
    expect(event.timestamp).toContain("+08:00");
  });

  it("records a denied view rather than dropping it", () => {
    const event = buildAccessAuditEvent(
      { ...base, kind: "view", objectType: "episode", objectId: "SYN-PLAN-009", outcome: "denied" },
      clock,
    );
    expect(event.outcome).toBe("denied");
  });

  it("refuses to let patient data reach the trail", () => {
    expect(() =>
      buildAccessAuditEvent(
        { ...base, kind: "search", objectType: "patientDirectory", objectId: "Rowan Sample +61 491 570 156" },
        clock,
      ),
    ).toThrow(AuditEventContainsPatientDataError);
  });

  it("refuses a patient name with no digits in it, not only a phone number", () => {
    expect(() =>
      buildAccessAuditEvent(
        { ...base, kind: "search", objectType: "patientDirectory", objectId: "Rowan Whitlock" },
        clock,
      ),
    ).toThrow(AuditEventContainsPatientDataError);
  });

  it("accepts every identifier shape this domain actually mints", () => {
    const legitimateObjectIds = [
      "SYN-PLAN-001",
      "SYN-CONTACT-004",
      "demo-coordinator",
      "patientDirectory",
      "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    ];
    for (const objectId of legitimateObjectIds) {
      const event = buildAccessAuditEvent({ ...base, kind: "view", objectType: "plan", objectId }, clock);
      expect(event.objectId).toBe(objectId);
    }
  });
});
