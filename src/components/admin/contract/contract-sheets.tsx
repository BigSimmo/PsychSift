"use client";

import Link from "next/link";
import { Copy, ExternalLink, Mail } from "lucide-react";
import { useState } from "react";

import { copyLabel, PatientDetailCatch, useCopy } from "@/components/admin/junior/junior-shared";
import { focusRing } from "@/components/card-recipes";
import { InlineNotice } from "@/components/primitive-recipes/feedback";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { buttonFaceClass } from "@/components/ui/button";
import { cn, eyebrowText, fieldControlPlain, textMuted } from "@/components/ui-primitives";
import {
  BOTH_REMINDERS_ON,
  CONTRACT_EMPLOYER_LIMIT,
  CONTRACT_NOTE_LIMIT,
  CONTRACT_QUESTIONS,
  CONTRACT_RENEW_REASON,
  contractAskMessage,
  contractFormHasErrors,
  contractOpenAskable,
  contractReminderPoints,
  mailtoHref,
  validateContractForm,
  type ContractFormInput,
  type ContractQuestion,
  type ContractQuestionId,
  type ContractReminders,
  type ContractRenewResult,
} from "@/lib/admin/contract-end";
import { RotationEndSuggestion } from "@/components/admin/contract/rotation-end-suggestion";
import { LEAVE_AGREEMENT } from "@/lib/admin/leave-types";
import { formatDateEcho } from "@/lib/admin/renewal-dates";

const chipClass = (on: boolean) =>
  cn(
    focusRing,
    "inline-flex min-h-12 items-center rounded-md border px-3 text-sm font-medium",
    on
      ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
      : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text)]",
  );

function SheetGroup({ label, children, id }: { label: string; children: React.ReactNode; id?: string }) {
  return (
    <div className="grid gap-1.5">
      <p id={id} className={eyebrowText}>
        {label}
      </p>
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- form */

export function ContractFormSheet({
  open,
  mode,
  initial,
  today,
  onClose,
  onSave,
}: {
  open: boolean;
  mode: "add" | "edit";
  initial: ContractFormInput | null;
  today: string;
  onClose: () => void;
  /** Resolves to an error message, or null when saved. */
  onSave: (input: ContractFormInput) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<ContractFormInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  // A fresh draft each time the sheet opens, from what is recorded now.
  if (open && draft === null) setDraft(initial ?? { endsOn: "", employer: "", note: "", reminders: BOTH_REMINDERS_ON });
  if (!open && draft !== null) {
    setDraft(null);
    setTouched(false);
    setFailure(null);
  }
  const value = draft ?? { endsOn: "", employer: "", note: "", reminders: BOTH_REMINDERS_ON };
  const errors = validateContractForm(value, today);
  const canSave = Boolean(value.endsOn.trim()) && !contractFormHasErrors(errors) && !busy;
  const showErrors = touched || Boolean(value.endsOn);
  const set = (patch: Partial<ContractFormInput>) => setDraft({ ...value, ...patch });
  const toggle = (key: keyof ContractReminders) =>
    set({ reminders: { ...value.reminders, [key]: !value.reminders[key] } });
  const points = !errors.endsOn && value.endsOn ? contractReminderPoints(value.endsOn) : null;

  async function save() {
    setTouched(true);
    if (!canSave) return;
    setBusy(true);
    setFailure(null);
    const result = await onSave(value);
    setBusy(false);
    if (result) setFailure(result);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === "add" ? "Your contract" : "Edit contract dates"}
      description="Type the dates from your letter"
      testId="admin-contract-form"
      footer={
        <div className="grid gap-2">
          {failure ? <InlineNotice tone="neutral">{failure}</InlineNotice> : null}
          <Button
            variant="primary"
            block
            busy={busy}
            busyLabel="Saving"
            disabled={!canSave}
            onClick={() => void save()}
            testId="admin-contract-save"
          >
            Save
          </Button>
        </div>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <TextField
          label="Employer · optional"
          placeholder="For example, your health service"
          value={value.employer}
          maxLength={CONTRACT_EMPLOYER_LIMIT + 20}
          autoComplete="organization"
          onChange={(event) => set({ employer: event.target.value })}
          error={errors.employer}
          data-testid="admin-contract-employer"
        />
        {errors.employerProblem ? (
          <PatientDetailCatch
            problem={errors.employerProblem}
            onUseSuggestion={(suggestion) => set({ employer: suggestion })}
            testId="admin-contract-employer-problem"
          />
        ) : null}
        <div className="grid gap-1">
          <TextField
            type="date"
            label="Contract end date"
            value={value.endsOn}
            required
            onChange={(event) => set({ endsOn: event.target.value })}
            onBlur={() => setTouched(true)}
            error={showErrors ? errors.endsOn : undefined}
            data-testid="admin-contract-end"
          />
          {value.endsOn && !errors.endsOn ? (
            <p className={cn(textMuted, "text-sm")} data-testid="admin-contract-end-echo">
              {formatDateEcho(value.endsOn)}
            </p>
          ) : null}
        </div>
        {open && mode === "add" ? (
          <RotationEndSuggestion today={today} current={value.endsOn} onUse={(date) => set({ endsOn: date })} />
        ) : null}
        <SheetGroup label="Remind me" id="admin-contract-remind-label">
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="admin-contract-remind-label">
            <button
              type="button"
              aria-pressed={value.reminders.threeMonths}
              className={chipClass(value.reminders.threeMonths)}
              onClick={() => toggle("threeMonths")}
              data-testid="admin-contract-remind-three-months"
            >
              3 months before{points ? `, ${formatDateEcho(points.threeMonths)}` : ""}
            </button>
            <button
              type="button"
              aria-pressed={value.reminders.sixWeeks}
              className={chipClass(value.reminders.sixWeeks)}
              onClick={() => toggle("sixWeeks")}
              data-testid="admin-contract-remind-six-weeks"
            >
              6 weeks before{points ? `, ${formatDateEcho(points.sixWeeks)}` : ""}
            </button>
          </div>
        </SheetGroup>
        <div className="grid gap-1">
          <label htmlFor="admin-contract-note" className="text-sm font-medium text-[color:var(--text)]">
            Note · optional
          </label>
          <textarea
            id="admin-contract-note"
            rows={2}
            value={value.note}
            placeholder="For example, offer letter in my email"
            onChange={(event) => set({ note: event.target.value })}
            aria-invalid={errors.note || errors.noteProblem ? true : undefined}
            aria-describedby="admin-contract-note-count"
            className={cn(fieldControlPlain, "min-h-12 resize-y py-2")}
            data-testid="admin-contract-note"
          />
          <p id="admin-contract-note-count" className={cn(textMuted, "nums text-xs")}>
            {errors.note ?? `${value.note.trim().length} of ${CONTRACT_NOTE_LIMIT}. No patient details.`}
          </p>
        </div>
        {errors.noteProblem ? (
          <PatientDetailCatch
            problem={errors.noteProblem}
            onUseSuggestion={(suggestion) => set({ note: suggestion })}
            testId="admin-contract-note-problem"
          />
        ) : null}
      </form>
    </Sheet>
  );
}

/* ----------------------------------------------------------- question */

export function ContractQuestionSheet({
  question,
  endsOn,
  asked = false,
  canMark = false,
  onMark,
  onClose,
}: {
  question: ContractQuestion | null;
  endsOn: string | null;
  /** This question is marked "Asked, waiting". */
  asked?: boolean;
  /** Signed in with a saved row, so the mark can be saved. */
  canMark?: boolean;
  /** Resolves to an error message, or null when saved. */
  onMark?: (asked: boolean) => Promise<string | null>;
  onClose: () => void;
}) {
  const { copy, stateFor } = useCopy();
  const state = stateFor("question");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [shownFor, setShownFor] = useState<string | null>(null);
  if ((question?.id ?? null) !== shownFor) {
    setShownFor(question?.id ?? null);
    setFailure(null);
  }

  async function mark() {
    if (!onMark || busy) return;
    setBusy(true);
    setFailure(null);
    const problem = await onMark(!asked);
    setBusy(false);
    if (problem) setFailure(problem);
  }

  return (
    <Sheet
      open={question !== null}
      onClose={onClose}
      title={question?.title ?? "Question"}
      description={question?.hint}
      testId="admin-contract-question"
      footer={
        <div className="grid gap-2">
          {failure ? <InlineNotice tone="neutral">{failure}</InlineNotice> : null}
          <Button
            variant="primary"
            block
            icon={Copy}
            onClick={() =>
              question && void copy(question.question, "question", "Question copied. Paste it into your email.")
            }
            testId="admin-contract-question-copy"
          >
            {copyLabel(state, "Copy question")}
          </Button>
          {canMark && onMark ? (
            <Button
              variant="secondary"
              block
              busy={busy}
              busyLabel="Saving"
              onClick={() => void mark()}
              testId="admin-contract-question-mark"
            >
              {asked ? "Not asked yet" : "I have asked this"}
            </Button>
          ) : null}
        </div>
      }
    >
      {question ? (
        <div className="grid gap-4">
          {question.id === "parental-leave" ? (
            <div className="grid gap-2 rounded-lg border border-[color:var(--border)] p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  What you can take <span className={cn(textMuted, "text-xs")}>· not signed off yet</span>
                </span>
                <a
                  href={LEAVE_AGREEMENT.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={cn(
                    focusRing,
                    "inline-flex min-h-12 items-center gap-1 font-medium text-[color:var(--clinical-accent)]",
                  )}
                >
                  Check your agreement
                  <ExternalLink aria-hidden="true" className="size-icon-sm" />
                </a>
              </div>
              {endsOn ? (
                <div className="flex justify-between gap-2">
                  <span>Contract ends</span>
                  <b className="nums font-semibold">{formatDateEcho(endsOn)}</b>
                </div>
              ) : null}
              <Link
                href="/admin/leave?card=parental"
                className={cn(
                  focusRing,
                  "inline-flex min-h-12 items-center font-medium text-[color:var(--clinical-accent)]",
                )}
              >
                Parental leave card
              </Link>
            </div>
          ) : null}
          <SheetGroup label="Question to copy">
            <p
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3 text-sm leading-6"
              data-testid="admin-contract-question-text"
            >
              {question.question}
            </p>
          </SheetGroup>
          {asked ? (
            <p className="text-sm text-[color:var(--text)]" data-testid="admin-contract-question-asked">
              Marked as asked, waiting for an answer.
            </p>
          ) : null}
          <p className={cn(textMuted, "text-xs")}>Copy never sends anything. Paste it into your own email.</p>
        </div>
      ) : null}
    </Sheet>
  );
}

/* ---------------------------------------------------------------- ask */

export function ContractAskSheet({
  open,
  endsOn,
  asked = [],
  canMark = false,
  onMarkAsked,
  onClose,
}: {
  open: boolean;
  endsOn: string | null;
  /** Questions already marked "Asked, waiting": left out of the message to start with. */
  asked?: readonly ContractQuestionId[];
  canMark?: boolean;
  /** Mark the chosen questions as asked. Resolves to an error message, or null when saved. */
  onMarkAsked?: (ids: readonly ContractQuestionId[]) => Promise<string | null>;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<readonly ContractQuestionId[]>([]);
  const [wasOpen, setWasOpen] = useState(false);
  const [handedOver, setHandedOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Each time the sheet opens, the message starts from the questions still open.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setChosen(contractOpenAskable(asked));
      setHandedOver(false);
      setFailure(null);
    }
  }
  const { copy, stateFor } = useCopy();
  const askable = CONTRACT_QUESTIONS.filter((question) => question.ask);
  const message = contractAskMessage(chosen, endsOn);
  const toggle = (id: ContractQuestionId) =>
    setChosen((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  const unmarked = chosen.filter((id) => !asked.includes(id));

  async function markChosen() {
    if (!onMarkAsked || busy || unmarked.length === 0) return;
    setBusy(true);
    setFailure(null);
    const problem = await onMarkAsked(unmarked);
    setBusy(false);
    if (problem) setFailure(problem);
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Ask Medical Workforce"
      description="Choose what goes in the message"
      testId="admin-contract-ask"
      footer={
        <div className="grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              icon={Copy}
              disabled={!message}
              onClick={() => {
                if (!message) return;
                setHandedOver(true);
                void copy(`${message.subject}\n\n${message.body}`, "ask", "Message copied. Paste it into your email.");
              }}
              testId="admin-contract-ask-copy"
            >
              {copyLabel(stateFor("ask"), "Copy")}
            </Button>
            {message ? (
              <a
                href={mailtoHref(message.subject, message.body)}
                onClick={() => setHandedOver(true)}
                className={buttonFaceClass({ variant: "primary" })}
                data-testid="admin-contract-ask-email"
              >
                <Mail aria-hidden="true" className="size-icon-md shrink-0" />
                <span>Open in email</span>
              </a>
            ) : (
              <Button variant="primary" icon={Mail} disabled onClick={() => undefined}>
                Open in email
              </Button>
            )}
          </div>
          {failure ? <InlineNotice tone="neutral">{failure}</InlineNotice> : null}
          {handedOver && canMark && onMarkAsked && unmarked.length > 0 ? (
            <Button
              variant="ghost"
              block
              busy={busy}
              busyLabel="Saving"
              onClick={() => void markChosen()}
              testId="admin-contract-ask-mark"
            >
              {unmarked.length === 1
                ? "Sent it? Mark this one as asked"
                : `Sent it? Mark these ${unmarked.length} as asked`}
            </Button>
          ) : null}
          <p className={cn(textMuted, "text-center text-xs")}>Nothing is sent from PsychSift.</p>
        </div>
      }
    >
      <div className="grid gap-4">
        <fieldset className="grid gap-1">
          <legend className={cn(eyebrowText, "mb-1.5")}>Questions in the message</legend>
          {askable.map((question) => (
            <label
              key={question.id}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm"
            >
              <input
                type="checkbox"
                checked={chosen.includes(question.id)}
                onChange={() => toggle(question.id)}
                className="size-5 shrink-0 accent-[color:var(--clinical-accent)]"
                data-testid={`admin-contract-ask-${question.id}`}
              />
              <span className="min-w-0 flex-1">{question.title}</span>
              {asked.includes(question.id) ? <span className={cn(textMuted, "text-xs")}>Asked</span> : null}
              {question.id === "parental-leave" ? (
                <span className={cn(textMuted, "text-xs")} data-testid="admin-contract-ask-parental-note">
                  Only if you want to ask. No dates
                </span>
              ) : null}
            </label>
          ))}
        </fieldset>
        <SheetGroup label="Preview">
          {message ? (
            <div
              className="grid gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3 text-sm"
              data-testid="admin-contract-ask-preview"
            >
              <b className="font-semibold text-[color:var(--text-heading)]">{message.subject}</b>
              <span className="whitespace-pre-line leading-6">{message.body}</span>
            </div>
          ) : (
            <p className={cn(textMuted, "text-sm")} data-testid="admin-contract-ask-empty">
              {askable.every((question) => asked.includes(question.id))
                ? "Every question is marked as asked. Tick one to ask it again."
                : "Choose at least one question."}
            </p>
          )}
        </SheetGroup>
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------------- renew */

export function ContractRenewSheet({
  open,
  previousEnd,
  today,
  build,
  onClose,
  onSave,
  askedCount = 0,
}: {
  open: boolean;
  previousEnd: string | null;
  today: string;
  build: (newEnd: string) => ContractRenewResult;
  onClose: () => void;
  onSave: (newEnd: string, keepAnswers: boolean) => Promise<string | null>;
  /** How many questions are marked as asked now. Zero hides the choice. */
  askedCount?: number;
}) {
  const [value, setValue] = useState("");
  const [keepAnswers, setKeepAnswers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setValue("");
      setFailure(null);
      setKeepAnswers(false);
    }
  }
  const result = value ? build(value) : null;
  const error = result && !result.ok ? CONTRACT_RENEW_REASON[result.reason] : null;
  const points = result?.ok ? contractReminderPoints(value) : null;

  async function save() {
    if (!result?.ok || busy) return;
    setBusy(true);
    setFailure(null);
    const problem = await onSave(value, keepAnswers);
    setBusy(false);
    if (problem) setFailure(problem);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Got a new contract?"
      description="Type the new end date from the letter"
      testId="admin-contract-renew"
      footer={
        <div className="grid gap-2">
          {failure ? <InlineNotice tone="neutral">{failure}</InlineNotice> : null}
          <Button
            variant="primary"
            block
            busy={busy}
            busyLabel="Saving"
            disabled={!result?.ok || busy}
            onClick={() => void save()}
            testId="admin-contract-renew-save"
          >
            Save new contract
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-1">
          <TextField
            type="date"
            label="New end date"
            value={value}
            min={today}
            onChange={(event) => setValue(event.target.value)}
            error={error ?? undefined}
            data-testid="admin-contract-renew-end"
          />
          {previousEnd ? (
            <p className={cn(textMuted, "text-sm")} data-testid="admin-contract-renew-was">
              Was {formatDateEcho(previousEnd)}. It stays in your history.
            </p>
          ) : null}
        </div>
        {points ? (
          <SheetGroup label="Reminders move to">
            <ul
              className="grid gap-1 rounded-lg border border-[color:var(--border)] p-3 text-sm"
              data-testid="admin-contract-renew-points"
            >
              <li className="flex justify-between gap-2">
                <span>3 months before</span>
                <b className="nums font-semibold">{formatDateEcho(points.threeMonths)}</b>
              </li>
              <li className="flex justify-between gap-2">
                <span>6 weeks before</span>
                <b className="nums font-semibold">{formatDateEcho(points.sixWeeks)}</b>
              </li>
            </ul>
          </SheetGroup>
        ) : null}
        {askedCount > 0 ? (
          <SheetGroup label="Questions you marked as asked" id="admin-contract-renew-answers-label">
            <div
              className="flex flex-wrap gap-2"
              role="radiogroup"
              aria-labelledby="admin-contract-renew-answers-label"
            >
              <button
                type="button"
                role="radio"
                aria-checked={!keepAnswers}
                className={chipClass(!keepAnswers)}
                onClick={() => setKeepAnswers(false)}
                data-testid="admin-contract-renew-fresh"
              >
                Start fresh
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={keepAnswers}
                className={chipClass(keepAnswers)}
                onClick={() => setKeepAnswers(true)}
                data-testid="admin-contract-renew-keep"
              >
                Keep answers
              </button>
            </div>
          </SheetGroup>
        ) : null}
        <p className={cn(textMuted, "text-xs")} data-testid="admin-contract-renew-foot">
          {askedCount > 0 && keepAnswers
            ? "Your reminder choices stay as they are. Questions stay marked as asked."
            : "Your reminder choices stay as they are. The questions start fresh."}
        </p>
      </div>
    </Sheet>
  );
}
