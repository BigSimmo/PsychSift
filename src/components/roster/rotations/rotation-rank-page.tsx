"use client";

import { ArrowDown, ArrowLeft, ArrowUp, Check, CircleSlash, Info, Layers, Lock, Plus, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { PageTitleUnderBand, useModeBandHeading } from "@/components/mode-band/mode-band";
import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkDock,
  WorkEmpty,
  WorkSectionLabel,
  useWorkUndoToast,
} from "@/components/mode-kit/work";
import { useRosterNow } from "@/components/roster/roster-format";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { ordinal } from "@/lib/roster/rotations/allocate";
import { roundAcceptsPreferences, rotationById, type MyRound, type RotationRound } from "@/lib/roster/rotations/model";
import { zonedToday } from "@/lib/work-time/format";

import {
  ROTATIONS_HREF,
  formatClosing,
  formatClosingDay,
  insertAt,
  knownRanking,
  moveById,
  movedAnnouncement,
  myRoundProgress,
  placesWords,
  rankedNeeded,
  sameOrder,
  sendBlockedReason,
} from "./rotation-format";
import { RotationCalendarCard, RotationYearCard, RotationYearHero } from "./rotation-year-card";
import { RotationsReadState } from "./rotations-home-page";
import { useRotations, type RotationsRead } from "./use-rotations";

/**
 * Roster · Rotations · one round (`/roster/rotations/[roundId]`, mockup screen
 * `rank`). While the round is open the doctor ranks its rotations: drag a row
 * by its handle (mouse or touch), use the arrows, or focus the handle and use
 * the arrow keys. Tapping a rotation's name opens Move to 1st and Remove.
 * Changes stay on this page until Save draft or Send. Once the round closes it
 * reads back what was sent; once published it shows the year that was given.
 */

type Busy = "save" | "send" | null;
type Focus = { readonly id: string; readonly part: "handle" | "up" | "down" | "name" } | null;

/** The last ready answer for this round, so a refresh after saving never flashes the page away. */
function useHeldRound(read: RotationsRead, roundId: string) {
  const entry = read.mine.find((candidate) => candidate.round.id === roundId);
  const key = entry
    ? `${entry.round.id}|${entry.round.version}|${entry.round.status}|${entry.submittedAt}|${entry.ranking.join(",")}`
    : null;
  const [held, setHeld] = useState<{ key: string; entry: MyRound } | null>(null);
  if (read.status === "ready" && entry && key && held?.key !== key) setHeld({ key, entry });
  if (read.status === "loading" && held) return { status: "ready" as const, entry: held.entry };
  return { status: read.status, entry };
}

export function RotationRankPage({ roundId, now: pinnedNow }: { readonly roundId: string; readonly now?: Date }) {
  const read = useRotations();
  const now = useRosterNow(pinnedNow);
  const { zone } = useWorkTimeZone();
  const { status, entry } = useHeldRound(read, roundId);

  const round = entry?.round;
  const accepting = round ? roundAcceptsPreferences(round, now) : false;
  const published = round?.status === "published";

  useModeBandHeading({
    title: !round ? "Rotations" : published ? `Your ${round.name}` : accepting ? "Your preferences" : round.name,
    eyebrow: !round
      ? undefined
      : published
        ? `Published by ${round.adminName}`
        : accepting
          ? `Closes ${formatClosingDay(round.closesAt, zone)}`
          : "Closed",
  });

  let body;
  if (status !== "ready") body = <RotationsReadState read={read} testId="rotation-rank" />;
  else if (!entry) body = <RoundMissing managed={read.managed.some((managed) => managed.round.id === roundId)} />;
  else if (published) body = <PublishedRound entry={entry} zone={zone} today={zonedToday(zone, now)} />;
  else if (accepting) body = <RankEditor key={entry.round.id} entry={entry} read={read} zone={zone} />;
  else body = <ClosedRound entry={entry} />;

  return (
    <WorkBody testId="rotation-rank">
      <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
        {round ? round.name : "Rotations"}
      </PageTitleUnderBand>
      {body}
    </WorkBody>
  );
}

/* ------------------------------------------------------------------ states */

function BackToRotations() {
  return (
    <WorkButton variant="secondary" href={ROTATIONS_HREF} icon={ArrowLeft} testId="rotation-rank-back">
      All rotations
    </WorkButton>
  );
}

function RoundMissing({ managed }: { readonly managed: boolean }) {
  return (
    <WorkCard>
      <WorkEmpty
        icon={CircleSlash}
        title={managed ? "You are not in this round" : "This round is not here"}
        body={
          managed
            ? "You run this round, but you are not one of the doctors in it, so there is nothing for you to rank."
            : "It may have been removed, or the link is wrong. Your rounds are all on Rotations."
        }
        action={<BackToRotations />}
        testId={managed ? "rotation-rank-not-in-round" : "rotation-rank-not-found"}
      />
    </WorkCard>
  );
}

function PublishedRound({
  entry,
  zone,
  today,
}: {
  readonly entry: MyRound;
  readonly zone: string;
  readonly today: string;
}) {
  return (
    <>
      <RotationYearHero mine={entry} zone={zone} />
      <WorkSectionLabel>Rotations</WorkSectionLabel>
      <RotationYearCard mine={entry} today={today} />
      <WorkSectionLabel>Calendar</WorkSectionLabel>
      <RotationCalendarCard />
      <WorkCard padded>
        <p className="m-0 text-xs leading-relaxed text-[color:var(--work-ink-muted)]">
          Dates changed? {entry.round.adminName} edits them here and your calendar follows. To ask about a swap, use{" "}
          <Link href="/roster/requests" className="font-semibold text-[color:var(--mode-identity)] underline">
            Requests
          </Link>
          .
        </p>
      </WorkCard>
    </>
  );
}

function ClosedRound({ entry }: { readonly entry: MyRound }) {
  const ranking = knownRanking(entry.ranking, entry.round);
  const sent = Boolean(entry.submittedAt);
  return (
    <>
      <WorkCard padded testId="rotation-rank-closed">
        <div className="flex gap-3">
          <span className="work-ic" data-tone="neutral" aria-hidden="true">
            <Lock aria-hidden="true" strokeWidth={2} />
          </span>
          <div className="grid gap-1">
            <p className="m-0 text-sm font-semibold text-[color:var(--work-ink)]">Closed. Allocation is in progress</p>
            <p className="m-0 text-xs leading-relaxed text-[color:var(--work-ink-muted)]">
              {sent
                ? `${entry.round.adminName} is checking the allocation. Your rotations show here and on your calendar once they are published.`
                : "You did not send preferences for this round, so any free places will be given to you. Your rotations show here once they are published."}
            </p>
          </div>
        </div>
      </WorkCard>
      {ranking.length > 0 ? (
        <>
          <WorkSectionLabel count={sent ? "Sent" : "Draft, not sent"}>Your ranking</WorkSectionLabel>
          <ReadOnlyRanking round={entry.round} ranking={ranking} />
        </>
      ) : null}
      <div className="grid">
        <BackToRotations />
      </div>
    </>
  );
}

function NumberBadge({ index }: { readonly index: number }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-7 flex-none place-items-center rounded-full text-xs font-bold tabular-nums ${
        index === 0
          ? "bg-[color:var(--mode-identity)] text-[color:var(--mode-identity-contrast)]"
          : "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
      }`}
    >
      {index + 1}
    </span>
  );
}

function rotationSub(round: Pick<RotationRound, "rotations">, id: string) {
  const rotation = rotationById(round, id);
  if (!rotation) return "";
  return [rotation.site, placesWords(rotation.places)].filter(Boolean).join(" · ");
}

function ReadOnlyRanking({ round, ranking }: { readonly round: RotationRound; readonly ranking: readonly string[] }) {
  return (
    <WorkCard as="ul" aria-label="Your ranking" testId="rotation-rank-readonly">
      {ranking.map((id, index) => (
        <li key={id} className="work-row">
          <NumberBadge index={index} />
          <span className="work-row__text">
            <span className="work-row__title">
              <span className="sr-only">{ordinal(index + 1)}: </span>
              {rotationById(round, id)?.name ?? id}
            </span>
            <span className="work-row__sub">{rotationSub(round, id)}</span>
          </span>
        </li>
      ))}
    </WorkCard>
  );
}

/* ------------------------------------------------------------------ editor */

function RankEditor({
  entry,
  read,
  zone,
}: {
  readonly entry: MyRound;
  readonly read: RotationsRead;
  readonly zone: string;
}) {
  const { round } = entry;
  const baseline = knownRanking(entry.ranking, round);
  const [draft, setDraft] = useState<readonly string[] | null>(null);
  const ranking = draft ?? baseline;
  const dirty = draft !== null && !sameOrder(draft, baseline);
  const [justSent, setJustSent] = useState(false);
  const sent = Boolean(entry.submittedAt) || justSent;
  const [editing, setEditing] = useState(!entry.submittedAt);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState({ text: "", n: 0 });
  const [open, setOpen] = useState<string | null>(null);
  const toast = useWorkUndoToast();

  const nameOf = (id: string) => rotationById(round, id)?.name ?? "That rotation";
  const say = (text: string) => setSaid((current) => ({ text, n: current.n + 1 }));
  const change = (next: readonly string[]) => {
    setDraft(next);
    setError(null);
  };

  // Leaving with an unsaved order asks first.
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  async function save(submit: boolean) {
    setBusy(submit ? "send" : "save");
    setError(null);
    const result = await read.actions.savePreference(round.id, ranking, submit);
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // The draft stays as the shown order; it matches what was saved.
    setDraft([...ranking]);
    if (submit) {
      setJustSent(true);
      setEditing(false);
      say("Preferences sent");
      toast?.("Preferences sent");
    } else {
      say("Draft saved");
      toast?.("Draft saved");
    }
  }

  const closing = formatClosing(round.closesAt, zone);

  if (sent && !editing) {
    return (
      <>
        <LiveLine said={said} />
        <WorkCard padded testId="rotation-rank-sent">
          <div className="flex gap-3">
            <span className="work-ic" data-tone="green" aria-hidden="true">
              <Check aria-hidden="true" strokeWidth={2.4} />
            </span>
            <div className="grid gap-1">
              <p className="m-0 text-sm font-semibold text-[color:var(--work-ink)]">Sent</p>
              <p className="m-0 text-xs leading-relaxed text-[color:var(--work-ink-muted)]">
                You can change it until {closing}. {round.adminName} runs the allocation after it closes.
              </p>
            </div>
          </div>
        </WorkCard>
        <WorkSectionLabel count={`${ranking.length} ranked`}>Your ranking</WorkSectionLabel>
        <ReadOnlyRanking round={round} ranking={ranking} />
        <WorkDock aria-label="Your preferences">
          <WorkButton onClick={() => setEditing(true)} icon={Layers} testId="rotation-rank-change">
            Change
          </WorkButton>
        </WorkDock>
      </>
    );
  }

  const unranked = round.rotations.filter((rotation) => !ranking.includes(rotation.id));
  const blocked = sendBlockedReason(ranking.length, round);
  const needed = rankedNeeded(round);
  const progress = myRoundProgress(entry);

  return (
    <>
      <LiveLine said={said} />
      <p className="m-0 flex items-start gap-2 px-0.5 text-xs leading-relaxed text-[color:var(--work-ink-muted)]">
        <Layers aria-hidden="true" className="mt-0.5 size-icon-sm flex-none text-[color:var(--mode-identity)]" />
        <span>
          Drag by the handle, or use the arrows. Your 1st choice is at the top. You get one of these each term,{" "}
          {round.terms.length} in all. Tap a name to remove it.
        </span>
      </p>

      {sent ? (
        <WorkCard padded testId="rotation-rank-changing">
          <p className="m-0 text-xs leading-relaxed text-[color:var(--work-ink-muted)]">
            You are changing preferences you already sent. Send again to update them. Until then your sent ranking
            stands.
          </p>
        </WorkCard>
      ) : null}

      <WorkSectionLabel
        count={`${ranking.length} of ${round.rotations.length}`}
        action={
          ranking.length > 0
            ? {
                label: "Clear",
                onClick: () => {
                  const before = ranking;
                  change([]);
                  say("Ranking cleared");
                  toast?.("Ranking cleared", () => change(before));
                },
              }
            : undefined
        }
      >
        Ranked
      </WorkSectionLabel>

      {ranking.length === 0 ? (
        <WorkCard padded testId="rotation-rank-empty">
          <p className="m-0 text-sm font-semibold text-[color:var(--work-ink)]">Nothing ranked yet</p>
          <p className="mt-1 mb-0 text-xs leading-relaxed text-[color:var(--work-ink-muted)]">
            Tap Rank on a rotation below. The first one you add is your 1st choice, and you can reorder them after.
          </p>
        </WorkCard>
      ) : (
        <RankedList
          round={round}
          ranking={ranking}
          open={open}
          setOpen={setOpen}
          onChange={change}
          say={say}
          onRemove={(id) => {
            const index = ranking.indexOf(id);
            change(ranking.filter((candidate) => candidate !== id));
            setOpen(null);
            say(`${nameOf(id)} removed`);
            toast?.(`${nameOf(id)} removed`, () => setDraft((current) => insertAt(current ?? [], id, index)));
          }}
        />
      )}

      <p className="m-0 flex items-start gap-2 px-0.5 text-xs leading-relaxed text-[color:var(--work-ink-muted)]">
        <Info aria-hidden="true" className="mt-0.5 size-icon-sm flex-none" />
        <span>
          Rank at least {needed}. Anything you leave out can still be given to you if your ranked ones are full.
        </span>
      </p>
      {round.note ? (
        <WorkCard padded>
          <p className="m-0 text-3xs font-bold tracking-label text-[color:var(--mode-identity)] uppercase">
            From {round.adminName}
          </p>
          <p className="mt-1 mb-0 text-xs leading-relaxed text-[color:var(--work-ink)]">{round.note}</p>
        </WorkCard>
      ) : null}

      {unranked.length > 0 ? (
        <>
          <WorkSectionLabel count={unranked.length}>Not ranked yet</WorkSectionLabel>
          <UnrankedList
            round={round}
            ids={unranked.map((rotation) => rotation.id)}
            onRank={(id) => {
              change([...ranking, id]);
              say(`${nameOf(id)} added as ${ordinal(ranking.length + 1)}`);
            }}
          />
        </>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="m-0 rounded-[var(--work-radius-field)] bg-[color:var(--danger-bg)] px-3 py-2.5 text-xs font-semibold text-[color:var(--danger-text)]"
          data-testid="rotation-rank-error"
        >
          {error}
        </p>
      ) : null}

      <p
        className="m-0 px-0.5 text-center text-xs font-semibold text-[color:var(--work-ink-muted)]"
        data-testid="rotation-rank-status"
      >
        {blocked ??
          (dirty ? "Changes not saved yet" : progress === "draft" && !sent ? "Draft saved" : `Closes ${closing}`)}
      </p>

      <WorkDock aria-label="Your preferences">
        {sent ? (
          <WorkButton
            variant="secondary"
            onClick={() => {
              setDraft(null);
              setEditing(false);
              setError(null);
            }}
            disabled={busy !== null}
            testId="rotation-rank-cancel"
          >
            Cancel
          </WorkButton>
        ) : (
          <WorkButton
            variant="secondary"
            onClick={() => void save(false)}
            disabled={busy !== null || !dirty}
            testId="rotation-rank-save"
          >
            {busy === "save" ? "Saving" : "Save draft"}
          </WorkButton>
        )}
        <WorkButton
          onClick={() => void save(true)}
          icon={Send}
          disabled={busy !== null || blocked !== null || (sent && !dirty)}
          testId="rotation-rank-send"
        >
          {busy === "send" ? "Sending" : sent ? "Send changes" : "Send preferences"}
        </WorkButton>
      </WorkDock>
    </>
  );
}

function LiveLine({ said }: { readonly said: { readonly text: string; readonly n: number } }) {
  // The alternating space makes a repeat of the same words count as new.
  return (
    <p className="sr-only" aria-live="polite" data-testid="rotation-rank-live">
      {said.text}
      {said.n % 2 ? " " : ""}
    </p>
  );
}

/* ------------------------------------------------------------- ranked list */

type DragState = { readonly id: string; readonly dy: number } | null;

function RankedList({
  round,
  ranking,
  open,
  setOpen,
  onChange,
  onRemove,
  say,
}: {
  readonly round: RotationRound;
  readonly ranking: readonly string[];
  readonly open: string | null;
  readonly setOpen: (id: string | null) => void;
  readonly onChange: (next: readonly string[]) => void;
  readonly onRemove: (id: string) => void;
  readonly say: (text: string) => void;
}) {
  const rows = useRef(new Map<string, HTMLLIElement>());
  const controls = useRef(new Map<string, HTMLButtonElement>());
  const latest = useRef(ranking);
  const dragging = useRef<{ id: string; startY: number; from: number } | null>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const pendingFocus = useRef<Focus>(null);
  const nameOf = (id: string) => rotationById(round, id)?.name ?? "That rotation";

  useLayoutEffect(() => {
    latest.current = ranking;
  }, [ranking]);

  // Keep focus on the control that moved, wherever its row went.
  useLayoutEffect(() => {
    const focus = pendingFocus.current;
    if (!focus) return;
    pendingFocus.current = null;
    const target = controls.current.get(`${focus.id}:${focus.part}`);
    const fallback = controls.current.get(`${focus.id}:handle`);
    (target && !target.disabled ? target : fallback)?.focus();
  }, [ranking]);

  const move = (id: string, delta: number, part: NonNullable<Focus>["part"]) => {
    const next = moveById(latest.current, id, delta);
    if (sameOrder(next, latest.current)) return;
    latest.current = next;
    onChange(next);
    say(movedAnnouncement(nameOf(id), next.indexOf(id)));
    pendingFocus.current = { id, part };
  };

  const dragId = drag?.id ?? null;
  useEffect(() => {
    if (!dragId) return;
    const onMove = (event: globalThis.PointerEvent) => {
      const state = dragging.current;
      if (!state) return;
      event.preventDefault();
      let dy = event.clientY - state.startY;
      const order = latest.current;
      let index = order.indexOf(state.id);
      let next = order;
      // Step past each neighbour whose middle the row has crossed.
      for (;;) {
        const below = next[index + 1];
        const above = next[index - 1];
        const belowHeight = below ? (rows.current.get(below)?.getBoundingClientRect().height ?? 0) : 0;
        const aboveHeight = above ? (rows.current.get(above)?.getBoundingClientRect().height ?? 0) : 0;
        if (below && belowHeight > 0 && dy > belowHeight / 2) {
          next = moveById(next, state.id, 1);
          index += 1;
          state.startY += belowHeight;
          dy -= belowHeight;
        } else if (above && aboveHeight > 0 && dy < -aboveHeight / 2) {
          next = moveById(next, state.id, -1);
          index -= 1;
          state.startY -= aboveHeight;
          dy += aboveHeight;
        } else break;
      }
      if (next !== order) {
        latest.current = next;
        onChange(next);
      }
      setDrag({ id: state.id, dy });
    };
    const onEnd = () => {
      const state = dragging.current;
      dragging.current = null;
      setDrag(null);
      if (!state) return;
      const to = latest.current.indexOf(state.id);
      if (to !== state.from) say(movedAnnouncement(nameOf(state.id), to));
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    // nameOf, onChange and say are stable for the life of one drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId]);

  const startDrag = (id: string, event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    setOpen(null);
    dragging.current = { id, startY: event.clientY, from: latest.current.indexOf(id) };
    setDrag({ id, dy: 0 });
  };

  const onHandleKey = (id: string, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      move(id, event.key === "ArrowUp" ? -1 : 1, "handle");
    }
  };

  const bind = (key: string) => (node: HTMLButtonElement | null) => {
    if (node) controls.current.set(key, node);
    else controls.current.delete(key);
  };

  return (
    <WorkCard>
      <ol className="m-0 grid list-none p-0" aria-label="Your ranking, 1st choice first" data-no-tab-swipe="">
        {ranking.map((id, index) => {
          const rotation = rotationById(round, id);
          const name = rotation?.name ?? id;
          const lifted = drag?.id === id;
          const expanded = open === id;
          const panelId = `rotation-rank-actions-${index}`;
          return (
            <li
              key={id}
              ref={(node) => {
                if (node) rows.current.set(id, node);
                else rows.current.delete(id);
              }}
              className={`relative grid border-t border-[color:var(--work-line)] first:border-t-0 ${
                lifted
                  ? "z-[5] rounded-[var(--work-radius-field)] bg-[color:var(--mode-identity-soft)] outline outline-1 -outline-offset-1 outline-[color:var(--mode-identity-border)]"
                  : "motion-safe:transition-transform motion-safe:duration-[var(--duration-quick)]"
              }`}
              style={lifted ? { transform: `translateY(${drag?.dy ?? 0}px)` } : undefined}
              data-testid="rotation-rank-row"
            >
              <div className="flex min-h-14 items-center gap-1 py-1 pr-1 pl-3">
                <NumberBadge index={index} />
                <button
                  type="button"
                  ref={bind(`${id}:name`)}
                  className="grid min-h-12 min-w-0 flex-1 rounded-[var(--work-radius-field)] px-1.5 py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus)]"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => setOpen(expanded ? null : id)}
                >
                  <span className="work-row__title">
                    <span className="sr-only">{ordinal(index + 1)}: </span>
                    {name}
                  </span>
                  <span className="work-row__sub">{rotationSub(round, id)}</span>
                </button>
                <RowIconButton
                  bindRef={bind(`${id}:up`)}
                  icon={ArrowUp}
                  label={`Move ${name} up`}
                  disabled={index === 0}
                  onClick={() => move(id, -1, "up")}
                />
                <RowIconButton
                  bindRef={bind(`${id}:down`)}
                  icon={ArrowDown}
                  label={`Move ${name} down`}
                  disabled={index === ranking.length - 1}
                  onClick={() => move(id, 1, "down")}
                />
                <button
                  type="button"
                  ref={bind(`${id}:handle`)}
                  aria-label={`Reorder ${name}, ${ordinal(index + 1)}. Use the up and down arrow keys`}
                  aria-roledescription="drag handle"
                  className="grid size-12 flex-none cursor-grab touch-none place-items-center rounded-full select-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus)] active:cursor-grabbing"
                  onPointerDown={(event) => startDrag(id, event)}
                  onClick={() => say("Drag to reorder, or use the up and down arrow keys")}
                  onKeyDown={(event) => onHandleKey(id, event)}
                  data-testid="rotation-rank-handle"
                >
                  <span aria-hidden="true" className="grid gap-0.5">
                    <i className="block h-0.5 w-3.5 rounded-full bg-[color:var(--decoration-soft)]" />
                    <i className="block h-0.5 w-3.5 rounded-full bg-[color:var(--decoration-soft)]" />
                    <i className="block h-0.5 w-3.5 rounded-full bg-[color:var(--decoration-soft)]" />
                  </span>
                </button>
              </div>
              {expanded ? (
                <div id={panelId} className="flex flex-wrap gap-2 px-3 pb-2.5 pl-12">
                  {index > 0 ? (
                    <WorkButton
                      variant="tinted"
                      onClick={() => {
                        const next = moveById(ranking, id, -index);
                        onChange(next);
                        setOpen(null);
                        say(movedAnnouncement(name, 0));
                        pendingFocus.current = { id, part: "name" };
                      }}
                      icon={ArrowUp}
                    >
                      Make it 1st
                    </WorkButton>
                  ) : null}
                  <WorkButton variant="secondary" onClick={() => onRemove(id)} testId="rotation-rank-remove">
                    Remove from ranking
                  </WorkButton>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </WorkCard>
  );
}

function RowIconButton({
  icon: Icon,
  label,
  disabled,
  onClick,
  bindRef,
}: {
  readonly icon: typeof ArrowUp;
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly bindRef: (node: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      type="button"
      ref={bindRef}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="group grid size-12 flex-none place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus)] disabled:cursor-default"
    >
      <span
        aria-hidden="true"
        className="grid size-[30px] place-items-center rounded-full bg-[color:var(--work-wash)] text-[color:var(--work-ink-muted)] group-disabled:opacity-40"
      >
        <Icon aria-hidden="true" className="size-icon-sm" strokeWidth={2.2} />
      </span>
    </button>
  );
}

/* ----------------------------------------------------------- unranked list */

function UnrankedList({
  round,
  ids,
  onRank,
}: {
  readonly round: RotationRound;
  readonly ids: readonly string[];
  readonly onRank: (id: string) => void;
}) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const focusNext = useRef<string | null>(null);

  useLayoutEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    buttons.current.get(id)?.focus();
  }, [ids]);

  return (
    <WorkCard as="ul" aria-label="Not ranked yet" testId="rotation-unranked">
      {ids.map((id, index) => {
        const name = rotationById(round, id)?.name ?? id;
        return (
          <li key={id}>
            <button
              type="button"
              ref={(node) => {
                if (node) buttons.current.set(id, node);
                else buttons.current.delete(id);
              }}
              className="work-row w-full border-0 bg-transparent text-left"
              aria-label={`Rank ${name}`}
              onClick={() => {
                const after = ids[index + 1] ?? ids[index - 1] ?? null;
                onRank(id);
                focusNext.current = after;
              }}
              data-testid="rotation-unranked-row"
            >
              <span className="work-ic" aria-hidden="true">
                <Plus aria-hidden="true" strokeWidth={2.2} />
              </span>
              <span className="work-row__text">
                <span className="work-row__title">{name}</span>
                <span className="work-row__sub">{rotationSub(round, id)}</span>
              </span>
              <span
                aria-hidden="true"
                className="inline-flex min-h-8 items-center rounded-full bg-[color:var(--mode-identity-soft)] px-3.5 text-xs font-bold text-[color:var(--mode-identity)]"
              >
                Rank
              </span>
            </button>
          </li>
        );
      })}
    </WorkCard>
  );
}
