import { ChevronDown, ListTree } from "lucide-react";

import {
  answerProgressDisplayMessage,
  answerProgressTookUnusualRoute,
  type TimedAnswerProgressUpdate,
} from "@/components/clinical-dashboard/answer-progress";

/**
 * "How this answer was built", as a row under the answer's actions (owner decision, 17 Oct 2026).
 * It used to sit above the question as a small triangle link, which put a footnote first.
 *
 * Still only offered when the answer did not take the ordinary route. A routine answer has
 * nothing to disclose, and the retired panel offered the same five stages every time.
 */
export function AnswerBuildDetails({ events }: { events: TimedAnswerProgressUpdate[] }) {
  if (events.at(-1)?.stage !== "complete" || !answerProgressTookUnusualRoute(events)) return null;
  const details = events
    .map((event) => ({ ...event, displayMessage: answerProgressDisplayMessage(event) }))
    .filter((event, index, all) => index === 0 || event.displayMessage !== all[index - 1]?.displayMessage)
    .slice(-8);
  return (
    <details data-testid="answer-build-details" className="group min-w-0 border-t border-[color:var(--border)]">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 rounded-md text-sm font-medium text-[color:var(--text-heading)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text-muted)] forced-colors:border"
        >
          <ListTree className="size-icon-md" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">How this answer was built</span>
        <ChevronDown
          aria-hidden="true"
          className="size-icon-md shrink-0 text-[color:var(--text-muted)] transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <ol className="mb-3 ml-3.5 space-y-1 border-l border-[color:var(--border)] pl-3 text-2xs text-[color:var(--text-muted)]">
        {details.map((event, index) => (
          <li key={`${event.receivedAt}-${event.stage}-${index}`} className="leading-relaxed">
            {event.displayMessage}
          </li>
        ))}
      </ol>
    </details>
  );
}
