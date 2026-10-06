import type { ReactNode } from "react";

import { cn } from "@/components/ui-primitives";

/**
 * Tint families for chips, avatars and markers. Category only, never source
 * state: amber is the passed-date family and green the "on this device" /
 * flag family of the dashboard style (TOKENS.md §7.2).
 */
export type DashTint = "blue" | "blue-2" | "amber" | "green" | "neutral";

const CHIP: Readonly<Record<DashTint, string>> = {
  blue: "bg-[color:var(--dash-blue-tint)] text-[color:var(--dash-blue)]",
  "blue-2": "bg-[color:var(--dash-blue-tint-2)] text-[color:var(--dash-blue)]",
  amber: "bg-[color:var(--dash-amber-tint)] text-[color:var(--dash-amber)]",
  green: "bg-[color:var(--dash-green-tint)] text-[color:var(--dash-green)]",
  neutral: "bg-[color:var(--dash-raised)] text-[color:var(--dash-muted)]",
};

const SIZE = {
  sm: "size-8 rounded-md text-3xs",
  md: "size-9 rounded-lg text-sm",
  lg: "size-10 rounded-md text-3xs",
} as const;

/**
 * A small tinted square holding a short code ("CPD") or an icon. Decorative:
 * the row it sits in says the same thing in words.
 */
export function IconChip({
  tint = "blue",
  size = "sm",
  className,
  children,
}: {
  readonly tint?: DashTint;
  readonly size?: keyof typeof SIZE;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center font-dash-figure leading-none forced-colors:border",
        SIZE[size],
        CHIP[tint],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A small rounded label ("On this device"). */
export function DashTag({ tint = "green", children }: { readonly tint?: DashTint; readonly children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-px text-3xs font-dash-title normal-case tracking-normal forced-colors:border",
        CHIP[tint],
      )}
    >
      {children}
    </span>
  );
}

const AVATAR: Readonly<Record<"blue" | "green" | "amber", string>> = {
  blue: "dash-avatar-blue",
  green: "dash-avatar-green",
  amber: "dash-avatar-amber",
};

/** A round initials badge on one of three gradients, chosen by position, never by role. */
export function DashAvatar({
  initials,
  tint,
}: {
  readonly initials: string;
  readonly tint: "blue" | "green" | "amber";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-10 place-items-center rounded-full font-dash-figure text-xs text-[color:var(--dash-hero-ink)] forced-colors:border",
        AVATAR[tint],
      )}
    >
      {initials}
    </span>
  );
}
