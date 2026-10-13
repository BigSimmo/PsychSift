import { Globe } from "lucide-react";

import { cn, textMuted } from "@/components/ui-primitives";

/** The overseas-processing line under an answer (audit S3, 2026-10-13). Draft wording: owner approval pending. */
export const ANSWER_PROVIDER_NOTICE_TEXT =
  "Questions are sent to an overseas AI service (OpenAI) to search and write answers. Don't include patient details.";

/**
 * One quiet line under the latest answer, and on the Answer home before the first question is sent
 * (owner decision, 13 Oct 2026).
 *
 * It says where a clinical question goes, which the composer's privacy line ("Do not enter
 * patient-identifiable information.") does not. It sits below the answer rather than beside
 * the composer on purpose: the composer's height is measured and reserved exactly, so a longer
 * line there would move the search box and add the layout shift audit D16 is about. Below the
 * content, it moves nothing above it.
 *
 * Not shown in demo mode, where no question leaves the device, so the line is never untrue.
 */
export function AnswerProviderNotice({
  className,
  testId = "answer-provider-notice",
}: {
  className?: string;
  testId?: string;
}) {
  return (
    <p
      role="note"
      data-testid={testId}
      className={cn("flex min-w-0 items-start gap-1.5 text-2xs leading-4", textMuted, className)}
    >
      <Globe aria-hidden="true" className="mt-0.5 size-icon-xs shrink-0" />
      <span className="min-w-0">{ANSWER_PROVIDER_NOTICE_TEXT}</span>
    </p>
  );
}
