"use client";

import { Check, ChevronRight, Lock, type LucideIcon } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { ToggleSwitch } from "@/components/primitive-recipes/feedback";
import { modeInsetHairline, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { cn, eyebrowText } from "@/components/ui-primitives";

/**
 * The Alerts page's own small parts, built from the mode kit's recipes so a
 * row here is the same 48/52px row, hairline and type as ModeRow. They exist
 * because ModeRow only links; these rows open a sheet.
 */

/**
 * A row that opens a sheet: an optional area icon, title, secondary line, then a chevron, or an on/off
 * switch beside it (the mockup's Morning brief and Quiet hours), which stays a separate tap from the row.
 */
export function AlertsButtonRow({
  title,
  subtitle,
  onSelect,
  icon: Icon,
  mode,
  toggle,
  testId,
}: {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly onSelect: () => void;
  /** A round icon in the area's colour before the title. */
  readonly icon?: LucideIcon;
  /** The area the icon takes its colour from, e.g. `roster`. */
  readonly mode?: string;
  /** An on/off switch at the row's end, in place of the chevron. */
  readonly toggle?: { readonly enabled: boolean; readonly onToggle: () => void; readonly label: string };
  readonly testId?: string;
}) {
  return (
    <li className={cn(modeInsetHairline, "flex min-w-0 items-center")}>
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
        {Icon ? (
          <span
            aria-hidden="true"
            data-mode-identity={mode}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
          >
            <Icon aria-hidden="true" className="size-4" strokeWidth={2} />
          </span>
        ) : null}
        <span className="grid min-w-0 flex-1 gap-0.5 py-1">
          <span className={cn(modeNameText, "break-words text-base-minus leading-5 text-[color:var(--text-heading)]")}>
            {title}
          </span>
          {subtitle ? <span className={cn(modeSecondaryText, "break-words leading-5")}>{subtitle}</span> : null}
        </span>
        {toggle ? null : (
          <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
        )}
      </button>
      {toggle ? (
        <span className="shrink-0 pr-1.5">
          <ToggleSwitch enabled={toggle.enabled} onToggle={toggle.onToggle} aria-label={toggle.label} />
        </span>
      ) : null}
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
      className={cn(modeInsetHairline, modeRowHeight.double, "flex min-w-0 items-center gap-x-3 pl-3 pr-1")}
      data-testid={testId}
    >
      <span
        aria-hidden="true"
        className="grid size-7 shrink-0 place-items-center rounded-full bg-[color:var(--work-wash)] text-[color:var(--text-muted)]"
      >
        <Lock aria-hidden="true" className="size-3.5" />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5 py-1">
        <span className={cn(modeNameText, "break-words text-base-minus leading-5 text-[color:var(--text-muted)]")}>
          {title}
        </span>
        <span className={cn(modeSecondaryText, "break-words leading-5")}>{reason}</span>
      </span>
    </li>
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
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  // One tab stop for the group; arrows move the choice, as a radio group should.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next]!.value);
    const group = event.currentTarget.parentElement;
    (group?.children[next] as HTMLElement | undefined)?.focus();
  };
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-wrap gap-x-2" data-testid={testId}>
      {options.map((option, position) => {
        const chosen = position === index;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={chosen}
            tabIndex={chosen ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={onKeyDown}
            className={cn(focusRing, "inline-flex min-h-12 items-center rounded-md")}
          >
            <span
              className={cn(
                "inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-sm",
                chosen
                  ? "border-[color:var(--text-heading)] font-semibold text-[color:var(--text-heading)] forced-colors:border-2 forced-colors:border-[Highlight]"
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
