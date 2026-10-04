"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeIconTile, modeModuleSurface } from "@/components/mode-kit/recipes";
import { RosterSentBar, type SentReceipt } from "@/components/roster/requests/roster-sent-bar";
import { kindOf, useRosterNow } from "@/components/roster/roster-format";
import { SwapAnswerCard } from "@/components/roster/swaps/swap-flow-sheet";
import { SwapProgressLine } from "@/components/roster/swaps/swap-progress-line";
import { RosterSampleNotice } from "@/components/roster/team/roster-sample-notice";
import { useRosterRead, useRosterTeams, postRosterAction } from "@/components/roster/use-roster-team";
import { useRosterShifts } from "@/components/roster/use-roster-shifts";
import { RosterSignInNotice } from "@/components/roster/invite/roster-sign-in-notice";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/components/ui-primitives";
import { SHIFT_KIND_LABEL, SHIFT_LETTER } from "@/lib/roster/shift-kind";
import { addDaysToDate, formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";
import { gradeRank, placementProblem } from "@/lib/roster/team/eligibility";
import type { RosterAction, RosterManageSwap, RosterOpenShift, RosterSwap } from "@/lib/roster/team/model";
import { requestStatusWords } from "@/lib/roster/team/request-status";
import { swapProgress } from "@/lib/roster/team/swap-progress";
import { ArrowLeftRight, CalendarOff, CheckCircle2, Plane } from "lucide-react";
import { RosterEmpty, RosterPageHeader, rosterField } from "@/components/roster/roster-ui";
import { RosterNewButton } from "@/components/roster/roster-new-button";
import { usePhoneFooterLayerScrollHidden } from "@/components/clinical-dashboard/phone-footer-layer-portal";

type TabId = "needs_you" | "sent" | "open" | "history" | "all";

const activeOpen = (item: RosterOpenShift) =>
  item.status === "reported" || item.status === "open" || item.status === "claimed";

function Row({
  letter,
  title,
  detail,
  children,
  action,
}: {
  letter: string;
  title: string;
  detail: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-center gap-3 border-b border-[color:var(--border)] px-3 py-3 last:border-0">
      <span aria-hidden="true" className={cn(modeIconTile, "shrink-0")}>
        {letter}
      </span>
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="truncate font-medium">{title}</p>
        <p className="text-sm text-[color:var(--text-muted)]">{detail}</p>
        {children}
      </div>
      {action}
    </li>
  );
}

/** How an ended swap ended, with its reason (declined, withdrawn, roster changed...). */
const endedWords = (swap: RosterSwap, progress: { ended: string | null }, meId: string, now: Date) =>
  progress.ended && swap.status !== "requested" ? requestStatusWords(swap, meId, now) : progress.ended;
/** Only a swap still waiting for an answer has an expiry worth showing. */
const expiryOf = (swap: RosterSwap, progress: { ended: string | null }) =>
  swap.status === "requested" && progress.ended === null ? swap.expiresAt : null;

const shiftDay = (swap: RosterSwap | RosterManageSwap) =>
  swap.give ? `${formatPerthDay(perthDateOf(swap.give.startsAt))} ${SHIFT_KIND_LABEL[swap.give.kind]}` : "a shift";
const returnLine = (swap: RosterSwap | RosterManageSwap) =>
  swap.take ? `For ${formatPerthDay(perthDateOf(swap.take.startsAt))}` : "No shift in return";

/** Swaps and open shifts for one team. Answers are session-only React state; nothing is stored on the device. */
export function RosterSwapsPage() {
  const now = useRosterNow();
  const phoneFooterHidden = usePhoneFooterLayerScrollHidden() === true;
  const teams = useRosterTeams();
  const ownShifts = useRosterShifts();
  const enabled = useMemo(() => teams.data?.teams.filter((team) => team.enabled) ?? [], [teams.data]);
  const actorId = teams.data?.actorId ?? null;
  // A link from My Day names the team it is about (`?team=`); it only selects among the teams the reader may use.
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : (new URLSearchParams(window.location.search).get("team") ?? null),
  );
  const serviceId =
    enabled.length > 1
      ? (enabled.find((team) => team.serviceId === selectedServiceId)?.serviceId ?? null)
      : (enabled[0]?.serviceId ?? null);
  const isManager = enabled.find((team) => team.serviceId === serviceId)?.role === "manager";
  const today = perthDateOf(now);
  const range = useMemo(() => ({ from: addDaysToDate(today, -7), to: addDaysToDate(today, 54) }), [today]);
  const overview = useRosterRead(serviceId, "overview");
  const assignments = useRosterRead(serviceId, "assignments", range);
  const requests = useRosterRead(serviceId, "requests");
  const manage = useRosterRead(isManager ? serviceId : null, "manage");
  const [tab, setTab] = useState<TabId>("needs_you");
  const [sent, setSent] = useState<SentReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hiddenOpenIds, setHiddenOpenIds] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    { kind: "withdraw"; swap: RosterSwap } | { kind: "take"; item: RosterOpenShift } | null
  >(null);
  const clearSent = useCallback(() => setSent(null), []);

  const reload = useCallback(() => {
    overview.reload();
    assignments.reload();
    requests.reload();
    manage.reload();
  }, [overview, assignments, requests, manage]);
  const onSent = useCallback(
    (message: string) => {
      setSent({ message });
      reload();
    },
    [reload],
  );

  async function openAction(item: RosterOpenShift, action: "open.claim" | "open.cancel") {
    if (!serviceId || !actorId) return;
    const rank = gradeRank(overview.data?.me.grade);
    const minimum = gradeRank(item.minGrade);
    if (action === "open.claim" && (rank === null || (minimum !== null && rank < minimum))) return;
    setBusyId(item.id);
    setError(null);
    const result = await postRosterAction(serviceId, { action, openShiftId: item.id } as RosterAction);
    setBusyId(null);
    if (!result.ok) {
      setError(result.code === "roster_open_shift_taken" ? "Someone else took this shift first." : result.message);
      if (result.code === "roster_open_shift_taken") setHiddenOpenIds((old) => [...old, item.id]);
      return;
    }
    onSent(action === "open.claim" ? "Asked to take the shift" : "Offer withdrawn");
  }

  async function swapAction(item: RosterSwap, action: "swap.cancel" | "swap.undo") {
    if (!serviceId || !actorId) return;
    setBusyId(item.id);
    setError(null);
    const result = await postRosterAction(serviceId, { action, swapId: item.id } as RosterAction);
    setBusyId(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSent(action === "swap.undo" ? "Swap undone" : "Swap withdrawn");
  }

  const swaps = requests.data?.swaps ?? [];
  const openShifts = requests.data?.openShifts ?? [];
  const myAssignments = assignments.data?.assignments ?? [];
  const ownPlacementRows =
    actorId && ownShifts.status === "ready"
      ? ownShifts.shifts
          .filter((item) => item.source !== "team")
          .map((item) => ({
            id: item.id,
            userId: actorId,
            startsAt: item.startsAt,
            endsAt: item.endsAt,
            kind: kindOf(item),
          }))
      : [];
  const actorGradeRank = gradeRank(overview.data?.me.grade);
  const eligibleOpen =
    actorId && ownShifts.status === "ready" && overview.status === "ready" && actorGradeRank !== null
      ? openShifts.filter((item) => {
          const minimum = gradeRank(item.minGrade);
          return (
            !item.mine &&
            item.status === "open" &&
            !item.claimedByMe &&
            !hiddenOpenIds.includes(item.id) &&
            (minimum === null || actorGradeRank >= minimum) &&
            !placementProblem(
              [...myAssignments, ...ownPlacementRows],
              actorId,
              item.startsAt,
              item.endsAt,
              [],
              overview.data?.settings.rules.minBreakHours ?? null,
            )
          );
        })
      : [];
  const myOpen = openShifts.filter((item) => item.mine || item.claimedByMe);
  const withProgress = actorId ? swaps.map((swap) => ({ swap, progress: swapProgress(swap, actorId, now) })) : [];
  const needsYou = withProgress.filter((entry) => entry.progress.tab === "needs_you");
  const sentSwaps = withProgress.filter((entry) => entry.progress.tab === "sent");
  const historySwaps = withProgress.filter((entry) => entry.progress.tab === "history");
  const openNow = myOpen.filter(activeOpen);
  const openEarlier = myOpen.filter((item) => !activeOpen(item));
  const teamSwaps = manage.data?.swaps ?? [];

  function undoable(item: RosterSwap) {
    return (
      item.status === "approved" &&
      item.autoApproved &&
      !!item.decidedAt &&
      now.getTime() < Date.parse(item.decidedAt) + 600_000
    );
  }

  function swapRow({ swap, progress }: (typeof withProgress)[number]) {
    const mine = swap.requesterId === actorId;
    return (
      <Row
        key={swap.id}
        letter="S"
        title={mine ? `Your ${shiftDay(swap)}` : `${swap.requesterName ?? "A colleague"} asks to swap`}
        detail={returnLine(swap)}
        action={
          <div className="grid gap-1">
            {mine && swap.status === "requested" && progress.ended === null ? (
              <Button size="sm" disabled={busyId === swap.id} onClick={() => setConfirm({ kind: "withdraw", swap })}>
                Withdraw
              </Button>
            ) : null}
            {undoable(swap) ? (
              <Button size="sm" disabled={busyId === swap.id} onClick={() => void swapAction(swap, "swap.undo")}>
                Undo
              </Button>
            ) : null}
          </div>
        }
      >
        <SwapProgressLine
          steps={progress.steps}
          waitingOn={progress.waitingOn}
          ended={endedWords(swap, progress, actorId!, now)}
          expiresAt={expiryOf(swap, progress)}
        />
      </Row>
    );
  }

  function openRow(item: RosterOpenShift) {
    return (
      <Row
        key={item.id}
        letter={SHIFT_LETTER[item.kind]}
        title={
          item.mine
            ? `Your ${formatPerthDay(perthDateOf(item.startsAt))} ${SHIFT_KIND_LABEL[item.kind].toLowerCase()}`
            : "Open shift you took"
        }
        detail={requestStatusWords(item, actorId!, now)}
        action={
          item.mine && (item.status === "open" || item.status === "reported") ? (
            <Button size="sm" disabled={busyId === item.id} onClick={() => void openAction(item, "open.cancel")}>
              Withdraw
            </Button>
          ) : null
        }
      />
    );
  }

  const empty = (text: string) => <RosterEmpty icon={CheckCircle2}>{text}</RosterEmpty>;
  const openCount = eligibleOpen.length + openNow.length;
  const items = [
    { id: "needs_you", label: "Needs you", count: needsYou.length },
    { id: "sent", label: "Sent", count: sentSwaps.length },
    { id: "open", label: "Open shifts", count: openCount },
    { id: "history", label: "History", count: historySwaps.length + openEarlier.length },
    ...(isManager ? [{ id: "all", label: "All team swaps", count: teamSwaps.length }] : []),
  ];
  const activeTab = items.some((item) => item.id === tab) ? tab : "needs_you";
  const ready = !!serviceId && !!actorId && requests.status === "ready";

  return (
    <InformationPageShell testId="roster-swaps-page" className={phoneFooterHidden ? "max-sm:pb-4" : "max-sm:pb-20"}>
      <RosterPageHeader
        icon={ArrowLeftRight}
        eyebrow="Roster"
        title="Swaps"
        subtitle={
          <>
            Swaps and open shifts. To start a swap, tap one of your shifts on the{" "}
            <Link href="/roster/team" className="underline underline-offset-2">
              Team calendar
            </Link>
            .
          </>
        }
        actions={
          <RosterNewButton
            entries={[
              ...(enabled.length > 0
                ? [
                    {
                      id: "swap",
                      label: "Swap or give away",
                      description: "Pick the shift on the Team calendar",
                      icon: ArrowLeftRight,
                      href: "/roster/team?view=week",
                    } as const,
                  ]
                : []),
              { id: "leave", label: "Plan leave", icon: Plane, href: "/roster/requests?start=leave" },
              { id: "dates", label: "Dates I can't work", icon: CalendarOff, href: "/roster/requests?start=dates" },
            ]}
          />
        }
      />
      <RosterSampleNotice sample={teams.data?.sample} />
      {enabled.length > 1 ? (
        <label className="grid max-w-sm gap-1 text-sm">
          Team
          <select
            value={selectedServiceId ?? ""}
            onChange={(event) => setSelectedServiceId(event.target.value || null)}
            className={rosterField}
          >
            <option value="">Choose a team</option>
            {enabled.map((team) => (
              <option value={team.serviceId} key={team.serviceId}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {enabled.length > 1 && !selectedServiceId ? <p>Choose a team to see its swaps.</p> : null}
      {teams.status === "loading" ? <p role="status">Loading your teams…</p> : null}
      {teams.status === "signed-out" ? (
        <RosterSignInNotice testId="roster-swaps-signed-out">Sign in to see your swaps.</RosterSignInNotice>
      ) : null}
      {teams.status === "not-confirmed" || teams.status === "unavailable" ? (
        <ModeNotice testId="roster-swaps-team-pending">
          {teams.status === "not-confirmed" && teams.message
            ? teams.message
            : "Team swaps aren\u2019t available yet. Try again later."}
        </ModeNotice>
      ) : null}
      {teams.status === "error" ? (
        <div role="alert" className="grid gap-2">
          <p>{teams.message}</p>
          <Button className="justify-self-start" onClick={teams.reload}>
            Try again
          </Button>
        </div>
      ) : null}
      {teams.status === "ready" && !enabled.length ? (
        <p>No confirmed team yet, so there are no swaps to show.</p>
      ) : null}
      {serviceId && (requests.status === "error" || assignments.status === "error" || overview.status === "error") ? (
        <div role="alert" className="grid gap-2">
          <p>The team roster couldn&apos;t be checked.</p>
          <Button className="justify-self-start" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : null}
      {serviceId && ownShifts.status === "error" ? (
        <p role="alert">Your own shifts couldn&apos;t be checked. Open shifts are hidden until they can be checked.</p>
      ) : null}
      {serviceId &&
      overview.status === "ready" &&
      actorGradeRank === null &&
      openShifts.some((item) => !item.mine && item.status === "open") ? (
        <p role="status">Add your grade in Your team before taking an open shift.</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <RosterSentBar receipt={sent} clear={clearSent} />
      {serviceId && actorId && requests.status === "loading" ? (
        <>
          <p role="status" className="sr-only">
            Loading swaps and open shifts…
          </p>
          <ModeModuleSkeleton rows={3} twoLine testId="roster-swaps-loading" />
        </>
      ) : null}
      {ready ? (
        <Tabs label="Swaps" items={items} value={activeTab} onChange={(id) => setTab(id as TabId)}>
          {activeTab === "needs_you" ? (
            needsYou.length ? (
              <ul className="grid gap-3">
                {needsYou.map(({ swap, progress }) => (
                  <li key={swap.id} className={cn(modeModuleSurface, "grid gap-2 p-3")}>
                    <p className="font-medium">{swap.requesterName ?? "A colleague"} asks to swap</p>
                    <SwapProgressLine
                      steps={progress.steps}
                      waitingOn={progress.waitingOn}
                      ended={progress.ended}
                      expiresAt={expiryOf(swap, progress)}
                    />
                    <SwapAnswerCard swap={swap} serviceId={serviceId!} actorId={actorId!} onDone={onSent} />
                  </li>
                ))}
              </ul>
            ) : (
              empty("Nothing needs you right now.")
            )
          ) : null}
          {activeTab === "sent" ? (
            sentSwaps.length ? (
              <ul className={modeModuleSurface}>{sentSwaps.map(swapRow)}</ul>
            ) : (
              empty("Nothing sent and waiting.")
            )
          ) : null}
          {activeTab === "open" ? (
            openCount ? (
              <ul className={modeModuleSurface}>
                {eligibleOpen.map((item) => (
                  <Row
                    key={item.id}
                    letter={SHIFT_LETTER[item.kind]}
                    title={`${formatPerthDay(perthDateOf(item.startsAt))} ${SHIFT_KIND_LABEL[item.kind]}`}
                    detail="The team needs someone. Open to take."
                    action={
                      <Button
                        size="sm"
                        disabled={busyId === item.id}
                        onClick={() => setConfirm({ kind: "take", item })}
                      >
                        Take it
                      </Button>
                    }
                  />
                ))}
                {openNow.map(openRow)}
              </ul>
            ) : (
              empty("No open shifts you can take.")
            )
          ) : null}
          {activeTab === "history" ? (
            historySwaps.length || openEarlier.length ? (
              <ul className={modeModuleSurface}>
                {historySwaps.map(swapRow)}
                {openEarlier.map(openRow)}
              </ul>
            ) : (
              empty("No earlier swaps.")
            )
          ) : null}
          {activeTab === "all" ? (
            manage.status === "error" ? (
              <p role="alert">{manage.message}</p>
            ) : teamSwaps.length ? (
              <ul className={modeModuleSurface}>
                {teamSwaps.map((swap) => {
                  const progress = swapProgress(swap, actorId!, now);
                  return (
                    <Row
                      key={swap.id}
                      letter="S"
                      title={`${swap.requesterName ?? "A colleague"} and ${swap.counterpartyName ?? "a colleague"}`}
                      detail={`${shiftDay(swap)}. ${returnLine(swap)}`}
                    >
                      <SwapProgressLine steps={progress.steps} waitingOn={progress.waitingOn} ended={progress.ended} />
                    </Row>
                  );
                })}
              </ul>
            ) : (
              empty("No swaps in this team yet.")
            )
          ) : null}
        </Tabs>
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const chosen = confirm;
          setConfirm(null);
          if (chosen?.kind === "withdraw") void swapAction(chosen.swap, "swap.cancel");
          else if (chosen?.kind === "take") void openAction(chosen.item, "open.claim");
        }}
        tone={confirm?.kind === "take" ? "primary" : "danger"}
        title={confirm?.kind === "take" ? "Take this shift?" : "Withdraw this swap?"}
        description={
          confirm?.kind === "take"
            ? `This asks to take the open ${SHIFT_KIND_LABEL[confirm.item.kind].toLowerCase()} shift on ${formatPerthDay(perthDateOf(confirm.item.startsAt))}.`
            : confirm?.kind === "withdraw"
              ? `This cancels your swap request for ${shiftDay(confirm.swap)}. To swap later, send a new request.`
              : ""
        }
        confirmLabel={confirm?.kind === "take" ? "Take shift" : "Withdraw swap"}
        cancelLabel={confirm?.kind === "take" ? "Cancel" : "Keep swap"}
      />
    </InformationPageShell>
  );
}
