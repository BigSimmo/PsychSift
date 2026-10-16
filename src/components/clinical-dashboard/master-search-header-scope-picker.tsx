import { type RefObject } from "react";
import { CircleCheck, ChevronDown, FileText, Filter, Search } from "lucide-react";

import { DocumentTagCloud } from "@/components/DocumentTagCloud";
import { Sheet } from "@/components/ui/sheet";
import {
  cn,
  fieldControlPlain,
  fieldControlWithIcon,
  floatingControl,
  shellChip,
  eyebrowText,
} from "@/components/ui-primitives";
import { cleanDisplayTitle } from "@/components/clinical-dashboard/display-text";
import {
  filterText,
  labelScopeFilterFields,
  documentScopeTitle,
  documentScopeMeta,
  type TextScopeFilterKey,
} from "@/components/clinical-dashboard/master-search-scope-helpers";
import type { ClinicalDocument, ClinicalQueryMode } from "@/lib/types";
import type { SearchScopeFilters } from "@/lib/search-scope";

export interface MasterSearchHeaderScopePickerProps {
  usesScopeSheet: boolean;
  scopeOpen: boolean;
  scopeSheetOpen: boolean;
  scopeSheetFullscreen: boolean;
  closeScopeSheet: () => void;
  scopePopoverRef: RefObject<HTMLDivElement | null>;
  scopeFilterInputRef: RefObject<HTMLInputElement | null>;
  actionMenuTriggerRef: RefObject<HTMLButtonElement | null>;
  hasScopeFooterChip: boolean;
  scopePreview: string;
  scopeSummary: string;
  loadedScopeSummary: string;
  selectedDocumentIds: string[];
  documents: ClinicalDocument[];
  matchingDocuments: ClinicalDocument[];
  visibleScopeDocuments: ClinicalDocument[];
  requireScopeFilter: boolean;
  hiddenScopeMatchCount: number;
  scopeFilter: string;
  setScopeFilter: (filter: string) => void;
  onClearScope: () => void;
  onToggleScope: (documentId: string) => void;
  scopeFilters: SearchScopeFilters;
  onScopeFiltersChange: (filters: SearchScopeFilters) => void;
  queryMode: ClinicalQueryMode | "guidance";
  onQueryModeChange: (mode: ClinicalQueryMode | "guidance") => void;
  queryModeOptions: Array<{ value: ClinicalQueryMode | "guidance"; label: string }>;
  activeQuickFilterCount: number;
  activeLabelFilterCount: number;
  updateTextScopeFilter: (key: TextScopeFilterKey, value: string) => void;
}

export function MasterSearchHeaderScopePicker({
  usesScopeSheet,
  scopeOpen,
  scopeSheetOpen,
  scopeSheetFullscreen,
  closeScopeSheet,
  scopePopoverRef,
  scopeFilterInputRef,
  actionMenuTriggerRef,
  hasScopeFooterChip,
  scopePreview,
  scopeSummary,
  loadedScopeSummary,
  selectedDocumentIds,
  documents,
  matchingDocuments,
  visibleScopeDocuments,
  requireScopeFilter,
  hiddenScopeMatchCount,
  scopeFilter,
  setScopeFilter,
  onClearScope,
  onToggleScope,
  scopeFilters,
  onScopeFiltersChange,
  queryMode,
  onQueryModeChange,
  queryModeOptions,
  activeQuickFilterCount,
  activeLabelFilterCount,
  updateTextScopeFilter,
}: MasterSearchHeaderScopePickerProps) {
  function renderLabelScopeFilterGrid(compact = false) {
    return (
      <div className={cn("grid gap-2", compact ? "grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
        {labelScopeFilterFields.map((field) => (
          <label key={field.key} className="grid min-w-0 gap-1">
            <span className="text-2xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
              {field.label}
            </span>
            <input
              value={filterText(scopeFilters[field.key])}
              onChange={(event) => updateTextScopeFilter(field.key, event.target.value)}
              placeholder={field.placeholder}
              className={cn(
                fieldControlPlain,
                "min-w-0 text-xs font-semibold border-[color:var(--border-lux)] bg-[color:var(--surface-lux)]",
              )}
            />
          </label>
        ))}
      </div>
    );
  }

  function renderDocumentScopeSection() {
    return (
      <section className="min-w-0 rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] p-3 shadow-[var(--e2)]">
        <div className="mb-3 grid min-h-[4.25rem] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-[color:var(--clinical-accent-border)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--clinical-accent-soft)_72%,var(--surface-lux)_28%)_0%,var(--surface-lux)_72%)] p-3 shadow-[var(--shadow-inset)]">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]">
            <FileText className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold text-[color:var(--text-heading)]">{scopeSummary}</p>
            <p className="mt-0.5 line-clamp-2 text-xs font-medium leading-5 text-[color:var(--text-muted)]">
              {selectedDocumentIds.length
                ? "Only selected documents will be used for the next search."
                : "Search all indexed documents unless you pin specific sources."}
            </p>
          </div>
          <span className="nums shrink-0 rounded-md border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-2.5 py-1 text-2xs font-extrabold text-[color:var(--clinical-accent)]">
            {selectedDocumentIds.length ? `${selectedDocumentIds.length} picked` : loadedScopeSummary}
          </span>
        </div>
        <div className="grid gap-2.5">
          <label className="relative block">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--decoration-soft)]"
            />
            <input
              ref={scopeFilterInputRef}
              value={scopeFilter}
              onChange={(event) => setScopeFilter(event.target.value)}
              data-testid="document-scope-filter"
              aria-label="Filter document scope"
              placeholder="Filter documents by title or file"
              className={cn(
                fieldControlWithIcon,
                "font-semibold border-[color:var(--border-lux)] bg-[color:var(--surface-lux)]",
              )}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClearScope}
              className={cn(
                shellChip,
                selectedDocumentIds.length === 0
                  ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                  : "border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)]",
              )}
            >
              All documents
            </button>
            {scopeFilter ? (
              <span className="nums rounded-md border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] px-2 py-1 text-2xs font-semibold text-[color:var(--text-muted)] shadow-[var(--shadow-inset)]">
                {matchingDocuments.length} match{matchingDocuments.length === 1 ? "" : "es"}
              </span>
            ) : (
              <span className="rounded-md border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] px-2 py-1 text-2xs font-semibold text-[color:var(--text-muted)] shadow-[var(--shadow-inset)]">
                Recently updated first
              </span>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto pr-1 polished-scroll">
            <div className="grid gap-1.5">
              {requireScopeFilter && visibleScopeDocuments.length === 0 ? (
                <p className="rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] px-3 py-2 text-sm font-medium text-[color:var(--text-muted)] shadow-[var(--shadow-inset)]">
                  Type to filter {documents.length.toLocaleString()} loaded documents. Selected documents stay pinned
                  here.
                </p>
              ) : null}
              {visibleScopeDocuments.map((document) => {
                const selected = selectedDocumentIds.includes(document.id);
                return (
                  <button
                    key={document.id}
                    type="button"
                    onClick={() => onToggleScope(document.id)}
                    title={cleanDisplayTitle(document.title)}
                    className={cn(
                      "grid min-h-tap w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition motion-safe:duration-[var(--duration-quick)]",
                      selected
                        ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                        : "border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] text-[color:var(--text)] hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--surface-subtle)]",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-5 w-5 place-items-center rounded-md border",
                        selected
                          ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                          : "border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)]",
                      )}
                      aria-hidden
                    >
                      {selected ? <CircleCheck aria-hidden="true" className="h-3.5 w-3.5" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{documentScopeTitle(document)}</span>
                      <span className="nums block truncate text-2xs font-medium text-[color:var(--text-muted)]">
                        {documentScopeMeta(document)}
                      </span>
                      <DocumentTagCloud
                        labels={document.labels}
                        query={scopeFilter}
                        limit={2}
                        compact
                        expandable={false}
                        className="mt-1"
                      />
                    </span>
                    {selected ? (
                      <span className="rounded-md bg-[color:var(--clinical-accent-soft)] px-2 py-1 text-2xs font-bold text-[color:var(--clinical-accent)]">
                        In scope
                      </span>
                    ) : null}
                  </button>
                );
              })}
              {!requireScopeFilter && visibleScopeDocuments.length === 0 && documents.length > 0 ? (
                <p className="rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] px-3 py-2 text-sm font-medium text-[color:var(--text-muted)] shadow-[var(--shadow-inset)]">
                  No documents match that filter. Clear the filter or search by file name.
                </p>
              ) : null}
            </div>
          </div>
          {hiddenScopeMatchCount > 0 ? (
            <p className="nums px-1 text-xs font-medium text-[color:var(--text-muted)]">
              {requireScopeFilter
                ? `${loadedScopeSummary} documents. Type a title or file name to narrow the loaded list.`
                : `Showing ${visibleScopeDocuments.length} of ${matchingDocuments.length}. Keep typing to narrow the list.`}
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  function renderScopeRows() {
    return (
      <div className="grid gap-3">
        {renderDocumentScopeSection()}
        <details className="group min-w-0 rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] shadow-[var(--e2)] sm:hidden">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-semibold text-[color:var(--text-heading)]">
            <span>Refine search</span>
            <span className="flex items-center gap-2">
              <span className="nums rounded-full border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-2 py-1 text-2xs font-bold text-[color:var(--clinical-accent)]">
                {activeQuickFilterCount ? `${activeQuickFilterCount} active` : "Optional"}
              </span>
              <ChevronDown
                aria-hidden="true"
                className="h-3.5 w-3.5 text-[color:var(--clinical-accent)] transition group-open:rotate-180"
              />
            </span>
          </summary>
          <div className="grid gap-2.5 border-t border-[color:var(--border-lux)] p-3">
            <label className="grid gap-1">
              <span className="text-2xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                Search intent
              </span>
              <select
                value={queryMode}
                onChange={(event) => onQueryModeChange(event.target.value as ClinicalQueryMode | "guidance")}
                aria-label="Clinical query mode"
                className={cn(
                  fieldControlPlain,
                  "text-sm font-semibold border-[color:var(--border-lux)] bg-[color:var(--surface-lux)]",
                )}
              >
                {queryModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className="text-2xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                  Status
                </span>
                <select
                  value={scopeFilters.sourceStatuses?.[0] ?? ""}
                  aria-label="Source status filter"
                  onChange={(event) =>
                    onScopeFiltersChange({
                      ...scopeFilters,
                      sourceStatuses: event.target.value
                        ? [event.target.value as NonNullable<SearchScopeFilters["sourceStatuses"]>[number]]
                        : [],
                    })
                  }
                  className={cn(
                    fieldControlPlain,
                    "min-w-0 text-sm font-semibold border-[color:var(--border-lux)] bg-[color:var(--surface-lux)]",
                  )}
                >
                  <option value="">Any status</option>
                  <option value="current">Current</option>
                  <option value="review_due">Review due</option>
                  <option value="outdated">Outdated</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-2xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                  Locality
                </span>
                <select
                  value={scopeFilters.locality ?? ""}
                  aria-label="Locality filter"
                  onChange={(event) =>
                    onScopeFiltersChange({
                      ...scopeFilters,
                      locality: event.target.value ? (event.target.value as SearchScopeFilters["locality"]) : undefined,
                    })
                  }
                  className={cn(
                    fieldControlPlain,
                    "min-w-0 text-sm font-semibold border-[color:var(--border-lux)] bg-[color:var(--surface-lux)]",
                  )}
                >
                  <option value="">Any locality</option>
                  <option value="local">Local only</option>
                  <option value="non_local">Non-local only</option>
                </select>
              </label>
            </div>
            <details className="group rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-subtle)]">
              <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-semibold text-[color:var(--text-heading)]">
                <span>Advanced labels</span>
                <span className="flex items-center gap-2 text-2xs font-bold text-[color:var(--text-muted)]">
                  {activeLabelFilterCount ? `${activeLabelFilterCount} active` : "Medication, site, risk"}
                  <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" aria-hidden="true" />
                </span>
              </summary>
              <div className="grid gap-2 border-t border-[color:var(--border-lux)] p-2.5">
                {renderLabelScopeFilterGrid(true)}
              </div>
            </details>
            {activeQuickFilterCount ? (
              <button
                type="button"
                onClick={() => onScopeFiltersChange({})}
                className={cn(floatingControl, "px-3 text-xs lg:min-h-compact-meta")}
              >
                Clear refine filters
              </button>
            ) : null}
          </div>
        </details>
        <details className="group hidden min-w-0 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-2.5 sm:block">
          <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 px-0.5 lg:min-h-compact-meta">
            <span className={eyebrowText}>Label filters</span>
            <span className="flex items-center gap-2 text-2xs font-semibold text-[color:var(--text-muted)]">
              {activeLabelFilterCount ? `${activeLabelFilterCount} active` : "Medication, site, action, intent"}
              <ChevronDown
                aria-hidden="true"
                className="h-3.5 w-3.5 text-[color:var(--decoration-soft)] transition group-open:rotate-180"
              />
            </span>
          </summary>
          <div className="mt-2 grid gap-2 border-t border-[color:var(--border)] pt-2">
            {renderLabelScopeFilterGrid(false)}
            <button
              type="button"
              onClick={() => onScopeFiltersChange({})}
              className={cn(floatingControl, "w-fit px-3 text-xs lg:min-h-compact-meta")}
            >
              Clear refine filters
            </button>
          </div>
        </details>
      </div>
    );
  }

  return (
    <>
      {hasScopeFooterChip && !usesScopeSheet && scopeOpen ? (
        <div
          ref={scopePopoverRef}
          data-testid="scope-command-popover"
          className="polished-scroll absolute bottom-[calc(100%+0.75rem)] right-2 z-[95] max-h-[min(70dvh,28rem)] w-[min(28rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] p-2.5 pb-2.5 text-[color:var(--text)] shadow-[var(--e4)] backdrop-blur-xl motion-safe:animate-pop-in"
        >
          {scopePreview ? <p className="truncate px-1 text-xs text-[color:var(--text-muted)]">{scopePreview}</p> : null}
          {renderScopeRows()}
        </div>
      ) : null}
      <Sheet
        open={usesScopeSheet && scopeSheetOpen}
        onClose={closeScopeSheet}
        title="Document scope"
        description="Choose documents and filters for the next search."
        closeLabel="Close document scope"
        initialFocusRef={scopeFilterInputRef}
        returnFocusRef={actionMenuTriggerRef}
        headerLeading={
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]">
            <Filter className="h-5 w-5" aria-hidden="true" />
          </span>
        }
        headerClassName="bg-[color:var(--surface-lux)] px-4 py-3 sm:px-5 sm:py-4"
        closeButtonClassName="grid h-tap w-tap shrink-0 place-items-center rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        contentClassName={cn(
          "bg-[color:var(--surface-lux)]",
          scopeSheetFullscreen ? "max-h-dvh" : "max-h-[min(84dvh,42rem)]",
          "sm:max-h-[min(88dvh,44rem)] sm:max-w-xl",
        )}
        bodyClassName={cn(
          "p-3 sm:p-4",
          scopeSheetFullscreen ? "bg-[color:var(--background)]" : "bg-[color:var(--surface-subtle)]",
        )}
        mobilePlacement={scopeSheetFullscreen ? "fullscreen" : "bottom"}
        portal={scopeSheetFullscreen}
      >
        <div
          data-testid={usesScopeSheet ? "scope-command-popover" : undefined}
          className={cn(
            "grid gap-3",
            usesScopeSheet && "polished-scroll max-h-[min(70dvh,28rem)] overflow-y-auto overscroll-contain pr-1",
          )}
        >
          {scopePreview ? <p className="truncate px-1 text-xs text-[color:var(--text-muted)]">{scopePreview}</p> : null}
          {renderScopeRows()}
        </div>
      </Sheet>
    </>
  );
}
