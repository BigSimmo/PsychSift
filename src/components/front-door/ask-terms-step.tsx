"use client";

import Link from "next/link";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ASK_TERMS_STEP_ACCEPT_LABEL,
  ASK_TERMS_STEP_NOTE_ACCOUNT,
  ASK_TERMS_STEP_NOTE_DEVICE,
  ASK_TERMS_STEP_TITLE,
  FRONT_DOOR_DRAFT_DISCLAIMER,
  FRONT_DOOR_DRAFT_MARKER,
  TERMS_PROMPT_LATER_LABEL,
  TERMS_PROMPT_LEAD,
  TERMS_PROMPT_POINTS,
  TERMS_VERSION,
} from "@/lib/front-door-content";

/**
 * The Terms step shown at the first Ask: a bottom sheet on a phone and a centred
 * dialog from `sm:` up, through the shared `ConfirmDialog`. The close control,
 * Escape and a tap outside all mean Not now. Its state lives in
 * `useAskTermsGate`; this only draws it.
 */
export function AskTermsStep({
  open,
  saving,
  signedIn,
  onAccept,
  onNotNow,
}: {
  open: boolean;
  saving: boolean;
  signedIn: boolean;
  onAccept: () => void;
  onNotNow: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onCancel={onNotNow}
      onConfirm={onAccept}
      title={ASK_TERMS_STEP_TITLE}
      confirmLabel={ASK_TERMS_STEP_ACCEPT_LABEL}
      cancelLabel={TERMS_PROMPT_LATER_LABEL}
      tone="primary"
      busy={saving}
      busyLabel="Saving…"
      description={
        <div className="grid gap-3 text-[color:var(--text)]" data-testid="ask-terms-step">
          <p className="text-xs font-medium text-[color:var(--text-muted)]">
            <span className="font-semibold">{FRONT_DOOR_DRAFT_MARKER}</span> {FRONT_DOOR_DRAFT_DISCLAIMER}
          </p>
          <p>{TERMS_PROMPT_LEAD}</p>
          <ul className="grid list-disc gap-1 pl-5">
            {TERMS_PROMPT_POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <p>
            {/* A new tab, so reading the Terms never loses the question being held. */}
            <Link
              href="/terms"
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-tap items-center font-semibold text-[color:var(--clinical-accent)] underline underline-offset-4"
            >
              Read the full Terms of Use<span className="sr-only"> (opens in a new tab)</span>
            </Link>{" "}
            <span className="text-xs text-[color:var(--text-muted)]">(version {TERMS_VERSION})</span>
          </p>
          <p className="text-xs text-[color:var(--text-muted)]">
            {signedIn ? ASK_TERMS_STEP_NOTE_ACCOUNT : ASK_TERMS_STEP_NOTE_DEVICE}
          </p>
        </div>
      }
    />
  );
}
