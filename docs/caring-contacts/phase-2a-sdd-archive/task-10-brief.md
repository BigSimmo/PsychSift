### Task 10: Extend the storage contract and the in-memory store

`CaringContactRepository` is 16 methods and holds nothing about referrals, pathway versions, service state, assignment, dispatch reconciliation, notification preferences, training or retention. Every module from Group 1 needs a home.

**Files:**

- Modify: `src/lib/caring-contacts/repository.ts`
- Modify: `src/lib/caring-contacts/in-memory-repository.ts`
- Test: `tests/caring-contacts-repository.test.ts` (extend; the existing 16-method cases stay untouched)

**Interfaces — added to `CaringContactRepository`:**

```ts
// Referrals
createReferral(input: CreateReferralInput, context: WriteContext): Promise<TransitionResult<Referral>>;
transitionReferral(input: ReferralTransitionInput, context: WriteContext): Promise<TransitionResult<Referral>>;
listReferrals(context: ReadContext): Promise<Referral[]>;

// Pathway versions
savePathwayVersion(input: SavePathwayVersionInput, context: WriteContext): Promise<TransitionResult<PathwayVersion>>;
transitionPathwayVersion(input: PathwayVersionTransitionInput, context: WriteContext): Promise<TransitionResult<PathwayVersion>>;
getPathwayVersion(id: PathwayVersionId, context: ReadContext): Promise<PathwayVersion | null>;
listPathwayVersions(context: ReadContext): Promise<PathwayVersion[]>;

// Service state
getServiceState(context: ReadContext): Promise<ServiceState>;
stopService(input: { reason: ServiceStopReason; note: string }, context: WriteContext): Promise<TransitionResult<ServiceState>>;
approveServiceRestart(input: { role: ServiceRestartApprovalRole }, context: WriteContext): Promise<TransitionResult<ServiceState>>;

// Assignment
getAssignment(planId: PlanId, context: ReadContext): Promise<PlanAssignment | null>;
applyAssignment(input: { planId: PlanId; action: AssignmentAction }, context: WriteContext): Promise<TransitionResult<PlanAssignment>>;

// Reconciliation
listDispatches(input: { fromIso: string; toIso: string }, context: ReadContext): Promise<DispatchRecord[]>;
resolveDispatchDiscrepancy(input: ResolveDiscrepancyInput, context: WriteContext): Promise<TransitionResult<DispatchRecord>>;

// Access trail
recordAccess(record: AccessRecord): Promise<void>;
listAccessTrail(input: AccessTrailQuery, context: ReadContext): Promise<AuditEvent[]>;

// Preferences, training, retention
getNotificationPreferences(context: ReadContext): Promise<NotificationPreferences>;
saveNotificationPreferences(input: NotificationPreferences, context: WriteContext): Promise<TransitionResult<NotificationPreferences>>;
getTrainingRecord(context: ReadContext): Promise<TrainingRecord>;
recordTrainingCompetency(input: { competency: TrainingCompetency }, context: WriteContext): Promise<TransitionResult<TrainingRecord>>;
markRetentionCleared(input: { planId: PlanId }, context: WriteContext): Promise<TransitionResult<void>>;
```

Supporting types to add to `repository.ts`:

```ts
export type CreateReferralInput = { referralId: ReferralId; patientId: PatientId };
export type ReferralTransitionInput = { referralId: ReferralId; action: ReferralAction };
export type SavePathwayVersionInput = { version: PathwayVersion };
export type PathwayVersionTransitionInput = { pathwayVersionId: PathwayVersionId; action: PathwayVersionAction };
export type DispatchRecord = {
  contactId: ContactId;
  planId: PlanId;
  attempt: number;
  startedAt: Date;
  expectedStatus: ProviderStatus | null;
  reportedStatus: ProviderStatus | null;
  discrepancyResolvedAt: Date | null;
  discrepancyResolution: DispatchDiscrepancyResolution | null;
};
export type DispatchDiscrepancyResolution = "confirmedDelivered" | "confirmedNotDelivered" | "unresolvedNoResend";
export type ResolveDiscrepancyInput = {
  contactId: ContactId;
  attempt: number;
  resolution: DispatchDiscrepancyResolution;
  note: string;
};
export type AccessTrailQuery = {
  fromIso?: string;
  toIso?: string;
  actorId?: ActorId;
  objectType?: AccessedObjectType;
  limit: number;
  offset: number;
};
```

`REPOSITORY_REFUSALS` gains `serviceStopped: "service-stopped"` and `trainingWorkspaceIsolated: "training-workspace-isolated"`.

**Two rules the store enforces, not the caller:**

1. **Every mutating method refuses `service-stopped` while a safety stop is active**, except `stopService`, `approveServiceRestart`, and `recordHospitalStatusEvent` (a death must always be recordable — the same reasoning as Phase 1 decision 5). Reads are unaffected (decision D).
2. **`resolveDispatchDiscrepancy` never resends.** `unresolvedNoResend` is a first-class outcome; there is no method that re-dispatches a contact whose status is uncertain.

- [ ] **Step 1: Write the failing test**

Append to `tests/caring-contacts-repository.test.ts` a suite that runs against `createInMemoryRepository`:

```ts
describe("workspace storage extension", () => {
  it("refuses every ordinary mutation while the service is stopped, and still accepts a death", async () => {
    const store = createInMemoryRepository(clock, {});
    const plan = await createActivePlan(store); // existing helper in this file

    const stop = await store.stopService(
      { reason: "wrong-recipient", note: "SYN-CONTACT-004 reached the wrong number." },
      writeContext(coordinator, "stop-1"),
    );
    expect(stop.ok).toBe(true);

    const paused = await store.pausePlan(
      { planId: plan.plan.id, expectedVersion: plan.plan.version },
      writeContext(coordinator, "pause-1"),
    );
    expect(paused).toEqual({ ok: false, reason: "service-stopped" });

    const death = await store.recordHospitalStatusEvent(
      { planId: plan.plan.id, expectedVersion: plan.plan.version, event: { type: "death", recordedAt: clock.now() } },
      writeContext(coordinator, "death-1"),
    );
    expect(death.ok).toBe(true);
  });

  it("still reads while the service is stopped", async () => {
    const store = createInMemoryRepository(clock, {});
    const plan = await createActivePlan(store);
    await store.stopService(
      { reason: "duplicate-send", note: "two sends on 2026-08-19" },
      writeContext(coordinator, "stop-2"),
    );
    await expect(store.getPlan(plan.plan.id, { actor: coordinator })).resolves.not.toBeNull();
  });

  it("records a view in the access trail that listAuditEvents never produced", async () => {
    const store = createInMemoryRepository(clock, {});
    const plan = await createActivePlan(store);
    await store.recordAccess({
      actorId: coordinator.id,
      actorRoles: ["coordinator"],
      teamId: coordinator.teamId,
      kind: "view",
      objectType: "plan",
      objectId: plan.plan.id,
      outcome: "allowed",
    });
    const trail = await store.listAccessTrail({ limit: 50, offset: 0 }, { actor: auditor });
    expect(trail.map((event) => event.action)).toContain("access:view:plan");
  });

  it("resolves a dispatch discrepancy without ever resending", async () => {
    const store = createInMemoryRepository(clock, {});
    const plan = await createActivePlan(store);
    const contact = (await store.listSendableContacts(plan.plan.id, { actor: coordinator }))[0];
    await store.startContactDispatch(
      { planId: plan.plan.id, contactId: contact.contact.id, expectedContactVersion: contact.contact.version },
      writeContext(dispatcher, "dispatch-1"),
    );

    const resolved = await store.resolveDispatchDiscrepancy(
      { contactId: contact.contact.id, attempt: 1, resolution: "unresolvedNoResend", note: "provider outage" },
      writeContext(coordinator, "resolve-1"),
    );
    if (!resolved.ok) throw new Error(resolved.reason);
    expect(resolved.value.discrepancyResolution).toBe("unresolvedNoResend");
    expect(Object.keys(store)).not.toContain("resendContact");
  });

  it("keeps the reassignment history readable after a reassignment", async () => {
    const store = createInMemoryRepository(clock, {});
    const plan = await createActivePlan(store);
    await store.applyAssignment(
      { planId: plan.plan.id, action: { type: "claim", actorId: coordinator.id } },
      writeContext(coordinator, "claim-1"),
    );
    await store.applyAssignment(
      { planId: plan.plan.id, action: { type: "reassign", toActorId: actorId("ACTOR-NEW"), reason: "annual leave" } },
      writeContext(teamLead, "reassign-1"),
    );
    const assignment = await store.getAssignment(plan.plan.id, { actor: coordinator });
    expect(assignment?.reassignmentHistory).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run and verify it fails** — the interface has no `stopService`.
- [ ] **Step 3: Extend `repository.ts`, then implement every added method in `in-memory-repository.ts`.** Keep the existing promise-queue serialisation and the `${teamId}::${key}` idempotency map; every new write goes through the same `runWrite` path so it audits in the same step, and the service-stop gate lives inside `runWrite` so no future method can forget it.
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line.
- [ ] **Step 5: Prove it can fail.** Move the service-stop gate out of `runWrite` and into `pausePlan` only → the first test still passes but a second mutation would slip; instead delete the gate entirely and confirm the first test goes red. Then delete the audit call from one new write and confirm the existing "no code path can write without an audit event" test goes red. Revert both.
- [ ] **Step 6: Commit**

```bash
git add src/lib/caring-contacts/repository.ts src/lib/caring-contacts/in-memory-repository.ts tests/caring-contacts-repository.test.ts
git commit -m "feat(caring-contacts): extend the storage contract for referrals, pathways, service state, assignment, reconciliation and access"
```

---
