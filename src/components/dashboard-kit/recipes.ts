/**
 * The dashboard style's class recipes (owner decision, 3 October 2026).
 *
 * Personal and operational dashboards only (My Day first). Everything here
 * reads the `--dash-*` tokens, which exist only inside `.dash-surface`
 * (`src/app/globals.css`), so a recipe used anywhere else simply has no
 * colour. Clinical pages keep the mode kit (`src/components/mode-kit/`) and
 * its 600 weight ceiling. Rules: docs/design-system/TOKENS.md §7.2.
 */

/** The wrapper a page puts round its dashboard to opt in to the style. */
export const dashSurface = "dash-surface";

/** A dashboard card: 18-20px corner (the 2xl rung), hairline, raised grey. */
export const dashCard =
  "relative grid min-w-0 content-start gap-1.5 rounded-2xl border border-[color:var(--dash-line)] bg-[color:var(--dash-card)] p-3 forced-colors:border";

/** The card heading: small capitals, wide tracking, faint. */
export const dashEyebrow = "font-dash-title text-2xs uppercase tracking-widest text-[color:var(--dash-faint)]";

/** A heavy display figure ("41 h", "4:20"). */
export const dashFigure = "font-dash-figure nums leading-none tracking-tight";

/** A row title or card title. */
export const dashTitle = "font-dash-title text-[color:var(--dash-ink)]";

/** A secondary line. */
export const dashMuted = "text-xs leading-snug text-[color:var(--dash-muted)]";

/** Faint small print (axis letters, legends). */
export const dashFaint = "text-3xs font-dash-title text-[color:var(--dash-faint)]";

/** A plain link in a card heading ("All 11", "Admin"). */
export const dashLink =
  "font-dash-title text-xs normal-case tracking-normal text-[color:var(--dash-blue)] no-underline hover:underline";

/** A small white inner tile (a quick action, a pinned number, a person). */
export const dashTile =
  "rounded-xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] forced-colors:border";

/** The pill buttons on rows and cards: a 48px tap area around a compact face. */
export const dashPillBase =
  "inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-full px-0 text-xs font-dash-title no-underline";

/** The visible face inside a pill button. */
export const dashPillFace = {
  primary:
    "rounded-full border border-[color:var(--dash-ink)] bg-[color:var(--dash-ink)] px-3 py-1.5 text-[color:var(--dash-page)] forced-colors:border",
  secondary:
    "rounded-full border border-[color:var(--dash-line-strong)] bg-[color:var(--dash-raised)] px-3 py-1.5 text-[color:var(--dash-ink)] forced-colors:border",
} as const;
