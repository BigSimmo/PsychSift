"use client";

import { CalendarDays, Wrench, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { WorkButton } from "@/components/mode-kit/work";
import { WorkStateNotice, type WorkStateKind } from "@/components/mode-kit/work-state";
import { Sheet } from "@/components/ui/sheet";

/*
 * The page states in Teaching's words (v5.2 screens 12 to 16), drawn as the
 * shared work-mode state (`WorkStateNotice`) so Teaching looks like every other
 * area: a title, one line and the actions. No demo tag, no codes.
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

/** Teaching's own states that are not one of the shared kinds keep their badge. */
const KIND: Record<TeachingNoticeState, { kind: WorkStateKind; icon?: LucideIcon }> = {
  empty: { kind: "empty", icon: CalendarDays },
  "no-team": { kind: "no-team" },
  "signed-out": { kind: "signed-out" },
  offline: { kind: "offline" },
  error: { kind: "error" },
  setup: { kind: "empty", icon: Wrench },
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
  let extra: ReactNode = null;
  if (state === "signed-out") {
    if (onOpenDemo) {
      extra = (
        <WorkButton variant="quiet" onClick={onOpenDemo}>
          Open the demo
        </WorkButton>
      );
    } else if (demoHref) {
      // A plain <a>, not a client-side Link: the sample route sets a cookie, so it needs a full navigation.
      extra = (
        <a href={demoHref} className="work-button" data-variant="quiet">
          Open the demo
        </a>
      );
    }
  }
  if (state === "empty" && onSwitchService) {
    extra = (
      <WorkButton variant="secondary" onClick={onSwitchService}>
        Switch service
      </WorkButton>
    );
  }
  if (state === "no-team") {
    extra = (
      <WorkButton variant="secondary" onClick={() => setHowOpen(true)}>
        How to join a service
      </WorkButton>
    );
  }

  const { kind, icon } = KIND[state];
  return (
    <>
      <WorkStateNotice
        kind={kind}
        icon={icon}
        title={COPY[state].title}
        body={COPY[state].body(serviceName)}
        onSignIn={onSignIn}
        onRetry={onRetry}
        action={extra}
        testId={testId ?? `teaching-state-${state}`}
      />
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
    </>
  );
}
