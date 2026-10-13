"use client";

import { useEffect, useId } from "react";
import {
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Heart,
  Scale,
  Sparkles,
  SquareCheck,
  Target,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import Link from "next/link";

import { cardSurface, stretchedRowLinkClass } from "@/components/card-recipes";
import { Button, buttonFaceClass } from "@/components/ui/button";
import { announce } from "@/components/ui/live-announcer";
import { cn, ignoreUnavailableActivation } from "@/components/ui-primitives";
import { filterOutsideTitleClass } from "@/components/clinical-dashboard/filter-highlight";
import { THERAPY_MAX_COMPARE, therapyRecordHref } from "@/lib/therapy-compass-navigation";

import { useTcBindings } from "./bindings";
import { cardPreviewText, prioritiseTherapyTags, summarise } from "./data/select";
import type { Therapy } from "./data/types";
import { controlPressed, favouritePressed, heroCard } from "./controls";
import { Eyebrow, StatusBadge, Tag, TagRow, tagTone } from "./ui";
import { useTherapyFavourite } from "./use-therapy-favourite";

/**
 * Search-result cards spend all three actions as `secondary` so the page keeps
 * the one filled `--command` slot (COMPONENTS.md §9.1). A featured top match
 * is that page-level primary, so only `featured` promotes Open.
 */
const cardActionButton = "min-w-0 px-2 text-xs sm:px-4 sm:text-sm-minus md:w-auto";

/**
 * Large result card with why-matched / avoid / best-fit columns. Recommend
 * still ranks with it; the Search list uses `CompactResultRow` below.
 */
export function ResultCard({
  therapy,
  rank,
  featured = false,
  query,
  whyMatched: whyMatchedOverride,
  browsing = false,
}: {
  therapy: Therapy;
  rank?: number;
  featured?: boolean;
  query?: string;
  whyMatched?: string;
  /**
   * Nothing typed: the card is one row of an A to Z list, not a search result,
   * so the first column is labelled for what it holds rather than "Why matched".
   */
  browsing?: boolean;
}) {
  const b = useTcBindings();
  const sheetUnavailableId = useId();
  const { notice, saved, toggleFavourite } = useTherapyFavourite(therapy.slug);
  const inCompare = b.isInCompare(therapy.slug);
  // A full tray keeps its tab stop and states why, per the wiring convention.
  const compareFull = !inCompare && b.compareSlugs.length >= THERAPY_MAX_COMPARE;
  const compareFullId = `${sheetUnavailableId}-compare-full`;
  const rankingQuery = query ?? b.search.query;
  const subtitle =
    cardPreviewText(therapy.clinicalSummary, { exclude: therapy.name }) ||
    cardPreviewText(therapy.bestUsedFor, { exclude: therapy.name }) ||
    "";
  const tags = prioritiseTherapyTags(therapy.tags.length ? therapy.tags : [therapy.category], {
    query: rankingQuery,
    activeTags: b.search.tags,
  });
  const whyMatched =
    whyMatchedOverride ||
    cardPreviewText(therapy.bestUsedFor, { exclude: therapy.name }) ||
    cardPreviewText(therapy.indications, { exclude: therapy.name }) ||
    (browsing ? "See record for indications." : "Relevant to the current search.");
  const avoidModify = therapyAvoidModifyText(therapy);
  const rankedBestFit = [therapy.setting, therapy.timeRequired, therapy.patientPopulation]
    .map((value) => cardPreviewText(value, { exclude: therapy.name }))
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");
  const bestFit =
    rank != null
      ? rankedBestFit || "See record for setting and population fit."
      : cardPreviewText(therapy.targetSymptoms, { exclude: therapy.name }) ||
        cardPreviewText(therapy.patientPopulation, { exclude: therapy.name }) ||
        cardPreviewText(therapy.setting, { exclude: therapy.name }) ||
        "See record for population fit.";

  const sheetLabel = therapy.patientSheetAvailable ? "Patient sheet" : "Sheet unavailable";
  const sheetShort = therapy.patientSheetAvailable ? "Sheet" : "No sheet";
  const openVariant = featured ? "primary" : "secondary";

  return (
    <article
      data-therapy-result-card
      data-therapy-result-featured={featured ? "" : undefined}
      className={cn(
        featured ? heroCard : cardSurface,
        "relative overflow-hidden",
        // The whole card opens the record (the Open link is stretched across it), so on a
        // pointer-sized screen the card itself answers hover rather than three wide buttons.
        !featured && "transition-colors md:hover:border-[color:var(--border-strong)]",
      )}
    >
      {/*
        Icon-only action. The accessible name is the `sr-only` label rather than an
        `aria-label`, because `Button` already renders its children into the one
        labelling slot — and `gap-0 px-0` collapses the label row so the face stays
        the square `w-tap` the card corner reserves.
      */}
      <Button
        variant="toolbar"
        icon={Heart}
        className={cn("absolute top-3 right-3 z-[10] w-tap gap-0 px-0 sm:top-3.5 sm:right-4", favouritePressed)}
        aria-pressed={saved}
        onClick={() => void toggleFavourite()}
        title={saved ? "Remove from favourites" : "Save therapy to favourites"}
      >
        <span className="sr-only">
          {saved ? `Remove ${therapy.name} from favourites` : `Save ${therapy.name} to favourites`}
        </span>
      </Button>
      <div className="grid grid-cols-1 items-start gap-3 px-4 pt-3.5 md:grid-cols-[minmax(240px,1fr)_minmax(320px,1.35fr)] md:gap-4 md:px-5 md:py-4 md:pr-[calc(1rem+var(--spacing-tap)+0.75rem)]">
        <div data-therapy-result-copy className="min-w-0 pr-[calc(var(--spacing-tap)+0.5rem)] md:pr-0">
          {featured ? (
            <div
              data-therapy-result-highlight
              className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-2.5 py-1 text-2xs font-extrabold tracking-wide text-[color:var(--clinical-accent)] uppercase forced-colors:border-[CanvasText] forced-colors:text-[CanvasText]"
            >
              <Sparkles aria-hidden="true" size={13} strokeWidth={2.1} />
              Best match
            </div>
          ) : null}
          <div className="flex items-start gap-2.5">
            {rank != null ? (
              <span className="inline-flex h-7 min-w-7 flex-none items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-xs font-extrabold nums text-[color:var(--text-heading)]">
                {rank}
              </span>
            ) : null}
            <h3 className="m-0 min-w-0 text-base font-semibold leading-snug tracking-display text-[color:var(--text-heading)]">
              {therapy.name}
            </h3>
          </div>
          {rank != null ? (
            <div className="mt-1.5">
              <StatusBadge status={therapy.reviewStatus} />
            </div>
          ) : null}
          {subtitle ? (
            <p className="m-0 mt-1 mb-2 line-clamp-2 text-sm-minus leading-snug text-[color:var(--text-muted)]">
              {subtitle}
            </p>
          ) : (
            <div className="mb-2" />
          )}
          <TagRow tags={tags} max={3} wrap={false} />
        </div>

        <div
          data-therapy-result-evidence
          className="-mx-4 grid grid-cols-1 gap-px overflow-hidden border-y border-[color:var(--border)] bg-[color:var(--border)] sm:mx-0 sm:grid-cols-3 sm:rounded-lg sm:border"
        >
          <CardCell
            icon={Target}
            eyebrow={browsing ? "Best used for" : "Why matched"}
            tone="accent"
            text={whyMatched}
          />
          <CardCell icon={TriangleAlert} eyebrow="Avoid / modify" tone="warning" text={avoidModify} />
          <CardCell icon={Clock} eyebrow="Best fit" tone="muted" text={bestFit} />
        </div>
      </div>
      {notice ? (
        <p
          role="status"
          aria-live="polite"
          className="mx-4 mb-0 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 text-xs font-semibold text-[color:var(--text-muted)] sm:mx-5"
        >
          {notice}
        </p>
      ) : null}
      {/*
        Phone: three equal buttons in one row. Desktop: the card is the open target, so the
        actions shrink to their own width at the row's end instead of spanning the card.
      */}
      <div
        data-therapy-result-actions
        className="grid grid-cols-3 gap-2 px-4 py-3.5 sm:px-5 sm:pb-4 md:flex md:justify-end md:pt-0"
      >
        {/*
          A link rather than a `Button` with `router.push`. `b.workspaceHref`
          builds the same URL `b.open` pushes, so the destination is unchanged,
          but as a real anchor it can be stretched across the card — and a
          cmd-click, middle-click or long-press behaves the way the browser
          already knows how to make it behave.
        */}
        <Link
          href={b.workspaceHref(therapyRecordHref(therapy.slug))}
          className={cn(
            buttonFaceClass({ variant: openVariant, size: "sm", block: true }),
            cardActionButton,
            stretchedRowLinkClass,
          )}
          aria-label="Open record"
        >
          <ExternalLink aria-hidden="true" className="size-icon-md shrink-0" />
          <span className="max-sm:hidden">Open record</span>
          <span className="sm:hidden">Open</span>
        </Link>
        <Button
          variant="secondary"
          size="sm"
          block
          className={cn(cardActionButton, controlPressed, "relative z-10")}
          icon={Scale}
          // Adding no longer navigates: the tray above the composer is where the
          // set is now assembled, so this control fills it and leaves the reader
          // exactly where they were. The label moved with the behaviour — the
          // old "Compare" promised a destination it no longer goes to.
          onClick={
            compareFull
              ? ignoreUnavailableActivation
              : inCompare
                ? () => b.removeCompare(therapy.slug)
                : () => b.addCompare(therapy.slug)
          }
          aria-pressed={inCompare}
          aria-disabled={compareFull ? true : undefined}
          aria-describedby={compareFull ? compareFullId : undefined}
          title={compareFull ? `Compare holds ${THERAPY_MAX_COMPARE} therapies — remove one first` : undefined}
          aria-label={inCompare ? "In compare tray" : compareFull ? "Compare tray full" : "Add to compare"}
        >
          <span className="max-sm:hidden">
            {inCompare ? "In compare tray" : compareFull ? "Tray full" : "Add to compare"}
          </span>
          <span className="sm:hidden">{inCompare ? "In tray" : compareFull ? "Full" : "Add"}</span>
        </Button>
        {compareFull ? (
          <span id={compareFullId} className="sr-only">
            The comparison already holds {THERAPY_MAX_COMPARE} therapies. Remove one before adding another.
          </span>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          block
          className={cn(cardActionButton, "relative z-10")}
          icon={FileText}
          onClick={therapy.patientSheetAvailable ? () => b.openSheet(therapy.slug) : ignoreUnavailableActivation}
          aria-disabled={therapy.patientSheetAvailable ? undefined : true}
          aria-describedby={therapy.patientSheetAvailable ? undefined : sheetUnavailableId}
          title={therapy.patientSheetAvailable ? undefined : "This record has no patient sheet"}
          aria-label={sheetLabel}
        >
          <span className="max-sm:hidden">{sheetLabel}</span>
          <span className="sm:hidden">{sheetShort}</span>
        </Button>
        {therapy.patientSheetAvailable ? null : (
          <span id={sheetUnavailableId} className="sr-only">
            This record has no patient sheet.
          </span>
        )}
      </div>
    </article>
  );
}

function CardCell({
  icon: Icon,
  eyebrow,
  tone,
  text,
}: {
  icon: LucideIcon;
  eyebrow: string;
  tone: "accent" | "warning" | "muted";
  text: string;
}) {
  return (
    <div
      className={`bg-[color:var(--surface)] px-3 py-2.5 [&_p]:m-0 [&_p]:text-sm-minus [&_p]:leading-snug [&_p]:text-[color:var(--text-muted)] ${tone === "accent" ? "text-[color:var(--clinical-accent)]" : tone === "warning" ? "bg-[color:var(--warning-bg)] text-[color:var(--warning-text)] [&_p]:text-[color:var(--warning-text)]" : "text-[color:var(--text-muted)]"}`}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon size={13} strokeWidth={1.9} aria-hidden="true" />
        <Eyebrow tone={tone === "muted" ? "neutral" : tone}>{eyebrow}</Eyebrow>
      </div>
      <p className="line-clamp-2">{text}</p>
    </div>
  );
}

/**
 * Compact search-list row: one divided row inside the list's single hairline
 * card.
 *
 * The whole row opens the record (the title link is stretched across it), so
 * the three full-width buttons become quiet 48px icon controls. "Best used for"
 * and "Best fit" live in the record ("Use when", "What it targets", "Where it
 * is delivered", "Who it suits"), where they are shown in full.
 *
 * The Avoid / modify line stays on the row in the warning colour and is NEVER
 * clamped or cut: it is a safety cue, and the owner decided (October 2026) it
 * must read in full on every screen size without a tap.
 */
export function CompactResultRow({
  therapy,
  featured = false,
  query,
  outsideFilter = false,
  rank,
  whyMatched,
}: {
  therapy: Therapy;
  featured?: boolean;
  query?: string;
  /** Outside the active filters: still listed and tappable, title muted by token. */
  outsideFilter?: boolean;
  /**
   * Recommend's ranked list (Clinical audit, 13 Oct 2026, item 12): the rank
   * number leads the title and the review status shows under it, as on the
   * large card it replaces.
   */
  rank?: number;
  /** Recommend's ranking reasons, shown as one quiet line under the summary. */
  whyMatched?: string;
}) {
  const b = useTcBindings();
  const baseId = useId();
  const sheetUnavailableId = `${baseId}-sheet`;
  const compareFullId = `${baseId}-compare-full`;
  const { notice, saved, toggleFavourite } = useTherapyFavourite(therapy.slug);
  // The note is visible text; the shared announcer speaks it, so the row holds
  // no live region of its own.
  useEffect(() => {
    if (notice) announce(notice);
  }, [notice]);
  const inCompare = b.isInCompare(therapy.slug);
  // A full tray keeps its tab stop and states why, per the wiring convention.
  const compareFull = !inCompare && b.compareSlugs.length >= THERAPY_MAX_COMPARE;
  const rankingQuery = query ?? b.search.query;
  const subtitle =
    cardPreviewText(therapy.clinicalSummary, { exclude: therapy.name }) ||
    cardPreviewText(therapy.bestUsedFor, { exclude: therapy.name }) ||
    "";
  const tags = prioritiseTherapyTags(therapy.tags.length ? therapy.tags : [therapy.category], {
    query: rankingQuery,
    activeTags: b.search.tags,
  });
  const avoidModify = therapyAvoidModifyText(therapy);
  const quietIcon = "relative z-10 w-tap shrink-0 gap-0 px-0";

  return (
    <li
      data-therapy-result-card
      data-therapy-result-featured={featured ? "" : undefined}
      data-outside-filter={outsideFilter ? "true" : undefined}
      className="relative px-4 pt-3 pb-1.5 transition-colors sm:px-5 md:pb-3 md:hover:bg-[color:var(--surface-subtle)]"
    >
      {featured ? (
        <div
          data-therapy-result-highlight
          className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-2.5 py-0.5 text-2xs font-extrabold tracking-wide text-[color:var(--clinical-accent)] uppercase forced-colors:border-[CanvasText] forced-colors:text-[CanvasText]"
        >
          <Sparkles aria-hidden="true" size={12} strokeWidth={2.1} />
          Best match
        </div>
      ) : null}
      {/* Phone: title|chevron, the avoid line, then tags|actions. From md the
          actions and chevron move to a right-hand column. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 [grid-template-areas:'title_chev'_'avoid_avoid'_'foot_foot'] md:[grid-template-areas:'title_actions'_'avoid_actions'_'tags_actions']">
        <div className="min-w-0 [grid-area:title]">
          <h3
            className={cn(
              "m-0 text-base font-semibold leading-snug tracking-display",
              rank != null && "flex items-start gap-2",
              outsideFilter ? filterOutsideTitleClass : "text-[color:var(--text-heading)]",
            )}
          >
            {rank != null ? (
              <span
                data-therapy-result-rank
                className="mt-px inline-flex h-6 min-w-6 flex-none items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-xs font-extrabold nums text-[color:var(--text-heading)]"
              >
                <span className="sr-only">Rank </span>
                {rank}
              </span>
            ) : null}
            <Link
              href={b.workspaceHref(therapyRecordHref(therapy.slug))}
              data-therapy-result-open
              className={cn(
                "rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                stretchedRowLinkClass,
              )}
            >
              {therapy.name}
            </Link>
          </h3>
          {rank != null ? (
            <div className="mt-1">
              <StatusBadge status={therapy.reviewStatus} />
            </div>
          ) : null}
          {subtitle ? (
            <p className="m-0 mt-0.5 line-clamp-1 text-sm-minus leading-snug text-[color:var(--text-muted)]">
              {subtitle}
            </p>
          ) : null}
          {whyMatched ? (
            <p
              data-therapy-result-why
              className="m-0 mt-1 line-clamp-2 text-xs leading-snug text-[color:var(--text-muted)]"
            >
              <span className="font-bold text-[color:var(--text)]">Why matched: </span>
              {whyMatched}
            </p>
          ) : null}
        </div>
        <ChevronRight
          aria-hidden="true"
          className="mt-1 size-icon-md shrink-0 text-[color:var(--text-muted)] [grid-area:chev] md:hidden"
        />
        <p
          data-therapy-result-avoid
          className="m-0 mt-1.5 flex min-w-0 items-start gap-1.5 text-xs leading-snug text-[color:var(--warning-text)] [grid-area:avoid]"
        >
          <TriangleAlert aria-hidden="true" size={13} strokeWidth={2} className="mt-px shrink-0" />
          {/* No line clamp, no ellipsis, at any width: the full warning always shows. */}
          <span className="min-w-0 break-words">
            <span className="font-bold">Avoid / modify: </span>
            {avoidModify}
          </span>
        </p>
        <div className="flex min-w-0 items-center gap-2 [grid-area:foot] md:contents">
          <div className="mt-1 flex min-h-tap min-w-0 flex-1 items-center md:min-h-0 md:pb-1.5 md:[grid-area:tags]">
            {/* Whole tags only: a tag that does not fit wraps onto a hidden
                second line rather than being cut mid-word. */}
            <div className="flex max-h-7 min-w-0 flex-1 flex-wrap gap-x-1.5 gap-y-3 overflow-hidden">
              {tags.slice(0, 3).map((tag) => (
                <Tag key={tag} tone={tagTone(tag)}>
                  {tag}
                </Tag>
              ))}
            </div>
          </div>
          <div
            data-therapy-result-actions
            className="-mr-2 flex shrink-0 items-center self-center md:[grid-area:actions]"
          >
            <Button
              variant="ghost"
              icon={Heart}
              className={cn(quietIcon, favouritePressed)}
              aria-pressed={saved}
              onClick={() => void toggleFavourite()}
              title={saved ? "Remove from favourites" : "Save to favourites"}
            >
              <span className="sr-only">
                {saved ? `Remove ${therapy.name} from favourites` : `Save ${therapy.name} to favourites`}
              </span>
            </Button>
            <Button
              variant="ghost"
              icon={inCompare ? SquareCheck : Scale}
              className={cn(quietIcon, inCompare && "text-[color:var(--clinical-accent)]")}
              // Ticking fills the shared Compare tray and leaves the reader where they are.
              onClick={
                compareFull
                  ? ignoreUnavailableActivation
                  : inCompare
                    ? () => b.removeCompare(therapy.slug)
                    : () => b.addCompare(therapy.slug)
              }
              aria-pressed={inCompare}
              aria-disabled={compareFull ? true : undefined}
              aria-describedby={compareFull ? compareFullId : undefined}
              title={
                compareFull
                  ? `Compare holds ${THERAPY_MAX_COMPARE} therapies — remove one first`
                  : inCompare
                    ? "Remove from compare"
                    : "Add to compare"
              }
              testId="therapy-result-compare"
            >
              <span className="sr-only">
                {inCompare ? `Remove ${therapy.name} from compare` : `Add ${therapy.name} to compare`}
              </span>
            </Button>
            {compareFull ? (
              <span id={compareFullId} className="sr-only">
                The comparison already holds {THERAPY_MAX_COMPARE} therapies. Remove one before adding another.
              </span>
            ) : null}
            <Button
              variant="ghost"
              icon={FileText}
              className={cn(quietIcon, !therapy.patientSheetAvailable && "opacity-40")}
              onClick={therapy.patientSheetAvailable ? () => b.openSheet(therapy.slug) : ignoreUnavailableActivation}
              aria-disabled={therapy.patientSheetAvailable ? undefined : true}
              aria-describedby={therapy.patientSheetAvailable ? undefined : sheetUnavailableId}
              title={therapy.patientSheetAvailable ? "Patient sheet" : "This record has no patient sheet"}
            >
              <span className="sr-only">
                {therapy.patientSheetAvailable ? `Patient sheet for ${therapy.name}` : "Sheet unavailable"}
              </span>
            </Button>
            {therapy.patientSheetAvailable ? null : (
              <span id={sheetUnavailableId} className="sr-only">
                This record has no patient sheet.
              </span>
            )}
            <ChevronRight
              aria-hidden="true"
              className="ml-1 hidden size-icon-md shrink-0 text-[color:var(--text-muted)] md:block"
            />
          </div>
        </div>
      </div>
      {notice ? (
        <p className="mb-1.5 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 text-xs font-semibold text-[color:var(--text-muted)]">
          {notice}
        </p>
      ) : null}
    </li>
  );
}

/** The card's Avoid / modify wording: the first sentence of the cautions, unchanged. */
export function therapyAvoidModifyText(therapy: Therapy): string {
  return summarise(therapy.contraindicationsOrCautions, 1) || "Check source and review status before clinical use.";
}
