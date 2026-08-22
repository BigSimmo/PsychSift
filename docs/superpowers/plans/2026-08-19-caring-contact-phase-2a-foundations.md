# Caring Contacts Phase 2A — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the sealed rules layer and storage that the undesigned screens need, put a real production Caring Contacts workspace shell on `/caring-contacts` driven by that layer through API route handlers that audit every view, and build all 24 overlays as working components honouring the frozen modality matrix.

**Architecture:** Three separated groups behind one plan. Groups 1–2 extend `src/lib/caring-contacts/` (still importing nothing outside itself) and its Postgres schema with the eight capabilities Phase 1 declared but never implemented. Group 3 adds `src/app/api/caring-contacts/**` route handlers — the repository has zero Server Actions and 42 route handlers, so route handlers are house style, and they are also the single boundary at which a _read_ can be audited, which closes the Phase 1 read-audit gap. Groups 4–5 add the production route group `src/app/caring-contacts/**` with a four-width shell and the 24-overlay renderer. The existing mockup at `/mockups/caring-contacts` is **left untouched** and remains the frozen visual baseline for the atlas comparison.

**Tech Stack:** TypeScript 6 strict · Next.js 16 App Router (Turbopack default; `params`/`searchParams` are Promises) · React 19 · Tailwind 4 with `@theme` tokens · Zod 4 for request validation · Vitest (unit + jsdom DOM) · Playwright (`chromium` project) · Postgres 17 in a disposable Docker container via `npm run caring-contacts:db:test`.

**Spec:** `docs/superpowers/specs/2026-08-19-caring-contact-production-build-design.md` (§2 revisions, §3 architecture, §4 screen inventory, §5 phone, §6 design non-regression, §7 elevation brief, §8 behaviour to prove, §9 data model additions).

Supporting frozen records, all binding: `docs/superpowers/specs/2026-08-15-caring-contact-coordination-design.md` §6 (screen and overlay inventory) and §7 (the four-state width mapping); `docs/caring-contacts/interaction-matrix.md` (the 24-row modality matrix); `docs/caring-contacts/clinical-language-trace.md`; `docs/caring-contacts/accessibility-acceptance.md`; `docs/caring-contacts/phase-1-handoff.md`.

---

## Global Constraints

Every task's requirements implicitly include this section.

### Absolutely out of scope

- **No message is sent to any number, real or test.** No SMS provider, no provider account, no adapter beyond a deterministic fake.
- **No migration of any kind against the Clinical KB Supabase project `sjrfecxgysukkwxsowpy`.** Caring-contact migrations live **only** in `caring-contacts/supabase/migrations/` and **never** in `supabase/migrations/`.
- No hosting change, no hospital system connection, no enterprise sign-on, no real patient data.
- Sign-in is a **demo role switcher**, never credentials. The decision lock requires WA Health enterprise sign-on and forbids Caring-Contacts-local credentials, so building a login would violate it.
- **Do not push, do not open a pull request, and do not run `verify:release` or any provider-backed gate** (`eval:*`, `check:supabase-project`, `test:live`) without asking the owner first.

### Design non-regression (spec §6) — frozen, may not change without a recorded decision

1. The screen and overlay inventory of coordination design spec §6, as extended by spec §4.
2. The 24-row modality and dismissal decisions in `docs/caring-contacts/interaction-matrix.md`.
3. The width-to-state mapping `compact` (320–430) / `rail` (768) / `split` (1024) / `wide` (1440).
4. The closed transport vocabulary and every prohibited clinical term.
5. Token usage: no hardcoded colour, no new colour semantics, no decorative clinical colour.
6. The continuity thread's meaning — elapsed schedule spacing only, never patient, delivery or clinical state.

**No existing assertion may be deleted or loosened to accommodate a change.** Exactly one existing test is knowingly rescoped in this plan (Task 15, `tests/caring-contact-route-files.test.ts`); it is _replaced with a strictly stronger assertion_ and the change is called out explicitly. Any other test that goes red is a defect in the change, not in the test.

### Verification discipline

- **Test-first, always.** Write the failing test, run it, watch it fail for the stated reason, then implement.
- **After each task, deliberately break the implementation and confirm the tests go red.** Phase 1 found two tests that could not fail. A green suite that cannot go red is worthless. Record in the commit body what was mutated and which test caught it.
- **Never report a gate as passing from an exit code alone.** Paste the decisive line (the `N passed` line). Piping through `tail` masks the real result and has already misled once on this branch.
- Smallest gate first: `npm run test:focused -- --files <paths>` for source-only iteration; `npm run test` whenever test infrastructure or deleted files are involved; `npm run lint` at `--max-warnings 0`; `npm run typecheck`; `npm run caring-contacts:db:test` for migrations; `npm run verify:pr-local` only at the end of the plan.
- **Run `npm run format` and commit the result** before any handoff. Formatting is in neither `test`, `typecheck` nor `lint`, and the pre-push guard checks the pushed commit, not the working tree.

### Repository contracts that fail the build

- **Domain isolation.** No file under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib` module outside itself, Supabase, or OpenAI. Enforced by `tests/caring-contacts-domain-isolation.test.ts`, which parses every import specifier in the directory.
- **No mockup imports from production.** `eslint.config.mjs` `no-restricted-imports` forbids `src/**/*.{ts,tsx}` importing `**/*-mockups`, `**/*-mockups/*`, `**/*mockup*`. Production code may **never** import from `src/components/caring-contacts/mockups/`.
- **Button wiring** (`eslint-rules/require-button-wiring.mjs`): every `<button type="button">` needs `onClick`, `disabled`, or `aria-disabled`. `disabled` and `aria-disabled` **together** is an error. A control unavailable for a _stated reason_ uses `aria-disabled="true"` + `onClick={ignoreUnavailableActivation}` + `title="… — coming soon"` + an `sr-only` note wired by `aria-describedby`. Native `disabled` is only for transient inertness.
- **Tap floor is 48px** (`min-h-tap` / `h-tap w-tap` from `src/components/ui-primitives.tsx`). Do **not** use `min-h-11`/44px to satisfy generic WCAG advice — it reintroduces a known `ui-smoke` flake and is a blocking prohibition (design-system GATES §3, 15 Aug 2026).
- **Tokens only.** No `bg-[#…]` / `text-[#…]` / `border-[#…]` (`eslint-rules/no-hardcoded-hex.mjs`). No raw pixel padding, radius, gap or line-height. No `dark:` colour overrides (pinned at zero). `z-` values only from the ladder rungs `{0,5,10,20,30,40,60,80,81,82,83,84,85,95,100,110}`.
- **Lucide icons** need one of `aria-hidden` / `aria-label` / `aria-labelledby` / `role` / `title`.
- **Internal navigation** uses `<Link>` / `router.push` / server `redirect()` — never a raw `<a href="/…">`.
- **New production page routes must be reachable.** `tests/route-reachability.test.ts` resolves inbound links by _binding_, not by string match. This route becomes reachable through `src/lib/tools-catalog.ts`, which is a `builderTargets` source — see Task 15.
- **A new `ui-*.spec.ts` does not run unless its basename is added to BOTH `testMatch` (`playwright.config.ts:34`) AND `productionSpecPattern` (`playwright.config.ts:26`).** Silently never running is the failure mode here.
- Australian English, sentence case, verb-first object-specific actions. `en-AU` display dates with weekday and explicit AWST window; machine ISO retained underneath; **never a bare dash for a missing value** — use the `MissingValue` component.

### Naming and copy rules (exact values)

- The service is **Caring Contacts**. The name `Callback` is retired (spec §2.10).
- Transport vocabulary is closed: `Scheduled`, `Processing`, `Sent`, `Delivered`, `Not delivered`, `Number invalid`, `Contact changed`, `Status unavailable`, `Missed`, `Suppressed`, `Paused`, `Cancelled`. **None is a patient-state label.**
- Prohibited in any patient-visible or interface string: `high risk`, `safe`, `engagement score`, `campaign`, `lead`, `conversion`, `best match`, `inbox`, `conversation`, `clinical risk`, `risk score`, `wellbeing score`, and any claim that replies are monitored.
- `Delivered` means transport receipt only and is always qualified where clinical ambiguity could arise. A delivery exception "does not indicate patient safety, receipt, wellbeing or response".
- Patient-visible copy is **PROVISIONAL and not clinically approved**. `EXACT_PATIENT_VISIBLE_MESSAGE` with `PATIENT_VISIBLE_NO_REPLY_NOTICE` is pinned at **252 septets / 2 GSM-7 segments**; `AUTOMATED_REPLY_RESPONSE` is pinned at **218 septets / 2 segments**. Do not reword any of the three.

### Decisions already taken on the owner's behalf in this plan

Each is reversible. The cost column is what it costs if the decision was wrong.

| #   | Decision                                                                                                                                                                                                                                             | Cost if wrong                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | Two new human roles, `clinicalProgrammeLead` and `livedExperienceRepresentative`, are added so pathway dual approval has real named approvers. The demo role switcher offers all five.                                                               | The switcher shows two roles the 15 August decision lock did not name. Reversible in `permissions.ts`, the `actors` CHECK constraint and the switcher. |
| B   | The existing mockup at `/mockups/caring-contacts` is left completely untouched and stays the frozen atlas baseline. Production is a parallel build.                                                                                                  | Two copies of the screens exist until Phase 3 retires the mockup — about 5,900 lines of design scratch stays in the tree.                              |
| C   | The workspace is listed in the live tools catalogue (owner's decision, 19 August). It carries `robots: { index: false, follow: false }`, keeps the synthetic-data marker on every screen, and its catalogue card names it a synthetic demonstration. | If those safeguards are judged insufficient, the catalogue entry is one object literal to remove.                                                      |
| D   | The service safety stop gates **dispatch and mutation**, not reads. While stopped, every screen still reads; only sending and plan-changing actions refuse with the stop reason.                                                                     | If a stop was meant to freeze reads too, the gate moves from the write path to the read path in one wrapper.                                           |

---

## File Structure

### Groups 1–2 — sealed domain and storage (`src/lib/caring-contacts/`)

| File                                                                               | Responsibility                                                                                                                                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message-copy.ts` **(new)**                                                        | The three patient-visible strings and their pinned GSM-7 evidence, moved out of the mockup so production can import them without crossing the mockup import ban. |
| `permissions.ts` (modify)                                                          | Two new human roles; the new action names for referral, pathway publication, reconciliation, notification and training work.                                     |
| `service-state.ts` **(new)**                                                       | `ServiceState`, categorised stop reasons, `applyServiceStop`, `applyServiceRestartApproval` with the three-approval rule.                                        |
| `pathway-versions.ts` **(new)**                                                    | `PathwayVersion`, `applyPathwayVersionTransition`, the dual-approval record, urgent safety retirement.                                                           |
| `referrals.ts` **(new)**                                                           | `applyReferralTransition` and duplicate-referral routing.                                                                                                        |
| `assignment.ts` **(new)**                                                          | Plan ownership: claim, reassign, coverage.                                                                                                                       |
| `contact-rescheduling.ts` **(new)**                                                | `moveContactWithinDay` and `changeContactDate` rules (reason plus team-lead approval).                                                                           |
| `access-audit.ts` **(new)**                                                        | View and read audit event construction — the Phase 1 gap.                                                                                                        |
| `notification-preferences.ts` **(new)**                                            | Alert classes, per-user opt-in, and the identifier-free alert body.                                                                                              |
| `training.ts` **(new)**                                                            | Training-workspace ownership so simulation data can never join live queries.                                                                                     |
| `repository.ts` (modify)                                                           | The extended storage interface.                                                                                                                                  |
| `in-memory-repository.ts` (modify)                                                 | In-memory implementation of the extension.                                                                                                                       |
| `db/postgres-repository.ts` (modify)                                               | Postgres implementation of the extension.                                                                                                                        |
| `caring-contacts/supabase/migrations/0003_caring_contacts_workspace.sql` **(new)** | Columns and tables the extension needs, with RLS and audit triggers.                                                                                             |

### Group 3 — data path

| File                                                  | Responsibility                                                                                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/caring-contacts-server/config.ts` **(new)**  | Env resolution for `CARING_CONTACTS_DATABASE_URL`; asserts it never resolves to the Clinical KB project. Lives **outside** the sealed directory because it reads env. |
| `src/lib/caring-contacts-server/pool.ts` **(new)**    | `SqlConnectionPool` adapter, with an in-memory fallback when unconfigured.                                                                                            |
| `src/lib/caring-contacts-server/session.ts` **(new)** | Demo role switcher: resolves the acting `Actor` from a cookie.                                                                                                        |
| `src/lib/caring-contacts-server/handler.ts` **(new)** | Shared handler wrapper: Zod parse, actor resolution, **view auditing**, service-stop gate, refusal-to-HTTP mapping.                                                   |
| `src/app/api/caring-contacts/**/route.ts` **(new)**   | The route handlers.                                                                                                                                                   |

### Groups 4–5 — production interface

| File                                                                                                                      | Responsibility                                                              |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/app/caring-contacts/layout.tsx` **(new)**                                                                            | Route-group layout, metadata, providers.                                    |
| `src/app/caring-contacts/page.tsx` **(new)**                                                                              | Today. The remaining screens land in Plan 2B.                               |
| `src/components/caring-contacts/workspace/shell.tsx` **(new)**                                                            | The four-width shell: rail, header, phone dock, More sheet.                 |
| `src/components/caring-contacts/workspace/width-state.ts` **(new)**                                                       | The `compact` / `rail` / `split` / `wide` mapping as one exported contract. |
| `src/components/caring-contacts/workspace/service-state-banner.tsx` **(new)**                                             | Visible everywhere while a safety stop is active.                           |
| `src/components/caring-contacts/workspace/overlays/definitions.ts` **(new)**                                              | The 24-row definition table.                                                |
| `src/components/caring-contacts/workspace/overlays/overlay-host.tsx` **(new)**                                            | The single generic renderer that reads modality from the table.             |
| `src/lib/tools-catalog.ts`, `src/lib/category-identity.ts`, `src/components/tools-page-mockups/tool-fixtures.ts` (modify) | The inbound link that makes the route reachable.                            |

---

## Group 1 — Sealed domain completion

Every task in this group works only inside `src/lib/caring-contacts/` and its tests. `tests/caring-contacts-domain-isolation.test.ts` must stay green throughout; if it goes red, the module reached outside the boundary and the fix is to move the dependency inward, never to relax the test.

---

### Task 1: Patient-visible copy moves into the sealed domain

The three patient-visible strings and a second, duplicated `calculateGsm7` currently live in a **mockup component**, `src/components/caring-contacts/mockups/personalisation-screen.tsx`. Production code may never import from a mockup path (`eslint.config.mjs` `no-restricted-imports`), so production cannot reach them where they are. They move into the sealed domain; the mockup re-exports them so every existing pinned test keeps passing against the byte-identical strings.

**Files:**

- Create: `src/lib/caring-contacts/synthetic-contacts.ts`
- Create: `src/lib/caring-contacts/message-copy.ts`
- Modify: `src/components/caring-contacts/mockups/types.ts:27-41` (re-export instead of declare)
- Modify: `src/components/caring-contacts/mockups/personalisation-screen.tsx:15-62` (re-export instead of declare; delete the duplicated `calculateGsm7` and `Gsm7Evidence`)
- Test: `tests/caring-contacts-message-copy.test.ts` (new)

**Interfaces:**

- Consumes: `calculateGsm7(value: string): Gsm7Evidence` and `type Gsm7Evidence = { valid: boolean; septets: number; segments: number; invalidCharacters: string[] }` from `src/lib/caring-contacts/message-policy.ts`.
- Produces:
  - `FICTIONAL_CONTACTS_BY_ROLE: Readonly<{ miraPatientMobile: string; rowanPatientMobile: string; programmeStaffedLine: string; crisisSupportContact: string }>`
  - `DESIGNATED_FICTIONAL_MOBILE_NUMBERS: readonly string[]`
  - `PATIENT_VISIBLE_NO_REPLY_NOTICE: string`
  - `EXACT_PATIENT_VISIBLE_MESSAGE: string`
  - `AUTOMATED_REPLY_RESPONSE: string`
  - `EXACT_MESSAGE_GSM7: Gsm7Evidence`
  - `AUTOMATED_REPLY_GSM7: Gsm7Evidence`

**Critical:** the strings must be **byte-identical** to today's. `tests/caring-contact-mockups.dom.test.tsx:130-153` pins `EXACT_MESSAGE_GSM7` at exactly `{ invalidCharacters: [], segments: 2, septets: 252, valid: true }` and `AUTOMATED_REPLY_RESPONSE` at 218 septets / 2 segments. Do not reword, re-punctuate, or "improve" them — they are provisional clinical copy owned by an approval gate outside this build.

- [ ] **Step 1: Write the failing test**

Create `tests/caring-contacts-message-copy.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { calculateGsm7 } from "@/lib/caring-contacts/message-policy";
import {
  AUTOMATED_REPLY_GSM7,
  AUTOMATED_REPLY_RESPONSE,
  EXACT_MESSAGE_GSM7,
  EXACT_PATIENT_VISIBLE_MESSAGE,
  PATIENT_VISIBLE_NO_REPLY_NOTICE,
} from "@/lib/caring-contacts/message-copy";
import {
  DESIGNATED_FICTIONAL_MOBILE_NUMBERS,
  FICTIONAL_CONTACTS_BY_ROLE,
} from "@/lib/caring-contacts/synthetic-contacts";

describe("caring-contacts patient-visible copy", () => {
  it("keeps the pinned GSM-7 evidence for both patient-visible strings", () => {
    expect(EXACT_MESSAGE_GSM7).toEqual({ invalidCharacters: [], segments: 2, septets: 252, valid: true });
    expect(AUTOMATED_REPLY_GSM7).toEqual({ invalidCharacters: [], segments: 2, septets: 218, valid: true });
  });

  it("derives its evidence from the single domain GSM-7 calculator", () => {
    expect(EXACT_MESSAGE_GSM7).toEqual(calculateGsm7(EXACT_PATIENT_VISIBLE_MESSAGE));
    expect(AUTOMATED_REPLY_GSM7).toEqual(calculateGsm7(AUTOMATED_REPLY_RESPONSE));
  });

  it("names the staffed line and crisis support in both strings and neither patient mobile", () => {
    for (const text of [EXACT_PATIENT_VISIBLE_MESSAGE, AUTOMATED_REPLY_RESPONSE]) {
      expect(text).toContain(FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine);
      expect(text).toContain(FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact);
      expect(text).not.toContain(FICTIONAL_CONTACTS_BY_ROLE.rowanPatientMobile);
      expect(text).not.toContain(FICTIONAL_CONTACTS_BY_ROLE.miraPatientMobile);
    }
  });

  it("states only that nobody reads replies, never that replies are not received", () => {
    expect(EXACT_PATIENT_VISIBLE_MESSAGE).toContain(PATIENT_VISIBLE_NO_REPLY_NOTICE);
    expect(PATIENT_VISIBLE_NO_REPLY_NOTICE).toBe("No one reads replies to this number");
    for (const text of [EXACT_PATIENT_VISIBLE_MESSAGE, AUTOMATED_REPLY_RESPONSE]) {
      expect(text).not.toMatch(/replies are not received|we monitor|monitored/i);
    }
  });

  it("uses four distinct reserved fictional numbers", () => {
    expect(new Set(DESIGNATED_FICTIONAL_MOBILE_NUMBERS).size).toBe(4);
    expect(DESIGNATED_FICTIONAL_MOBILE_NUMBERS).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:focused -- --files tests/caring-contacts-message-copy.test.ts`
Expected: FAIL — `Cannot find module '@/lib/caring-contacts/message-copy'`.

- [ ] **Step 3: Create the two domain modules**

Create `src/lib/caring-contacts/synthetic-contacts.ts`:

```ts
// Reserved fictional numbers only. These are ACMA/Ofcom-style numbers that can never
// connect to a real person, so a screenshot, a test failure or a demonstration can show a
// complete message without any possibility of contacting anyone.
export const FICTIONAL_CONTACTS_BY_ROLE = Object.freeze({
  miraPatientMobile: "+61 491 570 006",
  rowanPatientMobile: "+61 491 570 156",
  programmeStaffedLine: "+61 491 570 157",
  crisisSupportContact: "+61 491 570 158",
} as const);

export type FictionalContactRole = keyof typeof FICTIONAL_CONTACTS_BY_ROLE;

export const DESIGNATED_FICTIONAL_MOBILE_NUMBERS = Object.freeze([
  FICTIONAL_CONTACTS_BY_ROLE.miraPatientMobile,
  FICTIONAL_CONTACTS_BY_ROLE.rowanPatientMobile,
  FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine,
  FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact,
] as const);

export type DesignatedFictionalMobileNumber = (typeof DESIGNATED_FICTIONAL_MOBILE_NUMBERS)[number];
export type SyntheticPatientMobile =
  (typeof FICTIONAL_CONTACTS_BY_ROLE)["miraPatientMobile"] | (typeof FICTIONAL_CONTACTS_BY_ROLE)["rowanPatientMobile"];
```

Create `src/lib/caring-contacts/message-copy.ts` — copy the three string literals **verbatim** from `src/components/caring-contacts/mockups/personalisation-screen.tsx:15-33`, including their PROVISIONAL comments:

```ts
import { calculateGsm7, type Gsm7Evidence } from "./message-policy";
import { FICTIONAL_CONTACTS_BY_ROLE } from "./synthetic-contacts";

// PROVISIONAL — not clinically approved. Corrected 2026-08-19 under production-build spec §2.1, which
// replaced the non-receiving sender with a receiving-capable number that auto-responds and discards.
// The previous wording ("Replies are not received, stored, analysed or monitored") became untrue the
// moment the number could receive: replies ARE received, then discarded unread. Stating something false
// about a safety boundary is the failure this programme can least afford, so the claim now describes only
// what remains true — that nobody reads them. Final wording is a clinical decision owned by the
// lived-experience and clinical-programme approval gate (docs/caring-contacts/message-review-pack.md §1).
export const PATIENT_VISIBLE_NO_REPLY_NOTICE = "No one reads replies to this number";

export const EXACT_PATIENT_VISIBLE_MESSAGE = `Hi Rowan, Alex from Example Aftercare Team is thinking of you. This is a one-way message. ${PATIENT_VISIBLE_NO_REPLY_NOTICE}. For timing changes call ${FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine}, 9 am-6 pm. In an emergency call 000. Fictional Support Line: ${FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact}. - Alex`;

// PROVISIONAL — not clinically approved. Required by production-build spec §2.1: the automated response
// sent to anyone who replies. It must name where a person IS available, immediately after saying that
// nobody reads this channel, so that reaching out is answered rather than met with silence. Content is
// discarded after this response is sent; nothing is stored, counted per patient, or shown to staff.
export const AUTOMATED_REPLY_RESPONSE = `This number is not read. Your message has not been seen by anyone and has not been kept. To talk to someone, call ${FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine}, 9 am-6 pm every day. In an emergency call 000. Fictional Support Line: ${FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact}.`;

export const EXACT_MESSAGE_GSM7: Gsm7Evidence = calculateGsm7(EXACT_PATIENT_VISIBLE_MESSAGE);
export const AUTOMATED_REPLY_GSM7: Gsm7Evidence = calculateGsm7(AUTOMATED_REPLY_RESPONSE);
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm run test:focused -- --files tests/caring-contacts-message-copy.test.ts`
Expected: PASS, 5 tests.

If the septet counts differ from 252/218, **do not adjust the expected numbers**. It means `message-policy.ts`'s `calculateGsm7` disagrees with the mockup's copy of it — find and fix the real difference between the two implementations, because the whole point of the move is that there is now one calculator.

- [ ] **Step 5: Re-point the mockup at the domain**

In `src/components/caring-contacts/mockups/types.ts`, delete the `FICTIONAL_CONTACTS_BY_ROLE` / `DESIGNATED_FICTIONAL_MOBILE_NUMBERS` declarations at lines 27-41 and replace with a re-export:

```ts
export {
  DESIGNATED_FICTIONAL_MOBILE_NUMBERS,
  FICTIONAL_CONTACTS_BY_ROLE,
  type DesignatedFictionalMobileNumber,
  type FictionalContactRole,
  type SyntheticPatientMobile,
} from "@/lib/caring-contacts/synthetic-contacts";
```

In `src/components/caring-contacts/mockups/personalisation-screen.tsx`, delete lines 17-62 (the three constants, `GSM_7_BASIC_CHARACTERS`, `GSM_7_EXTENSION_CHARACTERS`, `Gsm7Evidence`, `calculateGsm7`, `EXACT_MESSAGE_GSM7`) and replace with:

```ts
export { calculateGsm7, type Gsm7Evidence } from "@/lib/caring-contacts/message-policy";
export {
  AUTOMATED_REPLY_RESPONSE,
  EXACT_MESSAGE_GSM7,
  EXACT_PATIENT_VISIBLE_MESSAGE,
  PATIENT_VISIBLE_NO_REPLY_NOTICE,
} from "@/lib/caring-contacts/message-copy";
```

Keep every other export in that file untouched (`ActivationGovernanceState`, `ActivationBlocker`, `getActivationBlockers`, `canActivateGovernedVersions`, `PersonalisationScreen`).

- [ ] **Step 6: Run every affected suite**

Run: `npm run test:focused -- --files tests/caring-contacts-message-copy.test.ts,tests/caring-contact-mockups.dom.test.tsx,tests/caring-contact-product-redesign.dom.test.tsx,tests/caring-contacts-domain-isolation.test.ts,tests/caring-contacts-message-policy.test.ts`
Expected: PASS. Paste the `N passed` line.

Then `npm run lint` — the mockup files are **not** in `MOCKUP_IGNORES` (that list covers `src/app/mockups/**`, `**/*-mockups/**`, `**/*-mockups.tsx`, `**/*-mockup.tsx`, none of which matches `src/components/caring-contacts/mockups/`), so they are linted like production and must stay at zero warnings.

- [ ] **Step 7: Prove the tests can fail**

Change one character inside `EXACT_PATIENT_VISIBLE_MESSAGE` (for example `9 am-6 pm` to `9 am-7 pm`) and re-run the focused suite. Expect the septet count assertion **and** `tests/caring-contact-mockups.dom.test.tsx` to go red. Revert.

- [ ] **Step 8: Commit**

```bash
git add src/lib/caring-contacts/synthetic-contacts.ts src/lib/caring-contacts/message-copy.ts src/components/caring-contacts/mockups/types.ts src/components/caring-contacts/mockups/personalisation-screen.tsx tests/caring-contacts-message-copy.test.ts
git commit -m "refactor(caring-contacts): move patient-visible copy into the sealed domain so production can use it"
```

---

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

### Task 5: Referrals

`referrals` is a table with an audit trigger that nothing ever writes, and `plans.referral_id` is a plain text column with no foreign key because no referral is ever created. Spec §8 requires that a duplicate referral for an active plan is blocked and routed to the existing episode, and that a later qualifying discharge creates a new linked episode that never mutates the earlier one.

**Files:**

- Create: `src/lib/caring-contacts/referrals.ts`
- Test: `tests/caring-contacts-referrals.test.ts` (new)

**Interfaces:**

- Consumes: `Referral`, `ReferralState`, `TransitionResult<T>` from `./model`; `PatientId`, `ReferralId`, `TeamId`, `PathwayVersionId` from `./ids`.
- Produces:

```ts
export type ReferralAction =
  | { type: "accept"; pathwayVersionId: PathwayVersionId }
  | { type: "returnForClarification"; reason: string }
  | { type: "decline"; reason: string };

export type DuplicateReferralOutcome =
  { type: "createNewEpisode" } | { type: "routeToExistingEpisode"; planId: PlanId };

export function applyReferralTransition(referral: Referral, action: ReferralAction): TransitionResult<Referral>;
export function routeIncomingReferral(input: {
  patientId: PatientId;
  existingNonTerminalPlanId: PlanId | null;
}): DuplicateReferralOutcome;
```

**Rules:** every action is legal only from `awaitingHandover`, otherwise `referral-not-awaiting-handover`; `accept` records the chosen `pathwayVersionId`; `returnForClarification` and `decline` require a non-blank reason (`referral-reason-required`); `returnForClarification` and `decline` clear `pathwayVersionId` to `null`. `routeIncomingReferral` returns `routeToExistingEpisode` whenever a non-terminal plan exists for that patient, and `createNewEpisode` otherwise — it never mutates anything.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { applyReferralTransition, routeIncomingReferral } from "@/lib/caring-contacts/referrals";
import { patientId, pathwayVersionId, planId, referralId, teamId } from "@/lib/caring-contacts/ids";
import type { Referral } from "@/lib/caring-contacts/model";

const awaiting: Referral = {
  id: referralId("SYN-REFERRAL-001"),
  teamId: teamId("TEAM-A"),
  patientId: patientId("SYN-PATIENT-001"),
  state: "awaitingHandover",
  pathwayVersionId: null,
};

describe("referral lifecycle", () => {
  it("accepts a referral onto a named pathway version", () => {
    const result = applyReferralTransition(awaiting, {
      type: "accept",
      pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001"),
    });
    expect(result).toEqual({
      ok: true,
      value: { ...awaiting, state: "accepted", pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001") },
    });
  });

  it("requires a reason to return or decline", () => {
    for (const type of ["returnForClarification", "decline"] as const) {
      expect(applyReferralTransition(awaiting, { type, reason: "  " })).toEqual({
        ok: false,
        reason: "referral-reason-required",
      });
    }
  });

  it("refuses any action once the referral has left handover", () => {
    const accepted = { ...awaiting, state: "accepted" as const };
    expect(applyReferralTransition(accepted, { type: "decline", reason: "duplicate" })).toEqual({
      ok: false,
      reason: "referral-not-awaiting-handover",
    });
  });

  it("routes a duplicate referral to the existing episode instead of starting a second one", () => {
    expect(
      routeIncomingReferral({
        patientId: patientId("SYN-PATIENT-001"),
        existingNonTerminalPlanId: planId("SYN-PLAN-001"),
      }),
    ).toEqual({ type: "routeToExistingEpisode", planId: planId("SYN-PLAN-001") });

    expect(routeIncomingReferral({ patientId: patientId("SYN-PATIENT-001"), existingNonTerminalPlanId: null })).toEqual(
      { type: "createNewEpisode" },
    );
  });
});
```

- [ ] **Step 2: Run and verify it fails** (module not found).
- [ ] **Step 3: Implement `referrals.ts`.**
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line.
- [ ] **Step 5: Prove it can fail.** Make `routeIncomingReferral` always return `createNewEpisode` → the duplicate test goes red. Revert.
- [ ] **Step 6: Commit**

```bash
git add src/lib/caring-contacts/referrals.ts tests/caring-contacts-referrals.test.ts
git commit -m "feat(caring-contacts): referral lifecycle and duplicate-referral routing"
```

---

### Task 6: Plan ownership, reassignment and coverage

Nothing today records which coordinator owns a plan. `claimPlan` and `reassignPlan` are granted action names with no implementation and no field, which is why the spec §4.2 workload monitor ("active plans per coordinator") is currently uncomputable. Spec §4.3 also asks for coverage and absence, "with the named coordinator and any formal reassignment still visible" — so coverage must never erase the owner.

**Files:**

- Create: `src/lib/caring-contacts/assignment.ts`
- Test: `tests/caring-contacts-assignment.test.ts` (new)

**Interfaces:**

- Produces:

```ts
export type PlanAssignment = {
  ownerId: ActorId | null;
  claimedAt: string | null;
  coveredBy: { actorId: ActorId; from: string; until: string } | null;
  reassignmentHistory: readonly { fromActorId: ActorId; toActorId: ActorId; reason: string; at: string }[];
};

export type AssignmentAction =
  | { type: "claim"; actorId: ActorId }
  | { type: "reassign"; toActorId: ActorId; reason: string }
  | { type: "startCoverage"; actorId: ActorId; from: string; until: string }
  | { type: "endCoverage" };

export function unassigned(): PlanAssignment;
export function applyAssignmentAction(
  assignment: PlanAssignment,
  action: AssignmentAction,
  clock: Clock,
): TransitionResult<PlanAssignment>;
export function effectiveResponder(assignment: PlanAssignment, atIso: string): ActorId | null;
export function queueAgeMinutes(claimableSinceIso: string, nowIso: string): number;
export const UNCLAIMED_ESCALATION_MINUTES: 60;
```

**Rules:** `claim` is refused `plan-already-claimed` when an owner exists. `reassign` is refused `plan-not-claimed` when there is no owner and `reassignment-reason-required` on a blank reason; it appends to `reassignmentHistory` and **keeps the full history** — a reassignment never deletes the earlier owner. `startCoverage` is refused `plan-not-claimed` without an owner and `coverage-window-invalid` when `until` is not after `from`; it **never changes `ownerId`**. `effectiveResponder` returns the coverer inside the coverage window and the owner otherwise. `queueAgeMinutes` is whole minutes, floored, and never negative. `UNCLAIMED_ESCALATION_MINUTES` is the spec's 60-minute unclaimed-work escalation.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { fixedClock } from "@/lib/caring-contacts/clock";
import { actorId } from "@/lib/caring-contacts/ids";
import {
  UNCLAIMED_ESCALATION_MINUTES,
  applyAssignmentAction,
  effectiveResponder,
  queueAgeMinutes,
  unassigned,
  type PlanAssignment,
} from "@/lib/caring-contacts/assignment";

const clock = fixedClock("2026-08-19T02:00:00.000Z");
const OWNER = actorId("ACTOR-OWNER");

function claimed(): PlanAssignment {
  const result = applyAssignmentAction(unassigned(), { type: "claim", actorId: OWNER }, clock);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe("plan ownership", () => {
  it("records the owner on claim and refuses a second claim", () => {
    expect(claimed().ownerId).toBe(OWNER);
    expect(applyAssignmentAction(claimed(), { type: "claim", actorId: actorId("OTHER") }, clock)).toEqual({
      ok: false,
      reason: "plan-already-claimed",
    });
  });

  it("keeps the previous owner visible in the reassignment history", () => {
    const result = applyAssignmentAction(
      claimed(),
      { type: "reassign", toActorId: actorId("ACTOR-NEW"), reason: "annual leave" },
      clock,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.ownerId).toBe(actorId("ACTOR-NEW"));
    expect(result.value.reassignmentHistory).toHaveLength(1);
    expect(result.value.reassignmentHistory[0]).toMatchObject({ fromActorId: OWNER, reason: "annual leave" });
  });

  it("covers without replacing the named coordinator", () => {
    const result = applyAssignmentAction(
      claimed(),
      { type: "startCoverage", actorId: actorId("ACTOR-COVER"), from: "2026-08-20", until: "2026-08-27" },
      clock,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.ownerId).toBe(OWNER);
    expect(effectiveResponder(result.value, "2026-08-21")).toBe(actorId("ACTOR-COVER"));
    expect(effectiveResponder(result.value, "2026-08-28")).toBe(OWNER);
  });

  it("refuses a coverage window that does not move forward", () => {
    expect(
      applyAssignmentAction(
        claimed(),
        { type: "startCoverage", actorId: actorId("C"), from: "2026-08-20", until: "2026-08-20" },
        clock,
      ),
    ).toEqual({ ok: false, reason: "coverage-window-invalid" });
  });

  it("measures queue age against the 60-minute escalation", () => {
    expect(UNCLAIMED_ESCALATION_MINUTES).toBe(60);
    expect(queueAgeMinutes("2026-08-19T00:00:00.000Z", "2026-08-19T01:30:00.000Z")).toBe(90);
    expect(queueAgeMinutes("2026-08-19T02:00:00.000Z", "2026-08-19T01:00:00.000Z")).toBe(0);
  });
});
```

- [ ] **Step 2: Run and verify it fails.**
- [ ] **Step 3: Implement `assignment.ts`.**
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line.
- [ ] **Step 5: Prove it can fail.** Make `startCoverage` set `ownerId` to the coverer → the "covers without replacing" test goes red. Revert.
- [ ] **Step 6: Commit**

```bash
git add src/lib/caring-contacts/assignment.ts tests/caring-contacts-assignment.test.ts
git commit -m "feat(caring-contacts): plan ownership, reassignment history and coverage"
```

---

### Task 7: Moving a contact within its day, and changing its date

Coordination design spec §5: "A coordinator may move a contact only within its scheduled day; a date change needs a reason and team-lead approval." Both are granted action names (`moveContactWithinDay`, `changeContactDate`) with no rules behind them. Spec §8 also requires that nothing sends outside 09:00–18:00 AWST and that the calendar never rebases.

**Files:**

- Create: `src/lib/caring-contacts/contact-rescheduling.ts`
- Test: `tests/caring-contacts-contact-rescheduling.test.ts` (new)

**Interfaces:**

- Consumes: `PlannedContact` from `./schedule`; `isWithinApprovedSendWindow`, `APPROVED_SEND_WINDOW` from `./schedule`; `awstCalendarDay`, `awstWallTimeToInstant`, `Clock` from `./clock`.
- Produces:

```ts
export type ContactMoveRequest = { contact: PlannedContact; toHour: number; toMinute: number };
export type ContactDateChangeRequest = {
  contact: PlannedContact;
  toCalendarDay: string;
  reason: string;
  teamLeadApprovalActorId: ActorId | null;
};

export function moveContactWithinDay(request: ContactMoveRequest): TransitionResult<PlannedContact>;
export function changeContactDate(request: ContactDateChangeRequest, clock: Clock): TransitionResult<PlannedContact>;
```

**Rules:** `moveContactWithinDay` refuses `contact-move-leaves-scheduled-day` when the resulting instant's AWST calendar day differs from the contact's `calendarDay`, and `contact-move-outside-approved-window` when the new time is outside 09:00–18:00. `changeContactDate` refuses `contact-date-change-reason-required` on a blank reason, `contact-date-change-approval-required` when `teamLeadApprovalActorId` is null, and `contact-date-change-in-the-past` when the target day is before the clock's AWST day. Neither function may touch `sequence`, `cadenceLabel`, `messageType` or `suppressed` — the calendar identity is fixed even when the instant moves.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { awstWallTimeToInstant, fixedClock } from "@/lib/caring-contacts/clock";
import { actorId } from "@/lib/caring-contacts/ids";
import { changeContactDate, moveContactWithinDay } from "@/lib/caring-contacts/contact-rescheduling";
import type { PlannedContact } from "@/lib/caring-contacts/schedule";

const clock = fixedClock("2026-08-19T02:00:00.000Z");
const contact: PlannedContact = {
  sequence: 3,
  cadenceLabel: "Month 1",
  calendarDay: "2026-09-15",
  sendAt: awstWallTimeToInstant("2026-09-15", 10),
  messageType: "standard",
};

describe("rescheduling a contact", () => {
  it("moves a contact inside its own day and keeps its calendar identity", () => {
    const result = moveContactWithinDay({ contact, toHour: 14, toMinute: 0 });
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.sendAt).toEqual(awstWallTimeToInstant("2026-09-15", 14));
    expect(result.value.sequence).toBe(3);
    expect(result.value.cadenceLabel).toBe("Month 1");
    expect(result.value.calendarDay).toBe("2026-09-15");
  });

  it("refuses a move outside the approved send window", () => {
    expect(moveContactWithinDay({ contact, toHour: 20, toMinute: 0 })).toEqual({
      ok: false,
      reason: "contact-move-outside-approved-window",
    });
  });

  it("refuses a date change with no reason and no team-lead approval", () => {
    expect(
      changeContactDate(
        { contact, toCalendarDay: "2026-09-16", reason: " ", teamLeadApprovalActorId: actorId("LEAD") },
        clock,
      ),
    ).toEqual({ ok: false, reason: "contact-date-change-reason-required" });

    expect(
      changeContactDate(
        { contact, toCalendarDay: "2026-09-16", reason: "ward transfer", teamLeadApprovalActorId: null },
        clock,
      ),
    ).toEqual({ ok: false, reason: "contact-date-change-approval-required" });
  });

  it("refuses a date change into the past", () => {
    expect(
      changeContactDate(
        { contact, toCalendarDay: "2026-08-01", reason: "ward transfer", teamLeadApprovalActorId: actorId("LEAD") },
        clock,
      ),
    ).toEqual({ ok: false, reason: "contact-date-change-in-the-past" });
  });

  it("changes the date without rebasing the cadence label", () => {
    const result = changeContactDate(
      { contact, toCalendarDay: "2026-09-16", reason: "ward transfer", teamLeadApprovalActorId: actorId("LEAD") },
      clock,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.calendarDay).toBe("2026-09-16");
    expect(result.value.cadenceLabel).toBe("Month 1");
    expect(result.value.sequence).toBe(3);
  });
});
```

- [ ] **Step 2: Run and verify it fails.**
- [ ] **Step 3: Implement `contact-rescheduling.ts`.**
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line.
- [ ] **Step 5: Prove it can fail.** Drop the approved-window check → the 20:00 test goes red. Revert.
- [ ] **Step 6: Commit**

```bash
git add src/lib/caring-contacts/contact-rescheduling.ts tests/caring-contacts-contact-rescheduling.test.ts
git commit -m "feat(caring-contacts): within-day contact moves and approved date changes"
```

---

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

### Task 11: Migration 0003 and the Postgres implementation

**Files:**

- Create: `caring-contacts/supabase/migrations/0003_caring_contacts_workspace.sql`
- Modify: `src/lib/caring-contacts/db/postgres-repository.ts`
- Test: `tests/caring-contacts-postgres-repository.test.ts` (extend)
- Test: `tests/caring-contacts-migrations.test.ts` (extend)

**Schema changes:**

| Table                                | Change                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `service_state`                      | add `stopped_reason text` with a CHECK against the five categorised reasons; add `stop_note text`; **drop** `restart_approved_by text` and add child table `service_restart_approvals (team_id, role, actor_id, approved_at)` with `UNIQUE (team_id, role)` and `UNIQUE (team_id, actor_id)` — the two uniques are what make a single-person restart impossible in the database, not only in TypeScript                  |
| `pathway_versions`                   | add `published_at timestamptz`, `retired_at timestamptz`, `retirement_urgency text` CHECK in (routine, urgentSafety), `snapshot jsonb not null`; add child table `pathway_version_approvals (pathway_version_id, role, actor_id, approved_at)` with `UNIQUE (pathway_version_id, role)` and `UNIQUE (pathway_version_id, actor_id)`; keep the existing `no_self_approval` CHECK and add the same rule to the child table |
| `plans`                              | add `pathway_version_id` **foreign key** to `pathway_versions(id)` and `referral_id` foreign key to `referrals(id)` — closing Phase 1 open item 2                                                                                                                                                                                                                                                                        |
| `plan_assignments` **(new)**         | `plan_id pk → plans CASCADE`, `team_id → teams`, `owner_id text`, `claimed_at timestamptz`, `covered_by text`, `coverage_from text`, `coverage_until text`                                                                                                                                                                                                                                                               |
| `plan_reassignments` **(new)**       | `id bigint identity pk`, `plan_id → plans CASCADE`, `team_id`, `from_actor_id`, `to_actor_id`, `reason text not null`, `at timestamptz`                                                                                                                                                                                                                                                                                  |
| `contact_dispatches`                 | add `reported_status text`, `discrepancy_resolved_at timestamptz`, `discrepancy_resolution text` CHECK in (confirmedDelivered, confirmedNotDelivered, unresolvedNoResend), `discrepancy_note text`                                                                                                                                                                                                                       |
| `notification_preferences` **(new)** | `actor_id pk`, `team_id → teams`, `opted_in text[] not null default '{}'`                                                                                                                                                                                                                                                                                                                                                |
| `training_records` **(new)**         | `actor_id pk`, `team_id → teams`, `completed text[] not null default '{}'`                                                                                                                                                                                                                                                                                                                                               |
| `retention_state`                    | no columns added; it finally gets writes from `markRetentionCleared`                                                                                                                                                                                                                                                                                                                                                     |
| every new table                      | `enable row level security` + `force row level security` + one policy `<table>_team_scope FOR ALL TO caring_contacts_app USING (team_id = caring_contacts.current_team_id()) WITH CHECK (same)`, and the `require_audit` constraint trigger where the table carries a mutation                                                                                                                                           |

**Hard rules:** this file goes in `caring-contacts/supabase/migrations/`, **never** `supabase/migrations/`. It targets role `postgres`. It creates nothing in the Clinical KB project. `tests/caring-contacts-migrations.test.ts` already asserts the directory separation — extend it to assert the new file is present in the caring-contacts directory and absent from the repository one.

- [ ] **Step 1: Write the failing tests**

Extend `tests/caring-contacts-migrations.test.ts`:

```ts
it("keeps every caring-contact migration out of the Clinical KB migration directory", () => {
  const caringContactMigrations = readdirSync("caring-contacts/supabase/migrations");
  expect(caringContactMigrations).toContain("0003_caring_contacts_workspace.sql");
  const repositoryMigrations = readdirSync("supabase/migrations");
  for (const file of caringContactMigrations) {
    expect(repositoryMigrations).not.toContain(file);
  }
});

it("makes a single-person restart impossible in the database, not only in TypeScript", () => {
  const sql = readFileSync("caring-contacts/supabase/migrations/0003_caring_contacts_workspace.sql", "utf8");
  expect(sql).toMatch(/unique\s*\(\s*team_id\s*,\s*role\s*\)/i);
  expect(sql).toMatch(/unique\s*\(\s*team_id\s*,\s*actor_id\s*\)/i);
});
```

Extend `tests/caring-contacts-postgres-repository.test.ts` with the Group 2 behaviours, plus these two that only a real database can prove:

```ts
it("refuses a second restart approval from the same person at the database level", async () => {
  await store.stopService({ reason: "wrong-recipient", note: "n" }, writeContext(coordinator, "stop"));
  await store.approveServiceRestart({ role: "incidentLead" }, writeContext(soloActor, "approve-1"));
  await expect(
    store.approveServiceRestart({ role: "privacySecurityOwner" }, writeContext(soloActor, "approve-2")),
  ).resolves.toEqual({ ok: false, reason: "restart-approval-actor-already-recorded" });
});

it("refuses a plan whose pathway version does not exist, now that the foreign key is real", async () => {
  const result = await store.createPlan(
    { ...validPlanInput, pathwayVersionId: pathwayVersionId("MISSING") },
    writeContext(coordinator, "create"),
  );
  expect(result.ok).toBe(false);
});

it("keeps a cross-team actor from reading another team's assignment", async () => {
  await expect(store.getAssignment(planFromTeamA, { actor: teamBCoordinator })).resolves.toBeNull();
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npm run test:focused -- --files tests/caring-contacts-migrations.test.ts`
Expected: FAIL — the migration file does not exist.

Run: `npm run caring-contacts:db:test`
Expected: FAIL. This needs Docker and Postgres 17; it is local and offline and needs no provider approval.

- [ ] **Step 3: Write the migration and the Postgres implementation.** Reuse the existing transaction preamble unchanged (`begin` → `set_config('caring_contacts.team_id')` → `set_config('caring_contacts.audit_token')` → `set local role caring_contacts_app`). Map the two new unique-violation SQLSTATEs onto `restart-approval-role-already-recorded` and `restart-approval-actor-already-recorded` so TypeScript and the database give the same refusal string.

- [ ] **Step 4: Run and verify they pass**

Run: `npm run caring-contacts:db:test`
Expected: PASS. Paste the decisive `N passed` line — not the exit code.

- [ ] **Step 5: Prove the tests can fail — four mutations**

1. Drop the `UNIQUE (team_id, actor_id)` on `service_restart_approvals` → the single-person restart test goes red.
2. Drop the `plans.pathway_version_id` foreign key → the missing-pathway test goes red.
3. Remove the team-scope policy from `plan_assignments` → the cross-team assignment test goes red.
4. Remove the `require_audit` trigger from one new mutating table → the transactional-audit test goes red.

Revert each. Any mutation that leaves the suite green means that assertion is decorative.

- [ ] **Step 6: Commit**

```bash
git add caring-contacts/supabase/migrations/0003_caring_contacts_workspace.sql src/lib/caring-contacts/db/postgres-repository.ts tests/caring-contacts-postgres-repository.test.ts tests/caring-contacts-migrations.test.ts
git commit -m "feat(caring-contacts): workspace schema with database-enforced three-person restart and real pathway/referral keys"
```

---

### Checkpoint 2 — end of Group 2

```bash
npm run test
```

```bash
npm run caring-contacts:db:test
```

Paste both `N passed` lines. The rules layer is now complete and every §4.2 screen has a real data source.

---

## Group 3 — The data path

Everything here lives **outside** `src/lib/caring-contacts/` because it reads environment variables, touches cookies and speaks HTTP. The sealed directory stays sealed.

---

### Task 12: Database configuration that can never point at the Clinical KB project

**Files:**

- Create: `src/lib/caring-contacts-server/config.ts`
- Create: `src/lib/caring-contacts-server/pool.ts`
- Create: `src/lib/caring-contacts-server/store.ts`
- Test: `tests/caring-contacts-server-config.test.ts` (new)

**Interfaces:**

```ts
// config.ts
export type CaringContactsDataMode = "postgres" | "in-memory";
export function caringContactsDatabaseUrl(): string | null;
export function caringContactsDataMode(): CaringContactsDataMode;
export function assertNotClinicalKbProject(url: string): void; // throws CaringContactsProjectSeparationError
export class CaringContactsProjectSeparationError extends Error {}

// pool.ts
export function createCaringContactsPool(url: string): SqlConnectionPool;

// store.ts
export async function caringContactsStore(): Promise<CaringContactRepository>;
```

**Rules:** the only environment variable read is `CARING_CONTACTS_DATABASE_URL`. It shares **no** value with any `NEXT_PUBLIC_SUPABASE_*` or `SUPABASE_*`. `assertNotClinicalKbProject` throws if the URL contains the pinned Clinical KB reference `sjrfecxgysukkwxsowpy`, or if it equals `process.env.SUPABASE_DB_URL`/`DATABASE_URL`. When the variable is absent, `caringContactsDataMode()` is `"in-memory"` and `caringContactsStore()` returns `createInMemoryRepository(systemClock())` so the workspace runs with no database at all — this is the mode the demo and the tests use.

**Never print a value.** Error messages name the variable, never its contents.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CaringContactsProjectSeparationError,
  assertNotClinicalKbProject,
  caringContactsDataMode,
} from "@/lib/caring-contacts-server/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("caring-contacts database configuration", () => {
  it("falls back to the in-memory store when unconfigured", () => {
    vi.stubEnv("CARING_CONTACTS_DATABASE_URL", "");
    expect(caringContactsDataMode()).toBe("in-memory");
  });

  it("refuses the pinned Clinical KB project reference", () => {
    expect(() =>
      assertNotClinicalKbProject("postgres://user@db.sjrfecxgysukkwxsowpy.supabase.co:5432/postgres"),
    ).toThrow(CaringContactsProjectSeparationError);
  });

  it("refuses a URL that is byte-identical to the Clinical KB connection", () => {
    vi.stubEnv("SUPABASE_DB_URL", "postgres://shared@example.invalid:5432/postgres");
    expect(() => assertNotClinicalKbProject("postgres://shared@example.invalid:5432/postgres")).toThrow(
      CaringContactsProjectSeparationError,
    );
  });

  it("never puts a connection string into its error message", () => {
    try {
      assertNotClinicalKbProject("postgres://secret@db.sjrfecxgysukkwxsowpy.supabase.co:5432/postgres");
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as Error).message).not.toContain("secret");
      expect((error as Error).message).toContain("CARING_CONTACTS_DATABASE_URL");
    }
  });
});
```

- [ ] **Step 2: Run and verify it fails.**
- [ ] **Step 3: Implement the three modules.** `pool.ts` imports `pg` — already a devDependency from Phase 1. If the workspace is to run against Postgres outside tests, promote `pg` to a runtime dependency in the same commit and say so; otherwise keep the in-memory default and leave `pg` where it is.
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line. Then run `npm run check:supabase-project` — it must still pass unchanged, and it is a local static check, not a provider call.
- [ ] **Step 5: Prove it can fail.** Remove the Clinical KB reference check → the second test goes red. Revert.
- [ ] **Step 6: Commit**

```bash
git add src/lib/caring-contacts-server/ tests/caring-contacts-server-config.test.ts
git commit -m "feat(caring-contacts): database configuration that cannot resolve to the Clinical KB project"
```

---

### Task 13: The demo role switcher

The decision lock requires WA Health enterprise sign-on and states that no Caring-Contacts-local credentials exist, so this is **not** a login and must never look like one. It is a role switcher, labelled as one, that exists because the permission and auditor surfaces cannot be demonstrated without it.

**Files:**

- Create: `src/lib/caring-contacts-server/session.ts`
- Create: `src/app/api/caring-contacts/session/route.ts`
- Test: `tests/caring-contacts-session.test.ts` (new)

**Interfaces:**

```ts
export const CARING_CONTACTS_ROLE_COOKIE = "caring-contacts-demo-role";
export const DEMO_ROLES: readonly CaringContactRole[]; // all five, in switcher order
export const DEMO_TEAM_ID: TeamId;
export async function resolveDemoActor(): Promise<Actor>; // reads cookies(), defaults to coordinator
export function demoActorForRole(role: CaringContactRole): Actor;
```

**Rules:** the cookie holds only a role name from `DEMO_ROLES`; anything else falls back to `coordinator` rather than throwing, because an unreadable cookie must never lock someone out of a demonstration. There is no password field anywhere. The actor id is derived from the role (`demo-<role>`) so the audit trail shows who acted. `cookies()` is async in Next 16 — `await cookies()`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

import {
  CARING_CONTACTS_ROLE_COOKIE,
  DEMO_ROLES,
  demoActorForRole,
  resolveDemoActor,
} from "@/lib/caring-contacts-server/session";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => mockCookies[name] })),
}));

let mockCookies: Record<string, { value: string } | undefined> = {};

describe("demo role switcher", () => {
  it("offers all five roles and no credential field", () => {
    expect(DEMO_ROLES).toEqual([
      "coordinator",
      "teamLead",
      "auditor",
      "clinicalProgrammeLead",
      "livedExperienceRepresentative",
    ]);
  });

  it("defaults to the coordinator when no cookie is set", async () => {
    mockCookies = {};
    await expect(resolveDemoActor()).resolves.toMatchObject({ roles: ["coordinator"] });
  });

  it("falls back to the coordinator on an unreadable cookie rather than failing", async () => {
    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "administrator" } };
    await expect(resolveDemoActor()).resolves.toMatchObject({ roles: ["coordinator"] });
  });

  it("names the acting role in the actor id so the audit trail can show it", () => {
    expect(demoActorForRole("auditor").id).toBe("demo-auditor");
  });
});
```

- [ ] **Step 2: Run and verify it fails.**
- [ ] **Step 3: Implement `session.ts` and the `POST`/`GET` route handler** that sets and reads the cookie. The route validates the body with Zod against `DEMO_ROLES` and returns `400` on anything else.
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line.
- [ ] **Step 5: Prove it can fail.** Make the unknown-cookie path throw → the third test goes red. Revert.
- [ ] **Step 6: Commit**

```bash
git add src/lib/caring-contacts-server/session.ts src/app/api/caring-contacts/session/route.ts tests/caring-contacts-session.test.ts
git commit -m "feat(caring-contacts): demo role switcher with no credentials"
```

---

### Task 14: Route handlers that audit every view

This is where Phase 1 open item 1 actually closes. A read is only observable at a boundary; the boundary is here.

**Files:**

- Create: `src/lib/caring-contacts-server/handler.ts`
- Create: `src/app/api/caring-contacts/plans/route.ts`, `plans/[planId]/route.ts`, `referrals/route.ts`, `service-state/route.ts`, `access-trail/route.ts`, `assignments/[planId]/route.ts`, `dispatches/route.ts`, `notification-preferences/route.ts`, `training/route.ts`, `pathway-versions/route.ts`
- Test: `tests/caring-contacts-api-handler.test.ts` (new)

**Interfaces:**

```ts
export type ReadHandlerConfig<T> = {
  access: { kind: AccessKind; objectType: AccessedObjectType; objectId: (request: NextRequest) => string };
  read: (store: CaringContactRepository, actor: Actor, request: NextRequest) => Promise<T>;
};
export function readHandler<T>(config: ReadHandlerConfig<T>): (request: NextRequest) => Promise<Response>;

export type WriteHandlerConfig<TBody, TResult> = {
  schema: ZodType<TBody>;
  action: CaringContactAction;
  write: (store: CaringContactRepository, actor: Actor, body: TBody) => Promise<TransitionResult<TResult>>;
};
export function writeHandler<TBody, TResult>(
  config: WriteHandlerConfig<TBody, TResult>,
): (request: NextRequest) => Promise<Response>;
```

**Rules:**

1. **`readHandler` records an access audit event on every call, before returning — including when the read is denied.** A denied read records `outcome: "denied"`. This is the whole point of the task; a read path with no `recordAccess` call is a defect.
2. `writeHandler` parses with Zod, resolves the actor, checks `canPerformCaringContactAction` and returns `403` with the **named reason** in the body when denied — the elevation brief requires denials to say why.
3. Refusals map to status codes: `not-found` → 404; `permission-denied` / any capability denial → 403; `stale-version` → 409; `duplicate-active-plan` / `plan-already-exists` / `idempotency-key-reused-for-a-different-write` → 409; `service-stopped` → 423; everything else → 422. The body is always `{ refusal: string }` and never contains patient data.
4. Every response is `no-store`. No patient data ever appears in a URL, so reads take identifiers in the path and filters in the body of a `POST` where a filter could carry a name.
5. Next 16: `params` is a `Promise` — `const { planId } = await props.params`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

import { readHandler, writeHandler } from "@/lib/caring-contacts-server/handler";

describe("caring-contacts API boundary", () => {
  it("records an access event for a successful read", async () => {
    const { store, recorded } = await inMemoryStoreWithSpy();
    const handler = readHandler({
      access: { kind: "view", objectType: "plan", objectId: () => "SYN-PLAN-001" },
      read: async (repository, actor) => repository.getPlan(planId("SYN-PLAN-001"), { actor }),
    });
    const response = await handler(new NextRequest("http://localhost/api/caring-contacts/plans/SYN-PLAN-001"));
    expect(response.status).toBe(200);
    expect(recorded()).toContainEqual(
      expect.objectContaining({ kind: "view", objectType: "plan", outcome: "allowed" }),
    );
  });

  it("records an access event even when the read is denied", async () => {
    const { store, recorded } = await inMemoryStoreWithSpy({ actorRole: "auditor" });
    const handler = readHandler({
      access: { kind: "view", objectType: "episode", objectId: () => "SYN-PLAN-001" },
      read: async (repository, actor) => repository.getEpisode(planId("SYN-PLAN-001"), { actor }),
    });
    await handler(new NextRequest("http://localhost/api/caring-contacts/episodes/SYN-PLAN-001"));
    expect(recorded()).toContainEqual(expect.objectContaining({ outcome: "denied" }));
  });

  it("returns the named denial reason so the interface can explain itself", async () => {
    const handler = writeHandler({
      schema: z.object({ planId: z.string() }),
      action: "publishPathwayVersion",
      write: async () => ({ ok: true, value: null }),
    });
    const response = await handler(
      new NextRequest("http://localhost/api/caring-contacts/pathway-versions", {
        method: "POST",
        body: JSON.stringify({ planId: "SYN-PLAN-001" }),
      }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ refusal: "action-not-granted" });
  });

  it("returns 423 and refuses a write while the service is stopped", async () => {
    // stop the service, then attempt a pause through the handler
    expect((await pauseThroughHandler()).status).toBe(423);
  });

  it("never returns patient data in a refusal body", async () => {
    const response = await pauseThroughHandler();
    const body = await response.text();
    expect(body).not.toMatch(/Rowan|Mira|\+61/);
  });
});
```

- [ ] **Step 2: Run and verify it fails.**
- [ ] **Step 3: Implement `handler.ts` and the ten route handlers.** Put `recordAccess` inside `readHandler`, never in an individual route — a route that could forget it is the failure mode.
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line.
- [ ] **Step 5: Prove it can fail — two mutations.** Remove the `recordAccess` call from the denied branch → the second test goes red. Return a bare `403` with no body → the third test goes red. Revert both.
- [ ] **Step 6: Commit**

```bash
git add src/lib/caring-contacts-server/handler.ts src/app/api/caring-contacts/ tests/caring-contacts-api-handler.test.ts
git commit -m "feat(caring-contacts): API boundary that audits every view and names every denial"
```

---

### Checkpoint 3 — end of Group 3

```bash
npm run test
```

```bash
npm run typecheck
```

Paste both decisive lines. Phase 1 open item 1 — "reads are not audited" — is now closed, and open item 2 — "referrals and pathway_versions are declared but never written" — closed at Task 11.

---

## Group 4 — The production shell

---

### Task 15: The route group, the four width states, and the inbound link

**This task knowingly rescopes one existing test.** `tests/caring-contact-route-files.test.ts:46` currently asserts that `src/app/caring-contacts` **does not exist**, with the stated intent that "the prototype may not squat production route namespaces". That assertion was reserving the name _for_ production. Production now arrives. The assertion is **replaced with a strictly stronger pair** — the mockup must not reach into production and production must not reach into the mockup — so the separation it protects is enforced in both directions rather than by absence. Do not simply delete it. Do not weaken any other assertion in that file: the `localStorage`/`sessionStorage`/`indexedDB`/`document.cookie` ban and the `fetch(` ban stay, scoped to the mockup roots they were written for.

**Files:**

- Create: `src/app/caring-contacts/layout.tsx`, `src/app/caring-contacts/page.tsx`, `src/app/caring-contacts/loading.tsx`, `src/app/caring-contacts/error.tsx`
- Create: `src/components/caring-contacts/workspace/width-state.ts`
- Create: `src/components/caring-contacts/workspace/shell.tsx`
- Create: `src/lib/caring-contacts-routes.ts`
- Modify: `src/lib/tools-catalog.ts`, `src/lib/category-identity.ts`, `src/components/tools-page-mockups/tool-fixtures.ts`
- Modify: `scripts/generate-site-map.ts` (`routeDescriptions`, `routeOwnershipRows`)
- Modify: `docs/codebase-index.md`
- Modify: `tests/caring-contact-route-files.test.ts` (the rescope described above)
- Test: `tests/caring-contacts-workspace-shell.dom.test.tsx` (new)
- Test: `tests/caring-contacts-width-state.test.ts` (new)

**Route shapes** — mirror the approved mockup identities with the `/mockups` prefix removed. Do **not** use any shape from `SUPERSEDED_CARING_CONTACT_ROUTE_PATTERNS` in `src/components/caring-contacts/mockups/types.ts:20-25`; those were rejected during design.

```ts
// src/lib/caring-contacts-routes.ts
export const CARING_CONTACTS_BASE = "/caring-contacts" as const;
export const CARING_CONTACTS_ROUTES = {
  today: CARING_CONTACTS_BASE,
  patients: `${CARING_CONTACTS_BASE}/patients`,
  newPlan: `${CARING_CONTACTS_BASE}/plans/new`,
  schedule: `${CARING_CONTACTS_BASE}/schedule`,
  templates: `${CARING_CONTACTS_BASE}/templates`,
  team: `${CARING_CONTACTS_BASE}/team`,
  guidance: `${CARING_CONTACTS_BASE}/guidance`,
  reports: `${CARING_CONTACTS_BASE}/reports`,
  serviceStop: `${CARING_CONTACTS_BASE}/service-stop`,
  accessTrail: `${CARING_CONTACTS_BASE}/access-trail`,
  workload: `${CARING_CONTACTS_BASE}/workload`,
  reconciliation: `${CARING_CONTACTS_BASE}/reconciliation`,
  notifications: `${CARING_CONTACTS_BASE}/notifications`,
  training: `${CARING_CONTACTS_BASE}/training`,
  coverage: `${CARING_CONTACTS_BASE}/coverage`,
} as const;
export function patientRoute(patientId: string): string;
export function planRoute(planId: string): string;
export function contactRoute(contactId: string): string;
export function pathwayRoute(pathwayId: string): string;
export function episodeTimelineRoute(planId: string): string;
```

Only `today` ships a page in this plan. The rest are declared here so Plan 2B has one source for hrefs and so the nav can render its destinations now with the not-yet-built ones marked unavailable **with a stated reason**, per the button-wiring convention: `aria-disabled="true"` + `onClick={ignoreUnavailableActivation}` + `title="… — coming soon"` + an `sr-only` note wired by `aria-describedby`. Never native `disabled`, and never both attributes together.

**Width state** — the frozen four-state mapping from coordination design spec §7:

```ts
// src/components/caring-contacts/workspace/width-state.ts
export type WorkspaceWidthState = "compact" | "rail" | "split" | "wide";
export const WORKSPACE_WIDTH_BREAKPOINTS = Object.freeze({ rail: 768, split: 1024, wide: 1440 } as const);
export function widthStateFor(viewportWidth: number): WorkspaceWidthState;
```

`widthStateFor` returns `compact` below 768, `rail` from 768 to 1023, `split` from 1024 to 1439, and `wide` at 1440 and above. **This is the single source; no component may re-derive a breakpoint.** The shell expresses the states in Tailwind media classes (`md:` / `lg:` / `xl:`) so layout needs no JavaScript; `widthStateFor` exists for the overlay modality decision and for tests. Do not introduce a named `--breakpoint-*` token for these — design-system GATES §3b prohibits it.

- [ ] **Step 1: Write the failing tests**

`tests/caring-contacts-width-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { WORKSPACE_WIDTH_BREAKPOINTS, widthStateFor } from "@/components/caring-contacts/workspace/width-state";

describe("frozen width-to-state mapping", () => {
  it("maps each required review width to its frozen state", () => {
    expect(widthStateFor(320)).toBe("compact");
    expect(widthStateFor(390)).toBe("compact");
    expect(widthStateFor(430)).toBe("compact");
    expect(widthStateFor(768)).toBe("rail");
    expect(widthStateFor(1024)).toBe("split");
    expect(widthStateFor(1440)).toBe("wide");
    expect(widthStateFor(1920)).toBe("wide");
  });

  it("treats 390 and 430 as compact samples, not additional states", () => {
    expect(new Set([widthStateFor(320), widthStateFor(390), widthStateFor(430)]).size).toBe(1);
  });

  it("changes state exactly at the frozen boundaries", () => {
    expect(widthStateFor(WORKSPACE_WIDTH_BREAKPOINTS.rail - 1)).toBe("compact");
    expect(widthStateFor(WORKSPACE_WIDTH_BREAKPOINTS.split - 1)).toBe("rail");
    expect(widthStateFor(WORKSPACE_WIDTH_BREAKPOINTS.wide - 1)).toBe("split");
  });
});
```

`tests/caring-contacts-workspace-shell.dom.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CaringContactsShell } from "@/components/caring-contacts/workspace/shell";

describe("caring-contacts workspace shell", () => {
  it("renders exactly one h1 and marks the workspace synthetic", () => {
    render(<CaringContactsShell title="Today">content</CaringContactsShell>);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByTestId("caring-contacts-synthetic-marker")).toBeInTheDocument();
  });

  it("keeps the frozen desktop and phone destination sets", () => {
    render(<CaringContactsShell title="Today">content</CaringContactsShell>);
    const desktop = within(screen.getByRole("navigation", { name: "Workspace" }));
    expect(desktop.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Today",
      "Patients",
      "Schedule",
      "Templates",
    ]);
    const phone = within(screen.getByRole("navigation", { name: "Phone workspace" }));
    expect(phone.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Today",
      "Patients",
      "Schedule",
      "More",
    ]);
  });

  it("navigates internally with Link, never a raw anchor to an internal route", () => {
    const { container } = render(<CaringContactsShell title="Today">content</CaringContactsShell>);
    for (const anchor of container.querySelectorAll("a[href^='/']")) {
      expect(anchor.getAttribute("data-internal-link")).toBe("true");
    }
  });

  it("states a reason on every destination that is not built yet", () => {
    render(<CaringContactsShell title="Today">content</CaringContactsShell>);
    for (const control of screen.queryAllByRole("button", { current: false })) {
      if (control.getAttribute("aria-disabled") !== "true") continue;
      expect(control).toHaveAttribute("title", expect.stringContaining("coming soon"));
      expect(control).not.toHaveAttribute("disabled");
      const describedBy = control.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy!)?.textContent ?? "").not.toBe("");
    }
  });
});
```

- [ ] **Step 2: Run both and verify they fail.**

- [ ] **Step 3: Build the route group and the shell.**

`src/app/caring-contacts/layout.tsx` — Next 16 App Router:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";

// Listed in the live tools catalogue by the owner's decision of 19 August 2026, but never
// indexed: this workspace holds invented patients only and must not appear in a search result
// where its synthetic nature is not visible.
export const metadata: Metadata = {
  title: "Caring Contacts - Clinical KB",
  robots: { index: false, follow: false },
};

export default function CaringContactsLayout({ children }: { children: ReactNode }) {
  return children;
}
```

The synthetic marker is not decoration — it is the safeguard that makes decision C survivable. Render it in the shell header on **every** screen, with the same `FICTIONAL_DATA_MARKER` wording the mockup uses.

- [ ] **Step 4: Run both and verify they pass.** Paste both `N passed` lines.

- [ ] **Step 5: Make the route reachable and documented**

Add to `src/lib/tools-catalog.ts`: a `"caring-contacts"` member of `ToolCatalogId` and a record with `href: "/caring-contacts"`, `area: "coordination"`, and a description that names it a **synthetic demonstration** in plain words. Add the matching glyph to `src/lib/category-identity.ts` — the `Record<ToolCatalogId, …>` there is exhaustive and will not compile without it. Add a matching entry to `fixtureExtras` in `src/components/tools-page-mockups/tool-fixtures.ts`, because `route-reachability.test.ts` reads its `tools` array as a `builderTargets` source and that array is built by `fixtureExtras.map`, not from the catalogue.

Then:

```bash
npm run docs:update
```

and add a `routeDescriptions` entry plus a `routeOwnershipRows` row in `scripts/generate-site-map.ts`, and a `docs/codebase-index.md` entry. `npm run sitemap:check` runs inside `verify:cheap` and will fail on a stale file.

- [ ] **Step 6: Rescope the route-files test — replace, do not weaken**

In `tests/caring-contact-route-files.test.ts`, replace the `src/app/caring-contacts` non-existence assertion with:

```ts
it("keeps the prototype and the production workspace from reaching into each other", () => {
  const mockupSources = collectSources(["src/app/mockups/caring-contacts", "src/components/caring-contacts/mockups"]);
  for (const [file, source] of mockupSources) {
    expect(source, `${file} imports production workspace code`).not.toMatch(
      /from\s+["']@\/components\/caring-contacts\/workspace/,
    );
    expect(source, `${file} imports a production caring-contacts route`).not.toMatch(
      /from\s+["']@\/lib\/caring-contacts-server/,
    );
  }

  const productionSources = collectSources(["src/app/caring-contacts", "src/components/caring-contacts/workspace"]);
  expect(productionSources.size).toBeGreaterThan(0);
  for (const [file, source] of productionSources) {
    expect(source, `${file} imports mockup code`).not.toMatch(/caring-contacts\/mockups/);
  }
});

it("still keeps every prototype route under /mockups", () => {
  // unchanged assertion, retained verbatim
});
```

Keep the storage ban and the `fetch(` ban exactly as they are, scoped to the two mockup roots. The production tree legitimately fetches; the prototype still may not.

- [ ] **Step 7: Run the full reachability and route suite**

```bash
npm run test:focused -- --files tests/route-reachability.test.ts,tests/site-map.test.ts,tests/caring-contact-route-files.test.ts,tests/caring-contacts-workspace-shell.dom.test.tsx,tests/caring-contacts-width-state.test.ts
```

Paste the `N passed` line.

- [ ] **Step 8: Measure the bundle before it becomes a surprise**

```bash
rm -rf .next && npm run build && npm run check:bundle-budget
```

`npm run build` reuses a cached `.next` and will report byte-identical numbers if it is not removed first — the measurement would be a lie. Sanity-check `.next/BUILD_ID`'s mtime against the current commit before trusting the number.

The `production` budget is 1,518,033 gzip bytes at 10% tolerance, so there is roughly 151 KB of headroom for the whole workspace. If this task alone consumes a large share of it, **do not refresh the baseline** — that hides real regressions and is explicitly prohibited. Instead make the workspace's client chunks route-local (dynamic import at the route boundary so the Clinical KB dashboard never downloads them) and add `/caring-contacts` as its own key in `bundle-budget.json` `routes` so later screens are gated locally rather than hiding inside the aggregate. Report the measured number in the commit body either way.

- [ ] **Step 9: Prove the tests can fail.** Change `widthStateFor(768)` to return `compact` → the boundary test goes red. Remove the tools-catalogue entry → `route-reachability.test.ts` goes red naming `/caring-contacts` as an orphan. Revert both.

- [ ] **Step 10: Commit**

```bash
git add src/app/caring-contacts src/components/caring-contacts/workspace src/lib/caring-contacts-routes.ts src/lib/tools-catalog.ts src/lib/category-identity.ts src/components/tools-page-mockups/tool-fixtures.ts scripts/generate-site-map.ts docs/site-map.md docs/codebase-index.md tests/caring-contact-route-files.test.ts tests/caring-contacts-workspace-shell.dom.test.tsx tests/caring-contacts-width-state.test.ts
git commit -m "feat(caring-contacts): production workspace route group, four-state shell and catalogue entry"
```

---

### Task 16: The service-state banner and the explained-automation contract

Spec §4.4 is a contract, not a preference: wherever the system has acted on its own — paused, skipped, suppressed, blocked, escalated — the surface stating that state must also state, **in plain words and in place**, why and what would change it. No bare status chip without a reachable reason. Spec §4.2 additionally requires the service-state banner to be visible **everywhere** while a stop is active.

**Files:**

- Create: `src/components/caring-contacts/workspace/service-state-banner.tsx`
- Create: `src/components/caring-contacts/workspace/automated-state.tsx`
- Modify: `src/components/caring-contacts/workspace/shell.tsx`
- Test: `tests/caring-contacts-explained-automation.dom.test.tsx` (new)

**Interfaces:**

```tsx
export function ServiceStateBanner(props: { state: ServiceState }): JSX.Element | null;

export type AutomatedStateProps = {
  state: string; // a closed transport or plan term, e.g. "Suppressed"
  because: string; // plain-words reason
  changedBy: string; // plain-words statement of what would change it
};
export function AutomatedState(props: AutomatedStateProps): JSX.Element;
```

**Rules:** `AutomatedState` renders the state, the reason and the remedy in the same accessible region, wired so a screen reader reaching the state also reaches both — the reason is never in a tooltip alone. `ServiceStateBanner` returns `null` while running, and while stopped renders `role="status"`, the categorised reason in plain words, the count of restart approvals recorded out of three, and a link to the service-stop screen. It **never** contains patient information — it is rendered on every screen including ones showing no patient.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AutomatedState } from "@/components/caring-contacts/workspace/automated-state";
import { ServiceStateBanner } from "@/components/caring-contacts/workspace/service-state-banner";

describe("explained automation", () => {
  it("never shows a bare automated state without a reason and a remedy", () => {
    render(
      <AutomatedState
        state="Suppressed"
        because="Week 1 falls on the first contact day."
        changedBy="Move the first contact date on the plan."
      />,
    );
    const region = screen.getByRole("group", { name: /Suppressed/ });
    expect(region).toHaveTextContent("Week 1 falls on the first contact day.");
    expect(region).toHaveTextContent("Move the first contact date on the plan.");
  });

  it("shows nothing while the service is running", () => {
    const { container } = render(<ServiceStateBanner state={{ stopped: false, teamId: teamId("TEAM-A") }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("states the reason and the approval count while stopped, with no patient information", () => {
    render(<ServiceStateBanner state={stoppedServiceState()} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/0 of 3/);
    expect(banner).toHaveTextContent(/wrong recipient/i);
    expect(banner.textContent ?? "").not.toMatch(/Rowan|Mira|\+61/);
  });

  it("keeps the banner on every screen the shell renders", () => {
    render(
      <CaringContactsShell title="Today" serviceState={stoppedServiceState()}>
        content
      </CaringContactsShell>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and verify it fails.**
- [ ] **Step 3: Implement both components and mount the banner in the shell.** Use design tokens only; status is communicated through text, icon and structure, never colour alone.
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line.
- [ ] **Step 5: Prove it can fail.** Render `AutomatedState` without the remedy → the first test goes red. Revert.
- [ ] **Step 6: Commit**

```bash
git add src/components/caring-contacts/workspace/service-state-banner.tsx src/components/caring-contacts/workspace/automated-state.tsx src/components/caring-contacts/workspace/shell.tsx tests/caring-contacts-explained-automation.dom.test.tsx
git commit -m "feat(caring-contacts): service-state banner and the explained-automation contract"
```

---

## Group 5 — The 24 overlays

**Build these two tasks at high reasoning effort.** The 24-row modality matrix is frozen, deep-linked, geometry-asserted at two widths, and carries the fresh-authentication checkpoint for the two most consequential actions in the product.

---

### Task 17: The frozen 24-row definition table

The production table is a **fresh file**, not an import — production may never import from `src/components/caring-contacts/mockups/`. Its 24 ids, titles, phone modalities, desktop modalities and dismissal values must equal the frozen matrix in `docs/caring-contacts/interaction-matrix.md` exactly.

**Files:**

- Create: `src/components/caring-contacts/workspace/overlays/definitions.ts`
- Test: `tests/caring-contacts-overlay-definitions.test.ts` (new)

**Interfaces:**

```ts
export type OverlayPhoneModality = "bottom-sheet" | "full-screen-stage" | "session-gate" | "status-banner";
export type OverlayDesktopModality = "dialog" | "inspection-drawer" | "session-gate" | "status-banner";
export type OverlayDismissal = "escape-backdrop-close" | "action-only" | "recovery-only";
export type OverlayAvailability = "Available" | "Read only" | "Unavailable until resolved";

export type WorkspaceOverlayDefinition = {
  id: string;
  label: string;
  title: string;
  summary: string;
  decision: string;
  availability: OverlayAvailability;
  mutatesState: boolean;
  requiresFreshAuthentication: boolean;
  phoneModality: OverlayPhoneModality;
  desktopModality: OverlayDesktopModality;
  dismissal: OverlayDismissal;
  tone?: "primary" | "danger";
};

export const WORKSPACE_OVERLAY_DEFINITIONS: readonly WorkspaceOverlayDefinition[]; // exactly 24
export const MUTATING_OVERLAY_IDS: readonly string[]; // exactly 16
export function overlayDefinition(id: string): WorkspaceOverlayDefinition | null;
```

The 24 ids, in matrix order: `verify-identity`, `change-patient`, `pathway-preview`, `message-preview`, `communication-preference`, `adjust-date-time`, `outside-window-warning`, `save-draft`, `discard-changes`, `final-activation`, `activation-success`, `pause`, `withdrawal`, `reassignment`, `delivery-detail`, `resolve-failed-delivery`, `contact-changed-block`, `template-changed-retired`, `session-expiry`, `offline-banner`, `recoverable-error`, `permission-unavailable`, `team-switcher`, `draft-version-conflict`.

`requiresFreshAuthentication` is `true` for exactly `withdrawal` and `reassignment` — the matrix's "two-stage" column.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  MUTATING_OVERLAY_IDS,
  WORKSPACE_OVERLAY_DEFINITIONS,
} from "@/components/caring-contacts/workspace/overlays/definitions";

/** Parses the frozen matrix out of the interaction-matrix document itself. */
function frozenMatrixRows() {
  const document = readFileSync("docs/caring-contacts/interaction-matrix.md", "utf8");
  return document
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .map((cells) => ({
      id: cells[1].replace(/`/g, ""),
      phone: cells[3],
      desktop: cells[4],
      mutation: cells[5],
      dismissal: cells[6],
    }));
}

describe("the frozen 24-overlay contract", () => {
  it("holds exactly 24 unique overlays, 16 of which mutate", () => {
    expect(WORKSPACE_OVERLAY_DEFINITIONS).toHaveLength(24);
    expect(new Set(WORKSPACE_OVERLAY_DEFINITIONS.map((definition) => definition.id)).size).toBe(24);
    expect(MUTATING_OVERLAY_IDS).toHaveLength(16);
  });

  it("matches the interaction matrix document row for row", () => {
    const rows = frozenMatrixRows();
    expect(rows).toHaveLength(24);
    rows.forEach((row, index) => {
      const definition = WORKSPACE_OVERLAY_DEFINITIONS[index];
      expect(definition.id).toBe(row.id);
      expect(definition.mutatesState).toBe(row.mutation.startsWith("Yes"));
      expect(definition.requiresFreshAuthentication).toBe(row.mutation.includes("two-stage"));
    });
  });

  it("requires fresh authentication for exactly withdrawal and reassignment", () => {
    expect(
      WORKSPACE_OVERLAY_DEFINITIONS.filter((definition) => definition.requiresFreshAuthentication).map((d) => d.id),
    ).toEqual(["withdrawal", "reassignment"]);
  });

  it("carries no empty field and no prohibited clinical language", () => {
    for (const definition of WORKSPACE_OVERLAY_DEFINITIONS) {
      for (const [field, value] of Object.entries(definition)) {
        if (typeof value === "string") expect(value.trim(), `${definition.id}.${field}`).not.toBe("");
      }
      expect(`${definition.summary} ${definition.decision}`).not.toMatch(
        /monitor(ed|ing)? replies|patient is safe|risk score|inbox|conversation/i,
      );
    }
  });
});
```

Reading the matrix document is deliberate. A hand-copied expectation array can drift from the frozen record silently; parsing the record cannot.

- [ ] **Step 2: Run and verify it fails.**
- [ ] **Step 3: Write `definitions.ts`** with all 24 rows, transcribed from `docs/caring-contacts/interaction-matrix.md`.
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line.
- [ ] **Step 5: Prove it can fail.** Swap `pause`'s phone modality to `full-screen-stage` → the matrix test goes red. Set `requiresFreshAuthentication` on `pause` → the fresh-auth test goes red. Revert both.
- [ ] **Step 6: Commit**

```bash
git add src/components/caring-contacts/workspace/overlays/definitions.ts tests/caring-contacts-overlay-definitions.test.ts
git commit -m "feat(caring-contacts): the frozen 24-overlay definition table, checked against the matrix document"
```

---

### Task 18: One renderer, twenty-four overlays

**Files:**

- Create: `src/components/caring-contacts/workspace/overlays/overlay-host.tsx`
- Modify: `src/components/caring-contacts/workspace/shell.tsx` (mount the host)
- Test: `tests/caring-contacts-overlay-host.dom.test.tsx` (new)

**Interfaces:**

```tsx
export type OverlayHostProps = {
  openOverlayId: string | null;
  onClose: () => void;
  onCommit: (definition: WorkspaceOverlayDefinition) => void;
  blockReason: string | null; // a named permission/connectivity refusal, or null
};
export function OverlayHost(props: OverlayHostProps): JSX.Element | null;
```

**Rules — every one of these is a contract, not a preference:**

1. **One renderer.** Modality comes from the table, never from a per-overlay component. A generic one-modality `Sheet` path is explicitly not an acceptable substitute, and neither is 24 bespoke components.
2. Modality is chosen as `widthStateFor(viewportWidth) === "compact" ? phoneModality : desktopModality`. Use the shared `widthStateFor` from Task 15; do not write a second `matchMedia` breakpoint.
3. The rendered body stamps `data-overlay-id`, `data-overlay-modality` and `data-overlay-dismissal` on its content element. The Playwright matrix in Task 19 asserts against these.
4. `status-banner` portals to the document body as `role="status"`, is **not** a dialog, and never traps focus.
5. `session-gate` ignores Escape and the backdrop; it offers a recovery action only.
6. Everything else uses the shared `Sheet` from `src/components/ui/sheet.tsx` — `mobilePlacement="fullscreen"` for `full-screen-stage`, right-edge geometry for `inspection-drawer`, `mobilePlacement="bottom"` otherwise — with `returnFocusRef` supplied so focus returns to the originating control on close.
7. Overlay state is represented in the URL as `?overlay=<id>` so it supports browser history; closing removes the parameter.
8. `requiresFreshAuthentication` overlays commit only on the **second** activation: the first shows a visible fresh-authentication checkpoint and commits nothing.
9. When `blockReason` is non-null, a mutating overlay's primary action becomes `aria-disabled="true"` with the named reason visible and does nothing when clicked; **read-only overlays stay fully usable**, including their action.

- [ ] **Step 1: Write the failing test**

```tsx
describe("the overlay host", () => {
  it("renders every one of the 24 overlays with its frozen modality at both widths", () => {
    for (const definition of WORKSPACE_OVERLAY_DEFINITIONS) {
      for (const [width, expected] of [
        [390, definition.phoneModality],
        [1440, definition.desktopModality],
      ] as const) {
        setViewportWidth(width);
        const { unmount } = render(
          <OverlayHost openOverlayId={definition.id} onClose={noop} onCommit={noop} blockReason={null} />,
        );
        const body = screen.getByTestId("workspace-overlay-content");
        expect(body).toHaveAttribute("data-overlay-id", definition.id);
        expect(body).toHaveAttribute("data-overlay-modality", expected);
        expect(body).toHaveAttribute("data-overlay-dismissal", definition.dismissal);
        unmount();
      }
    }
  });

  it("returns focus to the control that opened the overlay", async () => {
    // open from a named trigger, press Escape, assert the trigger is focused
  });

  it("keeps the session gate open through Escape", async () => {
    render(<OverlayHost openOverlayId="session-expiry" onClose={onClose} onCommit={noop} blockReason={null} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("never traps focus in the offline status banner", () => {
    render(<OverlayHost openOverlayId="offline-banner" onClose={noop} onCommit={noop} blockReason={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("commits a withdrawal only on the second activation", async () => {
    const onCommit = vi.fn();
    render(<OverlayHost openOverlayId="withdrawal" onClose={noop} onCommit={onCommit} blockReason={null} />);
    await userEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(/fresh authentication checkpoint/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("blocks a mutating overlay with a named reason but leaves a read-only overlay usable", async () => {
    render(<OverlayHost openOverlayId="pause" onClose={noop} onCommit={noop} blockReason="permission-unavailable" />);
    const action = screen.getByRole("button", { name: /pause/i });
    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(action).not.toHaveAttribute("disabled");
    expect(screen.getByText(/permission/i)).toBeInTheDocument();

    cleanup();
    render(
      <OverlayHost
        openOverlayId="message-preview"
        onClose={noop}
        onCommit={noop}
        blockReason="permission-unavailable"
      />,
    );
    expect(screen.getByRole("button", { name: /close/i })).not.toHaveAttribute("aria-disabled");
  });
});
```

- [ ] **Step 2: Run and verify it fails.**
- [ ] **Step 3: Implement `overlay-host.tsx`.**
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line — the first test alone is 48 assertions.
- [ ] **Step 5: Prove it can fail — three mutations.** Always use `desktopModality` → the first test goes red at 390. Commit on the first withdrawal activation → the fresh-auth test goes red. Apply `blockReason` to read-only overlays too → the last test goes red. Revert each.
- [ ] **Step 6: Commit**

```bash
git add src/components/caring-contacts/workspace/overlays/overlay-host.tsx src/components/caring-contacts/workspace/shell.tsx tests/caring-contacts-overlay-host.dom.test.tsx
git commit -m "feat(caring-contacts): one overlay renderer honouring the frozen modality and dismissal matrix"
```

---

### Task 19: Browser proof at the six required widths

**Files:**

- Create: `tests/ui-caring-contacts-workspace.spec.ts`
- Modify: `playwright.config.ts` — add `caring-contacts-workspace` to **both** `testMatch` (line 34) **and** `productionSpecPattern` (line 26)
- Test: `tests/playwright-project-isolation.test.ts` (extend)

**A spec that is not in both patterns silently never runs.** That is the failure mode this task exists to prevent, so the isolation test is extended first.

- [ ] **Step 1: Write the failing guard**

Extend `tests/playwright-project-isolation.test.ts`:

```ts
it("collects the production caring-contacts workspace spec in the chromium project only", () => {
  const productionPattern = configPattern("productionSpecPattern");
  const mockupPattern = configPattern("mockupSpecPattern");
  expect(productionPattern.test("tests/ui-caring-contacts-workspace.spec.ts")).toBe(true);
  expect(mockupPattern.test("tests/ui-caring-contacts-workspace.spec.ts")).toBe(false);
  expect(configPattern("testMatch").test("tests/ui-caring-contacts-workspace.spec.ts")).toBe(true);
});
```

- [ ] **Step 2: Run and verify it fails.**

Run: `npm run test:focused -- --files tests/playwright-project-isolation.test.ts`
Expected: FAIL — the basename is in neither pattern.

- [ ] **Step 3: Register the spec in both patterns, then write it.**

The spec must cover, at 320, 390, 430, 768, 1024 and 1440:

1. `/caring-contacts` renders its `h1` with **no horizontal document overflow** (`scrollWidth - innerWidth <= 2`).
2. Below 768 the phone dock is visible and the rail is hidden; at 768 and above the inverse.
3. The primary control's bottom edge sits above the phone dock's top edge (dock clearance).
4. The `widthStateFor` state is observable in the DOM as `data-workspace-width-state` and equals `compact` / `rail` / `split` / `wide` at the six widths.
5. Every one of the 24 overlays, deep-linked by `?overlay=<id>` at 390 and 1440: the URL contains the id, `data-overlay-modality` equals the width-appropriate modality, geometry matches (`full-screen-stage` and `session-gate` at phone width fill the viewport; `inspection-drawer` on desktop is right-anchored and at most 56% of the width; `dialog` is at most 640 px wide; nothing is ever off-screen), Escape closes and returns focus to the trigger, and `session-expiry` survives Escape.
6. Dark mode, `forcedColors: "active"` and 400% zoom on a 1280 px viewport: a visible focus outline (`outlineStyle !== "none"`) and no horizontal overflow.

Tag nothing `@quarantine`. Retries stay at zero.

- [ ] **Step 4: Run the spec**

```bash
npm run ensure
```

Use the URL it prints. Never assume `localhost:3000`.

```bash
node scripts/run-playwright.mjs tests/ui-caring-contacts-workspace.spec.ts --project=chromium
```

Under heavy lock contention this queues Playwright admission for up to 15 minutes and **exits 1 on timeout** — it does not soft-skip green. Grep the output for the `N passed` line and paste it. An exit code alone is not proof.

- [ ] **Step 5: Prove the spec can fail.** Force `data-workspace-width-state` to `compact` at every width → the width test goes red at 768. Revert.

- [ ] **Step 6: Commit**

```bash
git add tests/ui-caring-contacts-workspace.spec.ts playwright.config.ts tests/playwright-project-isolation.test.ts
git commit -m "test(caring-contacts): browser proof of the workspace shell and all 24 overlays at six widths"
```

---

## Closing the plan

- [ ] **Step 1: Format and run the gate**

```bash
npm run format
```

Commit the result — formatting is in neither `test`, `typecheck` nor `lint`, and the push guard checks the pushed commit rather than the working tree.

```bash
npm run verify:pr-local
```

Paste the decisive line.

- [ ] **Step 2: Capture the atlas and list the differences**

Re-capture the 44-image atlas against the **production** routes and compare it image by image against the committed mockup baseline in `docs/caring-contacts/atlas/`. Comparison is manual — nothing in the repository diffs these automatically, and the only automated assertions are the count and the recorded dimensions.

Write the justified-difference list to `docs/caring-contacts/phase-2a-visual-differences.md`. These five are already known and expected; anything else on the list needs its own justification, and anything unexplained is a regression to fix rather than to document:

1. The first-contact-date control on review and activation (spec §2.3, which records that the mockup is out of date on that screen).
2. Reply-handling copy now describing the automated response (spec §2.1) instead of claiming replies are not received.
3. The month-12 contact shown as a distinct `closing` message type (spec §2.2).
4. Nine sendable contacts, not ten, when the coordinator sets the first contact to discharge plus seven days (Phase 1 decision 1).
5. Genuine `rail` and `split` compositions at 768 and 1024, which the mockup never had.

- [ ] **Step 3: Record the outstanding work**

```bash
npm run issues:add -- --title "Caring Contacts Phase 2B — the screens" --priority P2
```

Do not edit `docs/outstanding-issues.md` by hand; the inbox file is the only supported route.

- [ ] **Step 4: Stop.** Do not push and do not open a pull request without asking the owner.

---

## Self-review

**Spec coverage.** §2.1 automated reply — Task 1. §2.2 closing message — Tasks 4 and 11 (`snapshot.messageTextByType.closing`). §2.3 first-contact date — already in Phase 1's `schedule.ts`; its control is Plan 2B. §2.4 third-party pause — Phase 1. §2.5 cultural identity reporting-only — Phase 1's `cultural_identity_reports`; the equity report is Plan 2B. §2.6 retention — Task 10's `markRetentionCleared` and Task 11. §2.7 message rules as data — Phase 1, preserved by Task 1. §2.8 sealed seam — held throughout; Group 3 lives outside the seam on purpose. §2.9 clinical-record summary — Plan 2B. §2.10 rename — done in Phase 1. §3.2 datastore separation — Tasks 11 and 12. §4.2 all seven required screens — their rules and data land in Tasks 3–11; their surfaces are Plan 2B. §4.3 four recommended screens — Plan 2B, with assignment and coverage data ready at Task 6. §4.4 explained automation — Task 16. §5 phone — Tasks 15 and 19. §6 non-regression — the closing atlas step. §7 elevation brief items 3, 4, 6 and 7 — Tasks 16, 14, 15 and 18; items 1, 2 and 5 are screen-level and belong to Plan 2B. §8 behaviour — Phase 1 plus Tasks 3–7. §9 data model additions — Task 11.

**Known gaps, deliberate.** Every screen other than Today is Plan 2B. Loading, empty and error states beyond the route-group defaults are Plan 2C. The demo clock, synthetic caseload and training scenario scripts are Phase 3.

**Type consistency.** `ServiceState`, `PathwayVersion`, `PlanAssignment`, `AccessRecord`, `NotificationPreferences` and `TrainingRecord` are defined in Tasks 3, 4, 6, 8 and 9 and consumed under those exact names in Tasks 10, 11 and 14. `widthStateFor` is defined once in Task 15 and consumed in Tasks 18 and 19. `WorkspaceOverlayDefinition` is defined in Task 17 and consumed in Task 18.
