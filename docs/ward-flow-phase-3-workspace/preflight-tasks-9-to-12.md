# Pre-flight scan of Tasks 9 to 12 — session 3, measured against the branch at `a75c508f6`

Every number below was produced by running the real fixture and the real derivations, not by
reading the code and reasoning. Ruling R37 in the ledger explains why that distinction is now
mandatory: three separate fixture claims in this phase turned out to be false, all of them made
incidentally while ruling on something else.

---

## Task 9 — the transport officer's phone. Preconditions HOLD.

- **8 movements carry a transport job**, and **all 8 are not yet arrived**: WF-005, WF-006, WF-014,
  WF-015, WF-306, WF-313, WF-320, WF-327. So the officer screen has real jobs at seed and the
  brief's `[data-testid^="ward-officer-job-"]` locator will match.
- **All 8 carry `escortRequired`**, so the brief's `toContainText(/escort/i)` assertion can be
  satisfied honestly rather than by boilerplate.
- Sample shape: `{"id":"TR-1005","provider":"St John WA","escortRequired":true,"formRequired":"Form 1A","acceptedAt":612}`.

**One thing the brief's test does that R24 already ruled against**: it takes `.first()` of the job
list. Pin the job by `data-testid="ward-officer-job-<ID>"` instead, chosen deliberately from the
eight above and verified.

**A trap in the brief's own assertion.** It asserts the job has **exactly four** buttons
(`toHaveCount(4)`). That is only true if the job card contains no other control — no expander, no
link to the patient, no dismiss. Build to it, but if the design genuinely needs a fifth control,
raise it rather than deleting a needed control to satisfy a count. The spec's wording is "Four
actions: accepted, en route, collected, arrived. Nothing else," so the count is defensible — but
scope it to the actions group rather than the whole card if that is cleaner, and say which you did.

---

## Task 10 — the live tracker. Preconditions HOLD, with one caveat.

Leg stamps actually present across the 8 transport jobs: **`acceptedAt` on 8, `enRouteAt` on 6.**
There is **no `collectedAt`, no `arrivedAt`, and no `requestedAt` anywhere in the seed fixture.**

`TransportJob` (`ward-model.ts`) has no `requestedAt` field at all — its optional stamps are
`acceptedAt`, `enRouteAt`, `collectedAt`, `arrivedAt`, `cancelledAt`.

**CORRECTED — my first pass on this asserted the brief's regex passes on every seed row. It does
not.** I had reasoned from the field names instead of reading `transportStatusLabel`'s actual return
strings, which is precisely the error ruling R37 exists to stop, made while writing the document
that records R37. See the LATE ADDITION at the end of this file for the measured behaviour and
ruling R44. Two of the eight seed rows render a lowercase `accepted`, and the 40 transport-less
movements render a lowercase `requested`; the brief's regex is case-sensitive and matches neither.

Beyond that failure, the weaker point still stands: even a passing version of that assertion cannot
distinguish a tracker rendering every leg correctly from one rendering only the two legs the fixture
happens to contain.

**A movement with no transport shows an explicit absence, never a fabricated leg.** That is a
Global Constraint and 40 of the 48 movements have no transport, so this path is heavily exercised.
Test it.

---

## Task 11 — the emergency department screen. Preconditions HOLD but are SINGLE-RECORD THIN.

- `peel-ed` has **7 movements, all 7 open**. The brief's `rows.count() > 0` holds comfortably.
- **Exactly ONE is community-formed**: **WF-005**, `formedAt` at `NOW_ANCHOR - 480` against
  `openedAt` at `NOW_ANCHOR - 330` — a 150-minute head start on the legal clock. This satisfies
  ruling P2 and the brief's `data-community-formed="true"` assertion, but on a single record.
  **Pin WF-005 by id** rather than relying on `count() > 0`, so a fixture change that removes it
  fails loudly instead of silently reducing the count to zero in some later refactor.
- **Exactly ONE police arrival exists in the whole 48-movement fixture, and it is at `peel-ed`.**
  So the police flag is testable on this screen and nowhere else. Pin it by id too, and note in
  your report that the fixture supports exactly one such case.

**The access target — read this before writing a single line.** Task 6A deleted a fabricated Form 3B
statutory deadline that seven surfaces were rendering as legal timing. The four-hour figure survives
as `ED_ACCESS_TARGET_MINUTES`, and it is a **departmental performance measure counted UP from
`openedAt`**. It is not a legal clock, not a statutory deadline, and must never be labelled as one
or attached to a `LegalForm`.

Two static guards in `tests/ward-flow-single-source.test.ts` enforce the naive shape of that
prohibition, and **ruling R28 recorded that they are file-scoped and will NOT catch the shape your
screen is most likely to have** — deriving from an existing movement through a helper, an
intermediate local, or a spread. The guards are a tripwire, not a fence. **You are the enforcement.**
Your reviewer is instructed to check it by reading your code, not by trusting the guards.

`LegalForm.dueAt` is **optional**. A Form 1A carries a statutory examination window; a Form 3B
carries none. Render absence explicitly. An absent `dueAt` reaching arithmetic is a compile error —
do not defeat that with a `??` or a non-null assertion.

**Both clocks must read as different things**, and the legal clock must never render as _shorter_
than time in the department for a community-formed patient. That is the specific thing to look at in
your screenshot.

---

## Task 12 — the end-to-end journey. THE PLAN'S TEST CANNOT WORK. Two independent defects.

### Defect 1 — it starts on a movement that cannot be referred.

The journey does `queue.locator('[data-testid^="ward-queue-row-"]').first().click()`.

Measured against the real `queueOrder` at `NOW_ANCHOR`, the top five are:

| rank | id     | stage                   | referable | has transport |
| ---- | ------ | ----------------------- | --------- | ------------- |
| 1    | WF-303 | `accepted_awaiting_bed` | **no**    | no            |
| 2    | WF-009 | `destination_review`    | yes       | no            |
| 3    | WF-312 | `handover_ready`        | **no**    | no            |
| 4    | WF-315 | `placement_requested`   | yes       | no            |
| 5    | WF-306 | `moving`                | **no**    | yes           |

`REFER_TO_UNITS` only accepts `placement_requested` or `destination_review`. **Row 1 is WF-303 at
`accepted_awaiting_bed`, so `canRefer` is false, the Refer control carries `aria-disabled="true"`,
and the journey cannot even begin.** This is the third time `.first()` has broken a test in this
phase (see rulings R24 and the two sites Task 6A had to repin). Pin by id.

### Defect 2 — the journey skips the handover, and the officer's job does not exist without it.

Read from the reducer rather than assumed:

- `HANDOVER_READY` requires stage `bed_held`, and it is the **only** thing that creates a
  `transport` job: it writes `{ id, provider, escortRequired }` onto the movement and moves it to
  `handover_ready`.
- `TRANSPORT_ACCEPTED` refuses unless the stage is `handover_ready` **and** `movement.transport`
  exists.

The plan's journey runs: coordinator refers → ward accepts → ward holds bed → **officer's four
actions**. There is no `HANDOVER_READY` anywhere in it. So the movement never gets a transport job,
`ward-officer-job-<ID>` never renders, and all four officer actions would be refused.

**The spec has the missing step and the plan dropped it.** Spec section 14 states the journey as:
"ED raises, coordinator refers to three, one ward accepts and the other two see withdrawal, bed
held, **handover**, the officer's four actions, arrived closes the record and the bed is consumed."

`HANDOVER_READY` is an **ED-role** event, so the journey must switch to the ED screen between the
ward holding the bed and the officer acting. That makes the journey exercise all four roles rather
than three, which is what the test's own name claims.

### What this means for you

Rebuild the journey around a **deliberately chosen, verified** movement and include the handover
step.

**CORRECTED — this section originally recommended `WF-009`, and that recommendation was wrong.**
I had checked only that WF-009 was _referable_, and stopped there. A verification agent checked the
rest and I then reproduced it myself: **WF-009 has ZERO eligible candidates.** It has already been
declined by all five secure units (`rph-`, `gry-`, `bty-`, `fsh-` and `rgh-adult-secure`), so its
whole shortlist comes back `eligible=false` and the Refer control stays unavailable even after
defect 1 is fixed. Recommending it would have handed an implementer a subject that fails for a
second, different reason — the same "checked one property, assumed the rest" error that produced
the false claim in ruling F9.

**Use `WF-315`.** Verified by running the real derivations: stage `placement_requested` (referable),
`originEdId: "arm-ed"` which resolves to a real department, no prior declines, no existing
referrals, and **three eligible candidates** — `rph-adult-secure`, `fsh-adult-secure` and
`rgh-adult-secure`, all `eligible=true`. The full corrected event chain has been driven through the
real `wardFlowReducer` from a fresh seed with **zero rejections end to end**, including arrival, and
the movement was confirmed to drop out of `queueOrder` afterwards — so the plan's original final
assertion is correct once it is pinned to the right id.

The complete event-by-event design, with roles and stages, is in `task-12-journey-design.md`. Read
that alongside this file; it supersedes this section on any point of detail.

**Do not weaken any assertion to make the journey pass.** If a step genuinely cannot work, that is a
finding about the code, not about the test.

**The journey must navigate by clicking, never by `page.goto()`.** A `goto` is a full page load,
which re-mounts the provider and resets all state — the test would then pass or fail for reasons
unrelated to the code. This is in the spec and in the plan, and it is the single most important
property of this test.

---

## LATE ADDITION — Task 10's test regex does not match the labels the code actually produces

Found after the section above was written, by reading `transportStatusLabel`
(`ward-derivations.ts:136`) rather than assuming its output. It returns:

| condition         | returned string                           |
| ----------------- | ----------------------------------------- |
| no transport      | `Not yet requested`                       |
| `cancelledAt` set | `Cancelled`                               |
| `arrivedAt` set   | `Arrived`                                 |
| `collectedAt` set | `Collected`                               |
| `enRouteAt` set   | `En route`                                |
| `acceptedAt` set  | `<provider> accepted, awaiting departure` |
| otherwise         | `<provider> requested`                    |

The brief's assertion is `toContainText(/Requested|Accepted|En route|Collected|Arrived/)` — and that
regex is **case-sensitive**. Two of the three lowercase-producing branches are reachable at seed:

- 6 of the 8 seed jobs have `enRouteAt`, so they render `En route` and **match**.
- **2 of the 8 have `acceptedAt` and no `enRouteAt`**, so they render
  `St John WA accepted, awaiting departure` — which contains `accepted`, not `Accepted`, and
  **does not match the regex**.
- 40 movements have no transport at all and render `Not yet requested` — `requested`, not
  `Requested` — which also **does not match**, if those rows appear in the tracker.

So the brief's test fails on real seed data. **Do not "fix" it by relaxing the assertion to
case-insensitive without thinking** — that hides the more interesting question, which is whether the
tracker should be rendering a sentence like "St John WA accepted, awaiting departure" as its _leg_
column at all, or whether the leg and the provider narrative are two different things that belong in
two different columns.

Ruling R44 (controller): **render the leg as a discrete, capitalised state and keep the provider
narrative separate.** The tracker's stated job is "which patient, which leg, how long since the last
stamp" — a leg is one of five discrete values, and a column that sometimes holds `En route` and
sometimes holds `St John WA accepted, awaiting departure` is not a leg column. Introduce a small
pure helper returning the discrete leg (`Requested | Accepted | En route | Collected | Arrived`, plus
an explicit absence for no-transport), unit-test it across **all** five states plus absence, and let
`transportStatusLabel` keep its existing narrative role wherever it is already used. Do not change
`transportStatusLabel`'s existing output — other surfaces read it. Cost if wrong: one small helper
and its unit test, against a browser assertion that silently proves only two of five legs.

## LATE ADDITION — Task 11 has no `edById`, and must not invent a fallback

`ward-sites.ts` exports `allEmergencyDepartments()` (line 501) and `unitById` (line 506), but there
is **no `edById`**. Task 11 resolves its route parameter itself.

Resolve it by an explicit `.find()` over `allEmergencyDepartments()` and handle the miss the same way
R40 requires for the ward screen: an unresolved `edId` renders an explicit empty state **naming the
id**, never the first department, never a non-null assertion. Add a test with an id that genuinely
does not exist.

If you find yourself wanting `edById`, adding it to `ward-sites.ts` alongside `unitById` and matching
its `Unit | undefined` shape is reasonable and preferable to an inline `.find()!` — but it must
return `EmergencyDepartment | undefined`, never a defaulted value.

---

## Task 9 — the pinned-bar pattern it inherits now exists. Where to read it.

Added after Task 7 landed at `adbe3296f` and its fix round at `3b4bf4152`. The spec says the
officer's screen inherits the coordinator's phone pattern, and Task 7 existed solely so that pattern
would be built before this screen needed it. It now is — so **read it rather than reinventing it**.

The implementation is **CSS-only**. `coordinator.module.css` pins `.shortlistActionRow` — the div
already wrapping exactly the two action buttons — to the literal viewport bottom inside
`@media (max-width: 48rem)`:

- `position: fixed; left: 0; right: 0; bottom: 0;` — flush to the edge, **no non-zero `bottom` gap**.
- Padding from two local tokens on `.screen`: a vertical pad, and a safe-area bottom computed as
  `max(<pad>, var(--safe-area-bottom))` so the bar paints its own home-indicator inset on a notched
  device and adds nothing on one without.
- `z-index: var(--z-overlay)` — the **global** ladder rung, not a new local alias, because a pinned
  bar escapes its component's stacking context and must sort against page-level chrome.
- A third token holds the bar's own computed height (button row + pad + safe-bottom + border), and
  drives `.main:has(.shortlistActionRow) { padding-bottom: <that token>; }` so the content behind it
  reserves exactly the bar's height **only while the bar exists**. Reserving unconditionally would
  leave dead space on every screen that has no bar.

Two things Task 7 proved that you should not re-derive:

1. **`/ward-management` is not in the `(search-app)` route group** and its layout is only
   `WardFlowProvider` — no global search shell, no phone composer dock. So the "one composer per page"
   rule is not engaged and there is no existing dock reserve to fight. Confirm it, then rely on it.
2. **A `position: fixed` bar needs no ancestor to have settled its layout first.** Task 7 deleted a
   nested double-`requestAnimationFrame` `scrollIntoView` whose whole purpose was measuring a scroll
   target from live layout; a pinned bar never measures. It verified no ancestor between `<body>` and
   the bar sets `transform`, `filter`, `perspective` or `contain`, any of which would create a
   containing block and silently anchor the bar to an intermediate box instead of the viewport.
   **Do the same check on your own tree** before trusting `position: fixed`.

### The test trap Task 7 fell into, so you do not

Its first version asserted `window.scrollY` was unchanged after an interaction. That assertion
**could never fail**: the coordinator's `.screen` is `height: 100dvh; overflow: hidden`, so the
document has no scroll range at all and `window.scrollY` is `0` before and after, forever. Mutation
testing caught it; the fix was to assert the **real** scroll container's `scrollTop`, reached through
its own `data-testid` rather than a CSS-module class name (which is hashed at build time and is not a
stable selector).

If your officer screen uses the same full-height/overflow-hidden shell, **the same trap applies to
you**. Assert against whatever element genuinely scrolls, and prove it by mutation.

The brief's own overflow assertion —
`document.documentElement.scrollWidth - document.documentElement.clientWidth` — is a _horizontal_
check and is unaffected by this; keep it.
