"use client";

import {
  BookOpen,
  Check,
  Clock,
  Compass,
  Download,
  HeartHandshake,
  LayoutGrid,
  Library,
  ListChecks,
  ListOrdered,
  Pill,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  TriangleAlert,
  Waypoints,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";

import type { Factsheet } from "@/components/factsheets/factsheets-data";
import { InPageNavHeader } from "@/components/in-page-nav/in-page-nav-header";
import type { PageSection } from "@/components/in-page-nav/page-section-index";
import { useInPageSectionNav } from "@/components/in-page-nav/use-in-page-section-nav";
import type { SegmentedControlOption } from "@/components/ui/segmented-control";

/**
 * Anchor id for the nth `medLite` body section.
 *
 * `medLite` is the one kind whose headings are content rather than layout — the
 * fixture supplies `sections: Array<{ heading, body }>` — so its ids are
 * positional. The label still comes from the heading, so the sheet reads as the
 * page does.
 */
export function factsheetBodySectionId(index: number): string {
  return `factsheet-section-${index}`;
}

/** Sections every factsheet renders below its kind-specific body. */
const trailingSections: readonly PageSection[] = [
  { id: "factsheet-sources", label: "Sources", icon: ShieldCheck },
  // Only rendered when the category holds another sheet, so it is declared
  // unconditionally and `useResolvedPageSections` drops it when it is not there.
  { id: "factsheet-more-in-topic", label: "More in topic", icon: Library },
  { id: "factsheet-related", label: "Related sheets", icon: Waypoints },
];

function bodySections(factsheet: Factsheet): PageSection[] {
  switch (factsheet.kind) {
    case "medRich":
      return [
        { id: "factsheet-at-a-glance", label: "At a glance", icon: LayoutGrid },
        { id: "factsheet-what", label: "What it is", icon: Pill },
        { id: "factsheet-howto", label: "How to take it", icon: ListOrdered },
        { id: "factsheet-side-effects", label: "Side effects", icon: TriangleAlert },
        { id: "factsheet-urgent", label: "Urgent help", icon: Zap },
      ];
    case "medLite":
      return [
        { id: "factsheet-timing", label: "How long it takes", icon: Clock },
        ...factsheet.sections.map((section, index) => ({
          id: factsheetBodySectionId(index),
          label: section.heading,
          icon: BookOpen as LucideIcon,
        })),
        // Indexed for the same reason `medRich` indexes its urgent block: the
        // emergency route is the section a reader most needs to reach directly,
        // and omitting it from the disclosure and the weighted track hides it
        // behind a scroll on exactly the sheets that name self-harm and
        // serotonin toxicity.
        { id: "factsheet-urgent", label: "Urgent help", icon: Zap },
      ];
    case "condition":
      return [
        { id: "factsheet-plain-terms", label: "In plain terms", icon: Stethoscope },
        { id: "factsheet-signs", label: "Signs to look for", icon: Check },
        { id: "factsheet-why", label: "Why it happens", icon: Compass },
        { id: "factsheet-helps", label: "What helps", icon: Sparkles },
        { id: "factsheet-support", label: "You're not alone", icon: HeartHandshake },
      ];
    case "therapy":
      return [
        { id: "factsheet-what-it-is", label: "What it is", icon: Stethoscope },
        { id: "factsheet-how-it-works", label: "How it works", icon: ListOrdered },
        { id: "factsheet-what-to-expect", label: "What to expect", icon: Sparkles },
        { id: "factsheet-support", label: "You're not alone", icon: HeartHandshake },
      ];
    case "procedure":
      return [
        { id: "factsheet-why-it-matters", label: "Why it matters", icon: Compass },
        { id: "factsheet-prepare", label: "How to prepare", icon: ListChecks },
        { id: "factsheet-timeline", label: "Step by step", icon: ListOrdered },
        // The act-now list gets its own jump target rather than sharing the
        // "Staying safe" anchor. The anchor sits on the prose callout below it,
        // so folding the two together would scroll a reader who picked
        // "Staying safe" straight past the toxicity symptoms.
        ...(factsheet.warningSigns
          ? [{ id: "factsheet-warning-signs", label: "Warning signs", icon: Zap as LucideIcon }]
          : []),
        { id: "factsheet-staying-safe", label: "Staying safe", icon: TriangleAlert },
      ];
  }
}

/**
 * The factsheet detail page's navigable sections, derived from what the page
 * actually renders for this sheet's `kind`.
 *
 * This replaces `tocFor`, a hand-maintained switch that returned display strings
 * rather than ids and was wrong in both directions — it named "What is this
 * medicine?" where the page renders "What is <title>?", and omitted the Sources,
 * More-in-topic and Related sections it renders on every sheet. Nothing jumped
 * anywhere, because the strings were painted into a `<li>` list with no anchors
 * behind them; the sidebar looked like a table of contents and was decoration.
 *
 * Derived rather than declared flat, because the five kinds render five
 * different bodies and `medLite`'s headings come from the record. That is the
 * `docs/search-chrome-behaviour.md` carve-out for data-derived sections — the
 * builder still lives in the nav-header sibling, which is what the rule pins.
 */
export function factsheetNavSections(factsheet: Factsheet): PageSection[] {
  return [...bodySections(factsheet), ...trailingSections];
}

/**
 * The factsheet detail page's in-page navigation.
 *
 * The page is a Client Component, so this sibling is the convention rather than
 * an RSC necessity — the same call `medication-nav-header.tsx` makes. It also
 * keeps the header's prop surface (a promoted action, a view mode, an actions
 * slot and now a section index) out of an 850-line page component.
 */
export function FactsheetNavHeader({
  factsheet,
  readingLevel,
  readingLevelOptions,
  onReadingLevelChange,
  onDownload,
  actions,
}: {
  factsheet: Factsheet;
  readingLevel: string;
  readingLevelOptions: ReadonlyArray<SegmentedControlOption<string>>;
  onReadingLevelChange: (value: string) => void;
  onDownload: () => void;
  actions: ReactNode | ((close: () => void) => ReactNode);
}) {
  // `useResolvedPageSections` treats the declared list as its effect identity,
  // so a fresh array each render would re-subscribe the MutationObserver every
  // render for nothing. Every other route passes a module-level constant; this
  // one cannot, because the list depends on the record.
  const declared = useMemo(() => factsheetNavSections(factsheet), [factsheet]);
  const { sections, activeId, selectSection } = useInPageSectionNav(declared);

  return (
    <InPageNavHeader
      back={{ href: "/factsheets/search", label: "All factsheets" }}
      title={factsheet.title}
      sections={sections}
      activeId={activeId}
      onSelectSection={selectSection}
      primaryAction={{ label: "Download PDF", icon: Download, onClick: onDownload }}
      mode={
        // Only `medRich` sheets carry both reading levels; the other seven must
        // not reserve the band.
        factsheet.kind === "medRich"
          ? {
              label: "Reading level",
              value: readingLevel,
              options: readingLevelOptions,
              onChange: onReadingLevelChange,
            }
          : undefined
      }
      sectionSheetTitle={factsheet.title}
      actionsTitle="This factsheet"
      actionsDescription={`${factsheet.title} · updated ${factsheet.reviewedOn}`}
      actionsNoun="factsheet"
      testIdPrefix="factsheet"
      actions={actions}
    />
  );
}
