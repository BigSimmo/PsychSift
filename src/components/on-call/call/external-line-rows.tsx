"use client";

import { ExternalLink, Phone } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { onCallCrisisLines, type OnCallExternalLine } from "@/components/on-call/call/external-lines";
import { onCallEmergencyBadge, onCallLeadingIcon } from "@/components/on-call/kit/calm";
import { OnCallDialRow } from "@/components/on-call/kit/dial-row";
import { OnCallGroupedList } from "@/components/on-call/kit/grouped-list";
import { modeSecondaryText } from "@/components/mode-kit/type";
import { cn } from "@/components/ui-primitives";

const isTripleZero = (line: OnCallExternalLine) => line.dial.copy === "000";

/** One subtitle: where the line serves, then when it answers ("24 hours, every day" reads "24 hours"). */
function lineSubtitle(line: OnCallExternalLine): string {
  const hours = line.availability?.replace(/^24 hours, every day$/i, "24 hours");
  return hours ? `${line.area} · ${hours}` : line.area;
}

/**
 * Outside lines as compact dial rows (mock-up v10, s-1 and s-2): a badge
 * ("000") or a phone glyph, the name, one subtitle with the number, area and
 * hours, and the outlined call disc.
 *
 * Every line keeps its official source and the day it was read (Global
 * Constraint 10), so no outside number is ever shown without a visible source:
 * the date and source sit in the number's own sheet, and the list ends in one
 * quiet line naming every source with its link. A limitation the source states
 * (MHERL "is not an emergency service") stays under its row, because it must
 * show wherever the number shows.
 *
 * The rows record by id only (`source="handbook"`): these are the app's public
 * lines, not the reader's own entries, so "Your usual" never names one from a
 * stored title and hides it when no handbook row resolves it.
 */
export function OnCallExternalLineRows({
  lines,
  emergencyTone = false,
  wrapRow,
  testIdPrefix,
  now,
}: {
  readonly now?: Date;
  readonly lines: readonly OnCallExternalLine[];
  /** 000 in quiet red: only on the crisis-lines module (signed-out, offline and failure screens). */
  readonly emergencyTone?: boolean;
  /** Wraps each dial row, e.g. in People's "Didn't connect" mark, which lives in the row's sheet. */
  readonly wrapRow?: (line: OnCallExternalLine, row: ReactNode) => ReactNode;
  readonly testIdPrefix: string;
}) {
  const sources = lines.flatMap((line) => line.sources);
  const uniqueSources = sources.filter(
    (source, index) => sources.findIndex((other) => other.url === source.url) === index,
  );
  return (
    <>
      {lines.map((line) => {
        const row = (
          <OnCallDialRow
            now={now}
            id={line.id}
            source="handbook"
            title={line.title}
            subtitle={lineSubtitle(line)}
            dial={line.dial}
            leading={
              isTripleZero(line) ? (
                <span className={onCallEmergencyBadge}>000</span>
              ) : (
                <Phone aria-hidden="true" strokeWidth={1.5} className={onCallLeadingIcon} />
              )
            }
            updatedAt={line.updatedAt}
            sources={line.sources}
            tone={emergencyTone && isTripleZero(line) ? "emergency" : "default"}
            testId={`${testIdPrefix}-${line.id}`}
          />
        );
        return (
          <Fragment key={line.id}>
            {wrapRow ? wrapRow(line, row) : row}
            {line.caveat ? (
              <li
                className={cn(modeSecondaryText, "min-w-0 break-words pb-1.5 pl-15 pr-3 text-xs")}
                data-testid={`${testIdPrefix}-${line.id}-caveat`}
              >
                {line.caveat}
              </li>
            ) : null}
          </Fragment>
        );
      })}
      {uniqueSources.length > 0 ? (
        <li className="grid min-w-0 gap-0.5 px-3 pt-2" data-testid={`${testIdPrefix}-sources`}>
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 text-xs">
            <span className={modeSecondaryText}>Sources</span>
            {uniqueSources.map((source) => (
              <a
                key={source.url}
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
          </span>
          <span className={cn(modeSecondaryText, "text-xs")}>
            Each number&apos;s sheet gives the day it was checked.
          </span>
        </li>
      ) : null}
    </>
  );
}

/**
 * The public crisis lines — 000, MHERL (Perth) and Lifeline — shown under
 * every loading, signed-out and failure state on People, Refer and Find, and
 * at the foot of Now (owner decision). They are part of the app, so they never
 * wait on the network.
 */
export function OnCallCrisisLines({
  now,
  testId = "on-call-crisis-lines",
}: {
  readonly now?: Date;
  readonly testId?: string;
}) {
  return (
    <OnCallGroupedList eyebrow="Public crisis lines" testId={testId}>
      <OnCallExternalLineRows lines={onCallCrisisLines()} now={now} emergencyTone testIdPrefix="on-call-crisis-line" />
    </OnCallGroupedList>
  );
}
