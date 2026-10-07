import { cn } from "@/components/ui-primitives";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { SHIFT_LETTER, type ShiftKind } from "@/lib/roster/shift-kind";

/**
 * "Which shift": one 56px row per shift, each a real checkbox with its label,
 * so the whole row is the tap target and keyboard space toggles it. A row can
 * be locked with a reason (already offered to the team). Presentational only.
 */

export type SickPickRow = {
  readonly id: string;
  readonly title: string;
  readonly sub: string;
  readonly kind: ShiftKind;
  readonly checked: boolean;
  /** Why this row can't be picked, shown as its second line. */
  readonly locked?: string | null;
};

export function SickShiftCode({ kind }: { readonly kind: ShiftKind }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-xs font-bold text-[color:var(--text-heading)]"
    >
      {SHIFT_LETTER[kind]}
    </span>
  );
}

export function SickShiftPicker({
  rows,
  onToggle,
  disabled = false,
}: {
  readonly rows: readonly SickPickRow[];
  readonly onToggle: (id: string) => void;
  /** While a report is held or sending, the picks are fixed. */
  readonly disabled?: boolean;
}) {
  return (
    <ul role="list" aria-label="Which shift" className={cn(modeModuleSurface, "shadow-none")} data-testid="sick-picker">
      {rows.map((row) => {
        const inputId = `sick-pick-${row.id}`;
        const locked = !!row.locked;
        return (
          <li
            key={row.id}
            className="relative before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[color:var(--border)] before:content-[''] first:before:hidden"
          >
            <label
              htmlFor={inputId}
              className={cn(
                "flex min-h-14 min-w-0 items-center gap-3 px-4 py-2",
                locked || disabled ? "cursor-default" : "cursor-pointer",
              )}
            >
              <input
                id={inputId}
                type="checkbox"
                checked={row.checked && !locked}
                disabled={locked || disabled}
                onChange={() => onToggle(row.id)}
                className="size-5 shrink-0 accent-[color:var(--mode-identity)]"
                data-mode-identity="roster"
              />
              <span className="grid min-w-0 flex-1 py-1">
                <span
                  className={cn(
                    "nums break-words text-base-minus font-semibold leading-5",
                    locked ? "text-[color:var(--text-muted)]" : "text-[color:var(--text-heading)]",
                  )}
                >
                  {row.title}
                </span>
                <span className="nums break-words text-sm leading-5 text-[color:var(--text-muted)]">
                  {row.locked ?? row.sub}
                </span>
              </span>
              <SickShiftCode kind={row.kind} />
            </label>
          </li>
        );
      })}
    </ul>
  );
}
