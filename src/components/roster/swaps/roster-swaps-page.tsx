"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { RosterSentBar, type SentReceipt } from "@/components/roster/requests/roster-sent-bar";
import { kindOf, shiftTimes, useRosterNow } from "@/components/roster/roster-format";
import {
  RosterDateLead,
  RosterFootnote,
  RosterIconLead,
  RosterInitials,
  RosterLinkWord,
  RosterList,
  RosterNote,
  RosterRow,
  RosterSectionHead,
  rosterOutlineButton,
} from "@/components/roster/roster-list";
import { SwapAnswerCard } from "@/components/roster/swaps/swap-answer-card";
import { SwapProgressLine } from "@/components/roster/swaps/swap-progress-line";
import { RosterSampleNotice } from "@/components/roster/team/roster-sample-notice";
import { useRosterRead, useRosterTeams, postRosterAction } from "@/components/roster/use-roster-team";
import { useRosterShifts } from "@/components/roster/use-roster-shifts";
import { RosterSignInNotice } from "@/components/roster/invite/roster-sign-in-notice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/components/ui-primitives";
import { SHIFT_KIND_LABEL } from "@/lib/roster/shift-kind";
import { WEEKDAYS, addDaysToDate, formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";
import { gradeRank, placementProblem } from "@/lib/roster/team/eligibility";
import type { RosterAction, RosterManageSwap, RosterOpenShift, RosterSwap } from "@/lib/roster/team/model";
import { requestStatusWords } from "@/lib/roster/team/request-status";
import { swapProgress } from "@/lib/roster/team/swap-progress";
import { ArrowLeftRight, CalendarOff, CheckCircle2, HandHelping, Info, Plane, Users } from "lucide-react";
import { useModeBandCount, useModeBandHeading } from "@/components/mode-band/mode-band";
import { WorkButton, WorkCard, WorkEmpty } from "@/components/mode-kit/work";
import { RosterPageHeader, rosterField } from "@/components/roster/roster-ui";
import { RosterNewButton, useRosterNewButtonClearance } from "@/components/roster/roster-new-button";

const activeOpen = (item: RosterOpenShift) =>
  item.status === "reported" || item.status === "open" || item.status === "claimed";

/** How an ended swap ended, with its reason (declined, withdrawn, roster changed...). */
const endedWords = (swap: RosterSwap, progress: { ended: string | null }, meId: string, now: Date) =>
  progress.ended && swap.status !== "requested" ? requestStatusWords(swap, meId, now) : progress.ended;
/** Only a swap still waiting for an answer has an expiry worth showing. */
const expiryOf = (swap: RosterSwap, progress: { ended: string | null }) =>
  swap.status === "requested" && progress.ended === null ? swap.expiresAt : null;

const dayOf = (startsAt: string) => formatPerthDay(perthDateOf(startsAt));
/** `Thu 8 Oct day`. */
const shiftDay = (swap: RosterSwap | RosterManageSwap) =>
  swap.give ? `${dayOf(swap.give.startsAt)} ${SHIFT_KIND_LABEL[swap.give.kind].toLowerCase()}` : "a shift";
const returnLine = (swap: RosterSwap | RosterManageSwap) =>
  swap.take ? `For ${dayOf(swap.take.startsAt)}` : "No shift in return";
/** `08:30 to 17:00`, with "next day" when it ends after midnight. */
const timeRange = (item: { startsAt: string; endsAt: string }) => {
  const { start, end, plusOne } = shiftTimes(item);
  return `${start} to ${end}${plusOne ? " next day" : ""}`;
};
const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;

function TryAgainNote({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  return (
    <div className="grid gap-2">
      <RosterNote icon={Info} role="alert">
        <p>{children}</p>
      </RosterNote>
      <button type="button" className={cn(rosterOutlineButton, "justify-self-start px-4")} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function EmptyRow({ children }: { children: string }) {
  return (
    <RosterList>
      <RosterRow lead={<RosterIconLead icon={CheckCircle2} />} title={children} />
    </RosterList>
  );
}

/** Swaps and open shifts for one team. Answers are session-only React state; nothing is stored on the device. */
export function RosterSwapsPage() {
  const now = useRosterNow();
  const newButtonClearance = useRosterNewButtonClearance();
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
  const [showHistory, setShowHistory] = useState(false);
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
    if (!serviceId || !actorId || busyId === item.id) return;
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
    if (!serviceId || !actorId || busyId === item.id) return;
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
  const siteName = (siteId: string | null) =>
    siteId ? (overview.data?.sites.find((site) => site.id === siteId)?.name ?? null) : null;
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
  // Open shifts are only offered once both the team roster and your own shifts have been checked for clashes.
  const openChecked =
    !!actorId && ownShifts.status === "ready" && overview.status === "ready" && assignments.status === "ready";
  const eligibleOpen =
    openChecked && actorGradeRank !== null
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
    const title = mine
      ? swap.take
        ? `Swap your ${shiftDay(swap)} for ${dayOf(swap.take.startsAt)}`
        : `Give your ${shiftDay(swap)} to ${swap.counterpartyName ?? "a colleague"}`
      : swap.take
        ? `Swap your ${dayOf(swap.take.startsAt)} with ${swap.requesterName ?? "a colleague"}`
        : `Take ${swap.requesterName ?? "a colleague"}'s ${shiftDay(swap)}`;
    const agreedBy =
      swap.status === "accepted" && progress.waitingOn === "Your manager"
        ? mine
          ? (swap.counterpartyName ?? "Your colleague")
          : "You"
        : null;
    const canWithdraw = mine && swap.status === "requested" && progress.ended === null;
    return (
      <RosterRow
        key={swap.id}
        lead={<RosterIconLead icon={ArrowLeftRight} />}
        title={title}
        sub={
          <SwapProgressLine
            steps={progress.steps}
            waitingOn={progress.waitingOn}
            ended={endedWords(swap, progress, actorId!, now)}
            expiresAt={expiryOf(swap, progress)}
            agreedBy={agreedBy}
          />
        }
        action={
          canWithdraw || undoable(swap) ? (
            <span className="grid justify-items-end">
              {canWithdraw ? (
                <RosterLinkWord
                  label={`Withdraw swap for ${shiftDay(swap)}`}
                  onClick={() => (busyId === swap.id ? undefined : setConfirm({ kind: "withdraw", swap }))}
                >
                  Withdraw
                </RosterLinkWord>
              ) : null}
              {undoable(swap) ? (
                <RosterLinkWord
                  label={`Undo swap for ${shiftDay(swap)}`}
                  onClick={() => void swapAction(swap, "swap.undo")}
                >
                  Undo
                </RosterLinkWord>
              ) : null}
            </span>
          ) : undefined
        }
      />
    );
  }

  function openRow(item: RosterOpenShift) {
    const day = `${dayOf(item.startsAt)} ${SHIFT_KIND_LABEL[item.kind].toLowerCase()}`;
    const canWithdraw = item.mine && (item.status === "open" || item.status === "reported");
    return (
      <RosterRow
        key={item.id}
        lead={<RosterIconLead icon={HandHelping} />}
        title={item.mine ? `Give away ${day}` : `Take the open ${day}`}
        sub={requestStatusWords(item, actorId!, now)}
        action={
          canWithdraw ? (
            <RosterLinkWord label={`Withdraw offer of ${day}`} onClick={() => void openAction(item, "open.cancel")}>
              Withdraw
            </RosterLinkWord>
          ) : undefined
        }
      />
    );
  }

  function waitingCard({ swap, progress }: (typeof withProgress)[number]) {
    const iAnswer = swap.counterpartyId === actorId;
    const expires = expiryOf(swap, progress);
    const who = swap.requesterName ?? null;
    return (
      <div key={swap.id} className={cn(modeModuleSurface, "grid min-w-0 gap-3 p-4 shadow-none")}>
        <div className="flex min-w-0 items-center gap-3">
          {who ? <RosterInitials name={who} /> : <RosterIconLead icon={ArrowLeftRight} />}
          <span className="grid min-w-0">
            <span className="break-words text-base-minus font-semibold leading-5 text-[color:var(--text-heading)]">
              {iAnswer
                ? `${who ?? "A colleague"} asks to swap`
                : `${who ?? "A colleague"} and ${swap.counterpartyName ?? "a colleague"} agreed a swap`}
            </span>
            <span className="nums text-sm leading-5 text-[color:var(--text-muted)]">
              {iAnswer
                ? expires
                  ? `Answer by ${dayOf(expires)}`
                  : "Waiting on you"
                : "Waiting on you to approve it in Manage"}
            </span>
          </span>
        </div>
        <SwapAnswerCard swap={swap} serviceId={serviceId!} actorId={actorId!} onDone={onSent} />
        {iAnswer ? (
          <RosterFootnote>
            {swap.needsManagerBecause
              ? "Your roster only changes if you both agree and your manager approves."
              : "Your roster only changes if you both agree."}
          </RosterFootnote>
        ) : (
          <Link
            href="/roster/manage"
            className={cn(
              focusRing,
              "mx-1 inline-grid min-h-12 items-center justify-self-start text-sm font-medium text-[color:var(--mode-identity)]",
            )}
          >
            Open Manage to approve or decline
          </Link>
        )}
      </div>
    );
  }

  const ready = !!serviceId && !!actorId && requests.status === "ready";
  // The band's eyebrow and the Swaps tab count (mockup `rost_swaps`), only from loaded swaps.
  const answerWords = needsYou.length ? `${needsYou.length} to answer` : "Nothing to answer";
  const sentWords = sentSwaps.length ? ` · ${sentSwaps.length} sent` : "";
  useModeBandHeading(ready ? { eyebrow: `${answerWords}${sentWords}` } : null);
  useModeBandCount("swaps", ready ? needsYou.length || null : null);

  return (
    <InformationPageShell testId="roster-swaps-page" className={newButtonClearance}>
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
      <div className="grid min-w-0 gap-3" data-mode-identity="roster">
        <RosterSampleNotice sample={teams.data?.sample} />
        {enabled.length > 1 ? (
          <label className="grid max-w-sm gap-1 text-sm text-[color:var(--text-muted)]">
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
        {enabled.length > 1 && !selectedServiceId ? (
          <RosterNote icon={Info}>
            <p>Choose a team to see its swaps.</p>
          </RosterNote>
        ) : null}
        {teams.status === "loading" ? (
          <p role="status" className="mx-1 text-sm text-[color:var(--text-muted)]">
            Loading your teams…
          </p>
        ) : null}
        {teams.status === "signed-out" ? (
          <RosterSignInNotice testId="roster-swaps-signed-out">Sign in to see your swaps.</RosterSignInNotice>
        ) : null}
        {teams.status === "not-confirmed" || teams.status === "unavailable" ? (
          <ModeNotice testId="roster-swaps-team-pending">
            {teams.status === "not-confirmed" && teams.message
              ? teams.message
              : "Team swaps aren’t available yet. Try again later."}
          </ModeNotice>
        ) : null}
        {teams.status === "error" ? <TryAgainNote onRetry={teams.reload}>{teams.message}</TryAgainNote> : null}
        {teams.status === "ready" && !enabled.length ? (
          <WorkCard testId="roster-swaps-no-team">
            <WorkEmpty
              icon={Users}
              title="No team yet"
              body="No confirmed team yet, so there are no swaps to show. Swaps happen inside a roster team: join one with the invite link or code from your roster manager."
              action={
                <WorkButton icon={Users} href="/roster/join">
                  Join a team
                </WorkButton>
              }
            />
          </WorkCard>
        ) : null}
        {teams.status === "ready" && serviceId && !actorId ? (
          <TryAgainNote onRetry={teams.reload}>
            Your place on the team couldn&apos;t be confirmed, so swaps can&apos;t be shown.
          </TryAgainNote>
        ) : null}
        {serviceId && (requests.status === "error" || assignments.status === "error" || overview.status === "error") ? (
          <TryAgainNote onRetry={reload}>The team roster couldn&apos;t be checked.</TryAgainNote>
        ) : null}
        {error ? (
          <RosterNote icon={Info} tone="warning" role="alert">
            <p>{error}</p>
          </RosterNote>
        ) : null}
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
          <>
            <section aria-labelledby="roster-swaps-waiting" className="grid min-w-0 gap-3">
              <RosterSectionHead id="roster-swaps-waiting" title="Waiting on you" />
              {needsYou.length ? needsYou.map(waitingCard) : <EmptyRow>Nothing needs you right now</EmptyRow>}
            </section>

            <section aria-labelledby="roster-swaps-sent" className="grid min-w-0 gap-3">
              <RosterSectionHead
                id="roster-swaps-sent"
                title="You sent"
                right={
                  <RosterLinkWord expanded={showHistory} onClick={() => setShowHistory((open) => !open)}>
                    History
                  </RosterLinkWord>
                }
              />
              {sentSwaps.length || openNow.length ? (
                <RosterList label="You sent">
                  {sentSwaps.map(swapRow)}
                  {openNow.map(openRow)}
                </RosterList>
              ) : (
                <EmptyRow>Nothing sent and waiting</EmptyRow>
              )}
            </section>

            {showHistory ? (
              <section aria-labelledby="roster-swaps-history" className="grid min-w-0 gap-3">
                <RosterSectionHead id="roster-swaps-history" title="History" />
                {historySwaps.length || openEarlier.length ? (
                  <RosterList label="History">
                    {historySwaps.map(swapRow)}
                    {openEarlier.map(openRow)}
                  </RosterList>
                ) : (
                  <EmptyRow>No earlier swaps</EmptyRow>
                )}
              </section>
            ) : null}

            <section aria-labelledby="roster-swaps-open" className="grid min-w-0 gap-3">
              <RosterSectionHead
                id="roster-swaps-open"
                title={openChecked && actorGradeRank !== null ? `Open shifts · ${eligibleOpen.length}` : "Open shifts"}
              />
              {ownShifts.status === "error" ? (
                <RosterNote icon={Info} role="alert">
                  <p>Your own shifts couldn&apos;t be checked. Open shifts are hidden until they can be checked.</p>
                </RosterNote>
              ) : ownShifts.status !== "loading" &&
                overview.status !== "loading" &&
                assignments.status !== "loading" &&
                !openChecked ? (
                <RosterNote icon={Info}>
                  <p>Open shifts are hidden until your roster and the team roster can be checked.</p>
                </RosterNote>
              ) : !openChecked ? (
                <p role="status" className="mx-1 text-sm text-[color:var(--text-muted)]">
                  Checking open shifts against your roster…
                </p>
              ) : actorGradeRank === null ? (
                openShifts.some((item) => !item.mine && item.status === "open") ? (
                  <RosterNote icon={Info}>
                    <p>Add your grade in Your team before taking an open shift.</p>
                  </RosterNote>
                ) : (
                  <EmptyRow>No open shifts you can take</EmptyRow>
                )
              ) : eligibleOpen.length ? (
                <RosterList label="Open shifts">
                  {eligibleOpen.map((item) => {
                    const date = perthDateOf(item.startsAt);
                    const site = siteName(item.siteId);
                    return (
                      <RosterRow
                        key={item.id}
                        lead={<RosterDateLead weekday={weekdayOf(date)} day={Number(date.slice(8, 10))} />}
                        title={timeRange(item)}
                        sub={`${SHIFT_KIND_LABEL[item.kind]}${site ? ` · ${site}` : ""}`}
                        action={
                          <RosterLinkWord
                            label={`Take the open ${SHIFT_KIND_LABEL[item.kind].toLowerCase()} shift on ${formatPerthDay(date)}`}
                            onClick={() => (busyId === item.id ? undefined : setConfirm({ kind: "take", item }))}
                          >
                            Take
                          </RosterLinkWord>
                        }
                      />
                    );
                  })}
                </RosterList>
              ) : (
                <EmptyRow>No open shifts you can take</EmptyRow>
              )}
            </section>

            {isManager ? (
              <section aria-labelledby="roster-swaps-team" className="grid min-w-0 gap-3">
                <RosterSectionHead id="roster-swaps-team" title="All team swaps" />
                {manage.status === "error" ? (
                  <TryAgainNote onRetry={manage.reload}>
                    {manage.message ?? "Team swaps couldn't be loaded."}
                  </TryAgainNote>
                ) : manage.status !== "ready" ? (
                  <ModeModuleSkeleton rows={2} twoLine testId="roster-swaps-team-loading" />
                ) : teamSwaps.length ? (
                  <RosterList label="All team swaps">
                    {teamSwaps.map((swap) => {
                      const progress = swapProgress(swap, actorId!, now);
                      return (
                        <RosterRow
                          key={swap.id}
                          lead={<RosterIconLead icon={ArrowLeftRight} />}
                          title={`${swap.requesterName ?? "A colleague"} and ${swap.counterpartyName ?? "a colleague"}`}
                          sub={
                            <>
                              <span className="block">{`${shiftDay(swap)}. ${returnLine(swap)}`}</span>
                              <SwapProgressLine
                                steps={progress.steps}
                                waitingOn={progress.waitingOn}
                                ended={progress.ended}
                              />
                            </>
                          }
                        />
                      );
                    })}
                  </RosterList>
                ) : (
                  <EmptyRow>No swaps in this team yet</EmptyRow>
                )}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
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
            ? `This asks to take the open ${SHIFT_KIND_LABEL[confirm.item.kind].toLowerCase()} shift on ${formatPerthDay(perthDateOf(confirm.item.startsAt))}, ${timeRange(confirm.item)}.`
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
