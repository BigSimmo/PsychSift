"use client";

import Link from "next/link";
import { ChevronRight, Copy, FileDown } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { useAccountData } from "@/components/account-data-provider";
import { AdminNavHeader } from "@/components/admin/admin-nav-header";
import { ADMIN_NEW_JOB_SECTIONS } from "@/components/admin/admin-page-sections";
import { AdminShowAll } from "@/components/admin/admin-show-all";
import { AdminNewJobStart } from "@/components/admin/new-job/admin-new-job-start";
import { AdminNewJobStepRow } from "@/components/admin/new-job/admin-new-job-step-row";
import { AdminSavedUndoBar } from "@/components/admin/new-job/admin-saved-undo-bar";
import { cardSurface, focusRing } from "@/components/card-recipes";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { OnCallEntryEditor } from "@/components/on-call/on-call-entry-editor";
import { AdminLoadFailed } from "@/components/admin/admin-load-failed";
import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import { Button } from "@/components/ui/button";
import { selectNewJobRows } from "@/lib/admin/help-items";
import { selectNewJobStart, setNewJobStart, setNewJobStepDone } from "@/lib/admin/new-job-progress";
import { adminLoadState, selectAdminOwnEntries, selectAdminSharedEntries } from "@/lib/admin/own-entries";
import { displayPhoneNumber } from "@/lib/admin/phone-display";
import { formatUpdatedMonth } from "@/lib/admin/renewal-dates";
import { parseApiErrorResponse } from "@/lib/api-client-error";
import { cacheOnCallEntries, useOnCallEntries } from "@/lib/on-call/entry-store";
import { onCallEntrySchema, type OnCallEntry, type OnCallSection } from "@/lib/on-call/entry-model";
import { onCallTelHref } from "@/lib/on-call/home-modules";

type UndoState = { id: number; entryId: string; restore: unknown; label: string };

async function patchEntry(id: string, body: unknown): Promise<OnCallEntry> {
  const response = await fetch(`/api/on-call/entries/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await parseApiErrorResponse(response);
  const json: unknown = await response.json();
  const parsed = onCallEntrySchema.safeParse((json as { entry?: unknown } | null)?.entry);
  if (!parsed.success) throw new Error("Save response was invalid.");
  return parsed.data;
}

function ContactRow({ entry }: { entry: OnCallEntry }) {
  const details =
    typeof entry.details === "object" && entry.details !== null ? (entry.details as Record<string, unknown>) : {};
  const phone = typeof details.phone === "string" ? details.phone : null;
  const telHref = onCallTelHref(phone ?? undefined);
  return (
    <li
      id={onCallEntryAnchorId(entry.id)}
      tabIndex={-1}
      className="grid min-w-0 gap-0.5 border-b border-[color:var(--border)] px-3 py-2 last:border-b-0"
      data-testid={`admin-new-job-contact-${entry.slug}`}
    >
      <span className="break-words text-sm font-medium text-[color:var(--text-heading)]">{entry.title}</span>
      {entry.subtitle ? <span className={cn(textMuted, "text-sm")}>{entry.subtitle}</span> : null}
      {phone ? (
        <a href={telHref ?? `tel:${phone}`} className="nums inline w-fit text-sm text-[color:var(--text)]">
          {displayPhoneNumber(phone, "own-list")}
        </a>
      ) : null}
      <span className={cn(textMuted, "text-xs")}>
        {entry.lastVerifiedAt ? `Updated ${formatUpdatedMonth(entry.lastVerifiedAt)}` : "No date recorded"}
      </span>
    </li>
  );
}

/**
 * New job (Admin update 1, Task 8): Before (own and shared logins/access,
 * plus the job's contacts) and Leaving (an unsaved reminder list ending with
 * "Your Admin records"). Order, not weeks, is what the page shows (owner
 * decision) — there is no week strip.
 */
export function AdminNewJobPage({ now: nowProp }: { now?: Date } = {}) {
  const { isAuthenticated } = useAccountData();
  const state = useOnCallEntries();
  const { entries, retry } = state;
  const mountedAt = useMemo(() => new Date(), []);
  const now = nowProp ?? mountedAt;
  const [editorState, setEditorState] = useState<{ open: boolean; entry: OnCallEntry | null; section: OnCallSection }>({
    open: false,
    entry: null,
    section: "logistics",
  });
  const [undo, setUndo] = useState<UndoState | null>(null);
  const nextUndoId = useRef(0);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);

  const own = useMemo(() => selectAdminOwnEntries(state), [state]);
  const shared = useMemo(() => selectAdminSharedEntries(state), [state]);
  const loadState = adminLoadState(state);
  const rows = useMemo(() => selectNewJobRows({ own, shared }), [own, shared]);
  // The page's own start line: shown for as long as a date is stored (Today
  // hides it a week in; this page does not), read from the row that holds it.
  const start = selectNewJobStart({ own, shared });
  const ownLogins = rows.logins.filter((row) => row.source === "you");
  const doneCount = ownLogins.filter((row) => {
    const details = row.entry.details;
    return typeof details === "object" && details !== null && (details as { done?: unknown }).done === true;
  }).length;
  const totalCount = ownLogins.length;
  const leftCount = totalCount - doneCount;
  // Write to the row the date is read from, so a new or cleared date is never ignored.
  const startEntry = start?.entry ?? ownLogins[0]?.entry ?? null;
  // Why the start date cannot be set, said under the start line. Example
  // records win (signing in does not make them editable); nothing is claimed
  // while loading or after a failed load.
  const startReadOnlyReason: "signed-out" | "demo" | null =
    loadState === "ready" && state.demoMode
      ? "demo"
      : loadState === "signed-out" || (loadState === "ready" && !isAuthenticated)
        ? "signed-out"
        : null;

  function upsertCachedEntry(entry: OnCallEntry) {
    const next = entries.some((existing) => existing.id === entry.id)
      ? entries.map((existing) => (existing.id === entry.id ? entry : existing))
      : [...entries, entry];
    cacheOnCallEntries(next);
  }

  function removeCachedEntry(id: string) {
    cacheOnCallEntries(entries.filter((existing) => existing.id !== id));
  }

  async function handleToggle(entry: OnCallEntry, done: boolean) {
    setToggleError(null);
    const update = setNewJobStepDone(entry, done);
    try {
      const saved = await patchEntry(entry.id, update.body);
      upsertCachedEntry(saved);
      setUndo({ id: ++nextUndoId.current, entryId: entry.id, restore: update.undo, label: "Saved" });
    } catch (error) {
      setToggleError(error instanceof Error ? error.message : "Could not save this change.");
    }
  }

  async function handleUndo() {
    if (!undo) return;
    const { entryId, restore } = undo;
    setUndo(null);
    try {
      const saved = await patchEntry(entryId, restore);
      upsertCachedEntry(saved);
    } catch (error) {
      setToggleError(error instanceof Error ? error.message : "Could not undo that change.");
    }
  }

  async function handleSetStart(date: string): Promise<boolean> {
    if (!startEntry) return false;
    const result = setNewJobStart(startEntry, date);
    if (!result.ok) return false;
    try {
      const saved = await patchEntry(startEntry.id, result.body);
      upsertCachedEntry(saved);
      setUndo({ id: ++nextUndoId.current, entryId: startEntry.id, restore: result.undo, label: "Saved" });
      return true;
    } catch (error) {
      setToggleError(error instanceof Error ? error.message : "Could not save the start date.");
      return false;
    }
  }

  async function handleClearStart() {
    if (!startEntry) return;
    const result = setNewJobStart(startEntry, null);
    if (!result.ok) return;
    try {
      const saved = await patchEntry(startEntry.id, result.body);
      upsertCachedEntry(saved);
      setUndo({ id: ++nextUndoId.current, entryId: startEntry.id, restore: result.undo, label: "Saved" });
    } catch (error) {
      setToggleError(error instanceof Error ? error.message : "Could not clear the start date.");
    }
  }

  return (
    <>
      <AdminNavHeader title="New job" sections={ADMIN_NEW_JOB_SECTIONS} />
      <InformationPageShell testId="admin-new-job-main">
        <h1 className="text-2xl font-semibold text-[color:var(--text-heading)]">New job</h1>

        <AdminNewJobStart
          startsOn={start?.startsOn ?? null}
          now={now}
          canEdit={loadState === "ready" && !state.demoMode && isAuthenticated && Boolean(startEntry)}
          readOnlyReason={startReadOnlyReason}
          onSignIn={() => setSignInOpen(true)}
          onSave={handleSetStart}
          onClear={() => void handleClearStart()}
        />

        {toggleError ? (
          <p role="alert" className="text-sm text-[color:var(--text)]" data-testid="admin-new-job-error">
            {toggleError}
          </p>
        ) : null}

        {loadState === "failed" ? (
          <AdminLoadFailed reason={state.loadError} onRetry={retry} testId="admin-new-job-load-failed" />
        ) : loadState === "loading" ? (
          // Design point 11: skeletons while loading, never "Nothing here yet".
          <ModeModuleSkeleton rows={5} twoLine eyebrow testId="admin-new-job-loading" />
        ) : loadState === "signed-out" ? (
          <div data-testid="admin-new-job-signed-out">
            <p>Sign in to see your New job records. They are kept for your signed-in account only.</p>
            <Button variant="primary" onClick={() => setSignInOpen(true)}>
              Sign in
            </Button>
          </div>
        ) : (
          <>
            <section
              id="admin-new-job-before"
              aria-labelledby="admin-new-job-before-heading"
              className={cn(inPageAnchor, "grid gap-3")}
            >
              <h2 id="admin-new-job-before-heading" className={eyebrowText}>
                Before
              </h2>

              {totalCount > 0 ? (
                <p
                  className="text-sm font-medium text-[color:var(--text-heading)]"
                  data-testid="admin-new-job-progress"
                >
                  {doneCount} of {totalCount} done
                </p>
              ) : null}

              <div className="grid gap-2">
                <div className="flex items-center justify-between px-1">
                  <h3 className={eyebrowText}>Logins and access</h3>
                  {ownLogins.length > 0 ? (
                    <span className={cn(textMuted, "nums text-xs")} data-testid="admin-new-job-logins-left">
                      {leftCount} left
                    </span>
                  ) : null}
                </div>
                {rows.logins.length === 0 ? (
                  <p className={cn(textMuted, "text-sm")}>
                    Nothing here yet. Your service&apos;s logins and access items appear here once your service is set
                    up in Admin.
                  </p>
                ) : (
                  <AdminShowAll
                    items={rows.logins}
                    label="Logins and access"
                    testId="admin-new-job-logins"
                    anchorIdOf={(row) => onCallEntryAnchorId(row.entry.id)}
                    renderItem={(row) => (
                      <AdminNewJobStepRow
                        key={row.entry.id}
                        entry={row.entry}
                        source={row.source}
                        onToggle={row.source === "you" && isAuthenticated && !state.demoMode ? handleToggle : undefined}
                        onEdit={
                          row.source === "you" && isAuthenticated && !state.demoMode
                            ? (entry) => setEditorState({ open: true, entry, section: entry.section })
                            : undefined
                        }
                      />
                    )}
                  />
                )}
              </div>

              <div className="grid gap-2">
                <h3 className={eyebrowText}>Contacts for this job</h3>
                {rows.contacts.length === 0 ? (
                  <p className={cn(textMuted, "text-sm")}>Nothing recorded yet.</p>
                ) : (
                  <ul className={cn(cardSurface, "overflow-hidden")} data-testid="admin-new-job-contacts">
                    {rows.contacts.map((entry) => (
                      <ContactRow key={entry.id} entry={entry} />
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section
              id="admin-new-job-credential-pack"
              aria-labelledby="admin-new-job-credential-pack-heading"
              className={cn(inPageAnchor, "grid gap-3")}
            >
              <h2 id="admin-new-job-credential-pack-heading" className={eyebrowText}>
                For your new employer
              </h2>
              <Link
                href="/admin/new-job/pack"
                data-testid="admin-new-job-credential-pack-link"
                className={cn(
                  cardSurface,
                  focusRing,
                  "flex min-h-12 items-center gap-2 px-3 py-2.5 no-underline text-[color:var(--text-heading)]",
                )}
              >
                <FileDown aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="text-sm font-medium">Credential pack</span>
                  <span className={cn(textMuted, "text-xs")}>
                    Registration numbers and renewal dates as one PDF, made on this device
                  </span>
                </span>
                <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
              </Link>
            </section>
            <section
              id="admin-new-job-leaving"
              aria-labelledby="admin-new-job-leaving-heading"
              className={cn(inPageAnchor, "grid gap-3")}
            >
              <h2 id="admin-new-job-leaving-heading" className={eyebrowText}>
                Leaving
              </h2>
              {/* One tappable card: the explanation and the way to Your Admin records. */}
              <Link
                href="/admin/new-job/records"
                data-testid="admin-new-job-records-link"
                className={cn(
                  cardSurface,
                  focusRing,
                  "flex min-h-12 items-center gap-2 px-3 py-2.5 no-underline text-[color:var(--text-heading)]",
                )}
              >
                <Copy aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="text-sm text-[color:var(--text)]" data-testid="admin-new-job-leaving-notice">
                    When you leave, your records go with you. Open Your Admin records to copy or print them.
                  </span>
                  <span className="text-sm font-medium">Your Admin records</span>
                  <span className={cn(textMuted, "text-xs")}>Renewals, history and New job ticks</span>
                </span>
                <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
              </Link>
            </section>
          </>
        )}
      </InformationPageShell>

      {/* Mounted only where a sign-in control is offered (it needs the auth provider, as on Today). */}
      {startReadOnlyReason === "signed-out" ? (
        <AccountSetupDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
      ) : null}

      {undo ? (
        <AdminSavedUndoBar
          key={undo.id}
          label={undo.label}
          onUndo={() => void handleUndo()}
          onDismiss={() => setUndo(null)}
          testId="admin-new-job-undo"
        />
      ) : null}

      <OnCallEntryEditor
        open={editorState.open}
        onClose={() => setEditorState((current) => ({ ...current, open: false }))}
        section={editorState.section}
        entry={editorState.entry}
        onSaved={upsertCachedEntry}
        onDeleted={removeCachedEntry}
      />
    </>
  );
}
