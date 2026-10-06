"use client";

import type { RefObject } from "react";
import { Loader2, Search, X } from "lucide-react";
import { PhoneFooterLayerPortal } from "@/components/clinical-dashboard/phone-footer-layer-portal";
import { cn, controlDisabled, glassOverlaySurface, searchShellInput } from "@/components/ui-primitives";

export type DocumentViewerSearchComposerProps = {
  className?: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  scrollHidden: boolean;
  onFocusChange: (focused: boolean) => void;
  canViewSourceDocuments: boolean;
  normalizedSearch: string;
  isPending: boolean;
};

export function DocumentViewerSearchComposer({
  className,
  isOpen,
  onClose,
  onSubmit,
  search,
  onSearchChange,
  searchInputRef,
  scrollHidden,
  onFocusChange,
  canViewSourceDocuments,
  normalizedSearch,
  isPending,
}: DocumentViewerSearchComposerProps) {
  if (!isOpen) return null;

  return (
    <PhoneFooterLayerPortal>
      <form
        id="document-viewer-search"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
        data-scroll-hidden={scrollHidden ? "true" : undefined}
        onFocusCapture={() => onFocusChange(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            onFocusChange(false);
          }
        }}
        className={cn(
          "search-shell",
          glassOverlaySurface,
          "floating-composer-edge dashboard-composer-edge z-40 mx-auto flex min-h-[56px] max-w-3xl items-center gap-2 rounded-full bg-[color:var(--surface-lux)] px-2 shadow-[var(--e2)] max-sm:transition-[transform,opacity] motion-reduce:transition-none sm:fixed",
          className,
          scrollHidden
            ? "max-sm:duration-[var(--duration-slow)] max-sm:ease-[var(--ease-chrome-hide)]"
            : "max-sm:duration-[var(--duration-moderate)] max-sm:ease-[var(--ease-chrome-reveal)]",
        )}
      >
        <button
          type="button"
          onClick={onClose}
          className="grid h-tap w-tap shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)]"
          aria-label="Close document search"
          title="Close document search"
        >
          <X aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} />
        </button>
        <label className="relative flex min-w-0 flex-1 items-center overflow-hidden">
          <span className="sr-only">Search within this document</span>
          <input
            id="document-viewer-search-input"
            name="query"
            ref={searchInputRef}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search within this document…"
            className={cn(
              searchShellInput,
              "min-h-tap px-2 text-base font-medium text-[color:var(--text)] placeholder:text-[color:var(--text-placeholder)]",
            )}
          />
        </label>
        <button
          type="submit"
          disabled={!canViewSourceDocuments || normalizedSearch.length < 2}
          className={cn(
            "grid h-tap w-tap shrink-0 place-items-center rounded-full bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)] shadow-[var(--shadow-inset),var(--e1)] hover:bg-[color:var(--clinical-accent-hover)]",
            controlDisabled,
          )}
          aria-label="Search within this document"
        >
          {isPending ? (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <Search aria-hidden="true" className="h-4 w-4" />
          )}
        </button>
      </form>
    </PhoneFooterLayerPortal>
  );
}
