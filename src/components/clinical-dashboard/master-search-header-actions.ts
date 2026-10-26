import type { AppModeId } from "@/lib/app-modes";
import type { ClinicalQueryMode } from "@/lib/types";
import type { ModeActionId } from "@/components/clinical-dashboard/mode-action-popup";
import { searchTextPatientDetailRefusal } from "@/components/clinical-dashboard/search-patient-detail-guard";

export interface MasterSearchHeaderModeActionContext {
  actionId: ModeActionId;
  trimmedQuery: string;
  onQueryModeChange: (mode: ClinicalQueryMode) => void;
  onQueryChange: (query: string) => void;
  onSearchModeChange: (mode: AppModeId) => void;
  openScopePicker: () => void;
  onOpenEvidence?: () => void;
  onOpenRecentDocuments?: () => void;
  onOpenDocumentAdmin?: () => void;
  onOpenLibrary?: () => void;
  onOpenSourcePdf?: () => void;
  pushIfLeaveConfirmed: (href: string) => void;
  factsheetsTopicsHref: string;
  canAccessFavourites: boolean;
  onRequestAccountSetup?: () => void;
  onNewChat?: () => void;
}

export function executeMasterSearchHeaderModeAction({
  actionId,
  trimmedQuery,
  onQueryModeChange,
  onQueryChange,
  onSearchModeChange,
  openScopePicker,
  onOpenEvidence,
  onOpenRecentDocuments,
  onOpenDocumentAdmin,
  onOpenLibrary,
  onOpenSourcePdf,
  pushIfLeaveConfirmed,
  factsheetsTopicsHref,
  canAccessFavourites,
  onRequestAccountSetup,
  onNewChat,
}: MasterSearchHeaderModeActionContext): void {
  if (actionId === "medication-dose") {
    const medicationQuery = trimmedQuery || "acamprosate renal dose";
    onQueryModeChange("dose_threshold_lookup");
    onQueryChange(medicationQuery);
    return;
  }
  if (actionId === "medication-safety") {
    onQueryModeChange("contraindications_cautions");
    onQueryChange(trimmedQuery || "acamprosate contraindications");
    return;
  }
  if (actionId === "medication-monitoring") {
    onQueryModeChange("monitoring_schedule");
    onQueryChange(trimmedQuery || "acamprosate monitoring");
    return;
  }
  if (actionId === "medication-access") {
    onQueryModeChange("required_documentation");
    onQueryChange(trimmedQuery || "acamprosate PBS access");
    return;
  }
  if (actionId === "medication-escalation") {
    onQueryModeChange("escalation_criteria");
    onQueryChange(trimmedQuery || "acamprosate escalation criteria");
    return;
  }

  if (actionId === "documents-search") {
    onSearchModeChange("documents");
    return;
  }
  if (actionId === "documents-scope") {
    openScopePicker();
    return;
  }
  if (actionId === "answer-quotes" || actionId === "answer-evidence-map") {
    onOpenEvidence?.();
    return;
  }
  if (actionId === "documents-tables") {
    onSearchModeChange("documents");
    onQueryChange(trimmedQuery || "table evidence");
    return;
  }
  if (actionId === "documents-recent") {
    onSearchModeChange("documents");
    onOpenRecentDocuments?.();
    return;
  }
  if (actionId === "documents-admin") {
    onSearchModeChange("documents");
    onOpenDocumentAdmin?.();
    return;
  }
  if (actionId === "documents-status" || actionId === "documents-collections") {
    onSearchModeChange("documents");
    onOpenLibrary?.();
    return;
  }
  if (actionId === "documents-viewer") {
    onSearchModeChange("documents");
    onOpenSourcePdf?.();
    return;
  }
  if (actionId === "factsheets-search") {
    onSearchModeChange("factsheets");
    return;
  }
  if (actionId === "factsheets-browse") {
    pushIfLeaveConfirmed(factsheetsTopicsHref);
    return;
  }
  if (actionId === "dictionary-search") {
    // Text that looks like it holds a patient detail is left out of the address (privacy audit CA-03).
    const carried = trimmedQuery && !searchTextPatientDetailRefusal(trimmedQuery) ? trimmedQuery : "";
    pushIfLeaveConfirmed(`/dictionary/search${carried ? `?q=${encodeURIComponent(carried)}` : ""}`);
    return;
  }
  if (actionId === "dictionary-topics") {
    pushIfLeaveConfirmed("/dictionary/topics");
    return;
  }
  if (actionId === "dictionary-compare") {
    pushIfLeaveConfirmed("/dictionary/compare");
    return;
  }
  if (actionId === "dictionary-sources") {
    pushIfLeaveConfirmed("/dictionary/sources");
    return;
  }
  if (actionId === "services-search") {
    onSearchModeChange("services");
    return;
  }
  if (actionId === "services-pathways") {
    onSearchModeChange("services");
    onQueryChange(trimmedQuery || "crisis support referral pathway");
    return;
  }
  if (actionId === "services-records") {
    onSearchModeChange("services");
    onQueryChange("");
    return;
  }
  if (actionId === "services-documents") {
    onSearchModeChange("documents");
    onQueryChange(trimmedQuery || "service referral guidance");
    return;
  }
  if (actionId === "forms-records") {
    onSearchModeChange("forms");
    onQueryChange("");
    return;
  }
  if (actionId === "forms-documents") {
    onSearchModeChange("documents");
    onQueryChange(trimmedQuery || "clinical form guidance");
    return;
  }
  if (actionId === "favourites-browse") {
    if (!canAccessFavourites) {
      onRequestAccountSetup?.();
      return;
    }
    onSearchModeChange("favourites");
    onQueryChange("");
    return;
  }
  if (actionId === "favourites-sets") {
    if (!canAccessFavourites) {
      onRequestAccountSetup?.();
      return;
    }
    onSearchModeChange("favourites");
    onQueryChange("set");
    return;
  }
  if (actionId === "answer-new" || actionId === "tools-new") {
    onNewChat?.();
    return;
  }
  if (actionId === "tools-browse") {
    onSearchModeChange("tools");
    return;
  }
  if (actionId === "calculators-browse") {
    pushIfLeaveConfirmed("/calculators");
    return;
  }
  if (actionId === "differentials-build") {
    onSearchModeChange("differentials");
    onQueryChange(trimmedQuery || "acute confusion differential diagnosis");
    return;
  }
  if (actionId === "differentials-criteria") {
    onSearchModeChange("differentials");
    onQueryModeChange("compare_guidance");
    onQueryChange(trimmedQuery || "delirium vs dementia differential diagnosis");
    return;
  }
  if (actionId === "differentials-documents") {
    onSearchModeChange("documents");
    onQueryChange(trimmedQuery || "differential diagnosis");
    return;
  }
  if (actionId === "differentials-evidence") {
    onOpenEvidence?.();
    return;
  }
  if (actionId === "dsm-search") {
    onSearchModeChange("dsm");
    return;
  }
  if (actionId === "dsm-compare") {
    pushIfLeaveConfirmed("/dsm/compare");
    return;
  }
  if (actionId === "dsm-criteria") {
    onSearchModeChange("dsm");
    onQueryChange(trimmedQuery || "major depressive disorder");
    return;
  }
  if (actionId === "specifiers-search") {
    onSearchModeChange("specifiers");
    return;
  }
  if (actionId === "specifiers-builder") {
    pushIfLeaveConfirmed("/specifiers/builder");
    return;
  }
  if (actionId === "specifiers-compare") {
    pushIfLeaveConfirmed("/specifiers/compare");
    return;
  }
  if (actionId === "specifiers-map") {
    pushIfLeaveConfirmed("/specifiers/map");
    return;
  }
  if (actionId === "formulation-search") {
    onSearchModeChange("formulation");
    return;
  }
  if (actionId === "formulation-builder") {
    pushIfLeaveConfirmed("/formulation/builder");
    return;
  }
  if (actionId === "formulation-compare") {
    pushIfLeaveConfirmed("/formulation/compare");
    return;
  }
  if (actionId === "formulation-map") {
    pushIfLeaveConfirmed("/formulation/map");
    return;
  }
}
