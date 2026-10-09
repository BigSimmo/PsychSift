"use client";

import { Building2, CircleCheck, CircleHelp, Clock, Lock, Scale, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { useRosterNow } from "@/components/roster/roster-format";
import { postRosterAction } from "@/components/roster/use-roster-team";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import {
  endsNextDay,
  formatHours,
  gradeLabel,
  hoursBetween,
  isBrowsable,
  type OpenShiftListing,
} from "@/lib/open-shifts/model";
import { rosterCheckFor, type RosterCheck } from "@/lib/open-shifts/roster-check";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import type { RosterAction } from "@/lib/roster/team/model";

import { SignInAction } from "./open-shifts-sign-in";
import {
  FootAction,
  ListSkeleton,
  OPEN_SHIFTS_HREF,
  SubHeader,
  ToneIcon,
  checkSummary,
  formatDayLong,
  formatDayShort,
  formatShiftTimes,
  shiftTitle,
  startsIn,
} from "./open-shifts-ui";
import { useOpenShifts } from "./use-open-shifts";

const AGREEMENT = `clause 15 of the ${FATIGUE_RULE_SET.source.title.includes("2024") ? "2024 WA AMA agreement" : "WA AMA agreement"}`;

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3">
      <dt className="text-xs text-[color:var(--text-muted)]">{label}</dt>
      <dd className="text-sm font-medium nums text-[color:var(--text-heading)]">{value}</dd>
    </div>
  );
}

function InfoRow({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <li className="flex items-start gap-3 border-t border-[color:var(--border)] py-3.5 first:border-t-0">
      <span className="mt-0.5 shrink-0 text-[color:var(--text-muted)]">{icon}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-[color:var(--text-heading)]">{title}</span>
        {children ? <span className="text-sm text-[color:var(--text-muted)]">{children}</span> : null}
      </span>
    </li>
  );
}

function breakWords(check: Extract<RosterCheck, { state: "ok" | "flag" }>): string | null {
  const parts = [
    check.breakBefore !== null ? `At most ${formatHours(check.breakBefore)} break since your previous shift` : null,
    check.breakAfter !== null
      ? `${check.breakBefore !== null ? "at most" : "At most"} ${formatHours(check.breakAfter)} before your next one`
      : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join("; ")}.` : null;
}

/** The roster-check panel: neutral when nothing is flagged, amber a flag, red an overlap, grey when nothing could be checked. */
export function RosterCheckPanel({ check }: { check: RosterCheck }) {
  const { tone, text } = checkSummary(check);
  const border =
    tone === "ok"
      ? "border-[color:var(--border)]"
      : tone === "warn"
        ? "border-[color:var(--warning-border)]"
        : tone === "bad"
          ? "border-[color:var(--danger-border)]"
          : "border-[color:var(--border)]";
  const items: ReactNode[] = [];
  if (check.state === "ok") {
    const breaks = breakWords(check);
    if (breaks) items.push(breaks);
    items.push(
      `Busiest 14 days with this shift: at least ${formatHours(check.busiest14d).replace(" h", "")} of ${check.limit14d} h.`,
    );
    if (!check.nightsBefore) items.push("No nights in the week before.");
  } else if (check.state === "flag") {
    for (const warning of check.warnings) items.push(`${warning.words} (cl. ${warning.citation.clause})`);
    items.push("A flag never stops a request. Your roster manager still decides.");
  } else if (check.state === "overlap") {
    items.push(
      `Your rostered shift on ${formatDayShort(perthDateOf(check.withShift.startsAt))}, ${formatShiftTimes(check.withShift.startsAt, check.withShift.endsAt)}, overlaps this one by ${check.overlapMinutes} min.`,
    );
    items.push("An overlap is the only thing that stops a request. If your roster changes, this updates.");
  } else if (check.state === "clash-only") {
    items.push("Doesn't overlap anything on your PsychSift roster.");
    items.push(
      `Breaks, hours, shift length, nights and days off aren't checked: the fatigue rules are switched off. Check them yourself against ${AGREEMENT}.`,
    );
  } else if (check.state === "beyond") {
    items.push(
      `Your PsychSift roster ends ${formatDayShort(check.coveredUntil)}, so breaks and hours around this shift can't be checked.`,
    );
  } else if (check.state === "loading") {
    items.push("Your roster is still loading. Requests wait until it has been checked.");
  } else if (check.state === "unread") {
    items.push("Your roster couldn't be read, so clashes weren't checked. Try again before requesting.");
  } else {
    items.push("There's no PsychSift roster to compare this shift with.");
  }
  if ((check.state === "ok" || check.state === "flag" || check.state === "clash-only") && check.nothingNearby) {
    items.push("Your roster has nothing saved around this date. Check it's complete.");
  }
  return (
    <section
      aria-label="Roster check"
      className={`mx-3 rounded-lg border ${border} bg-[color:var(--surface-raised)] px-4 py-3.5`}
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
        <ToneIcon tone={tone} />
        {check.state === "flag" ? "Roster flag" : text}
      </h2>
      <ul className="mt-2 flex flex-col gap-1.5 text-sm text-[color:var(--text)]">
        {items.map((item, index) => (
          <li key={index} className="flex gap-2">
            <span aria-hidden="true" className="text-[color:var(--decoration-soft)]">
              ·
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
      {check.state === "none" || check.state === "beyond" ? (
        <Link
          href="/roster/shifts"
          className="mt-2 inline-flex min-h-12 items-center text-sm font-medium text-[color:var(--mode-identity)]"
        >
          {check.state === "beyond" ? "Update your roster" : "Add your roster"}
        </Link>
      ) : check.state === "ok" || check.state === "flag" ? (
        <p className="mt-2 text-xs text-[color:var(--text-muted)]">
          {`Your PsychSift roster, compared with ${AGREEMENT}. It can't see work outside PsychSift, so hours are "at least" and breaks "at most".`}
        </p>
      ) : null}
    </section>
  );
}

export function RequestSheet({
  listing,
  open,
  onClose,
  onSent,
}: {
  listing: OpenShiftListing;
  open: boolean;
  onClose: () => void;
  onSent: (status: string) => void;
}) {
  const [fit, setFit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The sheet stays mounted between opens, so each open starts unticked: the tick is never carried over.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setFit(false);
      setError(null);
    }
  }
  async function send() {
    setBusy(true);
    setError(null);
    const result = await postRosterAction(listing.serviceId, {
      action: "open.claim",
      openShiftId: listing.id,
    } as RosterAction);
    if (!result.ok) {
      // Busy clears only on failure, so a second tap can't send the request twice.
      setBusy(false);
      setError(
        result.code === "roster_open_shift_taken"
          ? "Someone else asked for this shift first. Nothing was sent for you."
          : `Not sent. ${result.message}`,
      );
      return;
    }
    onSent(result.result.status ?? "claimed");
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Send this request?"
      testId="open-shifts-request"
      footer={
        <div className="flex flex-col gap-2">
          <Button variant="primary" block disabled={!fit} busy={busy} busyLabel="Sending" onClick={() => void send()}>
            {fit ? "Yes, send request" : "Tick the box to continue"}
          </Button>
          <Button variant="ghost" block onClick={onClose}>
            Go back
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-md bg-[color:var(--surface-subtle)] px-4 py-3 text-sm">
          <p className="font-semibold text-[color:var(--text-heading)]">{shiftTitle(listing)}</p>
          <p className="nums text-[color:var(--text)]">{`${formatDayLong(perthDateOf(listing.startsAt))}, ${formatShiftTimes(listing.startsAt, listing.endsAt)}`}</p>
          <p className="text-[color:var(--text-muted)]">{listing.siteName ?? listing.teamName}</p>
        </div>
        <p className="text-sm text-[color:var(--text-muted)]">
          {`Your roster manager in ${listing.teamName} decides, unless your team approves same-level requests automatically. Until then it shows in My shifts as "Requested". They see your name and level, as for any Roster request; nothing else is shared.`}
        </p>
        <div className="flex min-h-12 items-start gap-3 border-t border-[color:var(--border)] pt-3">
          <input
            id="os-fit"
            type="checkbox"
            checked={fit}
            onChange={(event) => setFit(event.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-[color:var(--command)]"
          />
          <label htmlFor="os-fit" className="flex cursor-pointer flex-col">
            <span className="text-base-minus font-medium text-[color:var(--text-heading)]">
              I&apos;m fit to work this shift, and I&apos;ve checked it against the agreement&apos;s hours and break
              limits (clause 15)
            </span>
            <span className="text-xs text-[color:var(--text-muted)]">
              Including work that isn&apos;t on my PsychSift roster
            </span>
          </label>
        </div>
        {error ? (
          <p role="alert" className="text-sm font-medium text-[color:var(--danger-text)]">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

export function OpenShiftsAdvertPage({ serviceId, openShiftId }: { serviceId: string; openShiftId: string }) {
  const state = useOpenShifts();
  const now = useRosterNow();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Kept mounted after the first open so closing hands focus back to "Request this shift".
  const [sheetLoaded, setSheetLoaded] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const listing = state.listings.find((row) => row.serviceId === serviceId && row.id === openShiftId) ?? null;

  if (state.status === "loading") {
    return (
      <div className="mx-auto w-full max-w-reading" data-mode-identity="open-shifts">
        <SubHeader backHref={OPEN_SHIFTS_HREF} backLabel="Browse" title="Shift advert" />
        <ListSkeleton rows={4} />
      </div>
    );
  }
  if (!listing) {
    return (
      <div className="mx-auto w-full max-w-reading" data-mode-identity="open-shifts">
        <SubHeader backHref={OPEN_SHIFTS_HREF} backLabel="Browse" title="Shift advert" />
        <div className="px-3 py-8">
          <h2 className="text-base font-semibold text-[color:var(--text-heading)]">
            {state.status === "error" ? "This shift couldn't be loaded" : "This shift is no longer open"}
          </h2>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">
            {state.status === "error"
              ? "Nothing was sent. Try again when you're back online."
              : "It may have been filled, cancelled, or started. Nothing was sent for you."}
          </p>
          <Link
            href={OPEN_SHIFTS_HREF}
            className="mt-3 inline-flex min-h-12 items-center text-sm font-medium text-[color:var(--mode-identity)]"
          >
            Back to Browse
          </Link>
        </div>
      </div>
    );
  }

  const check = rosterCheckFor(
    { id: `open:${listing.id}`, startsAt: listing.startsAt, endsAt: listing.endsAt, kind: listing.kind },
    state.roster,
    state.rosterStatus,
    now,
  );
  const startDate = perthDateOf(listing.startsAt);
  const endDate = perthDateOf(listing.endsAt);
  const dateText = endsNextDay(listing.startsAt, listing.endsAt)
    ? `${formatDayShort(startDate)} – ${formatDayShort(endDate)}`
    : formatDayShort(startDate);
  const timeText = endsNextDay(listing.startsAt, listing.endsAt)
    ? `${perthTimeOf(listing.startsAt)}–${perthTimeOf(listing.endsAt)} next day`
    : formatShiftTimes(listing.startsAt, listing.endsAt);
  const alreadyMine = listing.claimedByMe || sent !== null;
  const sample = state.sample !== null;
  // A deep link or a list read earlier can still name a shift nobody can ask for now.
  const closed: string | null = alreadyMine
    ? listing.status === "cancelled" && sent === null
      ? "cancelled"
      : null
    : isBrowsable(listing, now)
      ? null
      : listing.mine
        ? "own"
        : listing.status === "expired" || Date.parse(listing.startsAt) <= now.getTime()
          ? "started"
          : listing.status === "cancelled"
            ? "withdrawn"
            : "taken";

  return (
    <div className="mx-auto w-full max-w-reading pb-6" data-mode-identity="open-shifts">
      <SubHeader backHref={OPEN_SHIFTS_HREF} backLabel="Browse" title="Shift advert" />
      <div className="px-3 pt-2 pb-4">
        <p className="text-xs text-[color:var(--text-muted)]">
          {[
            listing.kind === "night" ? "Night" : null,
            startsIn(listing.startsAt, now),
            `${gradeLabel(listing.minGrade)} level`,
            listing.urgent ? "Urgent" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <h2 className="mt-1 text-xl font-semibold text-[color:var(--text-heading)]">{shiftTitle(listing)}</h2>
        <p className="mt-1 text-sm text-[color:var(--text-muted)]">
          {[listing.siteName, listing.teamName].filter(Boolean).join(" · ")} · posted in Roster
        </p>
      </div>
      <dl className="mx-3 grid grid-cols-2 border-y border-[color:var(--border)] [&>div:nth-child(odd)]:border-r [&>div]:border-[color:var(--border)] [&>div:nth-child(n+3)]:border-t">
        <Fact label="Date" value={dateText} />
        <Fact label="Time" value={timeText} />
        <Fact label="Length" value={formatHours(hoursBetween(listing.startsAt, listing.endsAt))} />
        <Fact label="Shift code" value={listing.shiftCode} />
      </dl>

      <div className="mt-4">{sample || alreadyMine || closed ? null : <RosterCheckPanel check={check} />}</div>

      <ul className="mx-3 mt-4">
        <InfoRow
          icon={<Building2 aria-hidden="true" strokeWidth={1.6} className="size-icon-md" />}
          title={listing.siteName ?? "Site not named"}
        >
          {listing.teamName}
        </InfoRow>
        <InfoRow
          icon={<ShieldCheck aria-hidden="true" strokeWidth={1.6} className="size-icon-md" />}
          title={`${gradeLabel(listing.minGrade)} level or above`}
        >
          {listing.myGrade
            ? `Your level in this team: ${gradeLabel(listing.myGrade)}`
            : "Your level in this team isn't set, so the roster manager checks it."}
        </InfoRow>
        <InfoRow
          icon={<Users aria-hidden="true" strokeWidth={1.6} className="size-icon-md" />}
          title="Approved by your roster manager"
        >
          {`A roster manager in ${listing.teamName} approves or declines each request, unless the team approves same-level requests automatically.`}
        </InfoRow>
        <InfoRow
          icon={<Scale aria-hidden="true" strokeWidth={1.6} className="size-icon-md" />}
          title="Your entitlements"
        >
          Paid breaks, penalties and extended shift rates are set by the agreement and your health service. Check your
          payslip.
        </InfoRow>
      </ul>
      <div className="mx-3 mt-4 flex items-start gap-3 rounded-lg border border-dashed border-[color:var(--border-strong)] px-4 py-3">
        <Lock
          aria-hidden="true"
          strokeWidth={1.6}
          className="mt-0.5 size-icon-md shrink-0 text-[color:var(--text-muted)]"
        />
        <p className="text-sm text-[color:var(--text-muted)]">
          <b className="block font-semibold text-[color:var(--text-heading)]">Reporting details</b>
          Who to report to and where come from your team, as for any rostered shift.
        </p>
      </div>

      {state.sample === "signed-out" ? (
        <SignInAction label="Sign in to request shifts" />
      ) : closed ? (
        <FootAction>
          <div role="status" className="rounded-lg border border-[color:var(--border)] px-4 py-3 text-sm">
            <b className="block font-semibold text-[color:var(--text-heading)]">
              {closed === "cancelled"
                ? "Cancelled by the team"
                : closed === "own"
                  ? "You posted this shift"
                  : closed === "started"
                    ? "This shift has started"
                    : closed === "withdrawn"
                      ? "Closed by the team"
                      : "No longer open"}
            </b>
            <span className="text-[color:var(--text)]">
              {closed === "cancelled"
                ? "Your request closed with it. Ask your roster manager if you need to know why."
                : closed === "own"
                  ? "Doctors at the right level in the team can ask for it."
                  : closed === "started"
                    ? "It can't be requested now."
                    : closed === "withdrawn"
                      ? "The team no longer needs it covered. Nothing was sent for you."
                      : "Someone else has it now. Nothing was sent for you."}
            </span>
          </div>
          <Link
            href={closed === "cancelled" ? `${OPEN_SHIFTS_HREF}/mine` : OPEN_SHIFTS_HREF}
            className="inline-flex min-h-12 items-center justify-center text-sm font-medium text-[color:var(--mode-identity)]"
          >
            {closed === "cancelled" ? "Go to My shifts" : "Back to Browse"}
          </Link>
        </FootAction>
      ) : sample ? (
        <FootAction note="This is a made-up example: team rosters aren't open to real staff yet.">
          <Button variant="primary" block disabled>
            Request this shift
          </Button>
        </FootAction>
      ) : alreadyMine ? (
        <FootAction>
          <div
            role="status"
            className="flex items-start gap-3 rounded-lg border border-[color:var(--border)] px-4 py-3"
          >
            {sent === "approved" || listing.status === "approved" ? (
              <CircleCheck
                aria-hidden="true"
                strokeWidth={1.6}
                className="mt-0.5 size-icon-md shrink-0 text-[color:var(--mode-identity)]"
              />
            ) : (
              <Clock
                aria-hidden="true"
                strokeWidth={1.6}
                className="mt-0.5 size-icon-md shrink-0 text-[color:var(--text-muted)]"
              />
            )}
            <p className="text-sm text-[color:var(--text)]">
              {sent === "approved" || listing.status === "approved" ? (
                <>
                  <b className="block font-semibold text-[color:var(--text-heading)]">Approved</b>It&apos;s on your
                  roster now.
                </>
              ) : (
                <>
                  <b className="block font-semibold text-[color:var(--text-heading)]">Waiting for approval</b>
                  Your roster manager decides. You&apos;ll see it in My shifts.
                </>
              )}
            </p>
          </div>
          <Link
            href={`${OPEN_SHIFTS_HREF}/mine`}
            className="inline-flex min-h-12 items-center justify-center text-sm font-medium text-[color:var(--mode-identity)]"
          >
            Go to My shifts
          </Link>
        </FootAction>
      ) : state.offline ? (
        <FootAction note="Nothing has been sent. Try again when you're back online.">
          <Button variant="secondary" block disabled>
            Requests need a connection
          </Button>
        </FootAction>
      ) : check.state === "overlap" ? (
        <FootAction>
          <Button variant="secondary" block disabled>
            Overlaps your roster
          </Button>
        </FootAction>
      ) : check.state === "loading" || check.state === "unread" ? (
        <FootAction note={check.state === "loading" ? "Checking your roster first." : undefined}>
          {check.state === "unread" ? (
            <Button variant="secondary" block onClick={state.reload}>
              Try reading my roster again
            </Button>
          ) : (
            <Button variant="secondary" block disabled>
              Checking your roster…
            </Button>
          )}
        </FootAction>
      ) : (
        <FootAction note="Your roster manager decides. You'll confirm before anything is sent.">
          <Button
            variant="primary"
            block
            onClick={() => {
              setSheetLoaded(true);
              setSheetOpen(true);
            }}
          >
            Request this shift
          </Button>
        </FootAction>
      )}
      {check.state === "none" && !sample && !closed && !alreadyMine ? (
        <p className="flex items-center gap-2 px-3 text-xs text-[color:var(--text-muted)]">
          <CircleHelp aria-hidden="true" strokeWidth={1.6} className="size-icon-xs" />
          Without a roster, the check can&apos;t see clashes. Your roster manager still checks.
        </p>
      ) : null}

      {sheetLoaded ? (
        <RequestSheet
          listing={listing}
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onSent={(status) => {
            setSent(status);
            setSheetOpen(false);
            state.reload();
          }}
        />
      ) : null}
    </div>
  );
}
