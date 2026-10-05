"use client";

import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { cn, eyebrowText } from "@/components/ui-primitives";

/**
 * Work profile's flat list: a small grey label, then rows divided by hairlines
 * that run full width, with no card around them (the calm Work search look the
 * mock-up was approved in). Rows follow the mode-kit 48/52 height rule.
 */
export function WorkProfileSection({
  label,
  testId,
  children,
}: {
  readonly label?: string;
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={label ? headingId : undefined}
      className="grid min-w-0 gap-1"
      data-testid={testId}
    >
      {label ? (
        <h2 id={headingId} className={cn(eyebrowText, "pb-1")}>
          {label}
        </h2>
      ) : null}
      <ul role="list" className="grid min-w-0">
        {children}
      </ul>
    </section>
  );
}

const hairline = "border-t border-[color:var(--border)] first:border-t-0 forced-colors:border-[color:CanvasText]";

/** A small dot in an area's colour, beside its name. Decorative: the name always says the area. */
export function AreaDot({ mode }: { readonly mode: string }) {
  return (
    <span
      aria-hidden="true"
      data-mode-identity={mode}
      className="inline-block size-1.5 shrink-0 rounded-full bg-[color:var(--mode-identity)] forced-colors:border forced-colors:border-[color:CanvasText]"
    />
  );
}

export function WorkProfileRow({
  title,
  subtitle,
  icon: Icon,
  dot,
  trailing,
  href,
  external,
  onSelect,
  tone = "default",
  testId,
}: {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly icon?: LucideIcon;
  /** Area identity for a leading colour dot, e.g. `roster`. */
  readonly dot?: string;
  readonly trailing?: ReactNode;
  readonly href?: string;
  /** Opens an outside page in a new tab. */
  readonly external?: boolean;
  readonly onSelect?: () => void;
  readonly tone?: "default" | "link" | "danger";
  readonly testId?: string;
}) {
  const twoLine = Boolean(subtitle);
  const titleColour =
    tone === "link"
      ? "text-[color:var(--clinical-accent)]"
      : tone === "danger"
        ? "text-[color:var(--danger-text)]"
        : "text-[color:var(--text-heading)]";
  const body = (
    <>
      {Icon ? (
        <Icon
          aria-hidden="true"
          strokeWidth={1.6}
          className={cn(
            "size-icon-md shrink-0",
            tone === "danger" ? "text-[color:var(--danger-text)]" : "text-[color:var(--text-muted)]",
          )}
        />
      ) : null}
      <span className="grid min-w-0 flex-1 gap-0.5 py-1">
        <span className={cn(modeNameText, "flex min-w-0 items-center gap-2 break-words text-base-minus leading-5", titleColour)}>
          {dot ? <AreaDot mode={dot} /> : null}
          <span className="min-w-0 break-words">{title}</span>
        </span>
        {subtitle ? <span className={cn(modeSecondaryText, "break-words leading-5")}>{subtitle}</span> : null}
      </span>
      {trailing ? <span className="ml-auto flex shrink-0 items-center gap-1 text-sm">{trailing}</span> : null}
      {href || onSelect ? (
        <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      ) : null}
    </>
  );
  const rowClass = cn(
    twoLine ? modeRowHeight.double : modeRowHeight.single,
    "flex min-w-0 items-center gap-3 py-1",
  );
  if (href) {
    return (
      <li className={hairline}>
        <Link
          href={href}
          data-testid={testId}
          {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
          className={cn(rowClass, modePressable, focusRing, "w-full no-underline")}
        >
          {body}
        </Link>
      </li>
    );
  }
  if (onSelect) {
    return (
      <li className={hairline}>
        <button
          type="button"
          onClick={onSelect}
          data-testid={testId}
          className={cn(rowClass, modePressable, focusRing, "w-full text-left")}
        >
          {body}
        </button>
      </li>
    );
  }
  return (
    <li className={cn(hairline, rowClass)} data-testid={testId}>
      {body}
    </li>
  );
}

/** The quiet grey note: one fact, an optional action, never a colour alarm. */
export function WorkProfileNote({
  icon: Icon,
  title,
  children,
  action,
  tone = "neutral",
  testId,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
  readonly tone?: "neutral" | "warning";
  readonly testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-lg border bg-[color:var(--surface-raised)] px-3 py-2.5",
        tone === "warning" ? "border-[color:var(--warning-border)]" : "border-[color:var(--border)]",
      )}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={1.6}
        className={cn(
          "mt-0.5 size-icon-md shrink-0",
          tone === "warning" ? "text-[color:var(--warning-text)]" : "text-[color:var(--text-muted)]",
        )}
      />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="text-sm font-semibold text-[color:var(--text-heading)]">{title}</p>
        {children ? <div className="text-sm text-[color:var(--text-muted)]">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

export function WorkProfileFoot({ children }: { readonly children: ReactNode }) {
  return <p className="text-xs leading-5 text-[color:var(--text-muted)]">{children}</p>;
}
