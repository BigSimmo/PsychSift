"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { TeachingAccountPage } from "@/components/teaching/teaching-depth-page";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeFactTile, ModeFactTiles } from "@/components/mode-kit/fact-tile";
import { ModeGroupedList } from "@/components/mode-kit/grouped-list";
import { modeInsetHairline, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { AttendanceChart, attendanceWeeks } from "@/components/teaching/attendance-chart";
import { LogToCpdSheet } from "@/components/teaching/log-to-cpd-sheet";
import { attendanceCsv, csvHref, logbookFigures, logbookGroups } from "@/components/teaching/organise-model";
import { mondayOf, perthDateKey } from "@/components/teaching/teaching-dates";
import { LogbookLedger, TeachingModule } from "@/components/teaching/teaching-modules";
import { withUnit } from "@/components/teaching/teaching-number";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import { TeachingTermCard } from "@/components/teaching/teaching-term-card";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { cn } from "@/components/ui-primitives";
import { demoTeachingLogbook } from "@/lib/teaching/demo-programme";
import type { LogbookRow } from "@/lib/teaching/model";

/** A two-line grouped-list link row, built from the kit's recipes exactly as `ModeRow` builds one. */
const linkRowItem = cn(modeInsetHairline, "flex min-w-0 items-center pr-1");
const linkRowControl = cn(
  modeRowHeight.double,
  modePressable,
  focusRing,
  "flex min-w-0 flex-1 flex-wrap items-center gap-x-3 pr-2 pl-3 no-underline",
);

function LinkRowText({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <span className="grid min-w-0 flex-1 basis-40 gap-0.5 py-1">
        <span className={cn(modeNameText, "text-base-minus leading-5 break-words text-[color:var(--text-heading)]")}>
          {title}
        </span>
        <span className={cn(modeSecondaryText, "leading-5 break-words")}>{subtitle}</span>
      </span>
      <ChevronRight aria-hidden="true" className="ml-auto size-icon-md shrink-0 text-[color:var(--text-muted)]" />
    </>
  );
}

/** The review row's line: how many rows on this page are not in CPD yet, once they are known. */
function reviewLine(rows: readonly LogbookRow[] | null): string {
  if (!rows) return "Log attended sessions to your private CPD";
  const unlogged = rows.filter((row) => !row.cpdEntryId).length;
  if (unlogged === 0) return "Nothing waiting to log";
  return `${withUnit(unlogged, unlogged === 1 ? "session" : "sessions")} not in CPD yet`;
}

/*
 * Logbook: three figures (this term is the chart's 12 weeks), the attendance
 * chart, the ledger by month (an unlogged row opens Log to CPD, a logged row
 * links to its CPD entry), then Download CSV. The CSV is built from the rows
 * already on screen, so the download sends nothing anywhere and stores nothing.
 * The page name is the pill, so the h1 is sr-only.
 */
function TeachingLogbookContent({ demoMode }: { demoMode: boolean }) {
  const now = useTeachingNow();
  const resource = useTeachingResource<{ attendance: LogbookRow[] }>(demoMode ? null : "/api/teaching?view=logbook");
  const rows = useMemo(
    () => (demoMode ? (now ? demoTeachingLogbook(now) : null) : (resource.data?.attendance ?? null)),
    [demoMode, now, resource.data],
  );
  const [logging, setLogging] = useState<LogbookRow | null>(null);
  const [demoNote, setDemoNote] = useState(false);
  // The demo's rows are made up, so nothing is ever sent to CPD from them.
  const onLog = demoMode ? () => setDemoNote(true) : setLogging;

  let body;
  if (resource.status === "signed-out") body = <TeachingSignInNotice />;
  else if (resource.status === "offline" || resource.status === "error" || resource.status === "setup")
    body = <TeachingStateNotice state={resource.status} onRetry={resource.retry} />;
  else if (!now || !rows) body = <ModeModuleSkeleton rows={3} />;
  else if (rows.length === 0) body = <ModeNotice>No check-ins yet. Sessions you check in to show here.</ModeNotice>;
  else {
    const today = perthDateKey(now);
    const weeks = attendanceWeeks(
      rows.map((r) => r.startsAt),
      today,
    );
    body = (
      <>
        <div role="group" aria-label="Your attendance">
          <ModeFactTiles testId="teaching-logbook-figures">
            {logbookFigures(rows, today).map((figure) => (
              <ModeFactTile
                key={figure.id}
                label={figure.label}
                value={figure.unit ? withUnit(figure.value, figure.unit) : figure.value}
              />
            ))}
          </ModeFactTiles>
        </div>
        <TeachingModule title={`Last ${withUnit(12, "weeks")}`}>
          <AttendanceChart weeks={weeks} currentKey={mondayOf(today)} />
        </TeachingModule>
        {demoNote ? <ModeNotice>The demo doesn&apos;t save to CPD.</ModeNotice> : null}
        <LogbookLedger groups={logbookGroups(rows, onLog)} />
        <a
          href={csvHref(attendanceCsv(rows))}
          download="teaching-attendance.csv"
          className={cn(
            "inline-flex min-h-12 items-center self-start px-1 text-sm font-medium text-[color:var(--primary)]",
            focusRing,
          )}
        >
          Download CSV
        </a>
        {logging ? (
          <LogToCpdSheet
            open
            onClose={() => setLogging(null)}
            occurrenceId={logging.occurrenceId}
            startsAt={logging.startsAt}
            endsAt={logging.endsAt}
            onLogged={() => resource.retry()}
          />
        ) : null}
      </>
    );
  }
  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-logbook">
      <div className="grid gap-3">
        <h1 className="sr-only">Logbook</h1>
        {now ? <TeachingTermCard demoMode={demoMode} today={perthDateKey(now)} /> : null}
        <nav aria-label="Logbook actions">
          <ModeGroupedList mode="teaching" testId="teaching-logbook-links">
            {/* Real Links with literal hrefs, so the route-reachability scan sees each destination. */}
            <li className={linkRowItem}>
              <Link href="/teaching/supervision" className={linkRowControl}>
                <LinkRowText title="Supervision" subtitle="Log and confirm supervision hours" />
              </Link>
            </li>
            <li className={linkRowItem}>
              <Link href="/teaching/review" className={linkRowControl}>
                <LinkRowText title="Weekly CPD review" subtitle={reviewLine(rows)} />
              </Link>
            </li>
            <li className={linkRowItem}>
              <Link href="/teaching/feedback" className={linkRowControl}>
                <LinkRowText title="Give feedback" subtitle="Tap-only, for sessions you attended" />
              </Link>
            </li>
          </ModeGroupedList>
        </nav>
        {body}
      </div>
    </InformationPageShell>
  );
}

export function TeachingLogbook(props: { demoMode: boolean }) {
  return <TeachingAccountPage component={TeachingLogbookContent} {...props} />;
}
