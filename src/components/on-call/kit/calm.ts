/**
 * On Call's calm look (mock-up v10, owner build 5 Oct 2026), moved onto the
 * work-mode look (work-mode redesign, owner request 6 Oct 2026): lists sit in
 * one white hairline card, an uppercase eyebrow carries one action at its
 * right, leading glyphs and role badges are flat teal tint circles, call discs
 * are white with a pale teal ring and a teal handset, and buttons and chips are
 * pills. Flat throughout: no gradient, gloss or lift.
 *
 * These recipes are On Call's own. The shared mode kit
 * (`src/components/mode-kit/recipes.ts`) is untouched, so no other mode moves.
 * Every value is a token; the teal comes from `--mode-identity`, which the
 * On Call layout scopes with `data-mode-identity="on-call"`.
 */

/** The round call disc, 36px inside a 48px tap: white, a pale teal ring, a teal handset. */
export const onCallOutlineDisc =
  "grid size-9 place-items-center rounded-full border border-[color:var(--mode-identity-border)] bg-[color:var(--surface-raised)] text-[color:var(--mode-identity)] forced-colors:border";

/** An outlined button: 48px tall, a pill. */
export const onCallOutlineButton =
  "inline-flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-full border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] px-4 text-base-minus font-semibold text-[color:var(--text-heading)] no-underline transition-colors duration-[var(--duration-instant)] active:bg-[color:var(--surface-wash)] forced-colors:border";

/** The one filled button on a screen: the mode's teal, flat, a pill. */
export const onCallFilledButton =
  "inline-flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-full bg-[color:var(--mode-identity)] px-4 text-base-minus font-semibold text-[color:var(--mode-identity-contrast)] no-underline forced-colors:border";

/** An action at the right of an eyebrow, or any quiet link: teal, 13px, 600. */
export const onCallActionLink =
  "inline-flex min-h-12 shrink-0 items-center rounded-sm px-1 text-sm font-semibold text-[color:var(--mode-identity)] no-underline";

/** A chip: a 48px tap around a 36px outlined pill; selected is a soft teal tint with a 1px teal line. */
export const onCallChipTap = "group inline-flex min-h-12 min-w-0 items-center";
export const onCallChipShape =
  "inline-flex min-h-9 min-w-0 items-center rounded-full border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] px-2.5 text-sm font-medium text-[color:var(--text-heading)] group-aria-pressed:border-[color:var(--mode-identity)] group-aria-pressed:bg-[color:var(--mode-identity-soft)] group-aria-pressed:font-semibold group-aria-checked:border-[color:var(--mode-identity)] group-aria-checked:bg-[color:var(--mode-identity-soft)] group-aria-checked:font-semibold forced-colors:border";

/** A short role badge (REG, CON, W2): a 36px flat teal tint circle. */
export const onCallBadge =
  "grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-2xs font-semibold uppercase tracking-wide text-[color:var(--mode-identity)] forced-colors:border";

/** The "000" badge: a flat neutral circle, so the one red on the row stays the emergency call disc. */
export const onCallEmergencyBadge =
  "grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--surface-wash)] text-2xs font-semibold uppercase tracking-wide text-[color:var(--text-heading)] forced-colors:border";

/**
 * A leading row glyph: a flat teal tint circle (30px) drawn on the icon itself,
 * an 8px pad around a 14px glyph, so callers keep passing one Lucide icon.
 */
export const onCallLeadingIcon =
  "size-7.5 shrink-0 rounded-full bg-[color:var(--mode-identity-soft)] p-2 text-[color:var(--mode-identity)]";

/** The thin progress track (shift lists, first night). */
export const onCallTrack =
  "h-1 overflow-hidden rounded-full bg-[color:var(--border)] forced-colors:border forced-colors:border-[CanvasText]";
export const onCallTrackFill = "block h-full rounded-full bg-[color:var(--mode-identity)] forced-colors:bg-[Highlight]";
