"use client";

import { CalendarPlus, Copy, Ellipsis, Plus, RotateCw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AdminLoadAlert,
  AdminPage,
  AdminRow,
  AdminSheet,
  AdminSkeleton,
  adminStyles,
} from "@/components/admin/admin-kit";
import { AdminQuickAddSheet } from "@/components/admin/admin-quick-add-sheet";
import { AdminRenewedSheet } from "@/components/admin/admin-renewed-sheet";
import { catalogueItemForEntry, isPersonalRenewal } from "@/components/admin/renewals/catalogue-lookup";
import { ChecklistList, type RecordDatesSlot } from "@/components/admin/renewals/checklist-list";
import {
  CHECKLIST_KIND_FILTERS,
  ChecklistKindChips,
  type ChecklistKindFilter,
} from "@/components/admin/renewals/kind-chips";
import { ChecklistItemDetailSheet, type ChecklistItemSubject } from "@/components/admin/renewals/item-detail-sheet";
import { ChecklistAtAGlance } from "@/components/admin/renewals/checklist-summary";
import { RenewNextCard } from "@/components/admin/renewals/renew-next-card";
import { PersonalRenewalsList } from "@/components/admin/renewals/personal-list";
import { RecordDatesSheet, type RecordDatesReadOnly } from "@/components/admin/renewals/record-dates-sheet";
import { RenewalsShowFilterList } from "@/components/admin/renewals/show-filter-list";
import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { ModeBandAction, PageTitleUnderBand, useModeBandHeading } from "@/components/mode-band/mode-band";
import { WorkButton, WorkCard, WorkDock, WorkGlassButton, WorkIconCircle } from "@/components/mode-kit/work";
import { WorkStateNotice } from "@/components/mode-kit/work-state";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { announce } from "@/components/ui/live-announcer";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { complianceBucket, complianceBucketCounts, type ComplianceBucket } from "@/lib/admin/compliance-overview";
import { renewNext } from "@/lib/admin/renew-next";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { downloadTextFile } from "@/lib/admin/download-file";
import {
  buildIssuerCheckStampBody,
  buildNotForThisJobCreateBody,
  buildNotForThisJobToggleBody,
  buildRestoreEntryBody,
  renewalsCalendarFile,
  workforceCopyText,
} from "@/lib/admin/renewals";
import {
  ADMIN_REQUIREMENTS_CATALOGUE,
  requirementChecklistRowsForJob,
  requirementsNotForThisJob,
} from "@/lib/admin/requirements";
import { adminLoadState, selectAdminOwnEntries } from "@/lib/admin/own-entries";
import { parseRenewalsShow, RENEWALS_SHOW_LABELS, renewalsShowMatches } from "@/lib/admin/renewals-filters";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { onCallEntrySchema, type OnCallEntry } from "@/lib/on-call/entry-model";
import { cacheOnCallEntries, useOnCallEntries } from "@/lib/on-call/entry-store";
import { parseApiErrorResponse } from "@/lib/api-client-error";
import { guardExampleAction } from "@/lib/example-data/guards";

type CatalogueItem = (typeof ADMIN_REQUIREMENTS_CATALOGUE)[number];
type RenewSubject = { entry: OnCallEntry | null; createItem?: CatalogueItem };

/** Design: "Undo for 10 s" (M9). The bar stays past this while an undo is failing. */
const UNDO_WINDOW_MS = 10_000;

type UndoBar = {
  readonly message: string;
  readonly undo: () => Promise<void>;
  /** Set once an undo attempt failed: the bar then stays, with Retry, until it works or is dismissed. */
  readonly failed?: boolean;
};

/** A failed save that is not an undo ("Move back"): shown as a neutral notice with Retry. */
type FailedAction = { readonly message: string; readonly retry: () => Promise<void> };

/** The page's own path, for clearing a `?show=` filter in place. */
const RENEWALS_PATH = "/admin/renewals";

async function parsedEntry(response: Response): Promise<OnCallEntry> {
  if (!response.ok) throw await parseApiErrorResponse(response);
  const payload: unknown = await response.json();
  const parsed = onCallEntrySchema.safeParse((payload as { entry?: unknown } | null)?.entry);
  if (!parsed.success) throw new Error("Save response was invalid.");
  return parsed.data;
}

/** The detail sheet's subject for one of the reader's rows, or null when it is not a renewal. */
function detailSubjectForEntry(entry: OnCallEntry): ChecklistItemSubject | null {
  const item = catalogueItemForEntry(entry);
  if (item) return { kind: "catalogue", item, entry };
  if (isPersonalRenewal(entry)) return { kind: "personal", entry };
  return null;
}

/** The detail sheet's subject for a catalogue item id, with the reader's row for it if any. */
function detailSubjectForCatalogueItem(id: string, own: readonly OnCallEntry[]): ChecklistItemSubject | null {
  const item = ADMIN_REQUIREMENTS_CATALOGUE.find((candidate) => candidate.id === id);
  if (!item) return null;
  // The same row the checklist shows for it; else one marked not for this job.
  const row = requirementChecklistRowsForJob(ADMIN_REQUIREMENTS_CATALOGUE, own).find(
    (candidate) => candidate.item.id === item.id,
  );
  const entry =
    row?.entry ??
    requirementsNotForThisJob(ADMIN_REQUIREMENTS_CATALOGUE, own).find((flagged) => flagged.item.id === item.id)
      ?.entry ??
    null;
  return { kind: "catalogue", item, entry };
}

/**
 * Renewals (final design, screens-v3): a Checklist tab built from the
 * statewide Requirements catalogue (`src/lib/admin/requirements.ts`), and a
 * Personal tab for the reader's own items that aren't on it. Every fact this
 * page reads was recorded by the reader; nothing is checked with an issuer —
 * see `src/lib/on-call/compliance.ts`, "What this page may never say".
 */
export function AdminRenewalsPage({ now: nowProp }: { now?: Date } = {}) {
  const state = useOnCallEntries();
  const mountedAt = useMemo(() => new Date(), []);
  const now = nowProp ?? mountedAt;
  // `cacheOnCallEntries` (called from `upsert` below) writes through to the
  // shared store; this counter forces a fresh read of `state.entries` right
  // after it does, so a save is reflected on this page immediately rather
  // than waiting on some other, unrelated state change to trigger a render.
  const [entryVersion, setEntryVersion] = useState(0);
  // `entryVersion` is never read inside the callback below; it exists only to
  // force this memo to re-run right after `upsert` writes to the (possibly
  // mocked) shared store, since `state` itself may not change reference on
  // every write.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const own = useMemo(() => selectAdminOwnEntries(state), [state, entryVersion]);
  const loadState = adminLoadState(state);
  const ready = loadState === "ready";
  const canEdit = ready && !state.demoMode;
  const [signInOpen, setSignInOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  // `/admin/renewals?show=…` (Today's at-a-glance counts), `?item=<id>` and
  // `?record=missing` — see the cross-lane URL contract. Unknown values are ignored.
  const showFilter = parseRenewalsShow(searchParams?.get("show"));
  const itemParam = searchParams?.get("item") ?? null;
  const recordParam = searchParams?.get("record") ?? null;
  const [menuOpen, setMenuOpen] = useState(false);
  // The queue the "Record missing dates" sheet steps through, fixed when it
  // opens; null while the sheet is closed.
  const [recordQueue, setRecordQueue] = useState<readonly CatalogueItem[] | null>(null);

  const [tab, setTab] = useState<"checklist" | "personal">("checklist");
  const [kindFilter, setKindFilter] = useState<ChecklistKindFilter>("all");
  const [glance, setGlance] = useState<ComplianceBucket | null>(null);
  const [detailSubject, setDetailSubject] = useState<ChecklistItemSubject | null>(null);
  // `renewSubject` is kept across a close (not nulled) so a dismissed
  // half-filled sheet stays in memory for the same subject, per Addendum A;
  // `renewOpen` is the sheet's own visibility.
  const [renewSubject, setRenewSubject] = useState<RenewSubject | null>(null);
  const [renewOpen, setRenewOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const [undoBar, setUndoBar] = useState<UndoBar | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [failedAction, setFailedAction] = useState<FailedAction | null>(null);

  useEffect(() => {
    if (!undoBar || undoBar.failed) return;
    const timer = setTimeout(() => setUndoBar(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [undoBar]);

  // Items marked not for this job are left out here: they show once, in their own closing section.
  const rows = useMemo(() => requirementChecklistRowsForJob(ADMIN_REQUIREMENTS_CATALOGUE, own), [own]);
  const today = perthCalendarDate(now);
  const bucketCounts = useMemo(
    () => complianceBucketCounts(rows.map((row) => complianceBucket(row, today))),
    [rows, today],
  );
  const next = useMemo(() => renewNext(rows, today), [rows, today]);
  // The same selector Today's "N not for this job" reads, so the two agree.
  const notForThisJob = useMemo(
    () => requirementsNotForThisJob(ADMIN_REQUIREMENTS_CATALOGUE, own).map(({ entry }) => entry),
    [own],
  );
  const personalEntries = useMemo(() => own.filter((entry) => isPersonalRenewal(entry)), [own]);
  const calendarFile = useMemo(() => renewalsCalendarFile(own, now), [own, now]);
  const showMatches = useMemo(
    () => (showFilter ? renewalsShowMatches(own, showFilter, now) : []),
    [own, showFilter, now],
  );
  const notRecordedItems = useMemo(
    () => rows.filter((row) => row.state === "not-recorded").map((row) => row.item),
    [rows],
  );
  const recordReadOnly: RecordDatesReadOnly | null =
    loadState === "signed-out" ? "signed-out" : loadState === "failed" ? "failed" : state.demoMode ? "demo" : null;

  function openRecordDates() {
    setRecordQueue(notRecordedItems);
  }

  function clearShowFilter() {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.delete("show");
    const query = params.toString();
    router.replace(query ? `${RENEWALS_PATH}?${query}` : RENEWALS_PATH, { scroll: false });
  }

  function upsert(entry: OnCallEntry) {
    cacheOnCallEntries([...state.entries.filter((existing) => existing.id !== entry.id), entry]);
    setEntryVersion((version) => version + 1);
    setDetailSubject((current) => {
      if (!current || !current.entry || current.entry.id !== entry.id) return current;
      return current.kind === "catalogue"
        ? { kind: "catalogue", item: current.item, entry }
        : { kind: "personal", entry };
    });
  }

  function removeEntry(id: string) {
    cacheOnCallEntries(state.entries.filter((existing) => existing.id !== id));
    setEntryVersion((version) => version + 1);
  }

  async function setIssuerCheck(entry: OnCallEntry, checkedOn: string | null) {
    const result = buildIssuerCheckStampBody(entry, checkedOn);
    if (!result.ok) throw new Error("Use the date as YYYY-MM-DD.");
    const saved = await parsedEntry(
      await fetch(`/api/on-call/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.body),
      }),
    );
    upsert(saved);
  }

  // A link to one entry (`/admin/renewals#on-call-entry-<id>`: Today's
  // "Renewed", Needs you, an old `/on-call/compliance#…` bookmark) opens that
  // entry's detail sheet once the reader's rows have loaded, so "Renewed" is
  // the next tap. Each hash opens once; a later hashchange opens the new one.
  const openedHash = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    function openFromHash() {
      const hash = window.location.hash.slice(1);
      if (openedHash.current === hash) return;
      // Compliance's group rows link to `#admin-renewals-group-<group>`. The
      // list renders after the rows load, too late for the browser's own jump,
      // so scroll to the group once it is drawn.
      if (hash.startsWith("admin-renewals-group-")) {
        openedHash.current = hash;
        setTab("checklist");
        const group = hash.slice("admin-renewals-group-".length);
        if ((CHECKLIST_KIND_FILTERS as readonly string[]).includes(group)) {
          setKindFilter(group as ChecklistKindFilter);
        }
        requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block: "start" }));
        return;
      }
      if (!hash.startsWith("on-call-entry-")) return;
      const entry = own.find((candidate) => onCallEntryAnchorId(candidate.id) === hash);
      if (!entry) return;
      const subject = detailSubjectForEntry(entry);
      if (!subject) return;
      openedHash.current = hash;
      setTab(subject.kind === "catalogue" ? "checklist" : "personal");
      setDetailSubject(subject);
    }
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [ready, own]);

  // `?item=<entry id or catalogue item id>` (Today's "Coming up" rows) opens
  // that item's detail sheet once the reader's rows have loaded, once per id.
  const openedItem = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !itemParam || openedItem.current === itemParam) return;
    function openFromItemParam(id: string) {
      const entry = own.find((candidate) => candidate.id === id);
      const subject = entry ? detailSubjectForEntry(entry) : detailSubjectForCatalogueItem(id, own);
      if (!subject) return;
      openedItem.current = id;
      setTab(subject.kind === "catalogue" ? "checklist" : "personal");
      setDetailSubject(subject);
    }
    openFromItemParam(itemParam);
  }, [ready, own, itemParam]);

  // `?record=missing` opens "Record missing dates" once the load settles —
  // on a read-only page it opens too, and says why it cannot save. It opens
  // once per settled state, so after that sheet's Sign in or Retry turns the
  // page ready it opens again with the refreshed queue.
  const openedRecordFor = useRef<typeof loadState | null>(null);
  useEffect(() => {
    if (recordParam !== "missing" || loadState === "loading") return;
    if (openedRecordFor.current === loadState || openedRecordFor.current === "ready") return;
    function openFromRecordParam(queue: readonly CatalogueItem[]) {
      openedRecordFor.current = loadState;
      setRecordQueue(queue);
    }
    openFromRecordParam(notRecordedItems);
  }, [recordParam, loadState, notRecordedItems]);

  async function runUndo(bar: UndoBar) {
    setUndoBusy(true);
    try {
      await bar.undo();
      setUndoBar(null);
    } catch {
      // Spec "Offline" / design point 11: a failed save stays on screen with Retry.
      setUndoBar({ ...bar, failed: true });
    } finally {
      setUndoBusy(false);
    }
  }

  async function moveBack(entry: OnCallEntry) {
    setFailedAction(null);
    try {
      await setNotForThisJob(entry, false);
    } catch {
      setFailedAction({ message: `Couldn't move back ${entry.title}.`, retry: () => moveBack(entry) });
    }
  }

  async function copyForWorkforce() {
    if (!guardExampleAction(state.demoMode, "copy")) return;
    const text = workforceCopyText(own, now);
    try {
      await copyTextToClipboard(text);
      setCopy("copied");
      announce("Copied for workforce", { eventId: "admin-renewals-copy" });
    } catch {
      setCopy("failed");
      announce("Couldn't copy. The text is shown below to copy by hand.", { eventId: "admin-renewals-copy" });
    }
  }

  function downloadAll() {
    if (!guardExampleAction(state.demoMode, "export")) return;
    if (calendarFile) downloadTextFile(calendarFile, "renewals.ics", "text/calendar;charset=utf-8");
  }

  async function setNotForThisJob(entry: OnCallEntry, flag: boolean) {
    const saved = await parsedEntry(
      await fetch(`/api/on-call/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildNotForThisJobToggleBody(entry, flag)),
      }),
    );
    upsert(saved);
    setUndoBar({
      message: flag ? `Not for this job · ${entry.title}` : `Moved back · ${entry.title}`,
      undo: async () => {
        const restored = await parsedEntry(
          await fetch(`/api/on-call/entries/${entry.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildRestoreEntryBody(entry)),
          }),
        );
        upsert(restored);
      },
    });
  }

  /** "Not for this job" on a catalogue item never recorded: a minimal row, and Undo deletes it. */
  async function markItemNotForThisJob(item: CatalogueItem) {
    const created = await parsedEntry(
      await fetch("/api/on-call/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildNotForThisJobCreateBody(item, crypto.randomUUID().slice(0, 6))),
      }),
    );
    upsert(created);
    setUndoBar({
      message: `Not for this job · ${item.title}`,
      undo: async () => {
        const response = await fetch(`/api/on-call/entries/${created.id}`, { method: "DELETE" });
        if (!response.ok) throw await parseApiErrorResponse(response);
        removeEntry(created.id);
      },
    });
  }

  function addDate(item: CatalogueItem) {
    setRenewSubject({ entry: null, createItem: item });
    setRenewOpen(true);
  }

  const recordDatesSlot: RecordDatesSlot | undefined = canEdit
    ? { kind: "button", onOpen: openRecordDates }
    : state.demoMode
      ? { kind: "note", text: "Example records are read-only" }
      : undefined;

  const filteredLabel = showFilter ? RENEWALS_SHOW_LABELS[showFilter] : null;
  useModeBandHeading({
    eyebrow: filteredLabel ? `Showing ${filteredLabel}` : "Medical Board and WA Health · checked 26 Sep",
  });

  const recordDatesInDock = canEdit && tab === "checklist" && notRecordedItems.length > 0;

  return (
    <AdminPage testId="admin-renewals-main">
      <PageTitleUnderBand className="sr-only">Renewals</PageTitleUnderBand>
      {ready ? (
        <ModeBandAction>
          {(underBand) => (
            <WorkGlassButton
              icon={Ellipsis}
              label="More actions"
              onClick={() => setMenuOpen(true)}
              className={underBand ? "work-band__action" : undefined}
              testId="admin-renewals-more"
            />
          )}
        </ModeBandAction>
      ) : null}

      {loadState === "loading" ? (
        <div className={adminStyles.column} data-testid="admin-renewals-loading" aria-busy="true">
          <span className="sr-only">Loading your renewals</span>
          <AdminSkeleton className="h-10" />
          <AdminSkeleton className="h-48" />
          <AdminSkeleton className="h-64" />
        </div>
      ) : loadState === "failed" ? (
        <AdminLoadAlert
          title="Couldn't load your renewals"
          body="Check your connection and try again. Nothing is shown until your own records load."
          onRetry={state.retry}
          retryTestId="admin-renewals-retry"
          testId="admin-renewals-failed"
        />
      ) : loadState === "signed-out" ? (
        <>
          <WorkStateNotice
            kind="signed-out"
            title="Sign in to see your renewals"
            body="Renewals are kept for your signed-in account only."
            onSignIn={() => setSignInOpen(true)}
            testId="admin-renewals-signed-out"
          />
          <AccountSetupDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
        </>
      ) : (
        <>
          <SegmentedControl
            label="Renewals"
            value={tab}
            onChange={setTab}
            layout="equal"
            options={[
              { value: "checklist", label: "Checklist" },
              { value: "personal", label: "Personal" },
            ]}
          />

          {failedAction ? (
            <WorkCard padded testId="admin-renewals-action-failed">
              <div className="flex flex-wrap items-center justify-between gap-2" role="alert">
                <span className="work-row__title">{failedAction.message}</span>
                <WorkButton variant="secondary" icon={RotateCw} onClick={() => void failedAction.retry()}>
                  Retry
                </WorkButton>
              </div>
            </WorkCard>
          ) : null}

          {tab === "checklist" ? (
            <>
              <RenewNextCard
                next={next}
                notRecorded={bucketCounts["not-recorded"]}
                rows={rows}
                now={now}
                onOpen={(row) => setDetailSubject({ kind: "catalogue", item: row.item, entry: row.entry })}
                onShowAll={() => {
                  setGlance(null);
                  setKindFilter("all");
                  requestAnimationFrame(() =>
                    document.getElementById("admin-renewals-checklist")?.scrollIntoView({ block: "start" }),
                  );
                }}
              />
              <ChecklistAtAGlance
                rows={rows}
                counts={bucketCounts}
                total={rows.length}
                notForThisJob={notForThisJob.length}
                now={now}
                active={glance}
                onFilter={setGlance}
                testId="admin-renewals-summary"
              />
              {showFilter ? (
                <RenewalsShowFilterList
                  filter={showFilter}
                  matches={showMatches}
                  now={now}
                  canEdit={canEdit}
                  onClear={clearShowFilter}
                  onOpenCatalogue={(item, entry) => setDetailSubject({ kind: "catalogue", item, entry })}
                  onOpenPersonal={(entry) => setDetailSubject({ kind: "personal", entry })}
                  onAddDate={addDate}
                  onRecordDates={
                    // The workflow steps through catalogue items only; an undated
                    // personal renewal alone would open "Nothing left to record".
                    showFilter === "not-recorded" && canEdit && notRecordedItems.length > 0
                      ? openRecordDates
                      : undefined
                  }
                />
              ) : (
                <>
                  <ChecklistKindChips active={kindFilter} onChange={setKindFilter} testId="admin-renewals-kind" />
                  <ChecklistList
                    rows={rows}
                    notForThisJob={notForThisJob}
                    filter={kindFilter}
                    now={now}
                    onOpen={(item, entry) => setDetailSubject({ kind: "catalogue", item, entry })}
                    canEdit={canEdit}
                    onAddDate={addDate}
                    onMoveBack={(entry) => void moveBack(entry)}
                    recordDates={recordDatesSlot}
                    bucket={glance}
                  />
                </>
              )}
            </>
          ) : (
            <PersonalRenewalsList
              entries={personalEntries}
              now={now}
              canEdit={canEdit}
              onOpen={(entry) => setDetailSubject({ kind: "personal", entry })}
              onAdd={() => setQuickAddOpen(true)}
              onAddDate={(entry) => {
                setRenewSubject({ entry });
                setRenewOpen(true);
              }}
              onAddAllToCalendar={calendarFile ? downloadAll : undefined}
              onCopyForWorkforce={() => void copyForWorkforce()}
            />
          )}

          {canEdit ? (
            <WorkDock aria-label="Renewal actions">
              <WorkButton icon={Plus} onClick={() => setQuickAddOpen(true)} testId="admin-renewals-add">
                Add a renewal
              </WorkButton>
              {recordDatesInDock ? (
                <WorkButton
                  variant="secondary"
                  icon={CalendarPlus}
                  onClick={openRecordDates}
                  testId="admin-renewals-record-dates"
                >
                  Record dates
                </WorkButton>
              ) : null}
            </WorkDock>
          ) : null}
        </>
      )}

      {undoBar ? (
        <div data-testid="admin-renewals-undo-bar" className={adminStyles.undoBar} role="status">
          <span className={adminStyles.undoText}>
            {undoBar.failed ? `Undo didn't save · ${undoBar.message}` : undoBar.message}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {undoBar.failed ? (
              <button type="button" onClick={() => setUndoBar(null)} className={adminStyles.undoQuiet}>
                Dismiss
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void runUndo(undoBar)}
              disabled={undoBusy}
              className={adminStyles.undoAction}
            >
              {undoBar.failed ? "Retry" : "Undo"}
            </button>
          </span>
        </div>
      ) : null}

      <ChecklistItemDetailSheet
        subject={detailSubject}
        now={now}
        canEdit={canEdit}
        onClose={() => setDetailSubject(null)}
        onRenew={() => {
          if (!detailSubject) return;
          setDetailSubject(null);
          if (detailSubject.kind === "catalogue") {
            setRenewSubject(
              detailSubject.entry ? { entry: detailSubject.entry } : { entry: null, createItem: detailSubject.item },
            );
          } else {
            setRenewSubject({ entry: detailSubject.entry });
          }
          setRenewOpen(true);
        }}
        onNotForThisJob={
          canEdit
            ? (item, entry, flag) => (entry ? setNotForThisJob(entry, flag) : markItemNotForThisJob(item))
            : undefined
        }
        onIssuerCheck={canEdit ? setIssuerCheck : undefined}
      />

      <AdminRenewedSheet
        key={renewSubject?.entry?.id ?? renewSubject?.createItem?.id ?? "none"}
        open={renewOpen}
        entry={renewSubject?.entry ?? null}
        createItem={renewSubject?.createItem}
        onClose={() => setRenewOpen(false)}
        onSaved={(entry) => {
          upsert(entry);
          setUndoBar(null);
        }}
        onRemoved={removeEntry}
      />

      <AdminQuickAddSheet open={quickAddOpen} onClose={() => setQuickAddOpen(false)} onSaved={upsert} />

      <AdminSheet
        open={ready && menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Renewals"
        testId="admin-renewals-menu"
      >
        <div className={adminStyles.column}>
          <WorkCard as="ul">
            <AdminRow
              lead={<WorkIconCircle icon={Copy} />}
              title={copy === "copied" ? "Copied" : copy === "failed" ? "Couldn't copy" : "Copy for workforce"}
              sub="Your recorded dates as plain text"
              onClick={() => void copyForWorkforce()}
              testId="admin-renewals-copy"
            />
            <AdminRow
              lead={<WorkIconCircle icon={CalendarPlus} tone={calendarFile ? "mode" : "neutral"} />}
              title="Add all to my calendar"
              sub={calendarFile ? "One calendar file with every recorded date" : "No recorded dates to add yet."}
              onClick={downloadAll}
              disabled={!calendarFile}
              testId="admin-renewals-calendar-all"
            />
          </WorkCard>
          {copy === "failed" ? (
            <textarea
              readOnly
              value={workforceCopyText(own, now)}
              aria-label="Text to copy for workforce"
              className={adminStyles.copyBox}
            />
          ) : null}
        </div>
      </AdminSheet>

      {recordQueue ? (
        <RecordDatesSheet
          items={recordQueue}
          readOnly={recordReadOnly}
          onClose={() => setRecordQueue(null)}
          onSaved={upsert}
          onSignIn={() => {
            setRecordQueue(null);
            setSignInOpen(true);
          }}
          onRetryLoad={() => {
            setRecordQueue(null);
            state.retry();
          }}
        />
      ) : null}
    </AdminPage>
  );
}
