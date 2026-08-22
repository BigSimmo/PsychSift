# Task 17 report — the frozen 24-row overlay definition table

## What I implemented

Two new source files plus this report. No existing file was edited.

- `src/components/caring-contacts/workspace/overlays/definitions.ts` — a fresh transcription of the
  24 rows in `docs/caring-contacts/interaction-matrix.md`. It exports the five types from the brief
  verbatim, `WORKSPACE_OVERLAY_DEFINITIONS` (24 entries, frozen, in matrix order),
  `MUTATING_OVERLAY_IDS` (derived from the table rather than hand-listed, so the two can never
  disagree — 16 entries), and `overlayDefinition(id)` which returns `null` for an unknown id.
  Nothing is imported from the design-scratch specimen tree.
- `tests/caring-contacts-overlay-definitions.test.ts` — five tests. The row-for-row test parses the
  matrix document itself and, per **Ruling 57**, asserts **all five parsed columns**: `id`,
  `phoneModality`, `desktopModality`, mutation (both `mutatesState` and
  `requiresFreshAuthentication`), and `dismissal`.

I also strengthened two things beyond the brief's draft, neither of which loosens anything:

- The mutation column is read through an explicit three-entry table
  (`No` / `Yes` / `Yes; two-stage`) rather than `startsWith("Yes")` + `includes("two-stage")`.
  A corrupted mutation cell such as `Yes; two stage` now fails loudly instead of silently reading
  as a one-stage `Yes`.
- The prohibited-language check runs against **every** string field and uses the full prohibited
  list from the task brief, not the four-term subset in the draft test. The draft's original
  four-term assertion is kept as well, so nothing was removed. Word boundaries keep `lead` from
  firing on innocent substrings while still catching the sales sense of the word.

## TDD evidence

### RED

```
$ node scripts/run-vitest.mjs run tests/caring-contacts-overlay-definitions.test.ts --reporter=dot
 FAIL  |node| tests/caring-contacts-overlay-definitions.test.ts
Error: Cannot find package '@/components/caring-contacts/workspace/overlays/definitions'
 Test Files  1 failed (1)
      Tests  no tests
```

Expected: the test was written first and the module it imports did not exist yet. This is the only
failure shape available before `definitions.ts` is written, so it proves the test is wired to the
right module path and nothing more. The mutation evidence below is what proves the assertions bite.

### GREEN

```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

### Full suite

```
 Test Files  700 passed | 2 skipped (702)
      Tests  7760 passed | 29 skipped (7789)
   Duration  204.37s
```

`tsc -p tsconfig.json --noEmit` exits clean; `eslint` on both new files exits clean; both files pass
`prettier --check`.

**One existing test went red on my first full run and I fixed my change, not the test.**
`tests/caring-contact-route-files.test.ts:83` asserts that no production source under
`src/components/caring-contacts/workspace` matches `/caring-contacts\/mockups/` — a plain substring
check that does not exclude comments. My file's header comment named that path in prose while
explaining that it is deliberately _not_ imported, which the guard correctly refused. I reworded the
comment to describe the tree without spelling the path. No assertion was touched.

## Mutation evidence

### Mutation 1 — `pause` phone modality → `full-screen-stage`

_Does it change a value an assertion reads?_ Yes, and only because of Ruling 57. The row-for-row
test now compares `definition.phoneModality` against the normalised `Phone` column. Under the
brief's original three-column test this mutation would have left the suite green.

```
AssertionError: pause.phoneModality: expected 'full-screen-stage' to be 'bottom-sheet'
 ❯ tests/caring-contacts-overlay-definitions.test.ts:119:67
      Tests  1 failed | 4 passed (5)
```

Reverted; re-ran; 5 passed.

### Mutation 2 — `requiresFreshAuthentication: true` on `pause`

_Does it change a value an assertion reads?_ Yes — two of them: the row-for-row comparison against
the matrix's `Yes` (one-stage) cell, and the exactly-two-rows fresh-authentication test. Both went
red, which is the correct blast radius.

```
FAIL > matches the interaction matrix document row for row
 ❯ tests/caring-contacts-overlay-definitions.test.ts:116:95
FAIL > requires fresh authentication for exactly withdrawal and reassignment
AssertionError: expected [ 'pause', 'withdrawal', …(1) ] to deeply equal [ 'withdrawal', 'reassignment' ]
      Tests  2 failed | 3 passed (5)
```

Reverted; re-ran; 5 passed.

### Mutation 3 (mine) — corrupt one cell of the matrix document

I changed the `team-switcher` dismissal cell from `Escape, backdrop, close` to
`Escape, backdrop, dismiss` — a value that is plausible, is one word away from the real one, and
would be accepted by any lowercase-and-hyphenate transform as `escape-backdrop-dismiss`.

```
Error: docs/caring-contacts/interaction-matrix.md row `team-switcher`: unmapped dismissal value
"Escape, backdrop, dismiss". Known dismissal values: "Escape, backdrop, close", "Recovery action only".
 ❯ normalised tests/caring-contacts-overlay-definitions.test.ts:62:11
      Tests  1 failed | 4 passed (5)
```

The failure names the row and the offending value, as required.

**Proof the document is byte-identical afterwards.** I took the blob hash before the edit and again
after reverting:

```
before:  9d430bb5f11a2a89d7761572be0212a3d19f5957
after:   9d430bb5f11a2a89d7761572be0212a3d19f5957
$ git status --short docs/caring-contacts/interaction-matrix.md
(no output)
```

Same content hash, and git reports no modification. The document is unchanged in the commit.

## My normalisation table

The matrix holds human prose; the types hold kebab-case. Four hand-written lookups bridge them:

| Column    | Document wording          | Type value                                                  |
| --------- | ------------------------- | ----------------------------------------------------------- |
| Phone     | `Bottom sheet`            | `bottom-sheet`                                              |
| Phone     | `Full-screen stage`       | `full-screen-stage`                                         |
| Phone     | `Session gate`            | `session-gate`                                              |
| Phone     | `Status banner`           | `status-banner`                                             |
| Desktop   | `Dialog`                  | `dialog`                                                    |
| Desktop   | `Inspection drawer`       | `inspection-drawer`                                         |
| Desktop   | `Session gate`            | `session-gate`                                              |
| Desktop   | `Status banner`           | `status-banner`                                             |
| Dismissal | `Escape, backdrop, close` | `escape-backdrop-close`                                     |
| Dismissal | `Recovery action only`    | `recovery-only`                                             |
| Mutation  | `No`                      | `mutatesState: false`, `requiresFreshAuthentication: false` |
| Mutation  | `Yes`                     | `mutatesState: true`, `requiresFreshAuthentication: false`  |
| Mutation  | `Yes; two-stage`          | `mutatesState: true`, `requiresFreshAuthentication: true`   |

**Why it cannot silently accept a corrupted cell.** Every lookup goes through one `normalised()`
helper that treats an absent key as a hard error: it throws, naming the file, the row id, the column
and the exact unmapped wording, and it lists the values it does know. There is no default branch, no
fallback value, and no skip. The tables are closed sets written by hand, so the only strings that
survive are the thirteen above — a typo, a reworded cell, or a new modality invented in the document
all stop the test rather than being coerced into something plausible. This is precisely why I did
not use `value.toLowerCase().replace(/\s+/g, "-")`: mutation 3's `Escape, backdrop, dismiss` would
have become the healthy-looking `escape-backdrop-dismiss` and the corruption would have passed
review.

## Discrepancies found

**One, and it needs your ruling.** I have transcribed the matrix faithfully and flagged it rather
than reconciling it.

The `Dismissal` column collapses two distinct type values into one prose string. Rows 19
(`session-expiry`) and 20 (`offline-banner`) both read **`Recovery action only`**, but the design
specimens that the matrix's own header names as its source give `session-expiry` the value
`action-only` and `offline-banner` the value `recovery-only`. The document cannot distinguish them.

What I did: read the frozen record on its own terms. Both rows say the same thing, so both rows get
the same value, and `recovery-only` is the member whose name matches the prose. The consequence is
that **`action-only` is now an unused member of `OverlayDismissal`** — the type is exactly as the
brief specifies it, but nothing in the table reaches that value.

Why I did not resolve it the other way: the specimens are not importable by production and you told
me the matrix is the frozen record, so treating the specimen file as the tie-breaker would have made
a design-scratch file authoritative over the frozen document. Reading the two rows as different
values would also have required inventing a distinction the document does not make.

If `session-expiry` is meant to be `action-only`, the fix is to amend the matrix document to say so
(for example `Recovery action only` versus `Sign-in action only`) and then this table; the test will
force both to move together. That is one line in each file, and I have not made it.

A second, smaller observation: the matrix document's opening line still declares the specimen file
to be "the source of truth". For Phase 2A production that is now this table and the matrix document
itself. Worth correcting when someone next edits that document; I have not touched it.

Everything else agrees with the brief exactly: 24 ids in the stated order, 16 `Yes` rows, and
`Yes; two-stage` on exactly `withdrawal` and `reassignment`.

## Files changed

- `src/components/caring-contacts/workspace/overlays/definitions.ts` (new)
- `tests/caring-contacts-overlay-definitions.test.ts` (new)
- `docs/caring-contacts/phase-2a-sdd-archive/task-17-report.md` (this report)

No other file was modified. `docs/caring-contacts/interaction-matrix.md` was edited transiently for
mutation 3 and restored byte-identically, proven above.

## Self-review findings

- **Counts hold at the source, not only in the test.** 24 `id:` lines, 16 `mutatesState: true`
  lines, checked by grep independently of the suite.
- **`MUTATING_OVERLAY_IDS` is derived, not transcribed.** A hand-written list of 16 ids is a second
  copy that can drift from the first; deriving it removes that failure mode, and the test still
  pins the length at 16 and the ordering against the table.
- **The prohibited vocabulary was grepped against the whole file**, not just the fields the test
  reads, covering the full task list (`high risk`, `safe`, `engagement score`, `campaign`, `lead`,
  `conversion`, `best match`, `inbox`, `conversation`, `clinical risk`, `risk score`,
  `wellbeing score`, monitoring claims). No hits.
- **No transport word is used as a patient-state label.** `delivery-detail` says what the network
  reported and explicitly denies any inference that the message was read or helped.
- **No bare dash anywhere**; every field carries real words. Australian English throughout
  (`personalisation`, `AWST` times in the local format).
- **The module is framework-free** — no `"use client"`, no React import — so Task 18 can consume it
  from either side of the client boundary.
- `overlayDefinition` returns `null` rather than throwing, on the reasoning that an unknown
  `?overlay=` value is a bad URL rather than a defect. Task 18 must therefore handle `null`; the
  test pins both branches.

## Concerns

1. **The `action-only` collapse above is the one thing I would not want merged unremarked.** It is a
   real behavioural decision about `session-expiry`, it is invisible unless you read the dismissal
   column carefully, and Tasks 18 and 19 will build and then prove whatever this table says.
2. **The copy is mine, not yours.** The 24 `summary` and `decision` strings are original plain
   English written against the meaning of each specimen, not lifted wording. They are the strings a
   coordinator will actually read, so they deserve a copy review even though every automated check
   passes.
3. **`availability` has no column in the matrix.** The brief specifies the type but the frozen
   record does not carry the values, so the 24 availability values are the only fields in this table
   that no test compares against the document. I set them to match the design specimens' intent
   (`Read only` on the three read-only surfaces, `Unavailable until resolved` on the seven blocked
   ones, `Available` on the remaining fourteen). If they matter to Task 18's rendering, they should
   get a column in the matrix so they are frozen like everything else.

---

# Follow-up — Ruling 58 and the reserved dismissal member

## What changed

Two additive edits. No existing assertion was deleted, loosened, or reworded, and nothing new is
exported — the public surface of `definitions.ts` is identical to the first commit.

- **A guard test**, `uses only the dismissal values the matrix expresses`, asserting that the set of
  `dismissal` values actually taken across the 24 definitions is exactly
  `["escape-backdrop-close", "recovery-only"]`. It pins the _used set_, not the type, so the reserved
  member stays in the union while becoming impossible to assign quietly.
- **A comment on `OverlayDismissal`** recording that `action-only` is reserved, currently
  unreachable, kept deliberately rather than forgotten, and guarded by that named test — so the next
  reader does not "tidy up" either the member or the guard.

## The two modality unions need no equivalent guard

I checked every value taken across the 24 rows before deciding:

| Union                    | Members                                                                 | Rows taking each |
| ------------------------ | ----------------------------------------------------------------------- | ---------------- |
| `OverlayPhoneModality`   | `bottom-sheet` / `full-screen-stage` / `session-gate` / `status-banner` | 13 / 9 / 1 / 1   |
| `OverlayDesktopModality` | `dialog` / `inspection-drawer` / `session-gate` / `status-banner`       | 19 / 3 / 1 / 1   |
| `OverlayDismissal`       | `escape-backdrop-close` / `recovery-only` / **`action-only`**           | 22 / 2 / **0**   |

Both modality unions are **fully exercised** — every member is taken by at least one row — so there
is no unreachable member to guard and I added nothing. `dismissal` is the only union with a member
no row can hold, which is why it is the only one that gets a guard.

## Mutation evidence for the new guard

_Does it change a value an assertion reads?_ Yes. I assigned `action-only` to `session-expiry` — the
row whose ambiguous matrix prose is the whole reason the member exists, and therefore the most
plausible place for a future author to put it.

```
FAIL > uses only the dismissal values the matrix expresses
AssertionError: expected [ 'action-only', …(2) ] to deeply equal [ 'escape-backdrop-close', …(1) ]
  [
+   "action-only",
    "escape-backdrop-close",
    "recovery-only",
  ]
 ❯ tests/caring-contacts-overlay-definitions.test.ts:149:18
      Tests  2 failed | 4 passed (6)
```

The row-for-row test reddened alongside it, which is the correct blast radius: that row's matrix
cell normalises to `recovery-only`, so both the frozen-record check and the used-set guard object.
Reverted; re-ran; 6 passed.

## The prose ambiguity is recorded, not resolved

`Recovery action only` reads either as _recovery-action only_ or as _recovery, action-only_, and the
two rows sharing it plausibly differ in kind — a session expiry needs the person to act, an offline
banner clears when the connection returns. Per the ruling, **no code here attempts to settle that**;
it is a frozen-record question for the owner and the final review, and it costs nothing today
because Task 19 only requires `session-expiry` to survive Escape, which both readings satisfy.

## Concerns 2 and 3 — closed as recorded limits, deliberately unguarded

The 24 `summary`/`decision` strings and the 24 `availability` values have no frozen source, so no
test compares them against anything. Per the ruling I have **not** invented a check for them:
asserting today's values against themselves would pin my own choices while wearing the appearance of
verifying the frozen record. Both remain human-read items, recorded rather than papered over.

## Note on the source-text guard (concern 4)

`tests/caring-contact-route-files.test.ts` enforces the no-mockup-imports rule by scanning
production source **text**, so it cannot distinguish an actual import from a prose mention of the
path in a comment or a doc block. That is a known and acceptable limitation — the guard is
deliberately blunt in the safe direction — and the fix is always to reword the comment, never to
narrow the pattern. The next author to hit it has not found a bug.

## Verification

```
$ node scripts/run-vitest.mjs run tests/caring-contacts-overlay-definitions.test.ts --reporter=dot
 Test Files  1 passed (1)
      Tests  6 passed (6)

$ node scripts/run-vitest.mjs run tests/caring-contact-route-files.test.ts --reporter=dot
 Test Files  1 passed (1)
      Tests  4 passed (4)

$ node ./node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
tsc --noEmit: exit 0, no diagnostics

$ npx eslint src/components/caring-contacts/workspace/overlays/definitions.ts tests/caring-contacts-overlay-definitions.test.ts
eslint: exit 0, no findings

$ npx prettier --check <both files>
All matched files use Prettier code style!
```

**I did not re-run the full `npm run test`, and I am saying so rather than implying it passed.** The
ruling scoped it to a new export; there is none. The change is one added test, one added comment,
and no change to any exported value, type or signature — the definition table's 24 rows are
byte-for-byte what the full suite already proved green at commit `003a05e31`. I did re-run the one
other test that reads this file's source text (`caring-contact-route-files`), because a comment edit
is exactly what tripped it last time.

`npm run format` ran across the repository and reported no unformatted file outside the two I
changed.

---

# Fix round 1 — the five Minors

All five fixed. Every change strengthens an existing assertion or adds a new one; nothing was
deleted, loosened, or renamed, and no new symbol is exported.

## Minor 1 — the lookup test could pass vacuously

`overlayDefinition("pause")?.title` was compared with `…find(…)?.title`: both sides optional-chained
over the same array, so a renamed or removed `pause` made both `undefined` and the assertion passed
while testing nothing. Now both sides are asserted present **before** they are compared, and the
comparison is `toBe(row)` — object identity, which is stronger than title equality and also proves
the lookup returns the very row from the table rather than a copy.

## Minor 2 — the tautology, pointed at the frozen record

`expect(MUTATING_OVERLAY_IDS).toEqual(WORKSPACE_OVERLAY_DEFINITIONS.filter(…).map(…))` re-derived the
exact expression that defines the export, so it could not fail. It now derives the expected list
from the **matrix document's mutation column**, through the same explicit normalisation table the
row-for-row test uses. It therefore tests the export against the authority rather than against
itself, it bites today, and it still catches the hand-written-list regression. `toHaveLength(16)`
stays beside it, and the document-derived list is length-checked too.

### Proving it bites — and why the mutation you suggested proves less

**Mutation A, exactly as asked**: hand-write `MUTATING_OVERLAY_IDS` as a literal list with `pause`
missing (15 ids).

```
AssertionError: expected [ 'verify-identity', …(14) ] to have a length of 16 but got 15
 ❯ tests/caring-contacts-overlay-definitions.test.ts:133:34
```

It reddens — but at **line 133**, the pre-existing `toHaveLength(16)`. Vitest stops the test at the
first failing assertion, so the rewritten comparison on line 143 never executed. That proves the
length check, not the new assertion, and reporting it as proof of the rewrite would have been
exactly the decorative-evidence move this branch keeps finding.

**Mutation B, the sharper one**: hand-write the list with 16 ids, replacing `pause` with the
non-mutating `activation-success`. Length stays 16, so the rewritten comparison is the assertion
that has to catch it.

```
AssertionError: expected [ 'verify-identity', …(15) ] to deeply equal [ 'verify-identity', …(15) ]
-   "pause"
+   "activation-success"
 ❯ tests/caring-contacts-overlay-definitions.test.ts:143:34
```

Line 143 is the rewritten assertion, and the **expected** side is the list read out of the matrix
document. That is the proof. Both mutations reverted; `Tests 7 passed (7)`.

## Minor 3 — prototype keys

`normalised()` now gates on `Object.hasOwn(table, wording)` before indexing, so a matrix cell reading
`constructor` or `toString` takes the named-error path rather than resolving to an inherited
function. As the reviewer said, no silent pass was possible before — a function is not a modality
string — but the failure message was illegible for the most confusing possible input. The guarantee
is now unconditional rather than incidental.

## Minor 4 — the frozen contract is frozen at type level

Every field of `WorkspaceOverlayDefinition` is now `readonly`, with a comment saying why:
`Object.freeze` is shallow and would not have stopped `WORKSPACE_OVERLAY_DEFINITIONS[0].label = "…"`
in a renderer. A consumer that tries to edit a row now fails to compile.

**Task 18 impact: none observed, but the check is weaker than it sounds.** `tsc -p tsconfig.json
--noEmit` passes across the whole project with the `readonly` markers in place. However, `git status`
shows only my two files in this worktree — Task 18's `overlay-host`/`shell` work is not on disk here
yet, so that clean typecheck does **not** prove their in-flight code compiles against a `readonly`
row. If it does not, the fix is theirs to make (read the row, do not assign to it) and I have not
pre-emptively weakened the type to avoid it.

## Minor 5 — the column positions are now asserted, not assumed

`frozenMatrixRows()` reads `cells[1..6]` by position. Column drift already failed closed, but it
failed _through_ the lookup tables — "unmapped phone modality value `Dialog`" — which points the next
reader at a corrupted cell rather than a moved column. Two additions:

- `frozenMatrixRows()` validates the header row against `MATRIX_COLUMNS` before parsing anything, so
  every consumer of the parse gets the clear cause first;
- a named test, `reads the matrix columns from the positions this parser assumes`, so the check is
  discoverable in the test list rather than buried in a helper.

**Proof it reports the real cause.** I transiently swapped the `Phone` and `Desktop` headings in the
matrix document:

```
Error: docs/caring-contacts/interaction-matrix.md: the table columns moved.
Expected `ID | Product context | Phone | Desktop | Mutation | Dismissal`;
found `ID | Product context | Desktop | Phone | Mutation | Dismissal`.
This test reads cells 1-6 by position, so correct the column order or this parser —
do not touch the row values.
 ❯ frozenMatrixRows tests/caring-contacts-overlay-definitions.test.ts:102:11
```

Three tests reddened and the message names column movement rather than a bad cell. Document reverted
and proven byte-identical by blob hash: `9d430bb5f11a2a89d7761572be0212a3d19f5957` before and after,
with `git status` clean on that path.

## Not done, deliberately

`tone` joins `summary`, `decision` and `availability` as a field with no matrix column and therefore
no frozen source. Per the ruling I have **not** invented a check for it; asserting today's values
against themselves would pin my own choices while wearing the appearance of verifying the record.
Four fields now go to the owner as the places automated checking cannot reach. The
`session-expiry` / `offline-banner` prose ambiguity likewise stays recorded, not resolved.

## Verification

```
$ node scripts/run-vitest.mjs run tests/caring-contacts-overlay-definitions.test.ts --reporter=dot
 Test Files  1 passed (1)
      Tests  7 passed (7)

$ node scripts/run-vitest.mjs run tests/caring-contacts-overlay-definitions.test.ts tests/caring-contact-route-files.test.ts --reporter=dot
 Test Files  2 passed (2)
      Tests  11 passed (11)

$ node ./node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
tsc exit: 0        (no diagnostics)

$ npx eslint <both files>
eslint exit: 0     (no findings)

$ npx prettier --check <both files>
All matched files use Prettier code style!
```

**I did not run the full `npm run test`, and say so rather than implying it passed.** Nothing new is
exported: the five fixes are three strengthened assertions, one added header test, one added
`readonly` marker, and one `Object.hasOwn` guard. `tsc` covers the whole project, which is where a
`readonly` regression would surface, and I re-ran the one other test that reads this file's source
text. `npm run format` ran repository-wide and reported no unformatted file outside the two I
changed.
