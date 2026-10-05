"use client";

import { Phone } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { OnCallTrackBar } from "@/components/on-call/kit/track-bar";
import { focusRing } from "@/components/card-recipes";
import { onCallLeadingIcon, onCallOutlineButton, onCallOutlineDisc } from "@/components/on-call/kit/calm";
import { modeNumberText } from "@/components/mode-kit/type";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { readOnCallYouCalled, rememberOnCallYouCalled, type OnCallYouCalled } from "@/lib/on-call/call-marks";
import {
  onCallCallMarksStorageKey,
  onCallDeviceStateChangedEvent,
  onCallDeviceStoreChangedEvent,
} from "@/lib/on-call/device-state-keys";
import { ON_CALL_YOU_CALLED_ENABLED } from "@/lib/on-call/feature-flags";
import { formatOnCallTime } from "@/lib/on-call/display-dates";
import { spokenOnCallNumber } from "@/lib/on-call/number-resolver";
import { onCallLadderStepMarkId, type OnCallNeedsYou } from "@/lib/on-call/now-rows";
function subscribeToMarks(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(onCallDeviceStoreChangedEvent, onChange);
  window.addEventListener(onCallDeviceStateChangedEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(onCallDeviceStoreChangedEvent, onChange);
    window.removeEventListener(onCallDeviceStateChangedEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
}
function marksSnapshot(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(onCallCallMarksStorageKey) ?? "";
  } catch {
    return "";
  }
}
/**
 * This shift's "You called" marks (ids and times only), re-read when a call is
 * recorded here, in another tab, or wiped at sign-out. Empty while the "You
 * called" line is switched off, so Needs you goes with it.
 */
export function useOnCallCallMarks(now: Date): readonly OnCallYouCalled[] {
  const raw = useSyncExternalStore(subscribeToMarks, marksSnapshot, () => "");
  return useMemo(() => (ON_CALL_YOU_CALLED_ENABLED && raw ? readOnCallYouCalled(now) : []), [raw, now]);
}
/** "6 min ago", "1 h 5 min ago": elapsed time only, never a deadline. */
function elapsed(calledAt: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(calledAt)) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h ago` : `${hours} h ${rest} min ago`;
}
/** The mark "They answered" leaves: a ladder id and a time, nothing else. */
export function onCallLadderAnsweredMarkId(ladderId: string): string {
  return `answered:${ladderId}`;
}
/** Whether the reader said the rung answered after this call was made. */
export function onCallNeedsYouAnswered(
  needs: OnCallNeedsYou | null,
  marks: readonly { readonly entryId: string; readonly calledAt: string }[],
): boolean {
  if (!needs) return false;
  const answered = marks.find((mark) => mark.entryId === onCallLadderAnsweredMarkId(needs.ladderId));
  return Boolean(answered && answered.calledAt >= needs.calledAt);
}
/**
 * "Escalating" (mock-up v10 Now): shown only while a call to a rung of a
 * ladder waits. It says who was rung and when, and, only when the hospital
 * recorded a wait for that rung, when the next step is suggested with a thin
 * bar of the wait used. "They answered" closes it on this phone; "Open the
 * ladder" goes to the ladder; the next rung stays one tap away below.
 *
 * It keeps no record: the time comes from the 12-hour "You called" mark, which
 * is an id and a time only. No overdue verdict is ever inferred.
 */
export function NowNeedsYou({
  needs,
  ladderHref,
  now: pageNow,
  live,
}: {
  readonly needs: OnCallNeedsYou | null;
  readonly ladderHref: string | null;
  readonly now: Date;
  /** False when the caller pinned the clock: the elapsed time then stays on that moment. */
  readonly live: boolean;
}) {
  // The page wakes only at period boundaries, so the minutes keep their own
  // clock, and only while the card is showing.
  const [tick, setTick] = useState<Date | null>(null);
  const showing = needs !== null;
  useEffect(() => {
    if (!showing || !live) return;
    const timer = setInterval(() => setTick(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [showing, live]);
  const now = live && tick && tick > pageNow ? tick : pageNow;
  if (!needs) return null;
  const { next } = needs;
  const tel = next.dial.tel;
  const calledMs = Date.parse(needs.calledAt);
  const waitEnds = needs.waitMinutes ? calledMs + needs.waitMinutes * 60_000 : null;
  const minutesLeft = waitEnds ? Math.max(0, Math.ceil((waitEnds - now.getTime()) / 60_000)) : null;
  const used =
    needs.waitMinutes && waitEnds
      ? Math.min(100, Math.max(0, ((now.getTime() - calledMs) / (needs.waitMinutes * 60_000)) * 100))
      : null;
  return (
    <section
      aria-labelledby="on-call-now-needs-you-heading"
      className="grid min-w-0 gap-2 px-3"
      data-testid="on-call-now-needs-you"
    >
      <div className="flex min-w-0 items-start gap-3" data-testid="on-call-now-needs-you-row">
        <Phone aria-hidden="true" strokeWidth={1.5} className={cn(onCallLeadingIcon, "mt-5")} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h2 id="on-call-now-needs-you-heading" className={eyebrowText}>
            {`Escalating · ${needs.ladderTitle}`}
          </h2>
          <p
            className={cn(modeNumberText, "break-words text-base-minus font-semibold text-[color:var(--text-heading)]")}
          >
            {`You called ${needs.waitingOn} at ${formatOnCallTime(needs.calledAt)}`}
          </p>
          <p className={cn(modeNumberText, "text-sm text-[color:var(--text-muted)]")}>
            {waitEnds && minutesLeft !== null
              ? `Next step suggested at ${formatOnCallTime(new Date(waitEnds).toISOString())} · ${minutesLeft} min · hospital-set wait`
              : elapsed(needs.calledAt, now)}
          </p>
        </div>
      </div>
      {used !== null ? <OnCallTrackBar percent={used} /> : null}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => rememberOnCallYouCalled(onCallLadderAnsweredMarkId(needs.ladderId))}
          data-testid="on-call-now-needs-you-answered"
          className={cn(onCallOutlineButton, focusRing)}
        >
          They answered
        </button>
        {ladderHref ? (
          <Link
            href={ladderHref}
            data-testid="on-call-now-needs-you-ladder"
            className={cn(onCallOutlineButton, focusRing)}
          >
            Open the ladder
          </Link>
        ) : null}
      </div>
      {tel ? (
        <a
          href={tel}
          onClick={() => rememberOnCallYouCalled(onCallLadderStepMarkId(needs.ladderId, next.order))}
          aria-label={`Call ${next.whoToCall}, the next rung, ${spokenOnCallNumber(next.dial.display)}`}
          data-testid="on-call-now-needs-you-call"
          className={cn(
            focusRing,
            "flex min-h-12 min-w-0 items-center justify-between gap-3 rounded-md text-sm text-[color:var(--text-muted)] no-underline",
          )}
        >
          <span className="min-w-0 break-words">
            {"Next: "}
            <span className="font-medium text-[color:var(--text-heading)]">{next.whoToCall}</span>
            <span className={modeNumberText}>{`, ${next.dial.display}`}</span>
          </span>
          <span aria-hidden="true" className={onCallOutlineDisc}>
            <Phone aria-hidden="true" strokeWidth={1.5} className="size-icon-md" />
          </span>
        </a>
      ) : null}
    </section>
  );
}
