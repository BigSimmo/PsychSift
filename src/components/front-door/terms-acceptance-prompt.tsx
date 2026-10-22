"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import {
  FRONT_DOOR_DRAFT_DISCLAIMER,
  FRONT_DOOR_DRAFT_MARKER,
  TERMS_PROMPT_ACCEPT_LABEL,
  TERMS_PROMPT_LATER_LABEL,
  TERMS_PROMPT_LATER_NOTE,
  TERMS_PROMPT_LEAD,
  TERMS_PROMPT_POINTS,
  TERMS_PROMPT_SAVE_ERROR,
  TERMS_PROMPT_TITLE,
  TERMS_VERSION,
} from "@/lib/front-door-content";
import { useAuthSession } from "@/lib/supabase/client";
import {
  TERMS_METADATA_KEY,
  buildTermsAcceptance,
  hasAcceptedTerms,
  readLocalTermsVersion,
  writeLocalTermsVersion,
} from "@/lib/terms-acceptance";

/** Pages that are the terms themselves, or that sign-in flows must reach unblocked. */
const PROMPT_EXEMPT_PATHS = ["/terms", "/about", "/privacy", "/auth"];

/**
 * Asks a signed-in user to accept the current Terms of Use, once per terms
 * version. Signed-out and demo sessions see nothing. See
 * `src/lib/terms-acceptance.ts` for where the record is kept and why.
 */
export function TermsAcceptancePrompt() {
  const { client, session, status } = useAuthSession();
  const pathname = usePathname() ?? "";
  const userId = session?.user.id ?? null;
  // Per-user state keyed by id, so switching accounts never carries a decision over.
  const [acceptedFor, setAcceptedFor] = useState<string | null>(null);
  const [laterFor, setLaterFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  if (status !== "authenticated" || !userId) return null;
  if (PROMPT_EXEMPT_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return null;
  if (acceptedFor === userId || laterFor === userId) return null;
  // Stay mounted while the save is in flight or its error is showing: the local
  // copy written after a failed save would otherwise hide the warning at once.
  const settling = saving || saveError;
  if (
    !settling &&
    hasAcceptedTerms({ metadata: session?.user.user_metadata, localVersion: readLocalTermsVersion(userId) })
  ) {
    return null;
  }

  async function accept() {
    if (!userId) return;
    const record = buildTermsAcceptance();
    setSaving(true);
    setSaveError(false);
    let saved = false;
    try {
      const result = await client?.auth.updateUser({ data: { [TERMS_METADATA_KEY]: record } });
      saved = Boolean(result && !result.error);
    } catch {
      saved = false;
    }
    // Written only once the account save has answered, so this device remembers
    // the acceptance either way and the outcome is never reported early.
    writeLocalTermsVersion(userId, record.version);
    if (saved) setAcceptedFor(userId);
    else setSaveError(true);
    setSaving(false);
  }

  return (
    <Sheet
      open
      onClose={() => setLaterFor(userId)}
      title={TERMS_PROMPT_TITLE}
      closeLabel={TERMS_PROMPT_LATER_LABEL}
      mobilePlacement="bottom"
      testId="terms-acceptance-prompt"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setLaterFor(userId)} disabled={saving}>
            {saveError ? "Close" : TERMS_PROMPT_LATER_LABEL}
          </Button>
          {saveError ? null : (
            <Button variant="primary" onClick={() => void accept()} busy={saving} busyLabel="Saving…">
              {TERMS_PROMPT_ACCEPT_LABEL}
            </Button>
          )}
        </div>
      }
    >
      <div className="grid gap-3 text-sm leading-6 text-[color:var(--text)]">
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
          <Link
            href="/terms"
            className="inline-flex min-h-tap items-center font-semibold text-[color:var(--clinical-accent)] underline underline-offset-4"
          >
            Read the full Terms of Use
          </Link>{" "}
          <span className="text-xs text-[color:var(--text-muted)]">(version {TERMS_VERSION})</span>
        </p>
        {saveError ? (
          <p role="status" className="text-sm font-medium text-[color:var(--text-muted)]">
            {TERMS_PROMPT_SAVE_ERROR}
          </p>
        ) : (
          <p className="text-xs text-[color:var(--text-muted)]">{TERMS_PROMPT_LATER_NOTE}</p>
        )}
      </div>
    </Sheet>
  );
}
