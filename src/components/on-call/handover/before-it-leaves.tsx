"use client";

import { Check, Copy, Printer, Share, TriangleAlert, type LucideIcon } from "lucide-react";

import { focusRing } from "@/components/card-recipes";
import { onCallFilledButton } from "@/components/on-call/kit/calm";
import { modeSecondaryText } from "@/components/mode-kit/type";
import { Sheet } from "@/components/ui/sheet";
import { cn, eyebrowText } from "@/components/ui-primitives";

/*
 * BEFORE IT LEAVES: the short check before any export. It says what the table
 * holds (beds and initials only; this handover has no names to count) and
 * where it is about to go, and the button names the choice.
 */

export type OnCallHandoverDestination = "copy" | "print" | "share";

const DESTINATIONS: Record<
  OnCallHandoverDestination,
  { readonly label: string; readonly note: string; readonly confirm: string; readonly icon: LucideIcon }
> = {
  copy: {
    label: "Copy as table",
    note: "Paste into the hospital's own note. Your clipboard may sync to your other devices.",
    confirm: "Copy table",
    icon: Copy,
  },
  print: { label: "Print or save as PDF", note: "A4 landscape", confirm: "Print", icon: Printer },
  share: {
    label: "Share to another app",
    note: "Leaves this phone. The other app may keep it.",
    confirm: "Share",
    icon: Share,
  },
};

export function OnCallHandoverBeforeItLeaves({
  open,
  destination,
  canShare,
  summary,
  clearsAt,
  onChoose,
  onCancel,
  onConfirm,
}: {
  readonly open: boolean;
  readonly destination: OnCallHandoverDestination;
  /** Share is offered only where this browser can share. */
  readonly canShare: boolean;
  readonly summary: { readonly title: string; readonly detail: string };
  /** "08:00", or null when the shift's clear time is not known. */
  readonly clearsAt: string | null;
  readonly onChoose: (destination: OnCallHandoverDestination) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const choices = (["copy", "print", "share"] as const).filter((key) => key !== "share" || canShare);
  const chosen = DESTINATIONS[destination];
  const ConfirmIcon = chosen.icon;
  const promises = [
    "PsychSift sends nothing to its servers or to AI",
    "Once pasted or shared, that place's rules apply",
    clearsAt ? `Your draft still clears at ${clearsAt}` : "Your draft still clears when your shift ends",
  ];
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={summary.title}
      headerLeading={
        <TriangleAlert aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--warning-text)]" />
      }
      description={summary.detail}
      testId="on-call-handover-before-it-leaves"
      footer={
        <div className="grid grid-cols-2 gap-3" data-mode-identity="on-call">
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              focusRing,
              "inline-flex min-h-12 items-center justify-center rounded-md px-4 text-base-minus font-semibold text-[color:var(--mode-identity)]",
            )}
            data-testid="on-call-handover-leave-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(onCallFilledButton, focusRing)}
            data-testid="on-call-handover-leave-confirm"
          >
            <ConfirmIcon aria-hidden="true" className="size-icon-sm" />
            {chosen.confirm}
          </button>
        </div>
      }
    >
      <div className="grid min-w-0 gap-3" data-mode-identity="on-call">
        <fieldset className="grid min-w-0 gap-1">
          <legend className={cn(eyebrowText, "mb-1 px-1")}>Send it to</legend>
          <div className="grid min-w-0">
            {choices.map((key) => {
              const option = DESTINATIONS[key];
              const Icon = option.icon;
              const selected = key === destination;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChoose(key)}
                  className={cn(
                    focusRing,
                    "flex min-h-12 w-full min-w-0 items-center gap-3 rounded-sm border-b border-[color:var(--border)] px-3 py-2.5 text-left last:border-b-0",
                    selected && "bg-[color:var(--surface-wash)]",
                  )}
                  data-testid={`on-call-handover-leave-${key}`}
                >
                  <Icon aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
                  <span className="grid min-w-0 flex-1">
                    <span className="text-sm font-semibold text-[color:var(--text-heading)]">{option.label}</span>
                    {key === "share" ? (
                      <span className="flex items-start gap-1 text-xs font-semibold text-[color:var(--warning-text)]">
                        <TriangleAlert aria-hidden="true" className="mt-0.5 size-icon-xs shrink-0" />
                        {option.note}
                      </span>
                    ) : (
                      <span className="text-xs text-[color:var(--text-muted)]">{option.note}</span>
                    )}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-full border forced-colors:border",
                      selected
                        ? "border-[color:var(--text-heading)] forced-colors:border-[Highlight]"
                        : "border-[color:var(--border-strong)]",
                    )}
                  >
                    {selected ? (
                      <span className="size-2.5 rounded-full bg-[color:var(--text-heading)] forced-colors:bg-[Highlight]" />
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <ul role="list" className="grid gap-1.5 px-1" data-testid="on-call-handover-leave-promises">
          {promises.map((line) => (
            <li key={line} className={cn(modeSecondaryText, "flex items-start gap-2")}>
              <Check aria-hidden="true" className="mt-0.5 size-icon-xs shrink-0" />
              {line}
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
