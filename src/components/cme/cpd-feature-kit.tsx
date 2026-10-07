"use client";

import { Check, ChevronLeft, Clock, Copy, TriangleAlert, type LucideIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { ContextualBackLink } from "@/components/contextual-back-link";
import { useModeBandHeading } from "@/components/mode-band/mode-band";
import { WorkBody, WorkDock, WorkIconCircle, WorkSectionLabel, WorkTag } from "@/components/mode-kit/work";
import { announce } from "@/components/ui/live-announcer";
import { useOptionalToast } from "@/components/ui/toast";
import { cn } from "@/components/ui-primitives";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

/**
 * Small, flat, presentational pieces shared by two CPD features (Send to AMA
 * CPD Home, Job applications). They hold no data and no rules. The page frame,
 * section labels, icon circles, tags and the action dock are the work-mode kit
 * (`src/components/mode-kit/work.tsx`); the rest are thin local pieces the kit
 * does not have.
 *
 * Flat by design (owner, 6 Oct 2026): white cards with a 1 px hairline, flat
 * tint icon circles, no lift. Colours are tokens only.
 */

export const flatCard = "rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)]";
export const flatRow =
  "relative flex min-h-12 min-w-0 items-center gap-3 px-3 py-2 before:pointer-events-none before:absolute before:left-3 before:right-0 before:top-0 before:h-px before:bg-[color:var(--border)] before:content-[''] first:before:hidden";

/**
 * A CPD feature page inside the work frame: the band names the page (eyebrow
 * and title, as the mockup's header does), the page keeps an h1 for screen
 * readers only, and the content sits in the kit's page column.
 */
export type CpdFeatureBack = { readonly href: string; readonly label: string };

export function CpdFeaturePage({
  eyebrow,
  title,
  testId,
  back,
  children,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly testId: string;
  /**
   * The page's real parent. The frame's own back goes to the area's first tab, which skips a parent such
   * as Job applications for the CV, so the page carries its own. It follows this tab's history when there
   * is one and falls back to `href`, so it never dead-ends.
   */
  readonly back?: CpdFeatureBack;
  readonly children: ReactNode;
}) {
  useModeBandHeading({ eyebrow, title });
  return (
    <main data-mode-identity="cme" data-testid={testId} className="min-w-0 [overflow-wrap:anywhere]">
      <WorkBody>
        {back ? (
          <ContextualBackLink
            fallbackHref={back.href}
            data-testid="cpd-feature-back"
            className={cn(
              focusRing,
              "-ml-1 inline-flex min-h-12 w-fit items-center gap-1 text-sm font-medium text-[color:var(--mode-identity)] no-underline",
            )}
          >
            <ChevronLeft aria-hidden="true" className="size-icon-sm" />
            {back.label}
          </ContextualBackLink>
        ) : null}
        <h1 className="sr-only">{title}</h1>
        {children}
      </WorkBody>
    </main>
  );
}

/** The kit's small-caps section label, with an optional count and one text action. */
export function SectionLabel({
  id,
  children,
  count,
  action,
}: {
  readonly id?: string;
  readonly children: ReactNode;
  readonly count?: ReactNode;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}) {
  return (
    <WorkSectionLabel id={id} count={count} action={action}>
      {children}
    </WorkSectionLabel>
  );
}

export type IconTone = "mode" | "amber" | "green" | "neutral";

/** The kit's flat tint circle: soft fill, area-colour glyph, nothing else. */
export function IconCircle({ icon, tone = "mode" }: { readonly icon: LucideIcon; readonly tone?: IconTone }) {
  return <WorkIconCircle icon={icon} tone={tone} />;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

/** A month and day tile for a dated row. Read as a date by a screen reader through `label`. */
export function DateTile({ on, label }: { readonly on: string; readonly label: string }) {
  const month = MONTHS[Number(on.slice(5, 7)) - 1] ?? "";
  const day = Number(on.slice(8, 10));
  return (
    <span
      role="img"
      aria-label={label}
      className="grid w-11 shrink-0 justify-items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] py-1"
    >
      <span aria-hidden="true" className="text-2xs font-semibold leading-4 text-[color:var(--mode-identity)]">
        {month}
      </span>
      <span aria-hidden="true" className="text-base-minus font-normal leading-5 nums text-[color:var(--text-heading)]">
        {day}
      </span>
    </span>
  );
}

export type TagTone = "mode" | "amber" | "green" | "neutral";

/** The kit's status word on a flat tint. Always a word, never colour alone. */
export function Tag({ tone = "neutral", children }: { readonly tone?: TagTone; readonly children: ReactNode }) {
  return <WorkTag tone={tone}>{children}</WorkTag>;
}

/** "Not checked" honesty marker, in the warning tint. */
export function PendingTag({ children }: { readonly children: ReactNode }) {
  return (
    <WorkTag tone="amber">
      <span className="inline-flex items-center gap-1">
        <Clock aria-hidden="true" strokeWidth={2.2} className="size-3" />
        {children}
      </span>
    </WorkTag>
  );
}

/** A one-line note with an icon, quiet text. */
export function QuietNote({
  icon: Icon,
  children,
  testId,
}: {
  readonly icon: LucideIcon;
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <p data-testid={testId} className="flex items-start gap-2 px-1 text-sm leading-5 text-[color:var(--text-muted)]">
      <Icon aria-hidden="true" strokeWidth={1.5} className="mt-0.5 size-icon-sm shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * The patient-detail catch, the Remind me pattern: what looks wrong, in words.
 * Save stays off while it shows.
 */
export function PatientDetailCatch({
  problem,
  testId,
}: {
  readonly problem: { readonly title: string; readonly body: string } | null;
  readonly testId?: string;
}) {
  if (!problem) return null;
  return (
    <div
      role="alert"
      data-testid={testId}
      className="flex min-w-0 items-start gap-2.5 rounded-lg border border-[color:var(--warning)] bg-[color:var(--surface-raised)] p-3"
    >
      <TriangleAlert
        aria-hidden="true"
        strokeWidth={1.5}
        className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--warning)]"
      />
      <span className="grid min-w-0 gap-1">
        <span className="text-sm font-semibold leading-5 text-[color:var(--text-heading)]">{problem.title}</span>
        <span className="text-sm leading-5 text-[color:var(--text)]">{problem.body}</span>
      </span>
    </div>
  );
}

/** An on/off switch with a 48px tap area. */
export function FlatSwitch({
  on,
  onChange,
  labelledBy,
  testId,
}: {
  readonly on: boolean;
  readonly onChange: (on: boolean) => void;
  readonly labelledBy: string;
  readonly testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      data-testid={testId}
      onClick={() => onChange(!on)}
      className={cn(focusRing, "inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-full")}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative h-7 w-12 rounded-full motion-safe:transition-colors",
          on ? "bg-[color:var(--mode-identity)]" : "bg-[color:var(--border-strong)]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-6 rounded-full bg-[color:var(--surface-raised)] motion-safe:transition-[left]",
            on ? "left-5.5" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}

/** The kit's floating action dock: one or two `WorkButton`s in a glass capsule. */
export function ActionDock({ children, testId }: { readonly children: ReactNode; readonly testId?: string }) {
  return (
    // `contents`: the wrapper draws no box, so the dock stays sticky against the page column.
    <div data-testid={testId} className="contents print:hidden">
      <WorkDock>{children}</WorkDock>
    </div>
  );
}

/**
 * Shows an Undo toast when the app has a toast provider (it always does in the
 * app), and otherwise announces the message politely, so a test or an
 * embedded use still tells a screen reader what happened.
 */
export function useUndoNotice() {
  const toast = useOptionalToast();
  // Only the latest change can be undone: an older Undo would restore a state from
  // before a later change and silently throw that later change away.
  const lastUndo = useRef<string | null>(null);
  return (message: string, onUndo?: () => void) => {
    if (toast) {
      if (onUndo && lastUndo.current) toast.dismiss(lastUndo.current);
      const id = toast.push({
        tone: "success",
        title: message,
        duration: onUndo ? 10_000 : 4_000,
        ...(onUndo
          ? {
              action: { label: "Undo", onAction: onUndo },
              onClose: () => {
                if (lastUndo.current === id) lastUndo.current = null;
              },
            }
          : {}),
      });
      lastUndo.current = onUndo ? id : lastUndo.current;
      return;
    }
    announce(message);
  };
}

/**
 * Copies on press, then shows "Copied" on the button for a moment. A failure
 * says so in words; nothing is recorded either way.
 */
export function CopyIconButton({
  text,
  label,
  onCopied,
  testId,
}: {
  readonly text: string | (() => string);
  /** Names what is copied, for a screen reader: "Copy Grand round". */
  readonly label: string;
  readonly onCopied?: () => void;
  readonly testId?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={state === "copied" ? `${label}, copied` : state === "failed" ? `${label}, copy failed` : label}
      onClick={async () => {
        try {
          await copyTextToClipboard(typeof text === "function" ? text() : text);
          setState("copied");
          announce("Copied");
          onCopied?.();
        } catch {
          setState("failed");
          announce("Could not copy. Select the text and copy it yourself.");
        }
        window.setTimeout(() => setState("idle"), 2_000);
      }}
      className={cn(
        focusRing,
        "inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-md text-[color:var(--mode-identity)]",
      )}
    >
      <span className="grid size-8.5 place-items-center rounded-md bg-[color:var(--mode-identity-soft)]">
        {state === "copied" ? (
          <Check aria-hidden="true" strokeWidth={2} className="size-icon-sm" />
        ) : (
          <Copy aria-hidden="true" strokeWidth={1.75} className="size-icon-sm" />
        )}
      </span>
    </button>
  );
}
