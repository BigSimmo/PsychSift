"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Bell, CalendarPlus, ChevronRight, FileClock, Layers, Mail, PenLine, Send, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { useAccountData } from "@/components/account-data-provider";
import { AdminLoadFailed } from "@/components/admin/admin-load-failed";
import {
  ContractAskSheet,
  ContractFormSheet,
  ContractQuestionSheet,
  ContractRenewSheet,
} from "@/components/admin/contract/contract-sheets";
import { ContractStrip } from "@/components/admin/contract/contract-strip";
import { LeaveWalletEntryLink } from "@/components/admin/leave/leave-wallet-entry-link";
import {
  createEntry,
  deleteEntry,
  errorWords,
  JuniorFootNote,
  JuniorNotice,
  JuniorSectionLabel,
  JuniorUndoBar,
  patchEntry,
  slugSuffix,
} from "@/components/admin/junior/junior-shared";
import {
  ROSTER_LEAVE_KIND_WORDS,
  ROSTER_LEAVE_STATUS_WORDS,
  useJuniorRosterLeave,
} from "@/components/admin/junior/use-roster-leave";
import { cardSurface, focusRing } from "@/components/card-recipes";
import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { InformationPageShell } from "@/components/information-page-shell";
import { PageTitleUnderBand } from "@/components/mode-band/mode-band";
import { ModeFeaturedModule } from "@/components/mode-kit/featured-module";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { Button } from "@/components/ui/button";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import {
  buildContractAskedBody,
  buildContractCreateBody,
  buildContractEditBody,
  buildContractRemindersBody,
  buildContractRenewBody,
  contractAskedQuestions,
  contractCalendarFile,
  contractEmployer,
  contractEndHistory,
  contractNote,
  contractPanelLine,
  contractReminders,
  contractStatus,
  contractStrip,
  CONTRACT_QUESTIONS,
  selectContractEnd,
  type ContractFormInput,
  type ContractQuestion,
  type ContractQuestionId,
  type ContractReminders,
  type ContractStatus,
} from "@/lib/admin/contract-end";
import { downloadTextFile } from "@/lib/admin/download-file";
import { adminLoadState, selectAdminOwnEntries } from "@/lib/admin/own-entries";
import { buildRestoreEntryBody } from "@/lib/admin/renewals";
import { formatDateEcho, formatRecordedDate } from "@/lib/admin/renewal-dates";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { complianceExpiresOn } from "@/lib/on-call/compliance";
import { cacheOnCallEntries, useOnCallEntries } from "@/lib/on-call/entry-store";
import type { OnCallEntry } from "@/lib/on-call/entry-model";

type Undo = { id: number; label: string; run: () => Promise<void> };
type SheetName = "add" | "edit" | "ask" | "renew" | null;

function daysLeftWords(status: ContractStatus): { big: string; small: string } {
  if (status.daysLeft < 0) {
    const ago = -status.daysLeft;
    return { big: String(ago), small: ago === 1 ? "day since it ended" : "days since it ended" };
  }
  if (status.daysLeft === 0) return { big: "0", small: "ends today" };
  return { big: String(status.daysLeft), small: status.daysLeft === 1 ? "day left" : "days left" };
}

function askLabel(status: ContractStatus): string {
  if (status.daysLeft < 0) return "Ask about your next contract";
  if (
    status.reminderToday ||
    status.phase === "between" ||
    status.phase === "final-weeks" ||
    status.phase === "ends-today"
  ) {
    return "Ask this week";
  }
  const next = status.nextReminder;
  return next ? `Ask before ${formatDateEcho(next.date).replace(/\s\d{4}$/, "")}` : "Ask before the end";
}

function ReminderSwitch({
  label,
  date,
  on,
  disabled,
  reason,
  onToggle,
  testId,
}: {
  label: string;
  date: string;
  on: boolean;
  disabled: boolean;
  reason: string | null;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-b border-[color:var(--border)] px-3 py-2 last:border-b-0">
      <span className="grid min-w-0 flex-1">
        <span className="text-sm font-medium text-[color:var(--text-heading)]">{label}</span>
        <span className={cn(textMuted, "nums text-xs")}>{formatDateEcho(date)}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${label}, ${formatDateEcho(date)}`}
        aria-disabled={disabled ? "true" : undefined}
        aria-describedby={reason ? `${testId}-reason` : undefined}
        onClick={() => {
          if (!disabled) onToggle();
        }}
        data-testid={testId}
        className={cn(
          focusRing,
          "inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center",
          disabled && "opacity-60",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "relative inline-flex h-6 w-10 items-center rounded-full border transition-colors motion-reduce:transition-none",
            on
              ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)]"
              : "border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)]",
          )}
        >
          <span
            className={cn(
              "absolute size-5 rounded-full bg-[color:var(--surface-raised)] transition-transform motion-reduce:transition-none",
              on ? "translate-x-[1.05rem]" : "translate-x-0.5",
            )}
          />
        </span>
      </button>
      {reason ? (
        <span id={`${testId}-reason`} className="sr-only">
          {reason}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Contract end tracker, `/admin/contract` (junior feature #6). The end date
 * from the letter, a calm countdown strip with the 3 month and 6 week
 * reminder points, what to ask before the end, a message for Medical
 * Workforce that the doctor sends themselves, and the leave they have
 * planned before the end. One private compliance row through the existing
 * entries API, so Admin Today and Renewals see it too. No device storage.
 */
export function ContractEndPage({ now: nowProp }: { now?: Date } = {}) {
  const { isAuthenticated } = useAccountData();
  const state = useOnCallEntries();
  const mountedAt = useMemo(() => new Date(), []);
  const now = nowProp ?? mountedAt;
  const today = perthCalendarDate(now);
  const loadState = adminLoadState(state);
  const own = useMemo(() => selectAdminOwnEntries(state), [state]);
  const entry = selectContractEnd(own);
  const endsOn = entry ? (complianceExpiresOn(entry) ?? null) : null;
  const reminders = entry ? contractReminders(entry) : null;
  const status = endsOn && reminders ? contractStatus(endsOn, today, reminders) : null;
  const strip = status ? contractStrip(status) : null;
  const canWrite = loadState === "ready" && !state.demoMode && isAuthenticated;
  const readOnlyReason = state.demoMode
    ? "These are example records. Sign in to track your own contract."
    : !isAuthenticated
      ? "Sign in to change your contract dates."
      : null;

  const [sheet, setSheet] = useState<SheetName>(null);
  const [question, setQuestion] = useState<ContractQuestion | null>(null);
  // A link from another page (the parental leave card) opens one question.
  const searchParams = useSearchParams();
  const questionParam = searchParams?.get("question") ?? null;
  const [seenQuestionParam, setSeenQuestionParam] = useState<string | null>(null);
  if (questionParam !== seenQuestionParam) {
    setSeenQuestionParam(questionParam);
    const linked = CONTRACT_QUESTIONS.find((item) => item.id === questionParam);
    if (linked) setQuestion(linked);
  }
  const [undo, setUndo] = useState<Undo | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const undoId = useRef(0);
  const leave = useJuniorRosterLeave(loadState === "ready" && Boolean(endsOn));

  function upsert(saved: OnCallEntry) {
    const entries = state.entries;
    cacheOnCallEntries(
      entries.some((existing) => existing.id === saved.id)
        ? entries.map((existing) => (existing.id === saved.id ? saved : existing))
        : [...entries, saved],
    );
  }
  function remove(id: string) {
    cacheOnCallEntries(state.entries.filter((existing) => existing.id !== id));
  }
  function offerUndo(label: string, run: () => Promise<void>) {
    undoId.current += 1;
    setUndo({ id: undoId.current, label, run });
  }

  async function restore(original: OnCallEntry) {
    const saved = await patchEntry(original.id, buildRestoreEntryBody(original));
    upsert(saved);
  }

  async function saveForm(input: ContractFormInput): Promise<string | null> {
    try {
      if (entry) {
        const original = entry;
        const saved = await patchEntry(entry.id, buildContractEditBody(entry, input));
        upsert(saved);
        offerUndo("Contract dates saved", () => restore(original));
      } else {
        const saved = await createEntry(buildContractCreateBody(input, slugSuffix()));
        upsert(saved);
        offerUndo("Contract end saved", async () => {
          await deleteEntry(saved.id);
          remove(saved.id);
        });
      }
      setSheet(null);
      return null;
    } catch (error) {
      return errorWords(error, "Could not save your contract dates.");
    }
  }

  async function saveRenew(newEnd: string, keepAnswers: boolean): Promise<string | null> {
    if (!entry) return "Nothing to renew yet.";
    const result = buildContractRenewBody(entry, newEnd, today, { keepAnswers });
    if (!result.ok) return "Check the new end date.";
    try {
      const original = entry;
      const saved = await patchEntry(entry.id, result.body);
      upsert(saved);
      setSheet(null);
      offerUndo("New end date saved. Reminders moved", () => restore(original));
      return null;
    } catch (error) {
      return errorWords(error, "Could not save the new end date.");
    }
  }

  async function markAsked(ids: readonly ContractQuestionId[], asked: boolean): Promise<string | null> {
    if (!entry || ids.length === 0) return null;
    try {
      const original = entry;
      const saved = await patchEntry(entry.id, buildContractAskedBody(entry, ids, asked));
      upsert(saved);
      const label = asked
        ? ids.length === 1
          ? "Marked as asked"
          : `${ids.length} questions marked as asked`
        : "Marked as not asked yet";
      offerUndo(label, () => restore(original));
      return null;
    } catch (error) {
      return errorWords(error, "Could not save that mark.");
    }
  }

  async function toggleReminder(key: keyof ContractReminders) {
    if (!entry || !reminders || busy) return;
    const next = { ...reminders, [key]: !reminders[key] };
    const body = buildContractRemindersBody(entry, next);
    if (!body) return;
    setBusy(true);
    setFailure(null);
    try {
      const original = entry;
      const saved = await patchEntry(entry.id, body);
      upsert(saved);
      const name = key === "threeMonths" ? "3 month" : "6 week";
      offerUndo(`${name} reminder ${next[key] ? "on" : "off"}`, () => restore(original));
    } catch (error) {
      setFailure(errorWords(error, "Could not change the reminder."));
    } finally {
      setBusy(false);
    }
  }

  async function removeRecord() {
    if (!entry || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const original = entry;
      await deleteEntry(entry.id);
      remove(entry.id);
      offerUndo("Contract end removed", async () => {
        const recreated = await createEntry({ ...buildRestoreEntryBody(original) });
        upsert(recreated);
      });
    } catch (error) {
      setFailure(errorWords(error, "Could not remove the record."));
    } finally {
      setBusy(false);
    }
  }

  async function runUndo() {
    if (!undo) return;
    const { run } = undo;
    setUndo(null);
    try {
      await run();
    } catch (error) {
      setFailure(errorWords(error, "Could not undo that change."));
    }
  }

  function downloadCalendar() {
    if (!entry) return;
    const file = contractCalendarFile(entry, now);
    if (file) downloadTextFile(file, "contract-end.ics", "text/calendar");
  }

  const formInitial: ContractFormInput | null = entry
    ? {
        endsOn: endsOn ?? "",
        employer: contractEmployer(entry) ?? "",
        note: contractNote(entry) ?? "",
        reminders: reminders ?? { threeMonths: true, sixWeeks: true },
      }
    : null;
  const history = entry ? contractEndHistory(entry) : [];
  const asked = contractAskedQuestions(entry);
  const leaveBeforeEnd =
    leave.status === "ready" && endsOn
      ? leave.leave
          .filter((item) => item.endsOn >= today && item.startsOn <= endsOn)
          .sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1))
      : [];

  return (
    <>
      <InformationPageShell testId="admin-contract-main">
        <div className="grid gap-1">
          <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
            Contract end
          </PageTitleUnderBand>
          <p className={cn(textMuted, "text-sm")}>Dates you entered from your letter</p>
        </div>

        {failure ? (
          <p role="alert" className="text-sm text-[color:var(--text)]" data-testid="admin-contract-error">
            {failure}
          </p>
        ) : null}

        {loadState === "failed" ? (
          <AdminLoadFailed reason={state.loadError} onRetry={state.retry} testId="admin-contract-load-failed" />
        ) : loadState === "loading" ? (
          <ModeModuleSkeleton rows={5} twoLine eyebrow testId="admin-contract-loading" />
        ) : loadState === "signed-out" ? (
          <JuniorNotice
            title="Sign in to track your contract"
            testId="admin-contract-signed-out"
            action={
              <Button variant="primary" onClick={() => setSignInOpen(true)}>
                Sign in
              </Button>
            }
          >
            Your end date is kept for your signed-in account only. Nothing is saved on this phone.
          </JuniorNotice>
        ) : !entry || !status || !strip || !endsOn ? (
          <>
            <div
              className={cn(cardSurface, "grid justify-items-center gap-2 px-4 py-6 text-center")}
              data-testid="admin-contract-first"
            >
              <FileClock aria-hidden="true" strokeWidth={1.5} className="size-icon-lg text-[color:var(--text-muted)]" />
              <h2 className="text-lg-minus font-semibold text-[color:var(--text-heading)]">
                When does your contract end?
              </h2>
              <p className="max-w-prose text-sm text-[color:var(--text)]">
                Add the end date from your letter once. You get a reminder 3 months and 6 weeks before, with a list of
                what to ask.
              </p>
              {canWrite ? (
                <Button variant="primary" onClick={() => setSheet("add")} testId="admin-contract-add">
                  Add end date
                </Button>
              ) : (
                <p className={cn(textMuted, "text-sm")} data-testid="admin-contract-read-only">
                  {readOnlyReason}
                </p>
              )}
            </div>
            <JuniorSectionLabel>What you get</JuniorSectionLabel>
            <ul className={cn(cardSurface, "overflow-hidden")}>
              {[
                { icon: Bell, title: "Two calm reminders", sub: "3 months and 6 weeks before the end" },
                { icon: Layers, title: "A list of what to ask", sub: "Including planned parental leave" },
                { icon: Send, title: "A ready message", sub: "Copy it to Medical Workforce yourself" },
              ].map((row) => (
                <li
                  key={row.title}
                  className="flex min-h-12 items-center gap-3 border-b border-[color:var(--border)] px-3 py-2 last:border-b-0"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--surface-subtle)]">
                    <row.icon
                      aria-hidden="true"
                      strokeWidth={1.5}
                      className="size-icon-sm text-[color:var(--text-heading)]"
                    />
                  </span>
                  <span className="grid min-w-0">
                    <span className="text-sm font-medium text-[color:var(--text-heading)]">{row.title}</span>
                    <span className={cn(textMuted, "text-xs")}>{row.sub}</span>
                  </span>
                </li>
              ))}
            </ul>
            <JuniorFootNote>Kept in your account. Medical Workforce does not see it.</JuniorFootNote>
          </>
        ) : (
          <>
            <ModeFeaturedModule
              as="section"
              mode="my-work"
              className="grid min-w-0 gap-3 p-4"
              testId="admin-contract-hero"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="grid min-w-0 gap-1">
                  <h2 className={eyebrowText}>
                    {status.reminderToday ? `${status.reminderToday.label} to go` : "Contract ends"}
                  </h2>
                  <p
                    className="nums text-lg-minus font-semibold text-[color:var(--text-heading)]"
                    data-testid="admin-contract-end-date"
                  >
                    {formatDateEcho(endsOn)}
                  </p>
                  {contractEmployer(entry) ? (
                    <p className="break-words text-sm text-[color:var(--text)]">{contractEmployer(entry)}</p>
                  ) : null}
                </div>
                <div className="grid shrink-0 justify-items-end text-right" data-testid="admin-contract-days">
                  <b className="nums text-3xl-minus font-semibold leading-none text-[color:var(--text-heading)]">
                    {daysLeftWords(status).big}
                  </b>
                  <span className={cn(textMuted, "text-xs")}>{daysLeftWords(status).small}</span>
                </div>
              </div>
              <ContractStrip strip={strip} />
              <p
                className="flex items-start gap-2 rounded-lg bg-[color:var(--surface-raised)] px-3 py-2 text-sm text-[color:var(--text)]"
                data-testid="admin-contract-panel"
              >
                <Bell
                  aria-hidden="true"
                  strokeWidth={1.5}
                  className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--clinical-accent)]"
                />
                <span>{contractPanelLine(status)}</span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                {status.daysLeft < 0 ? (
                  canWrite ? (
                    <Button variant="primary" onClick={() => setSheet("renew")} testId="admin-contract-renew-open">
                      New contract
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      icon={Mail}
                      onClick={() => setSheet("ask")}
                      testId="admin-contract-ask-open"
                    >
                      Ask Workforce
                    </Button>
                  )
                ) : (
                  <Button
                    variant="primary"
                    icon={Mail}
                    onClick={() => setSheet("ask")}
                    testId="admin-contract-ask-open"
                  >
                    Ask Workforce
                  </Button>
                )}
                {canWrite ? (
                  <Button
                    variant="secondary"
                    icon={PenLine}
                    onClick={() => setSheet("edit")}
                    testId="admin-contract-edit"
                  >
                    Edit dates
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    icon={CalendarPlus}
                    onClick={downloadCalendar}
                    testId="admin-contract-calendar-hero"
                  >
                    Calendar
                  </Button>
                )}
              </div>
              {!canWrite && readOnlyReason ? (
                <p className={cn(textMuted, "text-xs")} data-testid="admin-contract-read-only">
                  {readOnlyReason}
                </p>
              ) : null}
            </ModeFeaturedModule>

            <JuniorSectionLabel
              count={
                asked.length
                  ? `${asked.length} of ${CONTRACT_QUESTIONS.length} asked`
                  : `${CONTRACT_QUESTIONS.length} questions`
              }
            >
              {askLabel(status)}
            </JuniorSectionLabel>
            <ul className={cn(cardSurface, "overflow-hidden")} data-testid="admin-contract-questions">
              {CONTRACT_QUESTIONS.map((item) => (
                <li key={item.id} className="border-b border-[color:var(--border)] last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setQuestion(item)}
                    data-testid={`admin-contract-question-${item.id}`}
                    className={cn(focusRing, "flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left")}
                  >
                    <span className="grid min-w-0 flex-1">
                      <span className="text-sm font-medium text-[color:var(--text-heading)]">{item.title}</span>
                      <span className={cn(textMuted, "text-xs")}>{item.hint}</span>
                    </span>
                    {asked.includes(item.id) ? (
                      <span
                        className="shrink-0 rounded-md border border-[color:var(--border)] px-2 py-0.5 text-xs text-[color:var(--text)]"
                        data-testid={`admin-contract-asked-${item.id}`}
                      >
                        Asked, waiting
                      </span>
                    ) : null}
                    <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
                  </button>
                </li>
              ))}
            </ul>

            <JuniorSectionLabel action={<span className={cn(textMuted, "text-xs")}>On Admin Today</span>}>
              Reminders
            </JuniorSectionLabel>
            <div className={cn(cardSurface, "overflow-hidden")} data-testid="admin-contract-reminders">
              {status.marks.map((mark) => (
                <ReminderSwitch
                  key={mark.kind}
                  label={`${mark.label} before`}
                  date={mark.date}
                  on={mark.on}
                  disabled={!canWrite || busy || status.daysLeft < 0}
                  reason={!canWrite ? readOnlyReason : status.daysLeft < 0 ? "The end date has passed." : null}
                  onToggle={() => void toggleReminder(mark.kind === "three-months" ? "threeMonths" : "sixWeeks")}
                  testId={`admin-contract-switch-${mark.kind}`}
                />
              ))}
              <button
                type="button"
                onClick={downloadCalendar}
                data-testid="admin-contract-calendar"
                className={cn(focusRing, "flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left")}
              >
                <CalendarPlus
                  aria-hidden="true"
                  strokeWidth={1.5}
                  className="size-icon-md shrink-0 text-[color:var(--text-muted)]"
                />
                <span className="grid min-w-0 flex-1">
                  <span className="text-sm font-medium text-[color:var(--text-heading)]">Add to my calendar</span>
                  <span className={cn(textMuted, "text-xs")}>An alert at 9 am on each reminder that is on</span>
                </span>
              </button>
            </div>

            <JuniorSectionLabel action={<LeaveWalletEntryLink compact />}>Leave before the end</JuniorSectionLabel>
            <div className={cn(cardSurface, "overflow-hidden")} data-testid="admin-contract-leave">
              {leave.status === "loading" ? (
                <p className={cn(textMuted, "px-3 py-3 text-sm")}>Loading your leave from Roster</p>
              ) : leave.status === "failed" ? (
                <p className={cn(textMuted, "px-3 py-3 text-sm")} data-testid="admin-contract-leave-failed">
                  Could not load your leave from Roster. Open Roster to check it.
                </p>
              ) : leaveBeforeEnd.length === 0 ? (
                <p className={cn(textMuted, "px-3 py-3 text-sm")} data-testid="admin-contract-leave-none">
                  No leave planned in Roster before your end date.
                </p>
              ) : (
                <ul>
                  {leaveBeforeEnd.map((item) => (
                    <li
                      key={item.id}
                      className="flex min-h-12 items-center gap-3 border-b border-[color:var(--border)] px-3 py-2 last:border-b-0"
                    >
                      <span className="grid min-w-0 flex-1">
                        <span className="text-sm font-medium text-[color:var(--text-heading)]">
                          {ROSTER_LEAVE_KIND_WORDS[item.kind]}
                        </span>
                        <span className={cn(textMuted, "nums text-xs")}>
                          {item.startsOn === item.endsOn
                            ? formatDateEcho(item.startsOn)
                            : `${formatDateEcho(item.startsOn)} to ${formatDateEcho(item.endsOn)}`}
                        </span>
                      </span>
                      <span className="rounded-md border border-[color:var(--border)] px-2 py-0.5 text-xs text-[color:var(--text)]">
                        {ROSTER_LEAVE_STATUS_WORDS[item.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href="/roster/requests"
                className={cn(
                  focusRing,
                  "flex min-h-12 items-center gap-2 border-t border-[color:var(--border)] px-3 text-sm font-medium text-[color:var(--clinical-accent)]",
                )}
              >
                Plan leave in Roster
              </Link>
            </div>

            <div className={cn(cardSurface, "overflow-hidden")}>
              {canWrite ? (
                <button
                  type="button"
                  onClick={() => setSheet("renew")}
                  data-testid="admin-contract-renew-row"
                  className={cn(
                    focusRing,
                    "flex min-h-12 w-full items-center gap-3 border-b border-[color:var(--border)] px-3 py-2 text-left",
                  )}
                >
                  <span className="grid min-w-0 flex-1">
                    <span className="text-sm font-medium text-[color:var(--text-heading)]">Got a new contract?</span>
                    <span className={cn(textMuted, "text-xs")}>Type the new end date. Reminders move with it.</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
                </button>
              ) : null}
              {contractNote(entry) ? (
                <p
                  className="border-b border-[color:var(--border)] px-3 py-2 text-sm"
                  data-testid="admin-contract-note-line"
                >
                  <span className={textMuted}>Note: </span>
                  {contractNote(entry)}
                </p>
              ) : null}
              <p className="px-3 py-2 text-sm" data-testid="admin-contract-history">
                <span className={textMuted}>Earlier end dates: </span>
                {history.length ? history.map(formatRecordedDate).join(", ") : "none recorded"}
              </p>
              {canWrite ? (
                <button
                  type="button"
                  onClick={() => void removeRecord()}
                  disabled={busy}
                  data-testid="admin-contract-remove"
                  className={cn(
                    focusRing,
                    "flex min-h-12 w-full items-center gap-2 border-t border-[color:var(--border)] px-3 text-left text-sm text-[color:var(--text-muted)]",
                  )}
                >
                  <Trash2 aria-hidden="true" strokeWidth={1.5} className="size-icon-sm" />
                  Remove this record
                </button>
              ) : null}
            </div>

            <JuniorFootNote testId="admin-contract-foot">
              Dates you entered from your letter, not a check. Medical Workforce does not see this page.
            </JuniorFootNote>
          </>
        )}
      </InformationPageShell>

      <ContractFormSheet
        open={sheet === "add" || sheet === "edit"}
        mode={sheet === "edit" ? "edit" : "add"}
        initial={sheet === "edit" ? formInitial : null}
        today={today}
        onClose={() => setSheet(null)}
        onSave={saveForm}
      />
      <ContractAskSheet
        open={sheet === "ask"}
        endsOn={endsOn}
        asked={asked}
        canMark={canWrite && Boolean(entry)}
        onMarkAsked={(ids) => markAsked(ids, true)}
        onClose={() => setSheet(null)}
      />
      <ContractRenewSheet
        open={sheet === "renew"}
        previousEnd={endsOn}
        today={today}
        build={(value) => (entry ? buildContractRenewBody(entry, value, today) : { ok: false, reason: "missing" })}
        onClose={() => setSheet(null)}
        onSave={saveRenew}
        askedCount={asked.length}
      />
      <ContractQuestionSheet
        question={question}
        endsOn={endsOn}
        asked={question ? asked.includes(question.id) : false}
        canMark={canWrite && Boolean(entry)}
        onMark={(next) => (question ? markAsked([question.id], next) : Promise.resolve(null))}
        onClose={() => setQuestion(null)}
      />

      {loadState === "signed-out" ? (
        <AccountSetupDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
      ) : null}

      {undo ? (
        <JuniorUndoBar
          key={undo.id}
          label={undo.label}
          onUndo={() => void runUndo()}
          onDismiss={() => setUndo(null)}
          testId="admin-contract-undo"
        />
      ) : null}
    </>
  );
}
