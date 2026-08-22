// tests/caring-contacts-audit.test.ts
import { describe, expect, it } from "vitest";

import {
  assertAuditEventFreeOfPatientData,
  buildAuditEvent,
  type AuditableChange,
  type AuditEvent,
} from "@/lib/caring-contacts/audit";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { actorId, idempotencyKey, teamId } from "@/lib/caring-contacts/ids";

const CLOCK = fixedClock("2026-08-19T02:00:00.000Z"); // 10:00 AWST

function baseChange(overrides: Partial<AuditableChange> = {}): AuditableChange {
  return {
    actorId: actorId("ACTOR-1"),
    actorRoles: ["coordinator"],
    teamId: teamId("TEAM-1"),
    action: "activatePlan",
    objectType: "plan",
    objectId: "PLAN-1",
    outcome: "allowed",
    idempotencyKey: idempotencyKey("IDEMP-1"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Rule 1 — every event carries the required fields
// ---------------------------------------------------------------------------

describe("rule 1: required fields", () => {
  it("carries actor id, actor roles, team id, action, object type/id, outcome, timestamp, idempotency key", () => {
    const event = buildAuditEvent(baseChange(), CLOCK);

    expect(event.actorId).toBe("ACTOR-1");
    expect(event.actorRoles).toEqual(["coordinator"]);
    expect(event.teamId).toBe("TEAM-1");
    expect(event.action).toBe("activatePlan");
    expect(event.objectType).toBe("plan");
    expect(event.objectId).toBe("PLAN-1");
    expect(event.outcome).toBe("allowed");
    expect(event.idempotencyKey).toBe("IDEMP-1");
    expect(event.timestamp).toBe("2026-08-19T10:00:00.000+08:00");
  });

  it("produces an ISO timestamp with an explicit numeric offset, not a bare Z", () => {
    const event = buildAuditEvent(baseChange(), CLOCK);
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  });

  it("accepts every documented outcome", () => {
    for (const outcome of ["allowed", "denied", "failed"] as const) {
      const event = buildAuditEvent(baseChange({ outcome }), CLOCK);
      expect(event.outcome).toBe(outcome);
    }
  });

  it("is pure given a clock: the same input and clock always produce byte-identical output", () => {
    const first = buildAuditEvent(baseChange(), CLOCK);
    const second = buildAuditEvent(baseChange(), CLOCK);
    expect(first).toEqual(second);
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — never a mobile number, message body, or free clinical text
// ---------------------------------------------------------------------------

describe("rule 2: rejects patient data", () => {
  it.each([
    ["spaced +61 form", "+61 491 570 156"],
    ["unspaced +61 form", "+61491570156"],
    ["spaced 04xx local form", "0491 570 156"],
    ["unspaced 04xx local form", "0491570156"],
  ])("throws audit-event-contains-patient-data when the %s appears in any field", (_label, mobile) => {
    expect(() => buildAuditEvent(baseChange({ objectId: mobile }), CLOCK)).toThrow("audit-event-contains-patient-data");
    expect(() => buildAuditEvent(baseChange({ action: `note: call ${mobile}` }), CLOCK)).toThrow(
      "audit-event-contains-patient-data",
    );
  });

  it("scans array fields too: a mobile number hidden in actorRoles still throws", () => {
    expect(() => buildAuditEvent(baseChange({ actorRoles: ["coordinator", "0491570156"] }), CLOCK)).toThrow(
      "audit-event-contains-patient-data",
    );
  });

  it("throws on a forbidden field name even when its value is not a mobile number", () => {
    const withStrayField = { ...baseChange(), patientName: "Jordan Nguyen" } as unknown as AuditableChange;
    expect(() => buildAuditEvent(withStrayField, CLOCK)).toThrow("audit-event-contains-patient-data");
  });

  it("lets a caller supply a narrower or wider forbidden-field-name set", () => {
    // A field name outside the default denylist is allowed by default...
    expect(() => assertAuditEventFreeOfPatientData({ freeText: "no digits here" })).not.toThrow();
    // ...but throws once the caller configures it as forbidden.
    expect(() => assertAuditEventFreeOfPatientData({ freeText: "no digits here" }, ["freeText"])).toThrow(
      "audit-event-contains-patient-data",
    );
  });

  it("does not throw for an ordinary event with no patient data anywhere", () => {
    expect(() => buildAuditEvent(baseChange(), CLOCK)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — frozen on construction
// ---------------------------------------------------------------------------

describe("rule 3: frozen on construction", () => {
  it("is frozen", () => {
    const event = buildAuditEvent(baseChange(), CLOCK);
    expect(Object.isFrozen(event)).toBe(true);
  });

  it("silently ignores (non-strict) or throws (strict) a mutation attempt without changing the object", () => {
    const event: AuditEvent = buildAuditEvent(baseChange(), CLOCK);
    const before = { ...event };
    expect(() => {
      "use strict";
      (event as { outcome: string }).outcome = "denied";
    }).toThrow();
    expect(event).toEqual(before);
  });

  it("keeps actorRoles frozen too, so pushing to it does not change the event", () => {
    const event = buildAuditEvent(baseChange(), CLOCK);
    expect(Object.isFrozen(event.actorRoles)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — pure given a clock
// ---------------------------------------------------------------------------

describe("rule 4: pure given a clock", () => {
  it("draws its timestamp only from the clock it is handed, not the system clock", () => {
    const laterClock = fixedClock("2026-12-25T00:00:00.000Z");
    const event = buildAuditEvent(baseChange(), laterClock);
    expect(event.timestamp).toBe("2026-12-25T08:00:00.000+08:00");
  });

  it("does not mutate its input", () => {
    const input = baseChange();
    const inputCopy = { ...input, actorRoles: [...input.actorRoles] };
    buildAuditEvent(input, CLOCK);
    expect(input).toEqual(inputCopy);
  });
});
