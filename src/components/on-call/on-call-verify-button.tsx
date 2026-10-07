"use client";

import { CircleCheck } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";
import { parseApiErrorResponse } from "@/lib/api-client-error";
import { isComplianceEntry } from "@/lib/on-call/compliance";
import { onCallEntrySchema, type OnCallEntry } from "@/lib/on-call/entry-model";

// Lives apart from the entry editor so the section lists can show the one-tap
// verify action without pulling the whole 1,400-line editor into first load.

export interface OnCallVerifyButtonProps {
  entry: OnCallEntry;
  /** Called with the entry after the server stamps a fresh `lastVerifiedAt`. */
  onVerified: (entry: OnCallEntry) => void;
  className?: string;
}

/**
 * The one-tap "still correct" action (task brief item 3): confirms an entry
 * with no trip through the full editor, so clearing a stale flag costs the
 * same one tap as ringing the number did.
 *
 * ## Why a compliance row says "Record still correct" and nothing else does
 *
 * Everywhere else in On Call the freshness stamp and the content are the same
 * thing: "is this ward number still right?" is a question the person tapping
 * can answer, and a bare "Still correct" names the only subject there is.
 *
 * On a compliance requirement the two come apart. The stamp is about the
 * RECORD — the date, the band and the issuer the owner typed in — while the
 * question the reader actually has is about the requirement itself, and
 * nothing in this app has been checked with the issuing body. A bare tick
 * reading "Still correct" beside a registration is the closest this surface
 * comes to the verdict it has forbidden itself
 * (`src/lib/on-call/compliance.ts`, "What this page may never say"), so the
 * label names its subject there. The other sections keep the shorter wording,
 * where it is not ambiguous.
 */
export function OnCallVerifyButton({ entry, onVerified, className }: OnCallVerifyButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVerify() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/on-call/entries/${entry.id}/verify`, { method: "POST" });
      if (!response.ok) throw await parseApiErrorResponse(response);
      const body: unknown = await response.json();
      const parsed = onCallEntrySchema.safeParse((body as { entry?: unknown } | null)?.entry);
      if (!parsed.success) throw new Error("Verify response was invalid.");
      onVerified(parsed.data);
    } catch (verifyError) {
      if (
        (typeof navigator !== "undefined" && !navigator.onLine) ||
        (verifyError instanceof TypeError &&
          (verifyError.message.toLowerCase().includes("fetch") ||
            verifyError.message.toLowerCase().includes("load failed")))
      ) {
        setError("You are offline. Connect to verify this entry.");
      } else {
        setError(verifyError instanceof Error ? verifyError.message : "Could not verify this entry.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={cn("inline-flex flex-col items-start gap-1", className)}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void handleVerify()}
        disabled={busy}
        busy={busy}
        busyLabel="Verifying…"
        icon={CircleCheck}
        testId={`on-call-verify-${entry.slug}`}
      >
        {isComplianceEntry(entry) ? "Record still correct" : "Still correct"}
      </Button>
      {error ? (
        <span role="alert" className="text-xs font-semibold text-[color:var(--danger)]">
          {error}
        </span>
      ) : null}
    </span>
  );
}
