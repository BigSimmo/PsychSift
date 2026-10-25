"use client";

import { useMemo } from "react";
import {
  Check,
  CirclePlay,
  Clock,
  Copy,
  Info,
  Scale,
  Shield,
  Target,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { cardSurface } from "@/components/card-recipes";
import { PageHeader } from "@/components/ui/page-header";
import { cn, pageContainer, toneSuccess, toneWarning } from "@/components/ui-primitives";
import {
  CompareIdsChrome,
  compareSlotBadgeBase,
  compareSlotBadgeClass,
  slotLetters,
  type CompareCatalogItem,
  type CompareStarterChip,
} from "@/components/compare";
import { StatusMark, type DocumentStatus } from "@/components/ui/status-mark";
import { Button } from "@/components/ui/button";
import { missingValuePhrase } from "@/components/ui/missing-value";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Tabs } from "@/components/ui/tabs";
import { THERAPY_MAX_COMPARE, therapyScreenHref } from "@/lib/therapy-compass-navigation";

import { useTcBindings } from "../bindings";
import { needsReviewCount, parseSteps, shortestDelivery, summarise } from "../data/select";
import type { Therapy } from "../data/types";
import { useClipboard } from "../use-clipboard";

const CBT_SLUG = "cognitive-behavioural-therapy-cbt";
const ACT_SLUG = "acceptance-and-commitment-therapy-act";

/**
 * Every fallback below stands for a record that carries neither of the two fields the accessor
 * reads, so the phrase describes the record and not one field of it: nothing was recorded under
 * this heading. A dash could not say that, and in a clinical comparison table an empty-looking
 * cell reads as a negative finding rather than an absent one (SPEC §11).
 *
 * These accessors are typed `(t: Therapy) => string` because their output is diffed through a
 * `Set` for the Differences tab and exported to the clipboard by "Copy set", so the primitive's
 * string form is used rather than the component — same vocabulary, one source of wording.
 */
const NOT_RECORDED = missingValuePhrase("not_recorded");

/**
 * The round letter token, shared by the table header and the phone stack.
 *
 * Drawn from the same two exports the selection tile uses, at the same slot
 * index, so a column carries the exact token of the tile it was chosen in. The
 * letter is how a reader gets "the one I put in slot B" from the tiles into a
 * table column, and a near-miss copy of the token breaks that thread.
 */
function compareLetterPip(index: number, size = "h-6 w-6 text-2xs") {
  return cn(compareSlotBadgeBase, compareSlotBadgeClass(index), size);
}

type Row = {
  key: string;
  label: string;
  icon: LucideIcon;
  tone?: "warning";
  priority?: boolean;
  get: (t: Therapy) => string;
};

const ROWS: Row[] = [
  {
    key: "avoid",
    label: "When not to use",
    icon: TriangleAlert,
    tone: "warning",
    priority: true,
    // The whole caution, never its first sentence: in the shipped data the risk wording often
    // follows an assessment step, and this row (and the Copy set export) is read as the caution.
    get: (t) => t.contraindicationsOrCautions?.trim() || "Check source before use.",
  },
  {
    key: "fit",
    label: "Best fit",
    icon: Target,
    priority: true,
    get: (t) => t.bestUsedFor || t.targetSymptoms || NOT_RECORDED,
  },
  {
    key: "first",
    label: "What to do first",
    icon: CirclePlay,
    get: (t) => parseSteps(t.deliverySteps)[0] || summarise(t.mechanism, 1) || NOT_RECORDED,
  },
  { key: "time", label: "Time required", icon: Clock, get: (t) => t.timeRequired || t.sessionLength || NOT_RECORDED },
  { key: "setting", label: "Setting", icon: Shield, get: (t) => t.setting || t.patientPopulation || NOT_RECORDED },
  { key: "complexity", label: "Clinician skill / complexity", icon: Scale, get: (t) => t.complexity || NOT_RECORDED },
  {
    key: "evidence",
    label: "Evidence level",
    icon: Shield,
    tone: "warning",
    priority: true,
    get: (t) => t.evidenceLevel || (t.reviewStatus === "reviewed" ? "Reviewed" : "Source review required"),
  },
];

/**
 * Rows on which the compared therapies do not agree.
 *
 * One definition, two readers: the Differences tab filters by it, and the
 * decision summary counts it. They were separate expressions, so the tab could
 * show six rows while a summary said something else about the same set.
 */
function differingRows(items: readonly Therapy[]) {
  return ROWS.filter((row) => new Set(items.map((therapy) => row.get(therapy))).size > 1);
}

export function CompareScreen() {
  const b = useTcBindings();
  const items = b.compareTherapies;
  const { copied, copy } = useClipboard();
  const catalogItems: CompareCatalogItem[] = useMemo(
    () =>
      b.therapies.map((therapy) => ({
        id: therapy.slug,
        title: therapy.name,
        snippet: therapy.clinicalSummary ?? undefined,
        tag: therapy.category,
      })),
    [b.therapies],
  );
  const starterChips: CompareStarterChip[] = [
    {
      id: "cbt-act",
      label: "CBT vs ACT",
      href: b.workspaceHref(therapyScreenHref("compare"), { compareSlugs: [CBT_SLUG, ACT_SLUG] }),
    },
  ];

  const differing = useMemo(() => differingRows(items), [items]);

  const rows = useMemo(() => {
    if (b.cmpTab === "priorities") return ROWS.filter((r) => r.priority);
    if (b.cmpTab === "differences") return items.length < 2 ? ROWS : differing;
    return ROWS;
  }, [b.cmpTab, differing, items.length]);

  // Column letters are the same letters the selection tiles show, and the order
  // matches because `compareSlugs` is dense — a slot is never skipped, so the
  // nth compared therapy is always the nth letter.
  const letters = slotLetters(items.length);

  const copySet = () =>
    copy(
      [
        `Therapy comparison — ${items.map((t) => t.name).join(" vs ")}`,
        "",
        ...ROWS.map((r) => `${r.label}: ${items.map((t) => r.get(t)).join("  |  ")}`),
      ].join("\n"),
      "set",
    );

  const dense = b.density === "dense";

  return (
    <section data-screen-label="Compare" className={pageContainer}>
      <PageHeader
        className="mb-1.5"
        title="Therapy Comparison"
        description="Compare fit, cautions, delivery and evidence without losing source context."
        // The selection count moves from beside the title to `meta`, the slot
        // documented for exactly this. It was baseline-aligned with the `<h1>`,
        // which is not something `PageHeader` offers — and should not, since a
        // count that grows cannot share a line with a title that wraps.
        meta={
          <span className="text-sm-minus font-semibold text-[color:var(--clinical-accent-hover)] bg-[color:var(--clinical-accent-soft)] py-0.5 px-2.5 rounded-md">
            {items.length} of {THERAPY_MAX_COMPARE} selected
          </span>
        }
        actions={
          items.length >= 2 ? (
            <>
              <SegmentedControl
                label="Comparison density"
                value={b.density}
                onChange={(value) => (value === "dense" ? b.setDense() : b.setComfortable())}
                options={[
                  { value: "comfortable", label: "Comfortable" },
                  { value: "dense", label: "Dense" },
                ]}
                className="w-auto"
              />
              <Button
                variant="secondary"
                icon={copied === "set" ? Check : Copy}
                onClick={copySet}
                disabled={items.length < 2}
              >
                {copied === "set" ? "Copied" : "Copy set"}
              </Button>
              <Button variant="secondary" onClick={b.clearCompare} disabled={items.length === 0}>
                Clear
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={b.clearCompare} disabled={items.length === 0}>
              Clear
            </Button>
          )
        }
      />

      <CompareIdsChrome
        selectedIds={b.compareSlugs}
        maxCount={THERAPY_MAX_COMPARE}
        items={catalogItems}
        starters={starterChips}
        emptyTitle="Add therapies to compare"
        emptyDescription="Search the therapy catalogue, or start from CBT vs ACT. You can still add from search results or a therapy record."
        actionLabel="Add therapies"
        searchPlaceholder="Search therapy"
        pickerTitle="Add therapies to compare"
        pickerDescription="Assign up to four therapies. Duplicates are blocked."
        pickerId="therapy-compare-picker"
        pickerTestId="therapy-compare-picker"
        changeLabel="Change therapies"
        slotPlaceholder="Choose therapy"
        icon={Scale}
        phoneLayout="hybrid"
        slotSummaryLabel={`Up to ${THERAPY_MAX_COMPARE} therapies`}
        onCommit={(ids) => b.replaceCompareSlugs(ids.filter((id): id is string => Boolean(id)))}
      />

      {items.length < 2 ? null : (
        <>
          {/* Decision summary.
              The label used to occupy a 1.1fr column of its own and say nothing else, so a
              third of the widest card on the page carried two words. It is an eyebrow now,
              and the recovered column carries the metric a reader actually opens this page
              for: how much these therapies differ at all. */}
          <div className={cn(cardSurface, "mb-5 mt-5 overflow-hidden")}>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-5 py-2.5">
              <span className="text-3xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                Decision summary
              </span>
              <span className="text-2xs font-medium text-[color:var(--text-muted)]">
                {items.length} therapies, {rows.length} of {ROWS.length} fields shown
              </span>
            </div>
            <div className="grid grid-cols-1 divide-y divide-[color:var(--border)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {/* Unreachable, and deliberately left as a dash rather than given a phrase it would
                  never show: `shortestDelivery` returns null only for an empty array, this whole
                  block is gated on `items.length >= 2` above, and `Therapy.name` is non-nullable.
                  A missing-value phrase here would claim a case the code cannot produce. */}
              <SummaryCell label="Shortest delivery" value={shortestDelivery(items)?.name ?? "—"} />
              <SummaryCell label="Fields that differ" value={`${differing.length} of ${ROWS.length}`} />
              <SummaryCell
                label="Source status"
                value={
                  needsReviewCount(items) === 0
                    ? "All sources reviewed"
                    : `${needsReviewCount(items)} of ${items.length} need review`
                }
                status={needsReviewCount(items) === 0 ? "current" : "review_due"}
              />
            </div>
          </div>

          {/* tabs */}
          <Tabs
            label="Comparison fields"
            value={b.cmpTab}
            onChange={(value) => {
              if (value === "priorities") b.setTabPriorities();
              else if (value === "differences") b.setTabDifferences();
              else b.setTabAll();
            }}
            items={[
              { id: "priorities", label: "Priorities" },
              { id: "differences", label: "Differences" },
              { id: "all", label: "All fields" },
            ]}
          >
            {/* Phones read the same rows stacked; see TherapyCompareStack below. */}
            <div
              data-testid="therapy-compare-table"
              role="region"
              aria-label="Therapy comparison table"
              tabIndex={0}
              className="hidden overflow-x-auto rounded-lg border border-[color:var(--border)] shadow-[var(--e1)] md:block"
            >
              {/* `table-fixed` plus the colgroup below is what makes the columns read as a
                  comparison: every therapy gets the same width, so the eye compares text
                  against text rather than against a column that grew because one record
                  happened to carry a long paragraph. */}
              <table className="w-full min-w-[720px] table-fixed border-collapse bg-[color:var(--surface)] text-left">
                <caption className="sr-only">Therapy comparison by clinical field</caption>
                <colgroup>
                  <col className="w-[13.5rem]" />
                  {items.map((t) => (
                    <col key={t.slug} />
                  ))}
                </colgroup>
                <thead className="bg-[color:var(--surface-subtle)]">
                  <tr>
                    <th
                      scope="col"
                      className="px-5 py-3.5 align-top text-3xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]"
                    >
                      Field
                    </th>
                    {items.map((t, index) => (
                      <th
                        key={t.slug}
                        scope="col"
                        className="border-l border-[color:var(--border)] px-5 py-3.5 align-top"
                      >
                        {/* The letter, not a repeated scales glyph. Every column was a
                            therapy, so the icon distinguished nothing; the letter ties the
                            column to the selection tile the reader picked it in. */}
                        <div className="flex items-start gap-2.5">
                          <span className={compareLetterPip(index)}>{letters[index]}</span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold leading-snug text-[color:var(--text-heading)]">
                              {t.name}
                            </span>
                            <span
                              className={cn(
                                "mt-1.5 inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-3xs font-bold uppercase tracking-eyebrow",
                                t.reviewStatus === "reviewed" ? toneSuccess : toneWarning,
                              )}
                            >
                              <StatusMark status={t.reviewStatus === "reviewed" ? "current" : "review_due"} />
                              {t.reviewStatus === "reviewed" ? "Reviewed" : "Needs review"}
                            </span>
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, ri) => {
                    const warn = r.tone === "warning";
                    const stripe = ri % 2 === 1;
                    // Only the label carries the caution colour now. Amber body text across
                    // every cell of a caution row cost about half the contrast of the rows
                    // around it, on the two rows a reader can least afford to skim.
                    const rowTone = warn
                      ? "bg-[color:var(--warning-bg)]"
                      : stripe
                        ? "bg-[color:var(--surface-subtle)]"
                        : "bg-[color:var(--surface)]";
                    const rowBorder = warn ? "border-[color:var(--warning-border)]" : "border-[color:var(--border)]";
                    const cellPad = dense ? "px-4 py-3" : "px-5 py-4";
                    return (
                      <tr key={r.key} className={rowTone}>
                        <th
                          scope="row"
                          className={cn(
                            "border-t align-top text-sm-minus font-semibold",
                            rowBorder,
                            cellPad,
                            warn ? "text-[color:var(--warning-text)]" : "text-[color:var(--text-heading)]",
                          )}
                        >
                          <span className="flex items-start gap-2.5">
                            <r.icon
                              aria-hidden="true"
                              className="mt-px size-icon-md shrink-0"
                              strokeWidth={warn ? 2 : 1.7}
                            />
                            <span className="leading-snug">{r.label}</span>
                          </span>
                        </th>
                        {items.map((t) => (
                          <td
                            key={t.slug}
                            className={cn(
                              "border-l border-t align-top text-sm-minus leading-normal text-[color:var(--text)]",
                              rowBorder,
                              cellPad,
                            )}
                          >
                            {r.get(t)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <TherapyCompareStack items={items} rows={rows} dense={dense} letters={letters} />
            <div className="flex items-center gap-2 mt-4 text-xs text-[color:var(--text-muted)]">
              <Info aria-hidden="true" strokeWidth={1.8} className="size-icon-sm text-[color:var(--decoration-soft)]" />
              Comparisons are source-grounded. Review status reflects the latest source checks.
            </div>
          </Tabs>
        </>
      )}
    </section>
  );
}

/**
 * The phone comparison.
 *
 * The table above is `min-w-[720px]` inside a horizontal scroller, which on a
 * 390px phone shows about two thirds of one column at a time and — worse —
 * scrolls the field labels away from the values they label. Below `md` the same
 * `rows` are turned inside out instead: one card per field, every therapy listed
 * against it, so the label never leaves the value and nothing scrolls sideways.
 *
 * The fork is `md` (768px), not `sm` (640px): at 640–767px the 720px table would
 * still scroll sideways, which is the exact defect being fixed.
 *
 * One `rows` memo, two presentations — deliberately in this file rather than
 * extracted, because moving the table out has twice silently dropped the
 * responsive-stack count that `tests/therapy-compass-responsive-contract.test.ts`
 * measures.
 */
function TherapyCompareStack({
  items,
  rows,
  dense,
  letters,
}: {
  items: readonly Therapy[];
  rows: readonly Row[];
  dense: boolean;
  letters: readonly string[];
}) {
  return (
    <div data-testid="therapy-compare-stack" className="flex flex-col gap-3 md:hidden">
      {rows.map((r) => {
        const warn = r.tone === "warning";
        return (
          <section
            key={r.key}
            aria-label={r.label}
            className={cn(
              "overflow-hidden rounded-lg border shadow-[var(--e1)]",
              warn
                ? "border-[color:var(--warning-border)] bg-[color:var(--warning-bg)]"
                : "border-[color:var(--border)] bg-[color:var(--surface)]",
            )}
          >
            {/* The field label is a header band rather than a line of text inside the
                padding, so a phone scrolling through seven cards can find the next
                field boundary without reading anything. */}
            <h3
              className={cn(
                "m-0 flex items-center gap-2 border-b px-3.5 py-2 text-2xs font-bold uppercase tracking-eyebrow",
                warn
                  ? "border-[color:var(--warning-border)] text-[color:var(--warning-text)]"
                  : "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
              )}
            >
              <r.icon aria-hidden="true" strokeWidth={warn ? 2 : 1.8} className="size-icon-sm shrink-0" />
              {r.label}
            </h3>
            <dl
              className={cn(
                "m-0 divide-y divide-[color:var(--border)]",
                warn ? "divide-[color:var(--warning-border)]" : null,
              )}
            >
              {items.map((t, index) => (
                <div key={t.slug} className={cn("px-3.5", dense ? "py-2.5" : "py-3")}>
                  <dt className="flex items-center gap-2 text-2xs font-bold text-[color:var(--text-heading)]">
                    <span className={compareLetterPip(index, "h-5 w-5 text-3xs")}>{letters[index]}</span>
                    <span className="min-w-0 truncate">{t.name}</span>
                  </dt>
                  {/* Indented to the name's text, not the pip, so the value column lines up
                      down the card the way the table's cells line up across it. */}
                  <dd className="m-0 mt-1 pl-7 text-sm-minus leading-normal text-[color:var(--text)]">{r.get(t)}</dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}

/**
 * A summary metric.
 *
 * Status rides on a `StatusMark` — shape first, colour second — rather than on a
 * block of amber fill. The filled cell put a coloured field in one corner of a
 * white card, which read as a layout accident at a glance and left the value
 * itself in low-contrast brown; the mark says the same thing in 8px, survives a
 * greyscale print, and keeps every cell on the same background.
 */
function SummaryCell({ label, value, status }: { label: string; value: string; status?: DocumentStatus }) {
  return (
    <div className="px-5 py-4">
      <div className="mb-1.5 text-3xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">{label}</div>
      <div className="flex items-center gap-2">
        {status ? <StatusMark status={status} /> : null}
        <span className="text-sm font-semibold leading-snug text-[color:var(--text-heading)]">{value}</span>
      </div>
    </div>
  );
}
