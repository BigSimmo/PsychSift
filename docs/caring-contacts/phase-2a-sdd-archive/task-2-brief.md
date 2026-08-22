### Task 2: Roles and actions for the work Phase 1 never implemented

`permissions.ts` today knows three human roles and 21 actions. Pathway dual approval needs two named approver roles that do not exist, and eight of the actions the new screens perform have no name. Deny-by-default means an unnamed action cannot be granted, so this is the gate everything else in Group 1 passes through.

**Files:**

- Modify: `src/lib/caring-contacts/permissions.ts`
- Test: `tests/caring-contacts-permissions.test.ts` (extend; do not rewrite existing cases)

**Interfaces:**

- Consumes: `Actor`, `SystemActor`, `CaringContactActor`, `Resource`, `CapabilityDecision`, `ROLE_ACTIONS`, `ALL_ACTIONS` from `permissions.ts`.
- Produces:
  - `CaringContactRole` gains `"clinicalProgrammeLead" | "livedExperienceRepresentative"`.
  - `CaringContactAction` gains `"createReferral" | "returnReferralForClarification" | "declineReferral" | "publishPathwayVersion" | "retirePathwayVersion" | "reconcileProviderDispatch" | "manageNotificationPreferences" | "enterTrainingMode" | "viewPatientRecord" | "coverCoordinator"`.
  - `ROLE_ACTIONS` gains entries for both new roles.

**Grant table to implement (exact):**

| Role                                  | Gains                                                                                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coordinator`                         | `createReferral`, `returnReferralForClarification`, `declineReferral`, `reconcileProviderDispatch`, `manageNotificationPreferences`, `enterTrainingMode`, `viewPatientRecord`                            |
| `teamLead`                            | everything the coordinator gains, plus `retirePathwayVersion` and `coverCoordinator`                                                                                                                     |
| `auditor`                             | `viewPatientRecord`, `manageNotificationPreferences`, `enterTrainingMode` — nothing else; the auditor keeps its read-only shape                                                                          |
| `clinicalProgrammeLead` (new)         | `approvePathwayVersion`, `publishPathwayVersion`, `retirePathwayVersion`, `approveServiceRestart`, `viewPatientRecord`, `manageNotificationPreferences`, `enterTrainingMode`, `triggerServiceSafetyStop` |
| `livedExperienceRepresentative` (new) | `approvePathwayVersion`, `viewPatientRecord`, `manageNotificationPreferences`, `enterTrainingMode`, `triggerServiceSafetyStop`                                                                           |

`triggerServiceSafetyStop` stays granted to **every** human role, including both new ones. Phase 1 decision 3 is deliberate: stopping the service must never be blocked by a permission check.

`publishPathwayVersion` is **not** granted to `teamLead`. Publication is the clinical act; the team lead approves and retires but does not publish.

- [ ] **Step 1: Write the failing test**

Append to `tests/caring-contacts-permissions.test.ts`:

```ts
describe("roles and actions added for the Phase 2 workspace", () => {
  const team = teamId("TEAM-A");
  const resource = { teamId: team };
  const withRoles = (...roles: CaringContactRole[]): Actor => ({
    id: actorId("ACTOR-1"),
    teamId: team,
    roles,
  });

  it("names every new action exactly once", () => {
    const added = [
      "createReferral",
      "returnReferralForClarification",
      "declineReferral",
      "publishPathwayVersion",
      "retirePathwayVersion",
      "reconcileProviderDispatch",
      "manageNotificationPreferences",
      "enterTrainingMode",
      "viewPatientRecord",
      "coverCoordinator",
    ] as const;
    for (const action of added) {
      expect(ALL_ACTIONS).toContain(action);
      expect(ALL_ACTIONS.filter((candidate) => candidate === action)).toHaveLength(1);
    }
  });

  it("gives both approval roles the power to approve a pathway version", () => {
    for (const role of ["clinicalProgrammeLead", "livedExperienceRepresentative"] as const) {
      expect(canPerformCaringContactAction(withRoles(role), "approvePathwayVersion", resource)).toEqual({
        allowed: true,
      });
    }
  });

  it("lets only the clinical programme lead publish a pathway version", () => {
    expect(
      canPerformCaringContactAction(withRoles("clinicalProgrammeLead"), "publishPathwayVersion", resource),
    ).toEqual({ allowed: true });
    for (const role of ["coordinator", "teamLead", "auditor", "livedExperienceRepresentative"] as const) {
      expect(canPerformCaringContactAction(withRoles(role), "publishPathwayVersion", resource)).toEqual({
        allowed: false,
        reason: "action-not-granted",
      });
    }
  });

  it("keeps the safety stop available to every human role", () => {
    for (const role of [
      "coordinator",
      "teamLead",
      "auditor",
      "clinicalProgrammeLead",
      "livedExperienceRepresentative",
    ] as const) {
      expect(canPerformCaringContactAction(withRoles(role), "triggerServiceSafetyStop", resource)).toEqual({
        allowed: true,
      });
    }
  });

  it("keeps the auditor read-only — it may never change a plan", () => {
    for (const action of [
      "createReferral",
      "publishPathwayVersion",
      "reconcileProviderDispatch",
      "coverCoordinator",
    ] as const) {
      expect(canPerformCaringContactAction(withRoles("auditor"), action, resource)).toEqual({
        allowed: false,
        reason: "action-not-granted",
      });
    }
  });

  it("still refuses a cross-team actor before it considers the action", () => {
    const outsider: Actor = { id: actorId("ACTOR-2"), teamId: teamId("TEAM-B"), roles: ["clinicalProgrammeLead"] };
    expect(canPerformCaringContactAction(outsider, "approvePathwayVersion", resource)).toEqual({
      allowed: false,
      reason: "cross-team-denied",
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:focused -- --files tests/caring-contacts-permissions.test.ts`
Expected: FAIL — TypeScript rejects `"clinicalProgrammeLead"` as a `CaringContactRole`.

- [ ] **Step 3: Extend the role and action registries**

In `src/lib/caring-contacts/permissions.ts`, add the two roles to `CaringContactRole`, add the ten action names to the action registry in registry order (append them; do not reorder the existing 21), and add the `ROLE_ACTIONS` entries from the grant table above. `UNGRANTED_ACTIONS` must stay a frozen empty array — every action a role can name is granted to at least one role, and the existing test that asserts this will catch a name with no home.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm run test:focused -- --files tests/caring-contacts-permissions.test.ts`
Expected: PASS. Paste the `N passed` line.

- [ ] **Step 5: Prove the tests can fail**

Grant `publishPathwayVersion` to `teamLead` and re-run. Expect the publication test to go red naming `teamLead`. Revert.

- [ ] **Step 6: Commit**

```bash
git add src/lib/caring-contacts/permissions.ts tests/caring-contacts-permissions.test.ts
git commit -m "feat(caring-contacts): name the approval roles and the ten actions the workspace performs"
```

---
