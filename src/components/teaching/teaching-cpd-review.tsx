"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { focusRing } from "@/components/card-recipes";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeInsetHairline, modeModuleSurface } from "@/components/mode-kit/recipes";
import {
  TeachingAccountPage,
  TeachingDepthPage,
  teachingStickySubmit,
} from "@/components/teaching/teaching-depth-page";
import { perthDateKey, perthTime, shortDayLabel } from "@/components/teaching/teaching-dates";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { TextField } from "@/components/ui/text-field";
import { cn, textMuted } from "@/components/ui-primitives";
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
      <ModeNotice>
        Choose the sessions and hours you want to log. Attendance does not award CPD credit. These entries are private
        to you. Your service cannot see your CPD figures.
      </ModeNotice>
      {rows?.length === 0 ? <ModeNotice>No attended sessions waiting to be logged.</ModeNotice> : null}
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
          <ul role="list" className={cn(modeModuleSurface, "grid")} data-testid="teaching-review-rows">
            {rows.map((row) => {
              const done = logged.has(row.occurrenceId);
              return (
                <li key={row.occurrenceId} className={cn(modeInsetHairline, "grid gap-2 px-3 py-1")}>
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
                      <p key={result.occurrenceId} role="status" className={cn("pb-2 text-sm", textMuted)}>
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
              <p role="alert" className="text-sm text-[color:var(--text-heading)]">
                Choose up to {CPD_REVIEW_MAX_ROWS} sessions at a time.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-[color:var(--text-heading)]">
                {error}
              </p>
            ) : null}
            <Button type="submit" variant="primary" block disabled={busy || !parsed.success}>
              {busy ? "Saving…" : "Log selected sessions to my CPD"}
            </Button>
          </div>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : null}
      </form>
      <Link
        href="/cme/log"
        className={cn(
          "inline-flex min-h-tap items-center self-start px-1 text-sm font-medium text-[color:var(--primary)]",
          focusRing,
        )}
      >
        Open my private CPD log
      </Link>
    </TeachingDepthPage>
  );
}
export function TeachingCpdReview(props: { demoMode: boolean }) {
  return <TeachingAccountPage component={ReviewPage} {...props} />;
}
