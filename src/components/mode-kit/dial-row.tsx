"use client";

import { Phone } from "lucide-react";
import { useState, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { spokenModeNumber } from "@/components/mode-kit/dates";
import { ModeDialSheet, type ModeDialNumber, type ModeDialRoute } from "@/components/mode-kit/dial-sheet";
import {
  modeCallDiscShape,
  modeDot,
  modeInsetHairline,
  modePressable,
  modeRowHeight,
  modeTapArea,
} from "@/components/mode-kit/recipes";
import { modeNameText, modeNumberText, modeSecondaryText } from "@/components/mode-kit/type";
import type { ModeSource } from "@/components/mode-kit/updated-line";
import { cn } from "@/components/ui-primitives";

export type ModeDialRowProps = {
  /** The role or place, e.g. "Switchboard". */
  readonly label: string;
  readonly subtitle?: string;
  /** Null shows "Not recorded" in the number column. */
  readonly number: ModeDialNumber | null;
  /** Other ways to reach the same place, listed in the sheet. */
  readonly routes?: readonly ModeDialRoute[];
  readonly source?: ModeSource | null;
  readonly checkedAt?: string | null;
  /** Named in the sheet, e.g. the hospital. */
  readonly context?: string | null;
  /** Extra muted lines under the label: a `ModeStateLabel`, "From a hospital phone". */
  readonly meta?: ReactNode;
  /** Quiet red disc and a 6px red dot: an emergency number only. */
  readonly tone?: "default" | "emergency";
  readonly trailingAction?: ReactNode;
  readonly sheetFooter?: ReactNode;
  /** Called when a call link is tapped, so the mode can remember it. */
  readonly onCall?: () => void;
  readonly now?: Date;
  readonly testId: string;
  readonly className?: string;
};

/**
 * The one dial row every mode's list of numbers uses (standard §2 row recipe):
 *
 * - Label and subtitle on the left; the **number in a fixed right-hand column**
 *   so digits line up down a list, then the **call disc**.
 * - The number text is a button that opens `ModeDialSheet`. It is 400 weight,
 *   tabular, and wraps rather than truncating.
 * - The call disc is the `tel:` link inside a 48px tap area, named with the
 *   digits spaced out ("Call Switchboard, 9 0 0 0, 0 0 0 0"). A number this
 *   phone cannot ring gets no disc, and the column keeps its width so the
 *   numbers still line up.
 * - The row is exactly 48px (label only) or 52px (with a subtitle or meta),
 *   matching `ModeModuleSkeleton`, and has no vertical padding of its own.
 *
 * The row is a list item and never a link itself, so no control sits inside
 * another. Put it in a `ModeGroupedList`.
 */
export function ModeDialRow({
  label,
  subtitle,
  number,
  routes,
  source,
  checkedAt,
  context,
  meta,
  tone = "default",
  trailingAction,
  sheetFooter,
  onCall,
  now,
  testId,
  className,
}: ModeDialRowProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const emergency = tone === "emergency";

  return (
    <li
      data-testid={testId}
      className={cn(
        modeInsetHairline,
        subtitle || meta ? modeRowHeight.double : modeRowHeight.single,
        "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 pl-3 pr-1",
        className,
      )}
    >
      <span className="grid min-w-0 gap-0.5 py-1">
        <span className="flex min-w-0 items-center gap-1.5">
          {emergency ? (
            <span
              aria-hidden="true"
              data-testid={`${testId}-emergency-dot`}
              className={cn(modeDot, "bg-[color:var(--danger)]")}
            />
          ) : null}
          <span
            className={cn(
              modeNameText,
              "min-w-0 break-words text-base-minus leading-5 text-[color:var(--text-heading)]",
            )}
          >
            {label}
          </span>
        </span>
        {subtitle ? <span className={cn(modeSecondaryText, "break-words leading-5")}>{subtitle}</span> : null}
        {meta}
      </span>

      <span className="flex min-w-0 items-center">
        {number ? (
          <button
            type="button"
            aria-haspopup="dialog"
            // The number as shown, so a voice-control user can say it, then digit by digit (A11Y-02).
            aria-label={`${label}, ${number.display} (${spokenModeNumber(number.display)}). Show dialling options`}
            onClick={() => setSheetOpen(true)}
            className={cn(
              focusRing,
              modePressable,
              modeNumberText,
              "min-h-12 w-30 rounded-md px-1 text-right text-base-minus break-words text-[color:var(--text)]",
            )}
            data-testid={`${testId}-number`}
          >
            {number.display}
          </button>
        ) : (
          <span className="w-30 px-1 text-right text-sm text-[color:var(--text-muted)]">Not recorded</span>
        )}
        {number?.tel ? (
          <a
            href={number.tel}
            onClick={onCall}
            aria-label={`Call ${label}, ${spokenModeNumber(number.display)}`}
            className={cn(modeTapArea, focusRing, "rounded-full")}
            data-testid={`${testId}-call`}
          >
            <span aria-hidden="true" className={emergency ? modeCallDiscShape.emergency : modeCallDiscShape.neutral}>
              <Phone aria-hidden="true" strokeWidth={1.5} className="size-icon-md" />
            </span>
          </a>
        ) : (
          <span aria-hidden="true" className="w-12 shrink-0" />
        )}
        {trailingAction ? <span className="flex shrink-0 items-center">{trailingAction}</span> : null}
      </span>

      {number ? (
        <ModeDialSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          label={label}
          context={context}
          number={number}
          routes={routes}
          source={source}
          checkedAt={checkedAt}
          now={now}
          onCall={onCall}
          testId={`${testId}-sheet`}
          footer={sheetFooter}
        />
      ) : null}
    </li>
  );
}
