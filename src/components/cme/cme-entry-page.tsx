"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  CopyPlus,
  ExternalLink,
  FileQuestion,
  History,
  Lock,
  Pencil,
  Repeat,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { CmeDetailNavHeader } from "@/components/cme/cme-nav-header";
import { cmeCpdHomeWords } from "@/components/cme/cme-log-shared";
import { cmePageTitle, cmePageWidth } from "@/components/cme/cme-page-frame";
import { CmeDot, CmePrivacyLine } from "@/components/cme/cme-work-kit";
import { WorkBody } from "@/components/mode-kit/work";
import { inPageActionRowClass } from "@/components/in-page-nav/in-page-nav-classes";
import { MissingValue } from "@/components/ui/missing-value";
import { cn, EmptyState } from "@/components/ui-primitives";
import { formatEntryForCpdHome } from "@/lib/cme/clipboard";
import { formatCmeRowDate, perthCalendarDate } from "@/lib/cme/cpd-year";
import { normalizeCmeSourceUrl } from "@/lib/cme/learning-source";
import { cmeCategoryLabels, type CmeEntry, type CmeRequirementSet } from "@/lib/cme/types";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

export type CmeEntryPageProps = {
  /** The entry to show. Looked up from `entries` so a route needs to pass only the id from its own params. */
  readonly entryId: string;
  /** Every entry the owner has recorded for the loaded year. */
  readonly entries: readonly CmeEntry[];
  readonly set: CmeRequirementSet;
  /**
   * Called once the entry has actually been copied. Must persist
   * `transcribed_at` (or resolve as a no-op in demo) before this page shows
   * success — a local-only flip would lie after refresh.
   */
  readonly onCopied?: (entryId: string) => void | Promise<void>;
  readonly editHref?: string;
  /** Label for the `editHref` link: "Amend entry" in a closed year. */
  readonly editLabel?: string;
  readonly readOnly?: boolean;
  readonly children?: ReactNode;
  /** Rendered last, below the record (the goal picker). */
  readonly actions?: ReactNode;
  /** Shown straight under the title: why the record is view-only, and the archive outcome. */
  readonly notice?: ReactNode;
  /**
   * Extra rows for the header's actions sheet, after Edit and Log it again —
   * Archive or Restore. Each receives the sheet's `close`, so a row that opens
   * a confirmation closes the sheet first.
   */
  readonly menuActions?: (close: () => void) => ReactNode;
};

/**
 * One row of the activity's actions sheet: the shared in-page action row, at
 * CPD's row-title weight (500) rather than that recipe's heavier weight, which
 * CPD never uses. `cn` merges the two, so the later weight wins.
 */
export const cmeEntryActionRow = cn(inPageActionRowClass, "font-medium");

function noop() {}

/** `15000` -> `"$150.00"`. */
function formatCostCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * ONE ENTRY — the screen carrying the control this mode's owner presses most.
 *
 * The allocations, each with the category "college pill" it counts toward
 * (colleges recognise the same three national categories, so the pill names
 * the one each allocation was booked against); the reflection in the
 * owner's own words; the evidence row; the cost row; and the big
 * "Copy for your CPD home" button, which puts `formatEntryForCpdHome`'s text
 * on the clipboard and then marks the entry transcribed — never the other
 * way around, so a failed copy can never be recorded as a successful one.
 *
 * **The cost never leaves this screen through the copy button.** It is
 * shown here because design decision §7 puts it on this record for tax time,
 * and `clipboard.ts` deliberately excludes it from what reaches a CPD
 * portal — see that file's own comment for why.
 */
export function CmeEntryPage({
  entryId,
  entries,
  set,
  onCopied = noop,
  editHref,
  editLabel = "Edit entry",
  readOnly = false,
  children,
  actions,
  menuActions,
  notice,
}: CmeEntryPageProps) {
  const entry = entries.find((candidate) => candidate.id === entryId) ?? null;
  const [transcribed, setTranscribed] = useState(entry?.transcribed ?? false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [stampFailed, setStampFailed] = useState(false);

  const back = { href: `/cme/log?year=${set.year}`, label: "Your log" };

  if (!entry) {
    return (
      <>
        <CmeDetailNavHeader title="Activity" back={back} testIdPrefix="cme-entry" />
        <main data-testid="cme-entry-page" className={cn(cmePageWidth, "px-4 pb-10 pt-6 sm:px-6")}>
          <EmptyState
            testId="cme-entry-not-found"
            icon={FileQuestion}
            title="This entry could not be found."
            body="It may have been removed, or the link is out of date."
          />
          <div className="mt-4">
            <Link
              href={`/cme/log?year=${set.year}`}
              className="inline-flex min-h-tap items-center gap-1.5 text-sm font-semibold text-[color:var(--clinical-accent)]"
            >
              <ChevronLeft aria-hidden="true" className="size-icon-sm" />
              Back to your log
            </Link>
          </div>
        </main>
      </>
    );
  }

  async function handleCopy() {
    // `entry` is narrowed non-null by the guard above, but that guard runs on
    // an earlier render than this closure captures — TypeScript cannot see
    // across the closure, so the null check is repeated rather than asserted.
    if (!entry || readOnly || entry.archivedAt) return;
    setCopyFailed(false);
    setStampFailed(false);
    try {
      await copyTextToClipboard(formatEntryForCpdHome(entry, set));
    } catch {
      setCopyFailed(true);
      return;
    }
    try {
      await onCopied(entry.id);
      setTranscribed(true);
    } catch {
      setStampFailed(true);
    }
  }

  const cpdHome = cmeCpdHomeWords(set);
  const today = perthCalendarDate(new Date());
  const totalHours = Math.round(entry.allocations.reduce((sum, allocation) => sum + allocation.hours, 0) * 100) / 100;

  const logAgainHref = `/cme/new?year=${entry.date.slice(0, 4)}&repeat=${encodeURIComponent(entry.id)}`;
  const hasMenu = Boolean(editHref) || !readOnly || Boolean(menuActions);

  return (
    <>
      <CmeDetailNavHeader
        title="Activity"
        back={back}
        testIdPrefix="cme-entry"
        actionsTitle="This activity"
        actionsNoun="activity"
        actions={
          hasMenu
            ? (close) => (
                <div className="grid gap-2">
                  {editHref ? (
                    <Link href={editHref} onClick={close} className={cmeEntryActionRow}>
                      <Pencil
                        aria-hidden="true"
                        className="size-icon-sm shrink-0 text-[color:var(--clinical-accent)]"
                      />
                      {editLabel}
                    </Link>
                  ) : null}
                  {!readOnly ? (
                    <Link
                      data-testid="cme-entry-log-again"
                      href={logAgainHref}
                      onClick={close}
                      className={cmeEntryActionRow}
                    >
                      <CopyPlus
                        aria-hidden="true"
                        className="size-icon-sm shrink-0 text-[color:var(--clinical-accent)]"
                      />
                      Log it again
                    </Link>
                  ) : null}
                  {menuActions?.(close)}
                </div>
              )
            : undefined
        }
      />
      <main data-testid="cme-entry-page" data-mode-identity="cme" className="w-full">
        <WorkBody>
          <div className="grid gap-0.5 px-1">
            <p className="cpd-hint m-0 font-semibold">{formatCmeRowDate(entry.date, today)}</p>
            <h1 className={cmePageTitle}>{entry.title}</h1>
            {entry.archivedAt ? (
              <p className="cpd-hint m-0">{`Archived. ${totalHours} hour${totalHours === 1 ? "" : "s"} recorded · excluded from totals`}</p>
            ) : null}
          </div>

          {notice ? <div>{notice}</div> : null}

          {/* Where the copy stands. Words, never colour (design decision §12). */}
          <div className="cpd-sug" data-testid="cme-entry-portal">
            <span aria-hidden="true" className="work-ic" data-tone={transcribed ? "neutral" : undefined}>
              {transcribed ? (
                <Check aria-hidden="true" strokeWidth={2.2} />
              ) : (
                <Copy aria-hidden="true" strokeWidth={2} />
              )}
            </span>
            <span className="work-row__text">
              <span className="work-row__title">{transcribed ? "Marked copied" : "Not marked copied"}</span>
              <span className="work-row__sub" data-testid="cme-entry-transcribed-status">
                {copyFailed
                  ? "Could not copy. Check clipboard permissions and try again."
                  : stampFailed
                    ? "Copied to your clipboard, but this record could not be marked as copied."
                    : transcribed
                      ? `Copied to your clipboard for ${cpdHome.name}.`
                      : `Not yet copied. Copy it into ${cpdHome.name}, and it is marked copied.`}
              </span>
            </span>
          </div>

          <dl className="work-card m-0" aria-label="This activity">
            <div className="cpd-kv">
              <dt>Date</dt>
              <dd>{formatCmeRowDate(entry.date, today)}</dd>
            </div>
            <div className="cpd-kv">
              <dt>Hours</dt>
              <dd>
                <span className="nums font-normal">{totalHours}</span> h
              </dd>
            </div>
            <div data-testid="cme-entry-allocations" className="contents">
              {entry.allocations.map((allocation, index) => (
                <div key={allocation.category} className="cpd-kv">
                  <dt>{index === 0 ? "Counts toward" : <span className="sr-only">Also counts toward</span>}</dt>
                  <dd>
                    <span className="mr-1.5 inline-flex align-[1px]">
                      <CmeDot cat={allocation.category} />
                    </span>
                    <span>{cmeCategoryLabels[allocation.category]}</span>
                    {entry.allocations.length > 1 ? (
                      <>
                        {" · "}
                        <span className="nums font-normal">{allocation.hours}</span> h
                      </>
                    ) : null}
                  </dd>
                </div>
              ))}
            </div>
            {entry.buckets.length > 0 ? (
              <div className="cpd-kv">
                <dt>{entry.buckets.length === 1 ? "Domain" : "Domains"}</dt>
                <dd>{entry.buckets.join(", ")}</dd>
              </div>
            ) : null}
            {entry.routineId ? (
              <div className="cpd-kv">
                <dt>Logged from</dt>
                <dd className="inline-flex items-center gap-1.5">
                  <Repeat aria-hidden="true" className="size-icon-sm" strokeWidth={2} />A routine
                </dd>
              </div>
            ) : null}
            <div className="cpd-kv" data-testid="cme-entry-cost">
              <dt>Cost</dt>
              <dd>
                {entry.costCents !== null ? (
                  <span className="nums font-normal">{formatCostCents(entry.costCents)}</span>
                ) : (
                  <MissingValue reason="not_recorded" />
                )}
              </dd>
            </div>
          </dl>

          <section
            data-testid="cme-entry-reflection"
            aria-labelledby="cme-entry-reflection-heading"
            className="grid gap-1.5"
          >
            <div className="work-label">
              <h2 id="cme-entry-reflection-heading" className="m-0 text-inherit font-inherit">
                Reflection
              </h2>
              {editHref ? (
                <Link href={editHref} className="work-label__link min-h-tap">
                  Edit
                </Link>
              ) : null}
            </div>
            {entry.reflection.trim().length > 0 ? (
              <p className="work-card work-card--pad m-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-[color:var(--text)]">
                {entry.reflection}
              </p>
            ) : (
              <p className="cpd-hint m-0" data-testid="cme-entry-reflection-empty">
                No reflection written yet.
              </p>
            )}
          </section>

          <section data-testid="cme-entry-evidence" aria-labelledby="cme-entry-source-heading" className="grid gap-1.5">
            <h2 id="cme-entry-source-heading" className="work-label m-0">
              Source record
            </h2>
            {entry.documentId ? (
              <p className="work-card work-card--pad m-0 text-sm text-[color:var(--text)]">
                A private source document is linked to this entry. This label records the link. It does not certify the
                document as audit evidence.
              </p>
            ) : (
              <p className="cpd-hint m-0" data-testid="cme-entry-evidence-empty">
                No source is linked. A learning source and evidence of your participation are separate. Manage
                supporting files below.
              </p>
            )}
            {entry.sourceUrl && normalizeCmeSourceUrl(entry.sourceUrl) ? (
              <div className="work-card">
                <a
                  href={normalizeCmeSourceUrl(entry.sourceUrl) ?? undefined}
                  rel="noreferrer"
                  target="_blank"
                  className="work-row min-h-tap"
                  data-testid="cme-entry-source-link"
                >
                  <span className="cpd-lead">
                    <ExternalLink aria-hidden="true" strokeWidth={2} />
                  </span>
                  <span className="work-row__text">
                    <span className="work-row__title">Organiser page</span>
                    <span className="work-row__sub">A link is not evidence of attendance</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="work-row__chev" />
                </a>
              </div>
            ) : null}
          </section>

          {children}

          {/* Last, below the record: archiving sat straight under the title,
          above the details, where it was the easiest thing to tap by mistake. */}
          {actions}

          <CmePrivacyLine icon={Lock}>{`Private to you. Nothing is sent to ${cpdHome.college}.`}</CmePrivacyLine>

          {
            <div className="work-dock" role="group" aria-label="Activity actions">
              <div className="work-dock__capsule">
                <button
                  type="button"
                  className="work-button min-h-tap"
                  data-variant="primary"
                  disabled={readOnly || Boolean(entry.archivedAt)}
                  onClick={() => void handleCopy()}
                >
                  <Copy aria-hidden="true" strokeWidth={2.2} />
                  {`Copy for ${cpdHome.name}`}
                </button>
                {!readOnly ? (
                  <Link
                    href={logAgainHref}
                    className="work-button min-h-tap"
                    data-variant="secondary"
                    data-testid="cme-entry-dock-log-again"
                  >
                    <History aria-hidden="true" strokeWidth={2.2} />
                    Log again
                  </Link>
                ) : null}
              </div>
            </div>
          }
        </WorkBody>
      </main>
    </>
  );
}
