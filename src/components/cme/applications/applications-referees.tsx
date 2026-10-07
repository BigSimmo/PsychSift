"use client";

import { Check, Copy, Users } from "lucide-react";
import { useId, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { flatCard, flatRow, IconCircle, PatientDetailCatch, Tag, type TagTone } from "@/components/cme/cpd-feature-kit";
import { Button } from "@/components/ui/button";
import { announce } from "@/components/ui/live-announcer";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/components/ui-primitives";
import {
  applicationTextProblem,
  NAME_LIMIT,
  nudgeMessage,
  REFEREE_STATUSES,
  refereeLine,
  refereeNameProblem,
  refereeStatusLabel,
  ROLE_LIMIT,
  shortDate,
  type Referee,
  type RefereeStatus,
} from "@/lib/cme/applications";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

const statusTone: Record<RefereeStatus, TagTone> = {
  "not-asked": "neutral",
  asked: "amber",
  agreed: "green",
  sent: "mode",
  declined: "neutral",
};

export function RefereeStatusChip({ status }: { readonly status: RefereeStatus }) {
  return <Tag tone={statusTone[status]}>{refereeStatusLabel(status)}</Tag>;
}

function initials(name: string): string {
  const words = name
    .replace(/^(?:dr|doctor|prof|professor|a\/prof|assoc(?:iate)?\.?\s+prof(?:essor)?|mr|mrs|ms|mx|miss)\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  return (
    words.length > 1 ? `${words[0]![0]}${words[words.length - 1]![0]}` : (words[0]?.slice(0, 2) ?? "?")
  ).toUpperCase();
}

export function RefereeList({
  referees,
  today,
  onOpen,
  onAdd,
  full,
}: {
  readonly referees: readonly Referee[];
  readonly today: string;
  readonly onOpen: (id: string) => void;
  readonly onAdd: () => void;
  readonly full: boolean;
}) {
  if (!referees.length) {
    return (
      <ul role="list" className={flatCard}>
        <li className={cn(flatRow, "p-0")}>
          <button
            type="button"
            onClick={onAdd}
            data-testid="applications-referee-add-row"
            className={cn(focusRing, "flex min-h-13 w-full items-center gap-3 px-3 py-2 text-left")}
          >
            <IconCircle icon={Users} />
            <span className="grid">
              <span className="text-base-minus font-medium text-[color:var(--text-heading)]">Add a referee</span>
              <span className="text-sm text-[color:var(--text-muted)]">Track who you asked and who agreed</span>
            </span>
          </button>
        </li>
      </ul>
    );
  }
  return (
    <div className="grid gap-2">
      <ul role="list" className={flatCard} data-testid="applications-referees">
        {referees.map((referee) => (
          <li key={referee.id} className={cn(flatRow, "p-0")}>
            <button
              type="button"
              onClick={() => onOpen(referee.id)}
              data-testid="applications-referee"
              aria-label={`${referee.name}, ${refereeStatusLabel(referee.status)}. Open`}
              className={cn(focusRing, "flex min-h-13 w-full min-w-0 items-center gap-3 px-3 py-2 text-left")}
            >
              <span
                aria-hidden="true"
                className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-xs font-medium text-[color:var(--mode-identity)]"
              >
                {initials(referee.name)}
              </span>
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
                  {referee.name}
                </span>
                <span className="truncate text-sm leading-5 text-[color:var(--text-muted)]">
                  {refereeLine(referee, today)}
                </span>
              </span>
              <RefereeStatusChip status={referee.status} />
            </button>
          </li>
        ))}
      </ul>
      {full ? (
        <p className="px-1 text-sm text-[color:var(--text-muted)]">
          8 referees is the most this keeps. Remove one to add another.
        </p>
      ) : null}
    </div>
  );
}

export type RefereeDraft = { name: string; role: string; status: RefereeStatus };

/**
 * One referee: name and role, the status chips, a dated history and a ready
 * nudge for a quiet referee. A new referee is saved with the footer button;
 * an existing one saves its changes the same way, with Undo on the page.
 */
export function RefereeSheet({
  open,
  referee,
  today,
  onClose,
  onSave,
  onRemove,
  onNudgeCopied,
}: {
  readonly open: boolean;
  /** Null to add a new referee. */
  readonly referee: Referee | null;
  readonly today: string;
  readonly onClose: () => void;
  readonly onSave: (draft: RefereeDraft) => void;
  readonly onRemove: (id: string) => void;
  readonly onNudgeCopied: (id: string) => void;
}) {
  return open ? (
    <RefereeSheetBody
      key={referee?.id ?? "new"}
      referee={referee}
      today={today}
      onClose={onClose}
      onSave={onSave}
      onRemove={onRemove}
      onNudgeCopied={onNudgeCopied}
    />
  ) : null;
}

function RefereeSheetBody({
  referee,
  today,
  onClose,
  onSave,
  onRemove,
  onNudgeCopied,
}: {
  readonly referee: Referee | null;
  readonly today: string;
  readonly onClose: () => void;
  readonly onSave: (draft: RefereeDraft) => void;
  readonly onRemove: (id: string) => void;
  readonly onNudgeCopied: (id: string) => void;
}) {
  const statusGroup = useId();
  const [name, setName] = useState(referee?.name ?? "");
  const [role, setRole] = useState(referee?.role ?? "");
  const [status, setStatus] = useState<RefereeStatus>(referee?.status ?? "not-asked");
  const [tried, setTried] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const nameProblem = name.trim() || tried ? refereeNameProblem(name) : null;
  const roleProblem = applicationTextProblem(role);
  const canSave = !refereeNameProblem(name) && !roleProblem;
  const unchanged =
    referee && referee.name === name.trim() && referee.role === role.trim() && referee.status === status;
  const nudge =
    referee && referee.status === "asked"
      ? nudgeMessage({ ...referee, name: name.trim() || referee.name }, today)
      : null;

  function save() {
    setTried(true);
    if (!canSave) return;
    if (unchanged) {
      onClose();
      return;
    }
    onSave({ name: name.trim(), role: role.trim(), status });
  }

  async function copyNudge() {
    if (!nudge || !referee) return;
    try {
      await copyTextToClipboard(nudge);
      setCopy("copied");
      onNudgeCopied(referee.id);
    } catch {
      setCopy("failed");
      announce("Could not copy. Select the message and copy it yourself.");
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={referee ? referee.name : "Add a referee"}
      description={referee ? referee.role || "Referee" : "Someone who knows your work"}
      testId="applications-referee-sheet"
      footer={
        <div className={cn("grid gap-2", referee && "grid-cols-2")}>
          {referee ? (
            <Button onClick={() => onRemove(referee.id)} testId="applications-referee-remove">
              Remove
            </Button>
          ) : null}
          <Button
            variant="primary"
            block
            onClick={save}
            disabled={tried && !canSave}
            testId="applications-referee-save"
          >
            {referee ? "Save" : "Add referee"}
          </Button>
        </div>
      }
    >
      <div className="grid min-w-0 gap-4">
        <TextField
          label="Name"
          value={name}
          maxLength={NAME_LIMIT}
          placeholder="Dr Grant"
          onChange={(event) => setName(event.target.value)}
          error={nameProblem && tried && !name.trim() ? nameProblem.body : undefined}
          aria-invalid={nameProblem ? true : undefined}
          autoComplete="off"
          data-testid="applications-referee-name"
        />
        {name.trim() ? <PatientDetailCatch problem={nameProblem} testId="applications-referee-name-problem" /> : null}
        <TextField
          label="Role and workplace (optional)"
          value={role}
          maxLength={ROLE_LIMIT}
          placeholder="Consultant, Example Hospital"
          onChange={(event) => setRole(event.target.value)}
          aria-invalid={roleProblem ? true : undefined}
          autoComplete="off"
          data-testid="applications-referee-role"
        />
        <PatientDetailCatch problem={roleProblem} testId="applications-referee-role-problem" />
        <div className="grid gap-2">
          <p id={statusGroup} className="text-sm font-medium text-[color:var(--text-heading)]">
            Status
          </p>
          <div
            role="radiogroup"
            aria-labelledby={statusGroup}
            className="grid grid-cols-2 gap-2 min-[380px]:grid-cols-3"
          >
            {REFEREE_STATUSES.map((item) => {
              const selected = item.id === status;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setStatus(item.id)}
                  data-testid={`applications-referee-status-${item.id}`}
                  className={cn(
                    focusRing,
                    "inline-flex min-h-12 items-center justify-center rounded-lg border px-2 text-center text-sm",
                    selected
                      ? "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity-soft)] font-medium text-[color:var(--mode-identity)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text)]",
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
        {referee && referee.history.length ? (
          <div className="grid gap-1">
            <p className="text-sm font-medium text-[color:var(--text-heading)]">History</p>
            <ol className={flatCard} data-testid="applications-referee-history">
              {[...referee.history]
                .reverse()
                .slice(0, 8)
                .map((event, index) => (
                  <li key={`${event.on}-${index}`} className={cn(flatRow, "justify-between text-sm")}>
                    <span className="text-[color:var(--text)]">
                      {event.kind === "nudge" ? "Nudge copied" : refereeStatusLabel(event.status)}
                    </span>
                    <span className="nums text-[color:var(--text-muted)]">
                      {event.on === today ? "Today" : shortDate(event.on, today)}
                    </span>
                  </li>
                ))}
            </ol>
          </div>
        ) : null}
        {nudge ? (
          <div className="grid gap-2" data-testid="applications-nudge">
            <p className="text-sm font-medium text-[color:var(--text-heading)]">Nudge</p>
            <p className={cn(flatCard, "p-3 text-sm leading-5 text-[color:var(--text)]")}>{nudge}</p>
            <Button icon={copy === "copied" ? Check : Copy} onClick={copyNudge} testId="applications-nudge-copy">
              {copy === "copied"
                ? "Copied, paste it in your email"
                : copy === "failed"
                  ? "Copy failed, try again"
                  : "Copy nudge"}
            </Button>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
