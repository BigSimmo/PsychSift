"use client";

import { LifeBuoy, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useAccountData } from "@/components/account-data-provider";
import { AdminCrisisLines } from "@/components/admin/admin-crisis-lines";
import { adminHelpForwardHref } from "@/components/admin/admin-hash-forward";
import { AdminHelpItemRow, AdminHelpOnSiteGlance } from "@/components/admin/admin-help-item-row";
import { AdminNote, AdminPage, adminStyles } from "@/components/admin/admin-kit";
import { AdminLoadFailed } from "@/components/admin/admin-load-failed";
import { AdminNavHeader } from "@/components/admin/admin-nav-header";
import { ADMIN_HELP_SECTIONS } from "@/components/admin/admin-page-sections";
import { AdminPinnedNumbers } from "@/components/admin/admin-pinned-numbers";
import { AdminShowAll } from "@/components/admin/admin-show-all";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { ModeBandAction, PageTitleUnderBand } from "@/components/mode-band/mode-band";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { WorkButton, WorkEmpty, WorkGlassButton, WorkSectionLabel } from "@/components/mode-kit/work";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/components/ui-primitives";
import { buildAdminHelpItems, type AdminHelpItem, type AdminHelpTab } from "@/lib/admin/help-items";
import { helpQueryAlsoLooksFor, matchesHelpQuery } from "@/lib/admin/help-search";
import { adminLoadState, selectAdminOwnEntries, selectAdminSharedEntries } from "@/lib/admin/own-entries";
import { ADMIN_STATEWIDE_SUPPORT } from "@/lib/admin/statewide-support";
import { cacheOnCallEntries, isOnCallExampleEntry, useOnCallEntries } from "@/lib/on-call/entry-store";
import type { OnCallEntry, OnCallSection } from "@/lib/on-call/entry-model";
import { ON_CALL_IN_HOURS_END_HOUR, isOnCallOutOfHours } from "@/lib/on-call/home-modules";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";

/** The On Call entry editor loads on first open and then stays mounted, so its Sheet still returns focus on close. */
const OnCallEntryEditor = dynamic(
  () => import("@/components/on-call/on-call-entry-editor").then((module) => module.OnCallEntryEditor),
  { ssr: false },
);

const TAB_BY_SECTION_ID: Record<string, AdminHelpTab> = {
  "admin-help-support": "support",
  "admin-help-guides": "guides",
  "admin-help-contacts": "contacts",
  "admin-help-on-site": "on-site",
};

const EMPTY_MESSAGE: Record<AdminHelpTab, string> = {
  support: "Crisis lines are above. Statewide support services will appear here, each with a link to its source.",
  guides: "Nothing here yet. Add your own, or your service's appear here once it is set up in Admin.",
  contacts: "Nothing here yet. Add your own, or your service's appear here once it is set up in Admin.",
  "on-site": "Nothing here yet. Add your own, or your service's appear here once it is set up in Admin.",
};

const AFTER_HOURS_LABEL = `After hours now · from ${String(ON_CALL_IN_HOURS_END_HOUR).padStart(2, "0")}:00`;

/**
 * Help (Admin update 1, Task 9): crisis lines first in every state, an
 * in-page "Find in Help" filter that never touches the server or the shared
 * composer, then Support, Guides, Contacts and On site — each an own/shared
 * `on_call_entries` list, filtered but never age-hidden. An old
 * `/on-call/logistics#on-call-entry-<id>` anchor for a row New job now owns
 * forwards there once, through `adminHelpForwardHref`.
 */
function noSubscription() {
  return () => {};
}

export function AdminHelpPage({ now: nowProp }: { now?: Date } = {}) {
  const { zone } = useWorkTimeZone();
  const router = useRouter();
  const { isAuthenticated } = useAccountData();
  const state = useOnCallEntries();
  const { entries, retry } = state;
  const mountedAt = useMemo(() => new Date(), []);
  const now = nowProp ?? mountedAt;
  // The after-hours line depends on the clock, so it is decided on the device
  // only. The server render never shows it, which keeps hydration in step.
  const afterHours = useSyncExternalStore(
    noSubscription,
    () => isOnCallOutOfHours(now, zone),
    () => false,
  );
  const [query, setQuery] = useState("");
  const [editorState, setEditorState] = useState<{ open: boolean; entry: OnCallEntry | null; section: OnCallSection }>({
    open: false,
    entry: null,
    section: "logistics",
  });
  const [editorMounted, setEditorMounted] = useState(false);
  if (editorState.open && !editorMounted) setEditorMounted(true);

  const own = useMemo(() => selectAdminOwnEntries(state), [state]);
  const shared = useMemo(() => selectAdminSharedEntries(state), [state]);
  const loadState = adminLoadState(state);

  useEffect(() => {
    const next = adminHelpForwardHref(window.location.hash, [...own, ...shared]);
    if (next) router.replace(next);
  }, [own, shared, router]);

  const items = useMemo(() => buildAdminHelpItems({ own, shared, statewide: ADMIN_STATEWIDE_SUPPORT }), [own, shared]);
  const filtered = query.trim() ? items.filter((item) => matchesHelpQuery(item.searchText, query)) : items;
  const byTab = useMemo(() => {
    const map = new Map<AdminHelpTab, AdminHelpItem[]>();
    for (const item of filtered) {
      const list = map.get(item.tab);
      if (list) list.push(item);
      else map.set(item.tab, [item]);
    }
    return map;
  }, [filtered]);

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

  function openNewEntry() {
    setEditorState({ open: true, entry: null, section: "logistics" });
  }

  function openEditor(item: AdminHelpItem) {
    if (!item.entry) return;
    setEditorState({ open: true, entry: item.entry, section: item.entry.section });
  }

  const searching = query.trim().length > 0;
  const alsoLooksFor = searching ? helpQueryAlsoLooksFor(query) : [];
  const noMatches = searching && filtered.length === 0;
  const canAdd = isAuthenticated && !state.demoMode;

  return (
    <>
      <AdminPage testId="admin-help-main">
        <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
          Help
        </PageTitleUnderBand>

        {/* Crisis lines first, above the filter and every section (design; ui-lane-rules). */}
        <AdminCrisisLines />

        <div className={adminStyles.helpSearch}>
          <div data-testid="admin-help-filter" className="min-w-0 flex-1">
            <TextField
              label="Find in Help"
              hint="Everyday words work: payslip, hungry, password"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {canAdd ? (
            // The band's plus when the band is shown (spec item 6), otherwise a plain button beside the box.
            <ModeBandAction>
              {(underBand) =>
                underBand ? (
                  <WorkGlassButton
                    icon={Plus}
                    label="Add your own"
                    onClick={openNewEntry}
                    className="work-band__action"
                    testId="admin-help-add"
                  />
                ) : (
                  <WorkButton variant="secondary" icon={Plus} testId="admin-help-add" onClick={openNewEntry}>
                    Add your own
                  </WorkButton>
                )
              }
            </ModeBandAction>
          ) : null}
        </div>
        {/* role="status" is already a polite live region, so no aria-live beside it (SPEC §9.2). */}
        {loadState === "failed" || !searching ? null : (
          <div className="grid gap-1" role="status" data-testid="admin-help-search-result">
            <p className="text-sm text-[color:var(--text)]">
              {filtered.length === 1 ? "1 result" : `${filtered.length} results`}
            </p>
            {alsoLooksFor.length > 0 ? (
              <p className="text-xs text-[color:var(--text-muted)]" data-testid="admin-help-also-matched">
                Also looking for {listInWords(alsoLooksFor.slice(0, 6))}
              </p>
            ) : null}
            {noMatches ? (
              <p className="text-xs text-[color:var(--text-muted)]" data-testid="admin-help-no-match">
                Nothing in Support, Guides, Contacts or On site. Crisis lines always show.
              </p>
            ) : null}
          </div>
        )}

        {/* Pinned numbers sit under the crisis lines, never above them (owner decision 2026-10-01).
            Hidden with the sections when loading failed: a cached number is not offered as current. */}
        {loadState === "failed" ? null : <AdminPinnedNumbers items={items} testId="admin-help-pinned" />}

        {loadState === "failed" ? null : <AdminNavHeader title="Help" sections={ADMIN_HELP_SECTIONS} />}

        {loadState === "failed" ? (
          <AdminLoadFailed reason={state.loadError} onRetry={retry} testId="admin-help-load-failed" />
        ) : (
          ADMIN_HELP_SECTIONS.map((section) => {
            const tab = TAB_BY_SECTION_ID[section.id];
            const rows = byTab.get(tab) ?? [];
            return (
              <section
                key={section.id}
                id={section.id}
                aria-label={section.label}
                className={cn(inPageAnchor, adminStyles.section)}
              >
                <WorkSectionLabel count={rows.length > 0 ? rows.length : undefined}>{section.label}</WorkSectionLabel>
                {tab === "on-site" && afterHours ? (
                  <p className="text-sm text-[color:var(--text-muted)]" data-testid="admin-help-on-site-after-hours">
                    {AFTER_HOURS_LABEL}
                  </p>
                ) : null}
                {rows.length === 0 && loadState === "loading" ? (
                  // Design point 11: a loading section is a skeleton, never an empty-looking one.
                  <ModeModuleSkeleton rows={3} testId={`admin-help-${tab}-loading`} />
                ) : rows.length === 0 && tab === "support" && !searching ? (
                  // An honest empty state: no statewide service is listed yet, and none is invented.
                  <div className="work-card">
                    <WorkEmpty
                      icon={LifeBuoy}
                      title="Nothing here yet"
                      body={EMPTY_MESSAGE.support}
                      testId="admin-help-support-empty"
                    />
                  </div>
                ) : rows.length === 0 ? (
                  <p className="text-sm text-[color:var(--text-muted)]">
                    {searching ? "Nothing here matches." : EMPTY_MESSAGE[tab]}
                  </p>
                ) : (
                  <>
                    {/* Four tiles at a glance, as the mockup draws them. The full list follows. */}
                    {tab === "on-site" ? <AdminHelpOnSiteGlance items={rows.slice(0, 4)} /> : null}
                    <AdminShowAll
                      items={rows}
                      label={section.label}
                      testId={`admin-help-${tab}-list`}
                      listClassName="work-card work-rows"
                      anchorIdOf={(item) => (item.entry ? onCallEntryAnchorId(item.entry.id) : item.key)}
                      renderItem={(item) => (
                        <AdminHelpItemRow
                          key={item.key}
                          item={item}
                          onEdit={canAdd && item.entry ? openEditor : undefined}
                        />
                      )}
                    />
                  </>
                )}
              </section>
            );
          })
        )}

        {state.demoMode ? (
          <AdminNote testId="admin-help-demo-note">Crisis numbers are real. Other numbers are examples.</AdminNote>
        ) : null}
      </AdminPage>

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

/** "a, b and c", in plain words, with no list punctuation beyond commas. */
function listInWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
