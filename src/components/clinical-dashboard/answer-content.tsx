"use client";

import Link from "next/link";
import { memo, useEffect, useRef, useState } from "react";
import { CircleAlert, ChevronDown, Copy, ExternalLink, Layers, ShieldCheck, Sparkles } from "lucide-react";

import { SafeBoldText } from "@/components/SafeBoldText";
import { Sheet } from "@/components/ui/sheet";
import {
  chatActionRow,
  chatAnswerText,
  chatMicroAction,
  cn,
  sourceCapsule,
  sourceCapsuleCountBadge,
  sourceCapsuleHit,
  statusDotMuted,
  statusDotReady,
  statusDotReview,
  subtleStatusPill,
  textMuted,
} from "@/components/ui-primitives";
import { sourceResultHref, logSourceOpen } from "@/components/clinical-dashboard/source-actions";
import {
  cleanDisplayTitle,
  comparableAnswerText,
  sanitizeAnswerDisplayText,
  sourceQuoteDisplayText,
} from "@/components/clinical-dashboard/display-text";
import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { useMobilePreviewSheet } from "@/components/clinical-dashboard/use-mobile-preview-sheet";
import { SourcePreviewPopover } from "@/components/clinical-dashboard/source-preview-popover";
import { SignedImage } from "@/components/clinical-dashboard/signed-image";
import { normalizeSourceMetadata, sourceStatusLabel } from "@/lib/source-metadata";
import { clinicalProseUsefulness } from "@/lib/source-text-sanitizer";
import { type SourceLink } from "@/lib/answer-render-policy";
import type {
  AnswerSection,
  AnswerSectionKind,
  BestSourceRecommendation,
  RagAnswer,
  SearchResult,
  VisualEvidenceCard,
} from "@/lib/types";

export const SourceImage = memo(function SourceImage({
  endpoint,
  caption,
  className = "max-h-52",
}: {
  endpoint: string;
  caption: string;
  className?: string;
}) {
  return (
    <SignedImage
      endpoint={endpoint}
      alt={caption?.trim() || "Clinical document image"}
      caption={caption}
      className={className}
      zoomable
    />
  );
});

export type AnswerDisplayTextOptions = {
  // Server-`preformatted` answers are display-ready by construction; skip the
  // noise-stripping prose sanitizer and fragment slicing so their document
  // names / facility codes survive.
  preformatted?: boolean;
  // Keep server high-yield bold (**…**) so <SafeBoldText> can render it.
  preserveBold?: boolean;
};

/**
 * Reports whether an answer is a server-`preformatted`, grounded answer whose
 * display text should bypass prose sanitization and be shown as-is.
 *
 * @param answer - The answer to check, or `null`/`undefined` when unavailable
 * @returns `true` when the answer is preformatted and grounded
 */
export function isPreformattedGroundedAnswer(answer: Pick<RagAnswer, "preformatted" | "grounded"> | null | undefined) {
  return Boolean(answer?.preformatted && answer?.grounded);
}

// Shared tail of the sanitize path: run the display sanitizer, then strip the
// synthetic-demo notice both plainAnswerText and primaryAnswerDisplayText need
// removed before the text reaches the screen.
function sanitizeAndStripSyntheticNotice(value: string, options: AnswerDisplayTextOptions) {
  return sanitizeAnswerDisplayText(value, {
    minLength: 8,
    minTokens: 2,
    preformatted: options.preformatted,
    preserveBold: options.preserveBold,
  })
    .replace(/(?:\s*\n\s*)?Synthetic demo only:.*$/i, "")
    .trim();
}

/**
 * Produces sanitized, display-ready text for an answer.
 *
 * @param value - The answer text to sanitize
 * @param options - Controls preformatted handling and bold-text preservation
 * @returns The sanitized answer text
 */
export function plainAnswerText(value: string, options: AnswerDisplayTextOptions = {}) {
  // clinicalProseUsefulness runs the source-noise stripper, so preformatted
  // answers bypass it and go straight to the lossless display path.
  const base = options.preformatted ? value : clinicalProseUsefulness(value).text || value;
  return sanitizeAndStripSyntheticNotice(base, options);
}

/**
 * Produces the complete sanitized primary answer text.
 *
 * @param value - The answer text to prepare for display
 * @param options - Formatting options, including preformatted mode
 * @returns The display-ready answer text
 */
export function primaryAnswerDisplayText(value: string, options: AnswerDisplayTextOptions = {}) {
  return sanitizeAndStripSyntheticNotice(value, options);
}

// One compact "Sources" pill in every state: the amber Source-only pill and the
// "Review source match" banner already carry the verify-first caveat, so the
// capsule label no longer restates grounding strength.
// With the compact-citations preference on, the pill drops its text label to
// icon + count; the "No direct source found" warning always stays worded —
// compact mode must never hide a missing-source signal.
export function sourceCapsuleDisplay({ sourceCount, compact = false }: { sourceCount: number; compact?: boolean }): {
  label: string;
  showLabelText: boolean;
  showCountBadge: boolean;
} {
  if (sourceCount <= 0) return { label: "No direct source found", showLabelText: true, showCountBadge: false };
  return { label: "Sources", showLabelText: !compact, showCountBadge: true };
}

export function sourceStatusDotClass(metadata: ReturnType<typeof normalizeSourceMetadata> | null | undefined) {
  if (!metadata) return statusDotMuted;
  if (metadata.document_status === "current") return statusDotReady;
  if (metadata.document_status === "review_due" || metadata.document_status === "outdated") return statusDotReview;
  return statusDotMuted;
}

type CapsulePreviewSource = {
  id: string;
  documentId: string;
  title: string;
  fileName?: string;
  pageNumber: number | null;
  metadata: ReturnType<typeof normalizeSourceMetadata>;
  sourceMetadata?: SearchResult["source_metadata"];
  score: number;
  href: string;
  snippet?: string;
  sourceStrength?:
    SourceLink["sourceStrength"] | BestSourceRecommendation["source_strength"] | SearchResult["source_strength"];
};

function sourceBadgeLabel(index: number) {
  return `S${index + 1}`;
}

function sourceBadgeToneClass(metadata: ReturnType<typeof normalizeSourceMetadata>, index: number) {
  if (metadata.document_status === "review_due" || metadata.document_status === "outdated") {
    return "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]";
  }
  if (index === 0) {
    return "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]";
  }
  return "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]";
}

function sourceSupportLabel(source: CapsulePreviewSource, index: number) {
  if (!source.sourceStrength || source.sourceStrength === "none") return "Unsupported";
  if (source.sourceStrength === "limited") return "Partial";
  if (source.sourceStrength === "moderate") return "Partial";
  if (index === 0 || source.sourceStrength === "strong") return "Direct";
  return "Partial";
}

function sourceStatusShortLabel(metadata: ReturnType<typeof normalizeSourceMetadata>) {
  if (metadata.document_status === "review_due") return "Review due";
  if (metadata.document_status === "outdated") return "Outdated";
  if (metadata.document_status === "current") return "Current";
  return sourceStatusLabel(metadata);
}

function sourcePreviewPageCountLabel(previewSources: CapsulePreviewSource[]) {
  const uniquePages = new Set(previewSources.map((source) => source.pageNumber).filter((page) => page !== null));
  const count = uniquePages.size || previewSources.length;
  return `${count} page${count === 1 ? "" : "s"}`;
}

function capsulePreviewSources(
  bestSource: BestSourceRecommendation | null,
  sources: SearchResult[],
  sourceLinks: SourceLink[] = [],
) {
  const rows: CapsulePreviewSource[] = [];
  const seen = new Set<string>();
  const pushRow = (row: CapsulePreviewSource) => {
    const key = `${row.id}:${row.title}:${row.pageNumber ?? "n/a"}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };

  sourceLinks.slice(0, 5).forEach((source) => {
    pushRow({
      id: source.chunk_id,
      documentId: source.document_id,
      title: source.title || source.file_name || "Source",
      fileName: source.file_name,
      pageNumber: source.page_number,
      metadata: normalizeSourceMetadata(source.sourceMetadata),
      sourceMetadata: source.sourceMetadata,
      score: source.score ?? 0,
      href: source.href,
      snippet: source.snippet,
      sourceStrength: source.sourceStrength,
    });
  });

  if (bestSource) {
    pushRow({
      id: bestSource.chunk_id,
      documentId: bestSource.document_id,
      title: bestSource.title || bestSource.file_name || "Source",
      fileName: bestSource.file_name,
      pageNumber: bestSource.page_number,
      metadata: normalizeSourceMetadata(bestSource.source_metadata),
      sourceMetadata: bestSource.source_metadata,
      score: bestSource.score,
      href: bestSource.viewer_href,
      sourceStrength: bestSource.source_strength,
    });
  }

  sources.slice(0, 5).forEach((source) => {
    pushRow({
      id: source.id,
      documentId: source.document_id,
      title: source.title || source.file_name || "Source",
      fileName: source.file_name,
      pageNumber: source.page_number,
      metadata: normalizeSourceMetadata(source.source_metadata),
      sourceMetadata: source.source_metadata,
      score: source.hybrid_score ?? source.similarity ?? source.lexical_score ?? 0,
      href: sourceResultHref(source),
      sourceStrength: source.source_strength,
    });
  });

  return rows.slice(0, 4);
}

function SourcePreviewContent({
  query,
  previewSources,
  quoteText,
  copiedQuote,
  onCopyQuote,
  showHeader = true,
}: {
  query?: string;
  previewSources: CapsulePreviewSource[];
  quoteText?: string | null;
  copiedQuote: boolean;
  onCopyQuote: () => void;
  showHeader?: boolean;
}) {
  const primaryPreviewSource = previewSources[0] ?? null;

  return (
    <>
      {showHeader ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="text-base font-semibold text-[color:var(--text-heading)]">Sources</p>
              <span className={cn(subtleStatusPill, "nums min-h-6 px-2 text-2xs")}>
                {sourcePreviewPageCountLabel(previewSources)}
              </span>
            </div>
            <p className={cn("mt-1 text-xs leading-5", textMuted)}>Check the answer against the cited PDF passage.</p>
          </div>
        </div>
      ) : null}
      <div
        className={cn("grid gap-0 divide-y divide-[color:var(--border)]", showHeader ? "mt-3" : "")}
        role="list"
        aria-label="Sources behind this answer"
      >
        {previewSources.map((source, index) => (
          <div
            key={`${source.id}:${index}`}
            role="listitem"
            className={cn(
              "min-w-0 py-2.5",
              index === 0 &&
                "rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 shadow-[var(--shadow-inset)]",
            )}
          >
            {index === 0 ? (
              <p className="mb-2 inline-flex items-center gap-1.5 text-2xs font-semibold text-[color:var(--clinical-accent)]">
                <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
                Best match
              </p>
            ) : index === 1 ? (
              <p className="mb-1.5 text-xs font-semibold text-[color:var(--text-muted)]">Also used</p>
            ) : null}
            <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5">
              <span
                className={cn(
                  "nums grid h-8 min-w-8 place-items-center rounded-md border px-1 text-xs font-bold shadow-[var(--shadow-inset)]",
                  sourceBadgeToneClass(source.metadata, index),
                )}
              >
                {sourceBadgeLabel(index)}
              </span>
              <span className="min-w-0">
                <Link
                  href={source.href}
                  onClick={() => query && logSourceOpen(query, source)}
                  data-testid="source-capsule-preview-row"
                  className="flex min-h-12 items-center rounded-md text-sm font-semibold leading-5 text-[color:var(--text-heading)] transition hover:text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                  aria-label={`Open source ${cleanDisplayTitle(source.title)}, page ${source.pageNumber ?? "not available"}`}
                >
                  <span className="line-clamp-2">{cleanDisplayTitle(source.title)}</span>
                </Link>
                <span className={cn("mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs", textMuted)}>
                  <span className="font-mono tabular-nums">p. {source.pageNumber ?? "n/a"}</span>
                  <span aria-hidden>·</span>
                  <span>{sourceSupportLabel(source, index)}</span>
                  <span className={sourceStatusDotClass(source.metadata)} aria-hidden="true" />
                  <span
                    className={
                      source.metadata.document_status === "review_due" || source.metadata.document_status === "outdated"
                        ? "font-semibold text-[color:var(--warning)]"
                        : undefined
                    }
                  >
                    {sourceStatusShortLabel(source.metadata)}
                  </span>
                </span>
              </span>
              <Link
                href={source.href}
                onClick={() => query && logSourceOpen(query, source)}
                className={cn(
                  index === 0
                    ? "inline-flex min-h-12 items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-2.5 text-xs font-semibold text-[color:var(--text)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--clinical-accent-border)]"
                    : "grid h-12 w-12 place-items-center rounded-md text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--clinical-accent)]",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                )}
                aria-label={`Open ${sourceBadgeLabel(index)} source page`}
              >
                <ExternalLink aria-hidden="true" className="h-4 w-4" />
                {index === 0 ? <span>Open</span> : null}
              </Link>
            </div>
          </div>
        ))}
      </div>
      {quoteText ? (
        <section className="mt-3" aria-label="Cited passage">
          <p className={cn("mb-1.5 text-2xs font-semibold uppercase tracking-wide", textMuted)}>Cited passage</p>
          <blockquote className="border-l-2 border-[color:var(--clinical-accent)]/35 pl-3 text-sm font-medium leading-6 text-[color:var(--text)]">
            &ldquo;{quoteText}&rdquo;
          </blockquote>
        </section>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[color:var(--border)] pt-2 sm:flex sm:flex-wrap">
        {primaryPreviewSource ? (
          <Link
            href={primaryPreviewSource.href}
            onClick={() => query && logSourceOpen(query, primaryPreviewSource)}
            className={chatMicroAction}
            aria-label={`Open source page for ${primaryPreviewSource.title}`}
          >
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            View original PDF
          </Link>
        ) : null}
        {quoteText ? (
          <button type="button" className={chatMicroAction} onClick={onCopyQuote}>
            <Copy aria-hidden="true" className="h-3.5 w-3.5" />
            {copiedQuote ? "Copied passage" : "Copy passage"}
          </button>
        ) : null}
      </div>
    </>
  );
}

/**
 * Displays a sanitized clinical answer with source status, source previews, and copy actions.
 *
 * @param text - The raw answer text to display.
 * @param query - The user's query context for logging.
 * @param preformatted - Whether to preserve the supplied formatting during display processing.
 * @param sourceCount - The number of direct sources associated with the answer.
 * @param sourceOnly - Whether to show a notice that the answer was assembled solely from source passages.
 * @param bestSource - The highest-priority source recommendation, when available.
 * @param sources - Search results used to build the source preview.
 * @param sourceLinks - Source links and snippets associated with the answer.
 * @param copied - Whether the answer has been copied.
 * @param onCopy - Callback invoked to copy the answer with source status.
 * @returns The rendered answer section, or `null` when the answer has no displayable text.
 */
export function NaturalLanguageAnswer({
  text,
  query,
  preformatted = false,
  sourceCount,
  sourceOnly,
  bestSource,
  sources,
  sourceLinks,
  copied,
  onCopy,
}: {
  // Raw answer text (server bold intact); this component owns display
  // sanitization so <SafeBoldText> can render the high-yield emphasis.
  text: string;
  query?: string;
  preformatted?: boolean;
  sourceCount: number;
  sourceOnly: boolean;
  bestSource: BestSourceRecommendation | null;
  sources: SearchResult[];
  sourceLinks: SourceLink[];
  copied: boolean;
  onCopy: () => void;
}) {
  const [sourcePreviewOpen, setSourcePreviewOpen] = useState(false);
  const [sourceOnlyNoticeOpen, setSourceOnlyNoticeOpen] = useState(false);
  const [copiedSourceQuote, setCopiedSourceQuote] = useState(false);
  const { preferences } = useAppPreferences();
  const sourceCapsuleRef = useRef<HTMLButtonElement>(null);
  const copySourceQuoteTimerRef = useRef<number | null>(null);
  const usePreviewSheet = useMobilePreviewSheet();
  useEffect(() => {
    return () => {
      if (copySourceQuoteTimerRef.current !== null) window.clearTimeout(copySourceQuoteTimerRef.current);
    };
  }, []);
  const cleaned = primaryAnswerDisplayText(text, { preformatted, preserveBold: true });
  if (!cleaned) return null;
  const capsuleDisplay = sourceCapsuleDisplay({ sourceCount, compact: preferences.compactCitations });
  const previewSources = capsulePreviewSources(bestSource, sources, sourceLinks);
  const rawQuoteText =
    sourceLinks.find((source) => source.snippet)?.snippet || bestSource?.quote || bestSource?.snippet || "";
  const quoteText = sourceQuoteDisplayText(rawQuoteText);
  const canOpenSourcePreview = previewSources.length > 0;
  async function copySourceQuote() {
    if (!quoteText) return;
    try {
      await navigator.clipboard.writeText(quoteText);
      setCopiedSourceQuote(true);
      if (copySourceQuoteTimerRef.current !== null) window.clearTimeout(copySourceQuoteTimerRef.current);
      copySourceQuoteTimerRef.current = window.setTimeout(() => setCopiedSourceQuote(false), 1600);
    } catch {
      setCopiedSourceQuote(false);
    }
  }
  const sourceCapsuleButton = (
    <button
      type="button"
      ref={sourceCapsuleRef}
      className={sourceCapsuleHit}
      aria-label="Open answer sources"
      aria-expanded={sourcePreviewOpen}
      onClick={() => {
        if (canOpenSourcePreview) setSourcePreviewOpen((current) => !current);
      }}
    >
      <span className={sourceCapsule}>
        <Layers className="h-3 w-3 shrink-0" aria-hidden />
        {capsuleDisplay.showLabelText ? <span className="min-w-0 truncate">{capsuleDisplay.label}</span> : null}
        {capsuleDisplay.showCountBadge ? <span className={sourceCapsuleCountBadge}>{sourceCount}</span> : null}
        {canOpenSourcePreview ? (
          <ChevronDown
            className={cn("h-3 w-3 shrink-0 transition-transform", sourcePreviewOpen && "rotate-180")}
            strokeWidth={2.25}
            aria-hidden
          />
        ) : null}
      </span>
    </button>
  );

  return (
    <section
      data-testid="plain-answer-response"
      aria-label="Primary natural-language answer"
      className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-[color:var(--text-heading)]"
    >
      <span
        data-testid="answer-clinical-icon"
        className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[color:var(--clinical-accent)]/25 bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]"
        aria-hidden="true"
      >
        <ShieldCheck aria-hidden="true" className="size-icon-lg" />
      </span>
      <div className="min-w-0 space-y-1">
        <p className={chatAnswerText}>
          <span data-testid="plain-answer-prose">
            <SafeBoldText text={cleaned} />
          </span>
        </p>
        <div className="space-y-1 -mb-2">
          {sourceOnly ? (
            <section
              data-testid="source-only-disclosure"
              role="note"
              className={cn(
                "w-fit max-w-full overflow-hidden border border-[color:var(--warning)]/30 bg-[color:var(--warning-soft)]/40 text-xs transition-[border-radius] duration-[var(--duration-quick)]",
                sourceOnlyNoticeOpen ? "rounded-lg" : "rounded-full",
                textMuted,
              )}
            >
              <button
                type="button"
                onClick={() => setSourceOnlyNoticeOpen((current) => !current)}
                className="inline-flex min-h-7 w-full max-w-[68ch] items-center gap-1.5 px-2.5 py-1 text-left transition hover:bg-[color:var(--warning-soft)]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)]"
                aria-expanded={sourceOnlyNoticeOpen}
                aria-controls="source-only-disclosure-detail"
              >
                <CircleAlert className="h-3.5 w-3.5 shrink-0 text-[color:var(--warning)]" aria-hidden />
                <span className="min-w-0 truncate font-semibold text-[color:var(--text-heading)]">Source-only</span>
                <span className="shrink-0 text-2xs text-[color:var(--text-muted)]">· verify passages</span>
                <ChevronDown
                  className={cn(
                    "ml-auto h-3.5 w-3.5 shrink-0 text-[color:var(--text-muted)] transition-transform",
                    sourceOnlyNoticeOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>
              {sourceOnlyNoticeOpen ? (
                <div
                  id="source-only-disclosure-detail"
                  className="border-t border-[color:var(--warning)]/15 px-3 py-2 text-2xs leading-5 text-[color:var(--text-muted)] motion-safe:animate-fade-up"
                >
                  <p>
                    This answer was assembled from your documents without the AI model, so it may be less complete.
                    Verify dose, threshold, route, timing, monitoring, and risk details against the cited passages
                    below.
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}
          {sourceCapsuleButton}
        </div>
        {canOpenSourcePreview && !usePreviewSheet ? (
          <SourcePreviewPopover
            open={sourcePreviewOpen}
            onClose={() => setSourcePreviewOpen(false)}
            anchorRef={sourceCapsuleRef}
          >
            <SourcePreviewContent
              query={query}
              previewSources={previewSources}
              quoteText={quoteText}
              copiedQuote={copiedSourceQuote}
              onCopyQuote={copySourceQuote}
            />
          </SourcePreviewPopover>
        ) : null}
        <Sheet
          open={sourcePreviewOpen && canOpenSourcePreview && usePreviewSheet}
          onClose={() => setSourcePreviewOpen(false)}
          title="Sources"
          description="Check the answer against the cited PDF passage."
          titleAccessory={
            <span className={cn(subtleStatusPill, "nums min-h-6 px-2 text-2xs")}>
              {sourcePreviewPageCountLabel(previewSources)}
            </span>
          }
          closeLabel="Close answer sources"
          contentClassName="sm:max-w-xl"
          returnFocusRef={sourceCapsuleRef}
          portal
        >
          <div data-testid="source-capsule-preview">
            <SourcePreviewContent
              query={query}
              previewSources={previewSources}
              quoteText={quoteText}
              copiedQuote={copiedSourceQuote}
              onCopyQuote={copySourceQuote}
              showHeader={false}
            />
          </div>
        </Sheet>
        <div className={cn(chatActionRow, "mt-0.5")} aria-label="Answer actions">
          <button
            type="button"
            onClick={onCopy}
            className={chatMicroAction}
            aria-label="Copy answer with source status"
          >
            <Copy aria-hidden="true" className="h-3.5 w-3.5" />
            {copied ? "Copied with sources" : "Copy with sources"}
          </button>
        </div>
      </div>
    </section>
  );
}

export function UserQuestionBubble({ query }: { query: string }) {
  const cleaned = query.trim();
  if (!cleaned) return null;

  return (
    <section className="flex justify-end px-1" aria-label="User question">
      <div
        data-testid="user-question-bubble"
        className="ml-auto max-w-[min(28rem,86%)] rounded-lg border border-[color:var(--border)] bg-[color:var(--clinical-accent-soft)] px-3 py-2 text-right shadow-[var(--shadow-inset)] sm:max-w-[28rem]"
      >
        <p className="text-sm font-medium leading-6 text-[color:var(--text-heading)]">{cleaned}</p>
      </div>
    </section>
  );
}

type KeyClinicalItem = {
  id: string;
  label?: string;
  detail: string;
};

function keyClinicalItemFromText(item: string): KeyClinicalItem | null {
  const cleaned = item.replace(/^[-*•]\s*/, "").trim();
  if (cleaned.length < 24) return null;
  const [labelCandidate, ...detailParts] = cleaned.split(/\s+(?:—|-)\s+/);
  const label = labelCandidate?.trim();
  const detail = detailParts.join(" — ").trim();
  const id = comparableAnswerText(cleaned);
  if (label && detail && label.length <= 64) return { id, label, detail };
  return { id, detail: cleaned };
}

export function keyClinicalItemsFromSections(
  sections: Array<AnswerSection & { citationSources: SearchResult[] }>,
): KeyClinicalItem[] {
  const usefulKinds = new Set<AnswerSectionKind | undefined>([
    "required_actions",
    "monitoring_timing",
    "medication_dose",
    "thresholds",
    "escalation_risk",
    "contraindications_cautions",
    "comparison",
  ]);
  return sections
    .filter((section) => usefulKinds.has(section.kind))
    .flatMap((section) =>
      section.body
        .split(/\n+|(?<=\.)\s+(?=(?:Monitor|Check|Use|Avoid|Escalate|Withhold|Review|Document|Repeat|Consider)\b)/)
        .map((item) => keyClinicalItemFromText(item))
        .filter((item): item is KeyClinicalItem => Boolean(item)),
    )
    .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 5);
}

export function keyClinicalItemsFromTable(item: VisualEvidenceCard | null): KeyClinicalItem[] {
  const rows = item?.tableRows?.filter((row) => row.some((cell) => cell.trim())) ?? [];
  if (rows.length < 2) return [];

  return rows
    .slice(0, 3)
    .map((row): KeyClinicalItem | null => {
      const [domain, baseline] = row.map((cell) => cell.trim()).filter(Boolean);
      if (!domain || !baseline) return null;
      return {
        id: comparableAnswerText([domain, baseline].join(" ")),
        label: domain,
        detail: baseline,
      };
    })
    .filter((value): value is KeyClinicalItem => value !== null)
    .slice(0, 5);
}
