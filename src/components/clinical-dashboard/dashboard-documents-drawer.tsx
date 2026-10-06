"use client";

import type { ComponentType, RefObject } from "react";
import { BookOpen, type LucideIcon } from "lucide-react";
import { UtilityDrawer } from "@/components/clinical-dashboard/dashboard-shell";
import { DocumentDrawer } from "@/components/clinical-dashboard/clinical-dashboard-lazy";
import { LibraryHealthStrip } from "@/components/clinical-dashboard/library-health-strip";
import type { ClinicalDocument, ImportBatch, IngestionJob } from "@/lib/types";

export interface DashboardDocumentsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  summary: string;
  mobileSummary: string;
  isAdmin: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  icon?: LucideIcon | ComponentType<{ className?: string }>;
  indexedDocumentTotal: number;
  documents: ClinicalDocument[];
  libraryPdfDocuments: ClinicalDocument[];
  jobs: IngestionJob[];
  batches: ImportBatch[];
  setupChecks: any;
  dashboardDataLoading: boolean;
  openLibraryHealthTarget: (target: any) => void;
  documentsPagination: any;
  loadingMoreDocuments: boolean;
  documentsDrawerMode: any;
  selectedDocumentIds: any;
  documentDrawerStatusFilter: any;
  toggleDocumentScope: any;
  loadMoreDocuments: () => void;
  handleDocumentRenamed: (doc: ClinicalDocument) => void;
  handleDocumentDeleted: (result: any) => void;
  bulkReindexSelected: (mode: any) => Promise<void>;
  bulkAssignCollection: (collection: string) => void;
  bulkUpdateMetadata: (metadata: any) => void;
  bulkActionStatus: string | null;
  bulkActionBusy: boolean;
  canUseAdministrativeApis: boolean;
  handleTagSearch: (tag: any) => void;
  mutateDocumentLabel: any;
}

export function DashboardDocumentsDrawer({
  open,
  onOpenChange,
  title,
  summary,
  mobileSummary,
  isAdmin,
  returnFocusRef,
  icon: DocumentsDrawerIcon = BookOpen,
  indexedDocumentTotal,
  documents,
  libraryPdfDocuments,
  jobs,
  batches,
  setupChecks,
  dashboardDataLoading,
  openLibraryHealthTarget,
  documentsPagination,
  loadingMoreDocuments,
  documentsDrawerMode,
  selectedDocumentIds,
  documentDrawerStatusFilter,
  toggleDocumentScope,
  loadMoreDocuments,
  handleDocumentRenamed,
  handleDocumentDeleted,
  bulkReindexSelected,
  bulkAssignCollection,
  bulkUpdateMetadata,
  bulkActionStatus,
  bulkActionBusy,
  canUseAdministrativeApis,
  handleTagSearch,
  mutateDocumentLabel,
}: DashboardDocumentsDrawerProps) {
  if (!open) return null;

  return (
    <UtilityDrawer
      id="dashboard-documents-drawer"
      icon={BookOpen}
      title={title}
      summary={summary}
      mobileSummary={mobileSummary}
      open={open}
      onOpenChange={onOpenChange}
      sheetBreakpoint={isAdmin ? "lg" : "all"}
      sheetReturnFocusRef={returnFocusRef}
      sheetHeaderLeading={
        <span className="grid h-10 w-10 place-items-center rounded-xl border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]">
          <DocumentsDrawerIcon className="h-5 w-5" aria-hidden="true" />
        </span>
      }
      sheetTitleAccessory={
        isAdmin ? (
          <span className="nums hidden rounded-full border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-2.5 py-1 text-2xs font-bold text-[color:var(--text-muted)] sm:inline-flex">
            {indexedDocumentTotal.toLocaleString()} indexed
          </span>
        ) : null
      }
      sheetDescription={summary}
      sheetHeaderClassName="bg-[color:var(--surface-raised)] px-4 py-3 sm:px-5 sm:py-4"
      sheetCloseButtonClassName="grid h-tap w-tap shrink-0 place-items-center rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
      sheetContentClassName="max-h-[min(82dvh,40rem)] sm:max-h-[min(88dvh,46rem)] sm:max-w-2xl lg:max-w-3xl"
      sheetBodyClassName="bg-[color:var(--surface-subtle)] p-3 sm:p-4"
      sheetChildrenClassName="space-y-3"
    >
      {isAdmin ? (
        <LibraryHealthStrip
          documents={documents}
          jobs={jobs}
          batches={batches}
          checks={setupChecks}
          loading={dashboardDataLoading}
          onSelectTarget={openLibraryHealthTarget}
        />
      ) : null}
      <DocumentDrawer
        documents={isAdmin ? documents : libraryPdfDocuments}
        pagination={documentsPagination}
        loadingMoreDocuments={loadingMoreDocuments}
        mode={isAdmin ? "admin" : documentsDrawerMode}
        selectedDocumentIds={selectedDocumentIds}
        statusFilter={documentDrawerStatusFilter}
        onToggleScope={toggleDocumentScope}
        onLoadMoreDocuments={loadMoreDocuments}
        onDocumentRenamed={handleDocumentRenamed}
        onDocumentDeleted={handleDocumentDeleted}
        onBulkReindex={bulkReindexSelected}
        onBulkAssignCollection={bulkAssignCollection}
        onBulkMetadataUpdate={bulkUpdateMetadata}
        bulkActionStatus={bulkActionStatus}
        bulkActionBusy={bulkActionBusy}
        canManageDocuments={canUseAdministrativeApis}
        onTagSearch={handleTagSearch}
        onMutateLabel={mutateDocumentLabel}
      />
    </UtilityDrawer>
  );
}
