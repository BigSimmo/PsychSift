"use client";

import { Check, ChevronDown, Funnel, Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";

import { usePhoneMedia } from "@/components/compare/use-phone-media";
import { Sheet } from "@/components/ui/sheet";
import { ChoiceChip } from "@/components/ui/chip";
import { OverlayPortal } from "@/components/ui/overlay-root";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { useDismissableLayer } from "@/components/use-dismissable-layer";
import { cn, searchShell } from "@/components/ui-primitives";

/**
 * The phone filter idiom, shared.
 *
 * Every search mode used to hand the ribbon a `w-full` native `<select>` on
 * phones. That control cost a mode its whole second band line, could not show
 * more than one filter dimension without a two-column grid of selects, could not
 * report how many filters were active without spending label width on it, and —
 * because `globals.css` pins every native select to 16px below `sm` to stop iOS
 * zooming on focus — rendered its value at the same size as the query heading it
 * sat under. Documents replaced it with a badged trigger that opens a sheet, the
 * band collapsed to one line, and that is the design every mode now uses.
 *
 * Two pieces:
 * - `ResultFilterTrigger` — the compact badged control that goes in the ribbon's
 *   `mobileControls` slot (with `mobileControlsPlacement="inline"`, which is what
 *   makes the one-line band legal — see `search-results-header-band.tsx`).
 * - `ResultFilterSheet` — the shared sheet for every mode's filters, lens and
 *   facet alike. Below the density threshold (`docs/filter-contract.md` §5) a
 *   facet group is a plain chip row; above it, the sheet grows a find-a-filter
 *   field and collapse-by-default per group. Typed scope, coverage, summary and
 *   secondary-action props describe the non-group anatomy without arbitrary
 *   caller-owned markup.
 *
 * Desktop is untouched. The ribbon renders `filterControls` from `sm` up and
 * `mobileControls` below it, never both, so each mode keeps the chip row or tab
 * strip it already had on a wide screen.
 */

export type ResultFilterOption<Value extends string> = {
  value: Value;
  label: string;
  /** Trailing detail — a count, a qualifier. Never the only thing distinguishing two options. */
  hint?: string;
  /** Short display form of `hint`. The announced name keeps `hint`'s units
      ("1 loaded source"); the visible column shows only `hintLabel` ("1"). A
      count phrased in full is wide enough that four options wrap one per line,
      which is what pushed documents' governance groups into a ragged column.
      Omit to display `hint` verbatim. */
  hintLabel?: string;
  /** Canonical text used to find an abbreviated display label. */
  searchText?: string;
  /** Renders as a dead end: focusable and explained, but not selectable. */
  disabled?: boolean;
};

export type ResultFilterOptionSection = {
  id: string;
  label: string;
  description?: string;
  optionValues: ReadonlyArray<string>;
};

/**
 * A dimension the sheet can render, discriminated by what it MEANS rather than
 * by how it should look.
 *
 * `lens` — one-of-N. The options partition the result set and exactly one is
 * active: differentials' All/Presentations/Diagnoses or medication match
 * quality. This is the shape every call site uses today, so it is the default
 * and `kind` may be omitted.
 *
 * `facet` — many-of-N, OR within the group and AND across groups. Formulation's
 * domains and the documents tag groups are facets; rendering them as radios (as
 * formulation does today) claims a reader cannot hold two domains at once,
 * which is false.
 *
 * There is deliberately no `navigate` kind. Options that replace the query
 * rather than narrowing the result set do not belong in a control called
 * "Filter" — see `docs/filter-contract.md`.
 */
export type ResultFilterGroupKind = "lens" | "facet";

type ResultFilterGroupBase = {
  /** Stable within one sheet; used for the group's own labelling ids. */
  id: string;
  label: string;
  /** Optional clinical context rendered below the group heading. */
  description?: string;
  options: ReadonlyArray<ResultFilterOption<string>>;
  /** Visual grouping only. It never changes the group's lens/facet predicate. */
  optionSections?: ReadonlyArray<ResultFilterOptionSection>;
};

export type ResultFilterLensGroup = ResultFilterGroupBase & {
  kind?: "lens";
  value: string;
  onChange: (value: string) => void;
  /** Short annotation beside the group's heading — e.g. "one only". For a lens
      sitting directly beside facet groups in the same sheet, both render as
      chips of near-identical size and colour, so the OR-within/AND-across
      facet model and the lens's own exclusivity have to be told apart by more
      than role alone. Omit for a sheet with no facet groups; the roving
      radiogroup already says "one active" on its own there. */
  note?: string;
};

export type ResultFilterFacetGroup = ResultFilterGroupBase & {
  kind: "facet";
  /** Selected option values. Empty means the group imposes no constraint. */
  selected: ReadonlySet<string>;
  onToggle: (value: string) => void;
};

export type ResultFilterGroup = ResultFilterLensGroup | ResultFilterFacetGroup;

export function isFacetGroup(group: ResultFilterGroup): group is ResultFilterFacetGroup {
  return group.kind === "facet";
}

/**
 * Builds a type-checked group for `ResultFilterSheet`.
 *
 * The sheet holds groups of different value unions in one array, which no single
 * generic parameter can express. This narrows at the call site — `value`,
 * `options[].value` and `onChange` are checked against one `Value` — and erases
 * once. The erasure is sound because the sheet only ever invokes `onChange` with
 * a value taken from that same group's `options`, so nothing outside `Value` can
 * reach the callback.
 */
export function resultFilterGroup<Value extends string>(group: {
  id: string;
  label: string;
  description?: string;
  value: Value;
  options: ReadonlyArray<ResultFilterOption<Value>>;
  onChange: (value: Value) => void;
  note?: string;
  optionSections?: ReadonlyArray<ResultFilterOptionSection>;
}): ResultFilterGroup {
  return {
    kind: "lens",
    id: group.id,
    label: group.label,
    description: group.description,
    value: group.value,
    options: group.options,
    note: group.note,
    optionSections: group.optionSections,
    // The one narrowing, isolated here rather than repeated at seven call sites.
    onChange: (value) => group.onChange(value as Value),
  };
}

/**
 * Builds a type-checked multi-select facet group.
 *
 * Same erasure argument as `resultFilterGroup`: `selected`, `options[].value`
 * and `onToggle` are checked against one `Value` at the call site and widen to
 * `string` once, and the sheet only ever passes back a value taken from this
 * group's own options.
 *
 * Counts belong in `option.hint` and must be produced by the same predicate as
 * the filter — "how many would I have if I ticked this as well" — because under
 * OR-within-group, adding to an already-selected group *widens*. The companion
 * rule is that the option list is derived from the data rather than declared,
 * which is what stops a permanently empty option ever reaching this function.
 * Both rules and the reasoning are in `docs/filter-contract.md`.
 */
export function resultFilterFacetGroup<Value extends string>(group: {
  id: string;
  label: string;
  description?: string;
  selected: ReadonlySet<Value>;
  options: ReadonlyArray<ResultFilterOption<Value>>;
  onToggle: (value: Value) => void;
  optionSections?: ReadonlyArray<ResultFilterOptionSection>;
  // Returns the narrow facet type, not the union: a mode hands the same group
  // to `ResultFilterSheet` (which takes the union) and to
  // `ResultFilterFacetChips` for its desktop rail (which does not).
}): ResultFilterFacetGroup {
  return {
    kind: "facet",
    id: group.id,
    label: group.label,
    description: group.description,
    selected: group.selected as ReadonlySet<string>,
    options: group.options,
    optionSections: group.optionSections,
    onToggle: (value) => group.onToggle(value as Value),
  };
}

/**
 * Opens a filter panel and reports how many filters are active.
 *
 * Faithfully the control documents shipped, lifted here so seven modes cannot
 * drift apart. Written out rather than composed from `floatingControl`: this is
 * the band's own control recipe — the same one `Save search` and `Retry` use — so
 * a trigger sitting flush against the sort group is structurally the same
 * component rather than a near-match.
 */
export function ResultFilterTrigger({
  panelId,
  testId,
  open,
  activeCount,
  onToggle,
  title,
  label = "Filter",
  labelVisibility = "responsive",
  ref,
}: {
  panelId: string;
  /** Distinct per slot when a page renders the trigger more than once: both
      copies are in the DOM, so a shared id makes every `getByTestId` lookup
      ambiguous under Playwright strict mode even though only one is displayed. */
  testId: string;
  open: boolean;
  activeCount: number;
  /** Receives the click, so a caller rendering two triggers can tell which one
      opened the panel and return focus to it on close. */
  onToggle: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  /** Pointer tooltip, e.g. "Filter services". The accessible name comes from the
      visible label plus the state note below, so this is decoration. */
  title: string;
  /** A node rather than a string so a page can supply contextual wording. */
  label?: ReactNode;
  /** Preserve the default compact-band behaviour unless a page has deliberately
      budgeted room for the visible wordmark at every supported width. */
  labelVisibility?: "responsive" | "always";
  /** Anchor for the tablet/desktop panel. Pass the same ref to
      `ResultFilterSheet`'s `anchorRef` to open the filters under this control
      instead of in the full-height right rail. */
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-controls={open ? panelId : undefined}
      data-testid={testId}
      title={title}
      className={cn(
        // 10px leading, 11px trailing. Symmetric padding measures right and looks
        // wrong here: a filled pill reads flush to its own edge while a stroked
        // funnel reads inset from its box, so equal values put the badge visibly
        // closer to the border than the glyph is.
        "search-band-ghost inline-flex min-h-tap min-w-tap shrink-0 items-center justify-center gap-1.5 rounded-lg border pl-2.5 pr-[0.6875rem] transition-colors motion-reduce:transition-none sm:min-h-compact-meta sm:min-w-compact-meta",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
        // Mutually exclusive branches rather than a base plus an override. `cn`
        // merges now, so a later utility would win deterministically — but
        // collapsing these changes which classes render at all, and that is a
        // visual change rather than a dependency swap.
        activeCount > 0
          ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] hover:border-[color:var(--clinical-accent)]"
          : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)]",
      )}
    >
      <Funnel aria-hidden="true" className="size-icon-md shrink-0" />
      {/* The label is the first thing to go when the line is tight — but only
          where the line is actually tight. Below 414px the band gives the
          utilities their own row, and on that row there is room for the wordmark
          several times over. 414–429px is the one band that is genuinely
          single-line and short of width; there a funnel carrying a badge is
          unambiguous. The accessible name is unchanged at every width. */}
      <span
        className={cn(labelVisibility === "responsive" && "min-filter-label-collapse:max-filter-label-restore:sr-only")}
      >
        {label}
      </span>
      {activeCount > 0 ? (
        // A tinted pill, not a solid disc: a saturated filled circle is the single
        // loudest signal on a bar that is otherwise hairlines and type, and it
        // reads as an alert rather than as a count.
        <span className="search-band-badge nums grid h-search-band-badge min-w-search-band-badge place-items-center rounded-full bg-[color:var(--search-band-badge-bg)] px-1 text-2xs font-bold text-[color:var(--clinical-accent)]">
          {activeCount}
        </span>
      ) : null}
      <span className="sr-only">
        {activeCount > 0 ? `${activeCount} filter${activeCount === 1 ? "" : "s"} active` : "No filters active"}
      </span>
    </button>
  );
}

/**
 * A single radio group inside the filter sheet.
 *
 * Implements the roving-tabIndex pattern (Arrow keys + Home/End, single tab
 * stop) so the group behaves like a real radio group for keyboard users —
 * consistent with `SegmentedControl` and matching the `role="radiogroup"` it
 * exposes to AT. Announcing "radio, 1 of 4" and then not answering an arrow key
 * would be worse than exposing no role at all, because the role is what promises
 * the interaction.
 *
 * Arrow keys select as they move, which is the ARIA default and also what the
 * native `<select>` this replaced already did on desktop. Live catalogue
 * lenses therefore commit as focus moves, while staged panels keep their
 * changes in draft state until the primary action runs.
 *
 * A dead-end option stays on the arrow path but is never selected by it. That is
 * the ARIA guidance for a disabled radio, and it is the only arrangement that
 * satisfies both halves of the problem: a keyboard reader can reach the option
 * and hear its "Not selectable from here" note, while the group keeps the single
 * tab stop the radio contract requires. Giving dead ends `tabIndex={0}` instead
 * would make them reachable — and would add a second, third and fourth tab stop
 * to a control whose whole point is having one.
 *
 * `deadEnd` is `disabled && !selected`. These options remain reachable for an
 * explanation while the selected zero-result value stays removable through
 * the applied shelf. DOM coverage keeps that distinction explicit.
 */
function FilterRadioGroup({ group, panelId }: { group: ResultFilterLensGroup; panelId: string }) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const groupLabelId = `${panelId}-${group.id}-label`;

  const isDeadEnd = (option: ResultFilterOption<string>) => Boolean(option.disabled) && option.value !== group.value;
  // Every option is on the arrow path, dead ends included — moving to one is how
  // its explanation gets announced. Only *selection* is withheld.
  const selectable = group.options.filter((option) => !isDeadEnd(option));
  // The roving tab stop is the selected option; fall back to the first
  // selectable one when the value matches no option (a stale URL param, or a
  // catalogue that dropped a category between renders).
  const tabStopValue = selectable.some((o) => o.value === group.value) ? group.value : selectable[0]?.value;
  // Derived, never declared — see docs/filter-contract.md section 5. A lens
  // whose options all carry a count is a segmented bar: a counted chip is wide
  // enough that four of them wrap one per line and leave most of each row
  // empty, and `ChoiceChip`'s own contract sends one-of-many choices to
  // `SegmentedControl`. One condition bounds it.
  //
  // Five options, because that is where section 5's chip tier ends. A segmented
  // bar is one control read left to right; past five it wraps into rows and
  // stops reading as one, which is the ragged shape this rule exists to remove.
  //
  // Dead ends do NOT veto it. They used to, and that was wrong: documents'
  // Source locality marks an option dead when its count reaches zero, so a
  // state-dependent veto made the control morph from a segmented bar into a
  // chip row mid-interaction. `SegmentedControl` now keeps a dead end focusable
  // and explained itself, exactly as the chip renderer does, so the shape of the
  // option list decides the renderer and nothing about the reader's current
  // selection can change it.
  const everyOptionCounted = group.options.length > 0 && group.options.every((option) => Boolean(option.hint));
  const useSegmented = everyOptionCounted && group.options.length <= 5;

  const moveTo = useCallback(
    (next: ResultFilterOption<string> | undefined) => {
      if (!next) return;
      // Focus always moves; selection only follows for an option that can hold
      // it. Arrowing onto a dead end must not silently commit the option before
      // it, and must not leave focus behind either.
      refs.current.get(next.value)?.focus();
      if (Boolean(next.disabled) && next.value !== group.value) return;
      group.onChange(next.value);
    },
    [group],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const options = group.options;
      if (!options.length) return;
      const currentValue = (event.target as HTMLElement).dataset.radioValue;
      const current = Math.max(
        options.findIndex((o) => o.value === currentValue),
        0,
      );
      let next: number | null = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % options.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
        next = (current - 1 + options.length) % options.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = options.length - 1;
      if (next == null) return;
      // The sheet scrolls and the chips wrap, so without this Arrow/Home/End
      // would also scroll the panel out from under the option being moved to.
      event.preventDefault();
      moveTo(options[next]);
    },
    [group.options, moveTo],
  );

  return (
    <section className="min-w-0 border-t border-[color:var(--border)] py-1 first:border-t-0">
      <h3 className="flex min-h-compact-meta items-center gap-1.5 text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
        {/* DS-P2-24: compact-meta heading row, not a tap target. The id is on the label text alone, not the heading — same fix as
            ResultFilterFacetChips' own badge: with the id on the h3 itself, a
            sibling `note` would concatenate into the group's accessible name
            ("Source type" -> "Source type one only"). */}
        <span id={groupLabelId}>{group.label}</span>
        {group.note ? <span className="ml-auto text-[color:var(--clinical-accent)]">{group.note}</span> : null}
      </h3>
      {group.description ? (
        <p className="-mt-0.5 mb-2 text-xs font-medium leading-5 text-[color:var(--text-muted)]">{group.description}</p>
      ) : null}
      {useSegmented ? (
        <div className="min-w-0 pb-2.5">
          <SegmentedControl
            ariaLabelledBy={groupLabelId}
            value={group.value}
            onChange={group.onChange}
            options={group.options.map((option): SegmentedControlOption<string> => ({
              value: option.value,
              label: option.label,
              // Both halves of the count. `hint` carries the unit and builds
              // the accessible name; `hintLabel` is the short visible form.
              // Documents' Source locality needs exactly this — "1 loaded
              // source" announced, "1" displayed — and before the control took
              // the second field, a lens whose counts carry a unit had to stay
              // on chips.
              hint: option.hint,
              hintLabel: option.hintLabel,
              // `deadEnd`, not `disabled`: an option the reader's own narrowing
              // emptied stays on the arrow path and explains itself, where
              // `disabled` would skip it entirely.
              deadEnd: isDeadEnd(option),
            }))}
            // Not `equal`: that stretches every segment to the same width with
            // `whitespace-nowrap` and truncates. "All priorities" and
            // "Investigations" share a four-option row, which at 390px leaves
            // roughly 97px a segment and cuts both labels. `fit` wraps instead.
            layout="fit"
          />
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-labelledby={groupLabelId}
          onKeyDown={onKeyDown}
          className="flex flex-wrap gap-2 pb-2.5 sm:gap-1.5"
        >
          {group.options.map((option) => {
            const selected = option.value === group.value;
            const deadEnd = Boolean(option.disabled) && !selected;
            const deadEndDescId = `${panelId}-${group.id}-${option.value.replace(/[^A-Za-z0-9_-]/g, "-")}-note`;
            return (
              <button
                key={option.value}
                ref={(node) => {
                  if (node) refs.current.set(option.value, node);
                  else refs.current.delete(option.value);
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                // Without this the label and hint spans concatenate to "All8" in
                // the accessible name — the name computation normalises the
                // inter-element whitespace away, so a text-node separator cannot
                // fix it. Same defect and same fix as SegmentedControl, which is
                // what lets one shared option array announce identically on the
                // desktop rail and in this sheet.
                aria-label={option.hint ? `${option.label} (${option.hint})` : undefined}
                // `aria-disabled` rather than `disabled`: a real disabled
                // button leaves the tab order, so a keyboard or screen-reader
                // user loses the option entirely and never learns why. Kept
                // focusable and explained, with the click guarded instead —
                // the disabled-affordance pattern in docs/wiring-conventions.md.
                aria-disabled={deadEnd || undefined}
                aria-describedby={deadEnd ? deadEndDescId : undefined}
                // One tab stop for the whole group — the radio contract. Without it
                // a reader Tabs through every option of every dimension to reach
                // Done. A dead end is never `tabStopValue` (it is filtered out of
                // `selectable`, which is where that value comes from), so it always
                // lands on -1 here; see the note on this component about the
                // announcement that costs.
                tabIndex={option.value === tabStopValue ? 0 : -1}
                data-radio-value={option.value}
                onClick={() => {
                  if (deadEnd) return;
                  group.onChange(option.value);
                }}
                className={cn(
                  // DS-P2-24: filter chips are compact-meta (40px) from `sm`, not a
                  // primary CTA. Phone stays min-h-tap. Never min-h-11 / min-h-9.
                  "inline-flex min-h-tap max-w-full items-center gap-1.5 rounded-md border px-2.5 text-2xs font-semibold shadow-[var(--shadow-inset)] transition motion-reduce:transition-none sm:min-h-compact-meta sm:gap-1 sm:px-2",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                  selected
                    ? "border-[color:var(--clinical-accent)]/35 bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                    : deadEnd
                      ? // Not `opacity-50`. Transparency multiplies against an
                        // already-muted foreground; a real muted pair plus a
                        // dashed border reads as a different KIND of thing
                        // rather than a faded one, and survives forced colors,
                        // where border-style is preserved and opacity is not.
                        "cursor-default border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]"
                      : "border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)]",
                )}
              >
                {selected ? <Check aria-hidden="true" className="h-3 w-3 shrink-0" /> : null}
                <span className="truncate">{option.label}</span>
                {option.hint ? (
                  <span className="nums text-[color:var(--text-muted)]">{option.hintLabel ?? option.hint}</span>
                ) : null}
                {deadEnd ? (
                  <span id={deadEndDescId} className="sr-only">
                    Not selectable from here.
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * A multi-select facet group, exported so a mode renders the SAME control in
 * its desktop rail as in its phone sheet.
 *
 * The lens modes converge on `SegmentedControl` at both breakpoints; facets had
 * no such primitive, and the alternative was a second hand-rolled chip row per
 * mode — which is exactly how the breakpoints came to disagree in the first
 * place. `idPrefix` scopes the labelling ids, so the two copies can coexist in
 * one page without colliding.
 *
 * Deliberately NOT a radio group. `aria-pressed` toggles inside a
 * `role="group"` are the honest reading of many-of-N: each control is
 * independently on or off, and nothing claims the options are mutually
 * exclusive. That also means no roving tabindex — a reader must be able to
 * reach every toggle, and arrow-to-select would commit constraints they did not
 * ask for. The single tab stop the lens groups use is correct there precisely
 * because arrowing *replaces* rather than accumulates.
 *
 * A zero-count option is a dead end: still focusable and explained, never
 * silently dropped, because a reader who has just narrowed to nothing needs to
 * see which of their choices did it. Under the derived-option-list rule such an
 * option can only appear as a consequence of the current selection, never as a
 * permanent fixture of the catalogue.
 */
/**
 * Present only when the sheet is dense (see `ResultFilterSheet`) and the
 * reader is not mid-search: the group becomes a disclosure, collapsed unless
 * it holds a selection or has been explicitly opened. A live needle owns
 * openness instead (every matched group is forced open) — see
 * `ResultFilterSheet` for why a control that never gets to act is worse than
 * none at all.
 */
type FacetGroupDisclosure = { open: boolean; onToggle: () => void; contentId: string };

export function ResultFilterFacetChips({
  group,
  idPrefix,
  options,
  disclosure,
}: {
  group: ResultFilterFacetGroup;
  idPrefix: string;
  /** Needle-filtered subset; defaults to every option in the group. */
  options?: ReadonlyArray<ResultFilterOption<string>>;
  disclosure?: FacetGroupDisclosure;
}) {
  const panelId = idPrefix;
  const groupLabelId = `${panelId}-${group.id}-label`;
  const visibleOptions = options ?? group.options;
  const isDenseList =
    !group.optionSections &&
    ((group.options.length >= 6 && group.options.length <= 20) ||
      (visibleOptions.length >= 6 && visibleOptions.length <= 20));
  // Counted groups of two to five options sit below the six-option dense
  // threshold, so they used to render as wrapping chips. A chip carrying a
  // count is wide enough that four of them wrap one per line and leave a ragged
  // right edge with most of the row empty — documents' Source status and
  // Clinical validation are exactly that shape. The dense row renderer in two
  // columns packs the same options into half the height with an aligned count
  // column. A group with no counts keeps the chip row, which is still the right
  // renderer for short bare labels.
  const isCountedCompact =
    !group.optionSections &&
    visibleOptions.length >= 2 &&
    visibleOptions.length <= 5 &&
    visibleOptions.some((option) => Boolean(option.hint));
  const usesRowRenderer = isDenseList || isCountedCompact;

  const renderOptions = (items: ReadonlyArray<ResultFilterOption<string>>, isDense: boolean = usesRowRenderer) =>
    items.map((option) => {
      const selected = group.selected.has(option.value);
      const deadEnd = Boolean(option.disabled) && !selected;
      const deadEndDescId = `${panelId}-${group.id}-${option.value.replace(/[^A-Za-z0-9_-]/g, "-")}-note`;
      return (
        <ChoiceChip
          key={option.value}
          pressed={selected}
          onPressedChange={() => group.onToggle(option.value)}
          size="compact"
          ariaDisabled={deadEnd || undefined}
          ariaDescribedBy={deadEnd ? deadEndDescId : undefined}
          ariaLabel={option.hint ? `${option.label} (${option.hint})` : undefined}
          className={cn(
            isDense ? "w-full min-w-0 justify-between gap-2.5 py-2 text-left sm:py-1.5" : "gap-1.5 sm:gap-1",
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className={cn(
                "grid size-icon-sm shrink-0 place-items-center rounded-xs border transition-colors",
                selected
                  ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--surface)]"
                  : "border-[color:var(--border-strong)] bg-[color:var(--surface)]",
              )}
            >
              {selected ? <Check aria-hidden="true" className="h-2.5 w-2.5" strokeWidth={3.5} /> : null}
            </span>
            <span className="truncate">{option.label}</span>
          </div>
          {option.hint ? (
            <span className="nums shrink-0 text-right text-2xs font-semibold tabular-nums text-[color:var(--text-muted)]">
              {option.hintLabel ?? option.hint}
            </span>
          ) : null}
          {deadEnd ? (
            <span id={deadEndDescId} className="sr-only">
              No matches with your current filters.
            </span>
          ) : null}
        </ChoiceChip>
      );
    });

  return (
    <section className="min-w-0 border-t border-[color:var(--border)] py-1 first:border-t-0">
      <h3 className="flex min-h-compact-meta items-center gap-1.5 text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
        {/* DS-P2-24: compact-meta heading row. The id is on the label text alone, not the heading. With the badge
            inside the labelled element the group's accessible name became
            "Domain 1" — the selection count leaking into the dimension's name,
            and changing it on every toggle. Caught by the DOM test. */}
        {disclosure ? (
          <button
            type="button"
            aria-expanded={disclosure.open}
            aria-controls={disclosure.contentId}
            onClick={disclosure.onToggle}
            className={cn(
              "flex min-h-tap w-full items-center gap-1.5 text-left text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)] sm:min-h-compact-meta",
              "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus)]",
            )}
          >
            <span id={groupLabelId} className="truncate">
              {group.label}
            </span>
            {group.selected.size > 0 ? (
              <span className="nums ml-auto text-2xs font-semibold text-[color:var(--clinical-accent)]">
                {group.selected.size} selected
              </span>
            ) : null}
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-icon-sm shrink-0 text-[color:var(--decoration-soft)] transition-transform motion-reduce:transition-none",
                group.selected.size > 0 ? "ml-1.5" : "ml-auto",
                disclosure.open ? "rotate-0" : "-rotate-90",
              )}
            />
          </button>
        ) : (
          <>
            <span id={groupLabelId}>{group.label}</span>
            {group.selected.size > 0 ? (
              <span className="nums rounded-full bg-[color:var(--clinical-accent-soft)] px-1.5 text-3xs font-black tabular-nums text-[color:var(--clinical-accent)]">
                <span className="sr-only">{group.selected.size} selected</span>
                <span aria-hidden>{group.selected.size}</span>
              </span>
            ) : null}
          </>
        )}
      </h3>
      {group.description ? (
        <p className="-mt-0.5 mb-2 text-xs font-medium leading-5 text-[color:var(--text-muted)]">{group.description}</p>
      ) : null}
      <div
        id={disclosure?.contentId}
        hidden={disclosure ? !disclosure.open : false}
        role="group"
        aria-labelledby={groupLabelId}
        className={cn(
          "pb-2.5",
          group.optionSections
            ? "grid gap-3"
            : isDenseList
              ? "grid gap-1"
              : isCountedCompact
                ? // Two-up only once a column can actually hold a label. At
                  // 320px each column's inner width is ~117px, which truncates
                  // "Locally reviewed"; the narrowest phones keep one column.
                  "grid grid-cols-1 gap-1.5 min-[380px]:grid-cols-2"
                : "flex flex-wrap gap-2 sm:gap-1.5",
        )}
      >
        {group.optionSections
          ? group.optionSections.map((section) => {
              const sectionOptions = visibleOptions.filter((option) => section.optionValues.includes(option.value));
              if (sectionOptions.length === 0) return null;
              const sectionDense =
                (section.optionValues.length >= 6 && section.optionValues.length <= 20) ||
                (sectionOptions.length >= 6 && sectionOptions.length <= 20);
              return (
                <section key={section.id} className="grid gap-1.5 rounded-lg bg-[color:var(--surface-subtle)] p-2.5">
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-[color:var(--text-heading)]">{section.label}</h4>
                    {section.description ? (
                      <p className="mt-0.5 text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
                        {section.description}
                      </p>
                    ) : null}
                  </div>
                  <div className={cn(sectionDense ? "grid gap-1" : "flex flex-wrap gap-2 sm:gap-1.5")}>
                    {renderOptions(sectionOptions, sectionDense)}
                  </div>
                </section>
              );
            })
          : renderOptions(visibleOptions, usesRowRenderer)}
      </div>
    </section>
  );
}

export type ResultFilterScopeOption<Value extends string = string> = {
  value: Value;
  label: string;
  count: number;
  description?: string;
};

export type ResultFilterScopeConfig = {
  label?: string;
  value: string;
  options: ReadonlyArray<ResultFilterScopeOption>;
  onChange: (value: string) => void;
};

/**
 * A compact, count-bearing scope choice for a catalogue that can widen beyond
 * the current query. It is deliberately not a generic toggle: the legend names
 * the dimension, native radios provide keyboard behaviour, and each choice
 * explains the result universe it will use.
 */
export function ResultFilterScopeSelector<Value extends string>({
  id,
  label = "Search in",
  value,
  options,
  onChange,
}: {
  id: string;
  label?: string;
  value: Value;
  options: ReadonlyArray<ResultFilterScopeOption<Value>>;
  onChange: (value: Value) => void;
}) {
  return (
    <fieldset className="min-w-0 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-2.5">
      <legend className="px-1 text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
        {label}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const descriptionId = option.description
            ? `${id}-scope-${option.value.replace(/[^A-Za-z0-9_-]/g, "-")}-description`
            : undefined;
          return (
            <label key={option.value} className="relative min-w-0 cursor-pointer">
              <input
                type="radio"
                name={`${id}-scope`}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                aria-label={`${option.label}, ${option.count.toLocaleString()} ${option.count === 1 ? "match" : "matches"}`}
                aria-describedby={descriptionId}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "flex min-h-tap min-w-0 items-center gap-2 rounded-lg border bg-[color:var(--surface-raised)] px-3 py-2 shadow-[var(--shadow-inset)] transition motion-reduce:transition-none sm:min-h-compact-meta",
                  "border-[color:var(--border-lux)] text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)]",
                  "peer-checked:border-[color:var(--clinical-accent-border)] peer-checked:bg-[color:var(--clinical-accent-soft)] peer-checked:text-[color:var(--clinical-accent)]",
                  "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--focus)]",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-icon-sm shrink-0 place-items-center rounded-full border border-[color:var(--border-strong)] bg-[color:var(--surface)]",
                    value === option.value &&
                      "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--surface)]",
                  )}
                >
                  {value === option.value ? (
                    <Check aria-hidden="true" className="h-2.5 w-2.5" strokeWidth={3.5} />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-[color:var(--text-heading)]">
                    {option.label}
                  </span>
                  {option.description ? (
                    <span
                      id={descriptionId}
                      className="mt-0.5 block text-2xs font-medium leading-4 text-[color:var(--text-muted)]"
                    >
                      {option.description}
                    </span>
                  ) : null}
                </span>
                <span className="nums shrink-0 text-xs font-bold tabular-nums">{option.count.toLocaleString()}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export type ResultFilterSummary = {
  count: number;
  noun: string;
  totalCount?: number;
};

export type ResultFilterSecondaryAction = {
  label: string;
  count?: number;
  onClick: () => void;
};

/**
 * The tablet/desktop presentation: a content-sized panel anchored under the
 * trigger, instead of the full-height right rail `Sheet` draws from `sm` up.
 *
 * Why not `Sheet`. `placement="responsive-right"` becomes a 32rem rail spanning
 * the whole viewport height, which is right for a mode carrying six facet
 * groups and wrong for one carrying two. Differentials put two short groups in
 * it and left most of the panel empty; a 768px tablet gave that rail two thirds
 * of the screen. A filter is a refinement of the list behind it, so it should
 * sit next to its own control and be no taller than its content.
 *
 * Why non-modal. The rail is a modal dialog: focus trapped, background inert,
 * scrim over the results. But the thing a reader is filtering is the list they
 * can no longer see or reach. `useDismissableLayer` gives outside-pointerdown
 * and Escape without any of that, and its focus restore deliberately declines
 * to steal focus back if the reader has already moved it.
 *
 * This adds no new stacking layer — `--z-popover` already exists and
 * `source-preview-popover.tsx` already sits on it, which is what `globals.css`
 * asks for when it says new overlays go through `sheet.tsx` rather than a new
 * layer. It is deliberately not a `ui/` primitive either: it exists to serve
 * this one surface, and a general anchored-popover primitive is a much larger
 * contract than the filter needs.
 *
 * The phone keeps the `Sheet`. Its modal focus trap is load-bearing — see
 * `tests/ui-accessibility.spec.ts`, which proves the roving radiogroup under a
 * real trap because jsdom cannot. It also means 400% zoom is handled for free:
 * that reduces the viewport to roughly 320 CSS px, `usePhoneMedia()` matches,
 * and the bottom sheet is what renders. Do not "fix" that by widening the
 * media query.
 */
function ResultFilterAnchoredPanel({
  anchorRef,
  onClose,
  panelId,
  testId,
  title,
  description,
  headerActions,
  footer,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  panelId: string;
  testId: string;
  title: string;
  description?: string;
  headerActions?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = `${panelId}-title`;
  const [placement, setPlacement] = useState({ left: 0, top: 0, maxHeight: 0 });
  // Positioning needs the panel's own measured box, so the first paint would
  // otherwise flash at (0, 0) before the frame that places it. Same gate as
  // `Tooltip`: rendered and measurable, but not yet visible.
  const [positioned, setPositioned] = useState(false);

  const updatePlacement = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const anchorBox = anchor.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    const edge = 8;
    const gap = 6;
    const spaceBelow = window.innerHeight - anchorBox.bottom - gap - edge;
    const spaceAbove = anchorBox.top - gap - edge;
    // Flip only when below genuinely cannot hold the panel AND above is
    // roomier. Flipping on the first pixel of overflow makes the panel jump
    // sides while the reader is still scrolling.
    const flipAbove = spaceBelow < Math.min(panelBox.height, 240) && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, flipAbove ? spaceAbove : spaceBelow);
    const top = flipAbove
      ? Math.max(edge, anchorBox.top - gap - Math.min(panelBox.height, maxHeight))
      : anchorBox.bottom + gap;
    // Left-aligned to the trigger, because that is where the filter control
    // actually sits in the results band — its left edge is the one the reader's
    // eye is already on. Right-alignment is the fallback for a trigger far
    // enough right that left-aligning would overflow, and pinning to the
    // viewport edge is the last resort. Getting this order wrong is visible:
    // right-aligning first put the panel hard against the left edge, 187px away
    // from the control that opened it.
    let left = anchorBox.left;
    if (left + panelBox.width > window.innerWidth - edge) {
      left = Math.min(anchorBox.right - panelBox.width, window.innerWidth - edge - panelBox.width);
    }
    left = Math.max(edge, left);
    setPlacement({ left, top, maxHeight });
    setPositioned(true);
  }, [anchorRef]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updatePlacement);
    // Capture phase: the results list scrolls in its own container, not the
    // document, so a bubbling listener would never see it move.
    window.addEventListener("scroll", updatePlacement, true);
    window.addEventListener("resize", updatePlacement);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updatePlacement, true);
      window.removeEventListener("resize", updatePlacement);
    };
  }, [updatePlacement]);

  // Move focus in on open so a reader who opened this from the keyboard lands
  // inside it. The container itself, not the first control: the title and
  // description should be announced before the first option.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  const dismissRefs = useMemo(() => [panelRef, anchorRef], [anchorRef]);
  useDismissableLayer({ enabled: true, refs: dismissRefs, onDismiss: onClose, restoreFocusRef: anchorRef });

  return (
    <OverlayPortal layer="popover" name="result-filter">
      <div
        ref={panelRef}
        // Non-modal: no `aria-modal`, because the results behind stay readable
        // and reachable, which is the whole point of leaving the rail behind.
        role="dialog"
        aria-labelledby={titleId}
        id={panelId}
        data-testid={testId}
        tabIndex={-1}
        style={{ position: "fixed", left: placement.left, top: placement.top, maxHeight: placement.maxHeight }}
        className={cn(
          "pointer-events-auto flex w-[min(25rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] text-[color:var(--text)] shadow-[var(--e2)]",
          "motion-safe:animate-pop-in motion-reduce:animate-none",
          positioned ? "visible" : "invisible",
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-x-3 border-b border-[color:var(--border)] px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-[color:var(--text-heading)]">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-xs font-medium leading-5 text-[color:var(--text-muted)]">{description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close ${title.toLowerCase()}`}
              className={cn(
                "grid h-tap w-tap shrink-0 place-items-center rounded-lg text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] motion-reduce:transition-none sm:h-compact-meta sm:w-compact-meta",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
              )}
            >
              <X aria-hidden="true" className="size-icon-md" />
            </button>
          </div>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 polished-scroll">
          {children}
        </div>
        <div className="shrink-0 border-t border-[color:var(--border)] p-3">{footer}</div>
      </div>
    </OverlayPortal>
  );
}

/**
 * A single-choice filter sheet: one radio group per dimension, plus
 * many-of-N facet groups.
 *
 * `role="radiogroup"` with real radio semantics rather than the `aria-pressed`
 * toggles the desktop chip rows use, because these dimensions are genuinely
 * one-of-N — a reader who has selected "Presentations" cannot also be on
 * "Diagnoses", and a bank of independent pressed-states says they could.
 *
 * `Sheet` returns null when `open` is false (unmounted), so it holds no chrome
 * state of its own that could survive a new search. Selection lives in the page,
 * exactly where the desktop control already reads and writes it, which is what
 * keeps the two breakpoints in agreement.
 *
 * **Density.** More than three facet groups (docs/filter-contract.md section
 * 5 — the same threshold document-search-results.tsx already uses) adds a
 * find-a-filter field and collapses every facet group by default. Below that
 * threshold every group renders exactly as before this was added — no mode
 * with three or fewer facet groups (formulation has one) sees any change.
 * A group holding a selection opens itself; an explicit collapse beats that;
 * a live needle owns openness instead and forces every matched group open,
 * because a disclosure that cannot act while search is filtering its content
 * is worse than no disclosure at all. A selected option always survives the
 * needle — filtering it out would make an active constraint un-untoggleable
 * without first clearing the field.
 */
export function ResultFilterSheet({
  open,
  onClose,
  panelId,
  testId,
  title,
  description,
  groups,
  onClearAll,
  summary,
  scope,
  coverage,
  primaryActionLabel,
  onApply,
  secondaryAction,
  applicationMode = "live",
  /** Result-set identity for the dense-mode chrome below (the find-a-filter
      text and per-group collapse state). Changing it clears that chrome, so a
      new search or scope change cannot leave a stale needle filtering a list
      it no longer describes. Only meaningful once a sheet goes dense (more
      than three facet groups); a sheet that never does can omit it. */
  chromeResetKey = "",
  anchorRef,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  panelId: string;
  testId: string;
  title: string;
  description?: string;
  groups: ReadonlyArray<ResultFilterGroup>;
  /** Omit to hide the header's Clear. A control that advertises an action must
      perform one, so pass this only when something is actually clearable. */
  onClearAll?: () => void;
  summary?: ResultFilterSummary;
  scope?: ResultFilterScopeConfig;
  coverage?: { visibleCount: number; totalCount: number; label?: string };
  primaryActionLabel?: string;
  onApply?: () => void;
  secondaryAction?: ResultFilterSecondaryAction;
  applicationMode?: "live" | "staged";
  chromeResetKey?: string;
  /**
   * Anchor for the tablet/desktop presentation. Pass the same ref given to the
   * wide-screen `ResultFilterTrigger` and the filters open in a content-sized
   * panel beneath it rather than in the full-height right rail.
   *
   * Omit it and nothing changes: the rail is still what every other mode gets,
   * which is what keeps this additive.
   */
  anchorRef?: RefObject<HTMLElement | null>;
  /**
   * The control that opened the sheet, read when it closes. Focus returns here
   * even when the opening click did not focus the control (Safari), where the
   * previously focused element would be <body> (#M3XZV0). The caller must keep
   * this component mounted while closed: `Sheet` skips its restore when it
   * unmounts, so a sheet rendered only while open never returns focus.
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  // Hooks run unconditionally — the empty-groups early return happens below,
  // after every hook the render needs has already been declared.
  //
  // The presentation split is the one thing here that cannot be a media query:
  // anchoring needs the trigger's measured box, which only exists in JS. This
  // hook is `useSyncExternalStore` with a `false` server snapshot, and the
  // panel renders only while `open`, which starts false — so the first paint is
  // empty either way and there is no hydration mismatch to guard against.
  const isPhone = usePhoneMedia();
  const [chromeByKey, setChromeByKey] = useState<
    Record<
      string,
      {
        needle: string;
        expanded: ReadonlySet<string>;
        collapsed: ReadonlySet<string>;
      }
    >
  >({});
  // State is keyed by the caller's mode/query reset key, so a new key starts
  // with empty chrome synchronously without an effect-side setState.
  const chrome =
    chromeByKey[chromeResetKey] ??
    ({ needle: "", expanded: new Set<string>(), collapsed: new Set<string>() } satisfies {
      needle: string;
      expanded: ReadonlySet<string>;
      collapsed: ReadonlySet<string>;
    });
  const needle = chrome.needle;
  const expanded = chrome.expanded;
  const collapsed = chrome.collapsed;
  const setNeedle = (value: string) =>
    setChromeByKey((current) => ({
      ...current,
      [chromeResetKey]: { ...(current[chromeResetKey] ?? chrome), needle: value },
    }));
  const toggleGroupOpen = (groupId: string, isOpen: boolean) => {
    setChromeByKey((current) => {
      const currentChrome = current[chromeResetKey] ?? chrome;
      const nextExpanded = new Set(currentChrome.expanded);
      const nextCollapsed = new Set(currentChrome.collapsed);
      if (isOpen) {
        nextExpanded.delete(groupId);
        nextCollapsed.add(groupId);
      } else {
        nextExpanded.add(groupId);
        nextCollapsed.delete(groupId);
      }
      return {
        ...current,
        [chromeResetKey]: {
          needle: currentChrome.needle,
          expanded: nextExpanded,
          collapsed: nextCollapsed,
        },
      };
    });
  };

  // Only an OPEN sheet with nothing to show bails out. A closed one still
  // renders `<Sheet open={false}>`, which draws nothing but stays mounted, so a
  // caller that keeps this mounted gets focus returned on close (#M3XZV0).
  if (open && groups.length === 0 && !scope) return null;

  const facetGroups = groups.filter(isFacetGroup);
  const totalFacetOptions = facetGroups.reduce((total, group) => total + group.options.length, 0);
  const dense = facetGroups.length > 3 || totalFacetOptions > 20;
  const trimmedNeedle = needle.trim().toLowerCase();
  const activeNeedle = dense ? trimmedNeedle : "";
  const findFieldId = `${panelId}-find`;

  // Needle-filtered option lists per facet group, computed once so both the
  // render and the "N filters match" live region agree. A selected option
  // always survives — see the density note above.
  const facetOptionsById = new Map<string, ReadonlyArray<ResultFilterOption<string>> | undefined>();
  let matchedOptionCount = 0;
  let anyFacetGroupVisible = false;
  for (const group of groups) {
    if (!isFacetGroup(group)) continue;
    if (!activeNeedle) {
      facetOptionsById.set(group.id, undefined);
      anyFacetGroupVisible = true;
      continue;
    }
    const filtered = group.options.filter(
      (option) =>
        group.selected.has(option.value) ||
        option.label.toLowerCase().includes(activeNeedle) ||
        option.searchText?.toLowerCase().includes(activeNeedle) ||
        group.label.toLowerCase().includes(activeNeedle),
    );
    facetOptionsById.set(group.id, filtered);
    matchedOptionCount += filtered.length;
    if (filtered.length > 0) anyFacetGroupVisible = true;
  }

  const headerActionsNode = onClearAll ? (
    <button
      type="button"
      onClick={onClearAll}
      data-testid={`${testId}-clear`}
      className={cn(
        "search-band-ghost inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-2 text-2xs font-semibold text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)] sm:min-h-compact-meta",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
      )}
    >
      <X aria-hidden="true" className="h-3.5 w-3.5" />
      Clear filters
    </button>
  ) : null;

  const footerNode = (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span aria-live="polite" className="min-w-0 text-xs font-semibold text-[color:var(--text-muted)]">
          {summary
            ? `${summary.count.toLocaleString()} ${summary.noun}${
                summary.totalCount == null ? "" : ` of ${summary.totalCount.toLocaleString()}`
              }`
            : null}
          {applicationMode === "staged" ? <span className="sr-only">. Changes apply together.</span> : null}
        </span>
        <button
          type="button"
          onClick={onApply ?? onClose}
          data-testid={`${testId}-done`}
          className={cn(
            "inline-flex min-h-tap shrink-0 items-center justify-center rounded-lg border border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] px-4 text-xs font-semibold text-[color:var(--clinical-accent-contrast)] shadow-[var(--shadow-inset)] transition hover:bg-[color:var(--clinical-accent-hover)]",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
          )}
        >
          {primaryActionLabel ??
            (summary
              ? `View ${summary.count.toLocaleString()} ${summary.noun}`
              : applicationMode === "staged"
                ? "Apply filters"
                : "Done")}
        </button>
      </div>
      {secondaryAction ? (
        <button
          type="button"
          onClick={secondaryAction.onClick}
          className={cn(
            "flex min-h-tap w-full items-center justify-between gap-3 rounded-lg border-t border-[color:var(--border)] px-1 pt-2.5 text-left text-xs font-semibold text-[color:var(--clinical-accent)] hover:text-[color:var(--clinical-accent-hover)] sm:min-h-compact-meta",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
          )}
        >
          <span>{secondaryAction.label}</span>
          {secondaryAction.count == null ? null : (
            <span className="nums text-[color:var(--text-muted)]">{secondaryAction.count.toLocaleString()}</span>
          )}
        </button>
      ) : null}
    </div>
  );

  const bodyNode = (
    <div className="grid min-w-0 gap-1">
      {coverage ? (
        <div className="min-w-0 pb-2">
          <div
            role="progressbar"
            aria-label={coverage.label ?? "Visible results"}
            aria-valuemin={0}
            aria-valuemax={Math.max(coverage.totalCount, 0)}
            aria-valuenow={Math.min(coverage.visibleCount, Math.max(coverage.totalCount, 0))}
            className="h-1 w-full overflow-hidden rounded-full bg-[color:var(--surface-inset)]"
          >
            <span
              aria-hidden
              className="block h-full w-full origin-left rounded-full bg-[color:var(--clinical-accent)] transition-transform motion-reduce:transition-none"
              style={{
                transform: `scaleX(${
                  coverage.totalCount > 0
                    ? Math.min(100, Math.max(0, (coverage.visibleCount / coverage.totalCount) * 100)) / 100
                    : 0
                })`,
              }}
            />
          </div>
          <p className="nums mt-1 text-2xs font-medium text-[color:var(--text-muted)]">
            <span className="font-semibold text-[color:var(--text-heading)]">
              {coverage.visibleCount.toLocaleString()}
            </span>{" "}
            of {coverage.totalCount.toLocaleString()} retrieved matches visible
          </p>
        </div>
      ) : null}
      {scope ? (
        <div className="min-w-0 border-b border-[color:var(--border)] pb-3">
          <ResultFilterScopeSelector
            id={panelId}
            label={scope.label}
            value={scope.value}
            options={scope.options}
            onChange={scope.onChange}
          />
        </div>
      ) : null}
      {dense ? (
        <div className="min-w-0 pb-2.5">
          <label htmlFor={findFieldId} className="sr-only">
            Find a filter
          </label>
          <div className={cn(searchShell, "min-w-0 bg-[color:var(--surface)] px-2.5")}>
            <Search aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--decoration-soft)]" />
            <input
              id={findFieldId}
              type="search"
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
              placeholder="Find a filter…"
              data-testid={`${testId}-find`}
              className="search-shell-input min-h-tap min-w-0 flex-1 bg-transparent text-xs font-semibold text-[color:var(--text)] outline-none placeholder:font-medium placeholder:text-[color:var(--text-placeholder)] sm:min-h-compact-meta"
            />
            {needle ? (
              <button
                type="button"
                onClick={() => setNeedle("")}
                aria-label="Clear the filter search"
                className="grid min-h-tap min-w-tap place-items-center text-[color:var(--decoration-soft)] hover:text-[color:var(--text)] sm:min-h-compact-meta sm:min-w-compact-meta"
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <p aria-live="polite" className="sr-only">
            {activeNeedle
              ? `${matchedOptionCount} filter${matchedOptionCount === 1 ? "" : "s"} match "${needle.trim()}"`
              : ""}
          </p>
        </div>
      ) : null}
      {groups.map((group) => {
        if (!isFacetGroup(group)) {
          return <FilterRadioGroup key={group.id} group={group} panelId={panelId} />;
        }
        const filteredOptions = facetOptionsById.get(group.id);
        // A needle that matched nothing in this group hides it entirely,
        // matching document-search-results.tsx: a heading over zero options
        // is a section with nothing to disclose.
        if (activeNeedle && (filteredOptions?.length ?? 0) === 0) return null;
        // Keep auto-open behavior aligned with the badge, which counts every selected value.
        const selectedCount = group.selected.size;
        const isOpen =
          !dense ||
          Boolean(activeNeedle) ||
          (!collapsed.has(group.id) && (expanded.has(group.id) || selectedCount > 0));
        return (
          <ResultFilterFacetChips
            key={group.id}
            group={group}
            idPrefix={panelId}
            options={filteredOptions}
            disclosure={
              dense && !activeNeedle
                ? {
                    open: isOpen,
                    onToggle: () => toggleGroupOpen(group.id, isOpen),
                    contentId: `${panelId}-${group.id}-content`,
                  }
                : undefined
            }
          />
        );
      })}
      {activeNeedle && !anyFacetGroupVisible ? (
        <p className="border-t border-[color:var(--border)] py-4 text-center text-xs font-semibold text-[color:var(--text-muted)]">
          No filter matches &ldquo;{needle.trim()}&rdquo;.
        </p>
      ) : null}
    </div>
  );

  // A mode that names an anchor gets the tablet/desktop panel; every other
  // call site keeps the full-height rail it already had, unchanged.
  if (!isPhone && anchorRef) {
    // `Sheet` unmounts itself when closed and this does not, so the closed
    // state has to be handled here — otherwise the panel would keep its
    // scroll position and its listeners alive behind the results.
    if (!open) return null;
    return (
      <ResultFilterAnchoredPanel
        anchorRef={anchorRef}
        onClose={onClose}
        panelId={panelId}
        testId={testId}
        title={title}
        description={description}
        headerActions={headerActionsNode}
        footer={footerNode}
      >
        {bodyNode}
      </ResultFilterAnchoredPanel>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      dismissOnBack
      title={title}
      // Header density is driven from here rather than from `Sheet`, so every
      // filter surface tightens together while the app's other dialogs keep
      // their own header. Three stacked tiers — a text-lg title, a three-line
      // text-sm description and a bordered 48px close box — spent most of a
      // phone viewport before the first filter was reachable.
      descriptionContent={
        description ? (
          <p className="text-xs font-medium leading-5 text-[color:var(--text-muted)]">{description}</p>
        ) : undefined
      }
      headerClassName="items-start px-4 py-3 sm:px-5 sm:py-3.5"
      titleClassName="text-base sm:text-lg"
      // `Sheet` takes this INSTEAD of `toolbarButton` (`??`, not a merge), so
      // the tap target has to be restated. It stays h-tap/w-tap: 48px is this
      // repo's production floor and dropping to 44px reintroduces a known
      // ui-smoke flake. Only the border, fill and shadow are removed.
      closeButtonClassName={cn(
        "grid h-tap w-tap shrink-0 place-items-center rounded-lg text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] motion-reduce:transition-none",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
      )}
      portal
      placement="responsive-right"
      id={panelId}
      testId={testId}
      returnFocusRef={returnFocusRef}
      headerActions={headerActionsNode}
      footer={footerNode}
    >
      {bodyNode}
    </Sheet>
  );
}
