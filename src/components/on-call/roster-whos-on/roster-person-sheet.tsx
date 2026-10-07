"use client";

import { Copy, MessageSquareWarning, TriangleAlert } from "lucide-react";
import { useState, type RefObject } from "react";

import { WorkButton, WorkCard, WorkChip, WorkChips, WorkSectionLabel } from "@/components/mode-kit/work";
import { rosterInitials } from "@/components/on-call/roster-whos-on/roster-initials";
import { Sheet } from "@/components/ui/sheet";
import { useOptionalToast } from "@/components/ui/toast";
import { cn } from "@/components/ui-primitives";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import {
  rosterProvenance,
  rosterReportText,
  ROSTER_REPORT_REASON_LABELS,
  ROSTER_REPORT_REASONS,
  type RosterPublicationSummary,
  type RosterReportReason,
  type RosterWhosOnRow,
} from "@/lib/on-call/roster-whos-on";
import { formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import { checkPatientDetail } from "@/lib/work-text/patient-detail-check";

function Fact({ label, value, testId }: { readonly label: string; readonly value: string; readonly testId?: string }) {
  return (
    <div
      className="flex min-h-12 items-center justify-between gap-3 border-t border-[color:var(--border)] px-3 py-2 first:border-t-0"
      data-testid={testId}
    >
      <dt className="text-sm text-[color:var(--text-muted)]">{label}</dt>
      <dd className="nums min-w-0 break-words text-right text-sm font-medium text-[color:var(--text-heading)]">
        {value}
      </dd>
    </div>
  );
}

/** "Until Wed 08:30" while on, "From 21:00" before, "Finished 08:30" after. */
function headline(row: RosterWhosOnRow, now: Date): string {
  const at = now.getTime();
  const endDay = perthDateOf(row.endsAt);
  const startDay = perthDateOf(row.startsAt);
  const today = perthDateOf(now);
  if (row.onNow) return `Until ${endDay === today ? "" : `${formatPerthDay(endDay)} `}${perthTimeOf(row.endsAt)}`;
  if (Date.parse(row.startsAt) > at)
    return `From ${startDay === today ? "" : `${formatPerthDay(startDay)} `}${perthTimeOf(row.startsAt)}`;
  return `Finished ${endDay === today ? "" : `${formatPerthDay(endDay)} `}${perthTimeOf(row.endsAt)}`;
}

/** The roster manager's name when the roster says, else a plain role. */
function managerName(managers: readonly { readonly name: string | null }[]): string | null {
  const named = managers.map((manager) => manager.name?.trim()).filter((name): name is string => Boolean(name));
  return named.length === 1 ? named[0]! : null;
}

/**
 * One person's shift, and where the line comes from. Names, role and shift
 * only: no number (the roster holds none), no leave or reason. "Something not
 * right?" never edits the list: it builds a short note for the roster manager
 * that the doctor copies and sends themselves, because sending from here needs
 * server roles (deferred). The list changes only when the roster does.
 */
export function RosterPersonSheet({
  row,
  date,
  teamName,
  managers = [],
  publication,
  readAt,
  changedAt = null,
  stale = false,
  now = new Date(),
  onClose,
  returnFocusRef,
}: {
  readonly row: RosterWhosOnRow | null;
  readonly date: string;
  readonly teamName: string | null;
  readonly managers?: readonly { readonly name: string | null }[];
  readonly publication: RosterPublicationSummary | null;
  readonly readAt: Date | null;
  readonly changedAt?: Date | null;
  readonly stale?: boolean;
  readonly now?: Date;
  readonly onClose: () => void;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const toast = useOptionalToast();
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<RosterReportReason | null>(null);
  const [note, setNote] = useState("");
  const name = row ? (row.isMe ? "You" : (row.name ?? "Nobody rostered")) : "";
  const manager = managerName(managers);
  const managerLabel = manager ?? "your roster manager";
  const problem = checkPatientDetail(note);
  const caught = problem !== null;

  const close = () => {
    setReporting(false);
    setReason(null);
    setNote("");
    onClose();
  };

  const copyReport = async () => {
    if (!row || !reason || caught) return;
    const text = rosterReportText({ row, date, teamName, reason, note });
    try {
      await copyTextToClipboard(text);
      toast?.push({
        tone: "success",
        title: `Note copied for ${managerLabel}. The list is unchanged until the roster is.`,
      });
      close();
    } catch {
      toast?.push({ tone: "danger", title: "Could not copy. Your browser blocked the clipboard." });
    }
  };

  return (
    <Sheet
      open={row !== null}
      onClose={close}
      title={reporting ? "Something not right?" : name || "Shift"}
      description={
        row
          ? reporting
            ? `${name} · ${row.roleLabel}`
            : `${row.roleLabel}${row.site ? ` · ${row.site}` : ""} · ${formatPerthDay(date)}`
          : undefined
      }
      returnFocusRef={returnFocusRef}
      testId="on-call-roster-person-sheet"
    >
      {row && !reporting ? (
        <div className="grid gap-4">
          <div className="grid justify-items-center gap-1 text-center">
            {row.name !== null ? (
              <span
                aria-hidden="true"
                className="grid size-14 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-lg font-semibold text-[color:var(--mode-identity)]"
              >
                {row.isMe ? "You" : rosterInitials(row.name)}
              </span>
            ) : null}
            <p
              className="nums text-lg font-semibold text-[color:var(--text-heading)]"
              data-testid="on-call-roster-person-headline"
            >
              {headline(row, now)}
            </p>
            <p className="nums text-sm text-[color:var(--text-muted)]">
              {row.span}
              {row.next ? `. Then ${row.next.name} from ${perthTimeOf(row.next.startsAt)}` : ""}
            </p>
          </div>
          {row.name === null ? (
            <p
              className="flex items-start gap-2 rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-3 text-sm text-[color:var(--warning-text)]"
              role="note"
            >
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0" />
              The roster has this shift with nobody on it. Nobody is guessed. Ring switchboard for who is covering.
            </p>
          ) : null}
          {stale ? (
            <p
              className="rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-3 text-sm text-[color:var(--warning-text)]"
              role="note"
            >
              Offline. This is the roster as it was when you last had a connection, not live.
            </p>
          ) : null}
          <section className="grid gap-1.5" aria-labelledby="on-call-roster-source-heading">
            <WorkSectionLabel as="h3" id="on-call-roster-source-heading">
              Where this comes from
            </WorkSectionLabel>
            <WorkCard>
              <dl className="m-0">
                <Fact label="Roster" value={teamName ?? "Your team"} />
                {publication ? (
                  <Fact
                    label="Published"
                    value={rosterProvenance(publication).replace(/^Published /, "")}
                    testId="on-call-roster-person-published"
                  />
                ) : null}
                {manager ? (
                  <Fact label="Keeps the roster" value={manager} testId="on-call-roster-person-manager" />
                ) : null}
                <Fact
                  label="Last change"
                  value={changedAt ? `Seen ${perthTimeOf(changedAt)}` : "None since you opened this"}
                  testId="on-call-roster-person-change"
                />
                {readAt ? <Fact label="Loaded" value={perthTimeOf(readAt)} /> : null}
              </dl>
            </WorkCard>
          </section>
          <div className="grid gap-2">
            <WorkButton
              variant="secondary"
              size="wide"
              icon={MessageSquareWarning}
              onClick={() => setReporting(true)}
              testId="on-call-roster-report"
            >
              {`Not right? Tell ${managerLabel}`}
            </WorkButton>
            <WorkButton variant="quiet" size="wide" href="/roster/team" testId="on-call-roster-open-team">
              Open the team roster
            </WorkButton>
          </div>
        </div>
      ) : null}
      {row && reporting ? (
        <div className="grid gap-4" data-testid="on-call-roster-report-form">
          <section className="grid gap-1.5">
            <WorkSectionLabel as="h3">What is wrong</WorkSectionLabel>
            <WorkChips label="What is wrong">
              {ROSTER_REPORT_REASONS.map((value) => (
                <WorkChip
                  key={value}
                  selected={reason === value}
                  onClick={() => setReason(value)}
                  testId={`on-call-roster-reason-${value}`}
                >
                  {ROSTER_REPORT_REASON_LABELS[value]}
                </WorkChip>
              ))}
            </WorkChips>
          </section>
          <section className="grid gap-1.5">
            <label htmlFor="on-call-roster-report-note" className="work-label">
              <span>Who is actually on</span>
              <em className="work-label__count">Optional</em>
            </label>
            <textarea
              id="on-call-roster-report-note"
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, 280))}
              rows={3}
              aria-invalid={caught}
              aria-describedby={
                caught ? "on-call-roster-report-hint on-call-roster-report-caught" : "on-call-roster-report-hint"
              }
              className={cn(
                "w-full rounded-[var(--work-radius-field,0.8125rem)] border bg-[color:var(--surface-raised)] p-3 text-base-minus text-[color:var(--text-heading)]",
                caught ? "border-[color:var(--warning-border)]" : "border-[color:var(--border)]",
              )}
              data-testid="on-call-roster-report-note"
            />
            <p id="on-call-roster-report-hint" className="text-xs text-[color:var(--text-muted)]">
              Use Dr and a surname, for example Dr Banksia. No patient details.
            </p>
            {caught ? (
              <p
                id="on-call-roster-report-caught"
                className="flex items-start gap-2 text-sm font-medium text-[color:var(--warning-text)]"
                role="alert"
              >
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0" />
                {`${problem?.title ?? "This looks like a patient detail"}. Take it out to copy the note.`}
              </p>
            ) : null}
          </section>
          <p className="text-sm text-[color:var(--text-muted)]">
            {`Copy the note and send it to ${managerLabel}, who keeps the roster. Nothing is sent from here, and this list changes only when the roster does.`}
          </p>
          <div className="grid gap-2">
            <WorkButton
              size="wide"
              icon={Copy}
              onClick={() => void copyReport()}
              disabled={!reason || caught}
              testId="on-call-roster-report-copy"
            >
              Copy note
            </WorkButton>
            <WorkButton
              variant="quiet"
              size="wide"
              onClick={() => setReporting(false)}
              testId="on-call-roster-report-back"
            >
              Back
            </WorkButton>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
