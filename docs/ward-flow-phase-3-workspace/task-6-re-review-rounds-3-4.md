# Task 6 — Scoped re-review of fix rounds 3 and 4

Reviewed at `845b7d456` (worktree `C:\Users\joshs\.codex\worktrees\ward-management-design\Database`,
branch `codex/ward-management-design`, tree clean before and after this review). Diff read:
`.superpowers/sdd/2026-08-19-ward-flow-phase-3-role-screens/review-f3ebd8ccf..845b7d456.diff`,
spanning `c8f7b22ec` (fix round 3) and `845b7d456` (fix round 4). Read-only review; no edits or
commits were kept — the two mutations described below were reverted with `git checkout --` and
`git status --short` was confirmed empty after each.

## Finding 1 (fix round 3) — ADDRESSED

Required: invert to a named allow-list, drop the transitive `useWardFlow()` + named-import
combination check, rename the test/comment to state what's actually enforced, keep the
zero-match tripwire.

Current tree (`tests/ward-flow-single-source.test.ts`):

- Line 41-45: `NOW_ANCHOR_ALLOWLIST` is a named `Set` of the three legitimate readers
  (`ward-sites.ts`, `ward-movements.ts`, `ward-flow-provider.tsx`), replacing the old empty
  `CLOCK_EXEMPT` + dual-regex combination check.
- Line 123-125: `readsNowAnchor()` is `/\bNOW_ANCHOR\b/.test(stripCommentsAndStrings(source))` —
  a bare-identifier scan with no `useWardFlow()` precondition and no import-syntax requirement,
  so it catches a named import, a namespace-qualified access (`sites.NOW_ANCHOR`), and a
  component that never calls `useWardFlow()` at all — the three evasions Finding 1 named.
- Line 162: test renamed to `"restricts every read of NOW_ANCHOR under src to the named
allow-list"` — states what's enforced, not a stale description.
- Line 155-160: the zero-match tripwire (`scanned.length` must be `> 0`) is kept and was itself
  widened to scan `SRC_DIR` in round 4.

Confirmed against real files: `ward-flow-reducer.ts`, `ward-derivations.ts`, and
`coordinator-screen.tsx` each contain the string `"NOW_ANCHOR"` only inside a `//` doc comment
(verified by reading each file directly — e.g. `ward-flow-reducer.ts:30`,
`ward-derivations.ts:290`, `coordinator-screen.tsx:37-38`), none of the three are on
`NOW_ANCHOR_ALLOWLIST`, and the suite is green — proving the comment-stripping correctly
excludes them rather than accidentally allow-listing them by omission.

## Finding 2 (fix round 3) — ADDRESSED

Required: hold the id, derive with `useMemo` + `.find()` against live `movements`, matching
`WardNetworkWorkspace`; render an explicit absence on a miss, never fall back to another record;
keep the absence guard in the JSX so hooks above still run unconditionally.

`src/components/ward-management/ward-management-modes.tsx`:

- Line 277: `const [selectedId, setSelectedId] = useState(movements[0].id);` — holds only the id.
- Line 286: `const selected = useMemo(() => movements.find((candidate) => candidate.id ===
selectedId), [movements, selectedId]);` — derives live from the current `movements` array on
  every render.
- Line 335-349: `{selected ? <DecisionPanel patient={selected} ... /> : <aside>...No synthetic
movement matches the current selection...</aside>}` — the absence branch is a distinct,
  honest message, never `movements[0]` or any other record. Every `DecisionPanel` prop that
  reads `selected` (`patient={selected}`, and `selectedId={destinationUnit(selected)?.id ??
eligibleCandidates(selected, now)[0]?.unit.id}`) is computed only inside the truthy branch, so
  TypeScript narrows `selected` to `Movement` there — no unsafe access outside the guard.
- The ternary lives in the JSX return, after `useWardFlow()`, `useState`, and both `useMemo`
  calls have already run — no early return before hooks.

This is a structural match, not just a similar shape, to `WardNetworkWorkspace`
(`ward-management-network.tsx:138,148-149`): identical `useState(movements[0].id)` seed and an
identical `useMemo(() => movements.find(...), [movements, selectedId])` derivation, confirmed by
reading that file directly.

New test `tests/ward-flow-queue-selection.dom.test.tsx` proves the derivation is live (not
frozen at mount) by dispatching a real `REFER_TO_UNITS` event from a sibling component after
mount, on one render tree, and reading the decision panel's badge again without remounting.
Live run: `npx vitest run tests/ward-flow-single-source.test.ts
tests/ward-flow-queue-selection.dom.test.tsx` → **`Test Files 2 passed (2)` / `Tests 6 passed
(6)`** (5 in the single-source suite + 1 in the new dom test — a non-vacuous count, not the
`0 tests / exit 0` false-green state this environment is known to produce).

## Finding 3 (fix round 4) — ADDRESSED, but the widened mechanism has a real soundness gap (see new finding below)

Required: widen the `NOW_ANCHOR` rule to all of `src`, keep the fixture-import rule (`ALLOWED`)
scoped to `ward-management`, use path-qualified allow-list keys, normalise Windows backslashes.

All four are present and correct in the current tree:

- Line 163: the `NOW_ANCHOR` rule now walks `SRC_DIR = "src"`, not `WARD_DIR`.
- Line 136: the separate fixture-import rule still walks `WARD_DIR` only, with its own
  basename-keyed `ALLOWED` set — correctly left unwidened, since the fixture is only ever
  imported from inside the ward-management feature.
- Line 41-44: `NOW_ANCHOR_ALLOWLIST` keys are full repo-relative paths
  (`"src/components/ward-management/ward-sites.ts"`, etc.), not bare basenames — a real fix,
  since a bare basename could collide with an unrelated same-named file anywhere else under
  `src` (there are ~200 modules under `src/lib` alone).
- Line 54-56: `normalizePath()` converts `join()`'s Windows backslashes to forward slashes
  before the `Set.has()` lookup. Verified this repo (Windows workstation, `core.fileMode=false`
  Dev Drive) actually needs it: the suite passes today, which it could not if the comparison
  silently failed on every legitimate reader.
- The round-4 temporary probe described in the doc comment does not exist in the working tree and
  has no history (`git log --all -- src/lib/ward-probe` is empty)
  — consistent with "created, proved the point, deleted," never committed.
- Path-collision claim checked directly: since keys are full paths and `walk()` builds full
  paths too, no two distinct files can ever produce the same key — the collision risk the round-4
  fix was written to close cannot recur by construction.

The four specific round-4 requirements are met. However, the mechanism the widening now exposes
to the _entire_ `src` tree — `stripCommentsAndStrings` — has a real correctness gap once run
against ordinary code outside `ward-management`. See below.

## New finding — Critical: `stripCommentsAndStrings` has no concept of a regex literal, and a quote character inside one desyncs string/comment tracking for the rest of the file

**Mechanism.** The stripper treats any `"`, `'`, or `` ` `` it meets as the start of a string and
scans forward for the next matching quote character, with no awareness that it might currently
be inside a regex literal. A regex containing a quote character — e.g. an alternation between a
double-quoted and single-quoted phrase pattern — opens a "string" the stripper does not expect,
and that string's contents (and everything between it and the next matching quote anywhere later
in the file) get silently deleted before the `NOW_ANCHOR` scan ever runs. Because the fake
string's end point depends on wherever the next matching quote happens to occur, everything after
it inherits an off-by-one "am I in a string or in code" parity for the rest of the file, until
enough further quotes happen to resynchronise it.

**This is not hypothetical — it is already present in two files under `src`, both outside
`ward-management`, now in scope because Finding 3 widened the scan to the whole tree:**

- `src/components/clinical-dashboard/search-utils.ts:331`:
  `const hasQuotedPhrase = /"[^"]+"|(?:^|\s)'[^']+'(?=\s|$)/.test(trimmed);`
- `src/lib/document-summary-badges.ts:61`:
  `const contraindicationNegationBefore = /\b(?:no|not|non|without|nil|free of|absence of|no known)\b[\s\w,'’-]{0,16}$/i;`

**Live, reverted proof against `search-utils.ts`.** Appended the most ordinary possible edit —
a new import plus a reference — immediately after the file's real, unmodified content:

```
import { NOW_ANCHOR } from "@/components/ward-management/ward-sites";
console.log(NOW_ANCHOR);
```

Ran `npx vitest run tests/ward-flow-single-source.test.ts` against the mutated file. Result:
**`Test Files 1 passed (1)` / `Tests 5 passed (5)`** — the guard that fix round 4 wrote
specifically to "restrict every read of `NOW_ANCHOR` under `src`" did not see a real,
uncommented, unstringed `NOW_ANCHOR` import and reference sitting in plain code. Reverted with
`git checkout -- src/components/clinical-dashboard/search-utils.ts`; `git status --short` was
empty afterwards.

A second mutation — the same import (renamed) plus an exported reference, preceded by a four-line
`//` comment block — placed at the same location _was_ caught (`Tests 1 failed | 4 passed (5)`,
naming `search-utils.ts` as the offender). Both results are genuine; the mechanism above explains
why: catch/miss for content placed after such a regex depends on incidental quote parity in the
intervening text, not on whether a real read is actually there. That non-determinism is itself
the finding — the guard's behaviour for any read placed after this class of regex is not a
reliable enforcement, it is a coin flip on unrelated file content.

**Why this doesn't fire today, and what would make it fire.** Neither `search-utils.ts` nor
`document-summary-badges.ts` currently imports `NOW_ANCHOR` (confirmed: `grep -rln "NOW_ANCHOR"
src` returns exactly six files, and neither is among them), so the guard is not silently failing
on the tree as it stands. The realistic trigger is narrower than "any read anywhere after the
regex": this repo's import-ordering convention places imports at the top of a file, which in both
of these files is _before_ the offending regex line, so an accidentally-added top-of-file import
would still be caught. The gap bites only for a read added textually after the regex — e.g. a
bottom-of-file addition, a second regex-bearing file where the quote-containing pattern happens
to sit near the top, or (as demonstrated) any file where a future edit lands after such a line.
Given the guard's own stated purpose is to catch exactly this class of _accidental_ future
addition anywhere in ~200+ modules, and the triggering code shape (a quote-alternation regex) is
already proven present twice under `src`, this is a real — not theoretical — soundness gap in the
specific property fix round 4 claims to hold, and it exists precisely because round 4 widened the
scan into files whose regex literals were never exercised while the scan was `WARD_DIR`-only.

**Severity: Critical**, scoped to this review's own subject (the guard's soundness), not to the
running app — no production code path is affected, and today's tree passes honestly.

## Other evasions checked and found not to matter (kept brief, per the review's own ask)

- **Re-export chains / barrel exports / import aliasing (`as X`).** Do not evade the guard: the
  scan is per-file and identifier-based, not import-resolution-based, so any file that must
  ultimately write the literal token `NOW_ANCHOR` somewhere to use the value (the import
  specifier itself, even when aliased with `as`) still contains that literal token and gets
  flagged if it isn't on the allow-list. Verified by inspection of `readsNowAnchor`'s
  implementation; not separately mutation-tested since the mechanism is a direct, one-step
  consequence of "textual substring match, stripped of comments/strings only."
- **Skipped file extensions.** `isScannable` only accepts `.ts`/`.tsx`. `src/lib/local-server-utils.mjs`
  is the one non-`.ts(x)` source file under `src`; confirmed it does not mention `NOW_ANCHOR`
  (`grep -c` → `0`). A real gap in principle (an `.mjs`/`.mts`/`.js` file could hide a read
  entirely), but nothing in the current tree exploits it.
- **Computed/bracket string-keyed property access** (e.g. `mod["NOW_ANCHOR"]` instead of
  `mod.NOW_ANCHOR`) does evade the scan — the literal `"NOW_ANCHOR"` sits inside a string and gets
  stripped before the identifier check runs. Traced through the stripper's logic; not
  vitest-verified since it did not seem worth a second mutation. Low realism: nothing in this
  codebase's style writes a static, known export name as a computed bracket access — it would
  read as deliberate obfuscation, not an accidental shape a refactor produces.
- **A second copy of the constant, or a hard-coded literal `now` value, or a raw `Date.now()`
  read.** None of these can ever be caught by an identifier-scan guard of this shape, by
  construction — there is no `NOW_ANCHOR` token to find. This isn't a bug introduced by round 3
  or round 4; it's a ceiling on what this entire style of test can ever enforce. Worth naming as
  an acknowledged residual risk for whoever next picks up Task 6, not as something these two
  commits should have fixed differently.

## `QueueView` under real conditions

`useState(movements[0].id)` throws if `movements` is ever empty. Checked reachability in
`src/components/ward-management/ward-flow-reducer.ts`: `seedWardFlowState()` seeds from
`structuredClone(wardMovements)` (a non-empty static fixture), and every reducer case either
`.map()`s the array (preserves length) or appends via `[...state.movements, created]`
(`RAISE_REFERRAL`, grows it). No case filters, slices, or otherwise removes an entry. `movements`
cannot become empty through any reachable action in this app, so the crash is not reachable
today.

Consistency matters more than the theoretical crash here, and it holds: `WardNetworkWorkspace`
(`ward-management-network.tsx:138`) uses the byte-identical `useState(movements[0].id)` pattern.
`QueueView` was explicitly written to match it (see the fix-round-3 comment at
`ward-management-modes.tsx:280-285`), so this is shared pre-existing fragility, not something
introduced by these two commits, and not a new inconsistency between the two views.

The absence branch and the guarded `DecisionPanel` props were checked in Finding 2 above — no
different-patient leak, and no prop reads `selected` outside the truthy branch.

## New breakage introduced by these two commits only

None found. Scope of the two commits is exactly: `ward-management-modes.tsx` (`QueueView`'s
selection state), one new test file (`ward-flow-queue-selection.dom.test.tsx`), and
`tests/ward-flow-single-source.test.ts`. `QueueView` has no other consumer or snapshot
(`grep -rl QueueView` returns only the component file itself, its own new test, and two docs
files) so the prop/shape change has no other blast radius to check. The new dom test's own
assertions were confirmed to run for real (non-vacuous `Tests 6 passed (6)` count, see Finding 2)
rather than trivially passing.

## Deferred / out of scope (not evaluated further — outside these two commits' diff)

- The inherent ceiling on identifier-scan guards (second constant copy, hard-coded literal,
  `Date.now()`) noted above is a design-level limitation of the whole approach, not a defect in
  round 3 or round 4 specifically.
- `.mjs`/`.js` file-extension blind spot in `isScannable` — real in principle, unexploited today,
  and pre-dates this diff (the extension list was unchanged by rounds 3 or 4).
