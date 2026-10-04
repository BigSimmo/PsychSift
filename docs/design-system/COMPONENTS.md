# PsychSift design system — COMPONENTS

**The public component contracts, their local publication state, and the remaining
specifications.** Prop shapes are normative contracts; token references are roles only —
values live in the token files (see [TOKENS.md](TOKENS.md)).

- **Date:** 12 August 2026 · companions: [SPEC.md](SPEC.md) · [DECISIONS.md](DECISIONS.md) ·
  [GATES.md](GATES.md)
- **Publication vocabulary:** `registered` — exported by `.design-sync/entry.tsx`, mapped to
  source, covered by a source-derived prop contract, preview, and direct static contract test ·
  `support-only` — public bundle API with no visual registry row · `product adopted` — imported
  by a declared production surface · `spec` — specified, not built.

---

## 0 · Maturity matrix

"Built" alone is too ambiguous — the generated maturity snapshot below is the claim. It is
derived from source, `.design-sync/config.json`, previews, direct contract coverage, and
production imports. It intentionally does not claim dark, forced-colours, 320px, print, remote
publication, or product adoption without separate evidence.

### 0.1 Registered visual components (55 — local contract; remote status unverified)

Every visual export has one source map entry, a source-derived public `*Props` contract (except
the two zero-prop roots), a reference preview, and a direct static publication test. The generated
table under **Generated maturity snapshot** is the canonical list and product-import count.

### 0.2 Support-only public APIs

`OverlayPortal`, `ToastProvider`, `useToast`, `AnswerState`,
`answerStateFromRetrieval`, `answerClipboardText`, `LiveAnnouncer`, `RouteAnnouncer`, and
`announce` are entry-only support APIs. They do not get visual registry rows. The private
`sheet-focus` stack remains deliberately unpublished.

### 0.3 Specified, not built

_Remaining from the original eight in this document:_ `DocumentFrame` is built locally
(`src/components/ui/document-frame.tsx`, shell-only in `DocumentViewer`) but is not yet among
the 55 design-sync registered visual exports — registration and full controls remain follow-up.

`OverlayRoot`, `SegmentedControl`, and the PR 6–8 components are built and represented by the
local publication contract. The generated snapshot records their current product-import counts;
registration still proves only a source/API/preview/test reference and does not prove remote
design-project publication or browser acceptance.

_P1 reusable (specified in outline only):_ `Menu`/`Popover` · `KeyValue` ·
`AppliedFilters`/`FilterSheet` · `ResponsiveActionGroup` · `ScrollableStrip`/
`ScrollAffordance` · `SourceLink` · `Banner` · `CopyButton`/`CopyField` ·
state family (`OfflineState`, `PermissionDeniedState`, `NotFoundState`,
`UnavailableState`). `ErrorState` is built (`src/components/ui/error-state.tsx`) and
locally registered — it is not outline-only.

`FilterBar` and `DataTable` are retired names, not future component contracts. Use a
surface-owned filter pattern or the canonical `AccessibleTable`; do not revive either name.

_P2 clinical and governance:_ `LifecycleTrack` · `ConfidenceMeter` · `EvidenceGutter` ·
`Dropzone` · `AuditTimeline` · `VersionDiff` · `ProvenancePanel` · `ClinicalCallout` ·
print primitives (`PrintHeader`, `PrintFooter`, `CitationFootnote`, `PrintOnly`,
`ScreenOnly`, `KeepTogether`) · toolbar family · `Stat` · `Divider` ·
`TruncatedText` · `Identifier` · `Avatar` · `CommandPalette`.

### 0.4 Open-defect ledger (existing components → closing PR)

| Component                    | Open defects (compressed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Closes in            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Button                       | danger hover/active tokens, the 48px comment and `ref` forwarding (plus a `testId` passthrough — React 19 types give components no `data-*` index signature) are resolved; the client boundary remains                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | follow-on            |
| AsyncButton                  | `type` applied after spread (default `button`; explicit `submit` preserved). Prefer `Button` busy API for new sites.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **done** (PR-A)      |
| IconButton                   | disabled encoding uses `controlDisabled` (opacity retired in PR-A)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **done** (PR-A)      |
| ToggleSwitch                 | operable branch requires `aria-label`; opacity disabled retired; knob now travels on `transform` (`translate-x-4`), tokenised duration, reduced-motion opt-out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **done** (motion)    |
| Chip                         | final `appearance`/size API, removable label contract, tap target and full-value title                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **done**             |
| TextField/SearchField/Select | all three closed, and the row was stale when re-measured 2026-08-08: each folds onto `FormField`, which renders `hint` AND `error` unconditionally and merges `aria-describedby` caller → hint → error; each takes an external `id` and a `ref`. Landed in PR 13, not the PR 7 the row pointed at                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **done**             |
| Checkbox/RadioGroup          | all four closed. Two rows were stale when re-measured on 2026-08-08: ids already sanitise through `optionId`, and the group already carries `hint`/`error`/`describedBy`. Raw dimensions moved to `size-5`/`h-0.5` (`size-4.5` retired by `check:icon-scale`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **done**             |
| Citation/CitationList        | required interactive handler, stable-id list keys and static-span labelling (`aria-label` on a role-less span was dropped, losing the currency phrase on print) are resolved; route/source modes remain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | follow-on            |
| DoseLine                     | must compose `Quantity` · structured dose model · overdue text + non-colour mark + open action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **done** (PR 6)      |
| StatusMark                   | app-type coupling resolved — `DocumentStatus` is declared here and `@/lib/types` conforms to it (asserted at compile time in the DOM suite), not the reverse; inline styles/raw geometry remain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | PR 12                |
| AnswerCard                   | required verification/state, structured actions and five-state vocabulary landed. `support` joined them as a third required prop (2026-08-21) — authority-gated `medium` trust previously rendered identically to `high`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **done** (PR 6)      |
| AnswerFooter                 | machine ISO values composed through `DateDisplay` + `MissingValue` landed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **done** (PR 6)      |
| PageHeader/Breadcrumb        | all resolved. The wrap alone was not enough — the actions track still took full max-content first, so the title column now has a `minmax(20ch,1fr)` floor and the actions track is the one that gives way                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **done**             |
| Tabs                         | both resolved. An invalid `value` no longer empties the tab order: the first enabled tab becomes reachable and owns the panel wiring. Reachability only — no `onChange` is fired to repair caller state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **done**             |
| Pagination                   | all resolved. Props clamp (`page=0` no longer emits `onPageChange(-1)`), the control row wraps at 320px, and reaching a boundary hands focus to the current page and announces "Page N of M" through `LiveAnnouncer`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **done**             |
| Links                        | `tone` leak, spread-overridable `download` (now type-omitted AND written after the spread) and the `gap` "animation" (`gap` is not in Tailwind's `transition` list, so it jumped; now a composited `translate-x`) are resolved; new-tab policy still implicit, and `LinkAction` silently ignores `tone`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | PR 9                 |
| Tooltip                      | composed handlers/description, string content, OverlayRoot portal, collision and delay contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **done** (PR 10)     |
| Toast                        | independent tone/priority/persistence, OverlayRoot portal, pause, dedupe and queue contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **done** (PR 10)     |
| Sheet/ConfirmDialog          | required names/action labels, portal default, tokened layers/duration and wrapping titles                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **done** (PR 10)     |
| Disclosure                   | heading level and print resolved — a collapsed panel is `print:block`, so a section no longer prints as if the guideline never mentioned it; truncation remains. The old docstring's Ctrl-F/print claim was false                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | PR 11                |
| Progress/StageList           | all four resolved: `scaleX`, the theme `animate-shimmer` in place of a hardcoded `1.4s`, a step index clamped to ≥1, and an sr-only `role="status"` sibling in place of `aria-live` on the whole `<ol>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **done**             |
| EmptyState                   | static live-off default with explicit polite/assertive opt-in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **done** (PR 8)      |
| AccessibleTable              | semantic caption, `MissingValue` cells, dense headers (clipped header keeps its full string as `title`) and the expander (now the registered `Button`, off the local ring-focus recipe) landed; content-role widths remain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | PR 6/PR 12 remainder |
| ui-primitives.tsx            | 698-line module mixing recipes/actions/feedback/clinical — split. Re-measured 2026-08-12: **157** production files import it (202 including mockups), against the 55 registered components' **31** with product imports; this module, not the registry, is what the product actually runs on. Per-primitive breakdown added 2026-08-21: `Button` **12** importers against 157, with **112** production files still holding a raw `<button>`; `Sheet` **26** — the one genuinely adopted primitive. The split is not uniform, and the pattern explains it: `Sheet` owns focus trap, portal and overlay stacking, which a className cannot fake, while `Button`/`Chip`/field shells own visual convention a recipe string approximates. Deciding between "give `Button` behaviour worth importing" and "promote `ui-primitives` to the documented layer" is the actual PR 12 question | PR 12                |

---

## 1 · `VerificationNotice`

**Problem.** The AI-verification wording is a call-site convention, so a generated answer can
render without it, with drifted wording, or with wording a lay reader cannot use. The system
must own the words; the call site may only choose the state it is in.

```ts
type VerificationNoticeProps = {
  /** Drives the approved wording variant. Never free text. */
  state: "ready" | "stale_evidence" | "partial_retrieval" | "ungrounded" | "source_only";
  /** "plain" is the lay-reader variant for patient/carer-facing prints (factsheets). */
  audience?: "clinician" | "plain";
  /** Preserves extractive provenance when a caution state outranks source_only. */
  attribution?: "model" | "extractive";
  /** Print rendering is self-contained: no wording may depend on the live link. */
  medium?: "screen" | "print";
  sourceCount?: number;
  /** Print medium only; ISO. Rendered through DateDisplay. */
  printedAt?: string;
  printedBy?: string;
  className?: string;
};
```

**Variants.** `screen`/`clinician` (default, rendered inside `AnswerCard`) ·
`print`/`clinician` (standalone document header block) · `print`/`plain` (lay wording;
required for factsheet prints — DECISIONS §Q4). `screen`/`plain` exists for on-screen
factsheet preview parity.

**States.** One approved wording per `state`. `ready` still carries the verification
disclaimer — ready is not verified. `stale_evidence` and `partial_retrieval` wording names
the degradation category; the specific sources are `RetrievalStateBanner`'s job, not this
component's. `ungrounded` (added in PR 13 Phase 1, ledger `#207`) says the cited sources
could not be shown to support every claim and names the claim class to check in the
passages; it wears the caution role, matching the live "Review source match" the product
paints amber today. It never says the answer is wrong — unsupported is not refuted.

**Keyboard & screen reader.** Static text in document order, above answer actions. Not a
live region, not focusable; its icon is `aria-hidden`. On print it always renders, first in
the answer block.

**Tokens.** Body text `--text-muted`; icon per the SPEC §5 vocabulary (`Info` neutral,
`TriangleAlert` caution); caution states use the warning role — never danger red, because
this is source-currency/operational severity, not clinical hazard.

**Must refuse to render.** Without a `state` (type-level) · with caller-supplied wording
(no children or text props exist) · a `no_answer` state (no card exists to attach it to) ·
elided or truncated in print (print CSS may not hide it; gate planned).

**Do:** treat wording changes as spec changes reviewed by the clinical owner. **Don't:**
interpolate model names, vendor names, or percentages into the wording; don't let tone vary
by mode.

**Built in PR 6, completed in Phase 1.** Five approved state variants × two audiences live in the
component; there is no children prop and no text prop, so a call site cannot supply
wording. `tests/ui-v2-answer-safety.dom.test.tsx` asserts the state/audience variants are distinct, that
`ready` still carries the verification disclaimer, that no wording matches a model or
vendor name or a percentage, and that only the caution state wears the warning role.

---

## 2 · `AnswerState` + `RetrievalStateBanner`

**Problem.** Degraded, partial, and fallback answers are structurally identical to confident
ones; the state lives in ad-hoc call-site branches. The state must be a value the type system
sees, so the degraded invariants (SPEC §2.5 corollary, §10) are unrepresentable to violate.

```ts
type SourceRef = { sourceId: string; title: string; locator?: string };
/**
 * `reviewDueOn` was drafted as a required `string` and was widened to
 * `string | null` when this was built (PR 6). Governance can mark a source
 * `review_due`/`outdated` without a recorded review date; dropping such a source
 * from the banner to satisfy the narrower type would hide the most alarming case
 * — known past review, with no review commitment recorded at all. `DateDisplay`
 * renders the absence as `Not recorded` rather than inventing a date.
 *
 * `status` was added when this was built (PR 6). Collapsing `outdated`
 * (superseded) into the `review_due` vocabulary tells a clinician a withdrawn
 * guideline is merely due for review. It is carried, and drives both the
 * `StatusMark` shape and the wording.
 */
type OverdueSource = SourceRef & {
  reviewDueOn: string | null /* ISO */;
  status: "review_due" | "outdated";
};

/** Why an answer is not grounded in the sources it cites, broadest consequence first. */
type UngroundedReason = "grounded_false" | "confidence_unsupported" | "unverified_numeric" | "weak_evidence";

/** States an AnswerCard may render. */
type AnswerState =
  | { kind: "ready"; sourceCount: number }
  | { kind: "stale_evidence"; overdue: OverdueSource[]; sourceCount: number }
  | {
      kind: "partial_retrieval";
      retrieved: number;
      requested: number;
      missing: SourceRef[];
    }
  | { kind: "ungrounded"; reason: UngroundedReason; sourceCount: number }
  | { kind: "source_only"; reason: "generation_failed" | "quality_gate" };

/** Deliberately NOT an AnswerState: no card may render it. */
type NoAnswer = {
  kind: "no_answer";
  reason: "offline" | "no_confident_answer";
  lastSyncAt?: string; // ISO
};

type RetrievalStateBannerProps = {
  state: Exclude<AnswerState, { kind: "ready" }>;
  /** Q1: the clinician's next act is re-verification — one click to the cited page. */
  onOpenSource: (sourceId: string, locator?: string) => void;
  className?: string;
};
```

**Behaviour.**

- `AnswerCard` takes `support: AnswerSupportStrength` (`strong`/`supported`/`limited`/
  `unassessed`) as a **required** prop, wording owned by the card. `deriveTrust` returns
  `"medium"` both for an ordinary answer and for a HIGH-RISK claim resting on
  unreviewed-authority evidence, while `weakEvidence` covers only `"unsupported"`/`"low"` —
  so that second case reached the reader as `ready`, indistinguishable from a verified
  answer. The distinction existed in `compactEvidenceSummary` but sat in a
  conditionally-rendered side card. Required, not optional, for the same reason
  `verification` is: it must not be hideable. Text, never colour alone.
- `AnswerCard` takes `state: AnswerState` as a **required** prop (PR 6, type-level gate).
  `NoAnswer` is excluded from the union: offline / no-confident-answer renders **no answer
  card** — the `EmptyState` path with last sync, cached sources, and a "search cached
  sources" action. Neutral, not amber.
- The banner renders above the prose. `stale_evidence` starts as a compact “Review due” tab
  with the affected-source count, matching the source-only disclosure rather than occupying
  a full warning panel. Expanding it lists every overdue source with its review date
  (`DateDisplay`) and an open-at-cited-page action; the answer remains readable — caution,
  never a gate (DECISIONS §Q1). When every cited source is overdue, the expanded detail states
  totality: “Every source for this answer is past its review date.”
- **A source is a document, not a chunk.** `RagAnswer.sources` is chunk-level and several
  chunks of one document is the normal case, so `answerStateFromRetrieval()` dedupes and
  counts by `document_id`. Chunk-level counting is wrong in both directions, and the
  direction that inflates the denominator under-warns. Where chunks of one document disagree
  on governance status, the more severe reading wins.
- **An empty `overdue` list is a defect, not a state.** `stale_evidence` with no named
  overdue source would render "0 of 3 sources are past their review date" — a caution
  arguing against itself. The banner throws in development (mirroring the
  `partial_retrieval`/`missing` guard) and, in production, states the caution without a
  count. Same rule in `answerClipboardText()`.
- `partial_retrieval` names the gap ("2 of 5 sources unavailable") and lists missing sources
  as unavailable rows — never silently omitted.
- `ungrounded` names which check fired — one headline per `reason` under the group label
  "Source match status" — and gives the same instruction in all four cases: read the cited
  passages and confirm the numbers there. It is the DS carrier for the live product's
  "Review source match" caution (`evidence-panels.tsx`, `answer-thread-turn.tsx`), so
  adoption cannot retire that warning by accident.
- `source_only` says it is a fallback and why that is safe (sources are real and cited);
  this is expected product behaviour, not an apology.
- Announcements go through `LiveAnnouncer` once on settle ("Answer ready, 4 sources" /
  "Answer ready with caveats, 2 of 5 sources unavailable") — the banner itself is **not** a
  live region.
- Copy/export of any non-`ready` state appends the caveat via `clipboardProvenanceLine()`
  (`src/lib/source-metadata.ts`) — one audit path, no parallel implementation.

**States and colour channels.** `stale_evidence` wears the warning (source-currency) role on
the spine and banner, and `ungrounded` joins it — not because grounding is a currency fact,
but because the live product already paints "Review source match" amber, and adoption that
demoted it to the neutral role would lose the signal `#207` exists to preserve.
`partial_retrieval` and `source_only` are **operational** severity:
neutral/info treatment plus explicit text — amber is reserved for source currency
(SPEC §11 severity vocabularies). Dose values inside a stale answer demote to label weight
with the unit unchanged.

**Keyboard & screen reader.** The banner is a landmark-free region with a heading-level-
appropriate label; source rows are real buttons/links (never inert); focus order follows
document order; the open action's accessible name names the source and page.

**Must refuse to render.** `RetrievalStateBanner` with `kind: "ready"` (type-level) · an
`AnswerCard` without a state (type-level) · a partial state whose `missing` list is empty
(throws in dev, logs and renders totality-safe copy in production — a gap with no named
sources is a data defect, and inventing "0 sources" copy would mask it).

**Do:** keep state derivation in the RAG layer; this component only renders what it is
told. **Don't:** infer staleness in the component from dates — the review policy lives in
`src/lib/source-review.ts`.

**Built in PR 6, with one state unproduced.** `answerStateFromRetrieval()` projects the
app-facing payload onto this union by reading fields the retrieval layer has already
decided — `source_metadata.document_status` for currency, `answerQualityTier` +
`fallbackReason` for the fallback discriminator — so no date comparison happens here.
`partial_retrieval` **has no producer**: nothing app-facing names which expected sources
were unavailable, so adoption can emit only `ready`, `stale_evidence`, `ungrounded` and
`source_only` until a separate RAG contract PR adds a named missing-source signal. Do not
synthesise one from candidate counts. Precedence when states overlap is by clinical
consequence — `stale_evidence` > `partial_retrieval` > `ungrounded` > `source_only` >
`ready` — and the source-only disclosure still reaches the reader through `AnswerCard`'s
separate `verification` prop. `tests/answer-state-contract.test.ts` pins all of this.

**`ungrounded` added in PR 13 Phase 1 (ledger `#207`).** It reads `grounded`, `confidence`
and `unverifiedNumericTokens` — fields the payload already carried and the live product
already gated on — plus an optional caller-derived `weakEvidence` for adoption sites that
compute one from render trust. Nothing is derived here: absent grounding fields are not
ungrounding, so a call site that has not been widened does not acquire a caution on every
answer. Ungrounded outranks `source_only` (an unsupported source-only answer must not read
as "evidence complete, synthesis weak"), and `stale_evidence` stays the outer kind when an
answer is both, so one answer never stacks two alarms.

---

## 3 · `MissingValue`

**Problem addressed.** Missing clinical data previously rendered as a bare dash in
`AccessibleTable`, which could not distinguish _not recorded_ from _not applicable_ from
_unable to extract_. The canonical table now composes `MissingValue`; remaining legacy call
sites must converge on the same explicit vocabulary because a dash can read as a negative result.

```ts
type MissingValueProps = {
  reason:
    | "not_recorded"
    | "not_applicable"
    | "unknown"
    | "extraction_failed"
    | "not_yet_calculated"
    | "withheld_until_complete";
  /** "cell" tightens spacing for dense tables; the phrase is never abbreviated. */
  density?: "inline" | "cell";
  className?: string;
};
```

**Variants.** The six phrases (SPEC §11): `Not recorded` · `Not applicable` · `Unknown` ·
`Unable to extract` · `Not yet calculated` · `Withheld until complete`. The last two say the
value is absent only for now — `not_yet_calculated` where nothing has been computed because
the user has not finished, `withheld_until_complete` where a value **could** be computed and
the surface is deliberately suppressing it so a partial reading cannot mislead. Do not use
either where the input is complete. **[assumed:** a general "Withheld" redaction phrase is
still excluded until a redaction path exists — `Withheld until complete` is suppression
pending completion, not redaction.**]**

**Plain-string call sites.** `missingValuePhrase(reason)` returns the same phrase as a string,
for the accessors and result objects typed `string` that would break if handed a component
(diffing through a `Set`, clipboard export). Same wording, same rules; never a second vocabulary.

**States.** None — it is a terminal, static rendering of absence.

**Keyboard & screen reader.** Plain text; no role, no live region, not focusable. The phrase
is the accessible text — never an icon-only or colour-only rendering. Prints as-is.

**Tokens.** `--text-muted`. Never `--decoration-soft` — this is text carrying meaning.

**Must refuse to render.** Custom text (no children prop) · a bare dash under any density ·
an unknown `reason` (type-level; runtime fallback renders `Unknown` and logs once, never
throws — enum resilience per SPEC §7).

**Do:** adopt inside `AccessibleTable` cells, `AnswerFooter` absent fields, `KeyValue`.
**Don't:** use it for loading (that is `Skeleton`) or for failed requests (that is
`ErrorState` — "no result count is available" is not a missing value).

**Built in PR 6**, and already composed inside `AnswerFooter`, `DateDisplay`, and
`AccessibleTable`. All three render explicit missing-value phrases; no bare-dash or dropped-segment
convergence remains for these components.

---

## 4 · `FormField` + `FieldHint` + `FieldError` + `ErrorSummary`

**Problem.** TextField, SearchField, Select and the choice controls each hand-roll the field
shell; the hint disappears when an error appears (contradicting their own comments), caller
`aria-describedby` is overwritten, ids cannot be supplied, refs are not forwarded, and
required/optional/autocomplete have no system.

```ts
type FormFieldRenderProps = {
  id: string;
  describedBy: string | undefined; // merged: caller + hint + error, space-joined
  invalid: boolean;
  required: boolean;
  // Added when this was built (PR 7): the draft carried autoComplete on
  // FormFieldProps only, so the control the caller renders had no way to apply it.
  autoComplete: string | undefined;
};

type FormFieldProps = {
  label: string; // required — no unlabeled control exists
  id?: string; // external id supported; generated otherwise
  required?: boolean; // marked in the label text, never colour alone
  hint?: string;
  error?: string; // presence ⇒ invalid
  autoComplete?: string; // pass-through guidance, SPEC §9.7
  describedBy?: string; // caller ids — merged, never overwritten
  children: (field: FormFieldRenderProps) => ReactNode;
  className?: string;
};

function FieldHint(props: { id: string; children: string }): JSX.Element;
function FieldError(props: { id: string; children: string }): JSX.Element; // role="alert"

type ErrorSummaryProps = {
  heading?: string; // system default wording
  errors: Array<{ fieldId: string; label: string; message: string }>;
  className?: string;
};
```

**Behaviour.**

- **Hint and error are both in the DOM and both in `describedBy` when invalid.** Losing the
  format hint at exactly the moment the user got the format wrong is the current defect.
- `FieldError` renders in `role="alert"`; the control gets `aria-invalid`. Error is text +
  icon, never colour alone (SPEC §9.6).
- `ErrorSummary` renders at the top of the form after a failed submit, receives focus
  (`tabIndex={-1}`), and each entry is a link that moves focus to its field. It is not a
  live region — focus movement is the announcement.
- Controls consuming the render prop forward refs and accept the generated or supplied `id`.
- Labels are visible text; placeholder is never the label; placeholder colour clears the
  text threshold (TOKENS §5, `--text-placeholder`).

**States.** default · focused · invalid (hint + error) · disabled (encoded via `controlBase`,
not opacity) · required/optional.

**Optionality marker.** Required fields append the visible word `(required)` to the label and
set the native `required` contract on the control. Optional fields receive no suffix: `(optional)`
was deliberately removed from the product because optional is the default and repeating it made
dense clinical forms harder to scan. Do not restore an optional suffix at individual call sites;
the rule is text-first, never colour-only, and is pinned by
`tests/ui-v2-form-field.dom.test.tsx`.

**Keyboard & screen reader.** Label → control association by `htmlFor`/`id`; described-by
order: caller, hint, error; Tab order unchanged by validity; summary-link activation moves
focus into the field.

**Must refuse to render.** A field without a `label` (type-level) · an error rendered as
colour alone · overwriting caller `describedBy` (merge is the only path).

**Done, not pending (re-measured 2026-08-08):** `TextField`, `SearchField` and `Select` fold
onto this shell — landed in PR 13, not the PR 7 this line used to point at. `Checkbox` and
`RadioGroup` deliberately do **not**: a group keeps `<fieldset>`/`<legend>` and composes
`FieldHint`/`FieldError` directly (see `choice.tsx`). Do not "finish" a fold that is finished.
**Don't:** add per-control bespoke hint/error markup again; don't put block content in the
hint (string type is deliberate).

**Current field contract.** `TextField`, `SearchField` **and `Select`** all consume
`FormField`: `id`, `hint`, `error`, `required`, `autoComplete`, and caller
`aria-describedby` are public field contracts. Their hints/errors are strings because
assistive technology receives them as one description.

**Two different axes, and this section is about the first one.** _Component integration_ —
which controls fold onto `FormField` — is complete for all three above, and deliberately
declined for `Checkbox`/`RadioGroup`, which keep `<fieldset>`/`<legend>`. _Product adoption_
— whether a production file imports the component — is separate and partial. Measured
2026-08-08 from `adoption-manifest.json`: `TextField` 3 production importers and `Select` 2,
so both are adopted; `SearchField`, `Checkbox` and `RadioGroup` have **zero** and are part of
the forms tranche in `#266`. A control can be fully integrated and still unadopted; do not
read one axis as the other, and do not count `Select` as pending on either.

---

## 5 · `LiveAnnouncer` + `RouteAnnouncer`

**Problem.** No focus management or announcement exists on route change — in a 13-mode app
every navigation strands assistive-technology users. Streaming answers re-announce
fragments, result counts announce through a visible low-contrast node, and `StageList` makes
its whole visual list a live region.

```ts
// Singleton API — one instance mounted at the app root.
function announce(message: string, opts?: { priority?: "polite" | "assertive" }): void;

function LiveAnnouncer(): JSX.Element; // two visually-hidden regions (polite, assertive)
function RouteAnnouncer(): JSX.Element; // subscribes to app-router navigation
```

**Behaviour.**

- **Route change:** if navigation happened inside an overlay or controlled workflow, focus
  is preserved deliberately; otherwise focus moves to the new `<h1>` (fallback: main
  landmark) with `tabIndex={-1}`, and the page title is announced once.
- **Streaming:** the streamed answer renders under `aria-live="off"`; on settle, one
  announcement — "Answer ready, 4 sources" (or the caveated form, §2).
- **Result counts / stage transitions:** concise text through `announce()`; the visible
  count node is ordinary compliant text, never itself live (fixes the
  `document-search-results.tsx` pattern).
- Repeated identical messages within a short window are deduplicated; queued messages never
  interleave mid-sentence.

**States.** None visible — both components render only visually-hidden regions.

**Keyboard & screen reader.** The whole point. `polite` for outcomes and counts;
`assertive` reserved for loss-of-work risks (auth expiry sheet). Focus placement never
scrolls without focus.

**Tokens.** None (visually hidden utility only).

**Must refuse to render.** Visible children (no children prop) · a second instance
(dev-mode throw; production no-op with one logged warning) · announcing on every keystroke
(rate discipline is the component's, not the caller's).

**Do:** route all announcements here. **Don't:** put `aria-live` on any visible content
node anywhere in the product — that is the anti-pattern this component exists to end.

**Built in PR 8; the existing live regions are still live.** `announce()` dedupes an
identical message inside a one-second window and spaces queued messages so one cannot cut
into the previous sentence; `RouteAnnouncer` skips the first render (arrival is not a
navigation), moves focus to the new `<h1>` unless focus sits inside a dialog or a
`data-preserve-focus` workflow, and announces the page title once. Retiring the visible
`aria-live` nodes that remain in production — `document-search-results.tsx`, `StageList`,
`AnswerProgress`, `EmptyState`'s default — is adoption work in PR 13, because each
one needs its own surface diff. Until then two announcement mechanisms coexist.

`AnswerProgress` is the successor to `AnswerProgressStepper`, which was retired when the
answer wait was redrawn as a single quiet status line plus the arriving source rail. Its
live region moved with it and is now the status line itself (`answer-progress-line`) rather
than a wrapper, because the line is the element that persists while its text is replaced.

---

## 6 · `DocumentFrame`

**Problem.** PDF pages and source images render bare: white pages glare on the dark shell,
nothing owns loading/error/zoom/print behaviour, and nothing structurally prevents the one
forbidden treatment — inversion — on the most-viewed surface in the product.

```ts
type DocumentFrameProps = {
  src: { kind: "pdf-page"; url: string; page: number; pageCount?: number } | { kind: "image"; url: string };
  /** Required: what the page/figure is, for assistive tech and for the error state. */
  alt: string;
  state?: "loading" | "ready" | "error";
  onRetry?: () => void;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  /** User-controlled viewing aid. Off by default. Never during print/export or on a zoomed figure. */
  viewingAid?: boolean;
  className?: string;
};
```

**Behaviour.**

- **Pixel-faithful always.** No `filter`, no `invert`, no `color-scheme`, no default scrim —
  in any theme (SPEC §8). In dark, the _surround_ grades: hairline frame on
  `--surface-raised`, shell luminance stepped so the page edge is not a cliff.
- Loading uses stable-geometry skeleton (no layout shift on arrival). Error renders the
  three-part error structure with retry; it never renders a broken-image glyph alone.
- Page metadata (page _n_ of _m_) renders adjacent to the frame, tabular numerals.
- **Print:** pixel-accurate, viewing aid forced off, frame chrome hidden by
  `[data-print-hide]`, the page never split across sheets (`KeepTogether`).
- **Phone (blocking, DECISIONS §Q3):** fit-width by default at 320px, native pinch zoom
  preserved, zoom controls meet the tap target and stay reachable under 400% zoom.

**Keyboard & screen reader.** The frame is a labelled group (`alt` names it); zoom in/out/
reset are real buttons; page navigation (when `pageCount` present) is keyboard-operable;
focus is never trapped inside the frame.

**Tokens.** `--surface-raised` frame · `--ring-hairline` edge (borderless floating surround)
· `--e1` lift · gutter/space roles for metadata row. Content pixels: none, ever.

**Must refuse to render.** Without `alt` (type-level) · with any colour transform on the
content layer (gate planned: no `filter`/`invert`/`color-scheme` on document surfaces) ·
viewing aid during print/export or on a zoomed figure (component-enforced, not caller
convention).

**Do:** route every document and source-image render through it. **Don't:** re-implement
page dimming per surface; don't let a mode add its own scrim "just here".

---

## 7 · `OverlayRoot`

**Purpose.** One overlay root owns the named layer hosts while the private `sheet-focus` stack
continues to own mature modal focus behaviour. Tooltip, Toast, Sheet, and ConfirmDialog publish
through this shared layer contract.

```ts
type OverlayLayer = "overlay" | "popover" | "modal" | "toast";

function OverlayRoot(): JSX.Element; // single portal host at the app root
```

**Behaviour.**

- **One stack.** Layers map 1:1 to the stacking rungs (`--z-overlay`, `--z-popover`,
  `--z-modal`, `--z-toast`) — no other z value exists in overlay code (gate: SPEC §4.8).
  The toast viewport rides above modal, deliberately.
- **Escape** is delivered to the topmost overlay only. **Focus** is trapped on modal layers,
  restored on close (folding in the branch's mature `sheet-focus` nested-sheet handling).
  Background becomes inert (`inert`/`aria-hidden`) for modal layers; scroll is locked.
- Popover/tooltip layers get collision-aware positioning on this foundation (Menu/Popover,
  P1, build here — not another model).
- `Sheet`, `ConfirmDialog`, `Tooltip`, and `Toast` publish through `OverlayPortal`; the application
  root mounts the singleton `OverlayRoot`. A fallback host keeps isolated previews and tests safe.
- `calculator-sheet` remains a parallel `--z-modal` surface deferred past Arch. It is not
  absorbed into `OverlayRoot` or `Sheet` in this PR.

**States.** Per-consumer; the root itself has none.

**Keyboard & screen reader.** Trap and restore per layer; dialogs must arrive named
(`Sheet` requires a title or labelledBy — enforced at `Sheet`, re-asserted here: an unnamed
dialog cannot mount); toast announcements go through the toast region's own politeness
model, decoupled from visual tone.

**Must refuse to render.** A second `OverlayRoot` (dev throw) · a consumer passing a raw z
value (no such prop exists) · mounting a modal-layer overlay with no accessible name.

**Do:** build every new floating surface here, including Menu/Popover. **Don't:** keep
per-component portals or hand-rolled stacks after adoption.

---

## 8 · `DateDisplay`

**Problem.** Date rendering drifts per call site: `AnswerFooter` accepts preformatted
strings, relative dates float free of their absolutes, and print can carry a relative date
that is meaningless on paper.

```ts
type DateDisplayProps = {
  /** ISO only. Preformatted display strings are unrepresentable. */
  value: string | null | undefined;
  /** Review/expiry dates are always absolute; "event" may carry a relative companion. */
  kind: "review" | "generated" | "event";
  /** Screen only; renders beside the absolute, never instead of it. */
  relative?: boolean;
  /** Rendered via MissingValue when value is absent. */
  missingReason?: "not_recorded" | "not_applicable" | "unknown" | "extraction_failed";
  className?: string;
};
```

**Behaviour.**

- Display locale `en-AU`, timezone `Australia/Perth`, rendered in a `<time>` element with
  the machine value in `dateTime`. Internal comparison logic elsewhere keeps its ISO keys —
  this is a display component only (`perthCalendarDate()`'s `en-CA` machine key is correct
  and untouched).
- `kind: "review"` never renders relative — a review date is a commitment, not an ambience.
- Relative text renders only beside the absolute, and **never in print** — a printout is a
  snapshot (SPEC §4.12).
- Absent value renders `MissingValue` (explicit reason); invalid ISO renders
  `MissingValue("unknown")`, logs once, never throws.

**States.** value · missing · invalid.

**Keyboard & screen reader.** `<time>` semantics; the accessible text is the full absolute
date; relative companion is supplementary text, not the name.

**Tokens.** Inherits its context's text role; tabular numerals via `--nums` where dates
align in columns.

**Must refuse to render.** A preformatted display string (type-level: ISO only) · relative
without absolute · relative under print media · silent absence (missing always renders a
phrase).

**Do:** compose inside `AnswerFooter`, `RetrievalStateBanner`, provenance rows, print
headers. **Don't:** format a date anywhere else in product code; don't localise the machine
layer.

**Built in PR 6.** `kind: "generated"` renders date **and** time — a generation stamp
without its time is not a stamp — while `review`/`event` render the date alone. The
relative companion is client-only, so server and client render the same absolute date and
hydration cannot mismatch on a clock tick. `formatClinicalDate()` in
`src/lib/source-metadata.ts` remains the formatter for provenance _strings_ (the clipboard
audit line cannot contain an element); a test pins that the two agree, so the string and
element paths cannot drift apart.

---

## 9 · Existing-component contracts

The binding contract per existing component: what it is for, its modes and states, its
keyboard/screen-reader behaviour, the token roles it may touch, and its rules. Anything not
stated here falls back to the universal rules (SPEC §6) and the authoring definition of
done (SPEC §14). **Open defects** name their closing PR from the playbook (SPEC §13);
until that PR lands the defect stands and is not re-litigated per review.

### Focus chrome

Two carriers, never a third:

- **Controls** (`button` / `a` / `summary` / checkbox-radio-range): `outline: 2px solid var(--focus)` on `:focus-visible`, same as `controlBase`. No Tailwind `ring-*` companion on the same node.
- **Text fields / search shells:** quiet 1px color-mix hairline. Use `fieldControl` / `fieldControlPlain` / `fieldControlWithIcon`, or `searchShell` + `searchShellInput`. Nested inputs stay `outline: none`. Never put `controlBase`'s 2px outline on a text field.

`focus:ring-4` plus `focus:border` on leftover fields is forbidden: those rings win over the unlayered field `box-shadow`. Residual: the production composer pill (`.answer-footer-search-pill` / `.answer-footer-search-input`) keeps the `ui-smoke` halo until a dedicated chrome PR — do not restyle that pill here.

### 9.1 `Button`

**Purpose.** The one action primitive. `AsyncButton` and hand-rolled `<button>`s converge
here. **Variants.** `primary` (filled `--command` — one per surface), `secondary`,
`ghost`, `quiet`, `danger` (filled `--danger-solid`, paired `--danger-solid-contrast`).
**States.** Full DoD set; `busy` integrated (spinner + `busyLabel`, control stays in the
tab order, never removes its accessible name); disabled via `controlBase` encoding.
**Keyboard & SR.** Native button; `type="button"` default; icons `aria-hidden`.
**Tokens.** command triplet + contrast · danger pair · `--radius-md` · tap utilities ·
`--focus` outline only. **Rules.** Verb-first specific labels, never "OK"/bare "Confirm" ·
hover/active from semantic tokens, never `brightness-*` filters · one filled command per
surface. **Landed.** Danger contrast and hover/active tokens plus the 48px tap-floor comment.
**Tap vs compact-meta (DS-P1-09 / DS-P2-24).** Primary `Button` / `primaryControl` / filled command actions stay `min-h-tap` at **all** breakpoints — no `sm:min-h-10`, `sm:min-h-9`, `lg:min-h-9`, or `min-h-11`. Metadata, disclosure, filter chips, and table micro-actions may use `min-h-compact-meta` (40px) or a documented prefixed compact (`sm:min-h-compact-meta`). `--row-compact` / `min-h-9` (36px) is row height, not a tap target. Recipes: `interactiveCompact` and `tableMicroActionRow` are the named compact-meta exceptions in `ui-primitives.tsx`; `controlBase` stays tap-sized. Full table: TOKENS §2 “Compact-meta vs tap”.
**Open defects → PR.** ref forwarding and the needless client boundary → follow-on.

**Command CTA path.** Pick one encoding; do not invent a fourth.

| Situation                                         | Winner                                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Real button action (copy, continue, submit, busy) | `<Button variant="primary">` from `src/components/ui/button.tsx`                                                             |
| Navigation that must look like the filled command | `Link` + `primaryControl` (`Button` has no `href` / `asChild`)                                                               |
| Unavailable placeholder                           | `aria-disabled` + `ignoreUnavailableActivation` from ui-primitives; **never** native `disabled` and `aria-disabled` together |

### 9.2 `IconButton`

**Purpose.** Icon-only action with a mandatory `label`. **States/Keyboard.** As Button;
the label is the accessible name; the glyph is `aria-hidden`. **Rules.** Visible face may
be compact; the hit target meets the tap floor via padding or pseudo-element. **Open
defects → PR.** `disabled:opacity` (one of the 39, §9.33) → PR 3; ref forwarding → PR 4.

### 9.3 `AsyncButton` — deprecated

**Disposition.** Retire or alias to `Button` (PR 4). Do not build new surfaces on it.
**Resolved.** `type` defaults to `"button"` (applied after the prop spread so an explicit
`type="submit"` still wins) — it can no longer submit a surrounding form.

### 9.4 `ToggleSwitch`

**Purpose.** Binary setting; also a read-only status form. **Modes (union, PR 4).**
`interactive` (label + checked + onCheckedChange required) · `status` (label + checked;
`role="img"`-style read-only, still named). **Rules.** Compact 40×24 face is fine; the
_target_ meets the tap floor via a transparent hit area · knob motion is `transform` with
the physical curve · reduced motion snaps. **Resolved (6 Aug 2026).** operable branch
requires `aria-label`; opacity disabled retired; knob travels on `transform`
(`translate-x-0` / `translate-x-4`) with tokenised duration and `motion-reduce` opt-out —
no longer animates `left`/`right`. **Open defects → PR.** none remaining on this
component; broader Gate 9 motion sweep still tracks other surfaces.

### 9.5 `Chip`

**Purpose.** Compact label for tones, filters, categories. Static chips are text, not
targets (tap-exempt under the inline exception). Interactive filter chips that are **not**
primary CTAs may use `min-h-compact-meta` (or `sm:min-h-compact-meta`) per TOKENS density
policy; do not copy that step-down onto a filled command action. **Modes (union, PR 4).** `static` (no
removal props representable) · `removable` (`onRemove` + `removeLabel` both required).
**Rules.** Remove control keeps a small visible glyph inside an overlapping hit target
that does not inflate the chip · truncated labels need a full-value path · category tones
come from the frozen `--tone-*` set only (SPEC §3). **Open defects → PR.** 20px remove
target, optional `removeLabel`, generic fallback name → PR 4.

### 9.6 `TextField` / `SearchField` / `Select`

**Disposition.** All three fold onto the shared `FormField` shell (§4) in PR 7 — the
duplicated field-shell logic is the root defect. **Interim rules.** Placeholder is never
the label and never the decoration tier · search clear is a real named button ·
`SearchField` submits through the page's one composer contract
(`docs/search-chrome-behaviour.md`). **Open defects → PR.** hint dropped on error,
`describedBy` overwritten, no external id/refs, no required/optional/autocomplete
system → PR 7.

### 9.7 `Checkbox` / `RadioGroup`

**Purpose.** Native inputs, kept native — real `fieldset`/`legend` for groups. **Rules.**
Option ids derive from sanitised stable keys, never raw values · group-level hint/error
arrive via `FormField` · mixed checkbox state announced. **Open defects → PR.**
`RadioGroup` controlled-with-no-change-path (union or `defaultValue` mode) → PR 4; raw
dimensions, box-vs-root `className`, missing group states → PR 7.

### 9.8 `Citation` / `CitationList`

**Purpose.** The product-defining source reference. **Modes (union, PR 4).** `static` ·
`internal` (`href: Route`) · `source` (`onOpenSource(sourceId, locator)` required) — an
enabled-inert citation is unrepresentable. **Data.** Structured `CitationData` with a
stable `id` (never index keys); status via `StatusMark` with the label adjacent. **Rules.**
A static citation is text with visible content, not an `aria-label` on a bare span · list
identity survives reorder · deep source destinations (page, table, image) go through the
`SourceLink` pattern when it lands. **Landed.** The interactive branch requires `onActivate`,
and `CitationList` keys rows by stable `citation.id`. **Open defects → PR.** static span
labelling and the richer internal/source destination modes → follow-on.

### 9.9 `Quantity`

**Purpose.** The safety typography for numbers-with-units (SPEC §2.3). **Rules.** Numeral
mono, tabular (`--nums`), value weight; unit sans, label weight, one type step down,
`normal-case` pinned — a transform on a unit changes the dose · ranges use an unspaced en
dash · never a bare decimal without a leading zero · unit spacing from the quantity pair
tokens. **Open defects → PR.** consumes the retiring `text-base-minus` step → fixed in
the type-retirement tranche (PR 13-adjacent), tracked so it cannot ship into adoption.

### 9.10 `DoseLine`

**Purpose.** Ledger row for dose data. **Contract.** Composes `Quantity` — never
reimplements its typography; takes a structured dose model (value/range, frequency,
route, maximum, source), never a preformatted string; dose column right-aligned so
numerals stack. `status: DocumentStatus` is **required** — this is the
highest-consequence surface in the system and a row must not read clean because a call
site omitted a flag; an overdue `status` additionally requires `source`, so "warned, with
nowhere to go" is unrepresentable. **Overdue behaviour (Q1).** Amber per-row rule **plus**
visible text ("Source review overdue" / "Source superseded") **plus** a non-colour mark
whose shape differs per state, and the row's open-source-at-page action — caution and
affordance, never a gate. Both overdue states wear amber, not danger: SPEC §11 reserves
amber for source currency and red for clinical hazard, and the mark plus the word
"superseded" carry the severity difference. **Open defects → PR.** all of the above →
PR 6.

### 9.11 `StatusMark`

**Purpose.** Shape as the second status channel — only where status _is_ the content, not
dense tables. **Contract.** Geometry from `--status-mark-size`/`--status-mark-stroke`
(landed `59e4c3dfc`); status type is a small design-system enum, not the application
model; the adjacent text label stays the primary channel. **Rules.** Never the sole
carrier of status · forced-colour survival is **asserted, not proven** until PR 2's
computed tests. **Open defects → PR.** inline styles, app-type coupling → PR 12; HCM
proof → PR 2.

### 9.12 `SourceStatusBadge` / `SourceDesignationBadge` / `SourceProvenance`

**Purpose.** The trust layout (SPEC §2.2): status, authority, and provenance as permanent
content. **Contract.** Vocabulary is exactly the SPEC §7 table — one phrase per state;
off-vocabulary degrades to the neutral triad, logs once, never throws (gated). The three
axes are independent; a badge never infers one from another. Metadata is typed
(`SourceMetadataInput`), never `unknown`. **Rules.** Clinical colour only for source
state · authority icons per the SPEC §5 vocabulary (`Landmark` official, `ShieldCheck`
trusted — never for validation status).

### 9.13 `AnswerCard`

**Purpose.** The answer surface. **Contract (PR 6).** `state: AnswerState`,
`verification: VerificationNoticeProps` and `support: AnswerSupportStrength` are **required**; body/query echo/source
summary/actions are structured props, not free `ReactNode` slots; the system owns the
wording. Never `bg-transparent`; prose at `--text-md`/`--leading-prose`/`--measure`.
**Clipboard.** `answerClipboardText()` carries attribution and the verify instruction on
**every** state including `ready` — a copied answer loses the banner, the notice and the
links, and unattributed clinical prose in a record reads as clinician-endorsed. It is
**not** a replacement for `formatAnswerRenderCopyText()`: the product path composes the
two through `composeAnswerClipboardText()` (`src/lib/answer-clipboard.ts`, ledger `#208`),
which keeps the render-policy string primary and adds attribution, the `AnswerState`
caveat and the provenance line. Both callers share one implementation of each of those
three rules. See SPEC §13 blocker 1 for the decision. **Publication status.** Required
verification/state props, structured actions and the fifth `ungrounded` state are implemented
(ledger `#207`, SPEC §13 blocker 2).

**Reference status.** `AnswerCard` is registered in the local design-sync contract and has a
valid reference preview. It has no direct product import in the generated adoption manifest, so
it is not evidence of answer-shell adoption.

### 9.14 `AnswerFooter`

**Purpose.** Always-visible provenance: publisher · version · review date · generated
timestamp. **Contract.** Machine values only (ISO in), rendered through `DateDisplay`;
absent fields render `MissingValue`, never silently drop. **Publication status.** The component
accepts machine values and the reference previews now pass ISO dates/timestamps.

### 9.15 `InlineNotice`

**Purpose.** In-flow contextual notice — distinct from `Toast` (transient outcome) and
the `Banner` pattern (page-level persistent). **Rules.** Tone follows the severity
vocabularies (SPEC §11): clinical hazard, source currency, and system failure never share
a treatment · icon per the SPEC §5 table · not a live region.

### 9.16 `PageHeader` / `Breadcrumb`

**Purpose.** One `<h1>` per page, owned here. **Rules.** The title wraps — page titles
never truncate; title column `minmax(0, 1fr)`, actions wrap below at the component's
minimum width (the `ResponsiveActionGroup` pattern) · eyebrow uses `--tracking-eyebrow`
at a text-passing tier, never the decoration tier · description is a string or a
block-safe slot, never arbitrary nodes inside `<p>` · the current breadcrumb keeps a
full-name path. **Open defects → PR.** truncating `<h1>`, `shrink-0` starvation,
low-contrast eyebrow → PR 3 + the layout fix riding PR 7's tranche.

### 9.17 `Tabs`

**Purpose.** View switching with real tab semantics. **Contract.** `aria-controls` only
for panels that exist in the DOM; an invalid or disabled selected value falls back to the
first enabled tab so the tab order is never empty; manual activation available for
expensive panels. **Rules.** Sort/filter choices are not tabs — they are
`SegmentedControl` (§9.18). **Open defects → PR.** phantom `aria-controls`, empty tab
order → contract-test tranche of PR 4. The control split is complete.

### 9.18 `SegmentedControl`

Small mutually exclusive choice (sort, density) as pressed buttons or a radiogroup —
**never** `role="tablist"`. It is built as an accessible radiogroup with a required visible or
referenced label, roving focus, Arrow/Home/End keys, disabled-option skipping, and fit/equal
layouts. Use it instead of shipping a new "segmented" use of `Tabs`.

### 9.19 `Pagination`

**Contract.** `page`/`pageCount` clamped and validated; page change announces through
`LiveAnnouncer` and defines its focus policy; `compact` form is previous · "Page X of Y" ·
next, used whenever the container cannot fit the numbered window (320px blocking).
**Open defects → PR.** unclamped props, 320px overflow, opacity disabled, no
focus/announce policy → PR 3, PR 8.

### 9.20 Links — `TextLink` / `ExternalTextLink` / `DownloadLink` / `LinkAction`

**Rules.** Internal navigation is Next `Link` — never a raw anchor (repo rule) · external
links carry the `ExternalLink` icon and an explicit new-tab policy, not an accidental
universal · `DownloadLink`'s `download` semantics are not overridable by spread; `tone`
is destructured, never leaked to the DOM · `LinkAction`'s arrow animates with `transform`,
never `gap`. **Resolved (6 Aug 2026).** `tone` is destructured before the spread in
`TextLink`, `ExternalTextLink`, and `DownloadLink`. **Resolved.** `DownloadLink`'s
`download` is `Omit`ted from the spread type and applied after `{...props}`, so it can no
longer be overridden; `LinkAction`'s arrow nudge uses `transition-transform` +
`group-hover:translate-x-0.5`, never `gap`. **Open defects → PR.** new-tab policy implicit
/ raw underline offset → PR 9.

### 9.21 `Tooltip`

**Purpose.** Supplementary hint — never the sole carrier of meaning (truncation policy,
SPEC §11). **Contract (PR 10).** Composes the child's handlers and merges
`aria-describedby` (never overwrites); portalled via `OverlayRoot` at the popover rung;
collision-aware; open/rest delay; dismiss on Escape; `content` is a string so the trigger has
a complete description. **Publication status.** The PR 10 contract is implemented.

### 9.22 `Toast` (`ToastRegion` + `ToastProvider`/`useToast`)

**Purpose.** Transient outcome announcements. **Contract (PR 10).** Four independent
axes: `tone` (appearance) · `priority` (polite/assertive) · `persistence` (timed —
pauses on hover **and** focus — or explicit) · optional labelled `action`. One
application-level viewport at the toast rung (above modal, deliberately); queue cap and
dedupe; warning and danger never share an icon (SPEC §5). A toast with an `action` or an
`onClose(reason)` callback is never merged by dedupe, and `onClose` fires exactly once
(`timeout`, `dismiss` or `action`), so a caller can hold back a removal until Undo has
had its chance (Favourites does this). **Publication status.**
`ToastRegion` is the visual export; `ToastProvider` and `useToast` remain support-only APIs.

### 9.23 `Sheet`

**Purpose.** The modal layer. Focus trap, restoration, and nested-sheet topmost handling
remain in the private focus stack while the surface publishes through `OverlayRoot`.
**Contract (PR 10).** An
accessible name is mandatory (visible `title`, `labelledBy`, or `aria-label` — an unnamed
dialog cannot mount); portal defaults **true**; z and duration from the named tokens;
titles wrap, header actions never starve them; close button on the `controlBase`
encoding. **Publication status.** The PR 10 API and overlay contract are implemented and the app
layout mounts `OverlayRoot`. This is overlay infrastructure, not a `.ckb-v2` style activation.

### 9.24 `ConfirmDialog`

**Contract.** `confirmLabel` required and object-specific ("Delete 3 documents", never
"Confirm") · `description` is a block-safe slot · destructive confirmations may require
the typed confirm phrase; its label is a `string`. **Publication status.** The final API is
source-derived and its reference preview exercises the typed confirmation path.

### 9.25 `Disclosure` / `DisclosureGroup`

**Contract.** Heading level is a prop — never a hardcoded `<h3>` · collapsed content is
**not** find-in-page reachable via plain `hidden` (retracted claim); evaluate
`hidden="until-found"` where discoverability matters · print-relevant disclosures expand
under the print theme (PR 11) · the group supports controlled and default-open ids ·
the trigger is a **grid** and the panel repeats its template, so the label, the collapsed
preview and the expanded body share one left edge · `py-2.5` plus a 28px first-line band
(`leading-7`) puts a single-line row exactly on the 48px tap floor, and `items-start` holds
the tile, `meta` and chevron to that band when copy wraps · the preview clamps to two
lines · `icon` is a **leading tile for list-shaped groups**, passed as a bare glyph so the
component owns the tile and its grid track cannot desync from
`--spacing-disclosure-icon`; an inline glyph inside a sentence stays in `title` (see
`medication-considerations.tsx`) · `surface` and the group's `variant` are props, never
`className` overrides, because `cn()` joins strings and does not resolve Tailwind
conflicts · panel copy uses the exported `disclosureBodyText`, never a restated size.
**Landed.** `headingLevel` drives `h2`–`h6` for both components. Truncation is closed: the
trigger had horizontal padding only, so a wrapped preview pressed its copy into the border;
the preview was `text-xs` against a `text-sm leading-6` panel, so an `extendDescription` row
re-sized the same sentence on open; and the panel's own `px-3` moved that copy sideways.
Pinned in a browser by `tests/ui-forms-section-nav.spec.ts` ("symmetric vertical padding",
"left edge and in the preview's type") — jsdom applies no Tailwind, so it can assert neither.
**Accepted residual.** With `extendDescription` the trigger holds the tap floor whether or
not the preview is present, so the copy moves down about 10px on expand. It does not change
size, colour or left edge. **Open defects → PR.** print behaviour → PR 11.

### 9.26 `Progress`

**Contract.** Determinate progress is `transform: scaleX()` with `transform-origin:
left` — never `width` · indeterminate must use tokened duration; reduced motion shows a
static state · the track/fill pair follows the edge rule · an optional `mark` prop
(`{ value: number; label: string }`) draws a reference point on the same 0–100 scale as
`value` — e.g. "where you would need to be today" — as a 2px notch inside the track; it is
a sibling of the fill, never a second fill, and never changes the track's height. Its
position clamps to 0–100 independently of `value`, its colour is `var(--text)` (never a
status colour — it is a neutral reference point, not a status), and it repaints as
`CanvasText` under forced colours so it survives Windows high-contrast rather than
vanishing. The notch itself is `aria-hidden`; `mark.label` reaches assistive technology as
the bar's `aria-describedby`, pointing at an `sr-only` **sibling of the track** — a name on
the notch would sit inside `role="progressbar"`, which WAI-ARIA gives presentational
children, so a conforming browser may strip it and announce it zero times. The mark stays
out of `aria-valuenow`, which keeps reporting the real `value`: a screen reader that
announced the target as the progress would state the opposite of the truth. Omitting `mark` renders exactly as before. **Landed.** Determinate
fill uses `scaleX()` and tokened transition duration; indeterminate now uses the
`animate-shimmer` `@theme` token rather than a hardcoded `1.4s` literal; the optional
target `mark` notch. **Open defects → PR.** none remaining on this component.

### 9.27 `StageList`

**Purpose.** Multi-stage ingestion/processing progress. **Contract.** The visual list is
**not** a live region; stage transitions announce concisely through `LiveAnnouncer`
("Embedding failed, step 4 of 5") · "step 0 of N" is unrepresentable · failed states have
a spoken word, not just a colour · a spinner is never a terminal state. **Open defects →
PR.** whole-list live region, step-0, silent failure → PR 8.

### 9.28 `EmptyState`

**Contract.** `live` defaults **off** — a static empty page is not a status region;
callers opt in only for dynamically-introduced emptiness · offers a real next action ·
neutral treatment (the offline/no-answer state rides this component, SPEC §10). `headingLevel`
is opt-in and limited to `h2`–`h6`; `testId` is the stable focused-test hook. The preview
demonstrates both the static live-off default and an explicitly polite dynamic state.

### 9.29 `LoadingPanel` / `Skeleton`

**Rules.** Skeletons keep stable geometry (no layout shift on arrival) and are for
unknown-shape loads; staged work with real progress uses `StageList` · reduced motion
replaces shimmer with a static state · a spinner is never a terminal state — every load
resolves to content, an empty state, or an error state.

### 9.30 `AccessibleTable`

**Purpose.** The canonical clinical table. Stacked-card `compact` strategy, tested numeric
alignment, expander `aria-controls`, and the unverified-extraction treatment are its
strengths — keep them. **Contract.** A semantic `<caption>` is required (visually styled,
not a `<div>` + `aria-label`); dense headers are sentence case; missing cells render
`MissingValue`, never a bare dash; column widths follow content roles, not imposed
equal-width inline styles; the expand control composes `Button` and the outline rule.
**Publication status.** `caption` is required in the exported props and the preview renders the
canonical semantic table path; missing cells already render `MissingValue`, never a bare dash.
Dense-header casing, content-role widths and Button-based expander convergence remain tracked
separately from the publication contract.

### 9.31 `PanelHeading`

**Rules.** Carries the heading-inset convention (SPEC §4.6): first child of a panel, no
top margin, the panel's padding provides the space · `description` is the unified slot
(the `EmptyState.body` alias is deprecated).

### 9.32 `SafeBoldText`

**Purpose.** Sanitised emphasis for model-produced text — the only path by which
generated text may carry markup. **Rules.** No raw HTML ever; anything outside the
sanitiser's tiny grammar renders as plain text.

### 9.33 `ui-primitives.tsx` recipes

**Contract.** `controlBase` owns the disabled encoding — the 39 remaining
`disabled:opacity` uses (ratcheted as `disabledOpacityUses` in
`scripts/design-system-contract-baseline.json`; re-measured 2 Sep 2026, corrected from a
stale "ten") migrate in PR 3 · the module splits in PR 12
(`styles/recipes.ts`, actions, feedback, forms, clinical-source, source-metadata
contract) so generic primitives stop importing clinical application modules · recipes
never restate a token value. `interactiveCompact` and `tableMicroActionRow` use
`min-h-tap` on phones and `sm:min-h-compact-meta` on pointer layouts (metadata /
disclosure, not primaries). Do not copy that step-down onto `controlBase` or
`primaryControl`. The 2026-07-31 icon regression (lucide imports replaced
with glyph spans by an unverified merge, repaired in `0b0f393c7`) is the cautionary case:
this file is load-bearing for the icon vocabulary; changes to it require the focused DOM
tests to run.

<!-- adoption-manifest:maturity:start -->

## Generated maturity snapshot

Registered public components: 55
Components with a valid design-sync preview: 55
Components with product imports: 46

This generated snapshot is a local source-derived inventory. It does not assert remote design-project publication.

| Component                | Family   | Built | Locally registered | Observed v2 mount     | Proof declared | Baseline committed | Product imports |
| ------------------------ | -------- | ----- | ------------------ | --------------------- | -------------- | ------------------ | --------------: |
| `AccessibleTable`        | source   | yes   | yes                | inherited-global-root | yes            | no                 |               4 |
| `AnswerCard`             | answer   | yes   | yes                | inherited-global-root | yes            | no                 |               1 |
| `AnswerFooter`           | answer   | yes   | yes                | inherited-global-root | yes            | no                 |               1 |
| `AsyncButton`            | controls | yes   | yes                | inherited-global-root | yes            | no                 |               5 |
| `Breadcrumb`             | layout   | yes   | yes                | inherited-global-root | yes            | no                 |               1 |
| `Button`                 | controls | yes   | yes                | inherited-global-root | yes            | no                 |             136 |
| `Checkbox`               | controls | yes   | yes                | inherited-global-root | yes            | no                 |              14 |
| `Chip`                   | controls | yes   | yes                | inherited-global-root | yes            | no                 |               9 |
| `ChoiceChip`             | controls | yes   | yes                | inherited-global-root | yes            | no                 |               6 |
| `Citation`               | source   | yes   | yes                | inherited-global-root | yes            | no                 |               1 |
| `CitationList`           | source   | yes   | yes                | inherited-global-root | yes            | no                 |               1 |
| `ConfirmDialog`          | layout   | yes   | yes                | inherited-global-root | yes            | no                 |              13 |
| `DateDisplay`            | source   | yes   | yes                | inherited-global-root | yes            | no                 |               4 |
| `Disclosure`             | layout   | yes   | yes                | inherited-global-root | yes            | no                 |               3 |
| `DisclosureGroup`        | layout   | yes   | yes                | inherited-global-root | yes            | no                 |               1 |
| `DoseLine`               | answer   | yes   | yes                | no                    | yes            | no                 |               0 |
| `DownloadLink`           | controls | yes   | yes                | no                    | yes            | no                 |               0 |
| `EmptyState`             | feedback | yes   | yes                | inherited-global-root | yes            | no                 |              21 |
| `ErrorState`             | feedback | yes   | yes                | no                    | yes            | no                 |               0 |
| `ErrorSummary`           | feedback | yes   | yes                | no                    | yes            | no                 |               0 |
| `ExternalTextLink`       | controls | yes   | yes                | inherited-global-root | yes            | no                 |              10 |
| `FieldError`             | feedback | yes   | yes                | inherited-global-root | yes            | no                 |               2 |
| `FieldHint`              | feedback | yes   | yes                | inherited-global-root | yes            | no                 |               2 |
| `FormField`              | controls | yes   | yes                | inherited-global-root | yes            | no                 |              16 |
| `IconButton`             | controls | yes   | yes                | inherited-global-root | yes            | no                 |               4 |
| `InlineNotice`           | feedback | yes   | yes                | inherited-global-root | yes            | no                 |              34 |
| `LinkAction`             | controls | yes   | yes                | no                    | yes            | no                 |               0 |
| `LoadingPanel`           | feedback | yes   | yes                | inherited-global-root | yes            | no                 |              11 |
| `MissingValue`           | feedback | yes   | yes                | inherited-global-root | yes            | no                 |              11 |
| `OverlayRoot`            | layout   | yes   | yes                | inherited-global-root | yes            | no                 |               1 |
| `PageHeader`             | layout   | yes   | yes                | inherited-global-root | yes            | no                 |              16 |
| `Pagination`             | controls | yes   | yes                | inherited-global-root | yes            | no                 |               1 |
| `PanelHeading`           | layout   | yes   | yes                | inherited-global-root | yes            | no                 |               2 |
| `Progress`               | feedback | yes   | yes                | inherited-global-root | yes            | no                 |               1 |
| `Quantity`               | answer   | yes   | yes                | inherited-global-root | yes            | no                 |               1 |
| `RadioGroup`             | controls | yes   | yes                | no                    | yes            | no                 |               0 |
| `RetrievalStateBanner`   | answer   | yes   | yes                | inherited-global-root | yes            | no                 |               2 |
| `SafeBoldText`           | layout   | yes   | yes                | inherited-global-root | yes            | no                 |               9 |
| `SearchField`            | controls | yes   | yes                | inherited-global-root | yes            | no                 |               4 |
| `SegmentedControl`       | controls | yes   | yes                | inherited-global-root | yes            | no                 |              21 |
| `Select`                 | controls | yes   | yes                | inherited-global-root | yes            | no                 |              15 |
| `Sheet`                  | layout   | yes   | yes                | inherited-global-root | yes            | no                 |              86 |
| `Skeleton`               | feedback | yes   | yes                | inherited-global-root | yes            | no                 |               7 |
| `SourceDesignationBadge` | source   | yes   | yes                | inherited-global-root | yes            | no                 |               4 |
| `SourceProvenance`       | source   | yes   | yes                | inherited-global-root | yes            | no                 |               1 |
| `SourceStatusBadge`      | source   | yes   | yes                | inherited-global-root | yes            | no                 |               4 |
| `StageList`              | feedback | yes   | yes                | no                    | yes            | no                 |               0 |
| `StatusMark`             | source   | yes   | yes                | inherited-global-root | yes            | no                 |               6 |
| `Tabs`                   | controls | yes   | yes                | inherited-global-root | yes            | no                 |               4 |
| `TextField`              | controls | yes   | yes                | inherited-global-root | yes            | no                 |              40 |
| `TextLink`               | controls | yes   | yes                | inherited-global-root | yes            | no                 |               3 |
| `ToastRegion`            | feedback | yes   | yes                | no                    | yes            | no                 |               0 |
| `ToggleSwitch`           | controls | yes   | yes                | inherited-global-root | yes            | no                 |               2 |
| `Tooltip`                | feedback | yes   | yes                | no                    | yes            | no                 |               0 |
| `VerificationNotice`     | answer   | yes   | yes                | inherited-global-root | yes            | no                 |               2 |

<!-- adoption-manifest:maturity:end -->
