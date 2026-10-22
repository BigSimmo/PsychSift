"use client";

import { useRef, useState } from "react";

import { clinicalToolAccessForStatus } from "@/components/mode-kit/use-clinical-tool-access";
import { TERMS_PROMPT_SAVE_ERROR, TERMS_VERSION } from "@/lib/front-door-content";
import { useAuthSession } from "@/lib/supabase/client";
import {
  TERMS_METADATA_KEY,
  buildTermsAcceptance,
  hasAcceptedTerms,
  readDeviceTermsVersion,
  readLocalTermsVersion,
  writeDeviceTermsVersion,
  writeLocalTermsVersion,
} from "@/lib/terms-acceptance";

type HeldAsk = { query: string; send: () => unknown };

/** Stands in for a user id when the acceptance belongs to this browser rather than an account. */
const DEVICE_OWNER = "device";

export type AskTermsGate = {
  /**
   * Runs `send` straight away, returning its result, when the current Terms are
   * accepted. Otherwise it holds `send` back, unrun, and opens the Terms step for
   * `query`; accepting runs it later.
   */
  guard: <T>(query: string, send: () => T) => T | undefined;
  /** The question waiting on the step, or null when the step is closed. */
  heldQuery: string | null;
  saving: boolean;
  signedIn: boolean;
  /** The question set aside by the last Not now, while its documents are on screen. */
  declinedQuery: string | null;
  /**
   * The question a signed-out visitor asked, while its documents are on screen. Answer
   * needs sign-in from 1 November 2026, so the question is never sent; the caller shows
   * the sign-in card with the documents instead.
   */
  signInQuery: string | null;
  accept: () => Promise<void>;
  notNow: () => void;
  clearDeclined: () => void;
  clearSignIn: () => void;
};

/**
 * The Terms step at the first Ask (audit F-13). A question bound for an AI
 * answer is held until the person accepts the current Terms version, so nothing
 * reaches the answer service first.
 *
 * Signed-out visitors are remembered in this browser only
 * (`writeDeviceTermsVersion`). Signed-in users are recorded on the account, the
 * same way `TermsAcceptancePrompt` does it, with the per-user local copy as a
 * fallback. A new `TERMS_VERSION` asks again in both cases.
 *
 * Not now sends nothing to Answer: `onNotNow` receives the held question so the
 * caller can show matching documents instead, and the step returns next Ask. Its
 * `isCurrent` turns false as soon as another Ask arrives, so a fallback still
 * waiting on something can stand down instead of switching the dashboard away
 * from the newer question.
 *
 * Before any of that, a signed-out visitor's question is never held for the Terms
 * or sent: Answer needs sign-in (docs/decisions/2026-10-20-clinical-decision-tools-
 * need-sign-in.md). It goes straight to `onNotNow`, so its documents still show, and
 * `signInQuery` names it for the sign-in card.
 */
export function useAskTermsGate({
  onNotNow,
  onSaveFailed,
}: {
  onNotNow: (query: string, isCurrent: () => boolean) => void;
  onSaveFailed?: (message: string) => void;
}): AskTermsGate {
  const { client, session, status } = useAuthSession();
  const userId = status === "authenticated" ? (session?.user.id ?? null) : null;
  const signedIn = userId !== null;
  const owner = userId ?? DEVICE_OWNER;
  const [held, setHeld] = useState<HeldAsk | null>(null);
  const [declinedQuery, setDeclinedQuery] = useState<string | null>(null);
  const [signInQuery, setSignInQuery] = useState<string | null>(null);
  const signInRequired = clinicalToolAccessForStatus(status) === "sign-in-required";
  const [saving, setSaving] = useState(false);
  // Accepted in this page's lifetime. Covers blocked storage, where the local copy
  // cannot be read back, so an accept can never loop straight back into the step.
  const acceptedRef = useRef<string | null>(null);
  // Counts every Ask and Not now, so a Not now fallback can tell whether it is still the latest.
  const askSeqRef = useRef(0);

  function isAccepted() {
    if (acceptedRef.current === `${owner}\n${TERMS_VERSION}`) return true;
    if (userId) {
      return hasAcceptedTerms({ metadata: session?.user.user_metadata, localVersion: readLocalTermsVersion(userId) });
    }
    return readDeviceTermsVersion() === TERMS_VERSION;
  }

  function guard<T>(query: string, send: () => T): T | undefined {
    const seq = (askSeqRef.current += 1);
    if (signInRequired) {
      const asked = query.trim();
      setHeld(null);
      setDeclinedQuery(null);
      setSignInQuery(asked);
      onNotNow(asked, () => askSeqRef.current === seq);
      return undefined;
    }
    if (isAccepted()) return send();
    // One step at a time; a second Ask while it is open changes nothing.
    if (!held) setHeld({ query: query.trim(), send });
    return undefined;
  }

  async function accept() {
    const current = held;
    if (!current || saving) return;
    const record = buildTermsAcceptance();
    if (userId) {
      setSaving(true);
      let saved = false;
      try {
        const result = await client?.auth.updateUser({ data: { [TERMS_METADATA_KEY]: record } });
        saved = Boolean(result && !result.error);
      } catch {
        saved = false;
      }
      // Kept on this device either way, so a failed account save never re-asks here.
      writeLocalTermsVersion(userId, record.version);
      setSaving(false);
      if (!saved) onSaveFailed?.(TERMS_PROMPT_SAVE_ERROR);
    } else {
      writeDeviceTermsVersion(record.version);
    }
    acceptedRef.current = `${owner}\n${record.version}`;
    setHeld(null);
    setDeclinedQuery(null);
    void current.send();
  }

  function notNow() {
    const current = held;
    if (!current || saving) return;
    setHeld(null);
    setDeclinedQuery(current.query);
    const seq = (askSeqRef.current += 1);
    onNotNow(current.query, () => askSeqRef.current === seq);
  }

  return {
    guard,
    heldQuery: held?.query ?? null,
    saving,
    signedIn,
    declinedQuery,
    signInQuery,
    accept,
    notNow,
    clearDeclined: () => setDeclinedQuery(null),
    clearSignIn: () => setSignInQuery(null),
  };
}
