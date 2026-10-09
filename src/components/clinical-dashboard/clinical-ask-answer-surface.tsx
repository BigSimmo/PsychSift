"use client";

import { useId, useRef, useState } from "react";
import { Check, ClipboardCopy, Printer } from "lucide-react";
import { ignoreUnavailableActivation } from "@/components/ui-primitives";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import type { AnswerFeedbackType } from "@/lib/answer-feedback";
import type { ClinicalAskFeedbackMetadata, ClinicalAskResponse } from "@/lib/clinical-ask/contracts";
import { clinicalAskModeProfile } from "@/lib/clinical-ask/mode-profiles";

const verificationReminder = "Clinician Confirmation is required for clinically material suggestions.";
const clinicalAskFeedbackChoices: ReadonlyArray<{ value: AnswerFeedbackType; label: string }> = [
  { value: "wrong_mode", label: "Wrong mode" },
  { value: "missed_source", label: "Missed source" },
  { value: "unsupported_conclusion", label: "Unsupported conclusion" },
  { value: "important_information_missing", label: "Important information missing" },
  { value: "source_conflict", label: "Source conflict" },
  { value: "outdated_source", label: "Outdated source" },
  { value: "presentation_problem", label: "Presentation problem" },
];

export function clinicalAskExportText(
  response: Extract<ClinicalAskResponse, { state: "answered" }>,
  question?: string,
) {
  const mode = clinicalAskModeProfile(response.mode).label;
  const evidence = response.evidence.map((item, index) => {
    const retrieval = item.retrievedAt ? `; retrieved ${item.retrievedAt.slice(0, 10)}` : "";
    return `[${index + 1}] ${item.title} — ${item.publisher}; ${item.href}; review: ${item.reviewState}${retrieval}`;
  });
  return [
    `Clinical Ask — ${mode}`,
    question ? `Question: ${question}` : null,
    "",
    response.lead.text,
    ...response.sections.flatMap((section) => ["", section.title, ...section.claims.map((claim) => claim.text)]),
    "",
    "Caveats and missing information",
    ...(response.missingInformation.length ? response.missingInformation : ["None stated."]),
    "",
    "Conflicting evidence",
    ...(response.conflicts.length ? response.conflicts.map((claim) => claim.text) : ["None stated."]),
    "",
    "Citations",
    ...evidence,
    "",
    verificationReminder,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function ClinicalAskAnswerSurface({
  response,
  question,
  clarificationAnswers = {},
  onClarificationChange,
  onPrepareHandoff,
  onFollowUp,
  onRetry,
  onContinue,
  onReturnToSearch,
  feedbackMetadata,
}: {
  response: ClinicalAskResponse;
  question?: string;
  clarificationAnswers?: Partial<Record<string, string>>;
  onClarificationChange?(id: string, value: string): void;
  onPrepareHandoff?(
    target: Extract<ClinicalAskResponse, { state: "answered" }>["handoffs"][number]["targetMode"],
  ): void;
  onFollowUp?(value: string): void;
  onRetry?(): void;
  onContinue?(): void;
  onReturnToSearch?(): void;
  feedbackMetadata?: ClinicalAskFeedbackMetadata | null;
}) {
  const label = clinicalAskModeProfile(response.mode).label;
  const clarificationUnavailableId = useId();
  const firstClarificationRef = useRef<HTMLInputElement>(null);
  const [includeQuestion, setIncludeQuestion] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [feedback, setFeedback] = useState<AnswerFeedbackType | null>(null);
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);
  const requiredClarificationsComplete =
    response.state === "clarification_required" &&
    response.clarifications.every((item) => !item.required || Boolean(clarificationAnswers[item.id]?.trim()));
  if (response.state === "failed")
    return (
      <section aria-label={`${label} answer`}>
        <h2>Clinical Ask could not complete</h2>
        <p>{response.message}</p>
        <div className="clinical-ask-state-actions">
          {response.retryable && onRetry ? (
            <button type="button" onClick={onRetry}>
              Retry Smart answer
            </button>
          ) : null}
          {onReturnToSearch ? (
            <button type="button" onClick={onReturnToSearch}>
              Return to search
            </button>
          ) : null}
        </div>
      </section>
    );
  if (response.state === "clarification_required")
    return (
      <section aria-label={`${label} clarification`}>
        <h2>Confirm missing Case Context</h2>
        <p>Review and edit these non-identifying details before asking again.</p>
        {response.clarifications.map((item, index) => (
          <label key={item.id} className="clinical-ask-field">
            {item.prompt}
            <input
              ref={index === 0 ? firstClarificationRef : undefined}
              autoFocus={index === 0}
              name={item.id}
              required={item.required}
              value={clarificationAnswers[item.id] ?? ""}
              onChange={(event) => onClarificationChange?.(item.id, event.currentTarget.value)}
            />
          </label>
        ))}
        {onContinue ? (
          <>
            <button
              type="button"
              aria-disabled={!requiredClarificationsComplete ? true : undefined}
              aria-describedby={!requiredClarificationsComplete ? clarificationUnavailableId : undefined}
              title={!requiredClarificationsComplete ? "Fill in all required clarifications to continue" : undefined}
              onClick={requiredClarificationsComplete ? onContinue : ignoreUnavailableActivation}
              className={!requiredClarificationsComplete ? "cursor-not-allowed opacity-50" : undefined}
            >
              Continue with confirmed context
            </button>
            {!requiredClarificationsComplete ? (
              <span id={clarificationUnavailableId} className="sr-only">
                Fill in all required clarifications before continuing.
              </span>
            ) : null}
          </>
        ) : null}
      </section>
    );
  if (response.state === "evidence_gap")
    return (
      <section aria-label={`${label} evidence gap`}>
        <h2>Evidence Gap</h2>
        <p>{response.explanation}</p>
        {response.missingInformation.length ? (
          <ListDisclosure title="Missing information" items={response.missingInformation} />
        ) : null}
        {response.nextActions.length ? (
          <ListDisclosure title="Possible next checks" items={response.nextActions} />
        ) : null}
        <Evidence evidence={response.evidence} />
      </section>
    );

  const exportText = clinicalAskExportText(response, includeQuestion ? question : undefined);
  async function copyAnswer() {
    try {
      await copyTextToClipboard(exportText);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }
  async function submitFeedback(selection: AnswerFeedbackType) {
    if (!feedbackMetadata) {
      setFeedbackStatus("Feedback is unavailable for this answer.");
      return;
    }
    setFeedback(selection);
    try {
      const result = await fetch("/api/answer-feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          interactionId: feedbackMetadata.interactionId,
          answerHash: feedbackMetadata.answerHash,
          feedbackToken: feedbackMetadata.feedbackToken,
          feedbackCategory: selection,
        }),
      });
      if (!result.ok) throw new Error("feedback rejected");
      setFeedbackStatus("Feedback saved for review.");
    } catch {
      setFeedbackStatus("Feedback could not be saved.");
    }
  }
  return (
    <article aria-label={`${label} answer`} data-print-output>
      <header>
        <p>{label}</p>
        {includeQuestion && question ? <p>Question: {question}</p> : null}
        <h2>{response.lead.text}</h2>
      </header>
      {response.sections.map((section) => (
        <section key={section.id}>
          <h3>{section.title}</h3>
          {section.claims.map((claim) => (
            <p key={claim.id}>{claim.text}</p>
          ))}
        </section>
      ))}
      {response.conflicts.length ? <ClaimDisclosure title="Conflicting evidence" claims={response.conflicts} /> : null}
      {response.missingInformation.length ? (
        <ListDisclosure title="Missing information" items={response.missingInformation} />
      ) : null}
      <Evidence evidence={response.evidence} />
      {response.followUps.length ? (
        <section data-print-hide aria-label="Follow-up questions">
          <h3>Follow up</h3>
          {response.followUps.map((item) => (
            <button type="button" key={item} onClick={() => onFollowUp?.(item)}>
              {item}
            </button>
          ))}
        </section>
      ) : null}
      {response.handoffs.length ? (
        <section data-print-hide aria-label="Mode handoffs">
          <h3>Continue in another mode</h3>
          {response.handoffs.map((handoff) => (
            <button type="button" key={handoff.targetMode} onClick={() => onPrepareHandoff?.(handoff.targetMode)}>
              {handoff.label}
            </button>
          ))}
        </section>
      ) : null}
      <p>{verificationReminder}</p>
      <div className="clinical-ask-output-actions" data-print-hide>
        <label>
          <input
            type="checkbox"
            checked={includeQuestion}
            onChange={(event) => setIncludeQuestion(event.currentTarget.checked)}
          />{" "}
          Include question in copy and print
        </label>
        <button type="button" onClick={copyAnswer}>
          {copyState === "copied" ? <Check aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}{" "}
          {copyState === "copied" ? "Copied" : "Copy answer"}
        </button>
        <button type="button" onClick={() => window.print()}>
          <Printer aria-hidden="true" /> Print answer
        </button>
        <fieldset>
          <legend>Was this useful?</legend>
          <button type="button" aria-pressed={feedback === "verified"} onClick={() => void submitFeedback("verified")}>
            Helpful
          </button>
          <details>
            <summary>Report an issue</summary>
            {clinicalAskFeedbackChoices.map((choice) => (
              <button
                key={choice.value}
                type="button"
                aria-pressed={feedback === choice.value}
                onClick={() => void submitFeedback(choice.value)}
              >
                {choice.label}
              </button>
            ))}
          </details>
        </fieldset>
        {copyState === "failed" ? <p role="status">Copy failed. Select the answer text and copy it manually.</p> : null}
        {feedbackStatus ? <p role="status">{feedbackStatus}</p> : null}
      </div>
      <footer data-print-provenance>
        Clinical Ask — {label}. {verificationReminder}
      </footer>
    </article>
  );
}

function ClaimDisclosure({ title, claims }: { title: string; claims: Array<{ id: string; text: string }> }) {
  return (
    <details>
      <summary>{title}</summary>
      {claims.map((claim) => (
        <p key={claim.id}>{claim.text}</p>
      ))}
    </details>
  );
}

function ListDisclosure({ title, items }: { title: string; items: string[] }) {
  return (
    <details>
      <summary>{title}</summary>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  );
}

function Evidence({
  evidence,
}: {
  evidence: Extract<ClinicalAskResponse, { state: "answered" | "evidence_gap" }>["evidence"];
}) {
  return (
    <details>
      <summary>Evidence and sources</summary>
      {evidence.length === 0 ? <p>No governed source met the threshold for this Evidence Gap.</p> : null}
      <ol>
        {evidence.map((item) => (
          <li key={item.id}>
            <a href={item.href} target="_blank" rel="noreferrer">
              {item.title}
            </a>{" "}
            — {item.publisher} · {item.tier} · {item.reviewState.replace("_", " ")}
            {item.retrievedAt
              ? ` · retrieved ${new Date(item.retrievedAt).toLocaleDateString("en-AU", { timeZone: "UTC" })}`
              : ""}
          </li>
        ))}
      </ol>
    </details>
  );
}
