import type { SmartDocumentTag, SmartDocumentTagFacet } from "@/lib/document-tags";
import type { SearchScopeFilters } from "@/lib/search-scope";

export function buildTagSearchScopeFilters(
  currentFilters: SearchScopeFilters,
  tag: SmartDocumentTag | SmartDocumentTagFacet,
): { searchText: string; nextFilters: SearchScopeFilters } {
  const searchText = tag.searchText || tag.label;
  const nextFilters: SearchScopeFilters = { ...currentFilters };
  if (tag.group === "Site") nextFilters.sites = [searchText];
  if (tag.group === "Medication") nextFilters.medications = [tag.searchText || tag.label];
  if (tag.group === "Document type") nextFilters.documentTypes = [tag.searchText || tag.label];
  if (tag.group === "Topic") nextFilters.topics = [tag.searchText || tag.label];
  if (tag.group === "Service") nextFilters.services = [searchText];
  if (tag.group === "Setting") nextFilters.settings = [searchText];
  if (tag.group === "Population") nextFilters.populations = [searchText];
  if (tag.group === "Risk") nextFilters.risks = [searchText];
  if (tag.group === "Workflow") nextFilters.workflows = [searchText];
  if (tag.group === "Clinical action") nextFilters.clinicalActions = [searchText];
  if (tag.group === "Care phase") nextFilters.carePhases = [searchText];
  if (tag.group === "Document intent") nextFilters.documentIntents = [searchText];
  if (tag.group === "Content feature") nextFilters.contentFeatures = [searchText];
  return { searchText, nextFilters };
}
