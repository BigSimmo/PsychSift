# Caring Contacts Domain and Datastore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Build the sealed Caring Contacts domain rules layer and its dedicated datastore, on synthetic data
only, so that every scheduling, lifecycle, permission, message-policy, audit and retention rule is proven by
test before any screen consumes it.

**Architecture:** All domain logic lives under `src/lib/caring-contacts/` and imports nothing from outside
that directory except the TypeScript and Node standard libraries — enforced by a test, so the whole
directory can later be lifted into its own deployment unchanged. Every module is pure and deterministic,
taking an injected clock rather than reading ambient time. Storage sits behind one interface with an
in-memory implementation for tests and a Postgres implementation for the dedicated database.

**Tech Stack:** TypeScript 6 (strict), Vitest, Postgres 17 with row-level security. No React, no Next.js
runtime, no provider SDKs in this plan.

**Spec:** `docs/superpowers/specs/2026-08-19-caring-contact-production-build-design.md`

## Global Constraints

Copy these exactly. They bind every task.

- **Timezone** is `Australia/Perth` (AWST, UTC+8, **no daylight saving**). Display locale `en-AU`. Machine
  timestamps are ISO 8601 with offset retained.
- **Cadence** is exactly ten contacts: day 1, week 1, then months 1, 2, 3, 4, 6, 8, 10 and 12.
- **Sending windows** map preference to exact local times: `morning` → 10:00, `afternoon` → 14:00,
  `earlyEvening` → 17:00. Nothing may schedule outside 09:00–18:00 AWST.
- **First contact date** defaults to the day after discharge, may be set anywhere from the discharge day to
  seven days after discharge inclusive, and requires a non-empty reason when it is not the default.
- **Month arithmetic clamps** to the last day of a shorter month (31 January + 1 month = 28 or 29 February).
- **Weekends and WA public holidays send normally.** There is no working-day adjustment anywhere.
- **Missed contacts are never sent late** and never rebase the calendar.
- **The month-12 contact is typed `closing`** and is a distinct governed message type.
- **Two GSM-7 segments maximum** for any fully substituted patient-visible message, including notices and
  signature. Basic characters cost 1 septet, extension characters (`\f^{}\[~]|€`) cost 2. Single-segment
  limit 160 septets; multi-segment 153 per segment.
- **Permissions deny by default**, are team-scoped, and every denial returns a named machine-readable
  reason.
- **Every mutation writes its audit event in the same transaction.** No code path may write one without the
  other.
- **Retention is a configured value, not a constant**, defaulting to 7 years, and de-identification must
  preserve actor, action, timestamp, object type and outcome.
- **No file under `src/lib/caring-contacts/` may import** from `@/components`, `@/app`, any other `@/lib`
  module, Supabase, OpenAI, or any repository module.
- **Caring-contact migrations live under `caring-contacts/supabase/migrations/`** and must never be placed
  in the repository's `supabase/migrations/`, which replays against the live Clinical KB project
  `sjrfecxgysukkwxsowpy`.
- **Synthetic data only.** Every fixture, test and seed uses obviously fictional people, numbers and
  services. No real patient data, ever.
- **Prohibited vocabulary** in any identifier, comment, string or type: `high risk`, `safe`,
  `engagement score`, `needs attention` without a named reason, `campaign`, `lead`, `conversion`,
  `best match`, `inbox`, `messages` (as a collection of patient replies), `conversation`.
- Run `npx prettier --write` on every file you touch before committing.

---

### Task 1: The seam — isolation guard, clock, and shared identifiers

Establishes the boundary that makes everything else extractable, plus the injected time source every later
module depends on. Do this first: the isolation test must exist before there is code to leak.

**Files:**

- Create: `src/lib/caring-contacts/clock.ts`
- Create: `src/lib/caring-contacts/ids.ts`
- Create: `tests/caring-contacts-domain-isolation.test.ts`
- Create: `tests/caring-contacts-clock.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `type Clock = { now(): Date }`, `fixedClock(iso: string): Clock`, `systemClock(): Clock`,
  `AWST_TIME_ZONE`, `toAwstParts(date)`, `awstCalendarDay(date)`, `awstWallTimeToInstant(day, hour, minute?)`, and the branded id types
  `TeamId`, `ActorId`, `PatientId`, `ReferralId`, `PlanId`, `ContactId`, `PathwayVersionId`,
  `IdempotencyKey`.

- [ ] **Step 1: Write the failing isolation test**

```typescript
// tests/caring-contacts-domain-isolation.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const DOMAIN_ROOT = path.join(process.cwd(), "src", "lib", "caring-contacts");
const FORBIDDEN = [/^@\/components/, /^@\/app/, /^@\/lib\//, /^@supabase/, /^openai$/, /^next(\/|$)/];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((match) => match[1]);
}

describe("caring-contacts domain isolation", () => {
  it("imports nothing from outside its own directory", () => {
    const offences: string[] = [];
    for (const file of walk(DOMAIN_ROOT)) {
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        if (specifier.startsWith("node:")) continue;
        if (specifier.startsWith(".")) continue;
        if (FORBIDDEN.some((pattern) => pattern.test(specifier))) {
          offences.push(`${path.relative(process.cwd(), file)} -> ${specifier}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it("never escapes its directory with a relative import", () => {
    const offences: string[] = [];
    for (const file of walk(DOMAIN_ROOT)) {
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        if (!specifier.startsWith(".")) continue;
        const resolved = path.resolve(path.dirname(file), specifier);
        if (!resolved.startsWith(DOMAIN_ROOT)) {
          offences.push(`${path.relative(process.cwd(), file)} -> ${specifier}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it("keeps caring-contact migrations out of the Clinical KB migration directory", () => {
    const clinicalKbMigrations = path.join(process.cwd(), "supabase", "migrations");
    const strays = readdirSync(clinicalKbMigrations).filter((name) => /caring[-_]?contact/i.test(name));
    expect(strays).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

Run: `npx vitest run tests/caring-contacts-domain-isolation.test.ts`
Expected: FAIL — `ENOENT` on `src/lib/caring-contacts`. That is the correct failure: the directory does not
exist yet. It must not pass by accident.

- [ ] **Step 3: Write the failing clock test**

```typescript
// tests/caring-contacts-clock.test.ts
import { describe, expect, it } from "vitest";

import { AWST_TIME_ZONE, awstCalendarDay, fixedClock, toAwstParts } from "@/lib/caring-contacts/clock";

describe("caring-contacts clock", () => {
  it("is fixed and repeatable", () => {
    const clock = fixedClock("2026-08-19T02:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-08-19T02:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-08-19T02:00:00.000Z");
  });

  it("uses AWST with no daylight saving in either half of the year", () => {
    expect(AWST_TIME_ZONE).toBe("Australia/Perth");
    // 02:00 UTC is 10:00 AWST in both January and July — Perth does not observe DST.
    expect(toAwstParts(new Date("2026-01-15T02:00:00.000Z")).hour).toBe(10);
    expect(toAwstParts(new Date("2026-07-15T02:00:00.000Z")).hour).toBe(10);
  });

  it("derives the AWST calendar day across the UTC date boundary", () => {
    // 20:00 UTC on the 18th is 04:00 AWST on the 19th.
    expect(awstCalendarDay(new Date("2026-08-18T20:00:00.000Z"))).toBe("2026-08-19");
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npx vitest run tests/caring-contacts-clock.test.ts`
Expected: FAIL — cannot resolve `@/lib/caring-contacts/clock`.

- [ ] **Step 5: Implement the clock**

```typescript
// src/lib/caring-contacts/clock.ts
export const AWST_TIME_ZONE = "Australia/Perth";

export type Clock = { now(): Date };

export function fixedClock(iso: string): Clock {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) throw new Error(`fixedClock: invalid instant ${iso}`);
  return { now: () => new Date(instant.getTime()) };
}

export function systemClock(): Clock {
  return { now: () => new Date() };
}

export type AwstParts = { year: number; month: number; day: number; hour: number; minute: number };

const AWST_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: AWST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function toAwstParts(instant: Date): AwstParts {
  const parts = Object.fromEntries(AWST_FORMAT.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export function awstCalendarDay(instant: Date): string {
  const { year, month, day } = toAwstParts(instant);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** AWST is UTC+8 year-round, so a local wall time maps to exactly one instant. */
export function awstWallTimeToInstant(calendarDay: string, hour: number, minute = 0): Date {
  const [year, month, day] = calendarDay.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0));
}
```

- [ ] **Step 6: Implement the branded identifiers**

```typescript
// src/lib/caring-contacts/ids.ts
declare const brand: unique symbol;
type Branded<T, B extends string> = T & { readonly [brand]: B };

export type TeamId = Branded<string, "TeamId">;
export type ActorId = Branded<string, "ActorId">;
export type PatientId = Branded<string, "PatientId">;
export type ReferralId = Branded<string, "ReferralId">;
export type PlanId = Branded<string, "PlanId">;
export type ContactId = Branded<string, "ContactId">;
export type PathwayVersionId = Branded<string, "PathwayVersionId">;
export type IdempotencyKey = Branded<string, "IdempotencyKey">;

const make =
  <T extends string>() =>
  (value: string): Branded<string, T> => {
    if (value.trim() === "") throw new Error("identifier must not be empty");
    return value as Branded<string, T>;
  };

export const teamId = make<"TeamId">();
export const actorId = make<"ActorId">();
export const patientId = make<"PatientId">();
export const referralId = make<"ReferralId">();
export const planId = make<"PlanId">();
export const contactId = make<"ContactId">();
export const pathwayVersionId = make<"PathwayVersionId">();
export const idempotencyKey = make<"IdempotencyKey">();
```

- [ ] **Step 7: Run both tests and confirm they pass**

Run: `npx vitest run tests/caring-contacts-domain-isolation.test.ts tests/caring-contacts-clock.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 8: Prove the isolation guard actually bites**

Temporarily add `import { isDemoMode } from "@/lib/env";` to `src/lib/caring-contacts/clock.ts`, re-run the
isolation test, and confirm it FAILS naming that import. Then remove the line and confirm it passes again.
A guard that has never been seen to fail is not a guard. Record both outcomes in your report.

- [ ] **Step 9: Commit**

```bash
npx prettier --write src/lib/caring-contacts tests/caring-contacts-domain-isolation.test.ts tests/caring-contacts-clock.test.ts
git add src/lib/caring-contacts tests/caring-contacts-domain-isolation.test.ts tests/caring-contacts-clock.test.ts
git commit -m "feat(caring-contacts): seal the domain directory and add the injected AWST clock"
```

---

### Task 2: Lifecycles and legal transitions

**Files:**

- Create: `src/lib/caring-contacts/model.ts`
- Create: `tests/caring-contacts-model.test.ts`

**Interfaces:**

- Consumes: `ids.ts` from Task 1.
- Produces: `ReferralState`, `PlanState`, `ContactState`, `PathwayVersionState`, `MessageType`,
  `SendingPreference`, `TransitionResult`, `applyPlanTransition(plan, action): TransitionResult<Plan>`,
  `applyContactTransition(contact, action): TransitionResult<Contact>`, and the record types `Referral`,
  `Plan`, `Contact`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/caring-contacts-model.test.ts
import { describe, expect, it } from "vitest";

import { planId, teamId } from "@/lib/caring-contacts/ids";
import { applyPlanTransition, type Plan } from "@/lib/caring-contacts/model";

const basePlan = (state: Plan["state"]): Plan => ({
  id: planId("PLAN-1"),
  teamId: teamId("TEAM-1"),
  state,
  version: 1,
});

describe("plan lifecycle", () => {
  it("activates a draft", () => {
    const result = applyPlanTransition(basePlan("draft"), { type: "activate" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe("active");
  });

  it("refuses to activate an already active plan and names the reason", () => {
    const result = applyPlanTransition(basePlan("active"), { type: "activate" });
    expect(result).toEqual({ ok: false, reason: "plan-not-draft" });
  });

  it("refuses every transition out of a cancelled plan", () => {
    for (const action of [{ type: "activate" }, { type: "pause" }, { type: "resume" }, { type: "withdraw" }] as const) {
      expect(applyPlanTransition(basePlan("cancelled"), action)).toEqual({ ok: false, reason: "plan-terminal" });
    }
  });

  it("treats withdrawn and completed as terminal too", () => {
    expect(applyPlanTransition(basePlan("withdrawn"), { type: "pause" })).toEqual({
      ok: false,
      reason: "plan-terminal",
    });
    expect(applyPlanTransition(basePlan("completed"), { type: "resume" })).toEqual({
      ok: false,
      reason: "plan-terminal",
    });
  });

  it("pauses an active plan and resumes only from paused", () => {
    const paused = applyPlanTransition(basePlan("active"), { type: "pause" });
    expect(paused.ok && paused.value.state).toBe("paused");
    expect(applyPlanTransition(basePlan("active"), { type: "resume" })).toEqual({
      ok: false,
      reason: "plan-not-paused",
    });
  });

  it("allows withdrawal from active and from paused", () => {
    for (const from of ["active", "paused"] as const) {
      const result = applyPlanTransition(basePlan(from), { type: "withdraw" });
      expect(result.ok && result.value.state).toBe("withdrawn");
    }
  });

  it("increments the version on every accepted transition, for optimistic concurrency", () => {
    const result = applyPlanTransition(basePlan("draft"), { type: "activate" });
    expect(result.ok && result.value.version).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/caring-contacts-model.test.ts`
Expected: FAIL — cannot resolve `@/lib/caring-contacts/model`.

- [ ] **Step 3: Implement the model**

```typescript
// src/lib/caring-contacts/model.ts
import type { ContactId, PathwayVersionId, PatientId, PlanId, ReferralId, TeamId } from "./ids";

export type TransitionResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export type ReferralState = "awaitingHandover" | "accepted" | "returnedForClarification" | "declined";
export type PlanState = "draft" | "active" | "paused" | "withdrawn" | "cancelled" | "completed";
export type ContactState =
  | "scheduled"
  | "processing"
  | "sent"
  | "delivered"
  | "notDelivered"
  | "numberInvalid"
  | "contactChanged"
  | "statusUnavailable"
  | "missed"
  | "suppressed"
  | "cancelled";
export type PathwayVersionState = "draft" | "inReview" | "approved" | "retired";
export type MessageType = "standard" | "first" | "closing";
export type SendingPreference = "morning" | "afternoon" | "earlyEvening";

const TERMINAL_PLAN_STATES: readonly PlanState[] = ["withdrawn", "cancelled", "completed"];

export type Plan = { id: PlanId; teamId: TeamId; state: PlanState; version: number };
export type Contact = { id: ContactId; planId: PlanId; state: ContactState; version: number };
export type Referral = {
  id: ReferralId;
  teamId: TeamId;
  patientId: PatientId;
  state: ReferralState;
  pathwayVersionId: PathwayVersionId | null;
};

export type PlanAction =
  | { type: "activate" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "withdraw" }
  | { type: "cancel" }
  | { type: "complete" };

export function applyPlanTransition(plan: Plan, action: PlanAction): TransitionResult<Plan> {
  if (TERMINAL_PLAN_STATES.includes(plan.state)) return { ok: false, reason: "plan-terminal" };
  const advance = (state: PlanState): TransitionResult<Plan> => ({
    ok: true,
    value: { ...plan, state, version: plan.version + 1 },
  });
  switch (action.type) {
    case "activate":
      return plan.state === "draft" ? advance("active") : { ok: false, reason: "plan-not-draft" };
    case "pause":
      return plan.state === "active" ? advance("paused") : { ok: false, reason: "plan-not-active" };
    case "resume":
      return plan.state === "paused" ? advance("active") : { ok: false, reason: "plan-not-paused" };
    case "withdraw":
      return plan.state === "active" || plan.state === "paused"
        ? advance("withdrawn")
        : { ok: false, reason: "plan-not-withdrawable" };
    case "cancel":
      return advance("cancelled");
    case "complete":
      return plan.state === "active" ? advance("completed") : { ok: false, reason: "plan-not-active" };
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/caring-contacts-model.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add the contact lifecycle**

Write tests first, in the same file, asserting: `scheduled → processing → sent → delivered`;
`sent → notDelivered` permitted; `delivered` is terminal and rejects every further action with
`contact-terminal`; a `suppressed` or `cancelled` contact is terminal; an out-of-order provider status
(`delivered` arriving for a `scheduled` contact) is rejected with `contact-out-of-order`. Then implement
`applyContactTransition` in the same shape as `applyPlanTransition`. Run and confirm pass.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/caring-contacts/model.ts tests/caring-contacts-model.test.ts
git add src/lib/caring-contacts/model.ts tests/caring-contacts-model.test.ts
git commit -m "feat(caring-contacts): plan and contact lifecycles with named refusal reasons"
```

---

### Task 3: The discharge-anchored schedule

The single most safety-critical module in this plan. Every value below comes from the decision lock.

**Files:**

- Create: `src/lib/caring-contacts/schedule.ts`
- Create: `tests/caring-contacts-schedule.test.ts`

**Interfaces:**

- Consumes: `clock.ts` (`awstCalendarDay`, `awstWallTimeToInstant`), `model.ts` (`SendingPreference`,
  `MessageType`).
- Produces:

```typescript
export type ScheduleInput = {
  dischargeAt: Date;
  sendingPreference: SendingPreference;
  firstContactDate?: string; // AWST calendar day, YYYY-MM-DD
  firstContactReason?: string;
};
export type PlannedContact = {
  sequence: number; // 1..10
  cadenceLabel: string; // "Day 1" | "Week 1" | "Month 1" ...
  calendarDay: string; // AWST YYYY-MM-DD
  sendAt: Date; // exact instant
  messageType: MessageType;
  suppressed?: { reason: "absorbedByFirstContact" };
};
export type ScheduleResult = { ok: true; contacts: PlannedContact[] } | { ok: false; reason: string };
export function buildApprovedSchedule(input: ScheduleInput): ScheduleResult;
```

**Rules to encode, exactly:**

1. Cadence offsets from the discharge calendar day: `Day 1` = the first contact date; `Week 1` = +7 days;
   `Month N` = +N calendar months with end-of-month clamping, for N in 1, 2, 3, 4, 6, 8, 10, 12.
2. First contact date defaults to discharge day + 1. Permitted range is discharge day + 0 to + 7 inclusive.
   Outside that range → `{ ok: false, reason: "first-contact-out-of-range" }`. Any value other than the
   default requires a non-empty `firstContactReason`, else `{ ok: false, reason: "first-contact-reason-required" }`.
3. **Collision rule (design decision, 2026-08-19):** if the chosen first contact date falls on the same
   calendar day as the Week 1 contact (only possible when it is set to discharge + 7), the Week 1 contact is
   marked `suppressed: { reason: "absorbedByFirstContact" }` and is not sent. Two caring contacts must never
   land on the same day. The suppressed entry is retained in the result so the interface can explain the
   nine-contact plan.
4. Sequence 1 is `messageType: "first"`; sequence 10 (Month 12) is `messageType: "closing"`; everything else
   is `"standard"`.
5. Send times: `morning` 10:00, `afternoon` 14:00, `earlyEvening` 17:00 AWST. Every `sendAt` must fall
   within 09:00–18:00 AWST.
6. Calendar days are strictly increasing across non-suppressed contacts.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/caring-contacts-schedule.test.ts
import { describe, expect, it } from "vitest";

import { awstCalendarDay, toAwstParts } from "@/lib/caring-contacts/clock";
import { buildApprovedSchedule } from "@/lib/caring-contacts/schedule";

const discharge = new Date("2026-03-10T06:30:00.000Z"); // 14:30 AWST on 2026-03-10

function ok(result: ReturnType<typeof buildApprovedSchedule>) {
  if (!result.ok) throw new Error(`expected success, got ${result.reason}`);
  return result.contacts;
}

describe("buildApprovedSchedule", () => {
  it("produces exactly ten contacts with the approved cadence labels", () => {
    const contacts = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: "morning" }));
    expect(contacts).toHaveLength(10);
    expect(contacts.map((c) => c.cadenceLabel)).toEqual([
      "Day 1",
      "Week 1",
      "Month 1",
      "Month 2",
      "Month 3",
      "Month 4",
      "Month 6",
      "Month 8",
      "Month 10",
      "Month 12",
    ]);
  });

  it("defaults the first contact to the day after discharge", () => {
    const contacts = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: "morning" }));
    expect(contacts[0].calendarDay).toBe("2026-03-11");
    expect(contacts[1].calendarDay).toBe("2026-03-17"); // discharge + 7
  });

  it("anchors every later contact to the discharge date, not the first contact date", () => {
    const moved = ok(
      buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: "2026-03-14",
        firstContactReason: "Patient requested a later start",
      }),
    );
    expect(moved[0].calendarDay).toBe("2026-03-14");
    expect(moved[2].calendarDay).toBe("2026-04-10"); // Month 1 from discharge, unmoved
  });

  it("clamps month arithmetic to the last day of a shorter month", () => {
    const contacts = ok(
      buildApprovedSchedule({ dischargeAt: new Date("2026-01-31T02:00:00.000Z"), sendingPreference: "morning" }),
    );
    expect(contacts[2].calendarDay).toBe("2026-02-28"); // 2026 is not a leap year
  });

  it("clamps into a leap February", () => {
    const contacts = ok(
      buildApprovedSchedule({ dischargeAt: new Date("2028-01-31T02:00:00.000Z"), sendingPreference: "morning" }),
    );
    expect(contacts[2].calendarDay).toBe("2028-02-29");
  });

  it("maps each preference to its exact AWST hour", () => {
    for (const [preference, hour] of [
      ["morning", 10],
      ["afternoon", 14],
      ["earlyEvening", 17],
    ] as const) {
      const contacts = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: preference }));
      for (const contact of contacts) expect(toAwstParts(contact.sendAt).hour).toBe(hour);
    }
  });

  it("never schedules outside 09:00-18:00 AWST", () => {
    for (const preference of ["morning", "afternoon", "earlyEvening"] as const) {
      const contacts = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: preference }));
      for (const contact of contacts) {
        const { hour } = toAwstParts(contact.sendAt);
        expect(hour).toBeGreaterThanOrEqual(9);
        expect(hour).toBeLessThan(18);
      }
    }
  });

  it("sends on weekends without adjustment", () => {
    // 2026-03-13 is a Friday; +1 day is Saturday 2026-03-14.
    const contacts = ok(
      buildApprovedSchedule({ dischargeAt: new Date("2026-03-13T02:00:00.000Z"), sendingPreference: "morning" }),
    );
    expect(contacts[0].calendarDay).toBe("2026-03-14");
    expect(new Date(`${contacts[0].calendarDay}T00:00:00Z`).getUTCDay()).toBe(6);
  });

  it("types the first and closing messages", () => {
    const contacts = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: "morning" }));
    expect(contacts[0].messageType).toBe("first");
    expect(contacts[9].messageType).toBe("closing");
    expect(contacts.slice(1, 9).every((c) => c.messageType === "standard")).toBe(true);
  });

  it("accepts both ends of the permitted first-contact range", () => {
    for (const day of ["2026-03-10", "2026-03-17"]) {
      const result = buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: day,
        firstContactReason: "Coordinator decision",
      });
      expect(result.ok).toBe(true);
    }
  });

  it("rejects a first contact date outside the permitted range", () => {
    for (const day of ["2026-03-09", "2026-03-18"]) {
      expect(
        buildApprovedSchedule({
          dischargeAt: discharge,
          sendingPreference: "morning",
          firstContactDate: day,
          firstContactReason: "Too far",
        }),
      ).toEqual({ ok: false, reason: "first-contact-out-of-range" });
    }
  });

  it("requires a reason whenever the first contact date is not the default", () => {
    expect(
      buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: "2026-03-13",
      }),
    ).toEqual({ ok: false, reason: "first-contact-reason-required" });
    expect(
      buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: "2026-03-13",
        firstContactReason: "   ",
      }),
    ).toEqual({ ok: false, reason: "first-contact-reason-required" });
  });

  it("suppresses Week 1 when the first contact absorbs it, rather than sending twice in a day", () => {
    const contacts = ok(
      buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: "2026-03-17",
        firstContactReason: "Patient away for a week",
      }),
    );
    expect(contacts[1].suppressed).toEqual({ reason: "absorbedByFirstContact" });
    expect(contacts.filter((c) => !c.suppressed)).toHaveLength(9);
  });

  it("keeps non-suppressed calendar days strictly increasing", () => {
    for (const day of ["2026-03-10", "2026-03-13", "2026-03-17"]) {
      const contacts = ok(
        buildApprovedSchedule({
          dischargeAt: discharge,
          sendingPreference: "morning",
          firstContactDate: day,
          firstContactReason: "Coordinator decision",
        }),
      ).filter((c) => !c.suppressed);
      const days = contacts.map((c) => c.calendarDay);
      expect([...days].sort()).toEqual(days);
      expect(new Set(days).size).toBe(days.length);
    }
  });

  it("is deterministic", () => {
    const a = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: "afternoon" }));
    const b = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: "afternoon" }));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("derives the discharge day in AWST, not UTC", () => {
    // 20:00 UTC on 2026-03-10 is 04:00 AWST on 2026-03-11, so day 1 is the 12th.
    const contacts = ok(
      buildApprovedSchedule({ dischargeAt: new Date("2026-03-10T20:00:00.000Z"), sendingPreference: "morning" }),
    );
    expect(awstCalendarDay(new Date("2026-03-10T20:00:00.000Z"))).toBe("2026-03-11");
    expect(contacts[0].calendarDay).toBe("2026-03-12");
  });
});
```

- [ ] **Step 2: Run and confirm every assertion fails for the right reason**

Run: `npx vitest run tests/caring-contacts-schedule.test.ts`
Expected: FAIL — cannot resolve `@/lib/caring-contacts/schedule`. Do not proceed if any test passes.

- [ ] **Step 3: Implement `schedule.ts`**

Implement to satisfy the tests exactly. Required helper behaviour: add calendar months by incrementing the
month and clamping the day to the target month's length; compute all days in AWST via `awstCalendarDay`;
build `sendAt` with `awstWallTimeToInstant`. Do not use any date library; the standard library plus the
Task 1 helpers are sufficient and keep the seam clean.

- [ ] **Step 4: Run and confirm all pass**

Run: `npx vitest run tests/caring-contacts-schedule.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/caring-contacts/schedule.ts tests/caring-contacts-schedule.test.ts
git add src/lib/caring-contacts/schedule.ts tests/caring-contacts-schedule.test.ts
git commit -m "feat(caring-contacts): discharge-anchored twelve-month schedule with clamping and collision suppression"
```

---

### Task 4: Hospital status events

**Files:**

- Create: `src/lib/caring-contacts/hospital-events.ts`
- Create: `tests/caring-contacts-hospital-events.test.ts`

**Interfaces:**

- Consumes: `model.ts`.
- Produces: `applyHospitalStatusEvent(plan, event): PlanTransition` where
  `event` is one of `{ type: "readmission" }`, `{ type: "death"; recordedAt: Date }`,
  `{ type: "deathCorrection" }`, `{ type: "mobileChanged" }`, `{ type: "thirdPartyPauseRequest"; requester: string; relationship: string; note: string }`,
  and `PlanTransition = { plan: Plan; exceptions: PlanException[]; incident?: PlanIncident }`.

**Rules to encode:**

1. `readmission` pauses future contacts. It never rebases the calendar and never auto-resumes.
2. `death` irreversibly cancels every unsent contact. The resulting plan state is `cancelled` and no later
   event may move it.
3. `deathCorrection` produces `incident: { type: "deathCorrection" }`, does **not** resume the episode, and
   states that a new referral is required for any future plan.
4. `mobileChanged` pauses future contacts and raises exception `contactChanged`. It never silently switches
   destination.
5. `thirdPartyPauseRequest` pauses and raises exception `thirdPartyPause`, recording requester, relationship
   and note. It must **refuse** to withdraw: a third-party withdrawal attempt returns
   `{ ok: false, reason: "third-party-withdrawal-refused" }` from the withdrawal path.

- [ ] **Step 1: Write failing tests** covering each of the five rules, plus: death after readmission still
      cancels; any event applied to an already-cancelled plan returns `plan-terminal`; a third-party pause on
      a paused plan is idempotent and does not double-raise the exception.
- [ ] **Step 2: Run and confirm failure.** Run: `npx vitest run tests/caring-contacts-hospital-events.test.ts`
- [ ] **Step 3: Implement `hospital-events.ts`.**
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/caring-contacts/hospital-events.ts tests/caring-contacts-hospital-events.test.ts
git add src/lib/caring-contacts/hospital-events.ts tests/caring-contacts-hospital-events.test.ts
git commit -m "feat(caring-contacts): hospital status events with irreversible death cancellation"
```

---

### Task 5: Permissions

**Files:**

- Create: `src/lib/caring-contacts/permissions.ts`
- Create: `tests/caring-contacts-permissions.test.ts`

**Interfaces:**

- Consumes: `ids.ts`.
- Produces:

```typescript
export type CaringContactRole = "coordinator" | "teamLead" | "auditor";
export type CaringContactAction =
  | "viewReferral"
  | "acceptReferral"
  | "claimPlan"
  | "activatePlan"
  | "pausePlan"
  | "resumePlan"
  | "withdrawPlan"
  | "reassignPlan"
  | "moveContactWithinDay"
  | "changeContactDate"
  | "authorPathwayVersion"
  | "approvePathwayVersion"
  | "viewAccessTrail"
  | "triggerServiceSafetyStop"
  | "approveServiceRestart"
  | "generateClinicalRecordSummary";
export type Actor = { id: ActorId; teamId: TeamId; roles: readonly CaringContactRole[] };
export type Resource = { teamId: TeamId };
export type CapabilityDecision = { allowed: true } | { allowed: false; reason: string };
export function canPerformCaringContactAction(actor, action, resource): CapabilityDecision;
```

**Rules to encode:**

1. Deny by default: an action not explicitly granted to any of the actor's roles returns
   `{ allowed: false, reason: "action-not-granted" }`.
2. Team scope: `resource.teamId !== actor.teamId` returns `{ allowed: false, reason: "cross-team-denied" }`
   and is checked **before** the role grant, so a cross-team auditor never leaks which actions exist.
3. `auditor` may only `viewAccessTrail`. It may not view referrals, mutate anything, or generate a summary.
4. `changeContactDate` and `reassignPlan` require `teamLead`. `moveContactWithinDay` is allowed to
   `coordinator`.
5. `approvePathwayVersion` requires `teamLead`; `authorPathwayVersion` is allowed to `coordinator`. No single
   role may both author and approve the same version — enforce that as a separate
   `canApproveOwnAuthoredVersion` check returning `{ allowed: false, reason: "self-approval-denied" }`.
6. `triggerServiceSafetyStop` is allowed to every role including `auditor` — stopping must never be blocked
   by permissions. `approveServiceRestart` requires `teamLead`.
7. An actor with an empty role list is denied everything with `no-roles`.

- [ ] **Step 1: Write failing tests** for all seven rules, including a table-driven test asserting that every
      value in `CaringContactAction` is either explicitly granted to at least one role or explicitly listed as
      ungranted — so a new action added later cannot silently default to allowed.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement `permissions.ts`** with a frozen role→action grant map.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/caring-contacts/permissions.ts tests/caring-contacts-permissions.test.ts
git add src/lib/caring-contacts/permissions.ts tests/caring-contacts-permissions.test.ts
git commit -m "feat(caring-contacts): deny-by-default team-scoped permissions with named refusals"
```

---

### Task 6: Message policy and its provisional rulebook

The validator is mechanism. The rules are data, in their own file, replaceable wholesale.

**Files:**

- Create: `src/lib/caring-contacts/message-rules.ts`
- Create: `src/lib/caring-contacts/message-policy.ts`
- Create: `tests/caring-contacts-message-policy.test.ts`

**Interfaces:**

- Consumes: `model.ts` (`MessageType`).
- Produces: `calculateGsm7(text): Gsm7Evidence`, `validateGovernedMessage(input): ValidationResult`,
  `PROVISIONAL_MESSAGE_RULES`.

**`message-rules.ts` must open with this comment, verbatim:**

```typescript
// PROVISIONAL — NOT CLINICALLY APPROVED.
// Seeded 2026-08-19 from the decision lock's prohibited concepts, the existing prototype message
// constants, and the two-segment GSM-7 limit. Replace this file wholesale when the clinical programme
// lead and lived-experience representative approve the real content style guide. Do not edit
// message-policy.ts to accommodate a rule change — the mechanism is stable, the rules are data.
```

**Rules to encode:**

1. `calculateGsm7` scores basic characters 1 septet, extension characters (`\f^{}\[~]|€`) 2 septets, and
   returns `{ valid: false, segments: 0, invalidCharacters }` for anything outside both sets. Single segment
   ≤ 160 septets; above that, 153 per segment.
2. A fully substituted message over two segments fails with code `exceeds-two-segments` and reports the
   exact septet and segment count.
3. Prohibited terms fail with `prohibited-term` naming the exact term found. Seed the list from the Global
   Constraints vocabulary above.
4. A `first` message must contain the programme line, its hours, emergency direction and one crisis-support
   contact; missing any fails with `first-message-missing-support-information`.
5. A `closing` message must state that it is the final message and must contain the programme line and
   crisis support; missing either fails with `closing-message-missing-ending-statement` or
   `closing-message-missing-support-information`.
6. Any message must fail with `contains-patient-mobile` if it contains a patient mobile number.
7. Any message containing a question mark fails with `solicits-reply` — the service must never ask a
   question it cannot receive an answer to.
8. `validateGovernedMessage` never calls a network, model or provider. Assert this by confirming the module
   imports nothing (the Task 1 isolation test covers the directory; add a unit assertion that the module's
   exports are pure functions).

- [ ] **Step 1: Write failing tests** for all eight rules. Include the exact regression fixture: a
      two-segment message of 252 septets passes, and one of 307 septets fails with `exceeds-two-segments`.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement `message-rules.ts` then `message-policy.ts`.**
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Prove the separation.** Change one prohibited term in `message-rules.ts`, re-run, confirm the
      behaviour changes without touching `message-policy.ts`, then revert. Record it in your report.
- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/caring-contacts/message-rules.ts src/lib/caring-contacts/message-policy.ts tests/caring-contacts-message-policy.test.ts
git add src/lib/caring-contacts/message-rules.ts src/lib/caring-contacts/message-policy.ts tests/caring-contacts-message-policy.test.ts
git commit -m "feat(caring-contacts): governed message validation with a replaceable provisional rulebook"
```

---

### Task 7: Audit events

**Files:**

- Create: `src/lib/caring-contacts/audit.ts`
- Create: `tests/caring-contacts-audit.test.ts`

**Interfaces:**

- Consumes: `ids.ts`, `clock.ts`.
- Produces: `type AuditEvent`, `buildAuditEvent(input, clock): AuditEvent`, `type AuditableChange`.

**Rules to encode:**

1. Every event carries actor id, actor roles, team id, action, object type, object id, outcome
   (`allowed` | `denied` | `failed`), an ISO timestamp with offset, and an idempotency key.
2. An event must **never** contain a mobile number, message body, or free clinical text. Add a guard that
   scans every string field against a mobile-number pattern and a configurable set of forbidden field names,
   throwing `audit-event-contains-patient-data` if either matches.
3. Events are frozen on construction (`Object.freeze`) — an audit record that can be mutated after the fact
   is not an audit record.
4. `buildAuditEvent` is pure given a clock.

- [ ] **Step 1: Write failing tests**, including one asserting that passing a mobile number in any field
      throws, and one asserting the returned object is frozen.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement `audit.ts`.**
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/caring-contacts/audit.ts tests/caring-contacts-audit.test.ts
git add src/lib/caring-contacts/audit.ts tests/caring-contacts-audit.test.ts
git commit -m "feat(caring-contacts): frozen audit events that reject patient data"
```

---

### Task 8: Retention and de-identification

**Files:**

- Create: `src/lib/caring-contacts/retention.ts`
- Create: `tests/caring-contacts-retention.test.ts`

**Interfaces:**

- Consumes: `clock.ts`, `audit.ts`.
- Produces: `type RetentionPolicy = { years: number }`, `DEFAULT_RETENTION_POLICY`,
  `isDueForDeidentification(episode, policy, clock): boolean`,
  `deidentifyEpisode(episode): DeidentifiedEpisode`, `deidentifyAuditEvent(event): AuditEvent`.

**Rules to encode:**

1. `DEFAULT_RETENTION_POLICY` is `{ years: 7 }` and is exported as a value a caller may override. A test
   must assert that no other module hard-codes `7`.
2. `isDueForDeidentification` is true only when the episode is in a terminal state **and** the policy period
   has elapsed since completion, measured in AWST.
3. `deidentifyEpisode` removes patient name, mobile, identifiers and cultural identity, and retains plan
   dates, pathway version, team, outcome and counts.
4. `deidentifyAuditEvent` retains actor, action, timestamp, object type and outcome, and clears object id.
   Assert the five retained fields explicitly.
5. De-identification is idempotent: applying it twice equals applying it once.

- [ ] **Step 1: Write failing tests** for all five rules, including a boundary test at exactly seven years
      minus one day (false) and exactly seven years (true).
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement `retention.ts`.**
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/caring-contacts/retention.ts tests/caring-contacts-retention.test.ts
git add src/lib/caring-contacts/retention.ts tests/caring-contacts-retention.test.ts
git commit -m "feat(caring-contacts): configurable retention with idempotent de-identification"
```

---

### Task 9: Repository interface and in-memory implementation

**Files:**

- Create: `src/lib/caring-contacts/repository.ts`
- Create: `src/lib/caring-contacts/in-memory-repository.ts`
- Create: `tests/caring-contacts-repository.test.ts`

**Interfaces:**

- Consumes: every prior module.
- Produces: `interface CaringContactRepository` with methods taking
  `{ actor: Actor; idempotencyKey: IdempotencyKey }` context, and `createInMemoryRepository(clock)`.

**Rules to encode:**

1. Every write takes an idempotency key. Replaying the same key returns the original result and performs no
   second change.
2. Every write appends exactly one audit event **atomically** with the change — a test must assert that a
   write which throws part-way leaves neither the change nor the audit event.
3. Optimistic concurrency: a write against a stale `version` fails with `stale-version`.
4. A second active plan for the same patient fails with `duplicate-active-plan`.
5. Reads are team-scoped: a repository call with an actor from another team returns empty, not a denial that
   reveals existence.

- [ ] **Step 1: Write failing tests** for all five rules, plus a concurrency test issuing two simultaneous
      pause calls with different keys and asserting exactly one wins with the other failing `stale-version`.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement the interface, then the in-memory store.**
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/caring-contacts/repository.ts src/lib/caring-contacts/in-memory-repository.ts tests/caring-contacts-repository.test.ts
git add src/lib/caring-contacts/repository.ts src/lib/caring-contacts/in-memory-repository.ts tests/caring-contacts-repository.test.ts
git commit -m "feat(caring-contacts): repository contract with idempotent, atomically audited writes"
```

---

### Task 10: The twelve-month simulation

The integration proof. If this passes, the rules layer is trustworthy.

**Files:**

- Create: `src/lib/caring-contacts/simulation.ts`
- Create: `tests/caring-contacts-simulation.test.ts`

**Interfaces:**

- Consumes: every prior module.
- Produces: `runTwelveMonthSimulation(input): SimulationReport` with
  `SimulationReport = { dispatched: PlannedContact[]; missed: PlannedContact[]; suppressed: PlannedContact[]; auditEvents: AuditEvent[] }`.

**Scenarios to prove, each its own test:**

1. **Clean run** — exactly 10 dispatches, in ascending order, zero duplicates.
2. **Retry** — a transient failure retries twice (three attempts total) inside the original window, then
   stops. A fourth attempt never occurs.
3. **Window boundary** — a transient failure whose retries would cross out of the window is abandoned and
   marked `missed`, never sent late.
4. **Pause and resume** — a pause covering months 2 and 3 permanently skips both; resumption begins at month
   4; the total is 8 dispatches and the calendar is unchanged.
5. **Withdrawal at month 5** — every later contact is cancelled; nothing sends afterwards.
6. **Readmission then discharge** — the original episode never auto-resumes and never rebases.
7. **Death at month 3** — no contact is dispatched at or after the recorded death, under any retry state.
8. **Concurrent pause during dispatch** — a pause landing while a contact is processing must not produce a
   duplicate send; exactly one outcome is recorded.
9. **Clock jitter** — running the same simulation with the clock perturbed by ±5 minutes produces identical
   dispatch days.
10. **Audit completeness** — every state change in the run has exactly one corresponding audit event, and
    no audit event contains a mobile number or message body.

- [ ] **Step 1: Write all ten failing tests.**
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement `simulation.ts`** as a deterministic driver over the existing modules. It must add
      no new rules — if a scenario cannot be expressed with the existing modules, that is a finding to report,
      not a reason to add logic here.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/caring-contacts/simulation.ts tests/caring-contacts-simulation.test.ts
git add src/lib/caring-contacts/simulation.ts tests/caring-contacts-simulation.test.ts
git commit -m "feat(caring-contacts): deterministic twelve-month simulation proving zero duplicate sends"
```

---

### Task 11: Database schema, row-level security, and the Postgres repository

Runs against a **local Postgres** instance. Provisioning the dedicated Supabase project is a separate,
confirmation-gated action and is **not** part of this task.

**Files:**

- Create: `caring-contacts/supabase/migrations/0001_caring_contacts_foundation.sql`
- Create: `caring-contacts/supabase/migrations/0002_caring_contacts_rls.sql`
- Create: `src/lib/caring-contacts/db/postgres-repository.ts`
- Create: `tests/caring-contacts-migrations.test.ts`
- Modify: `package.json` — add `"caring-contacts:db:test"` running the migration suite against a local
  Postgres URL from `CARING_CONTACTS_DATABASE_URL`.

**Rules to encode:**

1. Tables: `teams`, `actors`, `referrals`, `plans`, `contacts`, `pathway_versions`, `audit_events`,
   `service_state`, `retention_state`. Cultural identity lives in a **separate reporting projection table**,
   not on the patient row.
2. Row-level security on every patient-bearing table, scoped by team, deny by default. Anonymous access is
   denied. A cross-team select returns zero rows.
3. A unique partial index preventing a second active plan per patient.
4. A unique constraint on `(contact_id, attempt)` preventing duplicate dispatch records.
5. Audit insertion happens inside the same transaction as the change, enforced by a trigger or a
   `SECURITY DEFINER` function — a direct update that bypasses the audit path must fail.
6. Every migration is idempotent-safe to replay and contains no `CREATE INDEX CONCURRENTLY`.
7. `postgres-repository.ts` implements the Task 9 interface and passes the **same** test suite as the
   in-memory implementation. Parameterise the Task 9 tests over both implementations rather than duplicating
   them.

- [ ] **Step 1: Write the failing migration tests** asserting anonymous denial, cross-team denial, duplicate
      active plan rejection, duplicate dispatch rejection, and audit-bypass rejection.
- [ ] **Step 2: Run and confirm failure.** Run: `npm run caring-contacts:db:test`
- [ ] **Step 3: Write the migrations.**
- [ ] **Step 4: Implement `postgres-repository.ts` and parameterise the Task 9 suite over both stores.**
- [ ] **Step 5: Run both suites and confirm pass.**
- [ ] **Step 6: Confirm the guard.** Re-run `tests/caring-contacts-domain-isolation.test.ts` and confirm the
      migration-location assertion still passes — no caring-contact migration may have appeared under
      `supabase/migrations/`.
- [ ] **Step 8: Commit**

```bash
npx prettier --write src/lib/caring-contacts tests/caring-contacts-migrations.test.ts docs/superpowers/plans/2026-08-14-caring-contact-coordination-rollout.md
git add caring-contacts src/lib/caring-contacts/db tests/caring-contacts-migrations.test.ts package.json docs/superpowers/plans/2026-08-14-caring-contact-coordination-rollout.md
git commit -m "feat(caring-contacts): team-scoped Postgres schema with transactional audit and RLS"
```

---

## Final verification

- [ ] `npx vitest run tests/caring-contacts-*.test.ts` — every suite green.
- [ ] `npx tsc -p tsconfig.typecheck.json --noEmit` — silent.
- [ ] `npm run verify:pr-local` — once, for handoff.
- [ ] `npx prettier --check .` — whole tree.

Do not run `verify:ui` (no UI changed), `verify:release`, `check:supabase-project`, or any provider-backed
gate.

## Decisions made while writing this plan

- **Week 1 collision (Task 3, rule 3).** The decision lock permits a first contact date up to seven days
  after discharge, which is exactly when the Week 1 contact falls. Two caring contacts on one day is worse
  than nine contacts, so Week 1 is suppressed and recorded rather than sent. If the clinical programme lead
  prefers the reverse, only `schedule.ts` and its tests change.
- **`cancel` is always permitted from a non-terminal plan state (Task 2).** Cancellation is the safe
  direction; refusing it would leave a plan sending during an incident.
- **`triggerServiceSafetyStop` is granted to every role including `auditor` (Task 5, rule 6).** Stopping the
  service must never be blocked by a permission check.
