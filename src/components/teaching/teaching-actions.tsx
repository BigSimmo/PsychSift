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

type ActionSurface = "card" | "summary" | "hero";

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
    "justify-center text-sm font-medium text-[color:var(--mode-identity)]",
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
      className={cn(buttonFaceClass({ variant, block: true }), "no-underline", surfaceFace(surface, variant))}
      {...(action.external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {Icon ? <Icon aria-hidden="true" className="size-icon-md shrink-0" /> : null}
      <span>{action.label}</span>
      <NewTabNote external={action.external} />
    </a>
  );
}

/*
 * Work-mode faces (work-mode redesign, owner request 6 Oct 2026). On a card the actions are the
 * work kit's flat pills (`work-button`): the mode colour for the one primary, white with a line
 * for the rest. On the hero (Teaching's own Today, session and presenting heroes) the primary is a
 * white pill in the mode colour and the rest a quiet glass-free tint, as the mockup draws them.
 * My Day's `summary` surface keeps the app's faces above.
 */
const HERO_FACE = {
  primary:
    "text-[color:var(--mode-identity)] before:bg-[color:var(--surface-raised)] dark:text-[color:var(--surface-raised)] dark:before:bg-[color:var(--text-heading)]",
  secondary:
    "text-current before:border before:border-[color:color-mix(in_srgb,currentColor_22%,transparent)] before:bg-[color:color-mix(in_srgb,currentColor_14%,transparent)]",
  text: "text-current underline underline-offset-4",
} as const;

function WorkAction({
  action,
  emphasis,
  surface,
}: {
  action: TeachingAction;
  emphasis: "primary" | "secondary" | "text";
  surface: "card" | "hero";
}) {
  const Icon = action.icon;
  const label = action.busy ? (action.busyLabel ?? action.label) : action.label;
  const inner = (
    <>
      {Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} /> : null}
      <span className="min-w-0 truncate">{label}</span>
      <NewTabNote external={action.external} />
    </>
  );
  const shared =
    surface === "hero"
      ? {
          className: cn(
            "inline-flex min-h-12 w-full items-center justify-center gap-1.5 rounded-full px-3 text-xs font-bold no-underline",
            "relative isolate before:absolute before:inset-x-0 before:inset-y-1.75 before:-z-10 before:rounded-full before:content-[''] disabled:opacity-60",
            HERO_FACE[emphasis],
            focusRing,
          ),
          "data-testid": action.testId,
        }
      : {
          className: cn("work-button w-full", emphasis === "text" && "!font-semibold"),
          "data-variant": emphasis === "text" ? "quiet" : emphasis,
          "data-testid": action.testId,
        };
  if (action.href) {
    return (
      <a href={action.href} {...shared} {...(action.external ? { target: "_blank", rel: "noreferrer" } : {})}>
        {inner}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={!action.onClick || action.busy}
      aria-busy={action.busy || undefined}
      {...shared}
    >
      {inner}
    </button>
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
          if (surface !== "summary")
            return <WorkAction key={action.id} action={action} emphasis={emphasis} surface={surface} />;
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
