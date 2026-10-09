"use client";

import type { LucideIcon } from "lucide-react";

import { focusRing } from "@/components/card-recipes";
import { modeTapArea } from "@/components/mode-kit/recipes";
import { Button, buttonFaceClass, type ButtonVariant } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";

/*
 * A module's actions as a strip (v4.2). The faces are the app's, not a second
 * copy: `ModeActionButton` on `main` (On Call PR 3115) is a compact 34px ICON-ONLY
 * control (`icon` and `label` required, no `children`) — a different job, an
 * in-row control, not a labelled call-to-action — and `ModeHeroLink` always
 * renders a `next/link` with no `onClick` and no external-tab support. Per
 * U1 Step 1 / R14, a labelled action composes the app's own `Button` instead
 * (`onClick` actions render it directly); an `href` action borrows its face
 * through `buttonFaceClass` on a real `<a>` — exactly the case that helper
 * exists for (a whole-surface link needs an anchor, never a button pretending
 * to navigate). Noted in the PR body under "Mode kit props".
 *
 * Two actions sit side by side from a 17rem container, stacked below that, so
 * two labels never squeeze at large text. The first action is filled unless it
 * says otherwise, so a strip has at most one filled action. A quiet text
 * action (the kit has no text tone) is Teaching's own link-styled control.
 */
export type TeachingAction = {
  id: string;
  label: string;
  icon?: LucideIcon;
  href?: string;
  external?: boolean;
  onClick?: () => void;
  busy?: boolean;
  busyLabel?: string;
  emphasis?: "primary" | "secondary" | "text";
  testId?: string;
};

type ActionSurface = "card" | "summary";

/*
 * On the summary surface (Today's hero) the app's filled face is the same
 * graphite as the surface in light mode, so the button vanished. There the
 * faces invert onto the summary ink pair instead; on a card they are unchanged.
 */
const SUMMARY_FACE: Record<ButtonVariant | "text", string> = {
  primary:
    "bg-[color:var(--surface-summary-ink)] text-[color:var(--surface-summary)] hover:bg-[color:var(--surface-summary-ink)] active:bg-[color:var(--surface-summary-ink)]",
  secondary:
    "border-[color:var(--surface-summary-line)] bg-transparent text-[color:var(--surface-summary-ink)] shadow-none hover:border-[color:var(--surface-summary-muted)] hover:bg-transparent",
  toolbar: "",
  ghost: "",
  danger: "",
  text: "text-[color:var(--surface-summary-ink)] underline underline-offset-4",
};

function surfaceFace(surface: ActionSurface, variant: ButtonVariant | "text"): string | undefined {
  return surface === "summary" ? SUMMARY_FACE[variant] : undefined;
}

/** Screen-reader note for a link that opens in a new tab. */
function NewTabNote({ external }: { external?: boolean }) {
  return external ? <span className="sr-only"> (opens in a new tab)</span> : null;
}

function QuietAction({ action, surface }: { action: TeachingAction; surface: ActionSurface }) {
  const className = cn(
    modeTapArea,
    focusRing,
    "justify-center text-sm font-medium text-[color:var(--primary)]",
    surfaceFace(surface, "text"),
  );
  const label = action.busy ? (action.busyLabel ?? action.label) : action.label;
  if (action.href) {
    return (
      <a
        href={action.href}
        className={className}
        data-testid={action.testId}
        {...(action.external ? { target: "_blank", rel: "noreferrer" } : {})}
      >
        {label}
        <NewTabNote external={action.external} />
      </a>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={action.onClick}
      disabled={action.busy}
      aria-busy={action.busy || undefined}
      data-testid={action.testId}
    >
      {label}
    </button>
  );
}

const EMPHASIS_VARIANT: Record<"primary" | "secondary", ButtonVariant> = { primary: "primary", secondary: "secondary" };

/** A whole-surface link needs a real `<a>` (cmd-click, middle-click, long-press): `buttonFaceClass` borrows the Button face for it. */
function LinkAction({
  action,
  variant,
  surface,
}: {
  action: TeachingAction & { href: string };
  variant: ButtonVariant;
  surface: ActionSurface;
}) {
  const Icon = action.icon;
  return (
    <a
      href={action.href}
      data-testid={action.testId}
      onClick={action.onClick}
      className={cn(buttonFaceClass({ variant, block: true }), "no-underline", surfaceFace(surface, variant))}
      {...(action.external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {Icon ? <Icon aria-hidden="true" className="size-icon-md shrink-0" /> : null}
      <span>{action.label}</span>
      <NewTabNote external={action.external} />
    </a>
  );
}

export function ActionStrip({
  actions,
  surface = "card",
  layout = "row",
  className,
}: {
  actions: readonly TeachingAction[];
  surface?: ActionSurface;
  layout?: "row" | "stack";
  className?: string;
}) {
  if (actions.length === 0) return null;
  return (
    <div className={cn("@container", className)} data-surface={surface}>
      <div
        className={cn(
          "grid gap-x-2",
          layout === "stack" && "gap-y-2",
          layout === "row" ? "@min-[17rem]:auto-cols-fr @min-[17rem]:grid-flow-col" : "grid-cols-1",
        )}
      >
        {actions.map((action, index) => {
          const emphasis = action.emphasis ?? (index === 0 ? "primary" : "secondary");
          if (emphasis === "text") return <QuietAction key={action.id} action={action} surface={surface} />;
          const variant = EMPHASIS_VARIANT[emphasis];
          if (action.href)
            return (
              <LinkAction
                key={action.id}
                action={action as TeachingAction & { href: string }}
                variant={variant}
                surface={surface}
              />
            );
          return (
            <Button
              key={action.id}
              variant={variant}
              icon={action.icon}
              onClick={action.onClick}
              disabled={!action.onClick}
              busy={action.busy}
              busyLabel={action.busyLabel}
              block
              className={surfaceFace(surface, variant)}
              testId={action.testId}
            >
              {action.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
