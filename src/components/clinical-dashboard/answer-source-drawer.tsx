"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Filter,
  MoreHorizontal,
  Search,
  TriangleAlert,
} from "lucide-react";

import { Sheet } from "@/components/ui/sheet";
import { cn, glassOverlaySurface, subtleStatusPill, textMuted } from "@/components/ui-primitives";
import { logSourceOpen } from "@/components/clinical-dashboard/source-actions";
import { cleanDisplayTitle, sourceQuoteDisplayText } from "@/components/clinical-dashboard/display-text";
import { SignedImage } from "@/components/clinical-dashboard/signed-image";
import { CanonicalAnswerTables } from "@/components/clinical-dashboard/visual-evidence";
import {
  answerSourceRailRowId,
  type AnswerSourceRow,
  imagesForSource,
  sourceBadgeDisplay,
  sourceRowIsStale,
  sourceStepSpokenLabel,
  sourceStatusShortLabel,
  sourceSupportSentence,
  tablesForSource,
} from "@/components/clinical-dashboard/answer-source-rows";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { type CanonicalAnswerTableRecord } from "@/lib/answer-render-policy";
import type { VisualEvidenceCard } from "@/lib/types";
import type { ClientQuoteCard as QuoteCard } from "@/lib/answer-client-payload";

/**
 * Above this many sources the numbered pager stops being a scan and starts being
 * a row of indistinguishable chips, so it degrades to prev / "n of m" / next.
 */
const NUMBERED_PAGER_LIMIT = 4;

/*
 * `tablesForSource` and `imagesForSource` moved to `answer-source-rows` so the
 * rail card's attachment marker and the drawer's contents are one rule, not two.
 */

function quoteCardForSource(quoteCards: QuoteCard[], source: AnswerSourceRow | null) {
  if (!source) return null;
  return quoteCards.find((card) => card.chunk_id === source.id) ?? null;
}

function passageForSource(quoteCard: QuoteCard | null, source: AnswerSourceRow | null) {
  if (!source) return "";
  return sourceQuoteDisplayText(quoteCard?.quote || source.snippet || "");
}

/**
 * One cited document at a time: the support it gives, the passage it was read
 * from, any table or image on that page, and the route to the original PDF.
 *
 * Built on the shared `Sheet` so the portal, focus trap, late focus return,
 * Escape/backdrop dismissal, and the bottom-sheet-on-phone / centred-from-`sm:`
 * split are the same ones every other product overlay uses.
 *
 * `openIndex` is the row the drawer is showing; `activeSupportIndex` is the row
 * a *claim* pointed at. They differ when the drawer was opened from the source
 * list rather than from a reference mark, which is why the support sentence has
 * a null case rather than asserting a claim that was never made.
 *
 * `activeClaimSupport` is that claim's recorded status. The sentence uses it
 * when present so a partial mark on a strong row does not hear "states the
 * claim directly".
 */
export function AnswerSourceDrawer({
  sources,
  openIndex,
  activeSupportIndex = null,
  activeClaimSupport = null,
  onOpenIndexChange,
  onClose,
  query,
  tables = [],
  visualEvidence = [],
  quoteCards = [],
  onFollowUpQuote,
  onScopeDocument,
  onReportSource,
}: {
  sources: AnswerSourceRow[];
  openIndex: number | null;
  activeSupportIndex?: number | null;
  activeClaimSupport?: "direct" | "partial" | "unsupported" | null;
  onOpenIndexChange: (index: number) => void;
  onClose: () => void;
  query?: string;
  tables?: CanonicalAnswerTableRecord[];
  visualEvidence?: VisualEvidenceCard[];
  quoteCards?: QuoteCard[];
  /**
   * Asks a follow-up question from the passage on screen. Carried over from the
   * evidence sheet's quote cards — the passage moved into the drawer, so the
   * action it supported moved with it rather than being dropped.
   */
  onFollowUpQuote?: (quote: QuoteCard) => void;
  /** Narrows the search to this document. A prop pass-through — the composer is untouched. */
  onScopeDocument?: (documentId: string) => void;
  /**
   * "This page doesn't support the claim."
   *
   * Once a number points at a specific page, the moment a clinician opens it and
   * finds it does not say that is the highest-value moment in the product to
   * catch a bad citation — and until now the surface had no control for it.
   */
  onReportSource?: (source: AnswerSourceRow) => void;
}) {
  /**
   * Resolved late rather than captured on open, so paging to another source
   * returns focus to the card that source actually occupies in the rail.
   *
   * The one case that must NOT go to the rail is a drawer opened from a mark and
   * still showing that mark's source: the reader was mid-sentence, and landing on
   * the rail loses the sentence they were checking. Returning `null` there hands
   * the decision back to `Sheet`, whose last fallback is the element that had
   * focus when the drawer opened — the mark itself. Paging clears
   * `activeSupportIndex`, so the rail behaviour resumes as soon as the drawer is
   * no longer showing the claim's own page.
   */
  const resolveReturnFocusTarget = useCallback(() => {
    if (openIndex === null) return null;
    if (activeSupportIndex !== null && activeSupportIndex === openIndex) return null;
    return document.getElementById(answerSourceRailRowId(openIndex));
  }, [activeSupportIndex, openIndex]);

  const open = openIndex !== null && openIndex >= 0 && openIndex < sources.length;
  const source = open ? sources[openIndex] : null;
  const quoteCard = quoteCardForSource(quoteCards, source);
  const passage = passageForSource(quoteCard, source);
  const sourceTables = open ? tablesForSource(tables, sources, openIndex) : [];
  const sourceImages = open ? imagesForSource(visualEvidence, sources, openIndex) : [];
  const stale = source ? sourceRowIsStale(source) : false;
  // Null unless a claim opened the drawer; see `sourceSupportSentence`.
  const supportSentence = sourceSupportSentence(source, activeSupportIndex, activeClaimSupport);
  const numbered = sources.length <= NUMBERED_PAGER_LIMIT;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      dismissOnBack
      testId="answer-source-drawer"
      title={source ? cleanDisplayTitle(source.title) : "Source"}
      description="Check the answer against the cited passage."
      closeLabel="Close source detail"
      // The number here is the same number the in-prose marks and the rail cards
      // use, so it goes through `sourceBadgeDisplay` and dashes for an uncited
      // "Also found" row. The compact pager's "3 of 6" is left as a digit: it
      // states a position within the list, not a source's name.
      titleAccessory={
        source ? (
          <span className={cn(subtleStatusPill, "nums min-h-6 whitespace-nowrap px-2 text-2xs")}>
            {sourceBadgeDisplay(source, openIndex ?? 0)} · p. {source.pageNumber ?? "n/a"}
          </span>
        ) : null
      }
      headerActions={
        source ? (
          <span className="flex items-center gap-0.5">
            <Link
              href={source.href}
              onClick={() => query && logSourceOpen(query, source)}
              className={drawerHeaderActionClass}
              aria-label={`Open ${cleanDisplayTitle(source.title)} in the document viewer`}
            >
              <ExternalLink aria-hidden="true" className="h-4 w-4" />
            </Link>
            {/* Keyed on the source id so the menu (and a half-finished report
                confirmation) resets when the pager moves to another document,
                without a setState-in-effect. */}
            <SourceOverflowMenu
              key={source.id}
              source={source}
              passage={passage}
              quoteCard={quoteCard}
              onFollowUpQuote={onFollowUpQuote}
              onScopeDocument={onScopeDocument}
              onReportSource={onReportSource}
              onCloseDrawer={onClose}
            />
          </span>
        ) : null
      }
      headerClassName="gap-2 p-2.5 sm:p-3"
      titleClassName="text-base-minus leading-5"
      contentClassName="max-h-[88dvh] bg-[color:var(--surface-raised)] sm:max-h-[min(85dvh,40rem)] sm:max-w-xl"
      bodyClassName="bg-[color:var(--surface-raised)] px-3 pb-0 pt-2 sm:p-3"
      resolveReturnFocusTarget={resolveReturnFocusTarget}
      footer={
        sources.length > 1 ? (
          <nav
            className="flex items-center justify-between gap-2"
            // "answer sources", not "cited sources": the pager also steps through
            // the retrieved-but-uncited "Also found" rows.
            aria-label="Move between answer sources"
            data-testid="answer-source-drawer-pager"
            data-pager-variant={numbered ? "numbered" : "compact"}
          >
            <button
              type="button"
              className={pagerStepClass}
              onClick={() => onOpenIndexChange(Math.max(0, (openIndex ?? 0) - 1))}
              disabled={(openIndex ?? 0) === 0}
              aria-label="Previous source"
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            </button>
            {numbered ? (
              <span className="flex min-w-0 items-center gap-1.5">
                {sources.map((row, index) => (
                  <button
                    key={`${row.id}:${index}`}
                    type="button"
                    onClick={() => onOpenIndexChange(index)}
                    aria-current={index === openIndex ? "true" : undefined}
                    aria-label={`Show ${sourceStepSpokenLabel(row, index).toLowerCase()}: ${cleanDisplayTitle(row.title)}`}
                    className={cn(
                      "nums grid h-12 min-w-12 place-items-center rounded-md border text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                      index === openIndex
                        ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                        : "border-[color:var(--border)] text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)]",
                    )}
                  >
                    {sourceBadgeDisplay(row, index)}
                  </button>
                ))}
              </span>
            ) : (
              <span className={cn("nums text-xs font-semibold", textMuted)}>
                {(openIndex ?? 0) + 1} of {sources.length}
              </span>
            )}
            <button
              type="button"
              className={pagerStepClass}
              onClick={() => onOpenIndexChange(Math.min(sources.length - 1, (openIndex ?? 0) + 1))}
              disabled={(openIndex ?? 0) >= sources.length - 1}
              aria-label="Next source"
            >
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </nav>
        ) : null
      }
      footerClassName="px-3 py-2 sm:px-3"
    >
      {source ? (
        <div className="grid gap-3 pb-3">
          {/* Owner decision 2026-08-31: the drawer opens on the passage.
              What stood here — a front-page cover thumbnail beside a sentence —
              cost the top third of the panel to say nothing about this page. The
              thumbnail is the FRONT page and never a render of the cited one (the
              index holds one cover per document), so it needed its own caption
              to stop it reading as "p. 12", and a document opened from the source
              list paired it with a sentence whose whole content was that there
              was no claim. The passage is what the clinician opened the drawer to
              check, so the passage is now the first thing in it.

              What survives is the sentence that says something: when a claim
              opened the drawer, how far this page backs THAT claim. */}
          {supportSentence ? (
            <p data-testid="answer-source-drawer-support" className="text-sm leading-6 text-[color:var(--text)]">
              {supportSentence}
            </p>
          ) : null}

          {stale ? (
            <p
              data-testid="answer-source-drawer-status"
              className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-md border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)]/45 px-2.5 py-2 text-xs leading-5 text-[color:var(--text)]"
            >
              <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--warning)]" />
              <span>
                <span className="font-semibold">{sourceStatusShortLabel(source.metadata)}</span> — this document is past
                its review date. Confirm the passage against a current source before acting on it.
              </span>
            </p>
          ) : null}

          {passage ? (
            <section aria-label="Cited passage">
              <p className={cn("mb-1.5 text-2xs font-semibold uppercase tracking-wide", textMuted)}>Cited passage</p>
              <blockquote
                data-testid="answer-source-drawer-passage"
                className="border-l-2 border-[color:var(--clinical-accent)]/35 pl-3 text-sm font-medium leading-6 text-[color:var(--text)]"
              >
                &ldquo;{passage}&rdquo;
              </blockquote>
              {onFollowUpQuote && quoteCard ? (
                <button
                  type="button"
                  data-testid="answer-source-drawer-follow-up"
                  onClick={() => {
                    onFollowUpQuote(quoteCard);
                    onClose();
                  }}
                  className="mt-2 inline-flex min-h-12 items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-xs font-semibold text-[color:var(--text)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--clinical-accent-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                >
                  <Search aria-hidden="true" className="h-3.5 w-3.5" />
                  Ask about this passage
                </button>
              ) : null}
            </section>
          ) : (
            /* A retrieved-but-uncited row carries no quote and no snippet, so
               there is nothing to quote here. Say that plainly: with the cover
               and the no-claim sentence gone, the alternative is a panel whose
               only content is a button, which reads as a failure rather than as
               a document with no captured passage. */
            <p data-testid="answer-source-drawer-no-passage" className={cn("text-sm leading-6", textMuted)}>
              No passage was captured for this source. Open the original PDF to read the page it points at.
            </p>
          )}

          {sourceTables.length ? (
            <section aria-label="Tables on this page" data-testid="answer-source-drawer-tables">
              <p className={cn("mb-1.5 text-2xs font-semibold uppercase tracking-wide", textMuted)}>
                {sourceTables.length === 1 ? "Table" : "Tables"}
              </p>
              <CanonicalAnswerTables tables={sourceTables} />
            </section>
          ) : null}

          {sourceImages.length ? (
            <section aria-label="Images on this page" data-testid="answer-source-drawer-images" className="grid gap-2">
              <p className={cn("text-2xs font-semibold uppercase tracking-wide", textMuted)}>
                {sourceImages.length === 1 ? "Image" : "Images"}
              </p>
              {sourceImages.slice(0, 3).map((card) => (
                <SignedImage
                  key={card.id}
                  endpoint={card.signed_url_endpoint}
                  alt={card.caption?.trim() || "Clinical document image"}
                  caption={card.caption}
                  className="max-h-52"
                  zoomable
                />
              ))}
            </section>
          ) : null}

          <Link
            href={source.href}
            onClick={() => query && logSourceOpen(query, source)}
            className="inline-flex min-h-12 items-center gap-1.5 justify-self-start rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-xs font-semibold text-[color:var(--text)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--clinical-accent-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            View original PDF
          </Link>
        </div>
      ) : null}
    </Sheet>
  );
}

const pagerStepClass =
  "grid h-12 w-12 shrink-0 place-items-center rounded-md border border-[color:var(--border)] text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

const drawerHeaderActionClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

const menuItemClass =
  "flex min-h-12 w-full items-center gap-2.5 px-3 text-left text-xs font-semibold text-[color:var(--text)] transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)]";

/**
 * The drawer's secondary actions.
 *
 * They are behind a menu rather than on the panel because the panel's job is the
 * passage: a row of four equal buttons under a cited quote competes with the one
 * thing the reader opened the drawer to check.
 *
 * Escape here closes the menu and **stops propagation**. `Sheet` listens for
 * Escape on `window` and this layer listens on `document`, which bubbles first —
 * without the stop, one Escape would close the menu and the drawer together.
 */
function SourceOverflowMenu({
  source,
  passage,
  quoteCard,
  onFollowUpQuote,
  onScopeDocument,
  onReportSource,
  onCloseDrawer,
}: {
  source: AnswerSourceRow;
  passage: string;
  quoteCard: QuoteCard | null;
  onFollowUpQuote?: (quote: QuoteCard) => void;
  onScopeDocument?: (documentId: string) => void;
  onReportSource?: (source: AnswerSourceRow) => void;
  onCloseDrawer: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmingReport, setConfirmingReport] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [focusTriggerOnClose, setFocusTriggerOnClose] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * Every route out of the menu, in one place.
   *
   * The report action is deliberately two-step, and the second step must not
   * outlive the first step's dismissal: arm confirm, press Escape, reopen, and a
   * single tap would otherwise file a citation report the reader never meant to
   * send. Escape, an outside click, the trigger toggle and activating an item
   * all come through here so that cannot happen.
   *
   * Deliberately a handler and not an effect on `open`. Clearing the flag in an
   * effect body is a cascading-render setState that `react-hooks/set-state-in-effect`
   * rejects, and it would also clear the flag one render late.
   */
  const closeMenu = useCallback(() => {
    setOpen(false);
    setConfirmingReport(false);
    setFocusTriggerOnClose(false);
  }, []);

  /**
   * Close the menu and put focus back on the trigger that opened it.
   *
   * For the actions that leave the drawer OPEN — Escape, copying the passage,
   * confirming a report. The button holding focus unmounts with the menu, so
   * without this focus falls to `<body>` while a modal dialog is still on
   * screen: a keyboard user is left outside the dialog with nothing to tab from
   * and no indication of where they are.
   *
   * Two things this deliberately does NOT cover, which is why the intent is
   * flagged explicitly rather than inferred from "the menu closed":
   *
   * - The actions that also close the drawer. `Sheet` restores focus to
   *   whatever opened the drawer, and moving focus here first would fight it
   *   and land the reader on a control that is about to disappear.
   * - Dismissing by clicking elsewhere. That click has already given focus to
   *   whatever was clicked, and pulling it back would take the reader somewhere
   *   they did not ask to go.
   *
   * The flag is state and the focus call is in an effect, rather than a ref
   * touched from the handler: `react-hooks/refs` rejects reaching a ref from a
   * callback built during render, and it is right to — this file's other focus
   * move lives in an effect for the same reason.
   */
  const dismissMenu = useCallback(() => {
    setOpen(false);
    setConfirmingReport(false);
    setFocusTriggerOnClose(true);
  }, []);

  useEffect(() => {
    if (open || !focusTriggerOnClose) return;
    triggerRef.current?.focus();
  }, [focusTriggerOnClose, open]);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closeMenu();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismissMenu();
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMenu, dismissMenu, open]);

  const items: Array<{ id: string; label: string; icon: typeof Copy; onActivate: () => void }> = [];
  if (passage) {
    items.push({
      id: "copy-passage",
      label: "Copy passage",
      icon: Copy,
      onActivate: () => {
        void copyTextToClipboard(passage)
          .then(() => setStatus("Passage copied."))
          .catch(() => setStatus("Copy failed — select the passage and copy it manually."));
        dismissMenu();
      },
    });
  }
  if (onFollowUpQuote && quoteCard) {
    items.push({
      id: "ask-passage",
      label: "Ask about this passage",
      icon: Search,
      onActivate: () => {
        onFollowUpQuote(quoteCard);
        closeMenu();
        onCloseDrawer();
      },
    });
  }
  if (onScopeDocument) {
    items.push({
      id: "scope-document",
      label: "Search only this document",
      icon: Filter,
      onActivate: () => {
        onScopeDocument(source.documentId);
        closeMenu();
        onCloseDrawer();
      },
    });
  }

  /**
   * The claim-mismatch report is for cited pages only.
   *
   * "This page doesn't support the claim" presupposes a claim pointing at this
   * page, and an "Also found" row has none — it was retrieved, never cited, and
   * no in-prose mark can reach it. Offering the report there invites a
   * citation-quality complaint about a citation that was never made, which is
   * unactionable for whoever reads the feedback and misleading for the
   * clinician filing it. The document actions above stay: copying the passage,
   * asking about it and scoping search to it are all statements about the
   * document, not about a claim.
   */
  const reportClaimMismatch = source.cited === false ? undefined : onReportSource;

  if (!items.length && !reportClaimMismatch) return null;

  return (
    <span className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid="answer-source-drawer-menu-trigger"
        aria-expanded={open}
        aria-label="More actions for this source"
        onClick={() => (open ? closeMenu() : setOpen(true))}
        className={drawerHeaderActionClass}
      >
        <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
      </button>
      {/* z-30: the rung above the sheet panel on the allowed ladder. */}
      {open ? (
        <div
          ref={menuRef}
          // A disclosure, not an ARIA menu. It was `role="menu"` with
          // `role="menuitem"` children and no roving focus or Arrow/Home/End
          // handling, which tells a screen-reader user to expect the menu
          // keyboard model and then gives them Tab. Naming it a labelled group
          // matches what it actually is and what Escape and Tab already do here;
          // promising the menu pattern would mean implementing it.
          role="group"
          data-testid="answer-source-drawer-menu"
          aria-label="Source actions"
          className={cn(
            glassOverlaySurface,
            "absolute right-0 top-9 z-30 w-60 overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)] py-1 shadow-[var(--e2)]",
          )}
        >
          {items.map((item) => (
            <button key={item.id} type="button" onClick={item.onActivate} className={menuItemClass}>
              <item.icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[color:var(--text-muted)]" />
              {item.label}
            </button>
          ))}
          {reportClaimMismatch ? (
            <button
              type="button"
              data-testid="answer-source-drawer-report"
              // Two steps on purpose: this writes a citation-quality report
              // against a named page, so it must not be reachable by one stray
              // tap in a menu the reader opened to copy a quote.
              onClick={() => {
                if (!confirmingReport) {
                  setConfirmingReport(true);
                  return;
                }
                reportClaimMismatch(source);
                setStatus("Reported. Thank you — this page is flagged for review.");
                dismissMenu();
              }}
              className={cn(
                menuItemClass,
                "border-t border-[color:var(--border)] text-[color:var(--warning)]",
                confirmingReport && "bg-[color:var(--warning-soft)]/50",
              )}
            >
              <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              {confirmingReport ? "Confirm: report this page" : "This page doesn't support the claim"}
            </button>
          ) : null}
        </div>
      ) : null}
      {/* Announced, not just drawn: the menu closes on activation, so a visual-only
          confirmation would leave a screen-reader user with no result at all. */}
      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>
    </span>
  );
}
