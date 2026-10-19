"use client";

import { ThumbsDown } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { AnswerFeedbackPanel } from "@/components/clinical-dashboard/answer-feedback-panel";
import { buttonFaceClass } from "@/components/ui/button-face";
import { announce } from "@/components/ui/live-announcer";
import { Sheet } from "@/components/ui/sheet";
import { cn, textMuted } from "@/components/ui-primitives";
import type { AnswerFeedbackType } from "@/lib/answer-feedback";
import { useOptionalAuthSession } from "@/lib/supabase/client";

type RecordReportType = "medication" | "therapy";

const recordNoun: Record<RecordReportType, string> = {
  medication: "medication record",
  therapy: "therapy record",
};

/**
 * "Report a problem" for a medication or therapy record: the same sheet and options the answer
 * surface opens, sending the report against the record's slug instead of a generated answer.
 * The outcome is announced on the page, outside the sheet, because the sheet closes on submit.
 */
export function RecordReportProblem({
  recordType,
  recordId,
  className,
}: {
  recordType: RecordReportType;
  recordId: string;
  className?: string;
}) {
  const authorizationHeader = useOptionalAuthSession()?.authorizationHeader ?? {};
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<AnswerFeedbackType | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "warning"; message: string } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const noun = recordNoun[recordType];

  // The app's shared announcer speaks the outcome; the visible line below is plain text, so the
  // page gains no extra live region.
  const report = (next: { tone: "success" | "warning"; message: string }) => {
    setNotice(next);
    announce(next.message);
  };

  async function submit(feedbackCategory: AnswerFeedbackType, note?: string) {
    if (pending) return;
    // The sheet stays open until the report is saved, so a refused or failed note stays on screen
    // to edit and resend instead of being lost when the panel unmounts.
    setPending(feedbackCategory);
    setNotice(null);
    try {
      const response = await fetch("/api/answer-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authorizationHeader },
        body: JSON.stringify({ recordType, recordId, feedbackCategory, ...(note ? { note } : {}) }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
        report({
          tone: "warning",
          message: typeof payload.error === "string" ? payload.error : "The report could not be saved.",
        });
        return;
      }
      setOpen(false);
      report({ tone: "success", message: "Thanks. The report was saved for review." });
    } catch {
      report({ tone: "warning", message: "The report could not be saved. Check the connection and try again." });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className={cn("grid gap-2", className)} data-testid={`${recordType}-report-problem`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setNotice(null);
          setOpen(true);
        }}
        disabled={Boolean(pending)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid={`${recordType}-report-problem-trigger`}
        className={cn(buttonFaceClass({ variant: "ghost", size: "sm" }), "justify-self-start")}
      >
        <ThumbsDown aria-hidden="true" className="h-3.5 w-3.5" />
        {pending ? "Saving report" : "Report a problem"}
      </button>
      {notice && !open ? (
        <p className={cn("m-0 text-xs", textMuted)} data-testid={`${recordType}-report-problem-notice`}>
          {notice.message}
        </p>
      ) : null}
      <Sheet
        open={open}
        onClose={close}
        returnFocusRef={triggerRef}
        title={`What is wrong with this ${noun}?`}
        description="Name the fault so a reviewer can find it. This sends feedback for review; it does not change the record."
        closeLabel="Close report a problem"
        testId={`${recordType}-report-problem-sheet`}
      >
        {notice ? (
          <p className={cn("m-0 mb-2 text-xs", textMuted)} data-testid={`${recordType}-report-problem-notice`}>
            {notice.message}
          </p>
        ) : null}
        <AnswerFeedbackPanel pending={pending} onSubmit={submit} tone="problems" chrome="bare" />
      </Sheet>
    </div>
  );
}
