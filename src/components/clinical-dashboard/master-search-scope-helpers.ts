import type { ClinicalDocument } from "@/lib/types";
import { cleanDisplayTitle } from "@/components/clinical-dashboard/display-text";

export function splitFilterText(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function filterText(values?: string[]): string {
  return (values ?? []).join(", ");
}

export type TextScopeFilterKey =
  | "medications"
  | "topics"
  | "sites"
  | "documentTypes"
  | "services"
  | "settings"
  | "populations"
  | "risks"
  | "workflows"
  | "clinicalActions"
  | "carePhases"
  | "documentIntents"
  | "contentFeatures"
  | "collections";

export const labelScopeFilterFields: Array<{ key: TextScopeFilterKey; label: string; placeholder: string }> = [
  { key: "medications", label: "Medication", placeholder: "Lithium, clozapine" },
  { key: "topics", label: "Topic", placeholder: "ECT, safety plan" },
  { key: "sites", label: "Site", placeholder: "FSH, RPBG, CAMHS" },
  { key: "documentTypes", label: "Type", placeholder: "Guideline, policy" },
  { key: "services", label: "Service", placeholder: "Mental health, pharmacy" },
  { key: "settings", label: "Setting", placeholder: "Inpatient, ED" },
  { key: "populations", label: "Population", placeholder: "Youth, older adult" },
  { key: "risks", label: "Risk", placeholder: "High-risk medication" },
  { key: "workflows", label: "Workflow", placeholder: "Referral, discharge" },
  { key: "clinicalActions", label: "Action", placeholder: "Assess, monitor" },
  { key: "carePhases", label: "Phase", placeholder: "Acute management" },
  { key: "documentIntents", label: "Intent", placeholder: "Decision support" },
  { key: "contentFeatures", label: "Feature", placeholder: "Contains table" },
  { key: "collections", label: "Collection", placeholder: "Local policy set" },
];

export function documentScopeTitle(document: ClinicalDocument): string {
  return cleanDisplayTitle(document.title);
}

export function documentScopeMeta(document: ClinicalDocument): string {
  const title = documentScopeTitle(document).toLowerCase();
  const fileName = document.file_name;
  const fileBase = fileName.replace(/\.pdf$/i, "").toLowerCase();
  const pages = document.page_count === 1 ? "1 page" : `${document.page_count ?? "?"} pages`;
  if (fileBase === title || fileBase.startsWith(title)) return pages;
  return `${fileName} · ${pages}`;
}
