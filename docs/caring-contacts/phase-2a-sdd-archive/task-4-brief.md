### Task 4: Pathway versions and dual approval

Spec §4.2: draft, review, dual approval with named approvers and timestamps, publication, retirement, immutable version snapshots. Active plans keep their snapshot; an urgent safety retirement pauses affected future contacts for explicit review.

`model.ts` already declares `PathwayVersionState = "draft" | "inReview" | "approved" | "retired"` with **no** transition function, and `permissions.ts` already exports `canApproveOwnAuthoredVersion(authorId, approverId): CapabilityDecision` returning `{ allowed: false, reason: "self-approval-denied" }`, which nothing calls. This task gives both a home.

**Files:**

- Create: `src/lib/caring-contacts/pathway-versions.ts`
- Test: `tests/caring-contacts-pathway-versions.test.ts` (new)

**Interfaces:**

- Consumes: `PathwayVersionState`, `TransitionResult<T>` from `./model`; `ActorId`, `PathwayVersionId`, `TeamId` from `./ids`; `Clock` from `./clock`; `canApproveOwnAuthoredVersion` from `./permissions`.
- Produces:

```ts
export type PathwayApprovalRole = "clinicalProgrammeLead" | "livedExperienceRepresentative";
export type PathwayApproval = { role: PathwayApprovalRole; actorId: ActorId; approvedAt: string };
export type PathwayRetirementUrgency = "routine" | "urgentSafety";

export type PathwayVersion = {
  id: PathwayVersionId;
  teamId: TeamId;
  state: PathwayVersionState;
  authorId: ActorId;
  approvals: readonly PathwayApproval[];
  publishedAt: string | null;
  retiredAt: string | null;
  retirementUrgency: PathwayRetirementUrgency | null;
  snapshot: PathwayVersionSnapshot;
};

export type PathwayVersionSnapshot = Readonly<{
  cadenceLabels: readonly string[];
  messageTextByType: Readonly<Record<MessageType, string>>;
}>;

export type PathwayVersionAction =
  | { type: "submitForReview" }
  | { type: "approve"; role: PathwayApprovalRole; actorId: ActorId }
  | { type: "publish"; actorId: ActorId }
  | { type: "retire"; urgency: PathwayRetirementUrgency };

export const REQUIRED_PATHWAY_APPROVAL_ROLES: readonly PathwayApprovalRole[];
export function applyPathwayVersionTransition(
  version: PathwayVersion,
  action: PathwayVersionAction,
  clock: Clock,
): TransitionResult<PathwayVersion>;
export function retirementPausesFutureContacts(version: PathwayVersion): boolean;
```

**Rules to implement:**

1. `submitForReview` is legal only from `draft`; otherwise `pathway-not-draft`.
2. `approve` is legal only from `inReview`; otherwise `pathway-not-in-review`.
3. The author may never approve their own version — delegate to `canApproveOwnAuthoredVersion` and surface its `self-approval-denied` reason unchanged. Do not re-implement the check.
4. The same role approving twice is refused `pathway-approval-role-already-recorded`; the same actor approving in both roles is refused `pathway-approval-actor-already-recorded`.
5. The version becomes `approved` only when **both** `REQUIRED_PATHWAY_APPROVAL_ROLES` are recorded. One approval leaves it `inReview`.
6. `publish` is legal only from `approved`, sets `publishedAt`; otherwise `pathway-not-approved`.
7. `retire` is legal from `approved` only; otherwise `pathway-not-retirable`. It sets `retiredAt` and `retirementUrgency`.
8. `retirementPausesFutureContacts` is `true` only for a retired version whose urgency is `urgentSafety`. A routine retirement stops **new** activations and leaves running plans on their snapshot.
9. The `snapshot` object is frozen at construction and **never** mutated by any transition — an active plan keeps the words it was activated with.

- [ ] **Step 1: Write the failing test**

Create `tests/caring-contacts-pathway-versions.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { fixedClock } from "@/lib/caring-contacts/clock";
import { actorId, pathwayVersionId, teamId } from "@/lib/caring-contacts/ids";
import {
  REQUIRED_PATHWAY_APPROVAL_ROLES,
  applyPathwayVersionTransition,
  retirementPausesFutureContacts,
  type PathwayVersion,
} from "@/lib/caring-contacts/pathway-versions";

const clock = fixedClock("2026-08-19T02:00:00.000Z");
const AUTHOR = actorId("ACTOR-AUTHOR");

function draftVersion(): PathwayVersion {
  return {
    id: pathwayVersionId("SYN-PATHWAY-002"),
    teamId: teamId("TEAM-A"),
    state: "draft",
    authorId: AUTHOR,
    approvals: [],
    publishedAt: null,
    retiredAt: null,
    retirementUrgency: null,
    snapshot: Object.freeze({
      cadenceLabels: ["Day 1", "Week 1", "Month 1"],
      messageTextByType: Object.freeze({ standard: "s", first: "f", closing: "c" }),
    }),
  };
}

function advance(version: PathwayVersion, action: Parameters<typeof applyPathwayVersionTransition>[1]): PathwayVersion {
  const result = applyPathwayVersionTransition(version, action, clock);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.value;
}

describe("pathway version lifecycle", () => {
  it("needs both approval roles before it is approved", () => {
    let version = advance(draftVersion(), { type: "submitForReview" });
    expect(REQUIRED_PATHWAY_APPROVAL_ROLES).toHaveLength(2);

    version = advance(version, { type: "approve", role: "clinicalProgrammeLead", actorId: actorId("A") });
    expect(version.state).toBe("inReview");

    version = advance(version, { type: "approve", role: "livedExperienceRepresentative", actorId: actorId("B") });
    expect(version.state).toBe("approved");
    expect(version.approvals.map((approval) => approval.role)).toEqual([...REQUIRED_PATHWAY_APPROVAL_ROLES]);
  });

  it("refuses the author approving their own version, with the shared reason", () => {
    const inReview = advance(draftVersion(), { type: "submitForReview" });
    expect(
      applyPathwayVersionTransition(
        inReview,
        { type: "approve", role: "clinicalProgrammeLead", actorId: AUTHOR },
        clock,
      ),
    ).toEqual({ ok: false, reason: "self-approval-denied" });
  });

  it("refuses one person supplying both approvals", () => {
    let version = advance(draftVersion(), { type: "submitForReview" });
    version = advance(version, { type: "approve", role: "clinicalProgrammeLead", actorId: actorId("SOLO") });
    expect(
      applyPathwayVersionTransition(
        version,
        { type: "approve", role: "livedExperienceRepresentative", actorId: actorId("SOLO") },
        clock,
      ),
    ).toEqual({ ok: false, reason: "pathway-approval-actor-already-recorded" });
  });

  it("refuses publication before approval", () => {
    const inReview = advance(draftVersion(), { type: "submitForReview" });
    expect(applyPathwayVersionTransition(inReview, { type: "publish", actorId: actorId("A") }, clock)).toEqual({
      ok: false,
      reason: "pathway-not-approved",
    });
  });

  it("pauses future contacts only for an urgent safety retirement", () => {
    let version = advance(draftVersion(), { type: "submitForReview" });
    version = advance(version, { type: "approve", role: "clinicalProgrammeLead", actorId: actorId("A") });
    version = advance(version, { type: "approve", role: "livedExperienceRepresentative", actorId: actorId("B") });

    const routine = advance(version, { type: "retire", urgency: "routine" });
    expect(routine.state).toBe("retired");
    expect(retirementPausesFutureContacts(routine)).toBe(false);

    const urgent = advance(version, { type: "retire", urgency: "urgentSafety" });
    expect(retirementPausesFutureContacts(urgent)).toBe(true);
  });

  it("never mutates the snapshot an active plan depends on", () => {
    const original = draftVersion();
    const published = advance(
      advance(
        advance(advance(original, { type: "submitForReview" }), {
          type: "approve",
          role: "clinicalProgrammeLead",
          actorId: actorId("A"),
        }),
        { type: "approve", role: "livedExperienceRepresentative", actorId: actorId("B") },
      ),
      { type: "publish", actorId: actorId("A") },
    );
    expect(published.snapshot).toEqual(original.snapshot);
    expect(Object.isFrozen(published.snapshot)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:focused -- --files tests/caring-contacts-pathway-versions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pathway-versions.ts`** to the interface and rules above.

- [ ] **Step 4: Run the test and verify it passes.** Paste the `N passed` line.

- [ ] **Step 5: Prove the tests can fail.** Approve on the first approval instead of the second → the two-role test goes red. Remove the `canApproveOwnAuthoredVersion` call → the self-approval test goes red. Revert both.

- [ ] **Step 6: Commit**

```bash
git add src/lib/caring-contacts/pathway-versions.ts tests/caring-contacts-pathway-versions.test.ts
git commit -m "feat(caring-contacts): pathway version lifecycle with dual approval and urgent retirement"
```

---
