"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, FileText, Network, ShieldAlert } from "lucide-react";

import { pageHeadingDescriptionClass, pageHeadingTitleClass } from "@/components/ui/page-header";
import { cn } from "@/components/ui-primitives";

import {
  ResultFilterSheet,
  ResultFilterTrigger,
  resultFilterFacetGroup,
  resultFilterGroup,
  type ResultFilterGroup,
} from "@/components/clinical-dashboard/result-filter-control";
import {
  SearchResultsHeaderBand,
  type AppliedFilterChip,
} from "@/components/clinical-dashboard/search-results-header-band";
import { ContextualBackLink } from "@/components/contextual-back-link";
import { appModeHomeHref } from "@/lib/app-modes";
import { normalizeSearchText } from "@/lib/catalog-search";
import {
  readResultFilterValue,
  readResultFilterValues,
  replaceResultFilterUrl,
  writeResultFilterValue,
  writeResultFilterValues,
} from "@/lib/result-filter-url";
import { stretchedRowLinkClass } from "@/components/card-recipes";
import {
  FilterHighlightNote,
  FilterNotMatchingHeading,
  filterOutsideTitleClass,
} from "@/components/clinical-dashboard/filter-highlight";
import { SharedCompareTray } from "@/components/compare/shared-compare-tray";
import { usePhoneMedia } from "@/components/compare/use-phone-media";
import { differentialRouteWithQuery, differentialSelectedCompareHref } from "@/lib/differentials-navigation";
import { differentialsMobileCompareAddonSlotId } from "@/lib/mode-home-composer";
import type {
  DifferentialStreamItem,
  DifferentialStreamModel,
  DifferentialStreamType,
} from "@/lib/differential-stream-model";
import type { DifferentialLikelihood } from "@/lib/differential-snapshot";

type BrowseGrouping = "urgency" | "presentation";
type PresentationPriority = "all" | DifferentialStreamItem["status"];
type DifferentialResultScope = "matches" | "all";

const priorityValues = new Set<PresentationPriority>(["all", "emergent", "urgent", "routine"]);
const scopeValues = new Set<DifferentialResultScope>(["matches", "all"]);

type DifferentialStreamWorkspaceProps = {
  model: DifferentialStreamModel;
  query: string;
  initialFocus?: string;
};

const streamCopy: Record<DifferentialStreamType, { heading: string; description: string }> = {
  presentations: {
    heading: "Presentations",
    description: "Start with what is happening now, then open a pathway to compare likely causes.",
  },
  diagnoses: {
    heading: "Diagnoses",
    description: "Compare likely causes and exclusion clues.",
  },
};

function statusLabel(status: DifferentialStreamItem["status"]) {
  if (status === "emergent") return "Emergent";
  if (status === "urgent") return "Urgent";
  return "Routine";
}

function statusTone(status: DifferentialStreamItem["status"]) {
  // Emergent stays red because it is a genuine urgency, but as a tag rather
  // than a solid red block: most pathways carry it, and a wall of solid red
  // stops reading as a warning (design pass, October 2026).
  if (status === "emergent") {
    return "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]";
  }
  if (status === "urgent") {
    return "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]";
  }
  return "border-[color:var(--info-border)] bg-[color:var(--info-soft)] text-[color:var(--info)]";
}

function likelihoodTone(likelihood: DifferentialLikelihood) {
  if (likelihood === "must-not-miss") {
    return "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]";
  }
  if (likelihood === "most-likely") {
    return "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]";
  }
  if (likelihood === "possible") {
    return "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]";
  }
  return "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)]";
}

function StreamCard({
  item,
  stream,
  query,
  highlight,
  selected,
  showSelect,
  focusMode,
  outsideFilter = false,
  onFocus,
  onToggleSelect,
  onShowConnections,
}: {
  item: DifferentialStreamItem;
  stream: DifferentialStreamType;
  query: string;
  highlight: "match" | "related" | "dim" | "neutral";
  /** Outside the active urgency/chapter filter: still listed, title muted by token. */
  outsideFilter?: boolean;
  selected: boolean;
  showSelect: boolean;
  focusMode: boolean;
  onFocus: () => void;
  onToggleSelect: () => void;
  onShowConnections: () => void;
}) {
  const isPresentation = stream === "presentations";
  const href = isPresentation ? differentialRouteWithQuery(item.href, query) : item.href;
  // Diagnoses list their related diagnoses ONCE, as chips. The old card printed
  // the first three again as a document-icon list above the chips; any label
  // that list held and the chips lack (a related entry with no page of its own)
  // is appended as a plain chip, so nothing the card used to show is lost.
  const relatedChips = isPresentation ? [] : relatedDiagnosisChips(item);
  const hasConnections = isPresentation ? item.relatedPathways.length > 0 : true;
  // Each pathway is a divided row inside the list's one hairline card, so the
  // highlight is a background wash only: a coloured border would fight the
  // dividers and read as a card inside a card.
  const cardTone =
    highlight === "match"
      ? "bg-[color:var(--clinical-accent-soft)]"
      : highlight === "related"
        ? "bg-[color:var(--warning-soft)]"
        : highlight === "dim"
          ? "opacity-45"
          : "";

  return (
    <article
      id={`differential-stream-card-${item.slug}`}
      data-testid={`differential-stream-card-${item.slug}`}
      data-highlight={highlight}
      data-match={item.isMatch ? "true" : "false"}
      data-status={item.status}
      data-outside-filter={outsideFilter ? "true" : undefined}
      className={`relative p-4 transition ${outsideFilter ? "" : cardTone}`}
      onFocus={onFocus}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* The title is the row's open control, stretched across the card,
                so the separate full-width Open button is gone. */}
            <h3
              className={cn(
                "text-sm font-bold",
                outsideFilter ? filterOutsideTitleClass : "text-[color:var(--text-heading)]",
              )}
            >
              <Link
                href={href}
                onClick={onFocus}
                data-testid={`differential-stream-open-${item.slug}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                  stretchedRowLinkClass,
                )}
              >
                {item.title}
                <ChevronRight className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" aria-hidden />
                <span className="sr-only">{isPresentation ? ", open pathway" : ", open"}</span>
              </Link>
            </h3>
            <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-bold ${statusTone(item.status)}`}>
              {statusLabel(item.status)}
            </span>
          </div>
          <p className="text-sm text-[color:var(--text-muted)]">{item.description}</p>
          {isPresentation && item.candidateCount !== null ? (
            <p className="text-xs font-semibold text-[color:var(--clinical-accent)]">
              {item.candidateCount} differential candidate{item.candidateCount === 1 ? "" : "s"}
            </p>
          ) : null}
        </div>
        {showSelect ? (
          <label className="relative z-10 inline-flex size-tap shrink-0 cursor-pointer items-center justify-center rounded-md p-2">
            <span className="sr-only">
              {selected ? `Remove ${item.title} from comparison` : `Add ${item.title} to comparison`}
            </span>
            <input type="checkbox" checked={selected} onChange={onToggleSelect} className="peer sr-only" />
            <span
              data-testid="differential-selection-box"
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-sm border text-transparent transition hover:border-[color:var(--clinical-accent-border)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--focus)]",
                selected
                  ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
                  : "border-[color:var(--border-strong)] bg-[color:var(--surface)]",
              )}
              aria-hidden="true"
            >
              <Check aria-hidden="true" className="size-icon-sm stroke-[2.5]" />
            </span>
          </label>
        ) : null}
      </div>

      {item.matchReasons.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Match reasons">
          {item.matchReasons.map((reason) => (
            <li
              key={`${item.id}:${reason}`}
              className="rounded-md border border-[color:var(--clinical-accent-border)] bg-[color:var(--surface)] px-2 py-0.5 text-xs font-semibold text-[color:var(--clinical-accent)]"
            >
              {reason}
            </li>
          ))}
        </ul>
      ) : null}

      {item.exclusionPreview ? (
        <p className="mt-2 text-xs leading-5 text-[color:var(--text-muted)]">
          <span className="font-bold text-[color:var(--warning)]">Exclusion / mimics: </span>
          {item.exclusionPreview}
        </p>
      ) : null}

      {isPresentation ? (
        <>
          {item.examples.length > 0 ? (
            <p className="mt-2 text-xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
              Safety cues
            </p>
          ) : null}
          <ul className="mt-1 flex flex-col gap-1 text-xs leading-6 text-[color:var(--text-muted)]">
            {item.examples.map((example, index) => (
              <li key={`${item.href}:${index}:${example}`} className="flex items-start gap-2">
                <FileText className="mt-0.5 h-4 w-4 text-[color:var(--text-muted)]" aria-hidden />
                {example}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="mt-2.5 flex items-end gap-2">
        {relatedChips.length > 0 ? (
          <ul
            className="flex min-w-0 flex-1 flex-wrap gap-1.5"
            aria-label="Related diagnoses"
            data-testid="differential-stream-related"
          >
            {relatedChips.map((chip) => (
              <li
                key={`${item.id}:${chip.key}`}
                className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${chip.tone}`}
              >
                {chip.label}
              </li>
            ))}
          </ul>
        ) : (
          <span className="flex-1" />
        )}
        {hasConnections ? (
          <button
            type="button"
            onClick={() => {
              onFocus();
              onShowConnections();
            }}
            className="relative z-10 -mr-2 -mb-2 inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            <Network className="size-icon-sm shrink-0" aria-hidden />
            {/* Phones keep the icon only (the words stay the accessible name);
                wider screens show the label beside it. */}
            <span className={isPresentation ? undefined : "max-sm:sr-only"}>
              {isPresentation
                ? focusMode
                  ? "Pathways focused"
                  : "Related pathways"
                : focusMode
                  ? "Family focused"
                  : "Show family"}
            </span>
            {isPresentation ? null : <span className="sr-only">: {item.title}</span>}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function relatedDiagnosisChips(item: DifferentialStreamItem) {
  const linked = item.related.slice(0, 4);
  return [
    ...linked.map((node) => ({ key: node.slug, label: node.label, tone: likelihoodTone(node.likelihood) })),
    ...item.examples
      .filter((label) => !linked.some((node) => node.label === label))
      .map((label) => ({ key: `example:${label}`, label, tone: likelihoodTone("possible") })),
  ];
}

function StreamGroupingControl({
  browseGrouping,
  onBrowseGroupingChange,
}: {
  browseGrouping: BrowseGrouping;
  onBrowseGroupingChange: (grouping: BrowseGrouping) => void;
}) {
  const optionClass = (selected: boolean) =>
    [
      // `min-h-tap`, not `min-h-10`: this control renders in the results band's
      // utility rail, which is a swipe rail below `lg` rather than below `sm`,
      // so it is a live phone tap target and was under the 48px floor.
      "inline-flex min-h-tap items-center rounded-lg border px-3 text-xs font-bold transition-colors motion-reduce:transition-none",
      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
      selected
        ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
        : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)]",
    ].join(" ");

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Group diagnoses">
      <button
        type="button"
        onClick={() => onBrowseGroupingChange("urgency")}
        aria-pressed={browseGrouping === "urgency"}
        className={optionClass(browseGrouping === "urgency")}
      >
        By urgency
      </button>
      <button
        type="button"
        onClick={() => onBrowseGroupingChange("presentation")}
        aria-pressed={browseGrouping === "presentation"}
        className={optionClass(browseGrouping === "presentation")}
      >
        By presentation
      </button>
    </div>
  );
}

export function DifferentialStreamWorkspace({ model, query, initialFocus = "" }: DifferentialStreamWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const copy = streamCopy[model.stream];
  const isPresentation = model.stream === "presentations";
  // Match buildDifferentialStreamModel: punctuation-only queries are browse mode.
  const hasQuery = Boolean(normalizeSearchText(query));
  const matchItems = useMemo(() => model.items.filter((item) => item.isMatch), [model.items]);
  const itemBySlug = useMemo(() => new Map(model.items.map((item) => [item.slug, item])), [model.items]);
  const itemById = useMemo(() => new Map(model.items.map((item) => [item.id, item])), [model.items]);
  const chapterFilterOptions = useMemo(
    () => [
      ...model.chapters.map((chapter) => ({
        value: `chapter:${chapter.id}`,
        label: chapter.title,
        section: "chapters" as const,
        itemIds: new Set(chapter.itemIds),
      })),
      ...(model.stream === "diagnoses"
        ? model.presentationChapters.map((chapter) => ({
            value: `presentation:${chapter.id}`,
            label: chapter.title,
            section: "presentations" as const,
            itemIds: new Set(chapter.itemIds),
          }))
        : []),
    ],
    [model.chapters, model.presentationChapters, model.stream],
  );
  const chapterItemIdsByValue = useMemo(
    () => new Map(chapterFilterOptions.map((option) => [option.value, option.itemIds])),
    [chapterFilterOptions],
  );
  const chapterFilterValues = useMemo(
    () => new Set(chapterFilterOptions.map((option) => option.value)),
    [chapterFilterOptions],
  );
  const defaultScope: DifferentialResultScope = hasQuery ? "matches" : "all";
  const resultScope = readResultFilterValue(searchParams, "scope", scopeValues, defaultScope);
  const presentationPriority = readResultFilterValue(searchParams, "priority", priorityValues, "all");
  const selectedChapterFilters = new Set(readResultFilterValues(searchParams, "chapter", chapterFilterValues));

  const [focusedSlug, setFocusedSlug] = useState<string | null>(() => {
    const requested = initialFocus.trim().toLowerCase();
    if (requested && itemBySlug.has(requested)) return requested;
    return matchItems[0]?.slug ?? null;
  });
  const [browseGrouping, setBrowseGrouping] = useState<BrowseGrouping>("urgency");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const filterPanelId = useId();
  const didAutoJumpForFocus = useRef("");

  const setResultScope = (value: DifferentialResultScope) =>
    replaceResultFilterUrl((params) => writeResultFilterValue(params, "scope", value, defaultScope, scopeValues));
  const setPresentationPriority = (value: PresentationPriority) =>
    replaceResultFilterUrl((params) => writeResultFilterValue(params, "priority", value, "all", priorityValues));
  const setFamilyMode = (enabled: boolean) =>
    replaceResultFilterUrl((params) => {
      if (enabled) params.set("related", "1");
      else params.delete("related");
    });

  const resultSignature = matchItems.map((item) => item.slug).join("|");
  const [lastResultSignature, setLastResultSignature] = useState("");
  if (lastResultSignature !== resultSignature) {
    setLastResultSignature(resultSignature);
    if (model.stream === "diagnoses") {
      setSelectedIds(new Set(model.compareSeedIds));
    } else {
      setSelectedIds(new Set());
    }
    if (!initialFocus.trim() && matchItems[0]) {
      setFocusedSlug(matchItems[0].slug);
    }
  }

  const focusedItem = focusedSlug ? (itemBySlug.get(focusedSlug) ?? null) : null;
  const familyMode = Boolean(focusedItem && searchParams.get("related") === "1");
  const relatedSlugSet = useMemo(() => {
    if (!focusedItem) return new Set<string>();
    return new Set(
      isPresentation
        ? focusedItem.relatedPathways.map((node) => node.slug)
        : focusedItem.related.map((node) => node.slug),
    );
  }, [focusedItem, isPresentation]);

  const filterStreamItems = (
    scope: DifferentialResultScope,
    priority: PresentationPriority,
    chapters: ReadonlySet<string>,
    related: boolean,
  ) =>
    model.items.filter((item) => {
      if (scope === "matches" && !item.isMatch) return false;
      if (related && focusedItem && item.slug !== focusedItem.slug && !relatedSlugSet.has(item.slug)) return false;
      if (priority !== "all" && item.status !== priority) return false;
      if (chapters.size > 0) {
        let inSelectedChapter = false;
        for (const token of chapters) {
          if (chapterItemIdsByValue.get(token)?.has(item.id)) {
            inSelectedChapter = true;
            break;
          }
        }
        if (!inSelectedChapter) return false;
      }
      return true;
    });
  const visibleItems = filterStreamItems(resultScope, presentationPriority, selectedChapterFilters, familyMode);
  // Filters highlight, never hide: urgency and chapter filters pick the rows
  // that come first; every other row in scope stays, listed after them under
  // "Not emergent" (or "Not matching"). Search scope and the family view still
  // define the set itself.
  const highlightFilterActive = presentationPriority !== "all" || selectedChapterFilters.size > 0;
  const scopeItems = filterStreamItems(resultScope, "all", new Set(), familyMode);
  const visibleIds = new Set(visibleItems.map((item) => item.id));
  const outsideItems = highlightFilterActive ? scopeItems.filter((item) => !visibleIds.has(item.id)) : [];
  const outsideLabel =
    presentationPriority !== "all" && selectedChapterFilters.size === 0
      ? `Not ${statusLabel(presentationPriority).toLowerCase()}`
      : "Not matching";

  const activeChapters =
    !hasQuery && model.stream === "diagnoses"
      ? browseGrouping === "presentation"
        ? model.presentationChapters
        : model.chapters
      : model.chapters;

  function scrollToSlug(slug: string) {
    setFocusedSlug(slug);
    setFamilyMode(false);
    setPresentationPriority("all");
    window.requestAnimationFrame(() => {
      const node = document.getElementById(`differential-stream-card-${slug}`);
      if (!node) return;
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      node.scrollIntoView({ behavior, block: "center" });
    });
  }

  useEffect(() => {
    const target = initialFocus.trim().toLowerCase();
    if (!target || !itemBySlug.has(target)) return;
    const focusKey = `${model.stream}:${target}:${resultSignature}`;
    if (didAutoJumpForFocus.current === focusKey) return;
    didAutoJumpForFocus.current = focusKey;
    // Defer one frame so cards are in the DOM after hydration.
    const frame = window.requestAnimationFrame(() => {
      const node = document.getElementById(`differential-stream-card-${target}`);
      if (!node) return;
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      node.scrollIntoView({ behavior, block: "center" });
      setFocusedSlug(target);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialFocus, itemBySlug, model.stream, resultSignature]);

  function highlightFor(item: DifferentialStreamItem): "match" | "related" | "dim" | "neutral" {
    if (!hasQuery && !familyMode) {
      if (focusedSlug && item.slug === focusedSlug) return "match";
      if (focusedSlug && relatedSlugSet.has(item.slug)) return "related";
      return "neutral";
    }
    if (item.isMatch) return "match";
    if (relatedSlugSet.has(item.slug) || (focusedSlug && item.slug === focusedSlug)) return "related";
    if (hasQuery) return "dim";
    return "neutral";
  }

  function toggleSelected(slug: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function applyPreset(presetQuery: string) {
    router.push(differentialRouteWithQuery("/differentials/diagnoses", presetQuery));
  }

  const safetyItems = model.safetyShelfIds
    .map((id) => itemById.get(id))
    .filter((item): item is DifferentialStreamItem => Boolean(item));

  const selectedCount = selectedIds.size;
  const showSelect = model.stream === "diagnoses";
  const showBrowseGrouping = !hasQuery && model.stream === "diagnoses";
  // One grouping control, placed by width: on phones it sits on its own row under
  // the band, so the band line holds only the count and Filter and the count
  // ("201 differentials") is never clipped to "20".
  const phone = usePhoneMedia();
  const showConnectionFilter = Boolean(focusedItem && (!isPresentation || focusedItem.relatedPathways.length > 0));
  const mobileFilterGroups: ResultFilterGroup[] = [];
  if (filterOpen) {
    mobileFilterGroups.push(
      resultFilterGroup<PresentationPriority>({
        id: "priority",
        label: "Clinical urgency",
        value: presentationPriority,
        options: (["all", "emergent", "urgent", "routine"] as const).map((value) => ({
          value,
          label: value === "all" ? "All priorities" : statusLabel(value),
          hint: String(filterStreamItems(resultScope, value, selectedChapterFilters, familyMode).length),
        })),
        onChange: setPresentationPriority,
      }),
    );
    if (model.stream === "diagnoses" && chapterFilterOptions.length > 0) {
      mobileFilterGroups.push(
        resultFilterFacetGroup({
          id: "chapter",
          label: "Chapter or presentation",
          description: "Alternatives in this group combine with OR.",
          selected: selectedChapterFilters,
          optionSections: [
            {
              id: "chapters",
              label: "Diagnostic chapters",
              optionValues: chapterFilterOptions
                .filter((option) => option.section === "chapters")
                .map((option) => option.value),
            },
            {
              id: "presentations",
              label: "Presentation families",
              optionValues: chapterFilterOptions
                .filter((option) => option.section === "presentations")
                .map((option) => option.value),
            },
          ],
          options: chapterFilterOptions.map((option) => {
            const withCandidate = new Set(selectedChapterFilters);
            if (!withCandidate.has(option.value)) withCandidate.add(option.value);
            const count = filterStreamItems(resultScope, presentationPriority, withCandidate, familyMode).length;
            return {
              value: option.value,
              label: option.label,
              hint: String(count),
              disabled: count === 0 && !selectedChapterFilters.has(option.value),
            };
          }),
          onToggle: (value) =>
            replaceResultFilterUrl((params) => {
              const next = new Set(readResultFilterValues(params, "chapter", chapterFilterValues));
              if (!next.delete(value)) next.add(value);
              writeResultFilterValues(params, "chapter", next, chapterFilterValues);
            }),
        }),
      );
    }
    if (focusedItem && showConnectionFilter) {
      mobileFilterGroups.push(
        resultFilterGroup<"all" | "family">({
          id: isPresentation ? "pathways" : "family",
          label: isPresentation ? "Related pathways" : "Family view",
          value: familyMode ? "family" : "all",
          options: [
            { value: "all", label: isPresentation ? "All pathways" : "All entries" },
            {
              value: "family",
              label: isPresentation ? "Related pathways" : "Focused family",
              hint: focusedItem.title,
            },
          ],
          onChange: (value) => setFamilyMode(value === "family"),
        }),
      );
    }
  }
  const activeFilterCount =
    Number(familyMode) +
    Number(resultScope !== defaultScope) +
    Number(presentationPriority !== "all") +
    selectedChapterFilters.size;
  const appliedFilters: AppliedFilterChip[] = [];
  if (resultScope !== defaultScope) {
    appliedFilters.push({
      id: "scope",
      groupLabel: "Search in",
      valueLabel: resultScope === "all" ? "All entries" : "Matches",
      onRemove: () => setResultScope(defaultScope),
    });
  }
  if (presentationPriority !== "all") {
    appliedFilters.push({
      id: "priority",
      groupLabel: "Priority",
      valueLabel: statusLabel(presentationPriority),
      onRemove: () => setPresentationPriority("all"),
    });
  }
  for (const token of selectedChapterFilters) {
    const option = chapterFilterOptions.find((item) => item.value === token);
    if (!option) continue;
    appliedFilters.push({
      id: token,
      groupLabel: option.section === "presentations" ? "Presentation" : "Chapter",
      valueLabel: option.label,
      onRemove: () =>
        replaceResultFilterUrl((params) => {
          const next = new Set(readResultFilterValues(params, "chapter", chapterFilterValues));
          next.delete(token);
          writeResultFilterValues(params, "chapter", next, chapterFilterValues);
        }),
    });
  }
  if (familyMode && focusedItem) {
    appliedFilters.push({
      id: isPresentation ? "pathways" : "family",
      groupLabel: isPresentation ? "Related pathways" : "Family",
      valueLabel: focusedItem.title,
      onRemove: () => setFamilyMode(false),
    });
  }

  function clearStreamFilters() {
    replaceResultFilterUrl((params) => {
      params.delete("scope");
      params.delete("priority");
      params.delete("chapter");
      params.delete("related");
    });
  }

  function clearHighlightFilters() {
    replaceResultFilterUrl((params) => {
      params.delete("priority");
      params.delete("chapter");
    });
  }

  function renderGrouped(items: DifferentialStreamItem[], outsideFilter: boolean): ReactNode {
    if (items.length === 0) return null;
    if (hasQuery || familyMode || activeChapters.length === 0) return renderCardGrid(items, outsideFilter);
    const ids = new Set(items.map((item) => item.id));
    return activeChapters.map((chapter) => {
      const chapterItems = chapter.itemIds
        .map((id) => itemById.get(id))
        .filter((item): item is DifferentialStreamItem => Boolean(item))
        .filter((item) => ids.has(item.id));
      if (chapterItems.length === 0) return null;
      const keyPrefix = outsideFilter ? "outside-" : "";
      return (
        <div
          key={`${keyPrefix}${chapter.id}`}
          data-testid={`differential-stream-chapter-${keyPrefix}${chapter.id}`}
          className="grid gap-2"
        >
          <div className="pt-2">
            <h3
              className={cn(
                "text-sm font-extrabold",
                outsideFilter ? filterOutsideTitleClass : "text-[color:var(--text-heading)]",
              )}
            >
              {chapter.title}
            </h3>
            <p className="text-xs text-[color:var(--text-muted)]">{chapter.description}</p>
          </div>
          {renderCardGrid(chapterItems, outsideFilter)}
        </div>
      );
    });
  }

  function renderCardGrid(items: DifferentialStreamItem[], outsideFilter = false): ReactNode {
    return (
      // One hairline card per group with divided rows (no cards inside cards).
      // From the two-column width each row draws its own bottom and inner
      // right hairline; the -mb-px tucks the last row's bottom line under the
      // card's clipped edge so it is never doubled.
      <div className="grid divide-y divide-[color:var(--border)] overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] sm:grid-cols-2 sm:divide-y-0 sm:[&>*]:-mb-px sm:[&>*]:border-b sm:[&>*]:border-[color:var(--border)] sm:[&>*:nth-child(odd)]:border-r">
        {items.map((item) => (
          <StreamCard
            key={item.id}
            item={item}
            stream={model.stream}
            query={query}
            highlight={highlightFor(item)}
            selected={selectedIds.has(item.slug)}
            showSelect={showSelect}
            focusMode={familyMode && focusedSlug === item.slug}
            outsideFilter={outsideFilter}
            onFocus={() => setFocusedSlug(item.slug)}
            onToggleSelect={() => toggleSelected(item.slug)}
            onShowConnections={() => {
              setFocusedSlug(item.slug);
              setFamilyMode(true);
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <main
      data-testid="differentials-stream-workspace"
      className="min-h-0 overflow-x-clip bg-[color:var(--background)] px-4 py-5 text-[color:var(--text)] sm:grow sm:px-6 sm:py-6 lg:px-8"
    >
      <div className="mx-auto grid w-full max-w-6xl gap-4">
        <header data-testid="differentials-stream-header" className="grid gap-1.5 px-1">
          <h1 className={pageHeadingTitleClass}>{copy.heading}</h1>
          <p className={pageHeadingDescriptionClass}>{copy.description}</p>
        </header>

        <SearchResultsHeaderBand
          modeId="differentials"
          query={hasQuery ? query : ""}
          matchCount={scopeItems.length}
          headingLevel={2}
          filterLabel={isPresentation ? "Presentation pathway controls" : `${copy.heading} catalogue controls`}
          mobileControlsPlacement="inline"
          mobileControls={
            <ResultFilterTrigger
              panelId={filterPanelId}
              testId="differentials-stream-filter-trigger"
              open={filterOpen}
              activeCount={activeFilterCount}
              onToggle={() => setFilterOpen((current) => !current)}
              title={`Filter ${copy.heading.toLowerCase()}`}
            />
          }
          utilityControls={
            showBrowseGrouping && !phone ? (
              <StreamGroupingControl browseGrouping={browseGrouping} onBrowseGroupingChange={setBrowseGrouping} />
            ) : undefined
          }
          filterControls={
            <ResultFilterTrigger
              panelId={filterPanelId}
              testId="differentials-stream-filter-trigger-desktop"
              open={filterOpen}
              activeCount={activeFilterCount}
              onToggle={() => setFilterOpen((current) => !current)}
              title={`Filter ${copy.heading.toLowerCase()}`}
            />
          }
          appliedFilters={appliedFilters}
          onClearFilters={activeFilterCount > 0 ? clearStreamFilters : undefined}
        />
        <ResultFilterSheet
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          panelId={filterPanelId}
          testId="differentials-stream-filter-panel"
          title={`Filter ${copy.heading.toLowerCase()}`}
          description={
            isPresentation
              ? "Choose query scope, urgency, or pathways related to the focused presentation."
              : "Choose query scope, urgency, diagnostic chapter, presentation family, or related entries."
          }
          groups={mobileFilterGroups}
          scope={{
            label: "Search in",
            value: resultScope,
            onChange: (value) => setResultScope(value as DifferentialResultScope),
            options: [
              {
                value: "matches",
                label: "Matches",
                count: filterStreamItems("matches", presentationPriority, selectedChapterFilters, familyMode).length,
                description: "Keep entries matched by the current query.",
              },
              {
                value: "all",
                label: "All entries",
                count: filterStreamItems("all", presentationPriority, selectedChapterFilters, familyMode).length,
                description: "Apply refinements across this whole stream.",
              },
            ],
          }}
          onClearAll={activeFilterCount > 0 ? clearStreamFilters : undefined}
          summary={{
            count: visibleItems.length,
            noun: isPresentation
              ? visibleItems.length === 1
                ? "pathway"
                : "pathways"
              : visibleItems.length === 1
                ? "entry"
                : "entries",
          }}
        />

        {showBrowseGrouping && phone ? (
          <div className="-mt-1" data-testid="differentials-stream-grouping-phone">
            <StreamGroupingControl browseGrouping={browseGrouping} onBrowseGroupingChange={setBrowseGrouping} />
          </div>
        ) : null}

        {!hasQuery && model.presets.length > 0 ? (
          <section className="grid min-w-0 gap-2" aria-label="Scenario presets">
            <p className="text-xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
              Start from a scenario
            </p>
            {/* One row that scrolls sideways instead of wrapping onto many lines.
                The chips are buttons, so Tab reaches each one and the browser
                scrolls it into view; the vertical padding keeps their focus
                ring inside the scroller's clip. From lg the row wraps again. */}
            <div
              data-testid="differentials-stream-presets"
              className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden"
            >
              {model.presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.query)}
                  className="inline-flex min-h-12 shrink-0 items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-xs font-bold whitespace-nowrap text-[color:var(--text)] hover:border-[color:var(--clinical-accent-border)] hover:text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* Presentations only. On Diagnoses this shelf repeated the Emergent
            section, which the urgency grouping already lists first. */}
        {!hasQuery && isPresentation && safetyItems.length > 0 ? (
          <section
            data-testid="differentials-stream-safety-shelf"
            // A neutral hairline card with a restrained danger cue on its label.
            // These are jump links to pathways listed below, not alert cards.
            className="grid gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3"
          >
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-eyebrow text-[color:var(--danger)]">
              <ShieldAlert className="h-4 w-4" aria-hidden />
              {isPresentation ? "High-priority presentation pathways" : "Must-check / emergent shelf"}
            </div>
            <div className="flex flex-wrap gap-2">
              {safetyItems.map((item) => (
                <button
                  key={`safety-${item.id}`}
                  type="button"
                  onClick={() => scrollToSlug(item.slug)}
                  className="inline-flex min-h-12 items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-xs font-bold text-[color:var(--text)] hover:border-[color:var(--clinical-accent-border)] hover:text-[color:var(--clinical-accent)]"
                >
                  {item.title}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <FilterHighlightNote
          active={highlightFilterActive && scopeItems.length > 0}
          highlighted={visibleItems.length}
          total={scopeItems.length}
          onClear={clearHighlightFilters}
          testId="differentials-stream-highlight-note"
        />

        <section className="grid gap-3">
          {scopeItems.length === 0 ? (
            <div
              data-testid="differentials-stream-empty-filter"
              className="grid justify-items-start gap-2 rounded-lg border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] p-4"
            >
              <p className="text-sm font-bold text-[color:var(--text-heading)]">
                No {isPresentation ? "presentation pathways" : "entries"} match these filters.
              </p>
              <button
                type="button"
                onClick={clearStreamFilters}
                className="inline-flex min-h-12 items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-xs font-bold text-[color:var(--clinical-accent)]"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <>
              {renderGrouped(visibleItems, false)}
              {outsideItems.length > 0 ? (
                <div data-testid="differentials-stream-outside-filter" className="grid gap-3">
                  <FilterNotMatchingHeading
                    label={outsideLabel}
                    count={outsideItems.length}
                    level={2}
                    testId="differentials-stream-outside-heading"
                  />
                  {renderGrouped(outsideItems, true)}
                </div>
              ) : null}
            </>
          )}
        </section>

        <section className="grid gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 sm:grid-cols-[1fr_auto] sm:grid">
          <div className="grid gap-2">
            <h2 className="text-sm font-bold text-[color:var(--text-heading)]">Keep exploring</h2>
            <p className="text-sm leading-6 text-[color:var(--text-muted)]">
              {isPresentation
                ? "Return to the differentials home to start from another symptom, or use search to find a presentation pathway."
                : "Return to the differentials home to start from a different presentation, or open search to look up another differential."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ContextualBackLink
              fallbackHref={differentialRouteWithQuery("/differentials", query)}
              className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 text-sm font-bold text-[color:var(--text)] hover:bg-[color:var(--surface)]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to differential home
            </ContextualBackLink>
            <Link
              href={appModeHomeHref("differentials", { focus: true, query: query.trim() || undefined })}
              className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-3 text-sm font-bold text-[color:var(--clinical-accent)] hover:opacity-90"
            >
              <ArrowRight className="h-4 w-4" aria-hidden />
              {isPresentation ? "Search presentations" : "Open differential search"}
            </Link>
          </div>
        </section>
      </div>

      {showSelect ? (
        <SharedCompareTray
          count={selectedCount}
          names={[...selectedIds].map((slug) => itemBySlug.get(slug)?.title ?? slug)}
          compareHref={differentialSelectedCompareHref(query, selectedIds)}
          onClear={() => setSelectedIds(new Set())}
          noun="diagnoses"
          phonePlacement={{ dockSlotId: differentialsMobileCompareAddonSlotId }}
          testId="differentials-compare-tray"
        />
      ) : null}
    </main>
  );
}
