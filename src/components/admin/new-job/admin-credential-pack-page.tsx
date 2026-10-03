"use client";

import { Copy, FileDown, Share2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAccountData } from "@/components/account-data-provider";
import { AdminLoadFailed } from "@/components/admin/admin-load-failed";
import { cardPadding, cardSurface } from "@/components/card-recipes";
import { InformationPageBreadcrumbs, InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import { subscribeAccountTransition } from "@/lib/account-scoped-browser-state";
import {
  buildCredentialPack,
  CREDENTIAL_PACK_NOTE,
  credentialPackText,
  includedCredentialPack,
  type CredentialPackNumbers,
} from "@/lib/admin/credential-pack";
import { loadDoctorCredentials } from "@/lib/admin/credentials-storage";
import { adminLoadState, selectAdminOwnEntries } from "@/lib/admin/own-entries";
import { formatDateEcho } from "@/lib/admin/renewal-dates";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { useOnCallEntries } from "@/lib/on-call/entry-store";

/**
 * Credential pack: the doctor's registration numbers (from the wallet on this
 * device) and renewal dates (from their own Admin records), on one page they
 * check and trim before it leaves the phone. "Save as PDF" opens the browser's
 * own print dialogue, which offers Save as PDF and the share sheet; "Share"
 * and "Copy" send the same lines as text. Nothing is uploaded or stored: the
 * ticks live in this page view only.
 *
 * The wallet is device-only, so the pack is offered only when signed in and
 * not in the example corpus, the same rule Admin Today uses for the wallet.
 */
export function AdminCredentialPackPage({ now: nowProp }: { now?: Date } = {}) {
  const state = useOnCallEntries();
  const { isAuthenticated } = useAccountData();
  const mountedAt = useMemo(() => new Date(), []);
  const now = nowProp ?? mountedAt;
  const loadState = adminLoadState(state);
  const own = useMemo(() => selectAdminOwnEntries(state), [state]);

  // The wallet lives on this device only. The page shows nothing from it until the records have
  // loaded on the phone, so the server render (which has no wallet) never disagrees with it.
  const [numbers, setNumbers] = useState<CredentialPackNumbers>(() => loadDoctorCredentials());
  useEffect(() => subscribeAccountTransition(() => setNumbers({})), []);

  const sections = useMemo(() => buildCredentialPack({ numbers, ownEntries: own }), [numbers, own]);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const included = useMemo(() => includedCredentialPack(sections, excluded), [sections, excluded]);
  const text = useMemo(() => credentialPackText(included, now), [included, now]);
  const [sendState, setSendState] = useState<"idle" | "copied" | "failed">("idle");
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  function toggle(key: string, include: boolean) {
    setSendState("idle");
    setExcluded((current) => {
      const next = new Set(current);
      if (include) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function copy() {
    void copyTextToClipboard(text).then(
      () => setSendState("copied"),
      () => setSendState("failed"),
    );
  }

  function share() {
    navigator.share({ title: "Credential pack", text }).then(
      () => setSendState("idle"),
      (error: unknown) => {
        // Closing the share sheet is not a failure.
        if ((error as { name?: string } | null)?.name === "AbortError") return;
        copy();
      },
    );
  }

  const available = isAuthenticated && !state.demoMode;
  const ready = loadState === "ready" && available;
  const nothingIncluded = included.length === 0;

  return (
    <InformationPageShell testId="admin-credential-pack-main">
      <div className="grid gap-1">
        <div className="print:hidden">
          <InformationPageBreadcrumbs home={{ label: "New job", href: "/admin/new-job" }} current="Credential pack" />
        </div>
        <h1 className="text-2xl font-semibold text-[color:var(--text-heading)]">Credential pack</h1>
        <p className={cn(textMuted, "text-sm")} data-testid="admin-credential-pack-subtitle">
          {formatDateEcho(perthCalendarDate(now))}
        </p>
      </div>

      {loadState === "failed" ? (
        <AdminLoadFailed reason={state.loadError} onRetry={state.retry} testId="admin-credential-pack-load-failed" />
      ) : loadState === "loading" ? (
        <ModeModuleSkeleton rows={4} twoLine eyebrow testId="admin-credential-pack-loading" />
      ) : loadState === "signed-out" || !available ? (
        <p
          className={cn(cardSurface, cardPadding.compact, textMuted, "text-sm")}
          data-testid="admin-credential-pack-signed-out"
        >
          Sign in to make a credential pack. It uses your own records and the numbers saved on this device.
        </p>
      ) : ready && sections.length === 0 ? (
        <p
          className={cn(cardSurface, cardPadding.compact, textMuted, "text-sm")}
          data-testid="admin-credential-pack-empty"
        >
          Nothing to put in a pack yet. Add your registration numbers on{" "}
          <Link href="/admin" className="underline">
            Admin Today
          </Link>{" "}
          and your renewal dates in{" "}
          <Link href="/admin/renewals" className="underline">
            Renewals
          </Link>
          .
        </p>
      ) : ready ? (
        <>
          <p className={cn(textMuted, "text-sm print:hidden")} data-testid="admin-credential-pack-privacy">
            Made on this device from your own records. Nothing is uploaded. Check every line before you send it, and
            untick anything the employer has not asked for.
          </p>

          <section className="grid gap-2 print:hidden" aria-label="Choose what goes in">
            <h2 className={cn(eyebrowText, "px-1")}>Choose what goes in</h2>
            <div
              className={cn(cardSurface, cardPadding.compact, "grid gap-1")}
              data-testid="admin-credential-pack-choose"
            >
              {sections.flatMap((section) =>
                section.rows.map((row) => (
                  <Checkbox
                    key={row.key}
                    label={row.title}
                    description={row.value}
                    checked={!excluded.has(row.key)}
                    onChange={(event) => toggle(row.key, event.currentTarget.checked)}
                    data-testid={`admin-credential-pack-include-${row.key}`}
                  />
                )),
              )}
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-2 print:hidden" data-testid="admin-credential-pack-actions">
            <Button
              variant="primary"
              icon={FileDown}
              onClick={() => window.print()}
              disabled={nothingIncluded}
              testId="admin-credential-pack-pdf"
            >
              Save as PDF
            </Button>
            {canShare ? (
              <Button
                variant="secondary"
                icon={Share2}
                onClick={share}
                disabled={nothingIncluded}
                testId="admin-credential-pack-share"
              >
                Share as text
              </Button>
            ) : null}
            <Button
              variant="secondary"
              icon={Copy}
              onClick={copy}
              disabled={nothingIncluded}
              testId="admin-credential-pack-copy"
            >
              {sendState === "copied" ? "Copied" : sendState === "failed" ? "Could not copy" : "Copy"}
            </Button>
            <span className="sr-only" role="status">
              {sendState === "copied" ? "Copied" : sendState === "failed" ? "Could not copy" : ""}
            </span>
          </div>
          <p className={cn(textMuted, "text-xs print:hidden")}>
            Save as PDF opens your browser&apos;s print screen. Choose Save as PDF there, or share from it.
          </p>

          {/* Only this section prints: the shared print rule hides the app around `data-print-output`. */}
          <section
            className="grid gap-2"
            aria-label="Preview"
            data-testid="admin-credential-pack-preview"
            data-print-output
          >
            <h2 className={cn(eyebrowText, "px-1")} data-print-hide>
              Preview
            </h2>
            <p className="hidden text-base font-semibold text-[color:var(--text-heading)] print:block">
              {`Credential pack · ${formatDateEcho(perthCalendarDate(now))}`}
            </p>
            {nothingIncluded ? (
              <p className={cn(cardSurface, cardPadding.compact, textMuted, "text-sm")}>
                Nothing ticked. Tick at least one line to make a pack.
              </p>
            ) : (
              <div className={cn(cardSurface, cardPadding.compact, "grid gap-4")}>
                {included.map((section) => (
                  <div key={section.label} className="grid gap-1">
                    <h3 className="text-sm font-semibold text-[color:var(--text-heading)]">{section.label}</h3>
                    <dl className="grid gap-1.5">
                      {section.rows.map((row) => (
                        <div key={row.key} data-testid={`admin-credential-pack-row-${row.key}`}>
                          <dt className={cn(textMuted, "text-xs")}>{row.title}</dt>
                          <dd className="nums break-words text-sm font-medium text-[color:var(--text-heading)]">
                            {row.value}
                          </dd>
                          {row.lines.map((line) => (
                            <dd key={line} className={cn(textMuted, "text-xs")}>
                              {line}
                            </dd>
                          ))}
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
                <p className={cn(textMuted, "text-xs")} data-testid="admin-credential-pack-note">
                  {CREDENTIAL_PACK_NOTE}
                </p>
              </div>
            )}
          </section>
        </>
      ) : null}
    </InformationPageShell>
  );
}
