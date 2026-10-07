"use client";

import { Copy, FileDown, LogIn, Share2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAccountData } from "@/components/account-data-provider";
import { AdminNote, AdminPage, AdminSkeleton, adminStyles } from "@/components/admin/admin-kit";
import { AdminLoadFailed } from "@/components/admin/admin-load-failed";
import { focusRing } from "@/components/card-recipes";
import { InformationPageBreadcrumbs } from "@/components/information-page-shell";
import { PageTitleUnderBand, useModeBandHeading } from "@/components/mode-band/mode-band";
import { WorkButton, WorkCard, WorkDock, WorkEmpty, WorkSectionLabel } from "@/components/mode-kit/work";
import { ToggleSwitch } from "@/components/primitive-recipes/feedback";
import { cn } from "@/components/ui-primitives";
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
 * check and switch off before it leaves the phone. "Save as PDF" opens the browser's
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

  useModeBandHeading({ eyebrow: "New job", title: "Credential pack" });

  return (
    <AdminPage testId="admin-credential-pack-main">
      <div className="grid gap-1">
        <div className="print:hidden">
          <InformationPageBreadcrumbs home={{ label: "New job", href: "/admin/new-job" }} current="Credential pack" />
        </div>
        <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
          Credential pack
        </PageTitleUnderBand>
        <p className="text-sm text-[color:var(--text-muted)]" data-testid="admin-credential-pack-subtitle">
          {formatDateEcho(perthCalendarDate(now))}
        </p>
      </div>

      {loadState === "failed" ? (
        <AdminLoadFailed reason={state.loadError} onRetry={state.retry} testId="admin-credential-pack-load-failed" />
      ) : loadState === "loading" ? (
        <div className="grid gap-5" data-testid="admin-credential-pack-loading" aria-busy="true">
          <span className="sr-only">Loading your records</span>
          <AdminSkeleton className="h-36" />
          <AdminSkeleton className="h-24" />
        </div>
      ) : loadState === "signed-out" || !available ? (
        <WorkCard>
          <WorkEmpty
            icon={LogIn}
            title="Sign in to make a credential pack"
            body="It uses your own records and the numbers saved on this device."
            testId="admin-credential-pack-signed-out"
          />
        </WorkCard>
      ) : ready && sections.length === 0 ? (
        <WorkCard padded>
          <p className="text-sm text-[color:var(--text-muted)]" data-testid="admin-credential-pack-empty">
            Nothing to put in a pack yet. Add your registration numbers on{" "}
            <Link href="/admin/new-job" className="underline">
              New job
            </Link>{" "}
            and your renewal dates in{" "}
            <Link href="/admin/renewals" className="underline">
              Renewals
            </Link>
            .
          </p>
        </WorkCard>
      ) : ready ? (
        <>
          <section className={cn(adminStyles.section, "print:hidden")} aria-labelledby="pack-choose">
            <WorkSectionLabel id="pack-choose">Choose what goes in</WorkSectionLabel>
            <ul className="work-card work-rows" data-testid="admin-credential-pack-choose">
              {sections.flatMap((section) =>
                section.rows.map((row) => {
                  const on = !excluded.has(row.key);
                  return (
                    <li key={row.key}>
                      {/* The whole row is the switch, so the tap target is the full width. */}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        onClick={() => toggle(row.key, !on)}
                        className={cn(focusRing, "work-row w-full text-left")}
                        data-testid={`admin-credential-pack-include-${row.key}`}
                      >
                        <span className="work-row__text">
                          <span className="work-row__title">{row.title}</span>
                          <span className="work-row__sub tabular-nums">{row.value}</span>
                        </span>
                        <ToggleSwitch enabled={on} />
                      </button>
                    </li>
                  );
                }),
              )}
            </ul>
          </section>

          {/* Only this section prints: the shared print rule hides the app around `data-print-output`. */}
          <section
            className={adminStyles.section}
            aria-label="Preview"
            data-testid="admin-credential-pack-preview"
            data-print-output
          >
            <div data-print-hide>
              <WorkSectionLabel>Preview</WorkSectionLabel>
            </div>
            <p className="hidden text-base font-semibold text-[color:var(--text-heading)] print:block">
              {`Credential pack · ${formatDateEcho(perthCalendarDate(now))}`}
            </p>
            {nothingIncluded ? (
              <WorkCard padded>
                <p className="text-sm text-[color:var(--text-muted)]">
                  Nothing switched on. Switch on at least one line to make a pack.
                </p>
              </WorkCard>
            ) : (
              <div className={adminStyles.paper}>
                {included.map((section) => (
                  <div key={section.label} className="grid gap-1">
                    <h3 className="text-sm font-semibold text-[color:var(--text-heading)]">{section.label}</h3>
                    <dl className="grid gap-1.5">
                      {section.rows.map((row) => (
                        <div key={row.key} data-testid={`admin-credential-pack-row-${row.key}`}>
                          <dt className="text-xs text-[color:var(--text-muted)]">{row.title}</dt>
                          <dd className="tabular-nums break-words text-sm font-medium text-[color:var(--text-heading)]">
                            {row.value}
                          </dd>
                          {row.lines.map((line) => (
                            <dd key={line} className="text-xs text-[color:var(--text-muted)]">
                              {line}
                            </dd>
                          ))}
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
                <p className="text-xs text-[color:var(--text-muted)]" data-testid="admin-credential-pack-note">
                  {CREDENTIAL_PACK_NOTE}
                </p>
              </div>
            )}
          </section>

          <div className="print:hidden">
            <AdminNote testId="admin-credential-pack-privacy">
              Made on this device from your own records. Nothing is uploaded. Check every line before you send it, and
              switch off anything the employer has not asked for. Save as PDF opens your browser&apos;s print screen.
              Choose Save as PDF there, or share from it.
            </AdminNote>
          </div>

          <div className="print:hidden" data-testid="admin-credential-pack-actions">
            <WorkDock aria-label="Pack actions">
              <WorkButton
                variant="primary"
                icon={FileDown}
                onClick={() => window.print()}
                disabled={nothingIncluded}
                testId="admin-credential-pack-pdf"
              >
                Save as PDF
              </WorkButton>
              {canShare ? (
                <WorkButton
                  variant="secondary"
                  icon={Share2}
                  onClick={share}
                  disabled={nothingIncluded}
                  testId="admin-credential-pack-share"
                >
                  Share
                </WorkButton>
              ) : null}
              <WorkButton
                variant="secondary"
                icon={Copy}
                onClick={copy}
                disabled={nothingIncluded}
                testId="admin-credential-pack-copy"
              >
                {sendState === "copied" ? "Copied" : sendState === "failed" ? "Could not copy" : "Copy"}
              </WorkButton>
            </WorkDock>
            <span className="sr-only" role="status" aria-live="polite">
              {sendState === "copied" ? "Copied" : sendState === "failed" ? "Could not copy" : ""}
            </span>
          </div>
        </>
      ) : null}
    </AdminPage>
  );
}
