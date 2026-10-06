"use client";

import { ChevronRight, ExternalLink, FileText, Users, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { modePressable } from "@/components/mode-kit/recipes";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { AGREEMENT_UNION_NAME, AGREEMENT_UNION_ROLE } from "@/lib/work-profile/agreement-answers";

/**
 * Ask the agreement's small presentational pieces. Flat: white cards with one hairline, no lift,
 * flat tint icon circles. Kept thin so the main build can move them onto the work kit
 * (WorkCard, WorkIconCircle, WorkIconRow, WorkTag, WorkButton) without touching behaviour.
 */

export const agreementCard =
  "min-w-0 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] forced-colors:border-[color:CanvasText]";

const rowHairline = "border-t border-[color:var(--border)] first:border-t-0";

export function AgreementIconCircle({
  icon: Icon,
  tone = "accent",
  size = "md",
}: {
  readonly icon: LucideIcon;
  readonly tone?: "accent" | "neutral" | "warning";
  readonly size?: "md" | "lg";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full",
        size === "lg" ? "size-11" : "size-8",
        tone === "accent" && "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
        tone === "neutral" && "bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
        tone === "warning" && "bg-[color:var(--warning-soft)] text-[color:var(--warning-text)]",
      )}
    >
      <Icon strokeWidth={1.75} className={size === "lg" ? "size-icon-md" : "size-icon-sm"} />
    </span>
  );
}

export function AgreementSectionLabel({ id, children }: { readonly id?: string; readonly children: ReactNode }) {
  return (
    <h2 id={id} className={cn(eyebrowText, "px-1 pb-1")}>
      {children}
    </h2>
  );
}

/** A list row that runs an action. Two lines when it has a subtitle; 48px or taller either way. */
export function AgreementRowButton({
  icon,
  title,
  subtitle,
  onSelect,
  testId,
  trailing,
}: {
  readonly icon: LucideIcon;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly onSelect: () => void;
  readonly testId?: string;
  readonly trailing?: ReactNode;
}) {
  return (
    <li className={rowHairline}>
      <button
        type="button"
        onClick={onSelect}
        data-testid={testId}
        className={cn(
          focusRing,
          modePressable,
          subtitle ? "min-h-13" : "min-h-12",
          "flex w-full min-w-0 items-center gap-3 px-3 py-1.5 text-left",
        )}
      >
        <AgreementIconCircle icon={icon} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="break-words text-sm font-medium leading-5 text-[color:var(--text-heading)]">{title}</span>
          {subtitle ? (
            <span className="break-words text-xs leading-4 text-[color:var(--text-muted)]">{subtitle}</span>
          ) : null}
        </span>
        {trailing}
        <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" />
      </button>
    </li>
  );
}

/** The agreement PDF, opened in a new tab. Says so, and that it needs a connection when offline. */
export function AgreementPdfLink({
  href,
  label = "Open the agreement",
  variant = "secondary",
  offline = false,
  testId,
}: {
  readonly href: string;
  readonly label?: string;
  readonly variant?: "primary" | "secondary" | "text";
  readonly offline?: boolean;
  readonly testId?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      data-testid={testId}
      className={cn(
        focusRing,
        "inline-flex min-h-12 items-center justify-center gap-1.5 rounded-md text-sm font-medium no-underline",
        variant === "primary" &&
          "bg-[color:var(--command)] px-4 text-[color:var(--command-contrast)] hover:bg-[color:var(--command-hover)]",
        variant === "secondary" &&
          "border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-4 text-[color:var(--text)] hover:bg-[color:var(--surface-subtle)]",
        variant === "text" && "text-[color:var(--clinical-accent)] underline underline-offset-4",
      )}
    >
      <FileText aria-hidden="true" className="size-icon-sm shrink-0" />
      <span>{label}</span>
      <ExternalLink aria-hidden="true" className="size-icon-xs shrink-0" />
      <span className="sr-only"> (PDF, opens in a new tab{offline ? ". Needs a connection" : ""})</span>
    </a>
  );
}

/** Every answer ends here: the union by name. No phone number, because none is checked in PsychSift. */
export function AgreementUnionFooter() {
  return (
    <div
      className="flex min-w-0 items-start gap-3 border-t border-[color:var(--border)] px-3 py-3"
      data-testid="agreement-union"
    >
      <AgreementIconCircle icon={Users} tone="neutral" />
      <span className="grid min-w-0 gap-0.5">
        <span className="text-sm font-medium leading-5 text-[color:var(--text-heading)]">Not sure, or disagree?</span>
        <span className="text-sm leading-5 text-[color:var(--text)]">
          Ask <span className="font-semibold text-[color:var(--text-heading)]">{AGREEMENT_UNION_NAME}</span>.{" "}
          {AGREEMENT_UNION_ROLE}
        </span>
      </span>
    </div>
  );
}

/** Marks the typed words inside a suggestion, without changing what is read aloud. */
export function AgreementHighlight({ text, words }: { readonly text: string; readonly words: readonly string[] }) {
  if (!words.length) return <>{text}</>;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`\\b(${escaped.join("|")})[a-z']*`, "gi");
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    parts.push(
      <mark key={index} className="rounded-sm bg-[color:var(--clinical-accent-soft)] font-semibold text-inherit">
        {match[0]}
      </mark>,
    );
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
