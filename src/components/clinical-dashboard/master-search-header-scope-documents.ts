"use client";

import { useMemo } from "react";

import { tagSearchText } from "@/lib/document-tags";
import type { ClinicalDocument } from "@/lib/types";

/**
 * The document list the header's scope picker shows: the scoped documents
 * first, then the newest matches for the filter text, capped at twelve. Moved
 * out of `master-search-header.tsx` unchanged; the header still owns the markup.
 */
export function useScopeDocumentList({
  documents,
  selectedDocumentIds,
  scopeFilter,
}: {
  documents: ClinicalDocument[];
  selectedDocumentIds: string[];
  scopeFilter: string;
}) {
  const selectedDocumentIdSet = useMemo(() => new Set(selectedDocumentIds), [selectedDocumentIds]);
  const documentById = useMemo(() => new Map(documents.map((document) => [document.id, document])), [documents]);
  const selectedDocuments = useMemo(
    () =>
      selectedDocumentIds
        .map((id) => documentById.get(id))
        .filter((document): document is ClinicalDocument => Boolean(document)),
    [documentById, selectedDocumentIds],
  );
  const scopeSummary = selectedDocumentIds.length === 0 ? "All documents" : `${selectedDocumentIds.length} scoped`;
  const scopePreview = useMemo(
    () =>
      selectedDocuments
        .slice(0, 2)
        .map((document) => document?.title.replace(/^Synthetic /, ""))
        .filter(Boolean)
        .join(", "),
    [selectedDocuments],
  );
  const normalizedScopeFilter = scopeFilter.trim().toLowerCase();
  const recentlyUpdatedDocuments = useMemo(
    () =>
      [...documents].sort((a, b) => {
        const bTime = Date.parse(b.updated_at || b.created_at || "");
        const aTime = Date.parse(a.updated_at || a.created_at || "");
        return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
      }),
    [documents],
  );
  const documentSearchTextById = useMemo(
    () =>
      new Map(
        documents.map((document) => [
          document.id,
          [document.title, document.file_name, document.description, tagSearchText(document)]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
        ]),
      ),
    [documents],
  );
  const matchingDocuments = useMemo(
    () =>
      normalizedScopeFilter
        ? recentlyUpdatedDocuments.filter((document) =>
            documentSearchTextById.get(document.id)?.includes(normalizedScopeFilter),
          )
        : recentlyUpdatedDocuments,
    [documentSearchTextById, normalizedScopeFilter, recentlyUpdatedDocuments],
  );
  const largeScopeSet = documents.length > 12;
  const requireScopeFilter = largeScopeSet && !normalizedScopeFilter;
  const visibleScopeDocuments = useMemo(
    () =>
      [
        ...selectedDocuments,
        ...(requireScopeFilter ? [] : matchingDocuments.filter((document) => !selectedDocumentIdSet.has(document.id))),
      ].slice(0, 12),
    [matchingDocuments, requireScopeFilter, selectedDocumentIdSet, selectedDocuments],
  );
  const hiddenScopeMatchCount = requireScopeFilter
    ? Math.max(0, selectedDocuments.length ? documents.length - selectedDocumentIds.length : documents.length)
    : Math.max(0, matchingDocuments.length - visibleScopeDocuments.length);
  return {
    scopeSummary,
    scopePreview,
    matchingDocuments,
    requireScopeFilter,
    visibleScopeDocuments,
    hiddenScopeMatchCount,
  };
}
