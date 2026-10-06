import { Loader2, Send } from "lucide-react";

import { focusRing } from "@/components/card-recipes";
import { ROSTER_UNDO_MS } from "@/components/roster/roster-format";
import { cn } from "@/components/ui-primitives";

/**
 * The one confident action on the Sick for tomorrow page, and its held state.
 * Idle: a full-width flat violet button. Held: a soft violet bar with a
 * countdown ring, "Nothing has gone yet", Undo and Send now. Presentational:
 * the page owns the hold (`useSickSend`).
 */

const RING = 2 * Math.PI * 18;

function Countdown({ seconds }: { readonly seconds: number }) {
  const total = ROSTER_UNDO_MS / 1000;
  const offset = RING * (1 - Math.max(0, Math.min(total, seconds)) / total);
  return (
    <span
      role="timer"
      aria-label={`${seconds} ${seconds === 1 ? "second" : "seconds"} to undo`}
      className="nums relative grid size-10.5 shrink-0 place-items-center text-sm font-bold text-[color:var(--mode-identity)]"
    >
      <svg aria-hidden="true" viewBox="0 0 42 42" className="absolute inset-0 size-full">
        <circle cx="21" cy="21" r="18" fill="none" strokeWidth="3" style={{ stroke: "var(--mode-identity-border)" }} />
        <circle
          cx="21"
          cy="21"
          r="18"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={RING.toFixed(1)}
          strokeDashoffset={offset.toFixed(1)}
          transform="rotate(-90 21 21)"
          className="transition-[stroke-dashoffset] duration-200 motion-reduce:transition-none"
          style={{ stroke: "var(--mode-identity)" }}
        />
      </svg>
      <span aria-hidden="true">{seconds}</span>
    </span>
  );
}

export function SickAction({
  label,
  sub,
  onPress,
  disabledReason,
  secondsLeft,
  heldTitle,
  onUndo,
  onSendNow,
  sending = false,
}: {
  readonly label: string;
  readonly sub: string;
  readonly onPress: () => void;
  /** Shown under the button when nothing can be sent (sample, signed out, nothing picked). */
  readonly disabledReason?: string | null;
  readonly secondsLeft: number | null;
  readonly heldTitle: string;
  readonly onUndo: () => void;
  readonly onSendNow: () => void;
  readonly sending?: boolean;
}) {
  if (sending) {
    return (
      <div
        role="status"
        data-mode-identity="roster"
        className="flex min-h-16 items-center gap-3 rounded-xl border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] px-4 text-[color:var(--mode-identity)]"
      >
        <Loader2 aria-hidden="true" className="size-icon-lg animate-spin motion-reduce:animate-none" />
        <span className="text-base-minus font-semibold">Sending now</span>
      </div>
    );
  }
  if (secondsLeft !== null) {
    return (
      <div
        data-mode-identity="roster"
        data-testid="sick-held"
        className="flex min-h-16 flex-wrap items-center gap-3 rounded-xl border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] py-2 pl-3 pr-2"
      >
        <Countdown seconds={secondsLeft} />
        <span className="grid min-w-0 flex-1">
          <span className="break-words text-base-minus font-semibold text-[color:var(--mode-identity)]">
            {heldTitle}
          </span>
          <span className="text-xs text-[color:var(--text)]">Nothing has gone yet</span>
        </span>
        <span className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onUndo}
            className={cn(
              focusRing,
              "min-h-12 rounded-md px-3 text-base-minus font-bold text-[color:var(--mode-identity)] underline-offset-2 hover:underline",
            )}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={onSendNow}
            className={cn(
              focusRing,
              "min-h-12 rounded-md border border-[color:var(--mode-identity-border)] bg-[color:var(--surface-raised)] px-3 text-sm font-semibold text-[color:var(--text-heading)]",
            )}
          >
            Send now
          </button>
        </span>
      </div>
    );
  }
  const blocked = !!disabledReason;
  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        data-mode-identity="roster"
        data-testid="sick-send"
        aria-disabled={blocked ? "true" : undefined}
        aria-describedby={blocked ? "sick-send-reason" : undefined}
        onClick={blocked ? undefined : onPress}
        className={cn(
          focusRing,
          "flex min-h-16 w-full items-center gap-3 rounded-xl px-3 text-left forced-colors:border",
          blocked
            ? "cursor-not-allowed bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]"
            : "bg-[color:var(--mode-identity)] text-[color:var(--mode-identity-contrast)]",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "grid size-10.5 shrink-0 place-items-center rounded-full",
            blocked
              ? "bg-[color:var(--surface-raised)]"
              : "bg-[color:color-mix(in_oklab,var(--mode-identity-contrast)_16%,transparent)]",
          )}
        >
          <Send aria-hidden="true" strokeWidth={2} className="size-icon-md" />
        </span>
        <span className="grid min-w-0">
          <span className="break-words text-lg-minus font-bold leading-tight">{label}</span>
          <span className={cn("text-xs", blocked ? "" : "opacity-85")}>{sub}</span>
        </span>
      </button>
      {blocked ? (
        <p id="sick-send-reason" className="mx-1 text-sm text-[color:var(--text)]">
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}
