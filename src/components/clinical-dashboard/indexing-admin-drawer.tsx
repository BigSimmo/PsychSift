"use client";

import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Activity, ListChecks, RefreshCw, ShieldAlert } from "lucide-react";
import { UtilityDrawer } from "@/components/clinical-dashboard/dashboard-shell";
import { LibraryHealthStrip } from "@/components/clinical-dashboard/library-health-strip";
import {
  IndexingMonitor,
  IngestionQualityConsole,
  SetupChecklist,
} from "@/components/clinical-dashboard/clinical-dashboard-lazy";
import { AuthPanel } from "@/components/clinical-dashboard/auth-panel";
import { cn, textMuted } from "@/components/ui-primitives";
import type { useSettingsState } from "@/components/clinical-dashboard/SettingsStateProvider";
import type { ClinicalDocument, ImportBatch, IngestionJob } from "@/lib/types";
import type {
  IngestionQualityPayload,
  SetupStatusPayload,
} from "@/components/clinical-dashboard/clinical-dashboard-payloads";
import type {
  IndexingAdministrationTab,
  IndexingMonitorFilter,
  LibraryHealthTarget,
} from "@/components/clinical-dashboard/document-admin";

export type IndexingAdminDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  documents: ClinicalDocument[];
  jobs: IngestionJob[];
  batches: ImportBatch[];
  setupChecks: SetupStatusPayload["checks"];
  qualityItems: IngestionQualityPayload["items"];
  dashboardDataLoading: boolean;
  settingsState: ReturnType<typeof useSettingsState>;
  indexingAdminUsesDesktopRegions: boolean;
  indexingMonitorFilter: IndexingMonitorFilter;
  indexingActionId: string | null;
  retryJob: (jobId: string) => Promise<void>;
  reindexDocument: (documentId: string) => Promise<void>;
  enrichDocument: (documentId: string) => Promise<void>;
  openLibraryHealthTarget: (target: LibraryHealthTarget) => void;
  showAuthPanel: boolean;
};

export function IndexingAdminDrawer({
  open,
  onOpenChange,
  returnFocusRef,
  documents,
  jobs,
  batches,
  setupChecks,
  qualityItems,
  dashboardDataLoading,
  settingsState,
  indexingAdminUsesDesktopRegions,
  indexingMonitorFilter,
  indexingActionId,
  retryJob,
  reindexDocument,
  enrichDocument,
  openLibraryHealthTarget,
  showAuthPanel,
}: IndexingAdminDrawerProps) {
  const indexingAdminTabRefs = useRef(new Map<IndexingAdministrationTab, HTMLButtonElement>());

  const checks = setupChecks ?? [];
  const items = qualityItems ?? [];
  const setupReadyCount = checks.filter((check) => check.status === "ready").length;
  const setupCheckCount = checks.length;
  const activeIndexingWorkCount =
    jobs.filter((job) => job.status === "pending" || job.status === "processing").length +
    batches.filter((batch) => batch.status === "queued" || batch.status === "processing").length;
  const failedIndexingWorkCount =
    jobs.filter((job) => job.status === "failed").length + batches.filter((batch) => batch.status === "failed").length;

  const indexingAdminTabs: Array<{
    id: IndexingAdministrationTab;
    label: string;
    summary: string;
    tabId: string;
    panelId: string;
    icon: typeof Activity;
  }> = [
    {
      id: "setup",
      label: "Setup",
      summary: `${setupReadyCount}/${setupCheckCount} ready`,
      tabId: "dashboard-indexing-admin-tab-setup",
      panelId: "dashboard-setup-section",
      icon: ListChecks,
    },
    {
      id: "jobs",
      label: "Jobs",
      summary: activeIndexingWorkCount
        ? `${activeIndexingWorkCount} active`
        : failedIndexingWorkCount
          ? `${failedIndexingWorkCount} failed`
          : "Idle",
      tabId: "dashboard-indexing-admin-tab-jobs",
      panelId: "dashboard-indexing-section",
      icon: RefreshCw,
    },
    {
      id: "quality",
      label: "Quality",
      summary: items.length ? `${items.length} review` : "Clear",
      tabId: "dashboard-indexing-admin-tab-quality",
      panelId: "dashboard-quality-section",
      icon: ShieldAlert,
    },
  ];

  function handleIndexingAdminTabKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const order = indexingAdminTabs.map((tab) => tab.id);
    const index = order.indexOf(settingsState.indexingAdminMobileTab);
    const next =
      event.key === "ArrowRight"
        ? order[(index + 1) % order.length]
        : event.key === "ArrowLeft"
          ? order[(index - 1 + order.length) % order.length]
          : event.key === "Home"
            ? order[0]
            : event.key === "End"
              ? order[order.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    if (next !== settingsState.indexingAdminMobileTab) settingsState.setIndexingAdminMobileTab(next);
    indexingAdminTabRefs.current.get(next)?.focus();
  }

  return (
    <UtilityDrawer
      id="dashboard-indexing-admin-drawer"
      icon={Activity}
      title="Indexing administration"
      summary="Documents are added through the administrator backend. Monitor setup, jobs, and ingestion quality here."
      mobileSummary="Indexing admin"
      open={open}
      onOpenChange={onOpenChange}
      sheetReturnFocusRef={returnFocusRef}
    >
      <LibraryHealthStrip
        documents={documents}
        jobs={jobs}
        batches={batches}
        checks={checks}
        loading={dashboardDataLoading}
        onSelectTarget={openLibraryHealthTarget}
      />
      <div
        role="tablist"
        aria-label="Indexing administration sections"
        onKeyDown={handleIndexingAdminTabKeyDown}
        className="grid grid-cols-3 gap-2 lg:hidden"
      >
        {indexingAdminTabs.map((tab) => {
          const active = settingsState.indexingAdminMobileTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                if (element) indexingAdminTabRefs.current.set(tab.id, element);
                else indexingAdminTabRefs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={tab.tabId}
              aria-selected={active}
              aria-controls={tab.panelId}
              aria-label={tab.label}
              aria-describedby={`${tab.tabId}-summary`}
              tabIndex={active ? 0 : -1}
              onClick={() => settingsState.setIndexingAdminMobileTab(tab.id)}
              className={cn(
                "min-h-[56px] rounded-lg border px-2.5 py-2 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] active:translate-y-px",
                active
                  ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--glow-soft)]"
                  : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)]",
              )}
            >
              <span className="flex items-center gap-1.5 text-xs font-bold">
                <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                {tab.label}
              </span>
              <span id={`${tab.tabId}-summary`} className="mt-1 block truncate text-2xs font-semibold opacity-80">
                {tab.summary}
              </span>
            </button>
          );
        })}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div
          id="dashboard-setup-section"
          role={indexingAdminUsesDesktopRegions ? "region" : "tabpanel"}
          aria-labelledby={
            indexingAdminUsesDesktopRegions ? "dashboard-setup-section-heading" : "dashboard-indexing-admin-tab-setup"
          }
          className={cn(
            "space-y-3 scroll-mt-4 lg:col-start-1 lg:row-start-1",
            settingsState.indexingAdminMobileTab !== "setup" && "hidden lg:block",
          )}
        >
          <p
            id="dashboard-setup-section-heading"
            className={cn("text-xs font-bold uppercase tracking-eyebrow", textMuted)}
          >
            Developer setup status
          </p>
          <SetupChecklist checks={checks} />
          {showAuthPanel && <AuthPanel />}
        </div>
        <div
          id="dashboard-indexing-section"
          role={indexingAdminUsesDesktopRegions ? "region" : "tabpanel"}
          aria-labelledby={
            indexingAdminUsesDesktopRegions ? "dashboard-indexing-section-heading" : "dashboard-indexing-admin-tab-jobs"
          }
          className={cn(
            "space-y-3 scroll-mt-4 lg:col-start-2 lg:row-start-1",
            settingsState.indexingAdminMobileTab !== "jobs" && "hidden lg:block",
          )}
        >
          <p
            id="dashboard-indexing-section-heading"
            className={cn("text-xs font-bold uppercase tracking-eyebrow", textMuted)}
          >
            Indexing progress
          </p>
          <IndexingMonitor
            jobs={jobs}
            batches={batches}
            filter={indexingMonitorFilter}
            actionId={indexingActionId}
            onRetry={retryJob}
            onReindex={reindexDocument}
            onEnrich={enrichDocument}
          />
        </div>
        <div
          id="dashboard-quality-section"
          role={indexingAdminUsesDesktopRegions ? "region" : "tabpanel"}
          aria-labelledby={
            indexingAdminUsesDesktopRegions
              ? "dashboard-quality-section-heading"
              : "dashboard-indexing-admin-tab-quality"
          }
          className={cn(
            "space-y-3 scroll-mt-4 lg:col-span-2 lg:row-start-2",
            settingsState.indexingAdminMobileTab !== "quality" && "hidden lg:block",
          )}
        >
          <p
            id="dashboard-quality-section-heading"
            className={cn("text-xs font-bold uppercase tracking-eyebrow", textMuted)}
          >
            Ingestion quality console
          </p>
          <IngestionQualityConsole
            items={items}
            actionId={indexingActionId}
            onRetry={retryJob}
            onReindex={reindexDocument}
            onEnrich={enrichDocument}
          />
        </div>
      </div>
    </UtilityDrawer>
  );
}
