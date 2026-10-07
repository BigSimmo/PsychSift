import { modeDot } from "@/components/mode-kit/recipes";
import { cn } from "@/components/ui-primitives";
import { onCallAgo } from "@/lib/on-call/display-dates";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { currentWorkTimeZone } from "@/lib/work-time/current-zone";
import { zonedDateOf } from "@/lib/work-time/format";

/** A route not updated or confirmed for this many whole months says so (mock-up v10 s-3). */
export const ON_CALL_ROUTE_STALE_MONTHS = 3;

export type OnCallRouteFreshness =
  | { readonly kind: "fresh"; readonly words: string }
  | { readonly kind: "stale"; readonly words: string }
  | { readonly kind: "undated"; readonly words: string };

function latest(...values: readonly (string | null | undefined)[]): string | null {
  let best: { value: string; time: number } | null = null;
  for (const value of values) {
    if (!value) continue;
    const time = Date.parse(value);
    if (Number.isFinite(time) && (!best || time > best.time)) best = { value, time };
  }
  return best?.value ?? null;
}

/** Whole months between two instants, counted in work-zone calendar dates. */
function wholeMonths(from: string, now: Date, zone: string): number {
  const then = new Date(`${zonedDateOf(from, zone)}T00:00:00Z`);
  const today = new Date(`${zonedDateOf(now, zone)}T00:00:00Z`);
  return (
    (today.getUTCFullYear() - then.getUTCFullYear()) * 12 +
    (today.getUTCMonth() - then.getUTCMonth()) -
    (today.getUTCDate() < then.getUTCDate() ? 1 : 0)
  );
}

/**
 * How fresh a referral route is, from the later of the day it was last
 * published and the day an editor last confirmed it. Nothing is guessed: a
 * route with neither date says so and asks to be confirmed, the same as a
 * stale one, rather than passing as current.
 */
export function onCallRouteFreshness(
  updatedAt: string | null,
  lastConfirmedAt: string | null | undefined,
  now: Date = new Date(),
  zone: string = currentWorkTimeZone(),
): OnCallRouteFreshness {
  const basis = latest(updatedAt, lastConfirmedAt);
  if (!basis) return { kind: "undated", words: "No update date recorded · confirm before use" };
  const months = wholeMonths(basis, now, zone);
  if (months >= ON_CALL_ROUTE_STALE_MONTHS) {
    return { kind: "stale", words: `Not checked for ${months} months · confirm before use` };
  }
  return { kind: "fresh", words: `Updated ${onCallAgo(basis, now, zone)}` };
}

/**
 * The route's freshness as one small line with a dot. Amber words (the warning
 * text token) when it needs confirming; the words always say it, so the dot is
 * never the only signal.
 */
export function OnCallRouteFreshnessLine({
  updatedAt,
  lastConfirmedAt,
  now,
  testId,
}: {
  readonly updatedAt: string | null;
  readonly lastConfirmedAt?: string | null;
  readonly now?: Date;
  readonly testId?: string;
}) {
  const { zone } = useWorkTimeZone();
  const freshness = onCallRouteFreshness(updatedAt, lastConfirmedAt, now, zone);
  const warn = freshness.kind !== "fresh";
  return (
    <span
      data-testid={testId}
      data-freshness={freshness.kind}
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-xs",
        warn ? "text-[color:var(--warning-text)]" : "text-[color:var(--text-muted)]",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(modeDot, warn ? "bg-[color:var(--warning)]" : "bg-[color:var(--border-strong)]")}
      />
      <span className="min-w-0 break-words">{freshness.words}</span>
    </span>
  );
}
