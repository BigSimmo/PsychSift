"use client";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef } from "react";
import { cardSurface } from "@/components/card-recipes";
import { ApplicationsEntryLink } from "@/components/cme/applications/applications-entry-link";
import { CpdHomeEntryLink } from "@/components/cme/cpd-home/cpd-home-entry-link";
import { CmeYearClosePanel } from "@/components/cme/cme-year-close-panel";
import { Button, buttonFaceClass } from "@/components/ui/button";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import { guardExampleAction } from "@/lib/example-data/guards";
import { useExampleData } from "@/lib/example-data/store";
import { formatCalendarDateLong, formatCalendarMonthLabel } from "@/lib/cme/cpd-year";
import { evaluateYear } from "@/lib/cme/evaluate";
import { activeCmeYearEntries } from "@/lib/cme/export";
import { describeConfirmedSource } from "@/lib/cme/presets";
import { cmeCategoryLabels, type CmeEntry, type CmeRequirementSet, type CmeYearClose } from "@/lib/cme/types";
import { cmePageTitle } from "@/components/cme/cme-page-frame";
/**
 * The phone's own print screen is the PDF maker: iOS offers Share and Save to
 * Files from it, Android and desktop browsers offer Save as PDF. The page title
 * becomes the suggested file name, so it is set for the duration of the print.
 */
function savePdf(year: number) {
  const previousTitle = document.title;
  document.title = `CPD annual summary ${year}`;
  const restore = () => {
    document.title = previousTitle;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  window.print();
}

type SummaryMonth = { key: string; entries: CmeEntry[]; hours: number };

/** Groups the year's activities by calendar month, keeping their existing order. */
function groupByMonth(entries: readonly CmeEntry[]): SummaryMonth[] {
  const months: SummaryMonth[] = [];
  for (const entry of entries) {
    const key = entry.date.slice(0, 7);
    let month = months.find((candidate) => candidate.key === key);
    if (!month) {
      month = { key, entries: [], hours: 0 };
      months.push(month);
    }
    month.entries.push(entry);
    month.hours += entry.allocations.reduce((sum, allocation) => sum + allocation.hours, 0);
  }
  return months;
}

/**
 * On a phone the full activity record runs to many screens, so each month is
 * folded on screen. The printed summary must stay complete, so every month is
 * opened for the print and put back as it was afterwards — whether the print
 * starts from "Save as PDF" or from the browser's own menu.
 */
function useOpenMonthsForPrint() {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let restore: HTMLDetailsElement[] = [];
    const open = () => {
      const months = [...(listRef.current?.querySelectorAll("details") ?? [])];
      restore = months.filter((month) => !month.open);
      for (const month of restore) month.open = true;
    };
    const close = () => {
      for (const month of restore) month.open = false;
      restore = [];
    };
    window.addEventListener("beforeprint", open);
    window.addEventListener("afterprint", close);
    return () => {
      window.removeEventListener("beforeprint", open);
      window.removeEventListener("afterprint", close);
    };
  }, []);
  return listRef;
}

export function CmeAnnualSummary({
  set,
  entries,
  demoMode = false,
  close = null,
  now = new Date(),
}: {
  set: CmeRequirementSet;
  entries: readonly CmeEntry[];
  demoMode?: boolean;
  /** The closing snapshot and amendments, when the year is closed. */
  close?: CmeYearClose | null;
  /** The instant the close window is judged against; the page passes its own clock. */
  now?: Date;
}) {
  // Example records never leave the app: while CPD shows example data, both exports explain instead.
  const example = useExampleData("cpd").active;
  const active = activeCmeYearEntries(entries, set.year);
  const status = evaluateYear({ set, entries: active });
  const months = groupByMonth(active);
  const monthListRef = useOpenMonthsForPrint();
  const costs = active.reduce((sum, e) => sum + (e.costCents ?? 0), 0);
  return (
    <main
      className="cme-annual-summary mx-auto min-w-0 w-full max-w-4xl px-4 py-6 [overflow-wrap:anywhere] text-[color:var(--text)]"
      data-testid="cme-annual-summary"
    >
      <style>{`@media print {
      html:has(.cme-annual-summary), body:has(.cme-annual-summary), body:has(.cme-annual-summary) *:has(.cme-annual-summary) {
        display: block !important; position: static !important; width: auto !important; height: auto !important;
        max-height: none !important; max-width: none !important; overflow: visible !important;
        contain: none !important; transform: none !important; padding: 0 !important; margin: 0 !important;
        background: white !important;
      }
      body:has(.cme-annual-summary) *:not(.cme-annual-summary):not(.cme-annual-summary *):not(:has(.cme-annual-summary)) { display: none !important; }
      .cme-annual-summary { display: block !important; position: static !important; width: 100% !important; height: auto !important; max-width: none !important; max-height: none !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; background: white !important; }
      .cme-annual-summary, .cme-annual-summary * { color: black !important; text-shadow: none !important; box-shadow: none !important; }
      .cme-annual-summary .cme-print-controls { display: none !important; }
      .cme-annual-summary section { break-inside: avoid; }
    }`}</style>
      <header className="grid gap-1">
        <h1 className={cmePageTitle}>CPD annual summary — {set.year}</h1>
        {demoMode ? (
          <p className={cn(textMuted, "text-sm")}>Synthetic demonstration — not a personal CPD record.</p>
        ) : null}
        <p className="text-sm font-normal tabular-nums">
          {active.length} active activities · {status.totalHours} / {set.totalHours} hours · Recorded costs AUD $
          {(costs / 100).toFixed(2)}
        </p>
      </header>
      {/* Title first, then the ways on from this year, then the page's own buttons. Not printed. */}
      <div className="cme-print-controls mt-4 mb-5 grid gap-4">
        <nav aria-label="More from your CPD year" className="grid gap-2" data-testid="cme-summary-more">
          <CpdHomeEntryLink year={set.year} />
          <ApplicationsEntryLink />
        </nav>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/cme/log?year=${set.year}`} className={buttonFaceClass({ variant: "secondary" })}>
              Back to log
            </Link>
            <Button
              testId="cme-summary-save-pdf"
              onClick={() => {
                if (guardExampleAction(example, "export")) savePdf(set.year);
              }}
            >
              Save as PDF
            </Button>
            {example ? (
              // The export route reads the account, so on an example page it would hand over REAL records.
              <Button variant="secondary" onClick={() => guardExampleAction(true, "export")}>
                Download CSV
              </Button>
            ) : (
              <a
                href={`/api/cme/export?year=${set.year}`}
                download
                className={buttonFaceClass({ variant: "secondary" })}
              >
                Download CSV
              </a>
            )}
          </div>
          <p className={cn(textMuted, "mt-2 text-xs")}>
            Opens your device&apos;s print screen. Choose Save as PDF, or Share on a phone, to send it to your college
            or keep a copy.
          </p>
        </div>
      </div>

      <section className={cn(cardSurface, "mt-4 grid gap-2 p-4 text-sm")}>
        <p>
          Targets confirmed {formatCalendarDateLong(set.confirmedOn)}: {describeConfirmedSource(set.confirmedSource)}
        </p>
        <p className={textMuted}>
          Archived entries are excluded. Formal peer review is a subset of reviewing hours. Source links identify
          learning material; they do not prove attendance or completion. Evidence files remain attached to individual
          entries. This summary is a personal record, not a compliance certificate.
        </p>
      </section>

      <CmeYearClosePanel
        year={set.year}
        close={close}
        closedAt={set.closedAt}
        now={now}
        unmetCount={status.unmet.length}
        demoMode={demoMode}
      />

      <h2 className={cn(eyebrowText, "mt-6")}>Requirements</h2>
      <ul className="mt-2 grid gap-2">
        {set.requirements.map((r, index) => (
          <li key={r.id} className={cn(cardSurface, "grid gap-0.5 px-4 py-3 text-sm")}>
            <span className="font-semibold text-[color:var(--text-heading)]">{r.label}</span>
            <span className={textMuted}>{status.statuses[index]?.summary}</span>
          </li>
        ))}
      </ul>

      <h2 className={cn(eyebrowText, "mt-6")}>Activity record</h2>
      <div ref={monthListRef} className="mt-2 grid gap-2" data-testid="cme-summary-months">
        {months.map((month) => (
          <details key={month.key} className="group" data-testid="cme-summary-month">
            <summary
              className={cn(
                cardSurface,
                "flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm [&::-webkit-details-marker]:hidden",
              )}
            >
              <span className="font-medium text-[color:var(--text-heading)]">
                {formatCalendarMonthLabel(month.key)}
              </span>
              <span className="flex items-center gap-2">
                <span className={cn(textMuted, "nums")}>
                  {month.entries.length} {month.entries.length === 1 ? "activity" : "activities"} ·{" "}
                  {Math.round(month.hours * 100) / 100} h
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-icon-sm text-[color:var(--text-muted)] motion-safe:transition-transform group-open:rotate-180 print:hidden"
                />
              </span>
            </summary>
            <div className="mt-2 grid gap-2">
              {month.entries.map((entry) => (
                <section key={entry.id} className={cn(cardSurface, "grid gap-1 p-4 text-sm")}>
                  <h3 className="text-base font-semibold text-[color:var(--text-heading)]">{entry.title}</h3>
                  <p className={textMuted}>{formatCalendarDateLong(entry.date)}</p>
                  <p>{entry.allocations.map((a) => `${cmeCategoryLabels[a.category]}: ${a.hours} h`).join(" · ")}</p>
                  <p>Formal peer review: {entry.formalPeerReviewHours ?? 0} h (within reviewing)</p>
                  {entry.buckets.length ? <p>Domains: {entry.buckets.join("; ")}</p> : null}
                  {entry.reflection ? <p className="whitespace-pre-wrap">{entry.reflection}</p> : null}
                  <p className={textMuted}>
                    Cost: {entry.costCents === null ? "Not recorded" : `AUD ${(entry.costCents / 100).toFixed(2)}`}
                  </p>
                  {entry.sourceUrl ? <p className="break-all">Learning source: {entry.sourceUrl}</p> : null}
                  {entry.documentId ? (
                    <p className={textMuted}>Private source document linked; not certified as evidence.</p>
                  ) : null}
                  {(entry.evidenceCount ?? 0) > 0 ? (
                    <p>
                      <Link
                        href={`/cme/log/${entry.id}#cme-evidence-heading`}
                        className="font-semibold text-[color:var(--clinical-accent)] underline-offset-2 hover:underline"
                      >
                        View {entry.evidenceCount} attached{" "}
                        {entry.evidenceCount === 1 ? "evidence file" : "evidence files"}
                      </Link>
                    </p>
                  ) : null}
                </section>
              ))}
            </div>
          </details>
        ))}
      </div>
      {!active.length ? (
        <p className={cn(textMuted, "mt-4 text-sm")}>No active activities recorded for this year.</p>
      ) : null}
    </main>
  );
}
