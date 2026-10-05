"use client";

import { Copy, Phone, Star } from "lucide-react";
import { useState, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { onCallOutlineDisc } from "@/components/on-call/kit/calm";
import { OnCallDialSheet, onCallCallRoute } from "@/components/on-call/kit/dial-sheet";
import {
  modeCallDiscShape,
  modeDot,
  modeInsetHairline,
  modePressable,
  modeRowHeight,
  modeTapArea,
} from "@/components/mode-kit/recipes";
import { OnCallStateLabel, type OnCallRowState } from "@/components/on-call/kit/state-label";
import { modeNameText, modeNumberText, modeSecondaryText } from "@/components/mode-kit/type";
import { useOnCallYouCalledAt } from "@/components/on-call/kit/use-you-called";
import { cn } from "@/components/ui-primitives";
import { rememberOnCallYouCalled } from "@/lib/on-call/call-marks";
import { formatOnCallTime } from "@/lib/on-call/display-dates";
import { ON_CALL_YOU_CALLED_ENABLED } from "@/lib/on-call/feature-flags";
import {
  onCallDialableNumber,
  resolveHandbookPhone,
  spokenOnCallNumber,
  type HandbookDial,
  type OnCallNumberLabel,
  type ResolvedOnCallNumber,
} from "@/lib/on-call/number-resolver";
import { recordOnCallRecent, type OnCallRecentSource } from "@/lib/on-call/recent-storage";

export type OnCallDialRowTone = "default" | "emergency";

export type OnCallDialRowProps = {
  readonly id: string;
  readonly source: OnCallRecentSource;
  readonly title: string;
  readonly subtitle?: string;
  readonly dial: HandbookDial | null;
  /** The "From a mobile:" route recorded beside a short code (handbook `mobileDial`). */
  readonly mobileDial?: HandbookDial | null;
  readonly numberLabel?: OnCallNumberLabel;
  readonly state?: OnCallRowState | null;
  readonly updatedAt?: string | null;
  readonly sources?: readonly { readonly label: string; readonly url: string }[];
  readonly reviewedAt?: string | null;
  readonly lastConfirmedAt?: string | null;
  /** Quiet red on the call disc and a 6px red dot: the pinned emergency number only. */
  readonly tone?: OnCallDialRowTone;
  /** Named in the dial sheet ("Synthetic Hospital"). */
  readonly hospitalName?: string | null;
  readonly trailingAction?: ReactNode;
  /** A badge or glyph before the name (REG, W2, a shield). */
  readonly leading?: ReactNode;
  /** Starred for My Day: a small teal star before the name. */
  readonly starred?: boolean;
  /** This phone is a hospital phone (the reader's switch): a bare extension rings its own digits. */
  readonly hospitalPhone?: boolean;
  /** The "I'm on a hospital phone" switch, shown in the dial sheet under a bare extension. */
  readonly hospitalPhoneSwitch?: ReactNode;
  readonly now?: Date;
  readonly testId: string;
  readonly className?: string;
};

/**
 * A personal entry's resolved number, as the same dial the handbook rows use,
 * so a reader's own numbers and the hospital's draw through one row.
 */
export function toHandbookDial(resolved: ResolvedOnCallNumber | null): HandbookDial | null {
  if (!resolved?.value) return null;
  // A pager is paged, not rung from a desk: never "From a hospital phone", never
  // "Copy extension". It shows as typed, beside its "Pager" label (review S5).
  if (resolved.label === "Pager") {
    return { kind: "text", display: resolved.value, tel: null, copy: null, route: null };
  }
  const dial = resolveHandbookPhone(resolved.value);
  if (resolved.tel && !dial.tel) {
    return {
      kind: "direct",
      display: dial.display || resolved.value,
      tel: resolved.tel,
      copy: onCallDialableNumber(resolved.value) ?? resolved.value,
      route: "any-phone",
    };
  }
  return dial;
}

/** The label is dropped when the number already says what it is ("ext 4455"), so it never reads "Ext ext". */
function visibleNumberLabel(label: OnCallNumberLabel | undefined, dial: HandbookDial | null): string | null {
  if (!label || !dial || dial.kind === "none") return null;
  if (label === "Ext" && /^ext\b/i.test(dial.display)) return null;
  return label === "Ext" ? "ext" : label;
}

/**
 * The one dial row (amendment 1.6). Everything a list of numbers needs, in one
 * place, so the four hub pages cannot drift apart:
 *
 * - The **call disc** is the `tel:` link, inside a 48px tap area, named with the
 *   digits spaced out ("Call Switchboard, 9 0 0 0, 0 0 0 0") so a screen reader
 *   reads a number, not "nine million".
 * - The **number** leads the secondary line under the name (mock-up v10),
 *   400 weight and tabular, and wraps rather than truncating. The name and
 *   number together are one button that opens the "Dial from a desk phone"
 *   sheet; the outlined call disc beside them is the call link.
 * - The row is **48px** with a title alone and **52px** with one secondary
 *   line, matching `OnCallModuleSkeleton`, growing only when text wraps.
 * - A desk-only number (an extension or short code) gets **no call link**: its
 *   disc is a copy control that opens the sheet, and the line says "From a
 *   hospital phone". If a mobile route is recorded beside it, that route is
 *   the row's only call link.
 * - A tap on the call link records "Your usual" and the "You called 02:14" mark.
 *
 * The row is a list item and is never a link itself, so no control sits inside
 * another control.
 */
export function OnCallDialRow({
  id,
  source,
  title,
  subtitle,
  dial,
  mobileDial,
  numberLabel,
  state,
  updatedAt,
  sources,
  reviewedAt,
  lastConfirmedAt,
  tone = "default",
  hospitalName,
  trailingAction,
  leading,
  starred = false,
  hospitalPhone = false,
  hospitalPhoneSwitch,
  now,
  testId,
  className,
}: OnCallDialRowProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const calledAt = useOnCallYouCalledAt(id);
  const emergency = tone === "emergency";
  const hasNumber = Boolean(dial && dial.kind !== "none");
  const callRoute = dial ? onCallCallRoute(dial, mobileDial, hospitalPhone) : null;
  const viaMobile = Boolean(mobileDial && callRoute === mobileDial);

  const recordCall = () => {
    // A hospital row is remembered by id and kind only; its title stays in the
    // signed-in handbook (review B2).
    recordOnCallRecent(source === "handbook" ? { id, source } : { id, title, source });
    if (ON_CALL_YOU_CALLED_ENABLED) rememberOnCallYouCalled(id);
  };

  const callName = callRoute
    ? `Call ${title}${viaMobile ? " from a mobile" : ""}${emergency ? ", emergency" : ""}, ${spokenOnCallNumber(callRoute.display)}`
    : "";

  // Everything under the title shares ONE secondary line, so a row is 48px
  // with a title alone and 52px with a second line — the heights the skeleton
  // reserves. It grows only when that line wraps.
  const secondary: ReactNode[] = [];
  if (subtitle) secondary.push(<span key="subtitle">{subtitle}</span>);
  const label = visibleNumberLabel(numberLabel, dial);
  if (label) secondary.push(<span key="label">{label}</span>);
  if (dial?.route === "hospital-phone") secondary.push(<span key="route">From a hospital phone</span>);
  if (state) secondary.push(<OnCallStateLabel key="state" state={state} />);
  if (calledAt) {
    secondary.push(<span key="called" className={modeNumberText}>{`You called ${formatOnCallTime(calledAt)}`}</span>);
  }

  // The number leads the secondary line (mock-up v10), so a list reads as
  // names with their numbers under them and one outlined disc per row.
  const numberLine: ReactNode[] = [];
  if (hasNumber && dial) {
    numberLine.push(
      <span key="number" data-dial-row-number="" className={cn(modeNumberText, "text-[color:var(--text)]")}>
        {dial.display}
      </span>,
    );
  }
  const lineParts = [...numberLine, ...secondary];
  const deskOnly = hasNumber && !callRoute?.tel;

  return (
    <li
      data-testid={testId}
      className={cn(
        modeInsetHairline,
        lineParts.length > 0 ? modeRowHeight.double : modeRowHeight.single,
        "flex min-w-0 items-center gap-x-3 pl-3 pr-1",
        className,
      )}
    >
      {leading ? (
        <span aria-hidden="true" className="flex w-9 shrink-0 items-center justify-center">
          {leading}
        </span>
      ) : null}
      {/* The name and number open the "Dial from a desk phone" sheet; the disc
          beside them is the call link. Siblings, never nested. */}
      {hasNumber && dial ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`${title}, ${dial.display}. Dialling details`}
          onClick={() => setSheetOpen(true)}
          data-dial-row-title=""
          className={cn(
            focusRing,
            modePressable,
            "grid min-h-12 min-w-0 flex-1 content-center gap-0.5 rounded-md py-1 text-left",
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {emergency ? (
              <span
                aria-hidden="true"
                data-testid={`${testId}-emergency-dot`}
                className={cn(modeDot, "bg-[color:var(--danger)]")}
              />
            ) : null}
            {starred ? (
              <Star
                aria-label="Starred"
                data-testid={`${testId}-star`}
                className="size-icon-xs shrink-0 fill-[color:var(--mode-identity)] text-[color:var(--mode-identity)]"
              />
            ) : null}
            <span
              className={cn(
                modeNameText,
                "min-w-0 break-words text-base-minus leading-5 text-[color:var(--text-heading)]",
              )}
            >
              {title}
            </span>
          </span>
          {lineParts.length > 0 ? (
            <span
              className={cn(modeSecondaryText, "flex min-w-0 flex-wrap items-center gap-x-1.5 break-words leading-5")}
            >
              {lineParts.map((part, index) =>
                index === 0 ? (
                  part
                ) : (
                  // The dot travels with the part after it, so a wrap never strands it at a line end.
                  <span key={`part-${index}`} className="inline-flex min-w-0 items-center gap-x-1.5">
                    <span aria-hidden="true">·</span>
                    {part}
                  </span>
                ),
              )}
            </span>
          ) : null}
        </button>
      ) : (
        // No number: plain text, never a dimmed button.
        <span data-dial-row-title="" className="grid min-h-12 min-w-0 flex-1 content-center gap-0.5 py-1">
          <span className="flex min-w-0 items-center gap-1.5">
            {emergency ? (
              <span
                aria-hidden="true"
                data-testid={`${testId}-emergency-dot`}
                className={cn(modeDot, "bg-[color:var(--danger)]")}
              />
            ) : null}
            {starred ? (
              <Star
                aria-label="Starred"
                data-testid={`${testId}-star`}
                className="size-icon-xs shrink-0 fill-[color:var(--mode-identity)] text-[color:var(--mode-identity)]"
              />
            ) : null}
            <span
              className={cn(
                modeNameText,
                "min-w-0 break-words text-base-minus leading-5 text-[color:var(--text-heading)]",
              )}
            >
              {title}
            </span>
          </span>
          {lineParts.length > 0 ? (
            <span
              className={cn(modeSecondaryText, "flex min-w-0 flex-wrap items-center gap-x-1.5 break-words leading-5")}
            >
              {lineParts.map((part, index) =>
                index === 0 ? (
                  part
                ) : (
                  // The dot travels with the part after it, so a wrap never strands it at a line end.
                  <span key={`part-${index}`} className="inline-flex min-w-0 items-center gap-x-1.5">
                    <span aria-hidden="true">·</span>
                    {part}
                  </span>
                ),
              )}
            </span>
          ) : null}
        </span>
      )}

      {hasNumber || trailingAction ? (
        <span className="flex shrink-0 items-center">
          {callRoute?.tel ? (
            <a
              href={callRoute.tel}
              onClick={recordCall}
              aria-label={callName}
              className={cn(modeTapArea, focusRing, "rounded-full")}
            >
              <span aria-hidden="true" className={emergency ? modeCallDiscShape.emergency : onCallOutlineDisc}>
                <Phone aria-hidden="true" strokeWidth={1.5} className="size-icon-md" />
              </span>
            </a>
          ) : deskOnly ? (
            // A desk-only number has no call link: the disc becomes the copy
            // control, which opens the sheet that copies it.
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={`Copy ${title}, ${dial?.display ?? ""}`}
              onClick={() => setSheetOpen(true)}
              data-dial-row-disc-spacer=""
              className={cn(modeTapArea, focusRing, "rounded-full")}
            >
              <span aria-hidden="true" className={onCallOutlineDisc}>
                <Copy aria-hidden="true" strokeWidth={1.5} className="size-icon-sm" />
              </span>
            </button>
          ) : null}
          {trailingAction ? <span className="flex shrink-0 items-center">{trailingAction}</span> : null}
        </span>
      ) : null}

      {dial && dial.kind !== "none" ? (
        <OnCallDialSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={title}
          hospitalName={hospitalName}
          dial={dial}
          mobileDial={mobileDial}
          updatedAt={updatedAt}
          sources={sources}
          reviewedAt={reviewedAt}
          lastConfirmedAt={lastConfirmedAt}
          now={now}
          onCall={recordCall}
          hospitalPhone={hospitalPhone}
          hospitalPhoneSwitch={hospitalPhoneSwitch}
          testId={`${testId}-sheet`}
        />
      ) : null}
    </li>
  );
}
