### Task 3: Service safety stop

**Build this one at high reasoning effort.** A wrong transition here either fails to stop a service that is sending wrong messages, or lets one person restart a service that three people were required to agree on.

Spec §4.2: a confirmed wrong-recipient message, duplicate send, unauthorised content, material privacy or security incident, or loss of audit integrity immediately pauses the entire pilot. Restart requires recorded joint approval from the incident lead, the privacy/security owner and the clinical programme lead. **The interface must not permit a single-person restart.**

**Files:**

- Create: `src/lib/caring-contacts/service-state.ts`
- Test: `tests/caring-contacts-service-state.test.ts` (new)

**Interfaces:**

- Consumes: `ActorId`, `TeamId` from `./ids`; `Clock` from `./clock`; `TransitionResult<T>` from `./model`.
- Produces:

```ts
export type ServiceStopReason =
  | "wrong-recipient"
  | "duplicate-send"
  | "unauthorised-content"
  | "privacy-or-security-incident"
  | "audit-integrity-loss";

export type ServiceRestartApprovalRole = "incidentLead" | "privacySecurityOwner" | "clinicalProgrammeLead";

export type ServiceRestartApproval = { role: ServiceRestartApprovalRole; actorId: ActorId; approvedAt: string };

export type ServiceState =
  | { stopped: false; teamId: TeamId }
  | {
      stopped: true;
      teamId: TeamId;
      reason: ServiceStopReason;
      stoppedBy: ActorId;
      stoppedAt: string;
      note: string;
      restartApprovals: readonly ServiceRestartApproval[];
    };

export const SERVICE_STOP_REASONS: readonly ServiceStopReason[];
export const REQUIRED_RESTART_APPROVAL_ROLES: readonly ServiceRestartApprovalRole[];

export function runningService(teamId: TeamId): ServiceState;
export function applyServiceStop(
  state: ServiceState,
  input: { reason: ServiceStopReason; actorId: ActorId; note: string },
  clock: Clock,
): TransitionResult<ServiceState>;
export function applyServiceRestartApproval(
  state: ServiceState,
  input: { role: ServiceRestartApprovalRole; actorId: ActorId },
  clock: Clock,
): TransitionResult<ServiceState>;
export function serviceStopBlocksDispatch(state: ServiceState): boolean;
export function describeServiceStop(state: ServiceState): string | null;
```

**Rules to implement:**

1. A stop is accepted from a running service. Stopping an already-stopped service is refused with `service-already-stopped` — the first reason and actor are the record and must not be overwritten.
2. `note` must be non-blank; refuse `service-stop-note-required`. The categorised reason answers "what kind", the note answers "which one".
3. An approval on a running service is refused `service-not-stopped`.
4. The same role approving twice is refused `restart-approval-role-already-recorded`. The same **actor** approving in two different roles is refused `restart-approval-actor-already-recorded` — three approvals must mean three people.
5. The service restarts, returning `{ stopped: false }`, only on the approval that completes all three of `REQUIRED_RESTART_APPROVAL_ROLES`. Two approvals leave it stopped with the approvals recorded.
6. `serviceStopBlocksDispatch` is `true` exactly while stopped.
7. `describeServiceStop` returns a plain-words sentence naming the reason and how many of the three approvals are recorded, for the banner; `null` while running. It must never contain patient information.

- [ ] **Step 1: Write the failing test**

Create `tests/caring-contacts-service-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { fixedClock } from "@/lib/caring-contacts/clock";
import { actorId, teamId } from "@/lib/caring-contacts/ids";
import {
  REQUIRED_RESTART_APPROVAL_ROLES,
  applyServiceRestartApproval,
  applyServiceStop,
  describeServiceStop,
  runningService,
  serviceStopBlocksDispatch,
  type ServiceState,
} from "@/lib/caring-contacts/service-state";

const clock = fixedClock("2026-08-19T02:00:00.000Z");
const team = teamId("TEAM-A");

function stoppedService(): ServiceState {
  const result = applyServiceStop(
    runningService(team),
    {
      reason: "wrong-recipient",
      actorId: actorId("ACTOR-STOP"),
      note: "Message SYN-CONTACT-004 reached the wrong number.",
    },
    clock,
  );
  if (!result.ok) throw new Error(`expected the stop to be accepted, got ${result.reason}`);
  return result.value;
}

describe("service safety stop", () => {
  it("stops the whole service and blocks dispatch", () => {
    const state = stoppedService();
    expect(state.stopped).toBe(true);
    expect(serviceStopBlocksDispatch(state)).toBe(true);
    expect(serviceStopBlocksDispatch(runningService(team))).toBe(false);
  });

  it("refuses a stop with no note", () => {
    expect(
      applyServiceStop(runningService(team), { reason: "duplicate-send", actorId: actorId("A"), note: "   " }, clock),
    ).toEqual({ ok: false, reason: "service-stop-note-required" });
  });

  it("never overwrites the first recorded stop", () => {
    expect(
      applyServiceStop(
        stoppedService(),
        { reason: "audit-integrity-loss", actorId: actorId("B"), note: "second" },
        clock,
      ),
    ).toEqual({ ok: false, reason: "service-already-stopped" });
  });

  it("requires all three approval roles before it restarts", () => {
    let state = stoppedService();
    const actors = ["ACTOR-INCIDENT", "ACTOR-PRIVACY", "ACTOR-CLINICAL"];

    REQUIRED_RESTART_APPROVAL_ROLES.forEach((role, index) => {
      const result = applyServiceRestartApproval(state, { role, actorId: actorId(actors[index]) }, clock);
      if (!result.ok) throw new Error(`approval ${role} refused: ${result.reason}`);
      state = result.value;
      const isLast = index === REQUIRED_RESTART_APPROVAL_ROLES.length - 1;
      expect(state.stopped).toBe(!isLast);
    });
  });

  it("refuses a single person supplying more than one approval", () => {
    const first = applyServiceRestartApproval(
      stoppedService(),
      { role: "incidentLead", actorId: actorId("SOLO") },
      clock,
    );
    if (!first.ok) throw new Error(first.reason);
    expect(
      applyServiceRestartApproval(first.value, { role: "privacySecurityOwner", actorId: actorId("SOLO") }, clock),
    ).toEqual({ ok: false, reason: "restart-approval-actor-already-recorded" });
  });

  it("refuses the same role approving twice", () => {
    const first = applyServiceRestartApproval(
      stoppedService(),
      { role: "incidentLead", actorId: actorId("ONE") },
      clock,
    );
    if (!first.ok) throw new Error(first.reason);
    expect(applyServiceRestartApproval(first.value, { role: "incidentLead", actorId: actorId("TWO") }, clock)).toEqual({
      ok: false,
      reason: "restart-approval-role-already-recorded",
    });
  });

  it("refuses an approval while the service is running", () => {
    expect(
      applyServiceRestartApproval(runningService(team), { role: "incidentLead", actorId: actorId("X") }, clock),
    ).toEqual({ ok: false, reason: "service-not-stopped" });
  });

  it("describes the stop in plain words with the approval count, and never mentions a patient", () => {
    const description = describeServiceStop(stoppedService());
    expect(description).toContain("0 of 3");
    expect(description).not.toMatch(/Rowan|Mira|\+61/);
    expect(describeServiceStop(runningService(team))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:focused -- --files tests/caring-contacts-service-state.test.ts`
Expected: FAIL — `Cannot find module '@/lib/caring-contacts/service-state'`.

- [ ] **Step 3: Implement `service-state.ts`**

Write the module to the interface above. Keep it a pure transition module: no ambient time (take the injected `Clock`), no storage, no permission checks — the caller has already asked `canPerformCaringContactAction`. Timestamps use the same AWST ISO form as `audit.ts` (`buildAuditEvent` produces `+08:00`); reuse `awstCalendarDay`/`toAwstParts` from `./clock` rather than inventing a second format.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm run test:focused -- --files tests/caring-contacts-service-state.test.ts`
Expected: PASS, 8 tests. Paste the `N passed` line.

- [ ] **Step 5: Prove the tests can fail — three separate mutations**

This module is the one most worth breaking on purpose. Run each mutation, confirm the named test goes red, then revert:

1. Restart after **two** approvals instead of three → "requires all three approval roles before it restarts" must fail.
2. Drop the same-actor check → "refuses a single person supplying more than one approval" must fail.
3. Make `serviceStopBlocksDispatch` always return `false` → "stops the whole service and blocks dispatch" must fail.

If any mutation leaves the suite green, the test is decorative and must be rewritten before this task counts as done.

- [ ] **Step 6: Commit**

```bash
git add src/lib/caring-contacts/service-state.ts tests/caring-contacts-service-state.test.ts
git commit -m "feat(caring-contacts): service safety stop with three-person restart approval"
```

---
