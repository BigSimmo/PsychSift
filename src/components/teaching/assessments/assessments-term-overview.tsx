"use client";

import {
  Bell,
  Check,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Lock,
  Minus,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { clockNow, useAssessmentsExtras, useOfflineSince } from "@/components/teaching/assessments/assessments-extras";
import {
  Eyebrow,
  Inset,
  KeyValue,
  List,
  Panel,
  Pill,
  Row,
  ScreenHeader,
  SectionLabel,
  SmallPrint,
  TextLink,
  TickRow,
  WhyNot,
  secondaryText,
  titleText,
  traineeHref,
  viewHref,
} from "@/components/teaching/assessments/assessments-parts";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { Button, buttonFaceClass } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/chip";
import { announce } from "@/components/ui/live-announcer";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { guardExampleAction } from "@/lib/example-data/guards";
import { useExampleData } from "@/lib/example-data/store";
import { remindedKeys } from "@/lib/teaching/assessments/extras";
import { termWeek, todayLabel, type PillTone } from "@/lib/teaching/assessments/model";
import {
  CELL_WORDS,
  DEFAULT_EXPORT_OPTIONS,
  OVERVIEW_CSV_NAME,
  OVERVIEW_FILTERS,
  OVERVIEW_PRIVACY_LINE,
  bulkRecipients,
  cellLabel,
  doctorTimeline,
  exportBlocker,
  filterOverview,
  formWord,
  midTermSummary,
  nothingDueYet,
  overviewCounts,
  overviewCsv,
  overviewDoctors,
  pendingForms,
  reminderMessage,
  reminderRecords,
  remindableForms,
  supervisorGroups,
  supervisorMix,
  type BulkRecipient,
  type CellStatus,
  type OverviewDoctor,
  type OverviewExportOptions,
  type OverviewFilter,
  type ReminderRecord,
} from "@/lib/teaching/assessments/overview";
import { TERM_TRACKER_SOURCES } from "@/lib/teaching/term-tracker";

/*
 * The term assessments overview (feature 4, mock-up nf_assess_over): a status grid with every doctor in the
 * term as one row and three status marks (mid-term, EPAs, end-of-term), a bell to remind the supervisor in
 * one tap with Undo, a by-supervisor view, Remind several, one doctor's status timeline, the reminders sent,
 * and a status-only export. Made-up doctors in page memory: a reminder here is pretend, and ratings and
 * comments are never part of this view, so they cannot leak from it.
 */

const asSup = { as: "supervisor" };
const CLA_URL = TERM_TRACKER_SOURCES.pmcwaCla;

const TONE: Record<CellStatus, PillTone> = { done: "ok", due: "accent", overdue: "bad", not_yet: "neutral" };

const MARK: Record<CellStatus, { icon: LucideIcon; className: string }> = {
  done: { icon: Check, className: "bg-[color:var(--success-bg)] text-[color:var(--success-text)]" },
  due: { icon: Clock, className: "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]" },
  overdue: { icon: TriangleAlert, className: "bg-[color:var(--danger-bg)] text-[color:var(--danger-text)]" },
  not_yet: { icon: Minus, className: "bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]" },
};

/** One status mark: a flat tinted circle with an icon, and its words for a screen reader. */
function StatusMark({ status, label }: { status: CellStatus; label: string }) {
  const { icon: Icon, className } = MARK[status];
  return (
    <span
      role="img"
      aria-label={label}
      data-status={status}
      className={cn(
        "grid size-7 shrink-0 place-items-center justify-self-center rounded-full forced-colors:border",
        className,
      )}
    >
      <Icon aria-hidden="true" strokeWidth={2} className="size-icon-xs" />
    </span>
  );
}

const SEGMENT: Record<"done" | "due" | "overdue", string> = {
  done: "bg-[color:var(--success-text)]",
  due: "bg-[color:var(--mode-identity)]",
  overdue: "bg-[color:var(--danger-text)]",
};

/** A stacked bar, one segment per doctor, done first. The words are in its label, never the colour alone. */
function MixBar({
  done,
  due,
  overdue,
  label,
  testId,
}: {
  done: number;
  due: number;
  overdue: number;
  label: string;
  testId?: string;
}) {
  const parts = [
    ...Array.from({ length: done }, () => "done" as const),
    ...Array.from({ length: due }, () => "due" as const),
    ...Array.from({ length: overdue }, () => "overdue" as const),
  ];
  return (
    <div
      role="img"
      aria-label={label}
      data-testid={testId}
      className="grid auto-cols-fr grid-flow-col gap-0.5 forced-colors:forced-color-adjust-none"
    >
      {parts.length ? (
        parts.map((status, i) => (
          <i key={i} data-status={status} className={cn("block h-2 rounded-xs", SEGMENT[status])} />
        ))
      ) : (
        <i className="block h-2 rounded-xs bg-[color:var(--surface-subtle)]" />
      )}
    </div>
  );
}

function Totals({ done, due, overdue }: { done: number; due: number; overdue: number }) {
  const cells = [
    { n: done, word: "Done", ink: "text-[color:var(--text-heading)]" },
    { n: due, word: "Due", ink: "text-[color:var(--mode-identity)]" },
    { n: overdue, word: "Overdue", ink: "text-[color:var(--danger-text)]" },
  ];
  return (
    <div aria-hidden="true" className="grid grid-cols-3 gap-2 text-center">
      {cells.map((c) => (
        <div key={c.word} className="grid">
          <b className={cn("nums text-xl font-normal", c.ink)}>{c.n}</b>
          <span className="text-xs text-[color:var(--text-muted)]">{c.word}</span>
        </div>
      ))}
    </div>
  );
}

type BellState = "pending" | "reminded" | "offline" | "none";

function BellButton({ state, label, onClick }: { state: BellState; label: string; onClick: () => void }) {
  if (state === "none") return <span aria-hidden="true" className="size-12 shrink-0" />;
  const live = state === "pending";
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={live ? undefined : true}
      onClick={live ? onClick : undefined}
      data-bell={state}
      className={cn(
        focusRing,
        "grid size-12 shrink-0 place-items-center rounded-full",
        state === "pending" && "text-[color:var(--mode-identity)] hover:bg-[color:var(--surface-wash)]",
        state === "reminded" && "cursor-default text-[color:var(--success-text)]",
        state === "offline" && "cursor-default text-[color:var(--text-muted)]",
      )}
    >
      {state === "reminded" ? (
        <Check aria-hidden="true" strokeWidth={2.25} className="size-icon-sm" />
      ) : (
        <Bell aria-hidden="true" className="size-icon-sm" />
      )}
    </button>
  );
}

const GRID = "grid grid-cols-[minmax(0,1fr)_repeat(3,2.25rem)] items-center gap-1";

function GridHead() {
  return (
    <div
      aria-hidden="true"
      className="flex items-center gap-1 border-b border-[color:var(--border)] py-2 pr-1 pl-3.5 text-2xs font-semibold tracking-label text-[color:var(--text-muted)] uppercase"
    >
      <span className={cn(GRID, "min-w-0 flex-1")}>
        <span>Doctor</span>
        <span className="text-center">Mid</span>
        <span className="text-center">EPAs</span>
        <span className="text-center">End</span>
      </span>
      {/* The bell column: a bell to remind, a tick once reminded today. */}
      <span className="w-12 shrink-0 text-center tracking-normal">Remind</span>
    </div>
  );
}

function Legend() {
  const keys: { status: CellStatus; word: string }[] = [
    { status: "done", word: "Done" },
    { status: "due", word: "Due" },
    { status: "overdue", word: "Overdue" },
    { status: "not_yet", word: "Not yet" },
  ];
  return (
    <ul aria-hidden="true" className="flex flex-wrap gap-x-3.5 gap-y-1.5 px-1 text-xs text-[color:var(--text-muted)]">
      {keys.map((k) => {
        const { icon: Icon, className } = MARK[k.status];
        return (
          <li key={k.status} className="inline-flex items-center gap-1.5">
            <span className={cn("grid size-5 place-items-center rounded-full", className)}>
              <Icon aria-hidden="true" strokeWidth={2} className="size-icon-xs" />
            </span>
            {k.word}
          </li>
        );
      })}
    </ul>
  );
}

function PrivacyLine() {
  return (
    <p className={cn(secondaryText, "flex items-start gap-1.5 px-1 text-xs")}>
      <Lock aria-hidden="true" className="mt-0.5 size-icon-xs shrink-0" />
      {OVERVIEW_PRIVACY_LINE}
    </p>
  );
}

function OfflineNote({ since }: { since: string }) {
  return (
    <div role="status" data-testid="assessments-overview-offline">
      <Inset tone="warm" icon={WifiOff} title="No connection">
        {`Status as of ${since}. Reminders can't be sent while offline. Try again when you are back online.`}
      </Inset>
    </div>
  );
}

export function AssessmentsTermOverview(props: ScreenProps) {
  const doctorId = props.params.get("doctor");
  if (doctorId) return <DoctorDetail {...props} doctorId={doctorId} />;
  return <OverviewHome {...props} />;
}

/** Shared by the grid, the supervisors list and one doctor's page: pretend reminders, with Undo. */
function useReminders(s: ScreenProps["s"]) {
  const { extras, dispatchExtras, offerUndo } = useAssessmentsExtras();
  const keys = remindedKeys(extras);
  const offlineSince = useOfflineSince();

  function send(records: ReminderRecord[], title: string) {
    if (!records.length || offlineSince) return;
    dispatchExtras({ type: "remind", records });
    offerUndo({
      title,
      body: "Made-up: nothing is sent. One reminder a day per form.",
      undo: () => dispatchExtras({ type: "unremind", keys: records.map((r) => r.key) }),
      undone: "Reminder taken back.",
    });
  }

  function remindDoctor(row: OverviewDoctor) {
    const forms = pendingForms(row, keys, s.now);
    send(
      reminderRecords(row, forms, s.now, clockNow()),
      `Reminder to ${row.supervisor} about ${row.name}'s ${forms.map(formWord).join(" and ")}`,
    );
  }

  function bellState(row: OverviewDoctor): BellState {
    if (remindableForms(row).length === 0) return "none";
    if (pendingForms(row, keys, s.now).length === 0) return "reminded";
    return offlineSince ? "offline" : "pending";
  }

  function remindedAt(row: OverviewDoctor): string | null {
    const todays = extras.reminders.filter((r) => r.doctorId === row.id && r.key.endsWith(`:${s.now}`));
    return todays.length ? todays[todays.length - 1]!.at : null;
  }

  return { extras, keys, offlineSince, send, remindDoctor, bellState, remindedAt };
}

function bellLabel(state: BellState, row: OverviewDoctor, forms: string): string {
  if (state === "reminded") return `${row.supervisor} reminded today about ${row.name}`;
  if (state === "offline") return `Reminder unavailable offline: ${row.name}`;
  return `Remind ${row.supervisor} about ${row.name}'s ${forms}`;
}

function OverviewHome({ s }: ScreenProps) {
  const r = useReminders(s);
  const [tab, setTab] = useState<"doctors" | "supervisors" | "sent">("doctors");
  const [filter, setFilter] = useState<OverviewFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const [sheet, setSheet] = useState<"bulk" | "export" | null>(null);
  const rows = useMemo(() => overviewDoctors(s), [s]);
  const counts = overviewCounts(rows);
  const summary = midTermSummary(rows);
  const epasMet = rows.filter((row) => row.epas.status === "done").length;
  const early = nothingDueYet(rows);
  const groups = supervisorGroups(rows);
  const recipients = bulkRecipients(rows, r.keys, s.now);
  const toRemind = recipients.filter((x) => !x.remindedToday);
  const remindWhyId = useId();
  const filterNoteId = useId();
  // Why Remind cannot open, in words beside it, never a silent grey button.
  const remindWhyNot = r.offlineSince
    ? "Can't send while offline. Try again when you are back online."
    : toRemind.length === 0
      ? "Everyone with a due or overdue form was reminded today."
      : null;
  const remindedToday = recipients.filter((x) => x.remindedToday);
  const overdueSupervisors = groups.filter((g) => g.overdue > 0).length;
  const sentToday = r.extras.reminders.filter((x) => x.key.endsWith(`:${s.now}`));

  const filtered = filterOverview(rows, filter);
  // "All" keeps the doctors who need nothing behind one row, so the ones that need a nudge come first.
  const quiet = filter === "all" && !showAll ? filtered.filter((row) => row.bucket === "on_track") : [];
  const shown =
    quiet.length && quiet.length < filtered.length ? filtered.filter((row) => row.bucket !== "on_track") : filtered;
  const hidden = filtered.length - shown.length;

  return (
    <div className="grid gap-3" data-testid="assessments-overview">
      <ScreenHeader
        back={viewHref("home", asSup)}
        backLabel="your requests"
        title="Term overview"
        subtitle="Made-up doctors · status only"
      />
      {r.offlineSince ? <OfflineNote since={r.offlineSince} /> : null}
      <Panel>
        <Eyebrow accent>{`Term 4 · week ${termWeek(s)}\u00a0of 10 · made-up hospital`}</Eyebrow>
        <h2 className="text-xl font-semibold text-[color:var(--text-heading)]">
          {`${rows.length} doctors · ${counts.overdue} overdue`}
        </h2>
        <span className="text-sm font-medium text-[color:var(--text-heading)]">Mid-term assessments only</span>
        <MixBar {...summary} testId="assessments-overview-meter" />
        <Totals {...summary} />
        <KeyValue k="EPAs at the term target" v={`${epasMet}\u00a0of ${rows.length}`} />
        <KeyValue k="End-of-term window" v="26 Oct to 6 Nov" />
      </Panel>
      <SegmentedControl
        label="Show"
        layout="equal"
        value={tab}
        onChange={setTab}
        options={[
          { value: "doctors", label: `Doctors · ${rows.length}` },
          { value: "supervisors", label: "Supervisors" },
          { value: "sent", label: sentToday.length ? `Sent · ${sentToday.length}` : "Sent" },
        ]}
      />
      {early ? (
        <Inset tone="plain" title="No assessments due yet">
          Mid-term status shows here as forms open. Reminders start on each due date.
        </Inset>
      ) : null}
      {tab === "doctors" ? (
        <>
          {/* The chips count doctors by any form, so they differ from the mid-term totals above. Said, not left to guess. */}
          <p className={cn(secondaryText, "-mb-1 px-1 text-xs")} id={filterNoteId}>
            Doctors, counted by their most urgent form of any kind
          </p>
          <div
            role="group"
            aria-label="Filter doctors"
            aria-describedby={filterNoteId}
            className="flex flex-wrap gap-1.5"
          >
            {OVERVIEW_FILTERS.map((f) => (
              <ChoiceChip key={f.id} pressed={filter === f.id} onPressedChange={() => setFilter(f.id)}>
                {`${f.label} · ${counts[f.id]}`}
              </ChoiceChip>
            ))}
          </div>
          {filter === "overdue" && counts.overdue > 0 ? (
            <Inset tone="plain" icon={Clock} title="One reminder a day per form">
              The bell comes back tomorrow if the form is still overdue.
            </Inset>
          ) : null}
          {filtered.length === 0 ? (
            <Inset tone="plain" title="None match this filter">
              <TextLink onClick={() => setFilter("all")}>Show all</TextLink>
            </Inset>
          ) : (
            <div className="min-w-0 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] forced-colors:border">
              <GridHead />
              <ul role="list" aria-label="Doctors" className="grid min-w-0">
                {shown.map((row) => {
                  const state = r.bellState(row);
                  const forms = remindableForms(row).map(formWord).join(" and ");
                  const at = r.remindedAt(row);
                  return (
                    <li
                      key={row.id}
                      data-testid={`assessments-overview-${row.id}`}
                      className="flex min-w-0 items-center gap-1 border-t border-[color:var(--border)] pr-1 first:border-t-0"
                    >
                      <Link
                        href={viewHref("overview", { ...asSup, doctor: row.id })}
                        className={cn(focusRing, GRID, "min-h-15 min-w-0 flex-1 rounded-lg py-2.5 pl-3.5 no-underline")}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          {/* Below 360 px the initials give way, so the name has room to be read in full. */}
                          <span
                            aria-hidden="true"
                            className="grid size-9 shrink-0 place-items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-xs font-semibold text-[color:var(--text-heading)] max-[359px]:hidden"
                          >
                            {row.initials}
                          </span>
                          <span className="grid min-w-0">
                            <span className={cn(titleText, "break-words")} data-testid="assessments-overview-name">
                              {row.name}
                            </span>
                            <span className={cn(secondaryText, "break-words text-xs")}>
                              {at ? `Reminded ${at}` : `${row.grade} · ${row.supervisor}`}
                            </span>
                          </span>
                        </span>
                        <StatusMark status={row.mid.status} label={cellLabel("Mid-term", row.mid)} />
                        <StatusMark status={row.epas.status} label={cellLabel("EPAs", row.epas)} />
                        <StatusMark status={row.end.status} label={cellLabel("End-of-term", row.end)} />
                      </Link>
                      <BellButton
                        state={state}
                        label={bellLabel(state, row, forms)}
                        onClick={() => r.remindDoctor(row)}
                      />
                    </li>
                  );
                })}
              </ul>
              {hidden > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className={cn(
                    focusRing,
                    "flex min-h-12 w-full items-center justify-between gap-2 border-t border-[color:var(--border)] px-3.5 text-left text-sm font-medium text-[color:var(--mode-identity)]",
                  )}
                >
                  <span>{`Show ${hidden} more`}</span>
                  <span className="text-xs text-[color:var(--text-muted)]">All on track</span>
                </button>
              ) : null}
            </div>
          )}
          <Legend />
        </>
      ) : null}
      {tab === "supervisors" ? (
        <>
          {overdueSupervisors > 0 ? (
            <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3.5 py-3">
              <Bell aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--mode-identity)]" />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className={titleText}>
                  {`${overdueSupervisors} ${overdueSupervisors === 1 ? "supervisor has" : "supervisors have"} an overdue form`}
                </span>
                <span className={secondaryText}>
                  {remindedToday.length ? `${remindedToday.length} already reminded today` : "None reminded yet today"}
                </span>
              </span>
              <Button
                variant="primary"
                size="sm"
                aria-disabled={remindWhyNot ? true : undefined}
                aria-describedby={remindWhyNot ? remindWhyId : undefined}
                className="aria-disabled:cursor-not-allowed aria-disabled:border-[color:var(--border)] aria-disabled:bg-[color:var(--surface-subtle)] aria-disabled:text-[color:var(--text-muted)]"
                onClick={() => {
                  if (!remindWhyNot) setSheet("bulk");
                }}
                testId="assessments-overview-bulk-open"
              >
                Remind
              </Button>
            </div>
          ) : null}
          {overdueSupervisors > 0 && remindWhyNot ? <WhyNot id={remindWhyId}>{remindWhyNot}</WhyNot> : null}
          <List label="Supervisors">
            {groups.map((group) => {
              const mix = supervisorMix(group);
              const recipient = recipients.find((x) => x.supervisor === group.name);
              const pending = recipient && !recipient.remindedToday ? recipient.items : [];
              const tag: { label: string; tone: PillTone } = group.overdue
                ? { label: "Overdue", tone: "bad" }
                : group.due
                  ? { label: "Due", tone: "accent" }
                  : { label: "On track", tone: "ok" };
              return (
                <li
                  key={group.name}
                  data-testid={`assessments-overview-supervisor-${group.name.replace(/\W+/g, "-").toLowerCase()}`}
                  className="grid gap-2 border-t border-[color:var(--border)] px-3.5 py-3 first:border-t-0"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className={titleText}>{group.name}</span>
                      <span className={cn(secondaryText, "text-xs")}>
                        {[...new Set(group.doctors.map((d) => d.unit))].join(", ")}
                      </span>
                    </span>
                    <Pill pill={tag} />
                    {recipient ? (
                      <BellButton
                        state={recipient.remindedToday ? "reminded" : r.offlineSince ? "offline" : "pending"}
                        label={
                          recipient.remindedToday
                            ? `${group.name} reminded today`
                            : r.offlineSince
                              ? `Reminder unavailable offline: ${group.name}`
                              : `Remind ${group.name} about ${pending.length} ${pending.length === 1 ? "form" : "forms"}`
                        }
                        onClick={() =>
                          r.send(
                            pending.flatMap((item) => reminderRecords(item.row, [item.form], s.now, clockNow())),
                            `Reminder to ${group.name} about ${pending.length} ${pending.length === 1 ? "form" : "forms"}`,
                          )
                        }
                      />
                    ) : null}
                  </div>
                  <MixBar done={mix.done} due={mix.due} overdue={mix.overdue} label={mix.label} />
                  <span aria-hidden="true" className="nums text-xs font-normal text-[color:var(--text-muted)]">
                    {mix.label}
                  </span>
                </li>
              );
            })}
          </List>
        </>
      ) : null}
      {tab === "sent" ? <SentList reminders={r.extras.reminders} now={s.now} /> : null}
      <Button variant="secondary" block icon={Download} onClick={() => setSheet("export")}>
        Export status
      </Button>
      <PrivacyLine />
      <SmallPrint>
        EPAs are the doctor&apos;s to ask for, so they get no reminder here. Every doctor and supervisor on this page is
        made-up, and no reminder leaves it.
      </SmallPrint>
      <Sheet open={sheet === "bulk"} onClose={() => setSheet(null)} title="Remind supervisors">
        {sheet === "bulk" ? (
          <BulkRemind
            recipients={recipients}
            onSend={(items) => {
              const records = items.flatMap((item) => reminderRecords(item.row, [item.form], s.now, clockNow()));
              const people = new Set(items.map((item) => item.row.supervisor)).size;
              r.send(records, `${people} ${people === 1 ? "reminder" : "reminders"} sent to supervisors`);
              setSheet(null);
            }}
          />
        ) : null}
      </Sheet>
      <Sheet open={sheet === "export"} onClose={() => setSheet(null)} title="Export status">
        {sheet === "export" ? (
          <ExportSheet
            rows={rows}
            reminders={r.extras.reminders}
            dateLabel={todayLabel(s)}
            onDone={() => {
              setSheet(null);
              announce("Status exported");
            }}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

function SentList({ reminders, now }: { reminders: readonly ReminderRecord[]; now: number }) {
  const today = reminders.filter((x) => x.key.endsWith(`:${now}`)).reverse();
  const earlier = reminders.filter((x) => !x.key.endsWith(`:${now}`)).reverse();
  if (!reminders.length)
    return (
      <div data-testid="assessments-overview-sent-empty">
        <Inset tone="plain" icon={Bell} title="No reminders yet">
          A reminder you send from Doctors or Supervisors shows here with its time.
        </Inset>
      </div>
    );
  const row = (x: ReminderRecord) => (
    <li
      key={x.key}
      className="flex min-h-13 items-center gap-3 border-t border-[color:var(--border)] px-3.5 py-2.5 first:border-t-0"
    >
      <span className="nums w-12 shrink-0 text-sm font-normal text-[color:var(--text-heading)]">{x.at}</span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className={titleText}>{x.supervisor}</span>
        <span className={cn(secondaryText, "text-xs")}>{`${x.doctorName} · ${formWord(x.form)}`}</span>
      </span>
      <Pill pill={{ label: "Not sent · sample", tone: "neutral" }} />
    </li>
  );
  return (
    <div className="grid gap-2" data-testid="assessments-overview-sent">
      {today.length ? (
        <>
          <SectionLabel>{`Today · ${today.length}`}</SectionLabel>
          <List label="Reminders today">{today.map(row)}</List>
        </>
      ) : null}
      {earlier.length ? (
        <>
          <SectionLabel>Earlier made-up days</SectionLabel>
          <List label="Earlier reminders">{earlier.map(row)}</List>
        </>
      ) : null}
      <SmallPrint>
        In use, each reminder would show whether it was delivered. Automatic reminders on the due date need the
        hospital&apos;s own system, so this sample has none.
      </SmallPrint>
    </div>
  );
}

function BulkRemind({
  recipients,
  onSend,
}: {
  recipients: readonly BulkRecipient[];
  onSend: (items: BulkRecipient["items"][number][]) => void;
}) {
  const open = recipients.filter((x) => !x.remindedToday);
  const [ticked, setTicked] = useState<readonly string[]>(() => open.map((x) => x.supervisor));
  const whyId = useId();
  const chosen = open.filter((x) => ticked.includes(x.supervisor));
  const items = chosen.flatMap((x) => x.items);
  const first = items[0];
  return (
    <div className="grid gap-3" data-testid="assessments-overview-bulk">
      <List label="Recipients">
        {open.map((x) => (
          <TickRow
            key={x.supervisor}
            checked={ticked.includes(x.supervisor)}
            onChange={() =>
              setTicked((all) =>
                all.includes(x.supervisor) ? all.filter((n) => n !== x.supervisor) : [...all, x.supervisor],
              )
            }
            detail={x.line}
          >
            {x.supervisor}
          </TickRow>
        ))}
        {recipients
          .filter((x) => x.remindedToday)
          .map((x) => (
            <Row
              key={x.supervisor}
              title={x.supervisor}
              subtitle={`${x.line} · reminded today`}
              tag={<Pill pill={{ label: "Today", tone: "neutral" }} />}
            />
          ))}
      </List>
      {first ? (
        <div className="grid gap-1.5">
          <SectionLabel>What they get</SectionLabel>
          <p
            data-testid="assessments-overview-bulk-message"
            className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2.5 text-sm text-[color:var(--text)]"
          >
            {reminderMessage(first.row, first.form)}
          </p>
          {items.length > 1 ? (
            <SmallPrint>{`One message per form, in the same words: ${items.length} forms.`}</SmallPrint>
          ) : null}
        </div>
      ) : null}
      <PrivacyLine />
      <Button
        variant="primary"
        block
        disabled={chosen.length === 0}
        aria-describedby={chosen.length === 0 ? whyId : undefined}
        onClick={() => onSend(items)}
        testId="assessments-overview-bulk-send"
      >
        {chosen.length === 0
          ? "Send reminders"
          : `Send ${chosen.length} ${chosen.length === 1 ? "reminder" : "reminders"}`}
      </Button>
      {chosen.length === 0 ? <WhyNot id={whyId}>Tick at least one supervisor.</WhyNot> : null}
    </div>
  );
}

function ExportSheet({
  rows,
  reminders,
  dateLabel,
  onDone,
}: {
  rows: readonly OverviewDoctor[];
  reminders: readonly ReminderRecord[];
  dateLabel: string;
  onDone: () => void;
}) {
  const [options, setOptions] = useState<OverviewExportOptions>(DEFAULT_EXPORT_OPTIONS);
  // Example records never leave the app: while they show, the button explains instead of downloading.
  const example = useExampleData("assess").active;
  const blocker = exportBlocker(options);
  const whyId = useId();
  const toggle = (key: keyof OverviewExportOptions) => setOptions((o) => ({ ...o, [key]: !o[key] }));
  const href = `data:text/csv;charset=utf-8,${encodeURIComponent(overviewCsv(rows, dateLabel, options, reminders))}`;
  return (
    <div className="grid gap-3" data-testid="assessments-overview-export">
      <List label="What to include">
        <TickRow checked={options.forms} onChange={() => toggle("forms")} detail="Done, due or overdue">
          Mid-term and end-of-term
        </TickRow>
        <TickRow checked={options.epas} onChange={() => toggle("epas")} detail="Number recorded, not content">
          EPA counts
        </TickRow>
        <TickRow checked={options.history} onChange={() => toggle("history")} detail="Times sent from this page">
          Reminder history
        </TickRow>
      </List>
      <Inset tone="plain" icon={Lock} title="Status only">
        No ratings or comments can leave from here. A spreadsheet (CSV) of made-up doctors.
      </Inset>
      {blocker ? (
        <>
          <Button variant="primary" block disabled aria-describedby={whyId}>
            Download spreadsheet
          </Button>
          <WhyNot id={whyId}>{blocker}</WhyNot>
        </>
      ) : example ? (
        <Button
          variant="primary"
          block
          icon={Download}
          onClick={() => guardExampleAction(true, "export")}
          data-testid="assessments-overview-csv-example"
        >
          Download spreadsheet
        </Button>
      ) : (
        <a
          href={href}
          download={OVERVIEW_CSV_NAME}
          // The download starts from this tap first. The sheet closes on the next tick, so the link is still on
          // the page when the browser acts on it (a detached link can lose its download in some browsers).
          onClick={() => window.setTimeout(onDone, 0)}
          data-testid="assessments-overview-csv"
          className={cn(buttonFaceClass({ variant: "primary", block: true }), "no-underline")}
        >
          <Download aria-hidden="true" className="size-icon-sm" />
          Download spreadsheet
        </a>
      )}
    </div>
  );
}

const TIMELINE_ICON: Record<CellStatus, LucideIcon> = {
  done: Check,
  due: Clock,
  overdue: TriangleAlert,
  not_yet: Minus,
};

function DoctorDetail({ s, doctorId }: ScreenProps & { doctorId: string }) {
  const r = useReminders(s);
  const whyId = useId();
  const rows = useMemo(() => overviewDoctors(s), [s]);
  const row = rows.find((x) => x.id === doctorId);
  const back = viewHref("overview", asSup);
  if (!row)
    return (
      <div className="grid gap-3" data-testid="assessments-overview-doctor-missing">
        <ScreenHeader back={back} backLabel="the term overview" title="Doctor" />
        <Inset tone="plain" title="That doctor isn't in this made-up list">
          <TextLink href={back}>Back to every doctor</TextLink>
        </Inset>
      </div>
    );
  const state = r.bellState(row);
  const history = r.extras.reminders.filter((x) => x.doctorId === row.id).reverse();
  const forms = remindableForms(row).map(formWord).join(" and ");
  const reason =
    state === "reminded"
      ? "Reminded today. One reminder a day per form."
      : state === "offline"
        ? "Can't send while offline. Try again when you are back online."
        : null;
  return (
    <div className="grid gap-3" data-testid="assessments-overview-doctor">
      <ScreenHeader
        back={back}
        backLabel="the term overview"
        title={row.name}
        subtitle={`${row.grade} · ${row.unit} · ${row.supervisor}`}
      />
      {r.offlineSince ? <OfflineNote since={r.offlineSince} /> : null}
      <SectionLabel>Term 4 · status only</SectionLabel>
      <List label="Status">
        {doctorTimeline(row).map((item) => {
          const Icon = TIMELINE_ICON[item.status];
          return (
            <li
              key={item.id}
              className="flex min-h-15 min-w-0 items-center gap-3 border-t border-[color:var(--border)] px-3.5 py-3 first:border-t-0"
            >
              <span
                aria-hidden="true"
                className={cn("grid size-9 shrink-0 place-items-center rounded-full", MARK[item.status].className)}
              >
                <Icon aria-hidden="true" strokeWidth={2} className="size-icon-sm" />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className={titleText}>{item.title}</span>
                <span className={secondaryText}>{item.detail}</span>
              </span>
              <Pill
                pill={{
                  label:
                    item.id === "epas"
                      ? item.status === "done"
                        ? "At target"
                        : "Below target"
                      : CELL_WORDS[item.status],
                  tone: TONE[item.status],
                }}
              />
            </li>
          );
        })}
      </List>
      <div className="grid gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3.5">
        <span className="flex items-start gap-2.5">
          <Lock aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--text-muted)]" />
          <span className="grid gap-0.5">
            <b className={titleText}>Content stays private</b>
            <span className={secondaryText}>
              Ratings, comments and self-ratings are not shown here. Read and countersign forms in Clinical Learning
              Australia.
            </span>
          </span>
        </span>
        <a
          href={CLA_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            focusRing,
            "inline-flex min-h-12 items-center justify-between gap-2 rounded-lg text-sm font-medium text-[color:var(--mode-identity)] no-underline",
          )}
        >
          <span>Open Clinical Learning Australia</span>
          <span className="inline-flex items-center gap-1 text-xs text-[color:var(--text-muted)]">
            Opens outside PsychSift
            <ExternalLink aria-hidden="true" className="size-icon-xs" />
          </span>
        </a>
      </div>
      <SectionLabel>Reminders</SectionLabel>
      {history.length ? (
        <List label="Reminders">
          {history.map((x) => (
            <Row
              key={x.key}
              title={`${x.supervisor} reminded`}
              subtitle={`You · ${x.at} · ${formWord(x.form)} · made-up, not sent`}
            />
          ))}
        </List>
      ) : (
        <SmallPrint>No reminders yet.</SmallPrint>
      )}
      {state === "none" ? (
        <Inset tone="ok" icon={Check} title="Nothing to remind about">
          No mid-term or end-of-term form is due for this doctor right now.
        </Inset>
      ) : (
        <>
          <Button
            variant="primary"
            block
            icon={state === "reminded" ? Check : Bell}
            disabled={state !== "pending"}
            aria-describedby={reason ? whyId : undefined}
            onClick={() => r.remindDoctor(row)}
            testId="assessments-overview-doctor-remind"
          >
            {state === "reminded" ? "Reminded today" : `Remind ${row.supervisor}`}
          </Button>
          {reason ? <WhyNot id={whyId}>{reason}</WhyNot> : null}
          {state === "pending" ? (
            <SmallPrint center>{`About the ${forms}. Status only, nothing about how ${row.name} is doing.`}</SmallPrint>
          ) : null}
        </>
      )}
      <Link
        href={traineeHref(row.id)}
        className={cn(
          focusRing,
          "inline-flex min-h-12 items-center justify-center gap-1 text-sm font-medium text-[color:var(--mode-identity)] no-underline",
        )}
        data-testid="assessments-overview-doctor-trainee"
      >
        {`Requests and supervision for ${row.name}`}
        <ChevronRight aria-hidden="true" className="size-icon-sm" />
      </Link>
      <Link
        href={back}
        className={cn(
          focusRing,
          "inline-flex min-h-12 items-center justify-center gap-1 text-sm font-medium text-[color:var(--mode-identity)] no-underline",
        )}
      >
        Every doctor
        <ChevronRight aria-hidden="true" className="size-icon-sm" />
      </Link>
    </div>
  );
}
