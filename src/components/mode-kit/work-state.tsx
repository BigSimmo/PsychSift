"use client";

import { CloudOff, Inbox, LogIn, RotateCw, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { WorkButton, WorkEmpty } from "@/components/mode-kit/work";

/**
 * The one set of page states every work area shares (review 2, item 1): signed
 * out, no team, empty, offline and a failed read, plus the loading skeleton.
 * Before this each area drew its own, so "please sign in" had about eight
 * looks and "you're offline" four.
 *
 * Every state is the kit's flat empty card: a white hairline card, a flat
 * badge (area colour, or amber for offline and a failed read), one line, an
 * optional sentence and the actions. The area's own words stay with the area.
 *
 * This module never imports the sign-in dialog, so a page that loads it lazily
 * keeps doing so. `WorkSignInNotice` (work-sign-in-notice.tsx) is the signed-out
 * state with the dialog built in.
 */
export type WorkStateKind = "signed-out" | "no-team" | "empty" | "offline" | "error";

const DEFAULT_ICONS: Record<WorkStateKind, LucideIcon> = {
  "signed-out": LogIn,
  "no-team": Users,
  empty: Inbox,
  offline: CloudOff,
  error: TriangleAlert,
};

export type WorkStateNoticeProps = {
  readonly kind: WorkStateKind;
  readonly title: ReactNode;
  readonly body?: ReactNode;
  /** The badge icon; each kind has a default. */
  readonly icon?: LucideIcon;
  /** Signed out: opens the area's own sign-in dialog. Drawn as the area-colour button. */
  readonly onSignIn?: () => void;
  readonly signInLabel?: string;
  readonly signInTestId?: string;
  /** Offline or a failed read: "Try again". */
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
  readonly retryTestId?: string;
  /** Any further action (a link to join a team, a demo, a second choice), after the built-in one. */
  readonly action?: ReactNode;
  /**
   * The live region. A failed read is an alert and offline a status by
   * default; the others are quiet unless the page already announced them.
   */
  readonly role?: "status" | "alert" | null;
  /** Draw without the card, for a state inside a sheet or a card of its own. */
  readonly bare?: boolean;
  readonly testId?: string;
};

export function WorkStateNotice({
  kind,
  title,
  body,
  icon,
  onSignIn,
  signInLabel = "Sign in",
  signInTestId,
  onRetry,
  retryLabel = "Try again",
  retryTestId,
  action,
  role,
  bare = false,
  testId,
}: WorkStateNoticeProps) {
  const failed = kind === "offline" || kind === "error";
  const liveRole = role === undefined ? (kind === "error" ? "alert" : kind === "offline" ? "status" : undefined) : role;
  const actions: ReactNode[] = [];
  if (kind === "signed-out" && onSignIn) {
    actions.push(
      <WorkButton key="sign-in" icon={LogIn} onClick={onSignIn} testId={signInTestId}>
        {signInLabel}
      </WorkButton>,
    );
  }
  if (failed && onRetry) {
    actions.push(
      <WorkButton key="retry" variant="secondary" icon={RotateCw} onClick={onRetry} testId={retryTestId}>
        {retryLabel}
      </WorkButton>,
    );
  }
  if (action)
    actions.push(
      <span key="action" className="contents">
        {action}
      </span>,
    );

  return (
    <div
      role={liveRole ?? undefined}
      data-testid={testId}
      data-work-state={kind}
      className={bare ? "min-w-0" : "work-card min-w-0"}
    >
      <WorkEmpty
        icon={icon ?? DEFAULT_ICONS[kind]}
        tone={failed ? "amber" : "mode"}
        title={title}
        body={body}
        action={
          actions.length ? <div className="flex flex-wrap items-center justify-center gap-x-2">{actions}</div> : null
        }
      />
    </div>
  );
}

/**
 * A page or section waiting on the network: static grey rows in the shape of
 * what is coming (no shimmer, nothing moves when it lands), and the label for
 * screen readers only. Never a bare "Loading" line.
 */
export function WorkStateLoading({
  label,
  rows = 3,
  twoLine = true,
  eyebrow = false,
  testId,
}: {
  /** Spoken, never shown: "Loading your teams…". */
  readonly label: string;
  readonly rows?: number;
  readonly twoLine?: boolean;
  readonly eyebrow?: boolean;
  readonly testId?: string;
}) {
  return (
    <div role="status" aria-label={label} className="grid min-w-0" data-testid={testId} data-work-state="loading">
      <span className="sr-only">{label}</span>
      <ModeModuleSkeleton rows={rows} twoLine={twoLine} eyebrow={eyebrow} />
    </div>
  );
}
