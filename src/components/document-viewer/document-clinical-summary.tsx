"use client";

import {
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  FileText,
  ListChecks,
  ShieldAlert,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { SafeBoldText } from "@/components/SafeBoldText";
import { Sheet } from "@/components/ui/sheet";
import { cn, panel, textMuted } from "@/components/ui-primitives";
import { formatDocumentSummary } from "@/lib/document-summary-formatting";
import { cleanClinicalSummaryText } from "@/lib/source-text-sanitizer";
import type {
  ClinicalDocument,
  ClinicalDocumentSummaryProfile,
  DocumentSummaryProfileItem,
  DocumentSummarySupportLevel,
} from "@/lib/types";

type PriorityTone = "safety" | "monitoring" | "action";

export type DocumentClinicalPriority = {
  id: string;
  title: string;
  label: string;
  text: string;
  page: number | null;
  support: DocumentSummarySupportLevel | null;
  tone: PriorityTone;
};

export type DocumentClinicalSummaryModel = {
  summary: string;
  priorities: DocumentClinicalPriority[];
  sourceBacked: boolean;
};

type PriorityCandidate = {
  id: string;
  title: string;
  label: string;
  tone: PriorityTone;
  items: DocumentSummaryProfileItem[];
};

const priorityTone: Record<PriorityTone, { icon: LucideIcon; iconClassName: string; labelClassName: string }> = {
  safety: {
    icon: ShieldAlert,
    iconClassName: "bg-[color:var(--danger-soft)] text-[color:var(--danger)]",
    labelClassName: "bg-[color:var(--danger-soft)] text-[color:var(--danger)]",
  },
  monitoring: {
    icon: Clock3,
    iconClassName: "bg-[color:var(--info-soft)] text-[color:var(--info)]",
    labelClassName: "bg-[color:var(--info-soft)] text-[color:var(--info)]",
  },
  action: {
    icon: ClipboardCheck,
    iconClassName: "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
    labelClassName: "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
  },
};

const PLACEHOLDER_SUMMARY_RE = /source-backed review/i;

function isPlaceholderClinicalSummary(text: string): boolean {
  return PLACEHOLDER_SUMMARY_RE.test(text);
}

function usefulSummaryText(text: string): string {
  const cleaned = cleanClinicalSummaryText(text);
  return cleaned && !isPlaceholderClinicalSummary(cleaned) ? cleaned : "";
}

function profileItemPages(item: DocumentSummaryProfileItem): number[] {
  return Array.isArray(item.pages) ? item.pages : [];
}

function verifiedSupport(item: DocumentSummaryProfileItem): DocumentSummarySupportLevel | null {
  if (item.support !== "direct" && item.support !== "partial") return null;
  const hasLinkedSource = [item.source_chunk_ids, item.source_image_ids].some(
    (ids) => Array.isArray(ids) && ids.some((id) => typeof id === "string" && id.trim()),
  );
  return hasLinkedSource ? item.support : null;
}

function firstRenderableItem(items: DocumentSummaryProfileItem[], usedText: Set<string>) {
  return items.find((item) => {
    if (item.support === "not_found") return false;
    const text = cleanClinicalSummaryText(item.text);
    return Boolean(text) && !usedText.has(text.toLowerCase());
  });
}

function profileItems(value: unknown): DocumentSummaryProfileItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is DocumentSummaryProfileItem =>
      typeof item === "object" && item !== null && typeof (item as { text?: unknown }).text === "string",
  );
}

function profilePriorityCandidates(profile: ClinicalDocumentSummaryProfile): PriorityCandidate[] {
  return [
    {
      id: "escalation",
      title: "Escalation and safety",
      label: "Critical safety",
      tone: "safety",
      items: profileItems(profile.escalation_risk_warnings),
    },
    {
      id: "monitoring",
      title: "Timing and monitoring",
      label: "Monitoring",
      tone: "monitoring",
      items: [...profileItems(profile.thresholds_timing), ...profileItems(profile.medication_dose_monitoring)],
    },
    {
      id: "action",
      title: "Key clinical action",
      label: "Clinical action",
      tone: "action",
      items: [
        ...profileItems(profile.key_clinical_actions),
        ...profileItems(profile.required_forms_documentation),
        ...profileItems(profile.applies_to),
      ],
    },
  ];
}

function prioritiesFromProfile(profile: ClinicalDocumentSummaryProfile): DocumentClinicalPriority[] {
  const usedText = new Set<string>();

  return profilePriorityCandidates(profile).flatMap((candidate) => {
    const item = firstRenderableItem(candidate.items, usedText);
    if (!item) return [];
    const text = cleanClinicalSummaryText(item.text);
    usedText.add(text.toLowerCase());
    const page = profileItemPages(item).find((value) => Number.isInteger(value) && value > 0) ?? null;
    return [
      {
        id: candidate.id,
        title: candidate.title,
        label: candidate.label,
        text,
        page,
        support: verifiedSupport(item),
        tone: candidate.tone,
      },
    ];
  });
}

function prioritiesFromFormattedSummary(document: ClinicalDocument): DocumentClinicalPriority[] {
  const formatted = formatDocumentSummary(document.summary?.summary);
  return formatted.sections
    .flatMap((section) =>
      section.items.map((item) => ({
        heading: section.heading,
        text: cleanClinicalSummaryText(item),
      })),
    )
    .filter((item) => item.text)
    .slice(0, 3)
    .map((item, index) => ({
      id: `summary-${index + 1}`,
      title: item.heading ?? "Key clinical point",
      label: index === 0 ? "Key point" : "Clinical detail",
      text: item.text,
      page: null,
      support: null,
      tone: "action",
    }));
}

export function buildDocumentClinicalSummaryModel(document: ClinicalDocument): DocumentClinicalSummaryModel {
  const profile = document.summary?.clinical_specifics?.profile;
  const formatted = formatDocumentSummary(document.summary?.summary);
  const priorities = profile ? prioritiesFromProfile(profile) : prioritiesFromFormattedSummary(document);
  const profileOverview = usefulSummaryText(profile?.overview ?? "");
  const summary = cleanClinicalSummaryText(
    profileOverview ||
      usefulSummaryText(formatted.lead ?? "") ||
      usefulSummaryText(formatted.sections[0]?.items.join(" ") ?? "") ||
      usefulSummaryText(
        priorities
          .slice(0, 2)
          .map((priority) => priority.text)
          .join(" "),
      ),
  );
  return {
    summary,
    priorities,
    sourceBacked: priorities.some((priority) => priority.support === "direct" || priority.support === "partial"),
  };
}

/**
 * Whether a built model has anything worth a card.
 *
 * A `document_summaries` row is not the same thing as usable content: the model
 * discards placeholder text (see `usefulSummaryText`), so a stored row can still
 * yield nothing to render.
 *
 * This deliberately does not feed `buildDocumentSectionIndex`. The section index's
 * `source-summary` entry anchors the rail's document-profile panel, which renders
 * its label badges whether or not a summary was indexed — so gating the nav entry
 * on summary text would hide a section that is genuinely on the page.
 */
export function documentClinicalSummaryHasContent(model: DocumentClinicalSummaryModel): boolean {
  return Boolean(model.summary) || model.priorities.length > 0;
}

function supportLabel(support: DocumentSummarySupportLevel | null) {
  if (support === "direct") return "Direct support";
  if (support === "partial") return "Partial support";
  return "Indexed summary";
}

function SupportStatus({ support }: { support: DocumentSummarySupportLevel | null }) {
  const Icon = support === "direct" ? BadgeCheck : support === "partial" ? CircleDashed : FileText;
  return (
    <span className="inline-flex items-center gap-1.5 text-2xs font-semibold text-[color:var(--text-muted)]">
      <Icon
        aria-hidden="true"
        className={cn(
          "h-3.5 w-3.5",
          support === "direct"
            ? "text-[color:var(--success)]"
            : support === "partial"
              ? "text-[color:var(--warning)]"
              : "text-[color:var(--clinical-accent)]",
        )}
        strokeWidth={2}
      />
      {supportLabel(support)}
    </span>
  );
}

function PriorityPageLink({
  page,
  href,
  onNavigate,
}: {
  page: number;
  href: string;
  onNavigate: (page: number) => void;
}) {
  return (
    <a
      href={href}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate(page);
      }}
      className="inline-flex min-h-tap items-center gap-1 px-1 text-xs font-bold text-[color:var(--clinical-accent)] transition hover:text-[color:var(--clinical-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:min-h-compact-meta"
    >
      <span className="nums">View p.{page}</span>
      <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
    </a>
  );
}

function PriorityContent({
  priority,
  index,
  pageHref,
  onPageChange,
  compact = false,
}: {
  priority: DocumentClinicalPriority;
  index: number;
  pageHref: (page: number) => string;
  onPageChange: (page: number) => void;
  compact?: boolean;
}) {
  const tone = priorityTone[priority.tone];
  const Icon = tone.icon;

  if (compact) {
    return (
      <section className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2.5 border-b border-[color:var(--border)] py-3 last:border-b-0">
        <span className={cn("grid h-8 w-8 place-items-center rounded-lg", tone.iconClassName)}>
          <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <h3 className="text-xs font-bold text-[color:var(--text-heading)]">{priority.title}</h3>
            <span
              className={cn(
                "inline-flex min-h-6 items-center rounded-md px-2 text-3xs font-bold uppercase tracking-label",
                tone.labelClassName,
              )}
            >
              {priority.label}
            </span>
          </div>
          <p className="mt-1 text-sm leading-5 text-[color:var(--text-muted)]">
            <SafeBoldText text={priority.text} />
          </p>
          <div className="mt-1.5 flex min-h-9 items-center justify-between gap-2">
            <SupportStatus support={priority.support} />
            {priority.page ? (
              <PriorityPageLink page={priority.page} href={pageHref(priority.page)} onNavigate={onPageChange} />
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="grid grid-cols-[2rem_2rem_minmax(0,1fr)_auto] items-start gap-2.5 border-b border-[color:var(--border)] py-3 last:border-b-0 lg:grid-cols-[2rem_2.25rem_minmax(0,1fr)_7rem] lg:gap-3">
      <span className="nums grid h-7 w-7 place-items-center rounded-full bg-[color:var(--surface-subtle)] text-2xs font-bold text-[color:var(--text-muted)]">
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className={cn("grid h-8 w-8 place-items-center rounded-lg", tone.iconClassName)}>
        <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
      </span>
      <div className="min-w-0 pt-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold text-[color:var(--text-heading)]">{priority.title}</h3>
          <span
            className={cn(
              "inline-flex min-h-6 items-center rounded-md px-2 text-3xs font-bold uppercase tracking-label",
              tone.labelClassName,
            )}
          >
            {priority.label}
          </span>
        </div>
        <p className="mt-1 text-sm leading-6 text-[color:var(--text-muted)]">
          <SafeBoldText text={priority.text} />
        </p>
      </div>
      <div className="flex min-h-12 flex-col items-end justify-between gap-1">
        <SupportStatus support={priority.support} />
        {priority.page ? (
          <PriorityPageLink page={priority.page} href={pageHref(priority.page)} onNavigate={onPageChange} />
        ) : null}
      </div>
    </section>
  );
}

export function DocumentClinicalSummary({
  document,
  pageHref,
  onPageChange,
  compact = false,
}: {
  document: ClinicalDocument;
  pageHref: (page: number) => string;
  onPageChange: (page: number) => void;
  compact?: boolean;
}) {
  const model = buildDocumentClinicalSummaryModel(document);
  const hasContent = documentClinicalSummaryHasContent(model);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [prioritiesExpanded, setPrioritiesExpanded] = useState(!compact);
  const [prevCompact, setPrevCompact] = useState(compact);
  const [mobilePrioritiesOpen, setMobilePrioritiesOpen] = useState(false);
  const mobilePrioritiesButtonRef = useRef<HTMLButtonElement>(null);
  const prioritiesId = useId();
  const canExpandSummary = model.summary.length > 140;

  // React's supported "adjust state during render" pattern for reacting to the
  // condensed/full density prop without a cascading setState-in-effect.
  if (compact !== prevCompact) {
    setPrevCompact(compact);
    setPrioritiesExpanded(!compact);
  }

  function navigateFromSheet(page: number) {
    setMobilePrioritiesOpen(false);
    onPageChange(page);
  }

  // Render nothing rather than a gradient header, an icon and a heading wrapped
  // around "not been indexed for this document yet". On a phone that shell cost
  // most of the first viewport to say the document has no summary.
  if (!hasContent) return null;

  return (
    <>
      <article data-testid="document-clinical-summary" className={cn(panel, "overflow-hidden lg:col-span-3")}>
        <div className="bg-[linear-gradient(105deg,color-mix(in_srgb,var(--clinical-accent-soft)_82%,var(--surface-raised)),var(--surface-raised)_32%)] px-4 pb-3 pt-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)] shadow-[var(--e1)]">
                <Sparkles aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
              </span>
              <h2 className="text-sm font-bold tracking-display text-[color:var(--text-heading)] sm:text-base">
                Clinical priorities
              </h2>
            </div>
            {model.sourceBacked ? (
              <span className="inline-flex items-center gap-1.5 text-2xs font-semibold text-[color:var(--text-muted)]">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[color:var(--success)]" />
                Source-backed
              </span>
            ) : null}
          </div>
          {model.summary ? (
            <p
              className={cn(
                "mt-3 text-base-minus font-normal leading-6 text-[color:var(--text)] sm:text-base sm:leading-7",
                !summaryExpanded && canExpandSummary && "line-clamp-3 sm:line-clamp-none",
              )}
            >
              <SafeBoldText text={model.summary} />
            </p>
          ) : (
            <p className={cn("mt-3 text-sm leading-6", textMuted)}>
              A structured clinical summary has not been indexed for this document yet.
            </p>
          )}
          {canExpandSummary ? (
            <button
              type="button"
              onClick={() => setSummaryExpanded((current) => !current)}
              className="-mb-2 mt-0.5 inline-flex min-h-tap items-center gap-1 border-0 bg-transparent px-0 text-xs font-semibold text-[color:var(--clinical-accent)] transition hover:text-[color:var(--clinical-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:hidden"
              aria-expanded={summaryExpanded}
              data-testid="toggle-document-summary"
            >
              {summaryExpanded ? "Show less" : "Show more"}
              {summaryExpanded ? (
                <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
              ) : (
                <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
              )}
            </button>
          ) : null}
        </div>

        {model.priorities.length ? (
          <>
            <button
              type="button"
              onClick={() => setPrioritiesExpanded((current) => !current)}
              className="hidden min-h-tap w-full items-center justify-between gap-3 border-t border-[color:var(--border)] bg-[color:var(--surface-raised)] px-4 text-left transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)] sm:flex"
              aria-expanded={prioritiesExpanded}
              aria-controls={prioritiesId}
            >
              <span className="flex min-w-0 items-center gap-2">
                <ListChecks
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]"
                  strokeWidth={2}
                />
                {/* The card is already titled "Clinical priorities"; this row only opens the list. */}
                <span className="text-sm font-semibold text-[color:var(--clinical-accent)]">
                  {prioritiesLabel(model.priorities.length)}
                </span>
              </span>
              {prioritiesExpanded ? (
                <ChevronUp aria-hidden="true" className="h-4 w-4 text-[color:var(--clinical-accent)]" strokeWidth={2} />
              ) : (
                <ChevronDown
                  aria-hidden="true"
                  className="h-4 w-4 text-[color:var(--clinical-accent)]"
                  strokeWidth={2}
                />
              )}
            </button>
            <button
              ref={mobilePrioritiesButtonRef}
              type="button"
              onClick={() => setMobilePrioritiesOpen(true)}
              className="flex min-h-tap w-full items-center justify-between gap-3 border-t border-[color:var(--border)] bg-[color:var(--surface-raised)] px-4 text-left transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)] sm:hidden"
              aria-haspopup="dialog"
              aria-expanded={mobilePrioritiesOpen}
              data-testid="open-clinical-priorities"
            >
              <span className="flex min-w-0 items-center gap-2">
                <ListChecks
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]"
                  strokeWidth={2}
                />
                <span className="whitespace-nowrap text-sm font-semibold text-[color:var(--clinical-accent)]">
                  {prioritiesLabel(model.priorities.length)}
                </span>
              </span>
              <ChevronDown aria-hidden="true" className="h-4 w-4 text-[color:var(--clinical-accent)]" strokeWidth={2} />
            </button>
            <div
              id={prioritiesId}
              className={cn(
                "border-t border-[color:var(--border)] px-4",
                prioritiesExpanded ? "hidden sm:block" : "hidden",
              )}
            >
              {model.priorities.map((priority, index) => (
                <PriorityContent
                  key={priority.id}
                  priority={priority}
                  index={index}
                  pageHref={pageHref}
                  onPageChange={onPageChange}
                />
              ))}
            </div>
          </>
        ) : null}
      </article>

      <Sheet
        open={mobilePrioritiesOpen}
        onClose={() => setMobilePrioritiesOpen(false)}
        returnFocusRef={mobilePrioritiesButtonRef}
        title="Clinical priorities"
        description="Expanded, source-linked clinical detail"
        headerLeading={
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)] shadow-[var(--e1)]">
            <ListChecks aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
          </span>
        }
        contentClassName="sm:max-w-xl"
        bodyClassName="p-0 sm:p-0"
        portal
        testId="clinical-priorities-sheet"
      >
        <div className="px-4 pb-2">
          {model.priorities.map((priority, index) => (
            <PriorityContent
              key={priority.id}
              priority={priority}
              index={index}
              pageHref={pageHref}
              onPageChange={navigateFromSheet}
              compact
            />
          ))}
        </div>
      </Sheet>
    </>
  );
}

function prioritiesLabel(count: number) {
  return count === 1 ? "See the priority" : `See all ${count} priorities`;
}
