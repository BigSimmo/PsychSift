"use client";

import { formatModeTime } from "@/components/mode-kit/dates";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { perthDateKey, shortDayLabel } from "@/components/teaching/teaching-dates";
import type { SessionSummaryRead } from "@/components/teaching/teaching-reads";
import { sessionHref } from "@/components/teaching/teaching-view-model";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { cn } from "@/components/ui-primitives";

/**
 * The reader's next teaching session, from Teaching's own `view=next-session`
 * read. Null while loading, with no session ahead, cancelled, or on any failure.
 */
export function useMyDayNextTeachingSession(): SessionSummaryRead | null {
  const { status, data } = useTeachingResource<{ session: SessionSummaryRead | null }>(
    "/api/teaching?view=next-session",
  );
  const session = status === "ready" ? (data?.session ?? null) : null;
  return session && session.status !== "cancelled" ? session : null;
}

export function MyDayNextTeaching({ session }: { readonly session: SessionSummaryRead | null }) {
  if (!session) return null;
  const day = shortDayLabel(perthDateKey(session.startsAt));
  const when = session.allDay ? day : `${day} · ${formatModeTime(session.startsAt)}`;
  const href = sessionHref(session) ?? "/teaching";
  return (
    <Link
      href={href}
      data-testid="my-day-module-teaching"
      className={cn(
        focusRing,
        "grid min-h-12 min-w-0 content-start gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2.5 no-underline",
      )}
    >
      <span className="break-words font-mono text-base-minus font-semibold nums leading-tight text-[color:var(--text-heading)]">
        {when}
      </span>
      <span className="break-words text-sm-minus text-[color:var(--text-muted)]">
        {`Next teaching · ${session.title}`}
      </span>
      {session.venue ? (
        <span className="break-words text-sm-minus text-[color:var(--text-muted)]">{session.venue}</span>
      ) : null}
    </Link>
  );
}
