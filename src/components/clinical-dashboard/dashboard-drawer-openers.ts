import type { MutableRefObject } from "react";
import { resolveScrollBehavior } from "@/lib/scroll-behavior";
import type { AppModeId } from "@/lib/app-modes";
import type {
  DocumentDrawerMode,
  DocumentDrawerStatusFilter,
} from "@/components/clinical-dashboard/dashboard-contracts";

export interface UseDashboardDrawerOpenersOptions {
  documentsDrawerReturnFocusRef: MutableRefObject<HTMLElement | null>;
  closeDashboardTransientSurfaces: (keepOpen?: "documents" | "indexingAdmin") => void;
  setSearchMode: (mode: AppModeId) => void;
  setDocumentDrawerStatusFilter: (status: DocumentDrawerStatusFilter) => void;
  setDocumentsDrawerMode: (mode: DocumentDrawerMode) => void;
  setDocumentsDrawerOpen: (open: boolean) => void;
  setActionNotice: (notice: { tone: "success" | "warning"; message: string } | null) => void;
}

export function useDashboardDrawerOpeners({
  documentsDrawerReturnFocusRef,
  closeDashboardTransientSurfaces,
  setSearchMode,
  setDocumentDrawerStatusFilter,
  setDocumentsDrawerMode,
  setDocumentsDrawerOpen,
  setActionNotice,
}: UseDashboardDrawerOpenersOptions) {
  function openDocumentsDrawer(mode: DocumentDrawerMode) {
    documentsDrawerReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeDashboardTransientSurfaces("documents");
    setSearchMode("documents");
    setDocumentDrawerStatusFilter("indexed");
    setDocumentsDrawerMode(mode);
    setDocumentsDrawerOpen(true);
  }

  function openRecentDocuments() {
    openDocumentsDrawer("recent");
  }

  function openSourceLibrary() {
    openDocumentsDrawer("library");
  }

  function openSourcePdfBrowser() {
    openDocumentsDrawer("source");
  }

  function openEvidenceDrawer() {
    closeDashboardTransientSurfaces();
    const reviewTrigger = document.getElementById("answer-evidence-drawer-mobile-trigger") as HTMLButtonElement | null;
    if (reviewTrigger) {
      reviewTrigger.scrollIntoView({ block: "center", behavior: resolveScrollBehavior() });
      reviewTrigger.click();
      return;
    }

    setActionNotice({
      tone: "warning",
      message: "Evidence appears after a source-backed answer is generated.",
    });
  }

  return {
    openDocumentsDrawer,
    openRecentDocuments,
    openSourceLibrary,
    openSourcePdfBrowser,
    openEvidenceDrawer,
  };
}
