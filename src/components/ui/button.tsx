"use client";

import { Loader2, type LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/components/ui-primitives";
import { buttonFaceClass, type ButtonSize, type ButtonVariant } from "@/components/ui/button-face";

export type { ButtonSize, ButtonVariant };
export { buttonFaceClass };

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  /** Leading icon, rendered decoratively. Swapped for the spinner while busy. */
  icon?: LucideIcon;
  /** Trailing icon; hidden while busy so the row cannot show two glyphs. */
  trailingIcon?: LucideIcon;
  /** Stretch to the container width — for phone dialogs and stacked forms. */
  block?: boolean;
  /**
   * Busy state, folded in from AsyncButton: disables the control, announces via
   * `aria-busy`, swaps the leading glyph for a spinner and the label for
   * `busyLabel`. A busy button with no `busyLabel` keeps its idle label.
   */
  busy?: boolean;
  busyLabel?: string;
  /**
   * Forwarded to the underlying `<button>`. Declared explicitly rather than left
   * to `...props`: React 19 passes `ref` as an ordinary prop for function
   * components, but `ButtonHTMLAttributes` does not carry it, so without this
   * line every caller needing the node — anchoring a popover, driving focus
   * after a destructive confirm, measuring for a tooltip — could not reach it,
   * and TypeScript rejected the attempt rather than failing silently.
   */
  ref?: Ref<HTMLButtonElement>;
  /**
   * Rendered as `data-testid`. A bare `data-testid` cannot be passed to a
   * component: `@types/react@19` gives `HTMLAttributes` no `data-${string}`
   * index signature, and TypeScript only waives unknown `data-*` attributes on
   * intrinsic elements. Same `testId` spelling `Sheet` and the dashboard shells
   * already use.
   */
  testId?: string;
};

export function Button({
  variant = "secondary",
  size = "md",
  children,
  icon: Icon,
  trailingIcon: TrailingIcon,
  block = false,
  busy = false,
  busyLabel,
  className,
  disabled,
  type,
  ref,
  testId,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      ref={ref}
      data-testid={testId}
      type={type ?? "button"}
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      className={cn(buttonFaceClass({ variant, size, block }), className)}
    >
      {busy ? (
        <Loader2 aria-hidden="true" className="size-icon-md shrink-0 animate-spin motion-reduce:animate-none" />
      ) : Icon ? (
        <Icon aria-hidden="true" className="size-icon-md shrink-0" />
      ) : null}
      <span>{busy && busyLabel ? busyLabel : children}</span>
      {!busy && TrailingIcon ? <TrailingIcon aria-hidden="true" className="size-icon-md shrink-0" /> : null}
    </button>
  );
}
