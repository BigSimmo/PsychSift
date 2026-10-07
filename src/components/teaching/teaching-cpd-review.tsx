"use client";

import { Award } from "lucide-react";
import { useMemo, useState } from "react";
import { WorkButton } from "@/components/mode-kit/work";
import { T5Empty, T5Icon, T5List, T5Note, T5Row } from "@/components/teaching/t5-kit";
import {
  TeachingAccountPage,
  TeachingDepthPage,
  teachingStickySubmit,
} from "@/components/teaching/teaching-depth-page";
import { perthDateKey, perthTime, shortDayLabel } from "@/components/teaching/teaching-dates";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { Checkbox } from "@/components/ui/choice";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/components/ui-primitives";
import { teachingErrorMessage, teachingPost } from "@/lib/teaching/client";
import { demoCpdReview } from "@/lib/teaching/depth-demo";
import {
  CPD_REVIEW_MAX_ROWS,
  cpdReviewBodySchema,
  type CpdReviewRow,
  type CpdReviewResult,
} from "@/lib/teaching/depth-model";

function ReviewPage({ demoMode }: { demoMode: boolean }) {
  const now = useTeachingNow();
  const resource = useTeachingResource<{ rows: CpdReviewRow[] }>(
    demoMode ? null : "/api/teaching/depth?view=cpd-review",
  );
  const rows = useMemo(
    () => (demoMode && now ? demoCpdReview(now) : resource.data?.rows),
    [demoMode, now, resource.data],
  );
  const [chosen, setChosen] = useState<Record<string, { hours: string; requestId: string }>>({});
  const [results, setResults] = useState<CpdReviewResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logged = new Set(results.filter((row) => row.entryId !== null).map((row) => row.occurrenceId));
  const selected = Object.entries(chosen).filter(([id]) => !logged.has(id));
  const parsed = cpdReviewBodySchema.safeParse({
    rows: selected.map(([occurrenceId, value]) => ({
      occurrenceId,
      hours: Number(value.hours),
      requestId: value.requestId,
    })),
  });
  return (
    <TeachingDepthPage title="Weekly CPD review" demoMode={demoMode} resource={resource} ready={!!rows}>
      <T5Note tone="notice">
        <b className="block font-bold text-[color:var(--text-heading)]">You choose what counts</b>
        Choose the sessions and hours you want to log. Attendance does not award CPD credit. These entries are private
        to you. Your service cannot see your CPD figures.
      </T5Note>
      {rows?.length === 0 ? <T5Empty>No attended sessions waiting to be logged.</T5Empty> : null}
      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!parsed.success || busy) return;
          setError(null);
          if (demoMode) {
            setError("The demo does not save anything to CPD.");
            return;
          }
          setBusy(true);
          try {
            const result = await teachingPost<{ results: CpdReviewResult[] }>("/api/teaching/cpd/review", parsed.data);
            setResults((previous) => [
              ...previous.filter((row) => !result.results.some((next) => next.occurrenceId === row.occurrenceId)),
              ...result.results,
            ]);
          } catch (cause) {
            // A request can fail after earlier rows saved. Retain request ids and choices for safe retry.
            setError(
              `${teachingErrorMessage(cause).replace("Nothing changed. ", "")} Some entries may have saved. Retry with the same choices. This will not add duplicates.`,
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {rows?.length ? (
          <ul
            role="list"
            className="work-card m-0 grid list-none divide-y divide-[color:var(--border)] p-0"
            data-testid="teaching-review-rows"
          >
            {rows.map((row) => {
              const done = logged.has(row.occurrenceId);
              return (
                <li key={row.occurrenceId} className="grid gap-2 px-3 py-1">
                  <Checkbox
                    label={row.title}
                    description={`${row.serviceName} · ${shortDayLabel(perthDateKey(row.startsAt))} · ${perthTime(row.startsAt)}`}
                    disabled={busy || done}
                    checked={!!chosen[row.occurrenceId]}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setChosen((previous) => {
                        const next = { ...previous };
                        if (checked)
                          next[row.occurrenceId] = { hours: String(row.hours), requestId: crypto.randomUUID() };
                        else delete next[row.occurrenceId];
                        return next;
                      });
                    }}
                  />
                  {chosen[row.occurrenceId] && !done ? (
                    <TextField
                      label={`Hours for ${row.title}`}
                      type="number"
                      inputMode="decimal"
                      min="0.25"
                      max="8"
                      step="0.25"
                      required
                      disabled={busy}
                      value={chosen[row.occurrenceId].hours}
                      onChange={(event) => {
                        const hours = event.target.value;
                        setChosen((previous) => ({
                          ...previous,
                          [row.occurrenceId]: { ...previous[row.occurrenceId], hours },
                        }));
                      }}
                    />
                  ) : null}
                  {results
                    .filter((result) => result.occurrenceId === row.occurrenceId)
                    .map((result) => (
                      <p
                        key={result.occurrenceId}
                        role="status"
                        className={cn(
                          "pb-2 text-xs font-semibold",
                          result.entryId ? "text-[color:var(--success-text)]" : "text-[color:var(--danger-text)]",
                        )}
                      >
                        {result.entryId
                          ? "Saved to your private CPD log."
                          : (result.message ?? "Not saved. Try again.")}
                      </p>
                    ))}
                </li>
              );
            })}
          </ul>
        ) : null}
        {rows?.length ? (
          <div className={teachingStickySubmit}>
            {selected.length > CPD_REVIEW_MAX_ROWS ? (
              <p role="alert" className="text-xs font-semibold text-[color:var(--danger-text)]">
                Choose up to {CPD_REVIEW_MAX_ROWS} sessions at a time.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-xs font-semibold text-[color:var(--danger-text)]">
                {error}
              </p>
            ) : null}
            <WorkButton type="submit" size="wide" disabled={busy || !parsed.success}>
              {busy ? "Saving…" : "Log selected sessions to my CPD"}
            </WorkButton>
          </div>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : null}
      </form>
      <T5List>
        <T5Row
          lead={<T5Icon icon={Award} leadsTo="cme" />}
          title="Open my private CPD log"
          meta="In CPD, under Log"
          href="/cme/log"
        />
      </T5List>
    </TeachingDepthPage>
  );
}
export function TeachingCpdReview(props: { demoMode: boolean }) {
  return <TeachingAccountPage component={ReviewPage} {...props} />;
}
