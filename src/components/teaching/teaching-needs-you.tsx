"use client";

import { Award, History, Presentation, Star, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { withUnit } from "@/components/teaching/teaching-number";
import { presenterPrep } from "@/components/teaching/teaching-presenter-prep";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { cn } from "@/components/ui-primitives";
import { demoFeedbackOpen, demoTeach } from "@/lib/teaching/depth-demo";
import { type SessionRef, type TeachRead } from "@/lib/teaching/depth-model";

/*
 * Today's "Needs you" (work-mode redesign, owner request 6 Oct 2026): one row per thing the
 * reader owes, each an icon row with the one word that does it ("Prepare", "Log", "Give",
 * "Watch"), and nothing at all when they owe nothing (no empty module). Only counts and session
 * titles cross the wire. A failed read shows nothing rather than an error or a false zero: the
 * module is a nudge, and the page each row opens carries the same fact.
 *
 * Rows, in order: a talk the reader presents that is not ready yet, sessions to log to CPD,
 * feedback still open to give, and sessions in this week with no check-in recorded whose
 * materials can be caught up on. The Logbook tab is always one tap away, so there is no
 * separate "Open logbook" row.
 */

/** "Grand rounds", "Grand rounds and Case conference", "Grand rounds, Case conference and 1 more". */
export function sessionTitles(sessions: readonly { title: string }[]): string {
  const titles = [...new Set(sessions.map((session) => session.title))];
  if (titles.length <= 1) return titles[0] ?? "";
  if (titles.length === 2) return `${titles[0]} and ${titles[1]}`;
  return `${titles[0]}, ${titles[1]} and ${withUnit(titles.length - 2, "more")}`;
}

/** One owed thing: an icon circle, a title over a line, and the word for the tap, all one link. */
export function NeedsYouRow({
  href,
  icon: Icon,
  tone,
  title,
  sub,
  action,
}: {
  href: string;
  icon: LucideIcon;
  tone?: "amber";
  title: string;
  sub: string;
  /** The one word for what the tap does, drawn as a small pill inside the row's link. */
  action: string;
}) {
  return (
    <li className="min-w-0">
      <Link
        href={href}
        className={cn(
          "flex min-h-12 items-center gap-2.5 px-3 py-2.25 transition-colors active:bg-[color:var(--surface-wash)] motion-reduce:transition-none",
          focusRing,
        )}
      >
        <span aria-hidden="true" className="work-ic" data-tone={tone}>
          <Icon aria-hidden="true" strokeWidth={2} />
        </span>
        <span className="grid min-w-0 flex-1 gap-px">
          <span className="text-sm-minus leading-tight font-bold break-words text-[color:var(--text-heading)]">
            {title}
          </span>
          <span className="text-xs leading-snug break-words text-[color:var(--text-muted)]">{sub}</span>
        </span>
        <span
          className={cn(
            "inline-flex h-8 shrink-0 items-center rounded-full px-3.25 text-xs font-bold",
            tone === "amber"
              ? "border border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] text-[color:var(--warning-text)]"
              : "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
          )}
        >
          <span className="sr-only">: </span>
          {action}
        </span>
      </Link>
    </li>
  );
}

export function NeedsYou({ live, today, catchUp = 0 }: { live: boolean; today?: string; catchUp?: number }) {
  const unlogged = useTeachingResource<{ count: number }>(live ? "/api/teaching?view=unlogged-count" : null);
  const teach = useTeachingResource<TeachRead>(live ? "/api/teaching/depth?view=teach" : null);
  const feedback = useTeachingResource<{ sessions: SessionRef[] }>(
    live ? "/api/teaching/depth?view=feedback-open" : null,
  );
  const count = unlogged.data?.count ?? 0;
  const teachRead = live ? teach.data : today ? demoTeach(today) : null;
  const owed = live ? (feedback.data?.sessions ?? []) : today ? demoFeedbackOpen(today) : [];
  const prep = teachRead ? presenterPrep(teachRead, today ?? null) : null;

  const rows = [
    prep ? (
      <NeedsYouRow
        key="prep"
        href="/teaching/teach"
        icon={Presentation}
        title={prep.title}
        sub={prep.subtitle}
        action="Prepare"
      />
    ) : null,
    count > 0 ? (
      <NeedsYouRow
        key="log"
        href="/teaching/review"
        icon={Award}
        title={`Review & log ${withUnit(count, count === 1 ? "session" : "sessions")}`}
        sub="Attended, not yet in your CPD log"
        action="Log"
      />
    ) : null,
    owed.length > 0 ? (
      <NeedsYouRow
        key="feedback"
        href="/teaching/feedback"
        icon={Star}
        title={`Give feedback on ${withUnit(owed.length, owed.length === 1 ? "session" : "sessions")}`}
        sub={`${sessionTitles(owed)} · taps only`}
        action="Give"
      />
    ) : null,
    catchUp > 0 ? (
      <NeedsYouRow
        key="catch-up"
        href="/teaching/resources#catch-up"
        icon={History}
        title={`Catch up on ${withUnit(catchUp, catchUp === 1 ? "session" : "sessions")}`}
        sub="This week, no check-in recorded"
        action="Watch"
      />
    ) : null,
  ].filter(Boolean);

  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="teaching-needs-you-label" data-testid="teaching-needs-you" className="grid gap-y-2.25">
      <div className="work-label min-h-6 px-0.5">
        <h2 id="teaching-needs-you-label" className="m-0">
          Needs you
        </h2>
        <em className="work-label__count nums font-bold text-[color:var(--text-heading)]">
          <span className="sr-only">, </span>
          {rows.length}
        </em>
      </div>
      <ul role="list" className="work-card m-0 grid list-none divide-y divide-[color:var(--border)] p-0">
        {rows}
      </ul>
    </section>
  );
}

export { presenterPrep };
