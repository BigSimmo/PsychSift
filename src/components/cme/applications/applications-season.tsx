"use client";

import { Clock, Plus } from "lucide-react";
import { useId, useState } from "react";

import { CmeDateField } from "@/components/cme/cme-date-field";
import { focusRing } from "@/components/card-recipes";
import { DateTile, FlatSwitch, PatientDetailCatch, flatCard } from "@/components/cme/cpd-feature-kit";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/components/ui-primitives";
import {
  APPLICATION_STAGES,
  applicationTextProblem,
  outOfOrderStages,
  seasonDateFor,
  seasonRail,
  shortDate,
  SOURCE_LIMIT,
  type ApplicationStageId,
  type ApplicationsState,
  type SeasonDate,
} from "@/lib/cme/applications";

/**
 * The season rail, the signature of Job applications: the stages in order. A
 * stage with no date is drawn hollow and dashed ("Date not added"); a date the
 * doctor typed is solid and says it is theirs. Today sits on the rail with the
 * countdown to the next date.
 */
export function SeasonRail({
  state,
  today,
  onEdit,
}: {
  readonly state: ApplicationsState;
  readonly today: string;
  readonly onEdit: (stage: ApplicationStageId) => void;
}) {
  const items = seasonRail(state, today);
  const added = state.dates.length;
  const outOfOrder = new Set(outOfOrderStages(state));
  return (
    <div className="grid gap-2">
      <ol
        aria-label={`Application season, ${added} of ${APPLICATION_STAGES.length} dates added`}
        className="relative grid before:absolute before:bottom-6 before:left-[1.0625rem] before:top-6 before:w-0.5 before:rounded-full before:bg-[color:var(--border)] before:content-['']"
        data-testid="applications-rail"
      >
        {items.map((item) =>
          item.kind === "today" ? (
            item.countdown ? (
              <li
                key="today"
                className="relative flex min-h-10 items-center gap-3 pl-3"
                data-testid="applications-rail-today"
              >
                <span
                  aria-hidden="true"
                  className="relative z-[var(--z-raised)] size-3 rounded-full bg-[color:var(--text-heading)] ring-4 ring-[color:var(--surface-raised)]"
                />
                <span className="grid">
                  <span className="text-2xs font-semibold uppercase tracking-label text-[color:var(--text-heading)]">
                    Today
                  </span>
                  <span className="text-sm text-[color:var(--mode-identity)]">{item.countdown}</span>
                </span>
              </li>
            ) : null
          ) : (
            <li key={item.stage} className="relative flex min-h-13 min-w-0 items-center gap-3 pl-2">
              <span
                aria-hidden="true"
                className={cn(
                  "relative z-[var(--z-raised)] grid size-5 shrink-0 place-items-center rounded-full",
                  item.date
                    ? "bg-[color:var(--mode-identity)] ring-4 ring-[color:var(--surface-raised)]"
                    : "border-2 border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-raised)]",
                  item.past && "opacity-60",
                )}
              >
                {item.date ? <span className="size-2 rounded-full bg-[color:var(--surface-raised)]" /> : null}
              </span>
              <button
                type="button"
                onClick={() => onEdit(item.stage)}
                data-testid={`applications-stage-${item.stage}`}
                aria-label={
                  item.date
                    ? `${item.label}, ${shortDate(item.date.on, today)}${item.date.time ? ` at ${item.date.time}` : ""}. Change date`
                    : `${item.label}, date not added. Add date`
                }
                className={cn(focusRing, "flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-md text-left")}
              >
                <span className="grid min-w-0 flex-1">
                  <span
                    className={cn(
                      "text-base-minus font-medium leading-5",
                      item.date ? "text-[color:var(--text-heading)]" : "text-[color:var(--text-muted)]",
                    )}
                  >
                    {item.label}
                  </span>
                  <span className="text-sm leading-5 text-[color:var(--text-muted)]">
                    {item.date
                      ? `Added by you${item.date.source ? `, from ${item.date.source}` : ""}${item.date.time ? ` · ${item.date.time}` : ""}`
                      : "Date not added"}
                  </span>
                  {outOfOrder.has(item.stage) ? (
                    <span className="text-sm leading-5 text-[color:var(--warning)]">
                      Earlier than the stage before. Check the advert.
                    </span>
                  ) : null}
                </span>
                {item.date ? (
                  <DateTile on={item.date.on} label={shortDate(item.date.on, today)} />
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-[color:var(--mode-identity)]">
                    <Plus aria-hidden="true" strokeWidth={2} className="size-3.5" />
                    Add date
                  </span>
                )}
              </button>
            </li>
          ),
        )}
      </ol>
      <p
        data-testid="applications-dates-not-checked"
        className="flex items-start gap-2 rounded-md bg-[color:var(--surface-subtle)] px-3 py-2.5 text-sm leading-5 text-[color:var(--text)]"
      >
        <Clock
          aria-hidden="true"
          strokeWidth={1.75}
          className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--warning)]"
        />
        <span>
          <span className="font-medium">Dates not checked.</span> PsychSift has no confirmed WA recruitment dates. Add
          them from the advert you apply to.
        </span>
      </p>
    </div>
  );
}

export type SeasonDateDraft = { stage: ApplicationStageId; on: string; time: string; source: string; remind: boolean };

/**
 * Add or change one stage's date. Saving replaces that stage's date; the page
 * offers Undo. Removing is here too, also with Undo.
 */
export function SeasonDateSheet({
  open,
  initialStage,
  state,
  today,
  onClose,
  onSave,
  onRemove,
}: {
  readonly open: boolean;
  readonly initialStage: ApplicationStageId | null;
  readonly state: ApplicationsState;
  readonly today: string;
  readonly onClose: () => void;
  readonly onSave: (draft: SeasonDateDraft) => void;
  readonly onRemove: (stage: ApplicationStageId) => void;
}) {
  return open ? (
    <SeasonDateSheetBody
      key={initialStage ?? "new"}
      initialStage={initialStage}
      state={state}
      today={today}
      onClose={onClose}
      onSave={onSave}
      onRemove={onRemove}
    />
  ) : null;
}

function firstOpenStage(state: ApplicationsState): ApplicationStageId {
  return APPLICATION_STAGES.find((stage) => !seasonDateFor(state, stage.id))?.id ?? "close";
}

function SeasonDateSheetBody({
  initialStage,
  state,
  today,
  onClose,
  onSave,
  onRemove,
}: {
  readonly initialStage: ApplicationStageId | null;
  readonly state: ApplicationsState;
  readonly today: string;
  readonly onClose: () => void;
  readonly onSave: (draft: SeasonDateDraft) => void;
  readonly onRemove: (stage: ApplicationStageId) => void;
}) {
  const stageGroup = useId();
  const remindLabel = useId();
  const [stage, setStage] = useState<ApplicationStageId>(initialStage ?? firstOpenStage(state));
  const existing: SeasonDate | null = seasonDateFor(state, stage);
  const [on, setOn] = useState(existing?.on ?? "");
  const [time, setTime] = useState(existing?.time ?? "");
  const [source, setSource] = useState(existing?.source ?? "");
  const [remind, setRemind] = useState(existing?.remind ?? true);
  const [dateInvalid, setDateInvalid] = useState(false);
  const [tried, setTried] = useState(false);
  const problem = applicationTextProblem(source);
  const timeOk = time === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const canSave = Boolean(on) && !dateInvalid && !problem && timeOk;

  function pickStage(next: ApplicationStageId) {
    setStage(next);
    const date = seasonDateFor(state, next);
    setOn(date?.on ?? "");
    setTime(date?.time ?? "");
    setSource(date?.source ?? "");
    setRemind(date?.remind ?? true);
    setTried(false);
  }

  function save() {
    setTried(true);
    if (!canSave) return;
    onSave({ stage, on, time, source: source.trim(), remind });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={existing ? "Change a date" : "Add a date"}
      description="From the advert you are applying to"
      testId="applications-date-sheet"
      footer={
        <div className={cn("grid gap-2", existing && "grid-cols-2")}>
          {existing ? (
            <Button onClick={() => onRemove(stage)} testId="applications-date-remove">
              Remove date
            </Button>
          ) : null}
          <Button variant="primary" block onClick={save} disabled={tried && !canSave} testId="applications-date-save">
            Save date
          </Button>
        </div>
      }
    >
      <div className="grid min-w-0 gap-4">
        <div className="grid gap-2">
          <p id={stageGroup} className="text-sm font-medium text-[color:var(--text-heading)]">
            Stage
          </p>
          <div role="radiogroup" aria-labelledby={stageGroup} className="flex flex-wrap gap-2">
            {APPLICATION_STAGES.map((item) => {
              const selected = item.id === stage;
              const has = Boolean(seasonDateFor(state, item.id));
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => pickStage(item.id)}
                  data-testid={`applications-date-stage-${item.id}`}
                  className={cn(
                    focusRing,
                    "inline-flex min-h-12 items-center gap-1.5 rounded-full border px-3 text-sm",
                    selected
                      ? "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity-soft)] font-medium text-[color:var(--mode-identity)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text)]",
                  )}
                >
                  {item.label}
                  {has ? <span className="sr-only"> (date added)</span> : null}
                  {has ? (
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-[color:var(--mode-identity)]" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
        <CmeDateField
          label="Date"
          value={on}
          onChange={setOn}
          today={today}
          chips={false}
          allowFuture
          required
          error={tried && !on ? "Add the date from the advert." : undefined}
          onInvalidChange={setDateInvalid}
        />
        <TextField
          label="Time (optional)"
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          error={!timeOk ? "Use a time such as 17:00." : undefined}
        />
        <TextField
          label="Where it came from (optional)"
          value={source}
          maxLength={SOURCE_LIMIT}
          placeholder="Hospital advert"
          onChange={(event) => setSource(event.target.value)}
          aria-invalid={problem ? true : undefined}
          autoComplete="off"
          data-testid="applications-date-source"
        />
        <PatientDetailCatch problem={problem} testId="applications-date-problem" />
        <div className={cn(flatCard, "flex items-center gap-3 px-3 py-1")}>
          <span id={remindLabel} className="grid min-w-0 flex-1">
            <span className="text-base-minus font-medium text-[color:var(--text-heading)]">Remind me</span>
            <span className="text-sm text-[color:var(--text-muted)]">
              Shown at the top of this page from a week before. It won&apos;t buzz or email you.
            </span>
          </span>
          <FlatSwitch on={remind} onChange={setRemind} labelledBy={remindLabel} testId="applications-date-remind" />
        </div>
      </div>
    </Sheet>
  );
}
