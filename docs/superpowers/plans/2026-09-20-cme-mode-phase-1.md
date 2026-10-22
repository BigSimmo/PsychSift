# CME Mode — Phase 1 Implementation Plan

**Status:** maintained implementation reference; original task checkboxes are not a live queue.

_Updated 2026-10-21 — added lifecycle routing and replaced retired clock example; Documentation owns._

The core workflow exists in [the current CME source](../../../src/lib/cme/) and
[phone journey](../../../tests/ui-cme-phone.spec.ts). Read the
[current design decisions](../../cme/design/cme-design-decisions.md), including the
23 September owner decisions, before using the original tasks below. Those decisions
supersede earlier capture, peer-review and year-finalisation proposals. Use
[task lifecycle and receipt handoff](../../task-receipts.md) for current ownership,
residual scope and acceptance. Source existence does not establish that every planned
capability is complete, migrations were applied, or the app was deployed.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an eighteenth app mode, `cme`, giving one Australian-registered doctor a phone-first place to record continuing professional development, see whether they are on pace, and prove it — built to the Medical Board's national requirement with an optional college overlay.

**Architecture:** Four owner-scoped Postgres tables. `cme_years` stamps a requirement set onto a year permanently; `cme_requirements` holds one row per requirement with its shape in a discriminated JSON `spec` column, so a shape the design does not yet draw — a trainee's weekly supervision cadence, a count scoped to a rotation — is a code change rather than a migration against the live clinical database. `cme_entries` and `cme_allocations` are one-to-many, because a single activity legitimately counts toward more than one requirement. Every judgement about whether a requirement is met is a pure function over those rows in `src/lib/cme/`, unit-tested exhaustively and never computed in a component: a tracker that says "met" when it is not is the one failure this design exists to prevent. The whole CPD year — which year an entry belongs to, how many days remain, what the current rate projects to — is computed in `Australia/Perth`, never in UTC.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6 strict, Zod 4, Supabase Postgres, Tailwind 4 with `@theme` tokens, Vitest, Playwright.

**Spec:** `docs/cme/design/cme-design-decisions.md` — read it before Task 1. The plan argues from it and does not repeat its reasoning. The 21 screen boards it refers to are at https://claude.ai/artifact/8JcbnkbN8Xdbvsa4VMG4pn.

## Global Constraints

Copied verbatim from the spec and the repository rules. Every task's requirements implicitly include this section.

- **The app never asserts a regulatory requirement.** Every target is owner-confirmed data carrying the date it was confirmed and the document it came from, and that provenance renders on every screen showing a target. No figure from the spec is hard-coded as a default.
- **Never pro-rata for part-time work.** No code path may reduce a target because of hours worked. A status-transition adjustment is a separate, owner-entered record and is never computed.
- **All CPD-year arithmetic is in `Australia/Perth`.** Which year an entry falls in, days remaining, and the pace projection. Never `new Date()` compared in UTC — an activity logged on the evening of 31 December otherwise lands in the wrong year.
- **`owner_id` is `not null`** on every new table. None of this data has a public state. The owner is always taken from the validated session, never from a request body or query string.
- **The owner predicate rides the same fluent chain as `.from()`** — `supabase.from("cme_entries").select(...).eq("owner_id", ownerId)` — or `npm run check:owner-scope` cannot prove it.
- **Capture records document titles and dwell time only, never search text.** `src/lib/query-privacy.ts` stores a hash rather than the query, and nothing in this mode may reverse that. (Phase 1 builds no capture; the constraint binds any code touched here.)
- **Tap targets are `min-h-12` / `min-h-tap` (48px). Never `min-h-11`.**
- **No raw hex, no `shadow-sm|md|lg`, no arbitrary `text-[…px]`, no `z-[N]` outside the ladder, no `duration-200`, no `dark:` colour overrides.** Tokens only.
- **No red, amber or green anywhere in this mode.** A shortfall is position, weight and words. The clinical status colours are reserved for clinical states. Status is never signalled by colour alone, and a number is never painted in a status colour.
- **No ring, gauge, streak, badge or confetti.** `Progress` is the only sanctioned progress primitive.
- **Reordering is never drag-only.** Move-up / move-down buttons are the contract (WCAG 2.2 SC 2.5.7).
- **`aria-live` only on an `sr-only` node.** A visible banner is not itself a live region.
- **Every `<button type="button">` has an `onClick`, a `disabled`, or an `aria-disabled`** — never `disabled` and `aria-disabled` together.
- **Internal navigation via `<Link>` / `router.push` / server `redirect()`.** Never a raw `<a href="/…">`.
- **Signed out in production shows no entry content**, only a sign-in action. Synthetic fixtures appear only in demo mode.
- **The PR body must carry:** `RAG impact: no retrieval behaviour change — new owner-scoped continuing-education mode; no change to retrieval, ranking, the RPCs, or the eval fixtures.`
- **The migration merges only inside an approved window, owner-merged, with auto-merge never armed.** Merging a `supabase/migrations/**` change to `main` reaches the live clinical database within seconds and there is no deploy step in between. The PR must not claim any deferred deploy.
- **Run `npm run format` and commit the result before every push.**

## Scope

This plan is **Phase 1 only**: the mode, the requirement model, capture, the log and the dashboard. It ships working software — the owner can record CPD, see where he stands, and copy an entry into his CPD home.

Phases 2 to 4 are scoped at the end. Each gets its own plan when its predecessor lands. Phase 3 cannot be planned in detail at all until the owner gives the privacy ruling that section 6 of the spec names.

**Before Task 1, read the two stale-plan warnings in Task 7.** `docs/superpowers/plans/2026-09-04-on-call-mode.md` is the nearest precedent and three of its literals no longer match shipped code.

---

### Task 1: The CPD year, in Perth

Everything downstream depends on two questions: which year does this activity belong to, and how far through the year are we. Both are wrong in UTC. Perth is UTC+8 with no daylight saving, so an activity logged at 07:00 on 1 January lands in the previous year if the comparison is made in UTC — silently, in the one record a doctor cannot afford to have wrong.

**Files:**

- Create: `src/lib/cme/cpd-year.ts`
- Test: `tests/cme-cpd-year.test.ts`

**Interfaces:**

- Produces: `CPD_TIME_ZONE`, `CPD_PACE_MINIMUM_ELAPSED_DAYS`, `perthCalendarDate(instant: Date): string`, `cpdYearOf(instant: Date): number`, `cpdYearBounds(year: number): { start: string; end: string }`, `daysInCpdYear(year: number): number`, `daysElapsedInCpdYear(instant: Date, year: number): number`, `daysRemainingInCpdYear(instant: Date, year: number): number`, `paceProjection(args: { hoursSoFar: number; targetHours: number; instant: Date; year: number }): { projectedHours: number; shortfallHours: number } | null`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/cme-cpd-year.test.ts
import { describe, expect, it } from "vitest";

import {
  CPD_PACE_MINIMUM_ELAPSED_DAYS,
  cpdYearBounds,
  cpdYearOf,
  daysElapsedInCpdYear,
  daysInCpdYear,
  daysRemainingInCpdYear,
  paceProjection,
  perthCalendarDate,
} from "@/lib/cme/cpd-year";

describe("the CPD year is a Perth year", () => {
  it("puts the first hours of a Perth new year in the new year, though UTC is still in the old one", () => {
    // 07:00 on 1 January 2027 in Perth is 23:00 on 31 December 2026 in UTC.
    const instant = new Date("2026-12-31T23:00:00Z");
    expect(perthCalendarDate(instant)).toBe("2027-01-01");
    expect(cpdYearOf(instant)).toBe(2027);
    expect(instant.getUTCFullYear()).toBe(2026); // the bug this function exists to prevent
  });

  it("puts a late Perth evening on 31 December in the year that is closing", () => {
    // 22:00 on 31 December 2026 in Perth is 14:00 the same day in UTC.
    const instant = new Date("2026-12-31T14:00:00Z");
    expect(perthCalendarDate(instant)).toBe("2026-12-31");
    expect(cpdYearOf(instant)).toBe(2026);
  });

  it("runs the year from 1 January to 31 December", () => {
    expect(cpdYearBounds(2026)).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    expect(daysInCpdYear(2026)).toBe(365);
    expect(daysInCpdYear(2028)).toBe(366);
  });

  it("counts elapsed and remaining days from a Perth calendar date", () => {
    const instant = new Date("2026-09-19T02:00:00Z"); // 10:00, 19 September, Perth
    expect(daysElapsedInCpdYear(instant, 2026)).toBe(262);
    expect(daysRemainingInCpdYear(instant, 2026)).toBe(103);
  });
});

describe("pace", () => {
  it("projects the year's total from the rate so far", () => {
    const projection = paceProjection({
      hoursSoFar: 32.5,
      targetHours: 50,
      instant: new Date("2026-09-19T02:00:00Z"),
      year: 2026,
    });
    expect(projection).not.toBeNull();
    expect(projection!.projectedHours).toBeCloseTo(45.27, 1);
    expect(projection!.shortfallHours).toBeCloseTo(4.73, 1);
  });

  it("reports no shortfall when the rate finishes the year", () => {
    const projection = paceProjection({
      hoursSoFar: 40,
      targetHours: 50,
      instant: new Date("2026-09-19T02:00:00Z"),
      year: 2026,
    });
    expect(projection!.shortfallHours).toBe(0);
  });

  it("says nothing in January, because a rate from a fortnight is noise", () => {
    expect(
      paceProjection({
        hoursSoFar: 1.5,
        targetHours: 50,
        instant: new Date("2026-01-06T02:00:00Z"),
        year: 2026,
      }),
    ).toBeNull();
    expect(CPD_PACE_MINIMUM_ELAPSED_DAYS).toBe(28);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:focused -- --files tests/cme-cpd-year.test.ts`
Expected: FAIL — `Cannot find module '@/lib/cme/cpd-year'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/cme/cpd-year.ts
/**
 * The CPD year is a Perth year.
 *
 * Perth is UTC+8 with no daylight saving. Every date question this mode asks —
 * which year an activity belongs to, how far through the year we are, what the
 * current rate projects to — must be asked in that zone. Asked in UTC, an
 * activity logged between midnight and 08:00 on 1 January is filed against the
 * year that just closed, which is silent and wrong in the one record its owner
 * cannot afford to have wrong.
 *
 * `en-CA` is not a locale choice: it is the one built-in locale whose short date
 * format is already `YYYY-MM-DD`, so no reassembly is needed.
 */
export const CPD_TIME_ZONE = "Australia/Perth";

/**
 * Below this, a projection is arithmetic on noise: four weeks of a 52-week year
 * cannot say anything useful about December, and a confident wrong number in
 * January is worse than silence. The dashboard renders nothing about pace while
 * `paceProjection` returns null.
 */
export const CPD_PACE_MINIMUM_ELAPSED_DAYS = 28;

const perthDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CPD_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const MS_PER_DAY = 86_400_000;

export function perthCalendarDate(instant: Date): string {
  return perthDateFormatter.format(instant);
}

export function cpdYearOf(instant: Date): number {
  return Number.parseInt(perthCalendarDate(instant).slice(0, 4), 10);
}

export function cpdYearBounds(year: number): { start: string; end: string } {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function daysInCpdYear(year: number): number {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return isLeap ? 366 : 365;
}

/** Whole days from 1 January of `year` to the Perth calendar date of `instant`, inclusive of the first. */
export function daysElapsedInCpdYear(instant: Date, year: number): number {
  const today = Date.parse(`${perthCalendarDate(instant)}T00:00:00Z`);
  const start = Date.parse(`${year}-01-01T00:00:00Z`);
  return Math.round((today - start) / MS_PER_DAY) + 1;
}

export function daysRemainingInCpdYear(instant: Date, year: number): number {
  return daysInCpdYear(year) - daysElapsedInCpdYear(instant, year);
}

export function paceProjection(args: {
  hoursSoFar: number;
  targetHours: number;
  instant: Date;
  year: number;
}): { projectedHours: number; shortfallHours: number } | null {
  const elapsed = daysElapsedInCpdYear(args.instant, args.year);
  if (elapsed < CPD_PACE_MINIMUM_ELAPSED_DAYS) return null;
  const projectedHours = (args.hoursSoFar / elapsed) * daysInCpdYear(args.year);
  return { projectedHours, shortfallHours: Math.max(0, args.targetHours - projectedHours) };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm run test:focused -- --files tests/cme-cpd-year.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cme/cpd-year.ts tests/cme-cpd-year.test.ts
git commit -m "feat(cme): the CPD year is a Perth year, not a UTC one"
```

---

### Task 2: The requirement model and the evaluator

This is the safety-critical core of the mode. A tracker that reports "met" when a requirement is not met is the one failure the whole design exists to prevent, and it happens when the model can only express hours in one category. Four shapes, and the evaluator is a pure function so it can be tested exhaustively without a database or a browser.

**Files:**

- Create: `src/lib/cme/types.ts`, `src/lib/cme/evaluate.ts`
- Test: `tests/cme-evaluate.test.ts`

**Interfaces:**

- Consumes: nothing from Task 1 at the type level; `evaluateYear` takes the instant so the caller supplies it.
- Produces: `CmeCategory`, `cmeCategories`, `CmeRequirementSpec`, `CmeRequirement`, `CmeAllocation`, `CmeEntry`, `CmeRequirementSet`, `CmeRequirementStatus`, `evaluateRequirement(requirement, entries): CmeRequirementStatus`, `evaluateYear(args): CmeYearStatus`, `totalAllocatedHours(entries): number`.

- [ ] **Step 1: Write the types**

```ts
// src/lib/cme/types.ts
export const cmeCategories = ["educational", "reviewing", "measuring"] as const;
export type CmeCategory = (typeof cmeCategories)[number];

export const cmeCategoryLabels: Record<CmeCategory, string> = {
  educational: "Educational activities",
  reviewing: "Reviewing performance",
  measuring: "Measuring outcomes",
};

/**
 * Four shapes, because three of them cannot be expressed as hours in a category
 * and every tracker that models only the first quietly misses them.
 *
 * The shape lives in a JSON `spec` column rather than in columns of its own, so
 * a shape this design does not yet draw — a trainee's weekly supervision
 * cadence, a count scoped to a rotation — is a code change rather than a
 * migration against the live clinical database.
 */
export type CmeRequirementSpec =
  | { shape: "hours-in-category"; category: CmeCategory; minimumHours: number }
  | {
      shape: "hours-across-categories";
      categories: readonly CmeCategory[];
      minimumHours: number;
      /** Each named category must also reach this on its own. */
      minimumEachHours: number;
    }
  | { shape: "activity-count"; buckets: readonly string[]; minimumPerBucket: number }
  | { shape: "task" };

export type CmeRequirementSource = "national" | "college";

export type CmeRequirement = {
  readonly id: string;
  readonly label: string;
  readonly source: CmeRequirementSource;
  readonly spec: CmeRequirementSpec;
  /** For `task` requirements only: whether the owner has marked it done. */
  readonly completedOn: string | null;
};

export type CmeAllocation = { readonly category: CmeCategory; readonly hours: number };

export type CmeEntry = {
  readonly id: string;
  /** Perth calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  readonly title: string;
  readonly allocations: readonly CmeAllocation[];
  readonly reflection: string;
  readonly costCents: number | null;
  readonly transcribed: boolean;
  readonly routineId: string | null;
  readonly documentId: string | null;
  /** Free-text buckets this entry counts toward, for `activity-count` requirements. */
  readonly buckets: readonly string[];
};

export type CmeRequirementSet = {
  readonly year: number;
  /** When the owner confirmed these targets, and against what. Rendered on every screen showing a target. */
  readonly confirmedOn: string;
  readonly confirmedSource: string;
  readonly totalHours: number;
  readonly requirements: readonly CmeRequirement[];
};

export type CmeRequirementStatus = {
  readonly requirementId: string;
  readonly met: boolean;
  /** Null for shapes with no single scalar, such as a per-bucket count. */
  readonly progress: { readonly value: number; readonly target: number } | null;
  /** One plain sentence: "Met", "3 hours short", "Ethical practice has nothing against it yet". */
  readonly summary: string;
};
```

- [ ] **Step 2: Write the failing test, leading with the case that matters most**

```ts
// tests/cme-evaluate.test.ts
import { describe, expect, it } from "vitest";

import { evaluateRequirement, evaluateYear, totalAllocatedHours } from "@/lib/cme/evaluate";
import type { CmeEntry, CmeRequirement } from "@/lib/cme/types";

function entry(date: string, allocations: CmeEntry["allocations"], buckets: readonly string[] = []): CmeEntry {
  return {
    id: `e-${date}-${allocations.map((a) => a.category).join("-")}`,
    date,
    title: "An activity",
    allocations,
    reflection: "",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets,
  };
}

const combined: CmeRequirement = {
  id: "combined",
  label: "Reviewing + measuring, combined",
  source: "national",
  completedOn: null,
  spec: {
    shape: "hours-across-categories",
    categories: ["reviewing", "measuring"],
    minimumHours: 25,
    minimumEachHours: 5,
  },
};

describe("a combined minimum with a floor in each category", () => {
  it("is NOT met when the total is reached but one category is under its floor", () => {
    // 25 hours combined, but only 2 in measuring. This is the exact shape a
    // tracker that models only totals reports as compliant, and it is the
    // failure this model exists to prevent.
    const entries = [
      entry("2026-03-01", [{ category: "reviewing", hours: 23 }]),
      entry("2026-04-01", [{ category: "measuring", hours: 2 }]),
    ];
    const status = evaluateRequirement(combined, entries);
    expect(status.met).toBe(false);
    expect(status.summary).toBe("3 hours short in measuring outcomes");
  });

  it("is met when both the total and both floors are reached", () => {
    const entries = [
      entry("2026-03-01", [{ category: "reviewing", hours: 19 }]),
      entry("2026-04-01", [{ category: "measuring", hours: 6 }]),
    ];
    expect(evaluateRequirement(combined, entries).met).toBe(true);
  });

  it("reports the larger of the two gaps when both the total and a floor are short", () => {
    const entries = [
      entry("2026-03-01", [{ category: "reviewing", hours: 8 }]),
      entry("2026-04-01", [{ category: "measuring", hours: 2 }]),
    ];
    const status = evaluateRequirement(combined, entries);
    expect(status.met).toBe(false);
    expect(status.progress).toEqual({ value: 10, target: 25 });
    expect(status.summary).toBe("15 hours short");
  });
});

describe("the other three shapes", () => {
  it("counts hours in one category", () => {
    const requirement: CmeRequirement = {
      id: "educational",
      label: "Educational activities",
      source: "national",
      completedOn: null,
      spec: { shape: "hours-in-category", category: "educational", minimumHours: 12.5 },
    };
    const entries = [entry("2026-02-01", [{ category: "educational", hours: 15 }])];
    const status = evaluateRequirement(requirement, entries);
    expect(status.met).toBe(true);
    expect(status.summary).toBe("Met");
  });

  it("counts activities per bucket, not hours", () => {
    const requirement: CmeRequirement = {
      id: "domains",
      label: "Practice domains",
      source: "national",
      completedOn: null,
      spec: {
        shape: "activity-count",
        buckets: ["Culturally safe practice", "Health inequities", "Professionalism", "Ethical practice"],
        minimumPerBucket: 1,
      },
    };
    const entries = [
      entry("2026-02-01", [{ category: "educational", hours: 1 }], ["Culturally safe practice"]),
      entry("2026-03-01", [{ category: "educational", hours: 1 }], ["Health inequities"]),
      entry("2026-04-01", [{ category: "educational", hours: 1 }], ["Professionalism"]),
    ];
    const status = evaluateRequirement(requirement, entries);
    expect(status.met).toBe(false);
    expect(status.progress).toEqual({ value: 3, target: 4 });
    expect(status.summary).toBe("Ethical practice has nothing against it yet");
  });

  it("treats a task as done only when the owner marked it done", () => {
    const base: CmeRequirement = {
      id: "plan",
      label: "Development plan",
      source: "national",
      completedOn: null,
      spec: { shape: "task" },
    };
    expect(evaluateRequirement(base, []).met).toBe(false);
    expect(evaluateRequirement({ ...base, completedOn: "2026-01-12" }, []).met).toBe(true);
  });
});

describe("the target is the owner's number, always", () => {
  it("reports back exactly the minimum the requirement declares, and nothing derived from it", () => {
    const requirement: CmeRequirement = {
      id: "educational",
      label: "Educational activities",
      source: "national",
      completedOn: null,
      spec: { shape: "hours-in-category", category: "educational", minimumHours: 12.5 },
    };
    // There is no third argument. No fraction, no full-time equivalent, no
    // profile — the evaluator cannot reduce a target because there is nothing
    // to reduce it with, and `evaluateRequirement.length` proves it.
    expect(evaluateRequirement.length).toBe(2);
    expect(evaluateRequirement(requirement, []).progress).toEqual({ value: 0, target: 12.5 });
  });
});

describe("an entry allocates across requirements", () => {
  it("counts one activity's hours in every category it was allocated to", () => {
    const entries = [
      entry("2026-09-11", [
        { category: "reviewing", hours: 1 },
        { category: "measuring", hours: 0.5 },
      ]),
    ];
    expect(totalAllocatedHours(entries)).toBe(1.5);
    expect(evaluateRequirement(combined, entries).progress).toEqual({ value: 1.5, target: 25 });
  });
});

describe("the whole year", () => {
  it("returns a status per requirement and the year's total hours", () => {
    const result = evaluateYear({
      set: {
        year: 2026,
        confirmedOn: "2026-09-19",
        confirmedSource: "Medical Board CPD registration standard",
        totalHours: 50,
        requirements: [combined],
      },
      entries: [
        entry("2026-03-01", [{ category: "reviewing", hours: 8 }]),
        entry("2026-04-01", [{ category: "measuring", hours: 2 }]),
      ],
    });
    expect(result.totalHours).toBe(10);
    expect(result.statuses).toHaveLength(1);
    expect(result.unmet.map((status) => status.requirementId)).toEqual(["combined"]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm run test:focused -- --files tests/cme-evaluate.test.ts`
Expected: FAIL — `Cannot find module '@/lib/cme/evaluate'`.

- [ ] **Step 4: Implement the evaluator**

```ts
// src/lib/cme/evaluate.ts
import {
  cmeCategoryLabels,
  type CmeCategory,
  type CmeEntry,
  type CmeRequirement,
  type CmeRequirementSet,
  type CmeRequirementStatus,
} from "@/lib/cme/types";

export type CmeYearStatus = {
  readonly totalHours: number;
  readonly statuses: readonly CmeRequirementStatus[];
  readonly unmet: readonly CmeRequirementStatus[];
};

function hoursIn(entries: readonly CmeEntry[], category: CmeCategory): number {
  let total = 0;
  for (const entry of entries) {
    for (const allocation of entry.allocations) {
      if (allocation.category === category) total += allocation.hours;
    }
  }
  return round2(total);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function hoursWord(hours: number): string {
  return `${round2(hours)} hour${round2(hours) === 1 ? "" : "s"} short`;
}

export function totalAllocatedHours(entries: readonly CmeEntry[]): number {
  return round2(entries.reduce((sum, entry) => sum + entry.allocations.reduce((inner, a) => inner + a.hours, 0), 0));
}

/**
 * Two arguments, deliberately and permanently. There is no third parameter for
 * a fraction, a full-time equivalent or a working pattern, because no such
 * input may ever reduce a target: part-time work does not lower the
 * requirement, and a tracker that quietly lowered it would be the most
 * dangerous thing in this design. A legitimate status-transition adjustment is
 * a different target on a different year, entered by the owner, never computed
 * here.
 */
export function evaluateRequirement(requirement: CmeRequirement, entries: readonly CmeEntry[]): CmeRequirementStatus {
  const spec = requirement.spec;
  switch (spec.shape) {
    case "hours-in-category": {
      const value = hoursIn(entries, spec.category);
      const met = value >= spec.minimumHours;
      return {
        requirementId: requirement.id,
        met,
        progress: { value, target: spec.minimumHours },
        summary: met ? "Met" : hoursWord(spec.minimumHours - value),
      };
    }
    case "hours-across-categories": {
      const perCategory = spec.categories.map((category) => ({ category, value: hoursIn(entries, category) }));
      const value = round2(perCategory.reduce((sum, item) => sum + item.value, 0));
      const combinedShort = Math.max(0, spec.minimumHours - value);
      const floorShort = perCategory
        .map((item) => ({ ...item, short: Math.max(0, spec.minimumEachHours - item.value) }))
        .filter((item) => item.short > 0)
        .sort((a, b) => b.short - a.short);
      const met = combinedShort === 0 && floorShort.length === 0;
      // Report the bigger gap, because that is the one that decides what to do next.
      const summary = met
        ? "Met"
        : combinedShort >= (floorShort[0]?.short ?? 0)
          ? hoursWord(combinedShort)
          : `${hoursWord(floorShort[0]!.short).replace(" short", "")} short in ${cmeCategoryLabels[floorShort[0]!.category].toLowerCase()}`;
      return { requirementId: requirement.id, met, progress: { value, target: spec.minimumHours }, summary };
    }
    case "activity-count": {
      const filled = spec.buckets.filter(
        (bucket) => entries.filter((entry) => entry.buckets.includes(bucket)).length >= spec.minimumPerBucket,
      );
      const empty = spec.buckets.filter((bucket) => !filled.includes(bucket));
      const met = empty.length === 0;
      return {
        requirementId: requirement.id,
        met,
        progress: { value: filled.length, target: spec.buckets.length },
        summary: met
          ? "Met"
          : empty.length === 1
            ? `${empty[0]} has nothing against it yet`
            : `${empty.length} of ${spec.buckets.length} have nothing against them yet`,
      };
    }
    case "task": {
      const met = requirement.completedOn !== null;
      return {
        requirementId: requirement.id,
        met,
        progress: null,
        summary: met ? `Done ${requirement.completedOn}` : "Not started",
      };
    }
  }
}

export function evaluateYear(args: { set: CmeRequirementSet; entries: readonly CmeEntry[] }): CmeYearStatus {
  const statuses = args.set.requirements.map((requirement) => evaluateRequirement(requirement, args.entries));
  return {
    totalHours: totalAllocatedHours(args.entries),
    statuses,
    unmet: statuses.filter((status) => !status.met),
  };
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npm run test:focused -- --files tests/cme-evaluate.test.ts`
Expected: PASS, 10 tests. If the two `summary` strings differ by wording, change the test to the wording you shipped — but never change an assertion about `met`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cme tests/cme-evaluate.test.ts
git commit -m "feat(cme): four requirement shapes, and an evaluator that cannot lower a target"
```

---

### Task 3: The demo corpus

Every screen in this mode has to render before a database exists, and the browser tests in Task 16 assert against it. A module with no data draws nothing, and an assertion against an empty page proves nothing.

**Files:**

- Create: `src/lib/cme/demo-year.ts`
- Test: `tests/cme-demo-year.test.ts`

**Interfaces:**

- Consumes: `CmeRequirementSet`, `CmeEntry` from Task 2.
- Produces: `DEMO_CME_YEAR: CmeRequirementSet`, `DEMO_CME_ENTRIES: readonly CmeEntry[]`, `DEMO_CME_INSTANT: Date`.

- [ ] **Step 1: Write the corpus**

Follow the rule stated in `src/lib/on-call/demo-entries.ts`: everything obviously synthetic, and **nothing that states a clinical fact — no dose, no threshold, no criterion**. Activity titles are safe; clinical content is not.

The figures must match the design boards exactly, because Task 16's assertions and Task 17's pixel baselines both read them: 47 entries totalling 32.5 hours; educational 15.0; reviewing 8.0; measuring 2.0; peer review 7.0 of 10; three of four practice domains filled with "Ethical practice" empty; plan written 12 January; self-evaluation not started; 9 entries with evidence and 3 without; 14 not transcribed. `DEMO_CME_INSTANT` is `new Date("2026-09-19T02:00:00Z")` — the same frozen instant the browser tests use.

- [ ] **Step 2: Write the test that keeps the corpus honest**

```ts
// tests/cme-demo-year.test.ts
import { describe, expect, it } from "vitest";

import { DEMO_CME_ENTRIES, DEMO_CME_INSTANT, DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import { evaluateYear, totalAllocatedHours } from "@/lib/cme/evaluate";
import { cpdYearOf } from "@/lib/cme/cpd-year";

describe("the demo year", () => {
  it("matches the figures the design boards and the pixel baselines assume", () => {
    expect(DEMO_CME_ENTRIES).toHaveLength(47);
    expect(totalAllocatedHours(DEMO_CME_ENTRIES)).toBe(32.5);
    expect(cpdYearOf(DEMO_CME_INSTANT)).toBe(2026);
  });

  it("leaves exactly the gaps the screens are drawn around", () => {
    const result = evaluateYear({ set: DEMO_CME_YEAR, entries: DEMO_CME_ENTRIES });
    expect(result.unmet.map((status) => status.requirementId).sort()).toEqual(
      ["combined", "domains", "measuring", "peer-review", "self-evaluation"].sort(),
    );
  });

  it("states no clinical fact", () => {
    const text = DEMO_CME_ENTRIES.map((entry) => `${entry.title} ${entry.reflection}`).join(" ");
    expect(text).not.toMatch(/\b\d+(?:\.\d+)?\s?(?:mg|mcg|mmol|ng\/mL|units?)\b/i);
  });

  it("lives inside its year", () => {
    for (const entry of DEMO_CME_ENTRIES) expect(entry.date.startsWith("2026-")).toBe(true);
  });
});
```

- [ ] **Step 3: Run both test files**

Run: `npm run test:focused -- --files tests/cme-demo-year.test.ts tests/cme-evaluate.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/cme/demo-year.ts tests/cme-demo-year.test.ts
git commit -m "feat(cme): a synthetic year every screen and every browser test can draw"
```

---

### Task 4: The migration and the schema mirror

**Read `AGENTS.md` "Supabase project safety" before writing a line of SQL.** Merging a `supabase/migrations/**` change to `main` reaches the live clinical database within seconds. This PR is owner-merged, inside an approved window, with auto-merge never armed, and its body must not claim any deferred deploy — there is no deploy step to defer to.

Four tables. `owner_id` rather than `user_id` is not a style choice: `scripts/lib/tenancy-scan.mjs` derives its table tiers from the column name, and a table carrying neither falls into an untiered bucket that fails the scan unless declared with a reason.

**Files:**

- Create: `supabase/migrations/<YYYYMMDDHHMMSS>_cme_tables.sql`
- Modify: `supabase/schema.sql`, `src/lib/supabase/database.types.ts`
- Test: `tests/cme-schema.test.ts`

**Interfaces:**

- Produces: tables `cme_years`, `cme_requirements`, `cme_entries`, `cme_allocations`, `cme_routines`; `Database["public"]["Tables"]["cme_entries"]` etc. in the hand-curated types file.

- [ ] **Step 1: Write the migration**

Name it `YYYYMMDDHHMMSS_cme_tables.sql` with a 14-digit UTC timestamp. `scripts/pr-policy.mjs` fails a file with no 14-digit prefix, one dated before the newest migration already on `main`, or one more than two days in the future — so generate the stamp at the moment you write it: `date -u +%Y%m%d%H%M%S`.

Do not wrap it in `begin`/`commit`: the Supabase integration applies each migration in one transaction already. Nothing here needs `CREATE INDEX CONCURRENTLY`, which could not ship this way if it did.

```sql
-- CME: an owner's continuing-education record.
--
-- Single-owner, single-layer tenancy, the same design as `on_call_entries`:
-- RLS on, no grant at all to anon/authenticated, service_role only, and the
-- real owner predicate is `.eq("owner_id", …)` in application code where
-- `npm run check:owner-scope` can prove it.
--
-- `cme_requirements.spec` is jsonb rather than columns because the four
-- requirement shapes are not a fixed set: a trainee's weekly supervision
-- cadence and a count scoped to a rotation are already known to be coming, and
-- a shape change must not be a migration against the live clinical database.

create table if not exists public.cme_years (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  year smallint not null,
  total_hours numeric(6, 2) not null,
  -- Provenance travels with the targets and renders on every screen showing one.
  confirmed_on date not null,
  confirmed_source text not null,
  closed_at timestamptz,
  shortfall_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, year)
);

create table if not exists public.cme_requirements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  year_id uuid not null references public.cme_years (id) on delete cascade,
  label text not null,
  source text not null check (source in ('national', 'college')),
  spec jsonb not null,
  completed_on date,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.cme_routines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  cadence text not null check (cadence in ('weekly', 'monthly', 'quarterly')),
  usual_hours numeric(5, 2) not null,
  usual_allocations jsonb not null default '[]'::jsonb,
  next_due date,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.cme_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  year_id uuid not null references public.cme_years (id) on delete cascade,
  -- A Perth calendar date, decided by the application. Never derived from a
  -- timestamp in the database, which would be UTC and would move an entry
  -- logged after 16:00 UTC on 31 December into the wrong year.
  activity_date date not null,
  title text not null,
  reflection text not null default '',
  cost_cents integer check (cost_cents is null or cost_cents >= 0),
  transcribed_at timestamptz,
  routine_id uuid references public.cme_routines (id) on delete set null,
  document_id uuid references public.documents (id) on delete set null,
  buckets text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cme_allocations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  entry_id uuid not null references public.cme_entries (id) on delete cascade,
  category text not null check (category in ('educational', 'reviewing', 'measuring')),
  hours numeric(5, 2) not null check (hours > 0),
  unique (entry_id, category)
);

create index if not exists cme_entries_owner_year_date_idx
  on public.cme_entries (owner_id, year_id, activity_date desc);
create index if not exists cme_allocations_entry_idx
  on public.cme_allocations (entry_id);
create index if not exists cme_requirements_year_idx
  on public.cme_requirements (year_id, sort_order);

do $$
declare
  t text;
begin
  foreach t in array array['cme_years', 'cme_requirements', 'cme_routines', 'cme_entries', 'cme_allocations']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    execute format('drop policy if exists "%s service role all" on public.%I', t, t);
    execute format(
      'create policy "%s service role all" on public.%I for all to service_role using (true) with check (true)',
      t, t
    );
  end loop;
end
$$;
```

- [ ] **Step 2: Mirror it into `supabase/schema.sql` and the hand-curated types**

`src/lib/supabase/database.types.ts` is hand-curated — there is no regeneration script in this repo. Add a `Row`, `Insert` and `Update` block per table, matching the SQL exactly.

- [ ] **Step 3: Write the schema test**

```ts
// tests/cme-schema.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");

describe("the CME tables", () => {
  for (const table of ["cme_years", "cme_requirements", "cme_routines", "cme_entries", "cme_allocations"]) {
    it(`${table} is owner-scoped, RLS-on and unreachable without the service role`, () => {
      expect(schema).toMatch(new RegExp(`create table[^;]*public\\.${table}[^;]*owner_id uuid not null`, "s"));
      expect(schema).toMatch(new RegExp(`alter table public\\.${table} enable row level security`));
      expect(schema).toMatch(new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
    });
  }

  it("stores the activity date as a date, not a timestamp", () => {
    // A timestamptz would be read back in UTC and would move an entry logged on
    // the evening of 31 December in Perth into the following year.
    expect(schema).toMatch(/create table[^;]*public\.cme_entries[^;]*activity_date date not null/s);
    expect(schema).not.toMatch(/create table[^;]*public\.cme_entries[^;]*activity_date timestamp/s);
  });

  it("lets one entry allocate to several categories but never twice to one", () => {
    expect(schema).toMatch(/create table[^;]*public\.cme_allocations[^;]*unique \(entry_id, category\)/s);
  });
});
```

- [ ] **Step 4: Run the offline database gates**

Run: `npm run test:focused -- --files tests/cme-schema.test.ts && npm run check:migration-role && npm run check:migration-immutability && npm run check:function-grants`
Expected: all PASS. `check:migration-immutability` may ask you to seal the new file — `npm run migrations:seal`, which is append-only.

- [ ] **Step 5: Commit**

```bash
git add supabase src/lib/supabase/database.types.ts tests/cme-schema.test.ts
git commit -m "feat(cme): owner-scoped tables for years, requirements, entries and allocations"
```

---

### Task 5: Row mapping and the owner-scoped repository

Copy the shape of `src/lib/on-call/repository.ts` exactly: the Supabase client is a **required first parameter**, never obtained inside the module. That is this repository's testability seam, and it is also what keeps the owner predicate on the same fluent chain as `.from()`, which is the only form `npm run check:owner-scope` can prove.

**Files:**

- Create: `src/lib/cme/repository.ts`
- Test: `tests/cme-repository.test.ts`

**Interfaces:**

- Consumes: `CmeEntry`, `CmeRequirementSet` from Task 2.
- Produces: `rowToCmeEntry(row)`, `cmeEntryToRow(entry, ownerId, yearId)`, `fetchOwnerCmeYear(supabase, ownerId, year)`, `fetchOwnerCmeEntries(supabase, ownerId, yearId)`, `insertCmeEntry(supabase, ownerId, yearId, entry)`, `CME_MAX_ENTRIES = 2000`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/cme-repository.test.ts
import { describe, expect, it } from "vitest";

import { cmeEntryToRow, rowToCmeEntry } from "@/lib/cme/repository";

describe("row mapping", () => {
  it("round-trips an entry with several allocations", () => {
    const entry = {
      id: "11111111-1111-4111-8111-111111111111",
      date: "2026-09-11",
      title: "Peer review group — September",
      allocations: [
        { category: "reviewing" as const, hours: 1 },
        { category: "measuring" as const, hours: 0.5 },
      ],
      reflection: "Brought two cases to the group.",
      costCents: null,
      transcribed: false,
      routineId: null,
      documentId: null,
      buckets: [],
    };
    const row = cmeEntryToRow(entry, "owner-1", "year-1");
    expect(row.activity_date).toBe("2026-09-11");
    expect(row.owner_id).toBe("owner-1");
    expect(
      rowToCmeEntry(
        { ...row, id: entry.id },
        entry.allocations.map((a) => ({ category: a.category, hours: a.hours })),
      ),
    ).toEqual(entry);
  });

  it("carries a cost through as whole cents, never a float", () => {
    const row = cmeEntryToRow({ ...baseEntry(), costCents: 124_000 }, "owner-1", "year-1");
    expect(row.cost_cents).toBe(124_000);
    expect(Number.isInteger(row.cost_cents)).toBe(true);
  });
});

function baseEntry() {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    date: "2026-08-22",
    title: "WA Branch training day",
    allocations: [{ category: "educational" as const, hours: 6 }],
    reflection: "",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
  };
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:focused -- --files tests/cme-repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement, keeping every owner predicate on the `.from()` chain**

```ts
// src/lib/cme/repository.ts
import type { createAdminClient } from "@/lib/supabase/admin";
import type { CmeEntry } from "@/lib/cme/types";

type AdminClient = ReturnType<typeof createAdminClient>;

/** A generous ceiling on one owner's year, so a runaway import cannot page forever. */
export const CME_MAX_ENTRIES = 2000;

export function cmeEntryToRow(entry: CmeEntry, ownerId: string, yearId: string) {
  return {
    owner_id: ownerId,
    year_id: yearId,
    activity_date: entry.date,
    title: entry.title,
    reflection: entry.reflection,
    cost_cents: entry.costCents,
    transcribed_at: entry.transcribed ? new Date().toISOString() : null,
    routine_id: entry.routineId,
    document_id: entry.documentId,
    buckets: [...entry.buckets],
  };
}

export function rowToCmeEntry(
  row: Record<string, unknown>,
  allocations: readonly { category: CmeEntry["allocations"][number]["category"]; hours: number }[],
): CmeEntry {
  return {
    id: String(row.id),
    date: String(row.activity_date),
    title: String(row.title),
    allocations: allocations.map((allocation) => ({ ...allocation })),
    reflection: String(row.reflection ?? ""),
    costCents: row.cost_cents == null ? null : Number(row.cost_cents),
    transcribed: row.transcribed_at != null,
    routineId: row.routine_id == null ? null : String(row.routine_id),
    documentId: row.document_id == null ? null : String(row.document_id),
    buckets: Array.isArray(row.buckets) ? row.buckets.map(String) : [],
  };
}

export async function fetchOwnerCmeEntries(
  supabase: AdminClient,
  ownerId: string,
  yearId: string,
): Promise<CmeEntry[]> {
  if (!ownerId) throw new Error("CME entries were requested without an ownerId; refusing to run.");
  // The owner predicate rides the same chain as `.from()`. `npm run check:owner-scope`
  // cannot prove it in any other form, and this is the single regression class this
  // tenancy design is exposed to.
  const { data, error } = await supabase
    .from("cme_entries")
    .select("*, cme_allocations(category, hours)")
    .eq("owner_id", ownerId)
    .eq("year_id", yearId)
    .order("activity_date", { ascending: false })
    .limit(CME_MAX_ENTRIES);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) =>
    rowToCmeEntry(
      row as Record<string, unknown>,
      (row as { cme_allocations?: { category: CmeEntry["allocations"][number]["category"]; hours: number }[] })
        .cme_allocations ?? [],
    ),
  );
}
```

Write `fetchOwnerCmeYear` and `insertCmeEntry` to the same pattern: client first, `ownerId` guard, `.eq("owner_id", ownerId)` on the `.from()` chain, `throw new Error(error.message)` on a Supabase error, and `PublicApiError` from `@/lib/http` for a caller fault.

- [ ] **Step 4: Run the test and the owner-scope gate**

Run: `npm run test:focused -- --files tests/cme-repository.test.ts && npm run check:owner-scope`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cme/repository.ts tests/cme-repository.test.ts
git commit -m "feat(cme): owner-scoped repository with the predicate on the from() chain"
```

---

### Task 6: The API routes

The demo branch goes **in the route, not in the repository** — the repository never learns what mode the app is in, and the route returns the synthetic corpus before `createAdminClient()` is ever called. Reads serve the corpus; writes refuse rather than fake success.

**Files:**

- Create: `src/app/api/cme/entries/route.ts`, `src/app/api/cme/entries/[id]/route.ts`, `src/app/api/cme/year/route.ts`, `src/lib/cme/schemas.ts`
- Modify: `src/lib/api-rate-limit.ts` — add a `"cme"` bucket
- Test: `tests/cme-api-contract.test.ts`

**Interfaces:**

- Consumes: the repository from Task 5, `DEMO_CME_ENTRIES` from Task 3.
- Produces: `GET/POST /api/cme/entries`, `PATCH/DELETE /api/cme/entries/[id]`, `GET/PUT /api/cme/year`.

- [ ] **Step 1: Write the Zod schemas**

```ts
// src/lib/cme/schemas.ts
import { z } from "zod";

import { cmeCategories } from "@/lib/cme/types";

const perthDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");

export const cmeAllocationSchema = z.object({
  category: z.enum(cmeCategories),
  hours: z.number().positive().max(24),
});

export const cmeEntryCreateSchema = z.object({
  date: perthDate,
  title: z.string().trim().min(1).max(200),
  allocations: z.array(cmeAllocationSchema).min(1).max(cmeCategories.length),
  reflection: z.string().max(2000).default(""),
  costCents: z.number().int().nonnegative().nullable().default(null),
  routineId: z.string().uuid().nullable().default(null),
  documentId: z.string().uuid().nullable().default(null),
  buckets: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
});

export const cmeListQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
```

- [ ] **Step 2: Write the contract test, which is what stops the owner filter being dropped later**

```ts
// tests/cme-api-contract.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routes = [
  "src/app/api/cme/entries/route.ts",
  "src/app/api/cme/entries/[id]/route.ts",
  "src/app/api/cme/year/route.ts",
].map((path) => ({ path, source: readFileSync(path, "utf8") }));

describe("the CME API", () => {
  for (const { path, source } of routes) {
    it(`${path} takes the owner from the session, never the request`, () => {
      expect(source).toMatch(/requireAuthenticatedUser\(/);
      expect(source).not.toMatch(/body\.(owner_id|ownerId)/);
      expect(source).not.toMatch(/searchParams\.get\("owner/);
    });

    it(`${path} refuses writes in demo mode rather than faking them`, () => {
      if (!/export async function (POST|PATCH|DELETE|PUT)/.test(source)) return;
      expect(source).toMatch(/isDemoMode\(\)/);
      expect(source).toMatch(/demo_mode_unavailable/);
    });
  }
});
```

- [ ] **Step 3: Write the routes, following `src/app/api/on-call/entries/route.ts` line for line**

Demo read branch before any client creation; `requireAuthenticatedUser(request, supabase)` for the owner; `parseRequestQuery(request, cmeListQuerySchema, "Invalid CME query.")`; `publicErrorResponse(…, 400, { code: "demo_mode_unavailable" })` on a demo write. Add `"cme"` to the rate-limit bucket union and give it a row.

- [ ] **Step 4: Run the gates**

Run: `npm run test:focused -- --files tests/cme-api-contract.test.ts && npm run check:owner-scope && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cme src/lib/cme/schemas.ts src/lib/api-rate-limit.ts tests/cme-api-contract.test.ts
git commit -m "feat(cme): owner-scoped API with a demo branch in the route"
```

---

### Task 7: Register the eighteenth mode

This task will not compile until every `Record<AppModeId, …>` has a `cme` key. That is the point: the compiler is the checklist. Do not guess at the list — run the typecheck and work what it prints.

**Three warnings about the nearest precedent.** `docs/superpowers/plans/2026-09-04-on-call-mode.md` is the right plan to imitate structurally, but three of its literals no longer match shipped code, and copying them would be wrong:

1. It shows On Call with `resultsSurface: "results-band"`. The shipped value is `"none"`.
2. It says to add the mode to `consolidatedModeHomePaths`. The shipped code does the opposite — On Call is in `standaloneModeHomePaths`, because a mode with no results surface should not redirect onto the search home.
3. It says to join `MODE_NAV_ADOPTED_MODES`. On Call deliberately does not; the mode pill's section level already reads the registry and a rail repeating it was two controls doing one job.

**CME follows the shipped On Call, not the plan.** CME is a dashboard with a year view; it has no results list to submit a query into. So: `resultsSurface: "none"`, standalone home, no `/cme/search`, no rail.

**Files:**

- Modify: `src/lib/app-modes.ts` (three edits: `appModeIds`, the definition, `namespaceIsolatedModes` — the third is not type-enforced and is the one people miss)
- Modify: `src/lib/ui-copy.ts`, `src/lib/category-identity.ts`, `src/lib/category-identity-icons.ts`, `src/lib/universal-search-mode-context.ts`, `src/lib/mode-secondary-navigation.ts`, `src/lib/search-command-surface.ts`, `src/lib/phone-mode-groups.ts`, `src/lib/site-content/site-content-registry.ts`, `scripts/generate-site-map.ts`
- Modify: `src/app/globals.css` — the mode identity block
- Modify: `tests/app-modes.test.ts`, `tests/ui-copy.test.ts`, `tests/shared-home-empty-state.dom.test.tsx`, `tests/mode-secondary-navigation.test.ts`, `tests/universal-also-matches-mode-coverage.test.ts`

**Interfaces:**

- Produces: `AppModeId` includes `"cme"`; `appModeHomeHref("cme")` resolves to `/cme`.

- [ ] **Step 1: Add the id, the definition and the namespace isolation**

Append `"cme"` to `appModeIds` — position matters, `tests/shared-home-empty-state.dom.test.tsx` asserts an ordered equality — and add the definition after the `on-call` entry:

```ts
  {
    id: "cme",
    label: "CME",
    description: "Your continuing education: what you have done, and what is still short",
    href: "/cme",
    search: {
      // CME reads the owner's own entries, already in the browser — a local
      // catalogue, like On Call — so it borrows the benign "tools" command kind
      // rather than adding a search kind that would have to be threaded through
      // universal search.
      kind: "tools",
      placeholder: "Search your log — a meeting, an audit, a course...",
      inputAriaLabel: "Search your continuing education log",
      submitIdleLabel: "CME",
      submitBusyLabel: "CME",
      submitAriaLabel: "Search your continuing education log",
      emptyTitle: "Search your continuing education log",
      readyTitle: "Find an activity, a certificate or a reflection",
      progressLabel: "Searching your log.",
      resultKind: "tools",
      resultHeading: "CME",
      // No results page. `/cme` is a dashboard and there is no `/cme/search`:
      // a retargeted composer would accept a query and land the reader on a
      // page that ignores it.
      resultsSurface: "none",
      statusLabel: "CME",
      nextStep: "Open an entry",
      badgeLabel: null,
    },
  },
```

Add `"cme"` to `namespaceIsolatedModes` in the same file. It is a private `Set<AppModeId>`, not type-exhaustive, so nothing will tell you if you forget — and forgetting sends `/cme` searches to `/?mode=cme&q=…` instead of `/cme?q=…`.

- [ ] **Step 2: Run the typecheck and let it enumerate the rest**

Run: `npm run typecheck`
Expected: FAIL, one error per exhaustive record missing a `cme` key. Work that list.

- [ ] **Step 3: Fill in each map**

`sharedHomePresentation` in `src/lib/ui-copy.ts`:

```ts
    cme: {
      title: "CME",
      subtitle: "What you have done this year, and what is still short.",
      suggestions: ["peer review group", "journal club", "audit"],
    },
```

`APP_MODE_ICON`: `cme: "graduationCap"` — and add `"graduationCap"` to `CATEGORY_ICON_KEYS`. `tests/category-identity.test.ts:92` requires a glyph **no other mode uses**, so check the list before choosing; `graduationCap` is free at the time of writing.

`src/lib/category-identity-icons.ts`: `graduationCap: GraduationCap`, imported from `lucide-react`.

`APP_MODE_ACCENT`: `cme: "indigo"`. That accent is already delivered through `globals.css` (which `tests/category-identity.test.ts:137` requires) and is shared with `differentials` and `therapy-compass`. The map's own comment permits sharing between modes that rarely sit in the same four-slot also-matches grid: those two are clinical reference and CME is a personal record, so they do not co-occur.

`preferredDomainsByMode`: `cme: []` — CME contributes no cross-entity universal-search domain.

`searchCommandSurfaceByMode`: non-empty `examples` and `suggestions` are required by `tests/search-command-surface.test.ts`, and `remoteSearchEnabled: false` because this catalogue is local.

`modeSecondaryNavigationRegistry`:

```ts
    cme: [
      { id: "year", label: "This year", href: "/cme" },
      { id: "log", label: "Log", href: "/cme/log" },
      { id: "routines", label: "Routines", href: "/cme/routines" },
      { id: "plan", label: "Plan", href: "/cme/plan" },
      { id: "programme", label: "Programme", href: "/cme/programme" },
    ],
```

and a matching `if (pathname === …) return "<id>"` per route in `activeModeSecondaryNavigationId`.

`src/lib/phone-mode-groups.ts`: put `"cme"` in exactly one group — `care`. The file header explains why this is not type-exhaustive and how Sources was once silently unreachable on phones.

`src/lib/site-content/site-content-registry.ts`: CME is private owner state and publishes nothing, so declare an **exclusion**, copying On Call's: `reason: "private_user_state", permanent: true, reviewed: true, reviewOwner: "clinical_content_governance"` — and add `"cme"` to the `Exclude<AppModeId, …>` union at the top of the file.

`scripts/generate-site-map.ts`: the `examples` record needs `cme: appModeHomeHref("cme", { query: "peer review group", focus: true, run: true })`.

- [ ] **Step 4: Give the mode its identity colour**

In `src/app/globals.css`, after the On Call block (around line 1096), add:

```css
/* CME: indigo. The design record's identity colour, already sanctioned in
   ckb-v2-tokens.css. Sits beside On Call's teal without inventing a new hue.
   Both values cleared as a FILL as well as as text, which is why the contrast
   partner is declared rather than assumed white. Pinned by
   `tests/design-token-contract.test.ts`. */
[data-mode-identity="cme"] {
  --mode-identity: #43508f;
  --mode-identity-soft: #eef1f9;
  --mode-identity-border: #d2d9e8;
  --mode-identity-contrast: #ffffff;

  --clinical-accent: var(--mode-identity);
  --clinical-accent-soft: var(--mode-identity-soft);
  --clinical-accent-border: var(--mode-identity-border);
  --clinical-accent-contrast: var(--mode-identity-contrast);
}

.dark [data-mode-identity="cme"] {
  --mode-identity: #97a3df;
  --mode-identity-soft: #1b2340;
  --mode-identity-border: #333c52;
  --mode-identity-contrast: #0b1019;
}
```

**Do not take those contrast ratios on trust.** Run `npm run test:focused -- --files tests/design-token-contract.test.ts` and read what it reports. If a pair fails, darken or lighten until it passes — the design record's colour is a starting point, not a licence.

- [ ] **Step 5: Update the five tests that hold complete mode lists**

Change `toHaveLength(17)` to `18` in `tests/app-modes.test.ts`, `tests/ui-copy.test.ts` and `tests/mode-secondary-navigation.test.ts`. Add the `cme` row to the submitted-search href literal in `tests/app-modes.test.ts`, to `EXPECTED_MODE_TITLES` in `tests/ui-copy.test.ts`, to `expectedPresentations` in `tests/shared-home-empty-state.dom.test.tsx` **at the same index as in `appModeIds`**, to `expectedLabels` and `cleanLandingPath` in `tests/mode-secondary-navigation.test.ts`, and to `MOUNTS` in `tests/universal-also-matches-mode-coverage.test.ts` — reusing the shared `NO_RESULTS_SURFACE` constant, because CME declares `resultsSurface: "none"`.

Run: `npm run typecheck && npm run test:focused -- --files tests/app-modes.test.ts tests/ui-copy.test.ts tests/category-identity.test.ts tests/search-command-surface.test.ts tests/shared-home-empty-state.dom.test.tsx tests/mode-secondary-navigation.test.ts tests/phone-mode-groups.test.ts tests/site-content-registry.test.ts tests/universal-also-matches-mode-coverage.test.ts tests/design-token-contract.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib src/app/globals.css scripts/generate-site-map.ts tests
git commit -m "feat(cme): register the eighteenth mode in every mode-keyed map"
```

---

### Task 8: Navigation and route ownership

**Files:**

- Modify: `src/lib/search-route-ownership.ts` (three edits), `src/lib/search-shell-props.ts`, `src/lib/consolidated-mode-home-redirect.ts` (a comment, not an entry), `src/lib/information-pages.ts`, `src/components/clinical-dashboard/ClinicalSidebar.tsx`, `src/components/clinical-dashboard/use-sidebar-pins.ts`, `src/components/mode-nav/header-addon-slot.ts`, `src/components/mode-nav/mode-nav-icons.ts`
- Test: `tests/search-route-ownership.test.ts`, `tests/consolidated-mode-home-redirect.test.ts`, `tests/mode-nav-addon-slot.dom.test.tsx`

- [ ] **Step 1: Claim a standalone home, and say in a comment why there is no consolidated entry**

`src/lib/search-route-ownership.ts`: add `/cme` to `standaloneModeHomePaths`, add a `case "cme": return "/cme";` to `modeHomePathFor` with the same reasoning On Call carries, and add `/cme` to `alwaysStandaloneShellPathPrefixes`.

In `src/lib/consolidated-mode-home-redirect.ts`, add a comment beside On Call's recording that CME is deliberately absent for the same reason. `tests/consolidated-mode-home-redirect.test.ts` has an infinite-loop guard: adding `/cme` there would **require** `/cme/search` to exist, and it does not.

`src/lib/search-shell-props.ts`: `if (pathname.startsWith("/cme")) return { initialMode: "cme", desktopSearchPlacement: "hero" };`

- [ ] **Step 2: Put it in the sidebar, the pins, the phone sheet and the information-page set**

`ClinicalSidebar.tsx` — the id in `visibleSidebarToolItems` or `sidebarMoreModeIds`; the description comes from the mode definition automatically. `use-sidebar-pins.ts` — `pinnableSidebarModeIds`. `information-pages.ts` — the `InformationPageMode` union, the two `isInformationPage` branches (`isSlugDetail(pathname, "/cme")` and `pathname === "/cme"`), and the exported mode list.

- [ ] **Step 3: Claim the phone header**

CME pages own their in-page navigation, so claim the addon slot in `src/components/mode-nav/header-addon-slot.ts` and give each routed nav id an icon in `src/components/mode-nav/mode-nav-icons.ts`. Do **not** add CME to `MODE_NAV_ADOPTED_MODES`.

- [ ] **Step 4: Run the navigation gates**

Run: `npm run test:focused -- --files tests/search-route-ownership.test.ts tests/consolidated-mode-home-redirect.test.ts tests/mode-nav-addon-slot.dom.test.tsx tests/route-reachability.test.ts`
Expected: PASS. `route-reachability` fails any route not linked from in-app navigation — if it complains, the sidebar or the secondary nav is missing a destination, not the allowlist.

- [ ] **Step 5: Commit**

```bash
git add src/lib src/components tests
git commit -m "feat(cme): standalone mode home, sidebar entry and phone header ownership"
```

---

### Task 9: Routes and shells

One directory under `(search-app)`, a pass-through layout, exactly one `loading.tsx` at the mode root, and one thin `page.tsx` per screen. All the work lives in `src/components/cme/`.

**Files:**

- Create: `src/app/(search-app)/cme/layout.tsx`, `loading.tsx`, `page.tsx`, and `log/`, `log/[id]/`, `new/`, `routines/`, `plan/`, `programme/`, `setup/`, `customise/` each with a `page.tsx`

- [ ] **Step 1: The layout and the loading state**

`layout.tsx` is a pass-through — it exists only to give the namespace a boundary:

```tsx
export default function CmeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

`loading.tsx` is **mandatory** and gated by `tests/mode-home-loading-contract.test.ts`:

```tsx
import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";

export default function CmeLoading() {
  return <ModeHomeRouteLoading />;
}
```

- [ ] **Step 2: One page per screen, each a metadata block and one component**

```tsx
// src/app/(search-app)/cme/log/page.tsx
import type { Metadata } from "next";

import { CmeLogPage } from "@/components/cme/cme-log-page";

export const metadata: Metadata = {
  title: "Log | CME | PsychSift",
  description: "Every continuing-education activity you have recorded, by year.",
};

export default function CmeLogRoute() {
  return <CmeLogPage />;
}
```

Repeat for each screen. Add the route directory name to `MODE_HOME_LOADING_ROUTES`.

- [ ] **Step 3: Run the route gates**

Run: `npm run test:focused -- --files tests/mode-home-loading-contract.test.ts tests/route-reachability.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(search-app\)/cme tests
git commit -m "feat(cme): the route tree"
```

---

### Task 10: The pace mark — extend the one sanctioned progress primitive

The design's hero bar carries a mark at the position the owner would need to be at today. `Progress` (`src/components/ui/progress.tsx`) has no such mark, and the design record forbids hand-rolling a second bar. So extend the primitive once, here, before any screen needs it.

**Files:**

- Modify: `src/components/ui/progress.tsx`
- Modify: `docs/design-system/COMPONENTS.md`
- Test: `tests/progress-mark.dom.test.tsx`

**Interfaces:**

- Produces: `ProgressProps` gains `mark?: { value: number; label: string }`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/progress-mark.dom.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Progress } from "@/components/ui/progress";

describe("Progress with a target mark", () => {
  it("draws no mark when none is given", () => {
    render(<Progress value={65} label="CPD hours" />);
    expect(screen.queryByTestId("progress-mark")).toBeNull();
  });

  it("places the mark at its own percentage, independent of the fill", () => {
    render(<Progress value={65} label="CPD hours" mark={{ value: 71.8, label: "on pace today" }} />);
    const mark = screen.getByTestId("progress-mark");
    expect(mark).toHaveStyle({ left: "71.8%" });
    expect(mark).toHaveAccessibleName("on pace today");
  });

  it("clamps a mark outside the track rather than drawing off the end", () => {
    render(<Progress value={10} label="CPD hours" mark={{ value: 140, label: "on pace today" }} />);
    expect(screen.getByTestId("progress-mark")).toHaveStyle({ left: "100%" });
  });

  it("keeps the mark out of the accessible value, which is still the fill", () => {
    render(<Progress value={65} label="CPD hours" mark={{ value: 71.8, label: "on pace today" }} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "65");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:focused -- --files tests/progress-mark.dom.test.tsx`
Expected: FAIL — no `progress-mark` element.

- [ ] **Step 3: Implement**

Add to `ProgressProps`:

```tsx
  /**
   * An optional reference point on the same scale as `value` — "where you would
   * need to be today". Drawn as a notch, not a second fill, and kept out of
   * `aria-valuenow`, which still reports the real value: a screen reader that
   * announced the target as the progress would be stating the opposite of the
   * truth.
   */
  mark?: { value: number; label: string };
```

Render it inside the track as an absolutely positioned 2px notch at `left: ${clamp(mark.value)}%`, with `data-testid="progress-mark"`, `role="img"` and `aria-label={mark.label}`. Colour from `var(--text)`, never a status colour. Add `forced-colors:bg-[CanvasText]` so it survives high-contrast mode, which is one of the five required proofs.

Record the new prop in `docs/design-system/COMPONENTS.md`.

- [ ] **Step 4: Run the test and the design-system gates**

Run: `npm run test:focused -- --files tests/progress-mark.dom.test.tsx && npm run check:design-system-contract`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/progress.tsx docs/design-system/COMPONENTS.md tests/progress-mark.dom.test.tsx
git commit -m "feat(ui): Progress takes an optional target mark"
```

---

### Task 11: Programme and first run — the screens that make every other screen possible

The dashboard has nothing to show until a requirement set exists, so build this first. This is also the screen where the design's central safety property lives: the app asserts no requirement; it holds the owner's confirmed numbers and shows their provenance.

**Files:**

- Create: `src/components/cme/cme-nav-header.tsx`, `src/components/cme/cme-programme-page.tsx`, `src/components/cme/cme-setup-page.tsx`
- Test: `tests/cme-programme.dom.test.tsx`

**Interfaces:**

- Consumes: `CmeRequirementSet` (Task 2), `DEMO_CME_YEAR` (Task 3).
- Produces: `CmeNavHeader` exporting `cmeSections: readonly PageSection[]`; `CmeProgrammePage`, `CmeSetupPage`.

- [ ] **Step 1: The nav header sibling, because the section table must live there**

`docs/search-chrome-behaviour.md` binds new conversions: a page's `PageSection[]` is owned and exported by a colocated `"use client"` nav-header sibling named for the route — not inline in the page, not in a separate section-index module. CME is a new conversion, so this is not optional.

`src/components/cme/cme-nav-header.tsx` mounts `InPageNavHeader` from `@/components/in-page-nav/in-page-nav-header` with `testIdPrefix="cme"`, the CME `PageSection[]`, and `rail={{ label: "CME", density: <profile>, modeIdentity: "cme" }}` — `rail.density` is required, and `modeIdentity` is how `data-mode-identity="cme"` reaches the bar. Do not add a second scroll-hide hook; `PhoneHeaderCollapsePortal` inside `InPageNavHeader` owns phone motion.

Every section a reader can jump to carries `inPageAnchor` from `@/components/in-page-nav/in-page-nav-classes`. Without it a jump lands underneath the header.

- [ ] **Step 2: Write the failing test**

```tsx
// tests/cme-programme.dom.test.tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CmeProgrammePage } from "@/components/cme/cme-programme-page";
import { DEMO_CME_YEAR } from "@/lib/cme/demo-year";

describe("Programme", () => {
  it("shows every target as the owner's own confirmed number, with its provenance", () => {
    render(<CmeProgrammePage set={DEMO_CME_YEAR} />);
    const provenance = screen.getByTestId("cme-provenance");
    expect(provenance).toHaveTextContent("Confirmed by you on 19 September 2026");
    expect(provenance).toHaveTextContent(DEMO_CME_YEAR.confirmedSource);
  });

  it("puts the four practice domains in the national baseline, not the college overlay", () => {
    render(<CmeProgrammePage set={DEMO_CME_YEAR} />);
    const baseline = screen.getByTestId("cme-national-baseline");
    expect(within(baseline).getByText(/Practice domains/)).toBeInTheDocument();
    const overlay = screen.getByTestId("cme-college-extras");
    expect(within(overlay).queryByText(/Practice domains/)).toBeNull();
  });

  it("says plainly that the app never looks a requirement up", () => {
    render(<CmeProgrammePage set={DEMO_CME_YEAR} />);
    expect(screen.getByTestId("cme-no-lookup")).toHaveTextContent(/never looks|never changes/i);
  });

  it("offers a re-confirm control rather than silently ageing", () => {
    render(<CmeProgrammePage set={DEMO_CME_YEAR} />);
    expect(screen.getByRole("button", { name: /re-confirm/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Build both screens from the boards**

Programme: the national baseline (total, educational, combined, each-of-two, self-allocated, written plan, self-evaluation, practice domains), the college overlay with an Add control, the provenance block with re-confirm, and the year shape. Setup: four steps with `tick` states, the optional routines shortcut, and the capture switch left off with its plain statement of what would be recorded.

Use `cardSurface` / `cardInteractive` / `focusRing` from `@/components/card-recipes`. No raw hex; tokens only. Every tappable row `min-h-12`.

- [ ] **Step 4: Run**

Run: `npm run test:focused -- --files tests/cme-programme.dom.test.tsx && npm run lint`
Expected: PASS. `eslint-rules/no-hardcoded-hex.mjs` will catch any colour that slipped in from the mockups.

- [ ] **Step 5: Commit**

```bash
git add src/components/cme tests/cme-programme.dom.test.tsx
git commit -m "feat(cme): programme and first run, with provenance on every target"
```

---

### Task 12: New entry — hours split across categories, and what it cost

**Files:**

- Create: `src/components/cme/cme-entry-form.tsx`, `src/components/cme/cme-allocation-field.tsx`
- Test: `tests/cme-entry-form.dom.test.tsx`

**Interfaces:**

- Consumes: `cmeEntryCreateSchema` (Task 6), `cmeCategories` (Task 2).
- Produces: `CmeEntryForm` with `onSubmit(entry: CmeEntryDraft): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/cme-entry-form.dom.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CmeEntryForm } from "@/components/cme/cme-entry-form";

describe("New entry", () => {
  it("will not save until the allocations add up to the stated hours", async () => {
    const onSubmit = vi.fn();
    render(<CmeEntryForm onSubmit={onSubmit} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/what was it/i), "Peer review group — September");
    await user.click(screen.getByRole("button", { name: "1.5" }));
    await user.type(screen.getByLabelText(/reviewing performance/i), "1");
    expect(screen.getByTestId("cme-allocation-total")).toHaveTextContent("1.0 of 1.5 allocated");
    expect(screen.getByRole("button", { name: /save entry/i })).toBeDisabled();
    await user.type(screen.getByLabelText(/measuring outcomes/i), "0.5");
    expect(screen.getByTestId("cme-allocation-total")).toHaveTextContent("1.5 of 1.5 allocated");
    expect(screen.getByRole("button", { name: /save entry/i })).toBeEnabled();
  });

  it("labels the reflection without asking a question", () => {
    render(<CmeEntryForm onSubmit={vi.fn()} />);
    const reflection = screen.getByLabelText(/reflection/i);
    expect(reflection).toBeInTheDocument();
    // The owner declined a guided prompt on 2026-09-20. The box is his.
    expect(screen.queryByText(/what will you do differently/i)).toBeNull();
  });

  it("takes an optional cost and marks it optional", () => {
    render(<CmeEntryForm onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/what it cost/i)).toBeInTheDocument();
    expect(screen.getByTestId("cme-cost-optional")).toHaveTextContent(/optional/i);
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then build the form**

The allocation control is the interesting part: one row per category the owner adds, a running total against the stated hours, and the save control disabled until they agree. Store the cost in whole cents.

- [ ] **Step 3: Run**

Run: `npm run test:focused -- --files tests/cme-entry-form.dom.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/cme tests/cme-entry-form.dom.test.tsx
git commit -m "feat(cme): capture an entry, allocated across categories"
```

---

### Task 13: Log, and one entry

**Files:**

- Create: `src/components/cme/cme-log-page.tsx`, `src/components/cme/cme-entry-page.tsx`, `src/lib/cme/clipboard.ts`
- Test: `tests/cme-log.dom.test.tsx`, `tests/cme-clipboard.test.ts`

**Interfaces:**

- Produces: `CmeLogPage`, `CmeEntryPage`, `formatEntryForCpdHome(entry, set): string`.

- [ ] **Step 1: The clipboard format, which is the control pressed most**

```ts
// tests/cme-clipboard.test.ts
import { describe, expect, it } from "vitest";

import { formatEntryForCpdHome } from "@/lib/cme/clipboard";
import { DEMO_CME_ENTRIES, DEMO_CME_YEAR } from "@/lib/cme/demo-year";

describe("copy for your CPD home", () => {
  it("puts every field on the clipboard in the portal's own order, one per line", () => {
    const entry = DEMO_CME_ENTRIES.find((candidate) => candidate.allocations.length > 1)!;
    const text = formatEntryForCpdHome(entry, DEMO_CME_YEAR);
    const lines = text.split("\n");
    expect(lines[0]).toBe(`Date: ${entry.date}`);
    expect(lines[1]).toBe(`Activity: ${entry.title}`);
    expect(lines[2]).toMatch(/^Hours: /);
    expect(text).toContain("Reviewing performance");
    expect(text).toContain("Measuring outcomes");
  });

  it("writes one line per allocation, because a portal takes them separately", () => {
    const entry = DEMO_CME_ENTRIES.find((candidate) => candidate.allocations.length === 2)!;
    const text = formatEntryForCpdHome(entry, DEMO_CME_YEAR);
    for (const allocation of entry.allocations) {
      expect(text).toMatch(new RegExp(`${allocation.hours}`));
    }
  });
});
```

- [ ] **Step 2: The log**

Year tabs, a search field over titles and reflections, a filter chip row, entries grouped by month, and a "Routine" pill on entries that came from one. The first row links to the entry page. Keep the closing call to action from the board.

- [ ] **Step 3: One entry**

The allocations with their college pill, the reflection, the evidence row, the cost row, and the big "Copy for your CPD home" button which writes `formatEntryForCpdHome` to the clipboard and then marks the entry transcribed.

- [ ] **Step 4: Run and commit**

Run: `npm run test:focused -- --files tests/cme-log.dom.test.tsx tests/cme-clipboard.test.ts`
Expected: PASS.

```bash
git add src/components/cme src/lib/cme/clipboard.ts tests
git commit -m "feat(cme): the log, one entry, and the clipboard format"
```

---

### Task 14: Routines

**Files:**

- Create: `src/components/cme/cme-routines-page.tsx`, `src/lib/cme/routines.ts`
- Test: `tests/cme-routines.test.ts`, `tests/cme-routines.dom.test.tsx`

- [ ] **Step 1: Write the due-date logic and its test**

```ts
// tests/cme-routines.test.ts
import { describe, expect, it } from "vitest";

import { routinesDueOn } from "@/lib/cme/routines";

const supervision = {
  id: "r1",
  title: "Supervision",
  cadence: "monthly" as const,
  usualHours: 1,
  usualAllocations: [],
  nextDue: "2026-09-28",
  archivedAt: null,
};

describe("routines", () => {
  it("is due when its next date has arrived, in Perth", () => {
    expect(routinesDueOn([supervision], new Date("2026-09-28T02:00:00Z")).map((r) => r.id)).toEqual(["r1"]);
    expect(routinesDueOn([supervision], new Date("2026-09-27T02:00:00Z"))).toEqual([]);
  });

  it("never logs itself — the function returns what is due, and nothing else", () => {
    // Only the owner knows whether he was actually there. `routinesDueOn` is a
    // read; there is no companion that writes an entry without a confirmation.
    expect(routinesDueOn.length).toBe(2);
  });

  it("ignores an archived routine", () => {
    expect(
      routinesDueOn([{ ...supervision, archivedAt: "2026-06-01T00:00:00Z" }], new Date("2026-09-28T02:00:00Z")),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: The screen**

Due now at the top with the one-tap log buttons as the visual focus; the note that a routine never logs itself; the list with next-due dates; a New routine control. Tapping "Log 1.0 h" opens the entry form pre-filled, and the owner confirms — it never writes directly.

- [ ] **Step 3: Run and commit**

Run: `npm run test:focused -- --files tests/cme-routines.test.ts tests/cme-routines.dom.test.tsx`
Expected: PASS.

```bash
git add src/components/cme src/lib/cme/routines.ts tests
git commit -m "feat(cme): routines, which offer and never assert"
```

---

### Task 15: The dashboard, and the module order

The screen the whole mode is judged by. Three things above the fold, then everything else. Its content changes character across the year.

**Files:**

- Create: `src/components/cme/cme-dashboard.tsx`, `src/components/cme/cme-customise-page.tsx`, `src/lib/cme/module-order.ts`, `src/lib/cme/module-order-keys.ts`
- Test: `tests/cme-dashboard.dom.test.tsx`, `tests/cme-module-order.test.ts`, `tests/cme-root-bundle-isolation.test.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: `CmeDashboard`, `useCmeModuleOrder()` returning `{ moduleIds, toggleModule, moveModule }`.

- [ ] **Step 1: Copy the reorder hook, including its failure behaviour**

`src/lib/cme/module-order.ts` mirrors `src/components/clinical-dashboard/use-sidebar-pins.ts`: `createBrowserStore` from `@/lib/client-store-factory`, a serialized-string snapshot, both the native `storage` event and a same-tab custom event, validation on every read and write, and a graceful in-memory fallback when `localStorage.setItem` throws. `moveModule(id, direction: -1 | 1)` is the same swap. **Arrows, never drag alone.**

Put the storage key and the event name in `src/lib/cme/module-order-keys.ts`, an **import-free** module. This is not tidiness: `tests/on-call-root-bundle-isolation.test.ts` exists because importing a store module into `src/lib/supabase/client.tsx` for its sign-out clear pulled the whole feature into the root bundle and cost `/` 21 KiB gzip and 168 ms of LCP. Write the CME analogue of that test.

- [ ] **Step 2: Write the dashboard test, including the seasons**

```tsx
// tests/cme-dashboard.dom.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CmeDashboard } from "@/components/cme/cme-dashboard";
import { DEMO_CME_ENTRIES, DEMO_CME_YEAR } from "@/lib/cme/demo-year";

function renderAt(iso: string) {
  return render(<CmeDashboard set={DEMO_CME_YEAR} entries={DEMO_CME_ENTRIES} now={new Date(iso)} />);
}

describe("the dashboard", () => {
  it("leads with the figure, the pace mark and one action", () => {
    renderAt("2026-09-19T02:00:00Z");
    expect(screen.getByTestId("cme-total-hours")).toHaveTextContent("32.5");
    expect(screen.getByTestId("progress-mark")).toBeInTheDocument();
    expect(screen.getByTestId("cme-pace-sentence")).toHaveTextContent(/45 hours by 31 December/);
    expect(screen.getByTestId("cme-next-action")).toBeInTheDocument();
  });

  it("says nothing about pace in January and points at the plan instead", () => {
    renderAt("2026-01-06T02:00:00Z");
    expect(screen.queryByTestId("cme-pace-sentence")).toBeNull();
    expect(screen.queryByTestId("progress-mark")).toBeNull();
    expect(screen.getByTestId("cme-next-action")).toHaveTextContent(/development plan/i);
  });

  it("turns into the year-end checklist in the last fortnight", () => {
    renderAt("2026-12-28T02:00:00Z");
    expect(screen.getByTestId("cme-next-action")).toHaveTextContent(/close the year/i);
  });

  it("shows a legitimate zero as a zero", () => {
    render(<CmeDashboard set={DEMO_CME_YEAR} entries={[]} now={new Date("2026-09-19T02:00:00Z")} />);
    expect(screen.getByTestId("cme-total-hours")).toHaveTextContent("0");
  });
});
```

- [ ] **Step 3: Build it**

Hero card with `Progress` and its `mark`; the pace sentence from `paceProjection` (absent when it returns null); the computed Next row; requirement modules from `evaluateYear`; routines due; the audited-today summary; the dates; the provenance line. Modules in the owner's order, hidden ones absent.

- [ ] **Step 4: Run**

Run: `npm run test:focused -- --files tests/cme-dashboard.dom.test.tsx tests/cme-module-order.test.ts tests/cme-root-bundle-isolation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/cme src/lib/cme tests
git commit -m "feat(cme): the dashboard, its three seasons, and the module order"
```

---

### Task 16: Visual enforcement — the five proofs, the eyeball channel, and the invariants a test can hold

The owner asked that the build "enforce perfected visual implementation". No test can assert _perfected_ — that is his eye, and Task 17 gives it a channel. What a test **can** do is make drift impossible and hold the invariants the spec states in absolute terms. This task does that; Task 17 locks the pixels once the screens stop moving.

Read `docs/design-system/adoption-contract.json` before starting. `requiredProofCategories` is `["dark", "forcedColours", "compact320", "print", "browser"]` and every production route carries all five.

**Files:**

- Modify: `docs/design-system/adoption-contract.json` — declare every CME route
- Modify: `scripts/generate-design-system-adoption.mjs` — the contract is generated from the frozen policy object at the top of this file, so the route declarations live here
- Modify: `tests/ui-visual-artifacts.spec.ts` — add the CME phone captures
- Create: `tests/cme-visual-contract.dom.test.tsx` — the invariants
- Create: `tests/ui-cme-phone.spec.ts` — the phone journey, with a frozen clock
- Modify: `tests/helpers/phone-scroll.ts` — register the CME routes

**Interfaces:**

- Consumes: every route from Task 9, the demo fixture set from Task 3.
- Produces: `CME_BASELINE_ROUTES` exported from `tests/ui-cme-phone.spec.ts` for Task 17 to reuse.

- [ ] **Step 1: Write the invariant test, and watch it fail**

These are the spec's absolutes. Each one is a sentence in `docs/cme/design/cme-design-decisions.md` that a reviewer would otherwise have to police by eye on every future change.

```tsx
// tests/cme-visual-contract.dom.test.tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CmeDashboard } from "@/components/cme/cme-dashboard";
import { demoCmeYear } from "@/lib/cme/demo-fixtures";

const CLINICAL_STATUS_CLASS = /\b(?:bg|text|border|ring)-(?:red|amber|green|orange|rose|emerald|yellow)-/;

describe("CME visual contract", () => {
  it("paints no clinical status colour anywhere in the mode", () => {
    const { container } = render(<CmeDashboard year={demoCmeYear} />);
    const offenders = [...container.querySelectorAll<HTMLElement>("[class]")].filter((node) =>
      CLINICAL_STATUS_CLASS.test(node.className),
    );
    expect(offenders.map((node) => node.className)).toEqual([]);
  });

  it("gives every interactive element a 48px tap target class", () => {
    const { container } = render(<CmeDashboard year={demoCmeYear} />);
    const interactive = [...container.querySelectorAll<HTMLElement>("button, a[href], [role='button']")];
    expect(interactive.length).toBeGreaterThan(0);
    const short = interactive.filter((node) => !/\bmin-h-(?:12|tap)\b/.test(node.className));
    expect(short.map((node) => node.textContent?.trim() || node.getAttribute("aria-label"))).toEqual([]);
  });

  it("states the pace projection as a sentence, not only as a bar", () => {
    render(<CmeDashboard year={demoCmeYear} />);
    expect(screen.getByTestId("cme-pace-sentence")).toHaveTextContent(/At this rate, .* by 31 December/);
  });

  it("says nothing about pace in January, when a rate is meaningless", () => {
    render(<CmeDashboard year={{ ...demoCmeYear, today: "2026-01-06" }} />);
    expect(screen.queryByTestId("cme-pace-sentence")).toBeNull();
    expect(screen.getByTestId("cme-next-action")).toHaveTextContent(/development plan/i);
  });

  it("offers move-up and move-down beside any reorder affordance", () => {
    render(<CmeDashboard year={demoCmeYear} customising />);
    const list = screen.getByTestId("cme-module-order");
    expect(within(list).getAllByRole("button", { name: /move up/i }).length).toBeGreaterThan(0);
    expect(within(list).getAllByRole("button", { name: /move down/i }).length).toBeGreaterThan(0);
  });

  it("shows the provenance of every target it displays", () => {
    render(<CmeDashboard year={demoCmeYear} />);
    expect(screen.getByTestId("cme-provenance")).toHaveTextContent(/confirmed by you on/i);
  });
});
```

Run: `npm run test:focused -- --files tests/cme-visual-contract.dom.test.tsx`
Expected: FAIL — the component does not yet expose these test ids. Add them in the components from Tasks 13 and 15 rather than weakening the assertions.

- [ ] **Step 2: Make it pass, then commit**

Run: `npm run test:focused -- --files tests/cme-visual-contract.dom.test.tsx`
Expected: PASS.

```bash
git add tests/cme-visual-contract.dom.test.tsx src/components/cme
git commit -m "test(cme): hold the design record's absolutes as a contract"
```

- [ ] **Step 3: Write the phone journey with the clock frozen**

The original dashboard example prints "103 days left" and projects to 31 December. Keep
time deterministic for those assertions. The living example is
[tests/ui-cme-phone.spec.ts](../../../tests/ui-cme-phone.spec.ts): its `beforeEach` uses
`page.clock.setFixedTime(FROZEN)` to pin `new Date()` while preserving animation frames.
The current demo routes also pass `DEMO_CME_INSTANT`; the test freeze protects against
future live-clock drift. Use that current example rather than copying the older sketch below.

```ts
// tests/ui-cme-phone.spec.ts
import { expect, test } from "playwright/test";

/**
 * 19 September 2026, 10:00 Perth. Every figure the CME screens derive from "now"
 * — days remaining, the pace projection, which year an entry falls in — is fixed
 * by this, so the screens are byte-stable between runs. Perth rather than UTC
 * because the CPD year boundary is a Perth midnight: an entry logged at 20:00 on
 * 31 December is in that year, and a UTC comparison would move it to the next.
 */
const FROZEN = new Date("2026-09-19T02:00:00Z");

export const CME_BASELINE_ROUTES = ["/cme", "/cme/log", "/cme/new", "/cme/programme"] as const;

test.describe("CME on a phone", () => {
  test.use({ viewport: { width: 390, height: 820 } });

  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: FROZEN });
    await page.clock.pauseAt(FROZEN);
  });

  test("the dashboard leads with position, pace and one action", async ({ page }) => {
    await page.goto("/cme");
    const main = page.locator("#main-content");
    await expect(main).toBeVisible();
    await expect(page.getByTestId("cme-total-hours")).toHaveText("32.5");
    await expect(page.getByTestId("cme-pace-sentence")).toContainText("by 31 December");
    await expect(page.getByTestId("cme-next-action")).toBeVisible();
  });

  test("every route renders its main region at 390px with no sideways scroll", async ({ page }) => {
    for (const route of CME_BASELINE_ROUTES) {
      await page.goto(route);
      await expect(page.locator("#main-content")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${route} scrolls sideways at 390px`).toBeLessThanOrEqual(0);
    }
  });
});
```

Run: `npm run ensure` then `npx playwright test tests/ui-cme-phone.spec.ts --project=chromium`
Expected: PASS.

- [ ] **Step 4: Add the CME captures to the human-review channel**

`tests/ui-visual-artifacts.spec.ts` attaches screenshots for a person to look at; nothing fails when a surface changes. That is the right channel while the screens are still moving, and it is how the owner reviews them each round.

Add to the existing describe block:

```ts
test("captures the CME screens", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.clock.install({ time: new Date("2026-09-19T02:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-19T02:00:00Z"));
  for (const [name, path] of [
    ["cme-dashboard-mobile", "/cme"],
    ["cme-log-mobile", "/cme/log"],
    ["cme-new-entry-mobile", "/cme/new"],
    ["cme-programme-mobile", "/cme/programme"],
  ] as const) {
    await attachViewportScreenshot(page, testInfo, name, { width: 390, height: 820 }, path);
  }
});
```

- [ ] **Step 5: Declare the routes with all five proofs**

In `scripts/generate-design-system-adoption.mjs`, add every CME `page.tsx` from Task 9 to the `catalogues-forms-and-info` surface's `routes` array, sorted, exactly once each. Each surface carries one `proof` object covering `dark`, `forcedColours`, `compact320`, `print` and `browser`; name `tests/ui-cme-phone.spec.ts` and `tests/cme-visual-contract.dom.test.tsx` as evidence for `browser` and `compact320`, and add CME assertions to whichever existing specs already prove `dark`, `forcedColours` and `print` for that surface rather than starting new ones.

Then regenerate and check:

Run: `npm run design-system:adoption:update && npm run check:design-system-adoption`
Expected: `design-system adoption checked: 55 components, N roots` with N raised by the number of CME routes.

- [ ] **Step 6: Register the phone-scroll coverage**

Add the CME mode home to `modeHomeRoutes` and the CME sub-pages to `appModeHeaderRoutes` in `tests/helpers/phone-scroll.ts`.

Run: `npm run verify:phone-chrome`
Expected: PASS. Report it as the focused phone-chrome proof, not as `verify:ui`.

- [ ] **Step 7: Commit**

```bash
git add tests docs/design-system scripts/generate-design-system-adoption.mjs
git commit -m "test(cme): five proofs per route, phone journey on a frozen clock, screenshots for review"
```

---

### Task 17: Lock the pixels — adopt canonical visual baselines for CME

Do this **after the owner has reviewed the screenshots from Task 16 Step 4 and asked for no further changes**, and — read this before planning your week — **after Phase 1 has merged**.

Two facts decide the shape of this task, and both are owner decisions already recorded in the repository:

1. **The pixel job does not run on pull requests.** `.github/workflows/ci.yml` gates `visual-baseline` on `contains(fromJSON('["push","schedule","workflow_dispatch"]'), github.event_name)`, with a comment dated 2026-08-09 that says not to add `pull_request` back without the owner saying so. Its reasoning: during a redesign the honest result is red on every push, and the baselines cannot be refreshed until a run has produced the new images, so that red is unavoidable rather than actionable. **Do not treat this as a merge gate and do not describe it to anyone as one.** It catches drift after the change has landed, on the weekly schedule, and on demand.
2. **Baselines come from the hosted CI artifact and nowhere else**, and `scripts/adopt-visual-baselines.mjs` exists so that the provenance file is never hand-assembled again.

Three constraints from `validateCandidateSourceBinding` in `scripts/generate-design-system-adoption.mjs` shape Step 1:

- The suite's target ids must **exactly equal** `canonicalCandidates`, at both the capture commit and the current HEAD.
- `AWAITING_BASELINE` may be **only** the complete canonical set or empty — never a partial list. So adding four CME baselines re-shoots the existing six as well.
- `candidateSourceHead` must be a full 40-character SHA that is an ancestor of HEAD. **Do not rebase or amend that commit afterwards.**

**Files:**

- Modify: `tests/ui-visual-baseline.spec.ts` — four new targets; `AWAITING_BASELINE`
- Modify: `scripts/generate-design-system-adoption.mjs` — `canonicalCandidates`, `requiredCandidateCount`
- Modify (generated, never by hand): `docs/design-system/adoption-contract.json`, `tests/__screenshots__/linux/provenance.json`
- Create (from the artifact, never locally): `tests/__screenshots__/linux/cme-*.png`

**Interfaces:**

- Consumes: `CME_BASELINE_ROUTES` from Task 16.
- Produces: nothing downstream. This is the last task of Phase 1.

- [ ] **Step 1: Add the four targets, and declare the full canonical set as awaiting**

In `tests/ui-visual-baseline.spec.ts`, add a clock helper above `targets`:

```ts
/**
 * Every CME figure derived from "now" — days remaining, the pace projection —
 * moves nightly, so an unfrozen clock re-baselines these four every day and the
 * gate stops meaning anything. Perth rather than UTC: the CPD year boundary is a
 * Perth midnight, and `src/lib/cme/cpd-year.ts` exists for that reason.
 */
async function freezeCmeClock(page: Page): Promise<void> {
  const frozen = new Date("2026-09-19T02:00:00Z");
  await page.clock.install({ time: frozen });
  await page.clock.pauseAt(frozen);
}
```

and four targets:

```ts
  { name: "cme-dashboard", route: "/cme", selector: "#main-content", viewport: desktop, prepare: freezeCmeClock },
  { name: "cme-dashboard-phone", route: "/cme", selector: "#main-content", viewport: phone, prepare: freezeCmeClock },
  { name: "cme-log-phone", route: "/cme/log", selector: "#main-content", viewport: phone, prepare: freezeCmeClock },
  { name: "cme-programme-phone", route: "/cme/programme", selector: "#main-content", viewport: phone, prepare: freezeCmeClock },
```

Then set `AWAITING_BASELINE` to **all ten** ids, sorted — a partial list is not an adoptable shape:

```ts
const AWAITING_BASELINE: ReadonlySet<string> = new Set([
  "cme-dashboard",
  "cme-dashboard-phone",
  "cme-log-phone",
  "cme-programme-phone",
  "dashboard-shell",
  "dashboard-shell-phone",
  "document-viewer",
  "search-results-band",
  "search-results-band-phone",
  "therapy-compass-home",
]);
```

In `scripts/generate-design-system-adoption.mjs`, set `requiredCandidateCount: 10` and add the four entries to `canonicalCandidates`, sorted by id:

```js
    { id: "cme-dashboard", path: "tests/__screenshots__/linux/cme-dashboard.png" },
    { id: "cme-dashboard-phone", path: "tests/__screenshots__/linux/cme-dashboard-phone.png" },
    { id: "cme-log-phone", path: "tests/__screenshots__/linux/cme-log-phone.png" },
    { id: "cme-programme-phone", path: "tests/__screenshots__/linux/cme-programme-phone.png" },
```

Run: `npm run design-system:adoption:update && npm run check:design-system-adoption`
Expected: PASS. A complaint that the suite targets do not match the canonical ids means the two lists have diverged — fix the list, never the check.

- [ ] **Step 2: Commit. This commit is the capture head.**

```bash
git add tests/ui-visual-baseline.spec.ts scripts/generate-design-system-adoption.mjs docs/design-system/adoption-contract.json
git commit -m "test(cme): declare four visual baseline targets, awaiting capture"
```

Record the full 40-character SHA: `git rev-parse HEAD`. It becomes `--head` in Step 4 and must stay an ancestor of every later HEAD.

- [ ] **Step 3: Get a capture run — and ask the owner first**

The job will not run on the pull request. Two supported routes, and both are GitHub Actions calls, which fall under the repository's provider-confirmation boundary: **report the command and ask before running it.**

- _Preferred, and what the job's own comment recommends:_ let Phase 1 merge, then take the candidates from the `push`-to-`main` run of `Visual baselines (advisory)`. The refresh is cheap once the change has landed and it interrupts nothing.
- _If the owner wants them before merge:_ dispatch the workflow against the branch (`workflow_dispatch`). Say so, get a yes, then dispatch.

Either way, note the **run id** and the **artifact name**, and download and extract the artifact. Every target reports SKIPPED — correct while declared awaiting — and writes a candidate PNG under `visual-candidates/linux/`.

**Do not run the visual suite locally and commit what it produces.** The config writes a golden when none exists, and `retries: 0` is there precisely so a second attempt cannot compare against a golden the same run wrote.

- [ ] **Step 4: Look at the ten images, then adopt them**

`scripts/adopt-visual-baselines.mjs` copies the PNGs, computes each SHA-256 and pixel size, and writes `provenance.json` — the whole thing that used to be assembled by hand. It requires `--reviewed-by`, and that field is an assertion that a person looked at the images. **A baseline of a broken render silently blesses the break; that field is the only thing standing between this gate and that outcome.** Look at all ten before you type it.

Dry run first — it writes nothing:

```bash
node scripts/adopt-visual-baselines.mjs \
  --from <extracted-artifact-dir> \
  --run-id <run id> \
  --head <40-char sha from Step 2> \
  --reviewed-by "<the person who looked at the images>"
```

Read what it reports. Then repeat with `--write`.

- [ ] **Step 5: Empty the awaiting list, and prove it locally**

```ts
const AWAITING_BASELINE: ReadonlySet<string> = new Set([]);
```

Run: `npm run check:design-system-adoption`
Expected: PASS. A failure naming `candidateSourceHead` means the SHA is wrong, is no longer an ancestor, or the suite at that SHA does not declare exactly the ten canonical ids.

Run: `npm run ensure` then `npx playwright test --config playwright.visual.config.ts`
Expected: ten passing comparisons. Some diff is expected from font hinting between this machine and `ubuntu-24.04`; `maxDiffPixelRatio: 0.002` absorbs it. **If a CME target fails, fix the screen. Never loosen the tolerance, and never re-shoot locally.**

- [ ] **Step 6: Commit**

```bash
git add tests/__screenshots__/linux tests/ui-visual-baseline.spec.ts
git commit -m "test(cme): adopt visual baselines from CI run <run id>"
```

Report the result honestly: the CME screens now have committed pixel baselines, and drift in them will be caught on pushes to `main`, weekly, and on demand — **not** on pull requests, by the owner's own 2026-08-09 decision.

---

### Task 18: Generated artefacts, documentation, and the full gate

Two of these were missed when On Call shipped, and nothing caught either, because neither is behind a gate. Do them properly here.

**Files:** `scripts/generate-site-map.ts`, `scripts/phone-chrome-plan.mjs`, `scripts/playwright-pr-shards.mjs`, `docs/site-map.md`, `docs/codebase-index.md`, `CLAUDE.md`, `data/repo-awareness-snapshot.json`

- [ ] **Step 1: The site-map inputs that are not type-enforced**

`scripts/generate-site-map.ts` has four hand-written inputs. The `examples` record is type-enforced and was done in Task 7. The other three are not:

- `routeDescriptions` — a curated line per CME route. Without it every route reads "Route discovered from app directory".
- `routeOwnershipRows` — one row: `["CME", "src/app/(search-app)/cme, src/components/cme"]`.
- `renderModePageIndex()` — a hand-written table row. **On Call has no row in this table and nothing noticed**, because this is the one site-map input with no gate behind it. Add the CME row.

- [ ] **Step 2: The owner maps that classify CME's files**

`scripts/phone-chrome-plan.mjs` — add `cme: [/^src\/components\/cme\//, /^src\/lib\/cme\//]` to the owner map, or every edit under those paths falls into `unknownUi` and the phone-chrome planner cannot narrow anything.

`scripts/playwright-pr-shards.mjs` — assign `tests/ui-cme-phone.spec.ts` to a shard, then `npm run check:playwright-pr-shards`.

- [ ] **Step 3: The counts and the index**

`docs/codebase-index.md` says "17 app modes" in two places, lists the ids, has an API table, and carries a per-module section and a mode-homes paragraph. `CLAUDE.md` says "the 17 app modes". `src/lib/phone-mode-groups.ts` says "sixteen-item list" and `src/lib/developer-area/hub-panels.ts` carries a user-visible "all 16 modes" — both already stale by one, so check what they actually say before editing. Add an `src/lib/cme/` section and a `/api/cme` row; `npm run docs:check-index` fails without them.

- [ ] **Step 4: Regenerate everything derived**

Run: `npm run docs:update`
Then: `npm run sitemap:check && npm run check:repo-awareness-snapshot && npm run docs:check-index && npm run docs:check-inventory`
Expected: all PASS.

- [ ] **Step 5: Format, then the full local gate**

```bash
npm run format
git add -A src tests docs data supabase scripts
npm run verify:pr-local
```

Expected: green. Then the focused browser proof:

```bash
npm run ensure
npm run plan:browser -- --run
```

Report it as "focused browser proof at level `<x>`, full suite left to CI" — **never** as `verify:ui` passing.

- [ ] **Step 6: Commit and open for review**

```bash
git add -A
git commit -m "docs(cme): regenerate the site map, snapshots and adoption manifest"
```

The PR body must carry the `RAG impact:` line from Global Constraints, and must state that the migration merges only inside an approved window with auto-merge unarmed. It must **not** describe any deferred deploy — `scripts/pr-policy.mjs` hard-blocks that phrasing on a PR touching `supabase/migrations/**`, and quotes the offending phrase back.

---

## Phases 2 to 4

Each gets its own plan when its predecessor lands. Sketched here so the sequence is visible, not to be executed from this document.

**Phase 2 — the evidence vault.** A Supabase Storage bucket, owner-namespaced, with signed URLs. `/api/upload` cannot be reused: it is administrator-gated, rejects JPEG and PNG, and unconditionally enqueues ingestion — which would make a conference certificate retrievable as clinical evidence. Reuse the storage path and the signed-URL helper; never the ingestion enqueue. Then the Evidence screen, receipts, the cost total, and the share-in target for a certificate arriving from email.

**Phase 3 — automatic capture. Blocked, and not on engineering.** It inverts all three conditions under which recording the owner's own activity was previously permitted here (`src/lib/on-call/recent-storage.ts`): never leaves the device, does not outlive the session, stores nothing identifying. That ruling has to be re-obtained explicitly before a line is written. It also makes the privacy copy pinned by `tests/privacy-ui.test.ts` misleading, which must be corrected in the same change. And dwell time is a new data class whose retention must not be served by widening the `rag_*` purge windows (30/90 days), which are a ceiling and not a floor — CPD records need years.

**Phase 4 — the year end.** The summary document through the existing `PrintSection` / `PrintOutput` rather than a new PDF generator; the evidence bundle; the spreadsheet with its cost column; the audit pack. Then Audited today, Close the year (locking, the shortfall note, rolling goals forward) and Renewals.

**Not scheduled.** The trainee screens. The requirement `spec` column is shaped to hold their four extra shapes without a migration, which is the expensive part; the screens themselves wait until the owner says a trainee will use this.

---

## Self-review

**Spec coverage.** §1 what this is → Tasks 7–9. §2 the requirement model, including the four shapes and the never-pro-rata rule → Tasks 2, 4. §2 the Perth year → Task 1. §3 allocations → Tasks 2, 12. §4 the dashboard and its three seasons → Tasks 10, 15. §5 routines → Task 14. §6 capture → Phase 3, deliberately not in this plan. §7 evidence and cost → the cost field in Task 12 and Phase 2 for the vault. §8 renewals → Phase 4. §9 the year end → Phase 4. §10 in training → the `spec` column in Task 4; screens unscheduled. §11 what comes out → the clipboard in Task 13, documents in Phase 4. §12 what this does not do → Task 16's contract test. §13 the design system → Tasks 7, 10, 16. §14 evidence status → the provenance assertions in Task 11.

**Type consistency.** `CmeCategory`, `CmeRequirementSpec`, `CmeRequirement`, `CmeAllocation`, `CmeEntry`, `CmeRequirementSet`, `CmeRequirementStatus`, `evaluateRequirement`, `evaluateYear`, `totalAllocatedHours`, `paceProjection`, `cpdYearOf`, `rowToCmeEntry`, `cmeEntryToRow`, `fetchOwnerCmeEntries`, `formatEntryForCpdHome`, `routinesDueOn`, `useCmeModuleOrder` are each defined once and referred to by the same name throughout.

**Known open points, decided in advance rather than left hanging.**

1. _Does CME carry a results surface?_ Decided: no. `resultsSurface: "none"`, standalone home, no `/cme/search`. It is a dashboard, and a retargeted composer would accept a query and land the reader on a page that ignores it. Task 7 states it and Task 8 implements it.
2. _Which glyph and accent?_ `graduationCap` (free at the time of writing — verify against `CATEGORY_ICON_KEYS` before using) and `indigo`, shared with two clinical-reference modes CME does not co-occur with.
3. _When do the pixels get locked?_ After the owner has reviewed the screenshots and after Phase 1 merges, because the pixel job does not run on pull requests by the owner's own 2026-08-09 decision. Task 17.

**One thing this plan cannot give.** No test asserts that the screens are _right_ — only that they do not drift, that they hold the spec's absolutes, and that they render at 390 px in both themes, in forced colours, at 320 px and in print. The judgement stays with the owner, and Task 16 Step 4 plus Task 17 Step 4 are where he exercises it. `--reviewed-by` on the adoption script is not a formality: it is the assertion that a person looked.
