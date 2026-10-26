"use client";

import { ChevronDown, ListCollapse, Loader2 } from "lucide-react";
import type { RefObject } from "react";

import { cn } from "@/components/ui-primitives";
import { Sheet } from "@/components/ui/sheet";
import type { DocumentSection } from "@/components/document-viewer/section-index";
import { resolveSectionElement } from "@/components/document-viewer/use-section-spy";
import { resolveScrollBehavior } from "@/lib/scroll-behavior";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

/**
 * Moves the reader to a section.
 *
 * The collapsible sections are an exclusive accordion, so a jump has to open the
 * target before scrolling — otherwise it lands on a closed summary bar and looks
 * like nothing happened. Opening changes layout, so the scroll waits a frame.
 * Vertical offset comes from `--document-anchor-offset`, published from the live
 * collapse-row height, rather than a fixed `scroll-mt`.
 */
export function jumpToDocumentSection(id: string) {
  if (typeof window === "undefined") return;
  // The displayed copy, not just the first match: a section can be rendered for
  // one breakpoint and hidden for another.
  const target = resolveSectionElement(id) ?? window.document.getElementById(id);

  window.document
    .querySelectorAll<HTMLDetailsElement>('details[name="document-viewer-section"]')
    .forEach((disclosure) => {
      if (disclosure !== target) disclosure.open = false;
    });
  if (target instanceof HTMLDetailsElement) target.open = true;
  if (!target) return;

  window.requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: resolveScrollBehavior(), block: "start" });
  });
}

/**
 * Position as two pixels of height. Segments are weighted by each section's share
 * of the document, so this reads as "how far through", not "which of seven".
 * The active segment is taller as well as tinted so forced-colors keeps it legible.
 */
export function DocumentSectionTrack({
  sections,
  activeId,
  className,
}: {
  sections: DocumentSection[];
  activeId: string | null;
  className?: string;
}) {
  if (sections.length === 0) return null;
  const activeIndex = sections.findIndex((section) => section.id === activeId);

  return (
    <span aria-hidden="true" className={cn("absolute inset-x-0 bottom-0 flex items-end gap-px px-1.5", className)}>
      {sections.map((section, index) => (
        <span
          key={section.id}
          style={{ flexGrow: section.weight }}
          className={cn(
            "min-w-[6px] shrink rounded-full transition-[height,background-color] motion-reduce:transition-none",
            index === activeIndex
              ? "h-[3px] bg-[color:var(--clinical-accent)]"
              : index < activeIndex
                ? "h-0.5 bg-[color:var(--clinical-accent)]/40"
                : "h-0.5 bg-[color:var(--border-strong)]/35",
          )}
        />
      ))}
    </span>
  );
}

export function DocumentSectionList({
  sections,
  activeId,
  onSelect,
}: {
  sections: DocumentSection[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {sections.map((section) => {
        const selected = section.id === activeId;
        const Icon = section.icon;

        return (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => onSelect(section.id)}
              aria-current={selected ? "true" : undefined}
              className={cn(
                "relative flex min-h-tap w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition",
                focusRing,
                selected
                  ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                  : "text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)]",
              )}
            >
              {selected ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-[color:var(--clinical-accent)]"
                />
              ) : null}
              <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-xs font-bold">{section.label}</span>
              <span
                className={cn(
                  "nums flex shrink-0 items-center gap-1 text-3xs font-semibold",
                  section.pending ? "text-[color:var(--clinical-accent)]" : "text-[color:var(--text-muted)]",
                )}
              >
                {section.pending ? <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" /> : null}
                {section.detail}
              </span>
              {section.collapsible ? (
                <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[color:var(--decoration-soft)]" />
              ) : (
                <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SectionListHeading({ sections, activeId }: { sections: DocumentSection[]; activeId: string | null }) {
  const position = sections.findIndex((section) => section.id === activeId) + 1;

  return (
    <div className="flex items-baseline justify-between px-0.5 pb-2">
      <p className="text-3xs font-black uppercase tracking-kicker text-[color:var(--clinical-accent)]">
        In this document
      </p>
      <p className="nums text-3xs font-bold text-[color:var(--text-muted)]">
        {Math.max(position, 1)}/{sections.length}
      </p>
    </div>
  );
}

export function DocumentViewDensityToggle({
  compact,
  onCompactChange,
  className,
}: {
  compact: boolean;
  onCompactChange: (compact: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-testid="document-view-density-toggle"
      aria-pressed={compact}
      // Named by the words it shows, with the pressed state saying whether it is on
      // (WCAG 2.5.3, A11Y-02).
      title={compact ? "Show the full indexed text" : "Collapse long document sections"}
      onClick={() => onCompactChange(!compact)}
      className={cn(
        "flex min-h-tap w-full items-center gap-2.5 rounded-lg border px-2.5 text-left transition",
        focusRing,
        compact
          ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
          : "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)]",
        className,
      )}
    >
      <ListCollapse aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold">{compact ? "Condensed view" : "Full view"}</span>{" "}
        <span className="block truncate text-3xs font-semibold">
          {compact ? "Long sections collapsed" : "All indexed text shown"}
        </span>
      </span>{" "}
      <span className="text-3xs font-black uppercase tracking-eyebrow">{compact ? "On" : "Off"}</span>
    </button>
  );
}

/** Desktop and tablet placement: a card in the column the viewer already renders. */
export function DocumentSectionIndexCard({
  sections,
  activeId,
  onSelect,
  compact,
  onCompactChange,
  className,
}: {
  sections: DocumentSection[];
  activeId: string | null;
  onSelect: (id: string) => void;
  compact: boolean;
  onCompactChange: (compact: boolean) => void;
  className?: string;
}) {
  if (sections.length === 0) return null;

  return (
    <nav
      aria-label="Document sections"
      data-testid="document-section-index"
      className={cn(
        "rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-2.5 shadow-[var(--e1)]",
        className,
      )}
    >
      <SectionListHeading sections={sections} activeId={activeId} />
      <DocumentViewDensityToggle compact={compact} onCompactChange={onCompactChange} className="mb-2" />
      <DocumentSectionList sections={sections} activeId={activeId} onSelect={onSelect} />
    </nav>
  );
}

/**
 * Phone placement. A sheet is not viewport chrome, so it adds no reserve and no
 * second scroll owner — the reason navigation lives here rather than in a pane
 * hanging off a header row that scroll-hides.
 */
export function DocumentSectionSheet({
  open,
  onClose,
  sections,
  activeId,
  onSelect,
  documentTitle,
  returnFocusRef,
  compact,
  onCompactChange,
}: {
  open: boolean;
  onClose: () => void;
  sections: DocumentSection[];
  activeId: string | null;
  onSelect: (id: string) => void;
  documentTitle: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
  compact: boolean;
  onCompactChange: (compact: boolean) => void;
}) {
  const active = sections.find((section) => section.id === activeId) ?? sections[0];
  const position = sections.findIndex((section) => section.id === activeId) + 1;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={documentTitle}
      description={
        active
          ? `${active.label} · section ${Math.max(position, 1)} of ${sections.length}. Sections with a down arrow expand when you open them.`
          : undefined
      }
      closeLabel="Close section list"
      returnFocusRef={returnFocusRef}
      testId="document-section-sheet"
    >
      <DocumentViewDensityToggle compact={compact} onCompactChange={onCompactChange} className="mb-3" />
      <DocumentSectionList
        sections={sections}
        activeId={activeId}
        onSelect={(id) => {
          onSelect(id);
          onClose();
        }}
      />
    </Sheet>
  );
}
