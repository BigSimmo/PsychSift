"use client";

import { ChevronRight, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeInsetHairline, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { RosterSwapTicket } from "@/components/roster/requests/roster-swap-ticket";
import { useRosterNow } from "@/components/roster/roster-format";
import {
  loadSwapOptionsRead,
  ROSTER_ONLY_NOTE,
  type SwapOptionsLoad,
} from "@/components/roster/swaps/swap-options-loader";
import { Button, buttonFaceClass } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { swapOptions } from "@/lib/roster/team/swap-options";

/**
 * "Who can cover?" for one of my team shifts. Advice only: it reads the team
 * roster afresh, the same way the swap flow's "who" step does, and lists who
 * could take the shift and why the others can't. Nothing is sent from here;
 * tapping a colleague who can take it, or either link below, hands the shift to
 * Requests, where everything is checked again.
 */

const UNNAMED = "Name not available";
const ADVICE = "Advice only. Everything is checked again when you send a request.";

const grade = (value: string | null) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : "Grade not set");

/** The Requests hand-off for this shift; `start` is one Requests accepts, `person` a colleague to ask. */
export function rosterRequestHref(
  start: "swap" | "give_away",
  assignmentId: string,
  serviceId: string,
  person?: string,
): string {
  const params = new URLSearchParams({ start, assignment: assignmentId, team: serviceId });
  if (person) params.set("person", person);
  return `/roster/requests?${params.toString()}`;
}

export function RosterWhoCanCover({
  serviceId,
  assignmentId,
  actorId,
  startsAt,
  label = "Who can cover?",
  variant = "row",
}: {
  readonly serviceId: string;
  readonly assignmentId: string;
  /** The signed-in reader: the shift must still be theirs on the fresh read. */
  readonly actorId: string;
  /** The shift's start, so the read covers its weeks. Without it the weeks from this one are read. */
  readonly startsAt?: string;
  readonly label?: string;
  /** `button`: a bordered button (the next-shift card) instead of a list row. */
  readonly variant?: "row" | "button";
}) {
  const [open, setOpen] = useState(false);
  const sheet = (
    <Sheet open={open} onClose={() => setOpen(false)} title={label} mobilePlacement="bottom">
      {open ? (
        <CoverSession
          key={JSON.stringify([serviceId, assignmentId, actorId, startsAt ?? null])}
          serviceId={serviceId}
          assignmentId={assignmentId}
          actorId={actorId}
          startsAt={startsAt}
        />
      ) : null}
    </Sheet>
  );
  if (variant === "button")
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="roster-who-can-cover"
          className={cn(
            focusRing,
            modePressable,
            "inline-flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] px-4 text-base-minus font-semibold text-[color:var(--text-heading)]",
          )}
        >
          <Users aria-hidden="true" strokeWidth={1.6} className="size-icon-md text-[color:var(--text-muted)]" />
          {label}
        </button>
        {sheet}
      </>
    );
  return (
    <li className={cn(modeInsetHairline, "flex min-w-0 items-center pr-1")}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="roster-who-can-cover"
        className={cn(
          modeRowHeight.double,
          modePressable,
          focusRing,
          "flex min-w-0 flex-1 items-center gap-x-3 pl-3 pr-2 text-left",
        )}
      >
        <span className="grid min-w-0 flex-1 gap-0.5 py-1">
          <span className={cn(modeNameText, "break-words text-base-minus leading-5 text-[color:var(--text-heading)]")}>
            {label}
          </span>
          <span className={cn(modeSecondaryText, "break-words leading-5")}>See who&apos;s free for this shift</span>
        </span>
        <ChevronRight aria-hidden="true" className="ml-auto size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      </button>
      {sheet}
    </li>
  );
}

function CoverSession({
  serviceId,
  assignmentId,
  actorId,
  startsAt,
}: {
  serviceId: string;
  assignmentId: string;
  actorId: string;
  startsAt?: string;
}) {
  const now = useRosterNow();
  const [loaded, setLoaded] = useState<SwapOptionsLoad | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let current = true;
    const readAt = new Date();
    void loadSwapOptionsRead(serviceId, startsAt ?? readAt, readAt).then((result) => {
      if (current) setLoaded(result);
    });
    return () => {
      current = false;
    };
  }, [serviceId, startsAt, generation]);

  const fresh = loaded?.ok ? loaded.fresh : null;
  // My shift: it must be on the fresh roster read and still be mine. A shift handed to a
  // colleague since the page loaded reads as not found, never as the colleague's shift.
  const give = fresh?.assignments.find((row) => row.id === assignmentId && row.userId === actorId) ?? null;
  const options = useMemo(
    () =>
      fresh && give
        ? swapOptions({
            rows: fresh.assignments,
            give,
            me: { userId: actorId, grade: fresh.overview.me.grade },
            settings: fresh.overview.settings,
            now,
            members: fresh.members ?? undefined,
          })
        : null,
    [fresh, give, actorId, now],
  );

  function retry() {
    setLoaded(null);
    setGeneration((value) => value + 1);
  }

  if (!loaded) {
    return (
      <div className="grid gap-3">
        <p role="status" className={modeSecondaryText}>
          Checking the team roster…
        </p>
        <ModeModuleSkeleton rows={3} twoLine eyebrow />
      </div>
    );
  }

  if (!loaded.ok) {
    if (loaded.code === "roster_auth_required") return <ModeNotice>{loaded.message}</ModeNotice>;
    return (
      <div role="alert" className="grid gap-3">
        <p>{loaded.message}</p>
        <Button onClick={retry}>Try again</Button>
      </div>
    );
  }

  if (!give || !options) {
    return (
      <div className="grid gap-3">
        <ModeNotice>This shift wasn&apos;t found on the team roster.</ModeNotice>
        <Button onClick={retry}>Try again</Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <ModeNotice>{ADVICE}</ModeNotice>
      <RosterSwapTicket shift={give} label="Your shift" />
      {loaded.fresh.members ? null : <p className={modeSecondaryText}>{ROSTER_ONLY_NOTE}</p>}

      {options.can.length ? (
        <ModeGroupedList eyebrow="Can take it" testId="roster-who-can-cover-can">
          {options.can.map((choice) => (
            <ModeRow
              key={choice.userId}
              title={choice.name ?? UNNAMED}
              subtitle={`${grade(choice.grade)} · ${choice.sameGrade ? "same grade" : "higher grade"}`}
              href={rosterRequestHref("swap", assignmentId, serviceId, choice.userId)}
            />
          ))}
        </ModeGroupedList>
      ) : (
        <p>Nobody on the roster is free for this shift.</p>
      )}

      {options.cannot.length ? (
        <ModeGroupedList eyebrow="Can't take it" testId="roster-who-can-cover-cannot">
          {options.cannot.map((blocked) => (
            <ModeRow key={blocked.userId} title={blocked.name ?? UNNAMED} subtitle={blocked.words} />
          ))}
        </ModeGroupedList>
      ) : null}

      <div className="grid gap-2">
        <Link href={rosterRequestHref("swap", assignmentId, serviceId)} className={buttonFaceClass({ block: true })}>
          Ask to swap
        </Link>
        <Link
          href={rosterRequestHref("give_away", assignmentId, serviceId)}
          className={buttonFaceClass({ block: true })}
        >
          Give it away
        </Link>
      </div>
    </div>
  );
}
