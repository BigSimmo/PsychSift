"use client";

import { Bell, BellOff, ChevronDown, Download, Lock } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { useAssessmentsExtras } from "@/components/teaching/assessments/assessments-extras";
import {
  Eyebrow,
  Inset,
  KeyValue,
  List,
  Panel,
  Pill,
  Row,
  ScreenHeader,
  SmallPrint,
  TextLink,
  secondaryText,
  titleText,
  viewHref,
} from "@/components/teaching/assessments/assessments-parts";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { UNDO_MS } from "@/components/teaching/use-delayed-post";
import { buttonFaceClass } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/chip";
import { announce } from "@/components/ui/live-announcer";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui-primitives";
import { todayLabel, type PillTone } from "@/lib/teaching/assessments/model";
import {
  CELL_WORDS,
  OVERVIEW_CSV_NAME,
  OVERVIEW_FILTERS,
  OVERVIEW_PRIVACY_LINE,
  filterOverview,
  formWord,
  midTermSummary,
  overviewCounts,
  overviewCsv,
  overviewDoctors,
  remindableForms,
  reminderKey,
  supervisorGroups,
  type CellStatus,
  type OverviewDoctor,
  type OverviewFilter,
} from "@/lib/teaching/assessments/overview";

/*
 * The term assessments overview (feature 4): every doctor's mid-term, EPAs and end-of-term as status tags,
 * with a one-tap Remind to the supervisor and Undo. Made-up doctors in page memory: a reminder here is
 * pretend, and ratings and comments are never part of this view.
 */

const asSup = { as: "supervisor" };
const TONE: Record<CellStatus, PillTone> = { done: "ok", due: "accent", overdue: "warm", not_yet: "neutral" };

function StatusTag({ label, cell }: { label: string; cell: { status: CellStatus; detail: string } }) {
  const word = label === "EPAs" ? cell.detail : cell.status === "not_yet" ? "Not open" : CELL_WORDS[cell.status];
  return <Pill pill={{ label: `${label} · ${word}`, tone: TONE[cell.status] }} />;
}

const SEGMENT: Record<"done" | "due" | "overdue", string> = {
  done: "bg-[color:var(--success-text)]",
  due: "bg-[color:var(--mode-identity)]",
  overdue: "bg-[color:var(--warning-text)]",
};

/** One segment per doctor, done first: the words are in its label, so colour is never the only signal. */
function MidTermMeter({ done, due, overdue, label }: ReturnType<typeof midTermSummary>) {
  const parts = [
    ...Array.from({ length: done }, () => "done" as const),
    ...Array.from({ length: due }, () => "due" as const),
    ...Array.from({ length: overdue }, () => "overdue" as const),
  ];
  const legend = [
    { n: done, word: "done" as const },
    { n: due, word: "due" as const },
    { n: overdue, word: "overdue" as const },
  ];
  return (
    <div className="grid gap-2">
      <div
        role="img"
        aria-label={label}
        data-testid="assessments-overview-meter"
        className="grid auto-cols-fr grid-flow-col gap-1 forced-colors:forced-color-adjust-none"
      >
        {parts.map((status, i) => (
          <i key={i} data-status={status} className={cn("block h-2 rounded-xs", SEGMENT[status])} />
        ))}
      </div>
      <ul aria-hidden="true" className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-[color:var(--text-muted)]">
        <li>Mid-term</li>
        {legend
          .filter((l) => l.n > 0)
          .map((l) => (
            <li key={l.word} className="inline-flex items-center gap-1.5">
              <i className={cn("block size-2 shrink-0 rounded-xs", SEGMENT[l.word])} />
              <span className="nums font-normal">{`${l.n} ${l.word}`}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

export function AssessmentsTermOverview({ s }: ScreenProps) {
  const { extras, dispatchExtras } = useAssessmentsExtras();
  const toast = useToast();
  const [tab, setTab] = useState<"doctors" | "supervisors">("doctors");
  const [filter, setFilter] = useState<OverviewFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = useMemo(() => overviewDoctors(s), [s]);
  const counts = overviewCounts(rows);
  const summary = midTermSummary(rows);
  const shown = filterOverview(rows, filter);
  const epasMet = rows.filter((r) => r.epas.status === "done").length;
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(overviewCsv(rows, todayLabel(s)))}`;

  const pending = (row: OverviewDoctor) =>
    remindableForms(row).filter((f) => !extras.reminded.includes(reminderKey(row.id, f, s.now)));

  function remind(keys: string[], title: string) {
    if (!keys.length) return;
    dispatchExtras({ type: "remind", keys });
    toast.push({
      tone: "info",
      title,
      body: "Made-up: nothing is sent. One reminder a day per form.",
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onAction: () => {
          dispatchExtras({ type: "unremind", keys });
          announce("Reminder taken back.");
        },
      },
    });
  }

  function remindDoctor(row: OverviewDoctor) {
    const forms = pending(row);
    remind(
      forms.map((f) => reminderKey(row.id, f, s.now)),
      `Reminder to ${row.supervisor} about ${row.name}'s ${forms.map(formWord).join(" and ")}`,
    );
  }

  return (
    <div className="grid gap-3" data-testid="assessments-overview">
      <ScreenHeader
        back={viewHref("home", asSup)}
        backLabel="your requests"
        title="Term overview"
        subtitle="Made-up doctors · status only"
      />
      <Panel>
        <Eyebrow accent>Term 4 · made-up hospital</Eyebrow>
        <h2 className="text-xl font-semibold text-[color:var(--text-heading)]">
          {`${rows.length} doctors · ${counts.overdue} overdue`}
        </h2>
        <MidTermMeter {...summary} />
        <KeyValue k="EPAs at the term target" v={`${epasMet} of ${rows.length}`} />
        <KeyValue k="End-of-term window" v="26 Oct to 6 Nov" />
      </Panel>
      <SegmentedControl
        label="Group by"
        layout="equal"
        value={tab}
        onChange={setTab}
        options={[
          { value: "doctors", label: "Doctors" },
          { value: "supervisors", label: "Supervisors" },
        ]}
      />
      {tab === "doctors" ? (
        <>
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
            {OVERVIEW_FILTERS.map((f) => (
              <ChoiceChip key={f.id} pressed={filter === f.id} onPressedChange={() => setFilter(f.id)}>
                {`${f.label} · ${counts[f.id]}`}
              </ChoiceChip>
            ))}
          </div>
          {shown.length === 0 ? (
            <Inset tone="plain" title="None match this filter">
              <TextLink onClick={() => setFilter("all")}>Show all</TextLink>
            </Inset>
          ) : (
            <ul role="list" aria-label="Doctors" className="grid min-w-0">
              {shown.map((row) => (
                <DoctorRow
                  key={row.id}
                  row={row}
                  open={openId === row.id}
                  onToggle={() => setOpenId(openId === row.id ? null : row.id)}
                  remindable={remindableForms(row).length > 0}
                  pending={pending(row).length > 0}
                  onRemind={() => remindDoctor(row)}
                />
              ))}
            </ul>
          )}
        </>
      ) : (
        <List label="Supervisors">
          {supervisorGroups(rows).map((group) => {
            const keys = group.doctors.flatMap((d) => pending(d).map((f) => reminderKey(d.id, f, s.now)));
            const any = group.doctors.some((d) => remindableForms(d).length > 0);
            return (
              <Row
                key={group.name}
                title={group.name}
                subtitle={`${group.doctors.length} doctors · ${group.overdue} overdue · ${group.due} due`}
                end={
                  any ? (
                    <RemindButton
                      pending={keys.length > 0}
                      label={
                        keys.length
                          ? `Remind ${group.name} about ${keys.length} ${keys.length === 1 ? "form" : "forms"}`
                          : `${group.name} reminded today`
                      }
                      onClick={() =>
                        remind(
                          keys,
                          `Reminder to ${group.name} about ${keys.length} ${keys.length === 1 ? "form" : "forms"}`,
                        )
                      }
                    />
                  ) : (
                    <Pill pill={{ label: "On track", tone: "ok" }} />
                  )
                }
              />
            );
          })}
        </List>
      )}
      <a
        href={csvHref}
        download={OVERVIEW_CSV_NAME}
        data-testid="assessments-overview-csv"
        className={cn(buttonFaceClass({ variant: "secondary", block: true }), "no-underline")}
      >
        <Download aria-hidden="true" className="size-icon-sm" />
        Download status (CSV)
      </a>
      <SmallPrint>
        {OVERVIEW_PRIVACY_LINE} One reminder a day per form; EPAs are the doctor&apos;s to ask for, so they get no
        reminder here. Every doctor and supervisor on this page is made-up.
      </SmallPrint>
    </div>
  );
}

function RemindButton({ pending, label, onClick }: { pending: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={pending ? undefined : true}
      onClick={pending ? onClick : undefined}
      className={cn(
        focusRing,
        "inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium",
        pending
          ? "text-[color:var(--mode-identity)] hover:bg-[color:var(--surface-wash)]"
          : "cursor-default text-[color:var(--text-muted)]",
      )}
    >
      {pending ? (
        <Bell aria-hidden="true" className="size-icon-sm" />
      ) : (
        <BellOff aria-hidden="true" className="size-icon-sm" />
      )}
      <span aria-hidden="true">{pending ? "Remind" : "Reminded"}</span>
    </button>
  );
}

function DoctorRow({
  row,
  open,
  onToggle,
  remindable,
  pending,
  onRemind,
}: {
  row: OverviewDoctor;
  open: boolean;
  onToggle: () => void;
  remindable: boolean;
  pending: boolean;
  onRemind: () => void;
}) {
  const detailId = useId();
  const forms = remindableForms(row).map(formWord).join(" and ");
  return (
    <li
      className="border-t border-[color:var(--border)] first:border-t-0"
      data-testid={`assessments-overview-${row.id}`}
    >
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={onToggle}
          className={cn(focusRing, "flex min-h-15 min-w-0 flex-1 items-center gap-3 rounded-lg px-3.5 py-3 text-left")}
        >
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-xs font-semibold text-[color:var(--text-heading)]"
          >
            {row.initials}
          </span>
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className={titleText}>{row.name}</span>
            <span className={secondaryText}>{`${row.grade} · ${row.unit} · ${row.supervisor}`}</span>
            <span className="mt-1 flex flex-wrap gap-1.5">
              <StatusTag label="Mid" cell={row.mid} />
              <StatusTag label="EPAs" cell={row.epas} />
              <StatusTag label="End" cell={row.end} />
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn("size-icon-sm shrink-0 text-[color:var(--text-muted)]", open && "rotate-180")}
          />
        </button>
        {remindable ? (
          <RemindButton
            pending={pending}
            label={
              pending
                ? `Remind ${row.supervisor} about ${row.name}'s ${forms}`
                : `${row.supervisor} reminded today about ${row.name}`
            }
            onClick={onRemind}
          />
        ) : null}
      </div>
      <div id={detailId} hidden={!open} className="grid gap-1 px-3.5 pb-3">
        <KeyValue k="Mid-term" v={row.mid.detail} />
        <KeyValue k="EPAs this term" v={row.epas.detail} />
        <KeyValue k="End-of-term" v={row.end.detail} />
        <p className={cn(secondaryText, "flex items-start gap-1.5 pt-1")}>
          <Lock aria-hidden="true" className="mt-0.5 size-icon-xs shrink-0" />
          Content stays private. Ratings and comments stay with the doctor and supervisor.
        </p>
      </div>
    </li>
  );
}
