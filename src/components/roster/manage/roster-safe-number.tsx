"use client";

import { Minus, Moon, Plus, Sun, Sunset, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { focusRing } from "@/components/card-recipes";
import { WorkButton, WorkCard, WorkIconRow, WorkSectionLabel, useWorkUndoToast } from "@/components/mode-kit/work";
import { WorkStateLoading, WorkStateNotice } from "@/components/mode-kit/work-state";
import { controlDisabled } from "@/components/ui-primitives";
import { fetchRosterRead, postRosterAction, useRosterRead } from "@/components/roster/use-roster-team";
import type { RosterMaker, RosterOverview, RosterStaffingNeedInput } from "@/lib/roster/team/model";
import {
  SAFE_NUMBER_GROUPS,
  SAFE_NUMBER_KINDS,
  SAFE_NUMBER_MAX,
  SAFE_NUMBER_WEEKDAYS,
  applySafeNumberChanges,
  otherNeedCount,
  safeNumberGrid,
  safeNumberIsGrouped,
  safeNumberNeeds,
  sameSafeNumbers,
  setSafeNumber,
  type SafeNumberGrid,
  undoSafeNumberChanges,
  type SafeNumberKind,
} from "@/lib/roster/team/safe-number";
import { useOnlineStatus } from "@/lib/use-online-status";

/**
 * The team's safe number, in Manage, Team settings: how many doctors the team
 * needs on each Day, Evening and Night shift, set by its roster manager. The
 * Cover tab, the calendar's cover counts and the leave staffing check read it.
 * It is the team's own number, never an official staffing figure, and the
 * words say so.
 *
 * Only a manager sees it (the `maker` read and `needs.set` are manager-only in
 * the SQL as well). Saving reads the team's needs again first, so a dated,
 * grade or site need another manager added since the page opened is kept.
 * On the example team nothing is sent. Nothing is kept on the device.
 */

const KIND_WORDS: Readonly<Record<SafeNumberKind, { label: string; icon: LucideIcon }>> = {
  day: { label: "Day", icon: Sun },
  evening: { label: "Evening (late)", icon: Sunset },
  night: { label: "Night", icon: Moon },
};

const OFFLINE_SAVE =
  "You're offline, so nothing was saved. Your numbers are still here. Save again once you're back online.";
const SAMPLE_SAVE = "This is the example team, so nothing is saved.";

type SaveState =
  { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "example" } | { kind: "error"; message: string };

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

function Stepper({
  label,
  value,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
  testId: string;
}) {
  const round = `${focusRing} grid min-h-12 min-w-12 place-items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text-heading)] ${controlDisabled}`;
  return (
    <span className="flex shrink-0 items-center gap-1" data-testid={testId}>
      <button
        type="button"
        className={round}
        aria-label={`One fewer, ${label}`}
        disabled={disabled || value <= 0}
        onClick={() => onChange(value - 1)}
      >
        <Minus aria-hidden="true" className="size-icon-sm" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={SAFE_NUMBER_MAX}
        step={1}
        aria-label={label}
        disabled={disabled}
        value={value}
        onChange={(event) => {
          // A typed 1.5 becomes 2, never 15.
          const typed = Number(event.target.value);
          onChange(Number.isFinite(typed) ? typed : 0);
        }}
        className={`${focusRing} min-h-12 w-12 rounded border border-[color:var(--border)] bg-background text-center tabular-nums`}
      />
      <button
        type="button"
        className={round}
        aria-label={`One more, ${label}`}
        disabled={disabled || value >= SAFE_NUMBER_MAX}
        onClick={() => onChange(value + 1)}
      >
        <Plus aria-hidden="true" className="size-icon-sm" />
      </button>
    </span>
  );
}

/** The editor's rows: each kind by weekday, or by weekday and weekend group. */
function safeNumberRows(perDay: boolean) {
  return perDay
    ? SAFE_NUMBER_KINDS.flatMap((kind) =>
        SAFE_NUMBER_WEEKDAYS.map(({ weekday, label }) => ({
          key: `${kind}-${weekday}`,
          kind,
          sub: label,
          weekdays: [weekday] as readonly number[],
        })),
      )
    : SAFE_NUMBER_KINDS.flatMap((kind) =>
        SAFE_NUMBER_GROUPS.map((group) => ({
          key: `${kind}-${group.id}`,
          kind,
          sub: group.label,
          weekdays: group.weekdays as readonly number[],
        })),
      );
}

function Editor({
  serviceId,
  needs,
  example,
  onSaved,
}: {
  serviceId: string;
  needs: RosterMaker["needs"];
  example: boolean;
  onSaved?: () => void;
}) {
  const online = useOnlineStatus();
  const toast = useWorkUndoToast();
  // The numbers last confirmed by the server: the read, then each save or Undo.
  const [confirmed, setConfirmed] = useState<SafeNumberGrid>(() => safeNumberGrid(needs));
  const [draft, setDraft] = useState<SafeNumberGrid | null>(null);
  const [perDayChoice, setPerDayChoice] = useState<boolean | null>(null);
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const [others, setOthers] = useState(() => otherNeedCount(needs));
  // One save or Undo at a time. Undo is tapped from a toast, so it can't read the saving state.
  const busy = useRef(false);
  const grid = draft ?? confirmed;
  const dirty = !sameSafeNumbers(grid, confirmed);
  const saving = state.kind === "saving";
  const grouped = safeNumberIsGrouped(grid);
  // Numbers that differ within Monday to Friday, or across the weekend, are only shown day by day.
  const perDay = !grouped || (perDayChoice ?? false);

  function change(kind: SafeNumberKind, weekdays: readonly number[], value: number) {
    setDraft(setSafeNumber(grid, kind, weekdays, value));
    if (state.kind !== "saving") setState({ kind: "idle" });
  }

  function failed(message: string) {
    setState({ kind: "error", message: isOffline() ? OFFLINE_SAVE : message });
  }

  /** The team's needs read again; null (with the error shown) when the read fails. */
  async function readFresh(): Promise<{ needs: RosterMaker["needs"] } | null> {
    const fresh = await fetchRosterRead(serviceId, "maker");
    if (fresh.ok) return fresh.data;
    if (fresh.code === "sample_read_only") setState({ kind: "example" });
    else failed(fresh.message);
    return null;
  }

  async function send(list: RosterStaffingNeedInput[]): Promise<boolean> {
    const result = await postRosterAction(serviceId, { action: "needs.set", needs: list });
    if (result.ok) return true;
    if (result.code === "sample_read_only") setState({ kind: "example" });
    else failed(result.message);
    return false;
  }

  // Undo puts back only the numbers its save changed and nobody has changed since, over a fresh read, so a need or a number
  // another manager set since is kept, and so are the manager's own unsaved changes.
  async function undo(saved: SafeNumberGrid, previous: SafeNumberGrid) {
    if (busy.current) return;
    busy.current = true;
    try {
      setState({ kind: "saving" });
      const fresh = await readFresh();
      if (!fresh) return;
      const reverted = undoSafeNumberChanges(safeNumberGrid(fresh.needs), saved, previous);
      if (!(await send(safeNumberNeeds(reverted, fresh.needs)))) return;
      setConfirmed(reverted);
      setDraft((current) => (current ? applySafeNumberChanges(reverted, saved, current) : null));
      setOthers(otherNeedCount(fresh.needs));
      setState({ kind: "idle" });
      onSaved?.();
    } finally {
      busy.current = false;
    }
  }

  async function save() {
    if (saving || !dirty || busy.current) return;
    if (example) {
      setState({ kind: "example" });
      return;
    }
    busy.current = true;
    try {
      setState({ kind: "saving" });
      // Read the team's needs again, so a need or a number another manager set since this page opened is kept.
      const fresh = await readFresh();
      if (!fresh) return;
      const previous = safeNumberGrid(fresh.needs);
      const saved = applySafeNumberChanges(previous, confirmed, grid);
      if (!(await send(safeNumberNeeds(saved, fresh.needs)))) return;
      setConfirmed(saved);
      setDraft(null);
      setOthers(otherNeedCount(fresh.needs));
      setState({ kind: "saved" });
      onSaved?.();
      toast?.("Safe number saved", () => void undo(saved, previous));
    } finally {
      busy.current = false;
    }
  }

  const rows = safeNumberRows(perDay);

  return (
    <div className="grid gap-3">
      <WorkCard as="ul" aria-label="Doctors needed on each shift" testId="roster-safe-number-rows">
        {rows.map((row) => {
          const words = KIND_WORDS[row.kind];
          const label = `${words.label}, ${row.sub}`;
          return (
            <li key={row.key} className="min-w-0">
              <WorkIconRow
                icon={words.icon}
                title={words.label}
                sub={row.sub}
                end={
                  <Stepper
                    label={label}
                    value={grid[row.kind][row.weekdays[0] - 1]}
                    disabled={saving}
                    onChange={(value) => change(row.kind, row.weekdays, value)}
                    testId={`roster-safe-number-${row.key}`}
                  />
                }
              />
            </li>
          );
        })}
      </WorkCard>
      {grouped ? (
        <WorkButton variant="quiet" onClick={() => setPerDayChoice(!perDay)} testId="roster-safe-number-view">
          {perDay ? "Set weekdays and weekends together" : "Set each day separately"}
        </WorkButton>
      ) : (
        <p className="text-sm text-[color:var(--text-muted)]">Your days differ, so each day is shown.</p>
      )}
      {others > 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]" data-testid="roster-safe-number-others">
          Your team also has {others === 1 ? "1 other cover need" : `${others} other cover needs`}, for one date, one
          grade, one site or on call. Saving keeps {others === 1 ? "it" : "them"} as{" "}
          {others === 1 ? "it is" : "they are"}.
        </p>
      ) : null}
      {!online && state.kind !== "error" ? (
        <p role="status" className="text-sm">
          You&apos;re offline. Save once you&apos;re back online.
        </p>
      ) : null}
      {state.kind === "saved" ? (
        <p role="status" className="text-sm">
          Saved. The Cover tab and the staffing check now use these numbers.
        </p>
      ) : state.kind === "example" ? (
        <p role="status" className="text-sm">
          {SAMPLE_SAVE}
        </p>
      ) : state.kind === "error" ? (
        <p role="alert" className="text-sm text-[color:var(--danger-text)]">
          {state.message}
        </p>
      ) : saving ? (
        <p role="status" className="sr-only">
          Saving your safe number
        </p>
      ) : null}
      <WorkButton onClick={() => void save()} disabled={saving || !dirty} size="wide" testId="roster-safe-number-save">
        {saving ? "Saving…" : "Save safe number"}
      </WorkButton>
    </div>
  );
}

function SafeNumberSection({
  serviceId,
  example,
  onSaved,
}: {
  serviceId: string;
  example: boolean;
  onSaved?: () => void;
}) {
  const maker = useRosterRead(serviceId, "maker");
  const online = useOnlineStatus();
  return (
    <section className="grid gap-3" aria-labelledby="roster-safe-number-title" data-testid="roster-safe-number">
      <WorkSectionLabel id="roster-safe-number-title">Safe number</WorkSectionLabel>
      <p className="text-sm">
        How many doctors your team needs on each shift. This is your team&apos;s own number, set by you as its roster
        manager. It isn&apos;t an official staffing figure. The Cover tab and your team&apos;s leave staffing check
        compare the roster with it. Leave a shift at 0 when it has no number.
      </p>
      {maker.data ? (
        <Editor
          key={maker.readAt?.getTime() ?? 0}
          serviceId={serviceId}
          needs={maker.data.needs}
          example={example}
          onSaved={onSaved}
        />
      ) : maker.status === "loading" ? (
        <WorkStateLoading label="Loading your safe number…" rows={3} />
      ) : (
        <WorkStateNotice
          kind={online ? "error" : "offline"}
          title={online ? "Your safe number couldn't be loaded" : "You're offline"}
          body={online ? maker.message : "Your safe number loads once you're back online."}
          onRetry={maker.reload}
          testId="roster-safe-number-error"
        />
      )}
    </section>
  );
}

/** Manage, Team settings: the safe number editor. Nothing at all for anyone but the team's manager. */
export function RosterSafeNumber({
  serviceId,
  overview,
  example = false,
  onSaved,
}: {
  serviceId: string;
  overview: RosterOverview;
  /** The example team: the editor works, and Save says nothing is saved instead of sending. */
  example?: boolean;
  /** Called after a save or an Undo lands, so the calendar's cover counts read the new number. */
  onSaved?: () => void;
}) {
  if (overview.me.role !== "manager") return null;
  return <SafeNumberSection serviceId={serviceId} example={example} onSaved={onSaved} />;
}
