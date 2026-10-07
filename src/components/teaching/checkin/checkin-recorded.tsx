"use client";

import { Award, BookOpen, Check, ClipboardList } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { perthDateKey, perthTime, shortDayLabel } from "@/components/teaching/teaching-dates";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";
import { attendanceLabels, type AttendanceMethod } from "@/lib/teaching/model";

/*
 * "Attendance recorded" (feature 9, mock-up nf_teach_recorded): the instant confirmation after a scan or a
 * typed code, and where the check-in went. It renders only after the server has recorded the check-in, so
 * it never claims one that did not happen. Three honest destinations: the doctor's Logbook (added now),
 * their private CPD log (only when they choose to log it, once the session ends; attendance never adds CPD
 * on its own) and the session register the organisers see.
 */

/** A check-in recorded more than two minutes before it was shown was already there: the scan added nothing. */
export const REPEAT_SCAN_MS = 2 * 60_000;

export function wasAlreadyCheckedIn(recordedAt: string, shownAt: Date | null): boolean {
  if (!shownAt) return false;
  const recorded = Date.parse(recordedAt);
  return Number.isFinite(recorded) && shownAt.getTime() - recorded > REPEAT_SCAN_MS;
}

function Destination({
  icon: Icon,
  title,
  detail,
  tag,
  href,
}: {
  icon: typeof Check;
  title: string;
  detail: string;
  tag: ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
      >
        <Icon aria-hidden="true" className="size-icon-sm" strokeWidth={1.75} />
      </span>
      <span className="grid min-w-0 flex-1 gap-px">
        <span className="text-sm font-medium text-[color:var(--text-heading)]">{title}</span>
        <span className="text-sm text-[color:var(--text-muted)]">{detail}</span>
      </span>
      {tag}
    </>
  );
  return (
    <li className="min-w-0 border-t border-[color:var(--border)] first:border-t-0">
      {href ? (
        <Link href={href} className={cn("flex min-h-12 items-center gap-3 rounded-sm py-2 no-underline", focusRing)}>
          {body}
        </Link>
      ) : (
        <div className="flex min-h-12 items-center gap-3 py-2">{body}</div>
      )}
    </li>
  );
}

function Tag({ children, done = false }: { children: ReactNode; done?: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-md px-2 py-0.5 text-2xs leading-4 font-semibold whitespace-nowrap forced-colors:border",
        done
          ? "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
          : "border border-[color:var(--border)] text-[color:var(--text-muted)]",
      )}
    >
      {children}
    </span>
  );
}

export function CheckinRecorded({
  title,
  startsAt,
  endsAt,
  venue,
  method,
  recordedAt,
  now,
  logged = false,
  onLogToCpd,
  live = true,
  showMethod = true,
}: {
  /** Null while the session's title has not loaded: the card still confirms, without a name. */
  title: string | null;
  startsAt: string | null;
  endsAt: string | null;
  venue?: string | null;
  method: AttendanceMethod;
  recordedAt: string;
  now: Date | null;
  /** Logged to CPD in this visit. */
  logged?: boolean;
  /** Opens the Log to CPD sheet; offered only once the session has ended. */
  onLogToCpd?: () => void;
  /** False in the demo, which saves nothing. */
  live?: boolean;
  /** False where the page already shows how the check-in was made (the session's phase module). */
  showMethod?: boolean;
}) {
  const ended = Boolean(endsAt && now && Date.parse(endsAt) <= now.getTime());
  const repeat = wasAlreadyCheckedIn(recordedAt, now);
  const when = [startsAt ? shortDayLabel(perthDateKey(startsAt)) : null, `checked in ${perthTime(recordedAt)}`, venue]
    .filter(Boolean)
    .join(" · ");
  const cpdDetail = logged
    ? "Logged. Your CPD log is private"
    : ended
      ? "Choose the hours. Attendance never adds CPD on its own"
      : endsAt
        ? `You can log it once it ends at ${perthTime(endsAt)}`
        : "You can log it once it ends";
  return (
    <section
      aria-labelledby="checkin-recorded-title"
      data-mode-identity="teaching"
      data-testid="checkin-recorded"
      className="grid gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3.5 forced-colors:border-[CanvasText]"
    >
      <div className="grid justify-items-center gap-1.5 text-center">
        <span
          aria-hidden="true"
          className="grid size-12 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
        >
          <Check aria-hidden="true" className="size-icon-lg" strokeWidth={2.25} />
        </span>
        <h2 id="checkin-recorded-title" className="text-base font-semibold text-[color:var(--text-heading)]">
          Attendance recorded
        </h2>
        {title ? <p className="text-sm font-medium text-[color:var(--text-heading)]">{title}</p> : null}
        <p className="nums text-sm font-normal text-[color:var(--text-muted)]">{when}</p>
        {showMethod ? <Tag done>{attendanceLabels[method]}</Tag> : null}
        {repeat ? (
          <p className="text-sm text-[color:var(--text-muted)]">
            You were already checked in. Nothing is added twice.
          </p>
        ) : null}
      </div>
      <div className="grid gap-1">
        <h3 className="text-2xs font-semibold tracking-label text-[color:var(--text-muted)] uppercase">
          Where it went
        </h3>
        <ul role="list" className="grid">
          <Destination
            icon={BookOpen}
            title="Teaching record"
            detail="In your Logbook"
            tag={<Tag done>Added</Tag>}
            href="/teaching/logbook"
          />
          <Destination
            icon={Award}
            title="CPD log"
            detail={cpdDetail}
            tag={<Tag done={logged}>{logged ? "Logged" : "To log"}</Tag>}
          />
          <Destination
            icon={ClipboardList}
            title="Session register"
            detail="Organisers see you checked in"
            tag={<Tag done>On the list</Tag>}
          />
        </ul>
      </div>
      {!logged && live ? (
        <div className="grid gap-1">
          <Button
            variant="primary"
            block
            disabled={!ended || !onLogToCpd}
            onClick={onLogToCpd}
            data-testid="checkin-recorded-log"
          >
            {ended ? "Log to CPD" : "Log to CPD after it ends"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
