### Task 9: Notification preferences and training ownership

Two small modules batched into one task because each is a handful of pure functions and splitting them would make one agent rebuild the other's context. They commit separately.

Spec §4.2: alerts contain no patient identifiers and require authentication; per-user opt-in by alert class with a preview demonstrating the identifier-free alert body. Training mode never shares data with the live workspace.

**Files:**

- Create: `src/lib/caring-contacts/notification-preferences.ts`
- Create: `src/lib/caring-contacts/training.ts`
- Test: `tests/caring-contacts-notification-preferences.test.ts` (new)
- Test: `tests/caring-contacts-training.test.ts` (new)

**Interfaces:**

```ts
// notification-preferences.ts
export type AlertClass =
  "unclaimedWorkEscalation" | "permanentDeliveryFailure" | "serviceSafetyStop" | "exceptionBacklog" | "pathwayRetired";
export const ALERT_CLASSES: readonly AlertClass[];
export type NotificationPreferences = { actorId: ActorId; optedIn: readonly AlertClass[] };
export function defaultNotificationPreferences(actorId: ActorId): NotificationPreferences;
export function setAlertOptIn(
  preferences: NotificationPreferences,
  alertClass: AlertClass,
  optedIn: boolean,
): NotificationPreferences;
export function alertBodyFor(alertClass: AlertClass, count: number): string;

// training.ts
export type WorkspaceKind = "live" | "training";
export type TrainingCompetency =
  "identityReview" | "activation" | "withdrawal" | "deliveryFailure" | "readmission" | "downtime" | "incidentHandling";
export const TRAINING_COMPETENCIES: readonly TrainingCompetency[];
export type TrainingRecord = { actorId: ActorId; completed: readonly TrainingCompetency[] };
export function emptyTrainingRecord(actorId: ActorId): TrainingRecord;
export function recordCompetency(record: TrainingRecord, competency: TrainingCompetency): TrainingRecord;
export function trainingComplete(record: TrainingRecord): boolean;
export function workspacesMayShareData(a: WorkspaceKind, b: WorkspaceKind): boolean;
```

**Rules:** `defaultNotificationPreferences` opts in to **nothing** — opt-in, never opt-out. `alertBodyFor` returns a body containing the alert class in plain words and a count, and **never** a name, a mobile number, a patient id or a plan id; this is the identifier-free preview the spec demands. `TRAINING_COMPETENCIES` holds exactly the seven the decision lock names. `recordCompetency` is idempotent. `workspacesMayShareData` returns `true` only when both arguments are `"live"` — a training workspace shares with nothing, including another training workspace.

- [ ] **Step 1: Write the failing tests**

`tests/caring-contacts-notification-preferences.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { actorId } from "@/lib/caring-contacts/ids";
import {
  ALERT_CLASSES,
  alertBodyFor,
  defaultNotificationPreferences,
  setAlertOptIn,
} from "@/lib/caring-contacts/notification-preferences";

describe("notification preferences", () => {
  it("opts a new user in to nothing", () => {
    expect(defaultNotificationPreferences(actorId("A")).optedIn).toEqual([]);
  });

  it("adds and removes a single alert class without touching the others", () => {
    let preferences = defaultNotificationPreferences(actorId("A"));
    preferences = setAlertOptIn(preferences, "serviceSafetyStop", true);
    preferences = setAlertOptIn(preferences, "exceptionBacklog", true);
    preferences = setAlertOptIn(preferences, "serviceSafetyStop", false);
    expect(preferences.optedIn).toEqual(["exceptionBacklog"]);
  });

  it("writes an alert body carrying no identifier of any kind", () => {
    for (const alertClass of ALERT_CLASSES) {
      const body = alertBodyFor(alertClass, 3);
      expect(body).toContain("3");
      expect(body).not.toMatch(/SYN-|\+61|Rowan|Mira/);
    }
  });
});
```

`tests/caring-contacts-training.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { actorId } from "@/lib/caring-contacts/ids";
import {
  TRAINING_COMPETENCIES,
  emptyTrainingRecord,
  recordCompetency,
  trainingComplete,
  workspacesMayShareData,
} from "@/lib/caring-contacts/training";

describe("training mode", () => {
  it("names the seven required competencies", () => {
    expect(TRAINING_COMPETENCIES).toHaveLength(7);
    expect(new Set(TRAINING_COMPETENCIES).size).toBe(7);
  });

  it("is complete only when every competency is recorded", () => {
    let record = emptyTrainingRecord(actorId("A"));
    for (const competency of TRAINING_COMPETENCIES.slice(0, 6)) record = recordCompetency(record, competency);
    expect(trainingComplete(record)).toBe(false);
    record = recordCompetency(record, TRAINING_COMPETENCIES[6]);
    expect(trainingComplete(record)).toBe(true);
  });

  it("records a competency idempotently", () => {
    const once = recordCompetency(emptyTrainingRecord(actorId("A")), "activation");
    expect(recordCompetency(once, "activation").completed).toEqual(["activation"]);
  });

  it("never lets training data join a live query", () => {
    expect(workspacesMayShareData("live", "live")).toBe(true);
    expect(workspacesMayShareData("training", "live")).toBe(false);
    expect(workspacesMayShareData("live", "training")).toBe(false);
    expect(workspacesMayShareData("training", "training")).toBe(false);
  });
});
```

- [ ] **Step 2: Run both and verify they fail.**
- [ ] **Step 3: Implement both modules.**
- [ ] **Step 4: Run both and verify they pass.** Paste both `N passed` lines.
- [ ] **Step 5: Prove they can fail.** Make `workspacesMayShareData` return `a === b` → the last training test goes red on `training`/`training`. Put a plan id into one alert body → the identifier test goes red. Revert both.
- [ ] **Step 6: Commit separately**

```bash
git add src/lib/caring-contacts/notification-preferences.ts tests/caring-contacts-notification-preferences.test.ts
git commit -m "feat(caring-contacts): opt-in alert classes with identifier-free bodies"
git add src/lib/caring-contacts/training.ts tests/caring-contacts-training.test.ts
git commit -m "feat(caring-contacts): training competencies and live/training data separation"
```

---

### Checkpoint 1 — end of Group 1

Before starting Group 2, run and paste the decisive line from each:

```bash
npm run test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

`tests/caring-contacts-domain-isolation.test.ts` must be green — every new module imports only from inside `src/lib/caring-contacts/` and the standard library. If it is red, move the dependency inward; do not relax the test.

---

## Group 2 — Storage

---
