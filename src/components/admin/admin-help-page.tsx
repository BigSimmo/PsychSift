"use client";

import { LifeBuoy, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useAccountData } from "@/components/account-data-provider";
import { AdminPinnedNumbers } from "@/components/admin/admin-pinned-numbers";
import { AdminCrisisLines } from "@/components/admin/admin-crisis-lines";
import { AdminHelpItemRow, AdminHelpOnSiteGlance } from "@/components/admin/admin-help-item-row";
import { AdminNavHeader } from "@/components/admin/admin-nav-header";
import { ADMIN_HELP_SECTIONS } from "@/components/admin/admin-page-sections";
import { AdminShowAll } from "@/components/admin/admin-show-all";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { EmptyState } from "@/components/primitive-recipes/feedback";
import { AdminLoadFailed } from "@/components/admin/admin-load-failed";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import { adminHelpForwardHref } from "@/components/admin/admin-hash-forward";
import { adminLoadState, selectAdminOwnEntries, selectAdminSharedEntries } from "@/lib/admin/own-entries";
import { buildAdminHelpItems, type AdminHelpItem, type AdminHelpTab } from "@/lib/admin/help-items";
import { matchesHelpQuery } from "@/lib/admin/help-search";
import { ADMIN_STATEWIDE_SUPPORT } from "@/lib/admin/statewide-support";
import { ON_CALL_IN_HOURS_END_HOUR, isOnCallOutOfHours } from "@/lib/on-call/home-modules";
import { cacheOnCallEntries, useOnCallEntries } from "@/lib/on-call/entry-store";
import type { OnCallEntry, OnCallSection } from "@/lib/on-call/entry-model";
import { PageTitleUnderBand } from "@/components/mode-band/mode-band";

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
export function AdminHelpPage({ now: nowProp }: { now?: Date } = {}) {
  const router = useRouter();
  const { isAuthenticated } = useAccountData();
  const state = useOnCallEntries();
  const { entries, retry } = state;
  const mountedAt = useMemo(() => new Date(), []);
  const now = nowProp ?? mountedAt;
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
    const next = entries.some((existing) => existing.id === entry.id)
      ? entries.map((existing) => (existing.id === entry.id ? entry : existing))
      : [...entries, entry];
    cacheOnCallEntries(next);
  }

  function removeCachedEntry(id: string) {
    cacheOnCallEntries(entries.filter((existing) => existing.id !== id));
  }

  function openEditor(item: AdminHelpItem) {
    if (!item.entry) return;
    setEditorState({ open: true, entry: item.entry, section: item.entry.section });
  }

  return (
    <>
      <AdminNavHeader title="Help" sections={ADMIN_HELP_SECTIONS} />
      <InformationPageShell testId="admin-help-main">
        <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
          Help
        </PageTitleUnderBand>

        {/* Crisis lines first, above the filter and every tab (design; ui-lane-rules). */}
        <AdminCrisisLines />

        {/* Pinned numbers sit under the crisis lines, never above them (owner decision 2026-10-01).
            Hidden with the sections when loading failed: a cached number is not offered as current. */}
        {loadState === "failed" ? null : <AdminPinnedNumbers items={items} testId="admin-help-pinned" />}

        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div data-testid="admin-help-filter" className="min-w-0">
            <TextField
              label="Find in Help"
              hint="Everyday words work: payslip, hungry, password"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {isAuthenticated ? (
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              testId="admin-help-add"
              onClick={() => setEditorState({ open: true, entry: null, section: "logistics" })}
            >
              Add your own
            </Button>
          ) : null}
        </div>

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
                className={cn(inPageAnchor, "grid gap-2")}
              >
                <h2 className={eyebrowText}>{section.label}</h2>
                {tab === "on-site" && isOnCallOutOfHours(now) ? (
                  <p className={cn(textMuted, "text-sm")} data-testid="admin-help-on-site-after-hours">
                    {AFTER_HOURS_LABEL}
                  </p>
                ) : null}
                {rows.length === 0 && loadState === "loading" ? (
                  // Design point 11: a loading section is a skeleton, never an empty-looking one.
                  <ModeModuleSkeleton rows={3} testId={`admin-help-${tab}-loading`} />
                ) : rows.length === 0 && tab === "support" && !query.trim() ? (
                  // An honest empty state: no statewide service is listed yet, and none is invented.
                  <EmptyState
                    icon={LifeBuoy}
                    title="Nothing here yet"
                    body={EMPTY_MESSAGE.support}
                    testId="admin-help-support-empty"
                  />
                ) : rows.length === 0 ? (
                  <p className={cn(textMuted, "text-sm")}>{EMPTY_MESSAGE[tab]}</p>
                ) : (
                  <>
                    {tab === "on-site" ? <AdminHelpOnSiteGlance items={rows} /> : null}
                    <AdminShowAll
                      items={rows}
                      label={section.label}
                      testId={`admin-help-${tab}-list`}
                      anchorIdOf={(item) => (item.entry ? onCallEntryAnchorId(item.entry.id) : item.key)}
                      renderItem={(item) => (
                        <AdminHelpItemRow
                          key={item.key}
                          item={item}
                          onEdit={isAuthenticated && item.entry ? openEditor : undefined}
                        />
                      )}
                    />
                  </>
                )}
              </section>
            );
          })
        )}
      </InformationPageShell>

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
