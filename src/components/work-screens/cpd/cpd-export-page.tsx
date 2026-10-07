"use client";

import { CalendarDays, Copy, Download, FileText, Lock, Plus, Send, ShieldAlert, WifiOff } from "lucide-react";
import { useMemo, useRef, useState } from "react";

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
import { dateTile } from "@/lib/work-screens/cpd/evidence";
import { cpdExportPatientFlags, type CpdPatientFlag } from "@/lib/work-screens/cpd/patient-check";
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
/** Flagged activities listed by name before "and N more". */
export const FLAGGED_PREVIEW = 5;
/** A second tap inside this window is the same tap, so a double tap saves one file. */
const REPEAT_TAP_MS = 1500;

export function CpdExportPage({ set, entries, years, goalCount, close, now, demoMode }: CpdExportPageProps) {
  const online = useOnlineStatus();
  // Always in the page, so the words are announced when they change rather than when the node appears.
  const [saved, setSaved] = useState("");
  const [flags, setFlags] = useState<readonly CpdPatientFlag[] | null>(null);
  const lastSave = useRef(0);
  const year = set.year;
  const summary = useMemo(() => cpdExportSummary(entries, year), [entries, year]);
  const active = useMemo(() => activeCmeYearEntries(entries, year), [entries, year]);
  const unmet = useMemo(() => evaluateYear({ set, entries: active }).unmet.length, [set, active]);
  const yearEnd = cpdYearEndState(set, now);
  useModeBandHeading({ eyebrow: `Year ${year}`, title: "Export" });
  const yearChips = [...new Set([year, ...years])].sort((a, b) => b - a);

  function saveCsv() {
    const at = Date.now();
    if (at - lastSave.current < REPEAT_TAP_MS) return;
    lastSave.current = at;
    const name = cpdCsvFileName(year, demoMode);
    try {
      downloadTextFile(cpdYearCsv(entries, set), name, "text/csv;charset=utf-8");
      setSaved(`${name} is downloading. Check your downloads.`);
    } catch {
      lastSave.current = 0;
      setSaved("The file could not be made on this device. Try again.");
    }
  }

  /** The CSV carries every title and reflection, so the shared patient-detail check reads them first. */
  function downloadCsv() {
    const found = cpdExportPatientFlags(entries, year);
    if (found.length) {
      setFlags(found);
      setSaved("");
      return;
    }
    setFlags(null);
    saveCsv();
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
                icon={FileText}
                href={`/cme/summary?year=${year}`}
                testId="cpd-export-print"
              >
                Save as PDF
              </WorkButton>
              <WorkButton variant="secondary" icon={Download} onClick={downloadCsv} testId="cpd-export-csv">
                Download CSV
              </WorkButton>
            </div>
            <p className={cn(textMuted, "text-xs")}>
              Save as PDF opens the printable page. Choose Save as PDF there, or Share on a phone.
            </p>
            {flags ? (
              <div role="alert" className="grid gap-2" data-testid="cpd-export-patient-check">
                <p className="flex items-start gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
                  <ShieldAlert aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0" strokeWidth={1.8} />
                  <span>
                    {flags.length === 1
                      ? "1 activity may hold a patient detail"
                      : `${flags.length} activities may hold a patient detail`}
                  </span>
                </p>
                <p className={cn(textMuted, "text-xs")}>
                  Open each to check it before you keep or share the file. This check catches some details, not all.
                </p>
                <WorkCard as="ul">
                  {flags.slice(0, FLAGGED_PREVIEW).map((flag) => {
                    const tile = dateTile(flag.date);
                    return (
                      <li key={flag.id} className="min-w-0">
                        <WorkDateRow
                          month={tile.month}
                          day={tile.day}
                          title={<span className="[overflow-wrap:anywhere]">{flag.title}</span>}
                          sub={flag.field === "title" ? "Check the title" : "Check the reflection"}
                          href={`/cme/log/${encodeURIComponent(flag.id)}`}
                          testId={`cpd-export-flag-${flag.id}`}
                        />
                      </li>
                    );
                  })}
                </WorkCard>
                {flags.length > FLAGGED_PREVIEW ? (
                  <p className={cn(textMuted, "text-xs")}>And {flags.length - FLAGGED_PREVIEW} more.</p>
                ) : null}
                <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
                  <WorkButton
                    variant="secondary"
                    onClick={() => {
                      setFlags(null);
                      saveCsv();
                    }}
                    testId="cpd-export-csv-anyway"
                  >
                    Download anyway
                  </WorkButton>
                  <WorkButton variant="quiet" onClick={() => setFlags(null)} testId="cpd-export-csv-cancel">
                    Not now
                  </WorkButton>
                </div>
              </div>
            ) : null}
            <p role="status" className="min-h-4 text-xs text-[color:var(--text)]" data-testid="cpd-export-saved">
              {saved}
            </p>
          </WorkCard>
        )}

        <WorkSectionLabel>Your CPD home</WorkSectionLabel>
        <WorkCard as="ul">
          <li className="min-w-0">
            <WorkIconRow
              icon={Copy}
              title="Copy to your CPD home"
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
