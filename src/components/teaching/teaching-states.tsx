"use client";

import { CalendarDays, CloudOff, LogIn, TriangleAlert, Users, Wrench, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ActionStrip, type TeachingAction } from "@/components/teaching/teaching-actions";
import { Sheet } from "@/components/ui/sheet";

/*
 * The page states in Teaching's words (v5.2 screens 12 to 16). Each is one
 * module: a title, one line and a full-width button. No demo tag, no codes.
 */
export type TeachingNoticeState = "empty" | "no-team" | "signed-out" | "offline" | "error" | "setup";

const COPY: Record<TeachingNoticeState, { title: string; body: (serviceName?: string) => string }> = {
  empty: { title: "No sessions yet", body: (serviceName) => `Nothing published by ${serviceName ?? "your service"}.` },
  "no-team": {
    title: "You're not in a teaching service yet",
    body: () => "Ask your service's organiser to invite you.",
  },
  "signed-out": { title: "Sign in to see your teaching", body: () => "Sessions, check-ins and your logbook." },
  offline: {
    title: "You're offline",
    body: () => "Reconnect, then try again. A check-in you couldn't record can still be added for 7 days.",
  },
  error: { title: "Teaching couldn't load", body: () => "Nothing changed. Your records are safe." },
  setup: { title: "Teaching is being set up", body: () => "It will appear here when it's ready." },
};

const ICONS: Record<TeachingNoticeState, LucideIcon> = {
  empty: CalendarDays,
  "no-team": Users,
  "signed-out": LogIn,
  offline: CloudOff,
  error: TriangleAlert,
  setup: Wrench,
};

export function TeachingStateNotice({
  state,
  serviceName,
  onRetry,
  onSignIn,
  onOpenDemo,
  demoHref,
  onSwitchService,
  testId,
}: {
  state: TeachingNoticeState;
  serviceName?: string;
  onRetry?: () => void;
  onSignIn?: () => void;
  onOpenDemo?: () => void;
  /** The Teaching sample's entry link; a full navigation, because the switch is a route that sets a cookie. */
  demoHref?: string;
  onSwitchService?: () => void;
  /** A page that pins its own id for this state (Today's failed read). */
  testId?: string;
}) {
  const [howOpen, setHowOpen] = useState(false);
  const actions: TeachingAction[] = [];
  if (state === "signed-out") {
    if (onSignIn) actions.push({ id: "sign-in", label: "Sign in", onClick: onSignIn, emphasis: "primary" });
    if (onOpenDemo) actions.push({ id: "demo", label: "Open the demo", onClick: onOpenDemo, emphasis: "text" });
    else if (demoHref) actions.push({ id: "demo", label: "Open the demo", href: demoHref, emphasis: "text" });
  }
  if ((state === "error" || state === "offline") && onRetry)
    actions.push({ id: "retry", label: "Try again", onClick: onRetry, emphasis: "secondary" });
  if (state === "empty" && onSwitchService)
    actions.push({ id: "switch", label: "Switch service", onClick: onSwitchService, emphasis: "secondary" });
  if (state === "no-team")
    actions.push({ id: "how", label: "How to join a service", onClick: () => setHowOpen(true), emphasis: "secondary" });

  const Icon = ICONS[state];
  // Work-mode redesign, owner request 6 Oct 2026: a calm empty card, a flat badge, one line and
  // the actions, in place of the v5 module.
  return (
    <section
      data-testid={testId ?? `teaching-state-${state}`}
      role={state === "offline" ? "status" : undefined}
      className="work-card grid justify-items-center gap-1.5 px-4.5 pt-6.5 pb-4 text-center"
    >
      <span
        aria-hidden="true"
        className="work-ic work-ic--lg mb-1"
        data-tone={state === "offline" || state === "error" ? "amber" : undefined}
      >
        <Icon aria-hidden="true" strokeWidth={2} />
      </span>
      <p className="text-base-minus font-bold text-[color:var(--text-heading)]">{COPY[state].title}</p>
      <p className="max-w-[17rem] text-xs leading-normal text-[color:var(--text-muted)]">
        {COPY[state].body(serviceName)}
      </p>
      <ActionStrip layout="stack" actions={actions} className="w-full max-w-[17rem] pt-1.5" />
      {state === "no-team" ? (
        <Sheet open={howOpen} onClose={() => setHowOpen(false)} title="How to join a service">
          <div className="grid gap-2 text-sm text-[color:var(--text-heading)]">
            <p>Your service&apos;s organiser gives you an invitation code for your work email.</p>
            <p>Sign in with that email, then enter the code under Join with invitation.</p>
            <Link className="inline-flex min-h-12 items-center underline" href="/on-call/service">
              Open service invitations
            </Link>
          </div>
        </Sheet>
      ) : null}
    </section>
  );
}
