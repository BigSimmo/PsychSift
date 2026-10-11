import { cardSurface, focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";
import { interactiveRowBase } from "@/components/ui/interactive-row";

/**
 * Therapy control recipes — token-backed Tailwind only (Clinical White / Sky Graphite).
 *
 * The three button recipes that used to live here (`commandControl`, `outlineControl`,
 * `iconControl`) are gone: every action they dressed is now the shared `Button` from
 * `@/components/ui/button`, per COMPONENTS.md section 9.1. What remains is the affordance
 * layer for the controls that are *not* buttons in the design-system sense — list rows,
 * disclosure headers and chips that need therapy's focus/hover behaviour without claiming
 * a Button variant.
 *
 * Hover states use `hover:not-aria-disabled:enabled:` so unavailable controls stay quiet
 * under BOTH disabled encodings. `:enabled` alone was enough while every unavailable
 * control carried the native attribute; a control that is unavailable for a stated reason
 * now carries `aria-disabled="true"` instead (it must keep its tab stop, or the reason in
 * its `title` is unreachable — see `ignoreUnavailableActivation` in ui-primitives), and
 * such a button *is* `:enabled`, so it would otherwise light up on hover.
 *
 * Focus affordance comes from the shared `focusRing` in `card-recipes.ts`. It used to be
 * redeclared here, justified by the shared export having been "renamed away from `focusRing`
 * on main" — that was already untrue: `card-recipes.ts` exports it, and the local copy meant a
 * change to the focus contract had to find this file too.
 */
export const therapyBtn = cn(
  interactiveRowBase,
  "w-full cursor-pointer font-[inherit] transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--duration-quick)]",
  "hover:not-aria-disabled:enabled:-translate-y-px active:not-aria-disabled:enabled:translate-y-px",
  "disabled:cursor-not-allowed disabled:opacity-55",
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-55",
  focusRing,
);

/**
 * Selected encoding for genuine `aria-pressed` toggles — the compare toggle, the favourite
 * and the recommend constraint pills. The shared `secondary` Button variant deliberately
 * carries no pressed state (most Buttons are not toggles), so a therapy toggle adds this
 * through `className`. It was previously `cardActionPressed`, private to `therapy-card.tsx`;
 * four surfaces need it, so it lives with the other therapy control recipes.
 *
 * Border AND text both move, and every call site also changes its label ("Compare" →
 * "In compare"), so the pressed state is never carried by colour alone.
 */
export const controlPressed =
  "aria-pressed:border-[color:var(--clinical-accent)] aria-pressed:text-[color:var(--clinical-accent-hover)]";

/**
 * Favourite toggles add a filled glyph on top of `controlPressed`. The fill is a shape
 * channel, so a saved favourite reads as saved without relying on the accent hue — which
 * matters most for the icon-only favourite on the result card, where there is no label to
 * change.
 */
export const favouritePressed = cn(controlPressed, "aria-pressed:[&_svg]:fill-current");

/**
 * Prominence edge for therapy's two hero cards — the record hero on
 * `detail-screen` and the top-match panel on `recommend-screen`.
 *
 * Deliberately NOT `cardAccentEdge`. That recipe is the *category* edge: it
 * replaced the factsheet cards' inline `borderTopColor` and answers "which
 * family does this card belong to". This edge answers a different question —
 * "this is the principal panel on the screen" — and a therapy screen has only
 * one category to begin with, so the top edge would say nothing the page does
 * not already say. The colour comes through the shared category tokens, which
 * `:root` aliases to the clinical accent, so it stays remappable per category,
 * per theme and under forced colors.
 *
 * The two hero cards used to be two independent literals. They are one now.
 *
 * October 2026 design pass: coloured side bars are retired in both modes (one
 * card per group, no bars). Prominence is now the whole hairline in the area's
 * tint, through the same remappable `--cat-border`, rather than a thick left
 * stripe that read as an alert rail.
 */
export const heroAccentEdge = "border-[color:var(--cat-border)]";

export const heroCard = cn(cardSurface, heroAccentEdge);
