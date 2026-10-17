"use client";

import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { ExternalLink, FileText, type LucideIcon } from "lucide-react";

import { cn } from "@/components/ui-primitives";

export type DocumentBadgeVariant = "best" | "high" | "relevant" | "neutral" | "searched";
export type DocumentTileTone = "teal" | "info";

const badgeStyles: Record<DocumentBadgeVariant, string> = {
  best: "border-[color:var(--clinical-accent)]/20 bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]",
  high: "border-[color:var(--clinical-accent)]/18 bg-[color:var(--surface-raised)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]",
  relevant: "border-[color:var(--info)]/15 bg-[color:var(--info-soft)]/70 text-[color:var(--info)]",
  neutral: "border-[color:var(--border-lux)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
  searched:
    "border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
};

export function documentSupportBadgeProps(options: {
  cited?: boolean;
  badge?: string;
  sourceStrength?: "strong" | "moderate" | "weak" | "none" | null;
}): { variant: DocumentBadgeVariant; label: string } {
  if (options.cited === false || options.badge === "—") {
    return { variant: "searched", label: "Searched, not cited" };
  }
  if (!options.sourceStrength || options.sourceStrength === "none") {
    return { variant: "neutral", label: "Unsupported" };
  }
  if (options.sourceStrength === "strong") {
    return { variant: "best", label: "Direct" };
  }
  return { variant: "relevant", label: "Partial" };
}

const tileStyles: Record<DocumentTileTone, string> = {
  teal: "border-[color:var(--clinical-accent)]/12 bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
  info: "border-[color:var(--info)]/15 bg-[color:var(--info-soft)]/60 text-[color:var(--info)]",
};

export function documentFileKind(fileName?: string | null, fallback = "PDF") {
  const trimmed = fileName?.trim();
  if (!trimmed || !trimmed.includes(".")) return fallback;
  const extension = trimmed.split(".").pop()?.trim().toUpperCase();
  return extension || fallback;
}

export function documentTileTone(kind: string): DocumentTileTone {
  const normalized = kind.toUpperCase();
  return normalized === "DOC" || normalized === "DOCX" ? "info" : "teal";
}

export function DocumentFileTile({
  kind,
  tone = documentTileTone(kind),
  compact = false,
  className,
}: {
  kind: string;
  tone?: DocumentTileTone;
  compact?: boolean;
  className?: string;
}) {
  const label = kind.toUpperCase();

  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-lg border font-bold uppercase shadow-[var(--shadow-inset)]",
        compact ? "h-10 w-10 text-2xs" : "h-12 w-12 text-2xs",
        tileStyles[tone],
        className,
      )}
      aria-hidden
    >
      <FileText aria-hidden="true" className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      <span className="mt-0.5 leading-none">{label}</span>
    </span>
  );
}

export function DocumentBadge({
  children,
  icon: Icon,
  variant = "neutral",
  className,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  variant?: DocumentBadgeVariant;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-2xs font-semibold leading-none",
        badgeStyles[variant],
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="h-3.5 w-3.5" /> : null}
      {children}
    </span>
  );
}

export function DocumentMetaRow({
  items,
  className,
}: {
  items: Array<ReactNode | false | null | undefined>;
  className?: string;
}) {
  const visibleItems = items.filter((item) => item !== false && item !== null && item !== undefined && item !== "");
  if (visibleItems.length === 0) return null;

  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-[color:var(--text-muted)]",
        className,
      )}
    >
      {visibleItems.map((item, index) => (
        <span key={index} className="inline-flex items-center gap-2">
          {index > 0 ? <span className="h-1 w-1 rounded-full bg-[color:var(--border-strong)]" aria-hidden /> : null}
          {item}
        </span>
      ))}
    </p>
  );
}

export const documentActionClass =
  "inline-flex min-h-tap items-center justify-center gap-1.5 text-xs font-semibold transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

export function DocumentActionLink({
  href,
  children,
  icon: Icon = ExternalLink,
  className,
  ...props
}: {
  href: string;
  children: ReactNode;
  icon?: LucideIcon;
  className?: string;
} & Omit<ComponentProps<typeof Link>, "href" | "children" | "className">) {
  return (
    <Link href={href} className={cn(documentActionClass, className)} {...props}>
      <Icon aria-hidden="true" className="h-4 w-4" />
      {children}
    </Link>
  );
}

export function DocumentActionAnchor({
  children,
  icon: Icon = ExternalLink,
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <a className={cn(documentActionClass, className)} {...props}>
      <Icon aria-hidden="true" className="h-4 w-4" />
      {children}
    </a>
  );
}

export function DocumentActionButton({
  children,
  icon: Icon,
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  children: ReactNode;
  icon: LucideIcon;
}) {
  return (
    <button {...props} type="button" className={cn(documentActionClass, className)}>
      <Icon aria-hidden="true" className="h-4 w-4" />
      {children}
    </button>
  );
}
