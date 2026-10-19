"use client";

import { useState } from "react";
import { CircleAlert, CircleCheck, FileText, Loader2, RefreshCw, Search, ShieldAlert, Target } from "lucide-react";

import { FormField } from "@/components/ui/form-field";
import {
  cn,
  controlDisabled,
  fieldControlPlain,
  metadataPillDensity,
  textMuted,
  toneDanger,
  toneNeutral,
  toneSuccess,
  toneWarning,
} from "@/components/ui-primitives";
import {
  ANSWER_FEEDBACK_NOTE_MAX_LENGTH,
  type AnswerFeedbackType,
  type SubmitAnswerFeedback,
} from "@/lib/answer-feedback";

const answerFeedbackOptions: Array<{
  type: AnswerFeedbackType;
  label: string;
  icon: typeof CircleCheck;
  tone: "success" | "warning" | "danger" | "neutral";
}> = [
  { type: "verified", label: "Verified", icon: CircleCheck, tone: "success" },
  { type: "needs_correction", label: "Needs correction", icon: CircleAlert, tone: "warning" },
  { type: "source_insufficient", label: "Source insufficient", icon: ShieldAlert, tone: "warning" },
  { type: "wrong_source", label: "Wrong source", icon: FileText, tone: "danger" },
  { type: "missing_source", label: "Missing source", icon: Search, tone: "warning" },
  { type: "unsupported_answer", label: "Unsupported answer", icon: ShieldAlert, tone: "danger" },
  { type: "numeric_error", label: "Numeric error", icon: Target, tone: "danger" },
  { type: "outdated_guidance", label: "Outdated guidance", icon: RefreshCw, tone: "warning" },
];

function feedbackToneClass(tone: "success" | "warning" | "danger" | "neutral") {
  if (tone === "success") return toneSuccess;
  if (tone === "warning") return toneWarning;
  if (tone === "danger") return toneDanger;
  return toneNeutral;
}

/** The question the panel asks, so a Sheet header can ask it instead. */
export const answerFeedbackQuestion = {
  problems: {
    title: "What is wrong with this answer?",
    description:
      "Name the fault so a reviewer can find it. This sends feedback for review; it does not change the answer.",
  },
  full: {
    title: "Is the answer supported?",
    description:
      "Record whether the linked evidence supports the answer. This sends feedback for review; it does not change the answer.",
  },
} as const;

export function AnswerFeedbackPanel({
  pending,
  onSubmit,
  tone = "full",
  chrome = "card",
  note: controlledNote,
  onNoteChange,
}: {
  pending: AnswerFeedbackType | null;
  /** Called with the trimmed note only when the reader typed one. */
  onSubmit: SubmitAnswerFeedback;
  /**
   * `"problems"` drops the affirmative option and asks the narrower question.
   * The thumb down is the only way into this panel on the answer surface, and
   * offering "Verified" inside a list a reader opened to report a fault is a
   * mis-click waiting to record the opposite of what they meant.
   */
  tone?: "full" | "problems";
  /**
   * `"bare"` drops the card's own border and its heading pair for a host that
   * already carries them — the Sheet the answer surface opens, whose title and
   * description ARE `answerFeedbackQuestion`. Asking the same question twice,
   * once in the sheet header and again three lines below it, is the duplication
   * this exists to avoid.
   */
  chrome?: "card" | "bare";
  /**
   * A host that closes the panel before the outcome is known keeps the note itself, so a
   * refused or failed report reopens with the reader's text instead of an empty field.
   */
  note?: string;
  onNoteChange?: (note: string) => void;
}) {
  const problemsOnly = tone === "problems";
  const bare = chrome === "bare";
  const options = problemsOnly
    ? answerFeedbackOptions.filter((item) => item.tone !== "success")
    : answerFeedbackOptions;
  const question = answerFeedbackQuestion[problemsOnly ? "problems" : "full"];
  const [ownNote, setOwnNote] = useState("");
  const note = controlledNote ?? ownNote;
  const setNote = onNoteChange ?? setOwnNote;
  const submit = (feedbackType: AnswerFeedbackType) => {
    const trimmed = note.trim();
    if (trimmed) onSubmit(feedbackType, trimmed);
    else onSubmit(feedbackType);
  };
  return (
    <section
      data-testid="answer-review-panel"
      data-tone={tone}
      data-chrome={chrome}
      className={cn(!bare && "rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3")}
      aria-label={problemsOnly ? "Report a problem" : "Answer review"}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {bare ? null : (
          <div>
            <p className="text-sm font-semibold text-[color:var(--text)]">{question.title}</p>
            <p className={cn("mt-1 text-xs leading-5", textMuted)}>{question.description}</p>
          </div>
        )}
        {pending ? (
          <span className={metadataPillDensity.dense}>
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            Saving
          </span>
        ) : null}
      </div>
      {problemsOnly ? (
        <FormField
          label="What is wrong? (optional)"
          hint="Say where the fault is. Leave out patient details: notes that look identifying are refused."
          className={bare ? "mb-3" : "my-3"}
        >
          {(field) => (
            <textarea
              id={field.id}
              aria-describedby={field.describedBy}
              value={note}
              maxLength={ANSWER_FEEDBACK_NOTE_MAX_LENGTH}
              rows={2}
              autoComplete="off"
              spellCheck={false}
              data-gramm="false"
              data-enable-grammarly="false"
              disabled={Boolean(pending)}
              onChange={(event) => setNote(event.target.value)}
              data-testid="answer-feedback-note"
              className={cn(fieldControlPlain, "min-h-16 py-2")}
            />
          )}
        </FormField>
      ) : null}
      <div className={cn("grid grid-cols-2 gap-2 sm:flex sm:flex-wrap", bare || problemsOnly ? "mt-0" : "mt-3")}>
        {options.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.type}
              type="button"
              disabled={Boolean(pending)}
              onClick={() => submit(item.type)}
              className={cn(
                "inline-flex min-h-tap items-center justify-center gap-1.5 rounded-lg border px-2.5 text-center text-xs font-semibold transition lg:min-h-compact-meta",
                controlDisabled,
                feedbackToneClass(item.tone),
              )}
            >
              {pending === item.type ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <Icon aria-hidden="true" className="h-4 w-4" />
              )}
              {item.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
