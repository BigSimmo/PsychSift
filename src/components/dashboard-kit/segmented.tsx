"use client";

import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";

/**
 * The small Week/Month (or Week/Fortnight) switch in a card heading. Toggle
 * buttons with `aria-pressed`; each keeps a 48px tap height round its face.
 */
export function DashSegmented<T extends string>({
  label,
  options,
  value,
  onChange,
  testId,
}: {
  readonly label: string;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly testId?: string;
}) {
  return (
    <div role="group" aria-label={label} data-testid={testId} className="-my-3 flex items-center">
      <span className="inline-flex rounded-full border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] p-0.5 forced-colors:border">
        {options.map((option) => {
          const pressed = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={pressed}
              onClick={() => onChange(option.value)}
              data-testid={testId ? `${testId}-${option.value}` : undefined}
              className={cn(focusRing, "relative rounded-full before:absolute before:-inset-y-3 before:inset-x-0")}
            >
              <span
                className={cn(
                  "block rounded-full px-2.5 py-1 text-xs font-dash-title normal-case tracking-normal",
                  pressed
                    ? "bg-[color:var(--dash-ink)] text-[color:var(--dash-page)] forced-colors:border"
                    : "text-[color:var(--dash-muted)]",
                )}
              >
                {option.label}
              </span>
            </button>
          );
        })}
      </span>
    </div>
  );
}
