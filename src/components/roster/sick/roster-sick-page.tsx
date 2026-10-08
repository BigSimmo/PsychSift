"use client";

import {
  CalendarClock,
  ChevronLeft,
  ClipboardCopy,
  Clock,
  ExternalLink,
  History,
  Info,
  Thermometer,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { focusRing } from "@/components/card-recipes";
import { ContextualBackLink } from "@/components/contextual-back-link";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { useRosterNow } from "@/components/roster/roster-format";
import {
  RosterFootnote,
  RosterLinkWord,
  RosterList,
  RosterNote,
  RosterRow,
  RosterSectionHead,
  rosterOutlineButton,
} from "@/components/roster/roster-list";
import { RosterPageHeader } from "@/components/roster/roster-ui";
import { useRosterSignedOutSample } from "@/components/roster/roster-sample-context";
import { postRosterAction } from "@/components/roster/use-roster-team";
import { cn } from "@/components/ui-primitives";
import { announce } from "@/components/ui/live-announcer";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";
import { inferShiftKind } from "@/lib/roster/shift-kind";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import {
  SICK_PHASE_TAG,
  isLiveReport,
  isShortNotice,
  managerWord,
  myReports,
  reportFor,
  sickButtonLabel,
  sickDayWord,
  sickDefaultPick,
  sickErrorWords,
  sickMessage,
  sickPageTitle,
  sickPhase,
  sickShiftTitle,
  sickTimeline,
  sickTimes,
  sickWindow,
  startsInWords,
  type SickShift,
} from "@/lib/roster/sick/sick-report";

import { SickAction } from "./sick-action";
import { SickShiftPicker } from "./sick-shift-picker";
import { SickTimeline } from "./sick-timeline";
import { useSickSend, type SickSendHow, type SickSendResult } from "./use-sick-send";
import { useSickShifts, type SickReportItem } from "./use-sick-shifts";

/**
 * I am sick for tomorrow (feature #5). One tap tells the team's roster
 * managers through the existing `open.report` action and puts the shift on the
 * team's open-shift list for the in-house pool; 10 seconds to undo before
 * anything goes; "Take back" afterwards with `open.cancel` while nobody has
 * been approved for it. No reason is asked for and nothing is kept on the
 * device. Shifts on the doctor's own roster copy only are listed honestly: the
 * app can't tell anyone about those.
 */

const subscribeOnline = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};
const onlineSnapshot = () => navigator.onLine;
const serverOnline = () => true;

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

type Outcome = { readonly tone: "done" | "warning"; readonly text: string } | null;

export function RosterSickPage({ now: pinnedNow }: { readonly now?: Date } = {}) {
  const now = useRosterNow(pinnedNow);
  const { zone } = useWorkTimeZone();
  const data = useSickShifts(now);
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, serverOnline);
  const signedOutSample = useRosterSignedOutSample();
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [failures, setFailures] = useState<readonly SickSendResult[]>([]);
  const [takingBack, setTakingBack] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // "Send when I'm back online": the picked shifts, held in memory while this page is open, never on the phone.
  const [queued, setQueued] = useState<readonly SickShift[] | null>(null);
  const sendWhenOnline = useRef<() => void>(() => undefined);
  const reload = data.reload;

  const ready = data.status === "ready" ? data : null;
  const live = useMemo(() => (ready ? myReports(ready.reports.map((item) => item.open)) : []), [ready]);
  const { from, to } = sickWindow(now);

  /** My reports for shifts today or tomorrow, in start order. */
  const sent: SickReportItem[] = useMemo(
    () =>
      ready
        ? ready.reports
            .filter((item) => live.includes(item.open))
            .filter((item) => {
              const day = perthDateOf(item.open.startsAt);
              return day >= from && day <= to;
            })
            .sort((a, b) => Date.parse(a.open.startsAt) - Date.parse(b.open.startsAt))
        : [],
    [ready, live, from, to],
  );

  /** Shifts not yet reported, not started, with any existing give-away offer noted. */
  const rows = useMemo(() => {
    if (!ready) return [];
    return ready.candidates
      .filter((shift) => Date.parse(shift.startsAt) > now.getTime())
      .map((shift) => {
        const opens = ready.reports.filter((item) => item.serviceId === shift.serviceId).map((item) => item.open);
        const existing = reportFor(opens, shift);
        return { shift, existing };
      })
      .filter(({ existing }) => !existing || (!existing.urgent && isLiveReport(existing)));
  }, [ready, now]);

  const pickable = rows.filter((row) => !row.existing).map((row) => row.shift);
  const defaultPick = sickDefaultPick(pickable, now);
  const pickedIds = picked ?? new Set(defaultPick ? [defaultPick.assignmentId] : []);
  const pickedShifts = pickable.filter((shift) => pickedIds.has(shift.assignmentId));

  const services = new Set(pickedShifts.map((shift) => shift.serviceId));
  const who =
    ready && services.size === 1
      ? managerWord(ready.managersByService.get([...services][0]!))
      : ready && pickable.length && new Set(pickable.map((shift) => shift.serviceId)).size === 1
        ? managerWord(ready.managersByService.get(pickable[0]!.serviceId))
        : "your roster managers";

  // The hold keeps the latest of this in a ref, so a plain function is enough.
  const onDone = (results: SickSendResult[], how: SickSendHow) => {
    const okCount = results.filter((result) => result.ok).length;
    const bad = results.filter((result) => !result.ok);
    setFailures(bad);
    // Sent shifts drop out of the list. Failed ones stay ticked to try again, and nothing else is ticked for the doctor.
    setPicked(new Set(bad.map((result) => result.shift.assignmentId)));
    if (okCount && !bad.length) {
      const when =
        how === "left" ? " when you left the page" : how === "online" ? " when your connection came back" : "";
      const told = `${capital(who)} ${who === "your roster managers" ? "are" : "is"} told.`;
      const text = `Sent at ${perthTimeOf(new Date())}${when}. ${told}${how === "left" || how === "online" ? " You can still take it back below." : ""}`;
      setOutcome({ tone: "done", text });
      announce(text);
    } else if (okCount) {
      const text = `${okCount} of ${results.length} sent. Phone your roster manager about the rest.`;
      setOutcome({ tone: "warning", text });
      announce(text, { priority: "assertive" });
    } else {
      const text = "Nothing was sent. Phone your roster manager.";
      setOutcome({ tone: "warning", text });
      announce(`${text} ${bad[0]?.error ?? ""}`, { priority: "assertive" });
    }
    reload();
  };
  const send = useSickSend(onDone);

  // Keep a sent report's progress current: on return to the page, and each
  // minute while a report is still waiting for cover.
  const waiting = sent.some((item) => isLiveReport(item.open));
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = waiting ? window.setInterval(onVisible, 60_000) : null;
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) window.clearInterval(timer);
    };
  }, [reload, waiting]);

  const title = sickPageTitle(pickedShifts.length ? pickedShifts : pickable, now);
  const heldShifts = send.held;
  const holding = send.secondsLeft !== null;
  const waitingShifts = send.waiting;
  const locked = holding || send.sending || queued !== null || waitingShifts.length > 0;

  const blockedReason = !ready
    ? null
    : ready.sample || signedOutSample
      ? "This is an example team, so nothing can be sent. Phone your roster manager to report sick."
      : !send.canSend
        ? "Sign in to send this. Until then, phone your roster manager."
        : waitingShifts.length
          ? "Your report above is waiting for a connection. Phone your roster manager as well."
          : !online
            ? "No connection, so nothing can be sent yet. Phone your roster manager if the shift is soon."
            : pickedShifts.length === 0
              ? "Pick at least one shift."
              : null;

  /** The button's second line: what pressing it does, or, when it can't, why. Never a promise it can't keep. */
  const blockedSub = !ready
    ? null
    : ready.sample || signedOutSample
      ? "Example team, so nothing is sent"
      : !send.canSend
        ? "Sign in to send"
        : waitingShifts.length
          ? "Your earlier report is still waiting to send"
          : !online
            ? "No connection right now"
            : pickedShifts.length === 0
              ? "Pick a shift first"
              : null;

  const shortNotice = pickedShifts.filter((shift) => isShortNotice(shift.startsAt, now));
  const timelineShifts = holding ? heldShifts : pickedShifts;

  /** Offline, but a report could still be held and sent once the signal is back. */
  const queueable =
    !online && send.canSend && !ready?.sample && !signedOutSample && !holding && !send.sending && !waitingShifts.length;
  const canQueue = queueable && pickedShifts.length > 0;

  useEffect(() => {
    sendWhenOnline.current = () => {
      const shifts = (queued ?? []).filter((shift) => Date.parse(shift.startsAt) > Date.now());
      setQueued(null);
      setOutcome(null);
      setFailures([]);
      if (!shifts.length) {
        // The shift started before the signal came back: say so, never let the queued note just vanish.
        const text = "Not sent. The shift has started. Phone your roster manager.";
        setOutcome({ tone: "warning", text });
        announce(text, { priority: "assertive" });
        return;
      }
      if (send.schedule(shifts)) announce(`Back online. Sending to ${who} in 10 seconds. Undo to stop it.`);
      else {
        const text = "Not sent. Phone your roster manager.";
        setOutcome({ tone: "warning", text });
        announce(text, { priority: "assertive" });
      }
    };
  });
  const isQueued = queued !== null;
  useEffect(() => {
    if (!isQueued) return;
    const onOnline = () => sendWhenOnline.current();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [isQueued]);

  function toggle(id: string) {
    if (locked) return;
    const next = new Set(pickedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
    setOutcome(null);
  }

  function press() {
    if (blockedReason) return;
    setOutcome(null);
    setFailures([]);
    if (send.schedule(pickedShifts)) announce(`Sending to ${who} in 10 seconds. Undo to stop it.`);
  }

  function undo() {
    if (!send.undo()) return;
    const words = heldShifts.map((shift) => sickShiftTitle(shift, now)).join(" and ");
    const text = `Not sent. Your ${words} ${heldShifts.length === 1 ? "is" : "are"} unchanged.`;
    setOutcome({ tone: "done", text });
    announce(text);
  }

  async function takeBack(item: SickReportItem) {
    if (takingBack) return;
    setTakingBack(item.open.id);
    const answer = await postRosterAction(item.serviceId, { action: "open.cancel", openShiftId: item.open.id });
    setTakingBack(null);
    if (!answer.ok) {
      const text = sickErrorWords(answer.code, answer.message);
      setOutcome({ tone: "warning", text });
      announce(text, { priority: "assertive" });
      return;
    }
    const text = `Taken back. Your ${sickShiftTitle(item.open, now)} is yours again.`;
    setOutcome({ tone: "done", text });
    announce(text);
    reload();
  }

  // Only what the doctor picked, plus reports that actually went through and are still live.
  const liveSent = sent.filter((item) => isLiveReport(item.open));
  const messageShifts = [
    ...pickedShifts.map((shift) => ({ ...shift, reported: false })),
    ...liveSent.map((item) => ({ ...item.open, reported: true })),
  ];
  const messageReported = liveSent.length > 0;

  async function copyMessage(message: string, key: string) {
    if (!message) return;
    try {
      await copyTextToClipboard(message);
      setCopied(key);
      announce("Message copied");
      window.setTimeout(() => setCopied(null), 2500);
    } catch {
      announce("Couldn't copy. Select the text instead.", { priority: "assertive" });
    }
  }

  const today = new Date(now);
  return (
    <InformationPageShell testId="roster-sick-page">
      <ContextualBackLink
        fallbackHref="/roster"
        data-testid="roster-sick-back"
        data-mode-identity="roster"
        className={cn(
          focusRing,
          "-ml-1 -mb-2 inline-flex min-h-12 w-fit items-center gap-1 text-sm font-medium text-[color:var(--mode-identity)] no-underline",
        )}
      >
        <ChevronLeft aria-hidden="true" className="size-icon-sm" />
        Roster
      </ContextualBackLink>
      <RosterPageHeader
        icon={Thermometer}
        eyebrow={new Intl.DateTimeFormat("en-AU", {
          timeZone: zone,
          weekday: "short",
          day: "numeric",
          month: "long",
        }).format(today)}
        title={title}
        subtitle="Tell your roster managers and put the shift up for cover."
      />
      <div className="grid min-w-0 gap-3" data-mode-identity="roster">
        {data.status === "loading" ? <ModeModuleSkeleton rows={3} twoLine eyebrow /> : null}
        {data.status === "error" || data.status === "not-confirmed" || data.status === "signed-out" ? (
          <div className="grid gap-2">
            <RosterNote icon={Info} role="alert">
              <p>{data.message}</p>
              <p>Phone your roster manager to report sick.</p>
            </RosterNote>
            {data.status === "error" ? (
              <button type="button" className={cn(rosterOutlineButton, "justify-self-start px-4")} onClick={reload}>
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
        {ready ? (
          <>
            {!online ? (
              <RosterNote icon={WifiOff} tone="warning" role="alert" testId="sick-offline">
                <p className="font-semibold">No connection</p>
                {queued ? null : queueable ? (
                  <p>
                    You can still pick shifts, and Send when I&apos;m back online sends them once you are, while this
                    page stays open. Your roster manager doesn&apos;t know yet, so phone if the shift is soon.
                  </p>
                ) : (
                  <p>Nothing can be sent from here until you are back online. Phone your roster manager instead.</p>
                )}
                {queued ? (
                  <div className="grid gap-1" data-testid="sick-queued">
                    <p>
                      Sends when you are back online, with 10 seconds to undo. Only while this page stays open, so phone
                      as well if the shift is soon.
                    </p>
                    <RosterLinkWord onClick={() => setQueued(null)} testId="sick-queue-cancel">
                      Don&apos;t send
                    </RosterLinkWord>
                  </div>
                ) : canQueue ? (
                  <button
                    type="button"
                    className={cn(rosterOutlineButton, "justify-self-start px-4")}
                    onClick={() => {
                      setQueued(pickedShifts);
                      announce("It will send when you are back online, with 10 seconds to undo.");
                    }}
                    data-testid="sick-queue"
                  >
                    Send when I&apos;m back online
                  </button>
                ) : null}
              </RosterNote>
            ) : null}

            {waitingShifts.length ? (
              <RosterNote icon={WifiOff} tone="warning" role="alert" testId="sick-waiting">
                <p className="font-semibold">Not sent yet</p>
                <p>
                  There was no connection when your report for{" "}
                  {waitingShifts.map((shift) => sickShiftTitle(shift, now)).join(" and ")} was due to go. It sends as
                  soon as you are back online, while this page stays open. Your roster manager doesn&apos;t know yet, so
                  phone as well.
                </p>
                <RosterLinkWord
                  onClick={() => {
                    if (send.cancelWaiting()) announce("Not sent. Your shift is unchanged.");
                  }}
                  testId="sick-waiting-cancel"
                >
                  Don&apos;t send
                </RosterLinkWord>
              </RosterNote>
            ) : null}

            {sent.length ? (
              <section className="grid gap-2" aria-labelledby="sick-sent-head">
                <RosterSectionHead
                  id="sick-sent-head"
                  title="Already sent"
                  right={
                    <span className="flex items-center gap-1 text-xs text-[color:var(--text-muted)]">
                      <span className="nums">Updated {perthTimeOf(ready.readAt)}</span>
                      <RosterLinkWord onClick={reload} label="Refresh the report status">
                        Refresh
                      </RosterLinkWord>
                    </span>
                  }
                />
                {sent.map((item) => (
                  <SentReport
                    key={item.open.id}
                    item={item}
                    now={now}
                    who={managerWord(ready.managersByService.get(item.serviceId))}
                    showTeam={ready.teams.length > 1}
                    busy={takingBack === item.open.id}
                    blocked={
                      ready.sample || signedOutSample
                        ? "This is an example team, so nothing can be taken back. Phone your roster manager."
                        : !online
                          ? "No connection, so it can't be taken back now. Phone your roster manager."
                          : null
                    }
                    onTakeBack={() => void takeBack(item)}
                  />
                ))}
              </section>
            ) : null}

            {ready.teams.length === 0 ? (
              <RosterNote icon={Info} testId="sick-no-team">
                <p className="font-semibold">No team roster yet</p>
                <p>
                  Sick reports go to your team&apos;s roster managers. Join your team to send one from here. Until then,
                  phone your manager.
                </p>
                <Link
                  href="/roster/join"
                  className="work-hit font-semibold text-[color:var(--mode-identity)] underline-offset-2 hover:underline"
                >
                  Join a team
                </Link>
              </RosterNote>
            ) : null}

            {rows.length ? (
              <section className="grid gap-2" aria-labelledby="sick-which-head">
                <RosterSectionHead
                  id="sick-which-head"
                  title="Which shift"
                  right={
                    pickedShifts.length > 1 ? (
                      <span className="nums text-xs text-[color:var(--text-muted)]">{pickedShifts.length} picked</span>
                    ) : undefined
                  }
                />
                <SickShiftPicker
                  disabled={locked}
                  onToggle={toggle}
                  rows={rows.map(({ shift, existing }) => ({
                    id: shift.assignmentId,
                    title: sickShiftTitle(shift, now),
                    sub: [sickTimes(shift), shift.siteName, ready.teams.length > 1 ? shift.teamName : null]
                      .filter(Boolean)
                      .join(" · "),
                    kind: shift.kind,
                    checked: pickedIds.has(shift.assignmentId),
                    locked: existing ? "Already offered to your team. Withdraw it on Swaps first." : null,
                  }))}
                />
                {rows.some((row) => row.existing) ? (
                  <RosterLinkWord href="/roster/swaps">Open Swaps</RosterLinkWord>
                ) : null}
              </section>
            ) : ready.teams.length > 0 && !sent.length ? (
              <div
                className={cn(modeModuleSurface, "grid justify-items-center gap-2 px-4 py-6 text-center shadow-none")}
                data-testid="sick-empty"
              >
                <CalendarClock aria-hidden="true" className="size-icon-lg text-[color:var(--text-muted)]" />
                <p className="text-base-minus font-semibold text-[color:var(--text-heading)]">
                  No shifts today or tomorrow
                </p>
                <p className="text-sm text-[color:var(--text-muted)]">
                  Nothing on your team roster starts before the end of tomorrow.
                </p>
                <Link
                  href="/roster/shifts"
                  className="min-h-12 content-center font-semibold text-[color:var(--mode-identity)] underline-offset-2 hover:underline"
                >
                  See my shifts
                </Link>
              </div>
            ) : null}

            {pickable.length ? (
              <>
                {shortNotice.length && !holding ? (
                  <RosterNote icon={Clock} tone="warning" testId="sick-short-notice">
                    <p className="font-semibold">
                      {sickDayWord(shortNotice[0]!.startsAt, now)} starts in{" "}
                      {startsInWords(shortNotice[0]!.startsAt, now)}
                    </p>
                    <p>
                      Short notice. Phone your roster manager as well, so the gap is found in time. The shift still goes
                      up as urgent.
                    </p>
                  </RosterNote>
                ) : null}
                <SickAction
                  label={sickButtonLabel(pickedShifts, now)}
                  sub={blockedSub ?? `Sends to ${who} · 10 s to undo`}
                  onPress={press}
                  disabledReason={blockedReason}
                  secondsLeft={send.secondsLeft}
                  heldTitle={`Sending to ${who}`}
                  onUndo={undo}
                  onSendNow={send.sendNow}
                  sending={send.sending}
                />
                {holding ? (
                  <RosterFootnote>
                    Leave this page or lock your phone and it sends straight away. You can still take it back here
                    afterwards.
                  </RosterFootnote>
                ) : null}
              </>
            ) : null}

            {outcome ? (
              <RosterNote
                icon={outcome.tone === "done" ? History : Info}
                tone={outcome.tone === "warning" ? "warning" : "neutral"}
                role={outcome.tone === "warning" ? "alert" : "status"}
                testId="sick-outcome"
              >
                <p>{outcome.text}</p>
                {failures.map((failure) => (
                  <p key={failure.shift.assignmentId}>
                    {sickShiftTitle(failure.shift, now)}: {failure.error}
                  </p>
                ))}
              </RosterNote>
            ) : null}

            {pickable.length ? (
              <section className="grid gap-2" aria-labelledby="sick-next-head">
                <RosterSectionHead id="sick-next-head" title="What happens next" />
                <SickTimeline steps={sickTimeline(holding ? "holding" : "plan", who)} testId="sick-plan" />
                {timelineShifts.length > 1 ? (
                  <RosterFootnote>All picked shifts go together, each marked urgent.</RosterFootnote>
                ) : null}
              </section>
            ) : null}

            {ready.personal.length ? (
              <section className="grid gap-2" aria-labelledby="sick-own-head">
                <RosterSectionHead id="sick-own-head" title="Not on a team roster" />
                <RosterList testId="sick-personal">
                  {ready.personal.map((shift) => (
                    <RosterRow
                      key={shift.id}
                      title={`${sickDayWord(shift.startsAt, now)} · ${shift.title}`}
                      sub={`${sickTimes(shift)}${shift.workplace ? ` · ${shift.workplace}` : ""}. On your own roster copy only, so PsychSift can't tell anyone. Phone your manager.`}
                      action={
                        <RosterLinkWord
                          onClick={() =>
                            void copyMessage(
                              sickMessage(
                                [
                                  {
                                    startsAt: shift.startsAt,
                                    endsAt: shift.endsAt,
                                    kind: inferShiftKind({
                                      startsAt: shift.startsAt,
                                      endsAt: shift.endsAt,
                                      title: shift.title,
                                    }),
                                    reported: false,
                                  },
                                ],
                                now,
                              ),
                              shift.id,
                            )
                          }
                          label={`Copy a message about ${sickDayWord(shift.startsAt, now)} · ${shift.title}`}
                          testId="sick-personal-copy"
                        >
                          {copied === shift.id ? "Copied" : "Copy message"}
                        </RosterLinkWord>
                      }
                    />
                  ))}
                </RosterList>
              </section>
            ) : null}
            {ready.personalFailed ? (
              <RosterNote icon={Info} testId="sick-personal-failed">
                <p>Your own roster copy couldn&apos;t be checked, so a shift may be missing here.</p>
              </RosterNote>
            ) : null}

            {messageShifts.length ? (
              <div className="grid gap-1.5">
                <button
                  type="button"
                  onClick={() => void copyMessage(sickMessage(messageShifts, now), "team")}
                  className={cn(rosterOutlineButton, "w-full")}
                  aria-describedby="sick-copy-note"
                  data-testid="sick-copy"
                >
                  <ClipboardCopy aria-hidden="true" className="size-icon-md" />
                  {copied === "team" ? "Copied" : "Copy a message for your manager"}
                </button>
                <p id="sick-copy-note" className="mx-1 text-xs text-[color:var(--text-muted)]">
                  {messageReported
                    ? "Names only the shifts you picked or reported. It says reported only for a report that went through."
                    : "Nothing is sent from here yet, so the message asks your manager to arrange cover."}
                </p>
              </div>
            ) : null}

            <RosterNote icon={Info} role="note">
              <p>
                No reason needed. PsychSift never asks for or keeps health details. Colleagues see only that a shift
                needs cover.
              </p>
            </RosterNote>
            <RosterList label="Personal leave">
              {/* Text first, then the link on its own line, so neither squeezes the other at 320 px or large text. */}
              <li className="grid min-w-0 gap-0.5 px-4 pb-1 pt-3" data-testid="sick-personal-leave">
                <span className="break-words text-base-minus font-semibold leading-5 text-[color:var(--text-heading)]">
                  Personal leave form
                </span>
                <span className="break-words text-sm leading-5 text-[color:var(--text-muted)]">
                  Lodge it in HR as usual. Your agreement sets what you can take.
                </span>
                <a
                  href={FATIGUE_RULE_SET.source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={cn(
                    focusRing,
                    "-ml-1 inline-flex min-h-12 w-fit max-w-full items-center gap-1 rounded-md px-1 text-sm font-semibold text-[color:var(--mode-identity)] no-underline",
                  )}
                  aria-label="Check your agreement (opens the WA Health AMA agreement PDF)"
                >
                  <span className="min-w-0 break-words">Check your agreement</span>
                  <ExternalLink aria-hidden="true" className="size-icon-sm shrink-0" />
                </a>
              </li>
            </RosterList>
          </>
        ) : null}
      </div>
    </InformationPageShell>
  );
}

function SentReport({
  item,
  now,
  who,
  showTeam,
  busy,
  blocked,
  onTakeBack,
}: {
  readonly item: SickReportItem;
  readonly now: Date;
  readonly who: string;
  readonly showTeam: boolean;
  readonly busy: boolean;
  /** Why Take back can't be used now, or null. */
  readonly blocked: string | null;
  readonly onTakeBack: () => void;
}) {
  const phase = sickPhase(item.open);
  const reasonId = `sick-take-back-reason-${item.open.id}`;
  const covered = phase === "covered";
  return (
    <article
      className={cn(modeModuleSurface, "grid shadow-none")}
      aria-label={`${sickShiftTitle(item.open, now)}: ${SICK_PHASE_TAG[phase]}`}
      data-testid="sick-sent"
    >
      <div className="flex min-h-14 items-center gap-3 px-4 py-2">
        <span className="grid min-w-0 flex-1">
          <span className="text-base-minus font-semibold text-[color:var(--text-heading)]">
            {sickShiftTitle(item.open, now)}
          </span>
          <span className="nums text-sm text-[color:var(--text-muted)]">
            {sickTimes(item.open)}
            {showTeam ? ` · ${item.teamName}` : ""}
          </span>
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
            covered
              ? "bg-[color:var(--success-soft)] text-[color:var(--success-text)]"
              : "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
          )}
        >
          {SICK_PHASE_TAG[phase]}
        </span>
      </div>
      <div className="border-t border-[color:var(--border)]">
        <SickTimeline steps={sickTimeline(phase, who)} framed={false} label="What happens next" />
      </div>
      {isLiveReport(item.open) ? (
        <div className="flex min-h-14 items-center gap-3 border-t border-[color:var(--border)] px-4 py-2">
          <span className="grid min-w-0 flex-1">
            <span className="text-sm font-semibold text-[color:var(--text-heading)]">Feeling better?</span>
            <span className="text-xs text-[color:var(--text-muted)]">
              Take it back while nobody has taken the shift
            </span>
          </span>
          <button
            type="button"
            className={cn(rosterOutlineButton, "shrink-0 px-4", blocked && "cursor-not-allowed")}
            onClick={busy || blocked ? undefined : onTakeBack}
            aria-disabled={busy || blocked ? "true" : undefined}
            aria-describedby={blocked ? reasonId : undefined}
            aria-busy={busy || undefined}
          >
            {busy ? "Taking back" : "Take back"}
          </button>
        </div>
      ) : null}
      {isLiveReport(item.open) && blocked ? (
        <p id={reasonId} className="px-4 pb-3 text-sm text-[color:var(--text)]">
          {blocked}
        </p>
      ) : covered ? (
        <p className="border-t border-[color:var(--border)] px-4 py-3 text-sm text-[color:var(--text-muted)]">
          Covered from the in-house pool. Your roster no longer shows this shift. Rest.
        </p>
      ) : null}
    </article>
  );
}
