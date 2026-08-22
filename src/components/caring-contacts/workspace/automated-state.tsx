import { CircleAlert } from "lucide-react";

/**
 * One automated state, with the reason it happened and what would change it.
 *
 * Spec §4.4 is a contract, not a preference: wherever the system has acted on its
 * own — paused, skipped, suppressed, blocked, escalated — the surface stating
 * that state must ALSO state, in plain words and in place, why, and what would
 * change it. A clinician who cannot see why the system did something cannot
 * correct it, and a bare status chip whose reason is only reachable by hovering
 * is, for a keyboard or screen-reader user, a reason that is not reachable at all.
 *
 * The three pieces therefore live in ONE accessible region, named by the state.
 * A screen reader that reaches the state has already entered the group and so
 * reaches the reason and the remedy without hunting for them, and the reason is
 * never carried by a `title` attribute.
 *
 * `role="group"` is named with `aria-label` rather than `aria-labelledby` on
 * purpose. `aria-labelledby` would need an id, an id would need `useId`, and
 * `useId` is a hook — which would make every screen that shows an automated
 * state ship a client component. Ruling 13 keeps the workspace's client payload
 * to a rounding error, so this stays a Server Component and takes its name from
 * the same string it renders.
 */
export type AutomatedStateProps = {
  /** A closed transport or plan term, e.g. "Suppressed". Never a patient-state label. */
  state: string;
  /** Plain-words reason the system reached this state. */
  because: string;
  /** Plain-words statement of what would change it. */
  changedBy: string;
};

export function AutomatedState({ state, because, changedBy }: AutomatedStateProps) {
  return (
    <div
      role="group"
      aria-label={state}
      className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 forced-colors:border-[CanvasText]"
    >
      {/*
        The state is carried by its word and by the icon beside it, never by the
        colour of a chip: a state that reads as "sent" in greyscale, in forced
        colours, or to a colour-blind clinician has failed to state anything.
      */}
      <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
        <CircleAlert aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="min-w-0">{state}</span>
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">Why: </span>
        {because}
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">What changes it: </span>
        {changedBy}
      </p>
    </div>
  );
}
