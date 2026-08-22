### Task 8: Auditing a view, not only a write

This is Phase 1 open item 1 and the reason spec §4.2's auditor access trail is currently only half satisfiable. `buildAuditEvent` is called exclusively inside `runWrite` in both stores, and the database's `require_audit` trigger is attached only to write tables. The decision lock requires "every search, view, decision, mutation, write-back and administrative access" in the trail.

The domain half is this task: a typed access event that cannot carry patient data. The enforcement half — every read path actually emitting one — lands at the API boundary in Task 14, because that is the only place a read is observable.

**Files:**

- Create: `src/lib/caring-contacts/access-audit.ts`
- Test: `tests/caring-contacts-access-audit.test.ts` (new)

**Interfaces:**

- Consumes: `AuditEvent`, `AuditOutcome`, `assertAuditEventFreeOfPatientData`, `buildAuditEvent` from `./audit`; `Clock` from `./clock`; `ActorId`, `TeamId`, `IdempotencyKey` from `./ids`.
- Produces:

```ts
export type AccessKind = "view" | "search" | "export" | "administrative";
export type AccessedObjectType = "plan" | "contact" | "episode" | "auditTrail" | "report" | "patientDirectory";

export type AccessRecord = {
  actorId: ActorId;
  actorRoles: readonly string[];
  teamId: TeamId;
  kind: AccessKind;
  objectType: AccessedObjectType;
  objectId: string;
  outcome: AuditOutcome;
};

export const ACCESS_ACTION_PREFIX: "access";
export function accessActionName(kind: AccessKind, objectType: AccessedObjectType): string;
export function buildAccessAuditEvent(record: AccessRecord, clock: Clock): AuditEvent;
```

**Rules:** `accessActionName` produces `access:<kind>:<objectType>` so a trail can be filtered to reads without a second table. `buildAccessAuditEvent` delegates to `buildAuditEvent` so there is exactly one audit-event constructor, supplies a deterministic idempotency key of the form `access:<actorId>:<objectType>:<objectId>:<timestamp>`, and runs `assertAuditEventFreeOfPatientData` — a search term or a patient name reaching the trail must throw `AuditEventContainsPatientDataError`, not be written.

- [ ] **Step 1: Write the failing test**

```ts
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
});
```

- [ ] **Step 2: Run and verify it fails.**
- [ ] **Step 3: Implement `access-audit.ts`.** If the mobile-number scan in `audit.ts` does not already reject the fourth test's `objectId`, extend `assertAuditEventFreeOfPatientData`'s value scan rather than adding a second scanner here.
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line.
- [ ] **Step 5: Prove it can fail.** Remove the `assertAuditEventFreeOfPatientData` call → the fourth test goes red. Revert.
- [ ] **Step 6: Commit**

```bash
git add src/lib/caring-contacts/access-audit.ts tests/caring-contacts-access-audit.test.ts
git commit -m "feat(caring-contacts): typed access-audit events so views can enter the trail"
```

---
