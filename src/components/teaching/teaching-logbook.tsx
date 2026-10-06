"use client";

import { CalendarDays, FileText, GraduationCap, ListChecks, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { LogToCpdSheet } from "@/components/teaching/log-to-cpd-sheet";
import {
  cpdButtonLabel,
  cpdWeek,
  feedbackMeta,
  recordChart,
  supervisorSummary,
  termRow,
  type RecordChart,
} from "@/components/teaching/my-record-model";
import { attendanceCsv, csvHref, logbookGroups } from "@/components/teaching/organise-model";
import {
  T5Actions,
  T5Check,
  T5Heading,
  T5Icon,
  T5Kicker,
  T5Link,
  T5List,
  T5Meta,
  T5Note,
  T5Page,
  T5Panel,
  T5Row,
  T5Section,
} from "@/components/teaching/t5-kit";
import { perthDateKey } from "@/components/teaching/teaching-dates";
import { TeachingAccountPage } from "@/components/teaching/teaching-depth-page";
import { LogbookLedger } from "@/components/teaching/teaching-modules";
import { withUnit } from "@/components/teaching/teaching-number";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";
import { teachingErrorMessage, teachingPost } from "@/lib/teaching/client";
import { demoTeachingFeedbackOwed, demoTeachingLogbook } from "@/lib/teaching/demo-programme";
import { demoCpdReview } from "@/lib/teaching/depth-demo";
import {
  CPD_REVIEW_MAX_ROWS,
  cpdReviewBodySchema,
  FEEDBACK_PRIVACY_LINE,
  type CpdReviewResult,
  type CpdReviewRow,
  type SessionRef,
} from "@/lib/teaching/depth-model";
import type { LogbookRow } from "@/lib/teaching/model";
import { currentTerm, sampleTermTracker } from "@/lib/teaching/term-tracker";
import { useTermTrackerStore } from "@/lib/teaching/term-tracker-store";

/*
 * My record (mock-up v5 screen 03): the Term row, 12 weeks of check-ins, feedback you owe, this week's
 * sessions not yet in CPD, and counts for your supervisor, then every check-in by month. Replaces the
 * Logbook landing; Feedback, Weekly CPD review and Term stay as pages behind it. Counts only: nothing here
 * scores the doctor, and the CSV is built from rows already on screen, so it sends and stores nothing.
 */

/** Grey weekly bars, this week in plum, a dashed average labelled in words, and a dotted stub for none. */
function RecordBars({ chart }: { chart: RecordChart }) {
  const max = Math.max(1, ...chart.weeks.map((week) => week.count));
  return (
    <figure className="m-0 grid gap-1.5" data-testid="teaching-attendance-chart">
      <div
        role="img"
        aria-label={chart.description}
        className="relative mt-1.5 grid h-19 grid-cols-12 items-end gap-1.25"
      >
        {chart.weeks.map((week) => {
          const current = week.key === chart.currentKey;
          return (
            <i
              key={week.key}
              data-week={week.key}
              data-current={String(current)}
              className={cn(
                "relative block",
                week.count === 0 && !current
                  ? "rounded-none border-b-2 border-dotted border-[color:var(--decoration-soft)] forced-colors:border-[CanvasText]"
                  : current
                    ? "rounded-t-xs bg-[color:var(--mode-identity)] ring-[1.5px] ring-[color:var(--text-heading)] forced-colors:bg-[Highlight]"
                    : "rounded-t-xs bg-[color:var(--border)] forced-colors:bg-[CanvasText]",
              )}
              style={{ height: `${Math.max((week.count / max) * 100, 3)}%` }}
            />
          );
        })}
        {chart.average !== null ? (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 border-t border-dashed border-[color:var(--decoration-soft)]"
            style={{ bottom: `${(chart.average / max) * 100}%` }}
          >
            <span className="absolute right-0 -top-4.5 bg-[color:var(--surface-raised)] pl-1 text-2xs text-[color:var(--text-muted)]">
              {chart.averageLabel}
            </span>
          </span>
        ) : null}
      </div>
      <div aria-hidden="true" className="flex items-center justify-between text-2xs text-[color:var(--text-muted)]">
        {chart.axis.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <figcaption>
        <T5Meta>{chart.gapLine}</T5Meta>
      </figcaption>
    </figure>
  );
}

/** This week's attended sessions not in CPD yet, ticked by default, logged in one go. */
function CpdThisWeek({
  review,
  logbook,
  now,
  demoMode,
  onLogged,
}: {
  review: readonly CpdReviewRow[];
  logbook: readonly LogbookRow[];
  now: Date;
  demoMode: boolean;
  onLogged: () => void;
}) {
  const week = useMemo(() => cpdWeek(review, logbook, now), [review, logbook, now]);
  // Unticked rows are remembered rather than ticked ones, so a row that arrives later starts ticked.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  // One request id per row for the life of the page, so a retry after a partial save adds no duplicates.
  const [requestIds, setRequestIds] = useState<ReadonlyMap<string, string>>(new Map());
  const [results, setResults] = useState<CpdReviewResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logged = new Set(results.filter((r) => r.entryId !== null).map((r) => r.occurrenceId));
  const chosen = week.rows.filter((row) => !unticked.has(row.occurrenceId) && !logged.has(row.occurrenceId));

  return (
    <T5Section
      label="CPD this week"
      right={week.right ? <T5Meta>{week.right}</T5Meta> : null}
      testId="teaching-record-cpd"
    >
      {week.rows.length === 0 ? (
        <T5Meta className="border-t border-[color:var(--border)] py-2.5">
          Nothing from this week is waiting to go into your CPD.
        </T5Meta>
      ) : (
        <>
          <T5List ruled>
            {week.rows.map((row) => {
              const done = logged.has(row.occurrenceId);
              return (
                <T5Check
                  key={row.occurrenceId}
                  label={row.title}
                  meta={done ? `${row.meta} · saved to your CPD` : row.meta}
                  checked={done || !unticked.has(row.occurrenceId)}
                  disabled={busy || done}
                  onChange={(checked) =>
                    setUnticked((previous) => {
                      const next = new Set(previous);
                      if (checked) next.delete(row.occurrenceId);
                      else next.add(row.occurrenceId);
                      return next;
                    })
                  }
                  end={
                    <span className="shrink-0 text-sm font-normal text-[color:var(--text-heading)] tabular-nums">
                      {withUnit(row.hours, "h")}
                    </span>
                  }
                />
              );
            })}
          </T5List>
          <T5Actions className="mt-3">
            <Button
              type="button"
              variant="primary"
              block
              disabled={busy || chosen.length === 0 || chosen.length > CPD_REVIEW_MAX_ROWS}
              onClick={async () => {
                if (busy || chosen.length === 0 || chosen.length > CPD_REVIEW_MAX_ROWS) return;
                setError(null);
                const ids = new Map(requestIds);
                for (const row of chosen)
                  if (!ids.has(row.occurrenceId)) ids.set(row.occurrenceId, crypto.randomUUID());
                setRequestIds(ids);
                const parsed = cpdReviewBodySchema.safeParse({
                  rows: chosen.map((row) => ({
                    occurrenceId: row.occurrenceId,
                    hours: row.hours,
                    requestId: ids.get(row.occurrenceId),
                  })),
                });
                if (!parsed.success) {
                  setError("These could not be logged from here. Use Change hours to log them.");
                  return;
                }
                if (demoMode) {
                  setError("The demo doesn't save to CPD.");
                  return;
                }
                setBusy(true);
                try {
                  const result = await teachingPost<{ results: CpdReviewResult[] }>(
                    "/api/teaching/cpd/review",
                    parsed.data,
                  );
                  setResults((previous) => [
                    ...previous.filter((r) => !result.results.some((next) => next.occurrenceId === r.occurrenceId)),
                    ...result.results,
                  ]);
                  const failed = result.results.filter((r) => r.entryId === null);
                  if (failed.length > 0)
                    setError(
                      `${withUnit(failed.length, failed.length === 1 ? "session was" : "sessions were")} not saved${failed[0].message ? `: ${failed[0].message.replace(/\.?$/, ".")}` : "."} Use Change hours for ${failed.length === 1 ? "it" : "those"}.`,
                    );
                  if (failed.length < result.results.length) onLogged();
                } catch (cause) {
                  setError(
                    `${teachingErrorMessage(cause).replace("Nothing changed. ", "")} Some entries may have saved. Try again; this will not add duplicates.`,
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Saving…" : cpdButtonLabel(chosen.length)}
            </Button>
            <T5Link href="/teaching/review" quiet>
              Change hours
            </T5Link>
          </T5Actions>
          {chosen.length > CPD_REVIEW_MAX_ROWS ? (
            <p role="status" className="mt-2 text-sm text-[color:var(--text-heading)]">
              {`Choose up to ${withUnit(CPD_REVIEW_MAX_ROWS, "sessions")} at a time.`}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 text-sm text-[color:var(--text-heading)]">
              {error}
            </p>
          ) : null}
        </>
      )}
      {week.older > 0 ? (
        <T5List ruled className="mt-2">
          <T5Row
            title={`${withUnit(week.older, week.older === 1 ? "older session" : "older sessions")} not in CPD yet`}
            href="/teaching/review"
          />
        </T5List>
      ) : null}
      <T5Note className="mt-3">Your CPD log is private. Logged sessions show in CPD, under Log.</T5Note>
    </T5Section>
  );
}

function TeachingLogbookContent({ demoMode }: { demoMode: boolean }) {
  const now = useTeachingNow();
  const today = now ? perthDateKey(now) : null;
  const resource = useTeachingResource<{ attendance: LogbookRow[] }>(demoMode ? null : "/api/teaching?view=logbook");
  const feedback = useTeachingResource<{ sessions: SessionRef[] }>(
    demoMode ? null : "/api/teaching/depth?view=feedback-open",
  );
  const review = useTeachingResource<{ rows: CpdReviewRow[] }>(demoMode ? null : "/api/teaching/depth?view=cpd-review");
  const rows = useMemo(
    () => (demoMode ? (now ? demoTeachingLogbook(now) : null) : (resource.data?.attendance ?? null)),
    [demoMode, now, resource.data],
  );
  const owed = useMemo(
    () => (demoMode ? (now ? demoTeachingFeedbackOwed(now) : null) : (feedback.data?.sessions ?? null)),
    [demoMode, now, feedback.data],
  );
  const reviewRows = useMemo(
    () => (demoMode ? (now ? demoCpdReview(now) : null) : (review.data?.rows ?? null)),
    [demoMode, now, review.data],
  );
  const sample = useMemo(() => (demoMode && today ? sampleTermTracker(today) : null), [demoMode, today]);
  const { state: termState } = useTermTrackerStore(sample);
  const [logging, setLogging] = useState<LogbookRow | null>(null);
  const [demoNote, setDemoNote] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  // The demo's rows are made up, so nothing is ever sent to CPD from them.
  const onLog = demoMode ? () => setDemoNote(true) : setLogging;

  const term = termState && today ? termRow(termState, today) : null;
  const termRowEl = term ? (
    <T5List ruled testId="teaching-term-card">
      <T5Row title={term.title} meta={term.meta} lead={<T5Icon icon={CalendarDays} />} href="/teaching/term" />
    </T5List>
  ) : null;

  let body;
  if (resource.status === "signed-out") body = <TeachingSignInNotice />;
  else if (resource.status === "offline" || resource.status === "error" || resource.status === "setup")
    body = <TeachingStateNotice state={resource.status} onRetry={resource.retry} />;
  else if (!now || !today || !rows) body = <ModeModuleSkeleton rows={3} />;
  else {
    const chart = recordChart(rows, today);
    const summary = supervisorSummary(rows, termState ? currentTerm(termState) : null, today);
    body = (
      <>
        <T5Panel className="mt-3" testId="teaching-record-chart">
          <T5Kicker>Last 12 weeks · {withUnit(chart.total, chart.total === 1 ? "session" : "sessions")}</T5Kicker>
          <T5Heading>{chart.headline}</T5Heading>
          <RecordBars chart={chart} />
        </T5Panel>

        {owed === null ? (
          feedback.status === "loading" ? null : (
            <T5Section label="Feedback you owe">
              <T5Note tone="warning" icon="alert">
                Sessions waiting for your feedback did not load. <T5Link onClick={feedback.retry}>Try again</T5Link>
              </T5Note>
            </T5Section>
          )
        ) : owed.length > 0 ? (
          <T5Section
            label={`Feedback you owe · ${owed.length}`}
            right={<T5Meta>Name not shown</T5Meta>}
            testId="teaching-record-feedback"
          >
            <T5List ruled>
              {owed.map((session) => (
                <T5Row
                  key={session.occurrenceId}
                  title={session.title}
                  meta={feedbackMeta(session)}
                  lead={<T5Icon icon={GraduationCap} />}
                  end={
                    <T5Link href="/teaching/feedback" label={`Give feedback on ${session.title}`}>
                      Give
                    </T5Link>
                  }
                />
              ))}
            </T5List>
            <T5Meta className="mt-1.5">{FEEDBACK_PRIVACY_LINE}.</T5Meta>
          </T5Section>
        ) : null}

        {reviewRows === null ? (
          review.status === "loading" ? null : (
            <T5Section label="CPD this week">
              <T5Note tone="warning" icon="alert">
                Sessions waiting to go into your CPD did not load. <T5Link onClick={review.retry}>Try again</T5Link>
              </T5Note>
            </T5Section>
          )
        ) : (
          <CpdThisWeek
            review={reviewRows}
            logbook={rows}
            now={now}
            demoMode={demoMode}
            onLogged={() => {
              review.retry();
              resource.retry();
            }}
          />
        )}

        <T5Section label="For your supervisor" right={<T5Meta>Counts only</T5Meta>} testId="teaching-record-supervisor">
          <T5List ruled>
            <T5Row
              title={summary.title}
              meta={summary.meta}
              lead={<T5Icon icon={FileText} />}
              end={
                summary.rows.length ? (
                  <T5Link
                    href={csvHref(attendanceCsv(summary.rows))}
                    download={demoMode ? "teaching-attendance-demo.csv" : "teaching-attendance.csv"}
                  >
                    Download CSV
                  </T5Link>
                ) : undefined
              }
            />
            <T5Row
              title="Supervision hours"
              meta="Now under Presenting"
              lead={<T5Icon icon={Users} />}
              href="/teaching/teach#supervision"
            />
          </T5List>
        </T5Section>

        {rows.length === 0 ? (
          <T5Section label="Every check-in" testId="teaching-record-ledger">
            <T5Meta className="border-t border-[color:var(--border)] py-2.5">
              No check-ins yet. Sessions you check in to show here.
            </T5Meta>
          </T5Section>
        ) : (
          // The mock-up ends at the supervisor summary, so every check-in stays folded until asked for.
          <div className="mt-4.5" data-testid="teaching-record-ledger">
            <T5List ruled>
              <T5Row
                title="Every check-in"
                meta={`${withUnit(rows.length, rows.length === 1 ? "session" : "sessions")}, by month`}
                lead={<T5Icon icon={ListChecks} />}
                end={
                  <T5Link onClick={() => setLedgerOpen((open) => !open)} expanded={ledgerOpen}>
                    {ledgerOpen ? "Hide" : "Show"}
                  </T5Link>
                }
              />
            </T5List>
            {ledgerOpen ? (
              <div className="mt-2">
                {demoNote ? <T5Note className="mb-2">The demo doesn&apos;t save to CPD.</T5Note> : null}
                <LogbookLedger groups={logbookGroups(rows, onLog)} />
              </div>
            ) : null}
          </div>
        )}
        {logging ? (
          <LogToCpdSheet
            open
            onClose={() => setLogging(null)}
            occurrenceId={logging.occurrenceId}
            startsAt={logging.startsAt}
            endsAt={logging.endsAt}
            onLogged={() => {
              resource.retry();
              review.retry();
            }}
          />
        ) : null}
      </>
    );
  }
  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-logbook">
      <T5Page>
        <h1 className="sr-only">My record</h1>
        {demoMode ? (
          <T5Note className="mt-0 mb-3.5">Made-up demo. Changes stay on this page and are not saved.</T5Note>
        ) : null}
        {termRowEl}
        {body}
      </T5Page>
    </InformationPageShell>
  );
}

export function TeachingLogbook(props: { demoMode: boolean }) {
  return <TeachingAccountPage component={TeachingLogbookContent} {...props} />;
}
