/**
 * Flat class recipes for On Call's round 2 pages ("Your first week" and "From
 * your team roster"), per the owner's FLAT rule (6 Oct 2026): hairline white
 * cards with no lift, flat tinted icon circles, soft tags, and a 1 px identity
 * border for the selected state. Tokens only. Kept in one place so the main
 * build can swap these for its work kit in one edit.
 */

/** A flat white card: 1 px hairline, no shadow. */
export const flatCard =
  "min-w-0 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] forced-colors:border";

/** The one tinted card on a screen (the pack's header band). */
export const flatTintBand = "border-b border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)]";

/** A flat tinted icon circle with the area colour glyph. */
export const flatIconCircle =
  "grid size-8 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]";

/** A row inside a flat card: 48 px tall at least, hairline above every row but the first. */
export const flatRow =
  "relative flex min-h-12 min-w-0 items-center gap-3 px-3 py-2 before:pointer-events-none before:absolute before:left-3 before:right-0 before:top-0 before:h-px before:bg-[color:var(--border)] before:content-[''] first:before:hidden";

/** The eyebrow over a group: small capitals, muted. */
export const flatEyebrow = "px-1 text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]";

const tagBase =
  "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

/** Status tags: area colour, amber for something to do, neutral otherwise. */
export const flatTag = {
  mode: `${tagBase} border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]`,
  amber: `${tagBase} border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning-text)]`,
  neutral: `${tagBase} border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]`,
} as const;

/** A flat primary button in the area colour, 48 px tall. */
export const flatPrimaryButton =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[color:var(--mode-identity)] px-4 text-sm font-medium text-[color:var(--mode-identity-contrast)] no-underline transition-colors duration-[var(--duration-instant)] active:opacity-90";

/** A flat tinted secondary button, 48 px tall. */
export const flatSecondaryButton =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] px-4 text-sm font-medium text-[color:var(--mode-identity)] no-underline transition-colors duration-[var(--duration-instant)] active:opacity-90";

/** A quiet text action in the area colour, 48 px tap height. */
export const flatQuietAction =
  "inline-flex min-h-12 items-center gap-1.5 px-1 text-sm font-medium text-[color:var(--mode-identity)] no-underline underline-offset-2 hover:underline";
