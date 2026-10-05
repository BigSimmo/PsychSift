/**
 * On Call's calm look (mock-up v10, owner build 5 Oct 2026): flat lists on the
 * page, an uppercase eyebrow with one action at its right, outlined round call
 * discs and outlined buttons, and the mode's teal for the one filled button and
 * every action link.
 *
 * These recipes are On Call's own. The shared mode kit
 * (`src/components/mode-kit/recipes.ts`) is untouched, so no other mode moves.
 * Every value is a token; the teal comes from `--mode-identity`, which the
 * On Call layout scopes with `data-mode-identity="on-call"`.
 */

/** The outlined round call disc, 36px inside a 48px tap. */
export const onCallOutlineDisc =
  "grid size-9 place-items-center rounded-full border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] text-[color:var(--text-heading)] forced-colors:border";

/** An outlined button: 48px tall, the control radius. */
export const onCallOutlineButton =
  "inline-flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] px-4 text-base-minus font-semibold text-[color:var(--text-heading)] no-underline transition-colors duration-[var(--duration-instant)] active:bg-[color:var(--surface-wash)] forced-colors:border";

/** The one filled button on a screen: the mode's teal. */
export const onCallFilledButton =
  "inline-flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-md bg-[color:var(--mode-identity)] px-4 text-base-minus font-semibold text-[color:var(--mode-identity-contrast)] no-underline forced-colors:border";

/** An action at the right of an eyebrow, or any quiet link: teal, 13px, 600. */
export const onCallActionLink =
  "inline-flex min-h-12 shrink-0 items-center rounded-sm px-1 text-sm font-semibold text-[color:var(--mode-identity)] no-underline";

/** A chip: a 48px tap around a 36px outlined shape. */
export const onCallChipTap = "group inline-flex min-h-12 min-w-0 items-center";
export const onCallChipShape =
  "inline-flex min-h-9 min-w-0 items-center rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] px-2.5 text-sm font-medium text-[color:var(--text-heading)] group-aria-pressed:border-[color:var(--mode-identity)] group-aria-pressed:bg-[color:var(--mode-identity-soft)] group-aria-pressed:font-semibold group-aria-checked:border-[color:var(--mode-identity)] group-aria-checked:bg-[color:var(--mode-identity-soft)] group-aria-checked:font-semibold forced-colors:border";

/** A short role badge (REG, CON, W2): a 36px outlined circle. */
export const onCallBadge =
  "grid size-9 shrink-0 place-items-center rounded-full border border-[color:var(--border-strong)] text-2xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]";

/** A leading row glyph, muted, aligned with a badge. */
export const onCallLeadingIcon = "size-icon-md shrink-0 text-[color:var(--text-muted)]";

/** The thin progress track (shift lists, first night). */
export const onCallTrack =
  "h-1 overflow-hidden rounded-full bg-[color:var(--border)] forced-colors:border forced-colors:border-[CanvasText]";
export const onCallTrackFill = "block h-full rounded-full bg-[color:var(--mode-identity)] forced-colors:bg-[Highlight]";
