"use client";

import dynamic from "next/dynamic";
import { ClipboardList, Copy, FileText } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { useAccountData } from "@/components/account-data-provider";
import {
  AdminCallButton,
  AdminNote,
  AdminPage,
  AdminRow,
  AdminSection,
  AdminSkeleton,
  adminStyles,
} from "@/components/admin/admin-kit";
import { AdminCredentialsWallet } from "@/components/admin/admin-credentials-wallet";
import { AdminNavHeader } from "@/components/admin/admin-nav-header";
import { ADMIN_NEW_JOB_SECTIONS } from "@/components/admin/admin-page-sections";
import { AdminShowAll } from "@/components/admin/admin-show-all";
import { AdminStatusIcon } from "@/components/admin/admin-status-tag";
import { AdminNewJobSharing } from "@/components/admin/new-job/admin-new-job-sharing";
import { AdminNewJobStart } from "@/components/admin/new-job/admin-new-job-start";
import { AdminNewJobStepRow } from "@/components/admin/new-job/admin-new-job-step-row";
import { AdminSavedUndoBar } from "@/components/admin/new-job/admin-saved-undo-bar";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { WorkCard, WorkIconCircle, WorkSectionLabel } from "@/components/mode-kit/work";
import { WorkStateNotice } from "@/components/mode-kit/work-state";
import { AdminLoadFailed } from "@/components/admin/admin-load-failed";
import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { cn } from "@/components/ui-primitives";
import { selectNewJobRows } from "@/lib/admin/help-items";
import { selectNewJobStart, setNewJobStart, setNewJobStepDone } from "@/lib/admin/new-job-progress";
import { adminLoadState, selectAdminOwnEntries, selectAdminSharedEntries } from "@/lib/admin/own-entries";
import { displayPhoneNumber } from "@/lib/admin/phone-display";
import { formatRecordedDate, formatUpdatedMonth } from "@/lib/admin/renewal-dates";
import {
  buildComplianceOverview,
  complianceNeedsActionCount,
  type ComplianceOverview,
} from "@/lib/admin/compliance-overview";
import { ADMIN_PAGE_HREFS } from "@/lib/admin/page-hrefs";
import { ADMIN_REQUIREMENTS_CATALOGUE } from "@/lib/admin/requirements";
import { parseApiErrorResponse } from "@/lib/api-client-error";
import { cacheOnCallEntries, isOnCallExampleEntry, useOnCallEntries } from "@/lib/on-call/entry-store";
import { onCallEntrySchema, type OnCallEntry, type OnCallSection } from "@/lib/on-call/entry-model";
import { onCallTelHref } from "@/lib/on-call/home-modules";
import { isOnCallPlaceholderNumber } from "@/lib/on-call/number-resolver";
import { PageTitleUnderBand } from "@/components/mode-band/mode-band";
import { ReadyForDayOneEntryLink } from "@/components/admin/ready/ready-entry-link";
import { StarterPackEntryLink } from "@/components/admin/starter/starter-pack-entry-link";
import { NewWorkModeOnly } from "@/components/work-mode-launch/work-mode-launch-provider";

/** The On Call entry editor loads on first open and then stays mounted, so its Sheet still returns focus on close. */
const OnCallEntryEditor = dynamic(
  () => import("@/components/on-call/on-call-entry-editor").then((module) => module.OnCallEntryEditor),
  { ssr: false },
);

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

function initialsOf(title: string): string {
  const words = title.split(/\s+/).filter((word) => /^[A-Za-z]/.test(word));
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** A job contact: initials, the name and role, the number, and a round call button. */
function ContactRow({ entry }: { entry: OnCallEntry }) {
  const details =
    typeof entry.details === "object" && entry.details !== null ? (entry.details as Record<string, unknown>) : {};
  const phone = typeof details.phone === "string" ? details.phone : null;
  const telHref = onCallTelHref(phone ?? undefined);
  const placeholder = phone ? isOnCallPlaceholderNumber(phone) : false;
  const display = phone ? displayPhoneNumber(phone, "own-list") : null;
  return (
    <li
      id={onCallEntryAnchorId(entry.id)}
      tabIndex={-1}
      className={adminStyles.rowItem}
      data-testid={`admin-new-job-contact-${entry.slug}`}
    >
      <div className="work-row">
        <span aria-hidden="true" className={adminStyles.initials}>
          {initialsOf(entry.title)}
        </span>
        <span className="work-row__text">
          <span className="work-row__title">{entry.title}</span>
          {entry.subtitle ? <span className="work-row__sub">{entry.subtitle}</span> : null}
          {display && !placeholder ? (
            <a href={telHref ?? `tel:${phone}`} className={cn("work-row__sub tabular-nums", adminStyles.mono)}>
              {display}
            </a>
          ) : display ? (
            <span className={cn("work-row__sub tabular-nums", adminStyles.mono)}>{display}</span>
          ) : null}
          <span className="work-row__sub">
            {entry.lastVerifiedAt ? `Updated ${formatUpdatedMonth(entry.lastVerifiedAt)}` : "No date recorded"}
          </span>
        </span>
      </div>
      {display && !placeholder && telHref ? (
        <div className={adminStyles.rowAction}>
          <AdminCallButton tel={telHref} label={`Call ${entry.title}, ${display}`} />
        </div>
      ) : null}
    </li>
  );
}

/** At most this many item names in the signpost before "and N more". */
const PAPERWORK_NAMES = 4;

function namesLine(titles: readonly string[]): string {
  if (titles.length <= PAPERWORK_NAMES) return titles.join(", ");
  return `${titles.slice(0, PAPERWORK_NAMES).join(", ")} and ${titles.length - PAPERWORK_NAMES} more`;
}

/**
 * One signpost to the paperwork (5 Oct mock-up v2, screen 6): what is still to
 * do before the recorded start date, from the same next-job pass Compliance
 * reads, so the two pages cannot disagree. Without a start date it says what
 * needs action now instead, never "nothing to do".
 */
function needsActionPhrase(count: number): string {
  return `${count} ${count === 1 ? "needs" : "need"} action`;
}

function PaperworkSignpost({ overview }: { readonly overview: ComplianceOverview }) {
  const nextJob = overview.nextJob;
  const toDo = nextJob?.toDo ?? [];
  const needsAction = complianceNeedsActionCount(overview);
  const title = nextJob ? "Paperwork for your next job" : "Paperwork";
  const countLine = nextJob
    ? toDo.length > 0
      ? `${toDo.length} to do before you start, in Compliance`
      : "Nothing due before you start, on the dates you recorded"
    : needsAction > 0
      ? `${needsActionPhrase(needsAction)}, in Compliance`
      : "Nothing needs action on the dates you recorded";
  const alsoLine =
    nextJob && needsAction > 0 && toDo.length < needsAction
      ? `${needsActionPhrase(needsAction)} in Compliance overall.`
      : null;
  return (
    <WorkCard as="ul">
      <AdminRow
        lead={
          nextJob && toDo.length > 0 ? (
            <AdminStatusIcon status="start-renewing" />
          ) : (
            <WorkIconCircle icon={ClipboardList} />
          )
        }
        title={title}
        href={ADMIN_PAGE_HREFS.compliance}
        testId="admin-new-job-paperwork"
        sub={
          <>
            <span className="block" data-testid="admin-new-job-paperwork-count">
              {countLine}
            </span>
            {nextJob && toDo.length > 0 ? (
              <span className="block" data-testid="admin-new-job-paperwork-names">
                {`Before ${formatRecordedDate(nextJob.startsOn)}: ${namesLine(toDo.map((todo) => todo.item.row.item.title))}`}
              </span>
            ) : null}
            {alsoLine ? (
              <span className="block" data-testid="admin-new-job-paperwork-also">
                {alsoLine}
              </span>
            ) : null}
            <span className="block">Dates you entered, not a check. Your service&apos;s list may differ.</span>
          </>
        }
      />
    </WorkCard>
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
  const [editorMounted, setEditorMounted] = useState(false);
  if (editorState.open && !editorMounted) setEditorMounted(true);
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
  const overview = useMemo(
    () => buildComplianceOverview(ADMIN_REQUIREMENTS_CATALOGUE, own, now, start?.startsOn ?? null),
    [own, now, start?.startsOn],
  );
  const ownLogins = rows.logins.filter((row) => row.source === "you");
  const doneCount = ownLogins.filter((row) => {
    const details = row.entry.details;
    return typeof details === "object" && details !== null && (details as { done?: unknown }).done === true;
  }).length;
  const totalCount = ownLogins.length;
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
    if (isOnCallExampleEntry(entry)) return;
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
      <AdminPage testId="admin-new-job-main">
        <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
          New job
        </PageTitleUnderBand>
        <AdminNavHeader title="New job" sections={ADMIN_NEW_JOB_SECTIONS} />

        <AdminNewJobStart
          startsOn={start?.startsOn ?? null}
          now={now}
          canEdit={loadState === "ready" && !state.demoMode && isAuthenticated && Boolean(startEntry)}
          readOnlyReason={startReadOnlyReason}
          onSignIn={() => setSignInOpen(true)}
          onSave={handleSetStart}
          onClear={() => void handleClearStart()}
          done={doneCount}
          total={totalCount}
        />

        {toggleError ? (
          <WorkCard padded>
            <p role="alert" className="work-row__sub m-0" data-testid="admin-new-job-error">
              {toggleError}
            </p>
          </WorkCard>
        ) : null}

        {loadState === "failed" ? (
          <AdminLoadFailed reason={state.loadError} onRetry={retry} testId="admin-new-job-load-failed" />
        ) : loadState === "loading" ? (
          // Design point 11: skeletons while loading, never "Nothing here yet".
          <div className={adminStyles.column} data-testid="admin-new-job-loading" aria-busy="true">
            <span className="sr-only">Loading New job</span>
            <AdminSkeleton className="h-16" />
            <AdminSkeleton className="h-56" />
          </div>
        ) : loadState === "signed-out" ? (
          <WorkStateNotice
            kind="signed-out"
            title="Sign in to see your New job records"
            body="They are kept for your signed-in account only."
            onSignIn={() => setSignInOpen(true)}
            testId="admin-new-job-signed-out"
          />
        ) : (
          <>
            <section
              id="admin-new-job-before"
              aria-labelledby="admin-new-job-before-heading"
              className={cn(inPageAnchor, adminStyles.column)}
            >
              <h2 id="admin-new-job-before-heading" className="sr-only">
                Before
              </h2>

              {/* Ready for day one (round 2 feature 21): what is recorded and what is still to do. */}
              <NewWorkModeOnly>
                <ReadyForDayOneEntryLink />
              </NewWorkModeOnly>

              <PaperworkSignpost overview={overview} />

              <AdminSection
                as="h3"
                label="Before · logins and access"
                count={
                  // The count sits beside its own label, once: no second "Logins and access" line under it.
                  totalCount > 0 ? (
                    <span data-testid="admin-new-job-progress">{`${doneCount} of ${totalCount} done`}</span>
                  ) : undefined
                }
              >
                {rows.logins.length === 0 ? (
                  <WorkCard padded>
                    <p className="work-row__sub m-0">
                      Nothing here yet. Your service&apos;s logins and access items appear here once your service is set
                      up in Admin.
                    </p>
                  </WorkCard>
                ) : (
                  <AdminShowAll
                    items={rows.logins}
                    label="Logins and access"
                    testId="admin-new-job-logins"
                    listClassName="work-card work-rows"
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
              </AdminSection>

              {/* Share with Medical Workforce (owner request 10 Oct 2026): off until the doctor turns it
                  on. Not behind the new work mode switch, so it can always be turned off again. */}
              {isAuthenticated && !state.demoMode ? <AdminNewJobSharing /> : null}

              {/* The credentials wallet moved here from Today (work-mode redesign,
                  owner request 6 Oct 2026), beside the pack it feeds. */}
              {isAuthenticated && !state.demoMode ? <AdminCredentialsWallet /> : null}

              {/* The starter pack (round 2 feature 14), above the contacts as the spec places it. */}
              <NewWorkModeOnly>
                <StarterPackEntryLink />
              </NewWorkModeOnly>

              <AdminSection as="h3" label="Contacts for this job" count={rows.contacts.length || undefined}>
                {rows.contacts.length === 0 ? (
                  <WorkCard padded>
                    <p className="work-row__sub m-0">Nothing recorded yet.</p>
                  </WorkCard>
                ) : (
                  <WorkCard as="ul" testId="admin-new-job-contacts">
                    {rows.contacts.map((entry) => (
                      <ContactRow key={entry.id} entry={entry} />
                    ))}
                  </WorkCard>
                )}
              </AdminSection>
            </section>

            <section
              id="admin-new-job-leaving"
              aria-labelledby="admin-new-job-leaving-heading"
              className={cn(inPageAnchor, adminStyles.section)}
            >
              <WorkSectionLabel id="admin-new-job-leaving-heading">Leaving</WorkSectionLabel>
              <WorkCard as="ul">
                {/* One tappable row: the explanation and the way to Your Admin records. */}
                <AdminRow
                  lead={<WorkIconCircle icon={Copy} />}
                  href="/admin/new-job/records"
                  testId="admin-new-job-records-link"
                  title="Your Admin records"
                  sub={
                    <>
                      <span data-testid="admin-new-job-leaving-notice">Changing site or starting a new job? </span>
                      <span data-testid="admin-new-job-leaving-checklist">
                        Registration numbers and renewal dates, contacts and logins you saved, and New job ticks.
                      </span>
                    </>
                  }
                />
                <AdminRow
                  lead={<WorkIconCircle icon={FileText} />}
                  href="/admin/new-job/pack"
                  testId="admin-new-job-leaving-pack-link"
                  title="Credential pack"
                  sub="As a PDF on this device"
                />
              </WorkCard>
              <AdminNote>Hospital files and patient information are never included.</AdminNote>
            </section>
          </>
        )}
      </AdminPage>

      {/* Mounted only where a sign-in control is offered (it needs the auth provider, as on Today). */}
      {startReadOnlyReason === "signed-out" || loadState === "signed-out" ? (
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

      {editorMounted ? (
        <OnCallEntryEditor
          open={editorState.open}
          onClose={() => setEditorState((current) => ({ ...current, open: false }))}
          section={editorState.section}
          entry={editorState.entry}
          onSaved={upsertCachedEntry}
          onDeleted={removeCachedEntry}
        />
      ) : null}
    </>
  );
}
