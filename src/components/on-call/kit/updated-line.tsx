import { ExternalLink } from "lucide-react";

import { focusRing } from "@/components/card-recipes";
import { modeNumberText } from "@/components/mode-kit/type";
import { cn } from "@/components/ui-primitives";
import { formatOnCallDate, onCallAgo } from "@/lib/on-call/display-dates";

/**
 * "Updated 12 Mar 2026 · 6 months ago": the date itself first, the age muted
 * after it (standard §2). Never "Checked", never a tick: a handbook row has no
 * trustworthy check date, only the day it was last changed (plan GC3).
 *
 * Sources follow on one small line, each an https link that opens in a new tab
 * with no referrer. A second editor's review appears only here, as words
 * ("Reviewed by a second editor, 12 Aug 2026"), never as a tag.
 */
export function OnCallUpdatedLine({
  updatedAt,
  sources,
  reviewedAt,
  lastConfirmedAt,
  now,
  testId,
}: {
  readonly updatedAt: string | null;
  readonly sources?: readonly { readonly label: string; readonly url: string }[];
  readonly reviewedAt?: string | null;
  readonly lastConfirmedAt?: string | null;
  readonly now?: Date;
  readonly testId?: string;
}) {
  const date = updatedAt ? formatOnCallDate(updatedAt) : "";
  if (!date && !sources?.length && !lastConfirmedAt && !reviewedAt) return null;
  return (
    <span className="grid min-w-0 gap-0.5 text-xs text-[color:var(--text-muted)]" data-testid={testId}>
      {date ? (
        <span className={cn(modeNumberText, "break-words")}>
          Updated {date}
          <span className="text-[color:var(--text-muted)]">{` · ${onCallAgo(updatedAt ?? "", now)}`}</span>
        </span>
      ) : null}
      {lastConfirmedAt && formatOnCallDate(lastConfirmedAt) ? (
        <span className={modeNumberText}>Confirmed {formatOnCallDate(lastConfirmedAt)}</span>
      ) : null}
      {sources?.length || reviewedAt ? (
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 text-[color:var(--text-muted)]">
          {sources?.map((source) => (
            <a
              key={`${source.url}:${source.label}`}
              href={source.url}
              target="_blank"
              rel="noreferrer noopener"
              className={cn(
                focusRing,
                "inline-flex min-h-tap min-w-0 items-center gap-1 rounded-sm text-[color:var(--clinical-accent)]",
              )}
            >
              <ExternalLink aria-hidden="true" className="size-icon-xs shrink-0" />
              <span className="break-words">{source.label}</span>
            </a>
          ))}
          {reviewedAt ? <span>Reviewed by a second editor, {formatOnCallDate(reviewedAt)}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
