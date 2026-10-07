"use client";

import { CalendarDays, Copy, Download, FileText, Lock, Plus, Printer, Send, WifiOff } from "lucide-react";
import { useMemo, useState } from "react";

import { CmeCategoryBar } from "@/components/cme/cme-progress-visuals";
import { CmeYearClosePanel } from "@/components/cme/cme-year-close-panel";
import { useModeBandHeading } from "@/components/mode-band/mode-band";
import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkChip,
  WorkChips,
  WorkDateRow,
  WorkEmpty,
  WorkIconRow,
  WorkSectionLabel,
  WorkTag,
} from "@/components/mode-kit/work";
import { cn, textMuted } from "@/components/ui-primitives";
import { downloadTextFile } from "@/lib/admin/download-file";
import { evaluateYear } from "@/lib/cme/evaluate";
import { activeCmeYearEntries } from "@/lib/cme/export";
import type { CmeEntry, CmeRequirementSet, CmeYearClose } from "@/lib/cme/types";
import { useOnlineStatus } from "@/lib/use-online-status";
import {
  cpdCsvFileName,
  cpdExportSummary,
  cpdSummaryLine,
  cpdYearCsv,
  cpdYearEndState,
} from "@/lib/work-screens/cpd/export";

export type CpdExportPageProps = {
  readonly set: CmeRequirementSet;
  readonly entries: readonly CmeEntry[];
  readonly years: readonly number[];
  readonly goalCount: number;
  readonly close: CmeYearClose | null;
  readonly now: Date;
  readonly demoMode: boolean;
};

/**
 * CPD Export, `/cme/export` (mock-up cpd_export). The year as files the doctor keeps: a CSV (made on
 * this page from the records already loaded, the same file the export endpoint makes) and the existing
 * printable summary. Copy to the CPD home, CPD dates and closing the year link to the screens that
 * already do them. Labelled as a plain personal summary: no college format is claimed.
 */
export function CpdExportPage({ set, entries, years, goalCount, close, now, demoMode }: CpdExportPageProps) {
  const online = useOnlineStatus();
  const [saved, setSaved] = useState<string | null>(null);
  const year = set.year;
  const summary = useMemo(() => cpdExportSummary(entries, year), [entries, year]);
  const active = useMemo(() => activeCmeYearEntries(entries, year), [entries, year]);
  const unmet = useMemo(() => evaluateYear({ set, entries: active }).unmet.length, [set, active]);
  const yearEnd = cpdYearEndState(set, now);
  useModeBandHeading({ eyebrow: `Year ${year}`, title: "Export" });
  const yearChips = [...new Set([year, ...years])].sort((a, b) => b - a);

  function downloadCsv() {
    const name = cpdCsvFileName(year, demoMode);
    try {
      downloadTextFile(cpdYearCsv(entries, set), name, "text/csv;charset=utf-8");
      setSaved(`Saved ${name}. Check your downloads.`);
    } catch {
      setSaved("The file could not be made on this device. Try again.");
    }
  }

  return (
    <main className="min-w-0" data-testid="cpd-export-page">
      <WorkBody>
        <h1 className="sr-only">Export {year}</h1>
        {demoMode ? (
          <p className={cn(textMuted, "text-sm")} data-testid="cpd-export-demo">
            Synthetic demonstration, not a personal CPD record.
          </p>
        ) : null}
        {!online ? (
          <WorkCard padded testId="cpd-export-offline">
            <p className="flex items-start gap-2 text-sm text-[color:var(--text)]">
              <WifiOff aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0" strokeWidth={1.8} />
              <span>
                You&apos;re offline. The CSV still saves from what last loaded. The printable page and closing the year
                need a connection.
              </span>
            </p>
          </WorkCard>
        ) : null}

        {yearChips.length > 1 ? (
          <WorkChips scroll label="Year">
            {yearChips.map((y) => (
              <WorkChip key={y} href={`/cme/export?year=${y}`} current={y === year}>
                {String(y)}
              </WorkChip>
            ))}
          </WorkChips>
        ) : null}

        <WorkSectionLabel>Annual summary</WorkSectionLabel>
        {summary.activities === 0 ? (
          <WorkEmpty
            icon={FileText}
            title={`Nothing logged in ${year} yet`}
            body="Log an activity and it shows here, ready to save."
            action={
              demoMode ? null : (
                <WorkButton href="/cme/new" icon={Plus} testId="cpd-export-log">
                  Log an activity
                </WorkButton>
              )
            }
            testId="cpd-export-empty"
          />
        ) : (
          <WorkCard padded testId="cpd-export-summary" className="grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <b className="nums text-base font-semibold text-[color:var(--text-heading)]">{cpdSummaryLine(summary)}</b>
              <span className={cn(textMuted, "nums text-xs")}>{goalCount === 1 ? "1 goal" : `${goalCount} goals`}</span>
            </div>
            <CmeCategoryBar entries={active} targetHours={set.totalHours} />
            <p className={cn(textMuted, "text-xs")}>
              A plain personal summary, not a college format and not proof you meet the standard. Your CPD home reports
              that.
            </p>
            <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
              <WorkButton
                variant="secondary"
                icon={Printer}
                href={`/cme/summary?year=${year}`}
                testId="cpd-export-print"
              >
                Printable page
              </WorkButton>
              <WorkButton variant="secondary" icon={Download} onClick={downloadCsv} testId="cpd-export-csv">
                Download CSV
              </WorkButton>
            </div>
            <p className={cn(textMuted, "text-xs")}>On the printable page, choose Save as PDF, or Share on a phone.</p>
            {saved ? (
              <p role="status" className="text-xs text-[color:var(--text)]" data-testid="cpd-export-saved">
                {saved}
              </p>
            ) : null}
          </WorkCard>
        )}

        <WorkSectionLabel>Your CPD home</WorkSectionLabel>
        <WorkCard as="ul">
          <li className="min-w-0">
            <WorkIconRow
              icon={Copy}
              title="Copy the next one"
              sub={
                summary.notCopied
                  ? `${summary.notCopied} not marked copied`
                  : summary.activities
                    ? "All marked copied"
                    : "Nothing to copy yet"
              }
              end={summary.notCopied ? <WorkTag tone="mode">Copy next</WorkTag> : undefined}
              href={`/cme/log?copy=todo&year=${year}`}
              testId="cpd-export-copy-next"
            />
          </li>
          <li className="min-w-0">
            <WorkIconRow
              icon={Send}
              title="Copy everything"
              sub={summary.activities ? `All ${summary.activities}, one after another` : "One after another"}
              href={`/cme/cpd-home?year=${year}`}
              testId="cpd-export-copy-all"
            />
          </li>
        </WorkCard>
        <p className={cn(textMuted, "px-1 text-xs")}>
          Nothing is sent to your college. You copy each one, then mark it copied.
        </p>

        <WorkSectionLabel>Calendar</WorkSectionLabel>
        <WorkCard as="ul">
          <li className="min-w-0">
            <WorkIconRow
              icon={CalendarDays}
              tone="neutral"
              title="Subscribe to CPD dates"
              sub="Routines and year-end dates"
              href="/cme/calendar"
              testId="cpd-export-calendar"
            />
          </li>
        </WorkCard>

        <WorkSectionLabel>Year end</WorkSectionLabel>
        {yearEnd.kind === "not-yet" ? (
          <WorkCard as="ul">
            <li className="min-w-0">
              <WorkDateRow
                month={yearEnd.month}
                day={yearEnd.day}
                title="Close the year"
                sub={`From ${yearEnd.from} · in PsychSift only`}
                end={<WorkTag tone="neutral">Not yet</WorkTag>}
                testId="cpd-export-close-not-yet"
              />
            </li>
          </WorkCard>
        ) : (
          <div data-testid="cpd-export-close">
            <CmeYearClosePanel
              year={year}
              close={close}
              closedAt={set.closedAt}
              now={now}
              unmetCount={unmet}
              demoMode={demoMode}
            />
          </div>
        )}
        <p className={cn(textMuted, "px-1 text-xs")}>
          Closing keeps a permanent snapshot. Later changes are kept as dated amendments.
        </p>
        <p className={cn(textMuted, "flex items-center justify-center gap-1.5 text-center text-xs")}>
          <Lock aria-hidden="true" className="size-icon-xs shrink-0" strokeWidth={1.8} />
          Saved files hold your reflections. Keep them somewhere private.
        </p>
      </WorkBody>
    </main>
  );
}
