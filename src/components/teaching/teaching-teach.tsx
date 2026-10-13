"use client";

import { useMemo, useRef, useState } from "react";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { modeNumberText } from "@/components/mode-kit/type";
import { TeachingAccountPage, TeachingDepthPage } from "@/components/teaching/teaching-depth-page";
import { perthDateKey, perthTime, shortDayLabel } from "@/components/teaching/teaching-dates";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { cn, textMuted } from "@/components/ui-primitives";
import { teachingErrorMessage, teachingPost } from "@/lib/teaching/client";
import { demoFeedbackTotals, demoTeach } from "@/lib/teaching/depth-demo";
import {
  feedbackPaceLabels,
  feedbackPaces,
  readinessItems,
  readinessLabels,
  teachingDepthUrl,
  type FeedbackTotals,
  type Readiness,
  type SessionRef,
  type TeachRead,
  type TeachSession,
} from "@/lib/teaching/depth-model";

/**
 * Totals as small horizontal bars in neutral tokens. The bars are decoration; each row also says its
 * label and count in words for a screen reader, and the count is printed beside the bar.
 */
function TotalsBars({ title, rows }: { title: string; rows: readonly { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <figure className="grid gap-1.5">
      <figcaption className="text-sm font-medium text-[color:var(--text-heading)]">{title}</figcaption>
      <ul role="list" className="grid gap-1">
        {rows.map((row) => (
          <li key={row.label} className="flex min-w-0 items-center gap-2 text-sm">
            <span className="sr-only">{`${row.label}: ${row.count}`}</span>
            <span aria-hidden="true" className={cn("w-24 shrink-0 truncate", textMuted)}>
              {row.label}
            </span>
            <span
              aria-hidden="true"
              className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[color:var(--surface-inset)]"
            >
              {/* An SVG width attribute, not an inline style: the share is data-driven (drift ratchet). */}
              <svg
                viewBox="0 0 100 1"
                preserveAspectRatio="none"
                className="block h-full w-full text-[color:var(--text-muted)] forced-colors:text-[CanvasText]"
              >
                <rect width={(row.count / max) * 100} height="1" fill="currentColor" />
              </svg>
            </span>
            <span aria-hidden="true" className={cn(modeNumberText, "w-8 shrink-0 text-right text-xs", textMuted)}>
              {row.count}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function FeedbackSummary({ session, demoMode }: { session: SessionRef; demoMode: boolean }) {
  const [open, setOpen] = useState(false);
  const resource = useTeachingResource<FeedbackTotals>(
    open && !demoMode
      ? teachingDepthUrl(session.serviceId, { action: "feedback.totals", occurrenceId: session.occurrenceId })
      : null,
  );
  const totals = demoMode ? demoFeedbackTotals() : resource.data;
  return (
    <section className="grid gap-2 border-b border-[color:var(--border)] py-3">
      <h3 className="text-base-minus font-medium text-[color:var(--text-heading)]">{session.title}</h3>
      <p className={cn("text-sm", textMuted)}>
        {shortDayLabel(perthDateKey(session.startsAt))} · {perthTime(session.startsAt)} Perth
      </p>
      <Button type="button" variant="secondary" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "Hide feedback" : "View feedback"}
      </Button>
      {open ? (
        <div>
          {!demoMode && ["error", "offline", "setup", "signed-out"].includes(resource.status) ? (
            <>
              <ModeNotice>Feedback could not load.</ModeNotice>
              <Button type="button" variant="secondary" onClick={resource.retry}>
                Try again
              </Button>
            </>
          ) : !totals ? (
            <ModeModuleSkeleton rows={3} testId="teaching-feedback-totals-loading" />
          ) : !totals.released ? (
            <ModeNotice>Feedback is not released yet. Individual answers and names are never shown here.</ModeNotice>
          ) : (
            <div className="grid gap-3" data-testid="teaching-feedback-totals">
              <p className={cn(modeNumberText, "text-sm text-[color:var(--text-heading)]")}>
                {totals.replies} anonymous replies
              </p>
              <TotalsBars
                title="Usefulness (1–5)"
                rows={(["1", "2", "3", "4", "5"] as const).map((rating) => ({
                  label: rating,
                  count: totals.useful[rating],
                }))}
              />
              <TotalsBars
                title="Pace"
                rows={feedbackPaces.map((value) => ({
                  label: feedbackPaceLabels[value],
                  count: totals.pace[value],
                }))}
              />
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function Preparation({
  session,
  demoMode,
  onSaved,
}: {
  session: TeachSession;
  demoMode: boolean;
  onSaved: () => void;
}) {
  const [local, setLocal] = useState<Readiness>({ items: session.items, deidConfirmedAt: session.deidConfirmedAt });
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Set when the reader confirms, so the note that replaces the button takes focus as it mounts.
  const focusDeid = useRef(false);
  // `localRef` is what the reader sees now; `confirmed` is the server's last answer; `queue` sends one write
  // at a time, in the order the reader made them.
  const localRef = useRef(local);
  const confirmed = useRef<Readiness>(local);
  const inFlight = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const busy = pending > 0;

  function show(next: Readiness) {
    localRef.current = next;
    setLocal(next);
  }

  // Optimistic: the box shows the reader's choice at once and the list stays usable, so focus never drops
  // and a second quick tap still counts. Writes queue so the server sees them in order. Once the last one
  // settles the screen shows the server's state: a failed tick rolls back and says so, and an answer that
  // predates a queued tick never unticks it.
  function save(body: Record<string, unknown>, change: (current: Readiness) => Readiness) {
    show(change(localRef.current));
    setError(null);
    const idle = inFlight.current === 0;
    inFlight.current += 1;
    setPending(inFlight.current);
    const write = async () => {
      try {
        confirmed.current = demoMode
          ? change(confirmed.current)
          : await teachingPost<Readiness>(teachingDepthUrl(session.serviceId), {
              ...body,
              occurrenceId: session.occurrenceId,
            });
        onSaved();
      } catch (cause) {
        setError(`Not saved. ${teachingErrorMessage(cause)}`);
      } finally {
        inFlight.current -= 1;
        setPending(inFlight.current);
        if (inFlight.current === 0) show(confirmed.current);
      }
    };
    // An idle queue sends at once; otherwise the write waits its turn.
    queue.current = idle ? write() : queue.current.then(write);
  }
  return (
    <section className={cn(modeModuleSurface, "grid gap-2 p-3")}>
      <h2 className="text-base-minus font-medium text-[color:var(--text-heading)]">{session.title}</h2>
      <p className={cn("text-sm", textMuted)}>
        {shortDayLabel(perthDateKey(session.startsAt))} · {perthTime(session.startsAt)} Perth ·{" "}
        {session.venue ?? "Room not set"}
      </p>
      {session.status === "cancelled" ? (
        <ModeNotice>This session is cancelled.</ModeNotice>
      ) : (
        <>
          <p className="text-sm">
            Prepare your aims and reading list outside PsychSift. Do not upload slides, patient details or Teams
            passcodes.
          </p>
          <fieldset className="grid gap-0.5">
            <legend className="mb-1 text-sm font-medium text-[color:var(--text-heading)]">Readiness</legend>
            {readinessItems.map((item) => (
              <Checkbox
                key={item}
                label={readinessLabels[item]}
                checked={local.items.includes(item)}
                onChange={(event) => {
                  const done = event.target.checked;
                  save({ action: "readiness.set", item, done }, (current) => ({
                    ...current,
                    items: done
                      ? [...current.items.filter((value) => value !== item), item]
                      : current.items.filter((value) => value !== item),
                  }));
                }}
              />
            ))}
          </fieldset>
          {local.deidConfirmedAt ? (
            <p
              tabIndex={-1}
              ref={(node) => {
                if (node && focusDeid.current) {
                  focusDeid.current = false;
                  node.focus();
                }
              }}
            >
              De-identification confirmed.
            </p>
          ) : (
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                focusDeid.current = true;
                save({ action: "readiness.deid.confirm" }, (current) => ({
                  ...current,
                  deidConfirmedAt: current.deidConfirmedAt ?? new Date().toISOString(),
                }));
              }}
            >
              I have checked that my material is de-identified
            </Button>
          )}
          <p role="status" className={cn("text-sm", textMuted, !busy && "sr-only")}>
            {busy ? "Saving…" : ""}
          </p>
          {error ? (
            <p role="alert" className="text-sm text-[color:var(--text-heading)]">
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function TeachPage({ demoMode }: { demoMode: boolean }) {
  const now = useTeachingNow();
  const resource = useTeachingResource<TeachRead>(demoMode ? null : "/api/teaching/depth?view=teach");
  const data = useMemo(
    () => (demoMode && now ? demoTeach(perthDateKey(now), now) : resource.data),
    [demoMode, now, resource.data],
  );
  return (
    <TeachingDepthPage title="Teach" demoMode={demoMode} resource={resource} ready={!!data}>
      {data?.upcoming.length === 0 ? (
        <ModeNotice>No sessions assigned to you. Ask your organiser to name you as presenter.</ModeNotice>
      ) : null}
      {data?.upcoming.map((session) => (
        <Preparation
          key={session.occurrenceId}
          session={session}
          demoMode={demoMode}
          onSaved={demoMode ? () => {} : resource.retry}
        />
      ))}
      {data ? <h2 className="text-base-minus font-medium text-[color:var(--text-heading)]">Taught before</h2> : null}
      {data?.taught.length === 0 ? <ModeNotice>No previous sessions.</ModeNotice> : null}
      {data?.taught.map((session) => (
        <FeedbackSummary key={session.occurrenceId} session={session} demoMode={demoMode} />
      ))}
    </TeachingDepthPage>
  );
}
export function TeachingTeach(props: { demoMode: boolean }) {
  return <TeachingAccountPage component={TeachPage} {...props} />;
}
