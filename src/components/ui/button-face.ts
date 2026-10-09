import { cn, controlBase } from "@/components/ui-primitives";

export type ButtonVariant = "primary" | "secondary" | "toolbar" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

// One filled `--command` button per surface (register #12). `secondary` is the
// default for everything that is not the single primary action on screen.
//
// `danger` is the ONLY home for `--danger-solid` (register #13): a destructive
// action is the one place a filled red is not decoration. Do not reach for it to
// mean "important" — importance is `primary`.
const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-[color:var(--command)] text-[color:var(--command-contrast)] shadow-[var(--e1)] hover:bg-[color:var(--command-hover)] hover:shadow-[var(--e3)] active:bg-[color:var(--command-active)]",
  secondary:
    "border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] text-[color:var(--text)] shadow-[var(--shadow-inset)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)]",
  toolbar:
    "border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)]",
  ghost:
    "bg-transparent text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)]",
  danger:
    "bg-[color:var(--danger-solid)] text-[color:var(--danger-solid-contrast)] shadow-[var(--e1)] hover:bg-[color:var(--danger-solid-hover)] active:bg-[color:var(--danger-solid-active)]",
};

// Height is the tap target and never drops below `--spacing-tap` (48px); `size` moves the optical
// padding and label step, not the hit area (register #7/#18).
const SIZE: Record<ButtonSize, string> = {
  sm: "px-3 text-xs",
  md: "px-4 text-sm",
  lg: "px-5 text-sm",
};

/**
 * The Button face as a class string, for a control that has to be an anchor
 * rather than a `<button>`.
 *
 * The case this exists for: a result row whose whole surface navigates needs a
 * real `<a>`, so that a tap, a cmd-click, a middle-click and a long-press all
 * behave the way the browser already knows how to make them behave — none of
 * which a `router.push` in an `onClick` can offer. `Button` always renders a
 * `<button>` and has no polymorphic escape, so the caller builds the anchor and
 * borrows the face from here rather than copying the variant strings, which
 * would then drift the next time a variant changes.
 *
 * This module has no `"use client"` directive so a Server Component can call it.
 * `button.tsx` is a Client Component; importing the helper from there makes the
 * call a client-function reference and the server render fails.
 */
export function buttonFaceClass({
  variant = "secondary",
  size = "md",
  block = false,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
} = {}) {
  return cn(controlBase, VARIANT[variant], SIZE[size], block && "w-full");
}
