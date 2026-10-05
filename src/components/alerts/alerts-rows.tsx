"use client";

import { Check, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { modeDot, modeInsetHairline, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { cn, eyebrowText } from "@/components/ui-primitives";

/**
 * The Alerts page's own small parts, built from the mode kit's recipes so a
 * row here is the same 48/52px row, hairline and type as ModeRow. They exist
 * because ModeRow only links; these rows open a sheet.
 */

/** A row that opens a sheet: title, secondary line, chevron. */
export function AlertsButtonRow({
  title,
  subtitle,
  onSelect,
  testId,
}: {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly onSelect: () => void;
  readonly testId?: string;
}) {
  return (
    <li className={cn(modeInsetHairline, "flex min-w-0")}>
      <button
        type="button"
        onClick={onSelect}
        data-testid={testId}
        className={cn(
          subtitle ? modeRowHeight.double : modeRowHeight.single,
          modePressable,
          focusRing,
          "flex w-full min-w-0 items-center gap-x-3 pl-3 pr-2 text-left",
        )}
      >
        <span className="grid min-w-0 flex-1 gap-0.5 py-1">
          <span className={cn(modeNameText, "break-words text-base-minus leading-5 text-[color:var(--text-heading)]")}>
            {title}
          </span>
          {subtitle ? <span className={cn(modeSecondaryText, "break-words leading-5")}>{subtitle}</span> : null}
        </span>
        <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      </button>
    </li>
  );
}

/**
 * A row for something that is not available yet or is locked: muted title and
 * reason, not a control, so nothing on it can be tapped by mistake.
 */
export function AlertsQuietRow({
  title,
  reason,
  testId,
}: {
  readonly title: string;
  readonly reason: string;
  readonly testId?: string;
}) {
  return (
    <li
      className={cn(modeInsetHairline, modeRowHeight.double, "flex min-w-0 items-center pl-3 pr-1")}
      data-testid={testId}
    >
      <span className="grid min-w-0 flex-1 gap-0.5 py-1">
        <span className={cn(modeNameText, "break-words text-base-minus leading-5 text-[color:var(--text-muted)]")}>
          {title}
        </span>
        <span className={cn(modeSecondaryText, "break-words leading-5")}>{reason}</span>
      </span>
    </li>
  );
}

/** The area's dot in its mode colour, before the subtitle (decorative: the words carry the meaning). */
export function AreaDot({ mode }: { readonly mode: string }) {
  return (
    <span
      aria-hidden="true"
      data-mode-identity={mode}
      className={cn(modeDot, "mr-1.5 align-middle bg-[color:var(--mode-identity)]")}
    />
  );
}

/** A small heading inside a sheet ("Where", "When"). */
export function SheetLabel({ id, children }: { readonly id?: string; readonly children: ReactNode }) {
  return (
    <h3 id={id} className={cn(eyebrowText, "px-0")}>
      {children}
    </h3>
  );
}

/**
 * One-of-several choices as chips: each a 48px tap area around a 40px chip,
 * the chosen one outlined in the heading colour with a tick, so the choice
 * never rests on colour alone.
 */
export function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  labelledBy,
  testId,
}: {
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly labelledBy: string;
  readonly testId?: string;
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-wrap gap-x-2" data-testid={testId}>
      {options.map((option) => {
        const chosen = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={chosen}
            onClick={() => onChange(option.value)}
            className={cn(focusRing, "inline-flex min-h-12 items-center rounded-md")}
          >
            <span
              className={cn(
                "inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-sm",
                chosen
                  ? "border-[color:var(--text-heading)] font-semibold text-[color:var(--text-heading)]"
                  : "border-[color:var(--border-strong)] text-[color:var(--text)]",
              )}
            >
              {chosen ? <Check aria-hidden="true" className="size-icon-sm" /> : null}
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
