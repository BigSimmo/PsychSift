"use client";

import { ChevronDown, Info, ListTree, Printer, ShieldAlert } from "lucide-react";
import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { BrandMark } from "@/components/clinical-dashboard/brand";
import { NavigationBackButton } from "@/components/navigation-back-button";
import { PrivacyAtAGlance } from "@/components/privacy/at-a-glance";
import { ProcessingMap } from "@/components/privacy/processing-map";
import { PrivacySectionAccordion } from "@/components/privacy/section-accordion";
import { PrivacySectionIndex } from "@/components/privacy/section-index";
import { usePrivacyHashSection, writePrivacyHashSection } from "@/components/privacy/use-privacy-hash-section";
import { PrivacyPageBackButton } from "@/components/privacy-page-back-button";
import { Button } from "@/components/ui/button";
import { cn, eyebrowText, pageContainer, searchPageCanvas, searchFocusRing } from "@/components/ui-primitives";
import {
  PRIVACY_CLOSING_NOTE,
  PRIVACY_CONTENT_AS_OF,
  PRIVACY_DRAFT_DISCLAIMER,
  PRIVACY_IMPORTANT_FULL,
  PRIVACY_IMPORTANT_SHORT,
  PRIVACY_SECTIONS,
  type PrivacySectionId,
} from "@/lib/privacy-page-content";
import { resolveScrollBehavior } from "@/lib/scroll-behavior";
import { privacyCopy } from "@/lib/ui-copy";

/**
 * Production privacy page.
 *
 * Page structure:
 * - Compact sticky navigation header
 * - One composed trust brief owns the h1, lede, provenance, draft note and safety obligation
 * - At-a-glance facts share one divided surface — the answer layer, and a way into the prose
 * - The processing journey stacks on phones and becomes a three-stage strip at `sm`
 * - Accordion with numbered gists; desktop Signal Index and a phone jump control
 *
 * Governance copy stays in `privacy-page-content` (pinned by privacy-ui tests).
 *
 * This route is standalone — outside the `(search-app)` group, with no global
 * shell header — so `InformationPageShell`, `PhoneHeaderCollapsePortal` and the
 * in-page-nav chrome metrics do not apply and it owns its own sticky bar. The
 * safe-area pad literals below are pinned by
 * `tests/search-page-shell-standalone.contract.test.ts`.
 */

const atmosphere =
  "bg-[radial-gradient(ellipse_at_8%_-8%,color-mix(in_srgb,var(--clinical-accent-soft)_62%,transparent),transparent_34%),radial-gradient(ellipse_at_92%_4%,color-mix(in_srgb,var(--surface-inset)_58%,transparent),transparent_42%),linear-gradient(180deg,color-mix(in_srgb,var(--surface)_55%,transparent),transparent_18rem),var(--background)]";

const pagePadX = "px-4 sm:px-6 lg:px-8";

/** "1 September 2026": the plain Australian long date (design audit 13 Oct 2026, D22). */
const AS_OF_FORMAT = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const asOfLabel = AS_OF_FORMAT.format(new Date(`${PRIVACY_CONTENT_AS_OF}T00:00:00Z`));

/** Sentence-case small labels (design audit 13 Oct 2026, D22): no capitals, no letter spacing. */
const labelText = "text-xs font-semibold text-[color:var(--text-muted)]";
/** Same safe-area top pad as `searchPageShellStandalone` — owned here for sticky chrome. */
const pagePadTop = "pt-[max(0.75rem,var(--safe-area-top))] sm:pt-[max(1.25rem,var(--safe-area-top))]";

function PrintAction({ label = "Print" }: { label?: string }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={Printer}
      onClick={() => window.print()}
      testId="privacy-print"
      className="print:hidden"
    >
      {label}
    </Button>
  );
}

export function PrivacyQuietSignalPage() {
  const noticeId = useId();
  const sectionIdPrefix = useId();
  const phoneIndexId = useId();
  const sectionRefs = useRef<Partial<Record<PrivacySectionId, HTMLElement | null>>>({});
  const stickyChromeRef = useRef<HTMLDivElement | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [phoneIndexOpen, setPhoneIndexOpen] = useState(false);
  const firstSectionId = PRIVACY_SECTIONS[0]?.id ?? null;
  // A set, not one id plus an `expandAll` flag. Those two fought: with everything
  // expanded, opening any single section collapsed the other nine.
  const [manualOpenIds, setManualOpenIds] = useState<ReadonlySet<PrivacySectionId>>(
    () => new Set(firstSectionId ? [firstSectionId] : []),
  );
  const [lastSelectedId, setLastSelectedId] = useState<PrivacySectionId | null>(firstSectionId);
  const hashSectionId = usePrivacyHashSection();
  const deepLinkHandled = useRef(false);
  // A deep-linked section is open by derivation, so arriving on
  // `/privacy#retention` needs no bootstrap render.
  const openIds: ReadonlySet<PrivacySectionId> = useMemo(
    () =>
      hashSectionId && !manualOpenIds.has(hashSectionId)
        ? new Set<PrivacySectionId>([...manualOpenIds, hashSectionId])
        : manualOpenIds,
    [hashSectionId, manualOpenIds],
  );
  const activeId = hashSectionId ?? lastSelectedId;
  const [stickyChromeHeightPx, setStickyChromeHeightPx] = useState(80);
  // When enlarged text makes the header taller than the viewport, sticky chrome
  // would cover every accordion hit target — drop sticky in that case.
  const [chromeSticky, setChromeSticky] = useState(true);

  useEffect(() => {
    const el = stickyChromeRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      setStickyChromeHeightPx(height);
      setChromeSticky(height < window.innerHeight);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const scrollToSection = useCallback((id: PrivacySectionId) => {
    // `resolveScrollBehavior`, never a hard-coded "smooth": an explicit behavior in
    // ScrollIntoViewOptions overrides the reduced-motion CSS in globals.css.
    sectionRefs.current[id]?.scrollIntoView({ behavior: resolveScrollBehavior(), block: "start" });
  }, []);

  /** Open a section and bring it into view — the index and the fact tiles land here. */
  const openSection = useCallback(
    (id: PrivacySectionId) => {
      setManualOpenIds((current) => {
        if (current.has(id)) return current;
        const next = new Set(current);
        next.add(id);
        return next;
      });
      setLastSelectedId(id);
      setPhoneIndexOpen(false);
      writePrivacyHashSection(id);
      deepLinkHandled.current = true;
      scrollToSection(id);
    },
    [scrollToSection],
  );

  // Arrival only. Later fragment writes scroll from the handler above, so this
  // never re-runs for an in-page selection.
  useEffect(() => {
    if (deepLinkHandled.current || !hashSectionId) return;
    deepLinkHandled.current = true;
    scrollToSection(hashSectionId);
  }, [hashSectionId, scrollToSection]);

  const toggleSection = useCallback(
    (id: PrivacySectionId) => {
      setManualOpenIds((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setLastSelectedId(id);
      // Closing the section the fragment points at has to drop the fragment too,
      // or the derived open set would immediately reopen it.
      if (openIds.has(id) && hashSectionId === id) writePrivacyHashSection(null);
    },
    [hashSectionId, openIds],
  );

  const allOpen = openIds.size === PRIVACY_SECTIONS.length;

  const toggleExpandAll = () => {
    if (allOpen && hashSectionId) writePrivacyHashSection(null);
    setManualOpenIds(allOpen ? new Set() : new Set(PRIVACY_SECTIONS.map((section) => section.id)));
  };

  const expandAllButton = (
    <Button
      variant="secondary"
      size="sm"
      onClick={toggleExpandAll}
      testId="privacy-expand-all"
      className="border-transparent bg-transparent shadow-none hover:border-transparent hover:bg-[color:var(--surface-subtle)]"
    >
      {allOpen ? "Collapse all" : "Expand all"}
    </Button>
  );

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={cn(
        "privacy-page",
        searchPageCanvas,
        atmosphere,
        "focus-ring-contained min-h-dvh focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]",
      )}
    >
      <div
        ref={stickyChromeRef}
        data-testid="privacy-sticky-chrome"
        data-sticky={chromeSticky ? "true" : "false"}
        className={cn(
          chromeSticky && "sticky top-0",
          "z-30 border-b border-[color:var(--border-strong)] shadow-[var(--e2)]",
          // Phone baseline: a full-width opaque bar with no blur, matching the
          // `.edge-glass-header` / `.universal-header` phone rule in globals.css.
          // This page had carried translucent glass at every width, so scrolled
          // content ghosted straight through the title — visible against the
          // amber obligation band, which showed through the header text.
          "bg-[color:var(--surface)] backdrop-blur-none",
          // From sm the shared glass treatment is correct again.
          "sm:bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] sm:backdrop-blur-xl",
          "print:hidden",
        )}
      >
        <div className={cn(pagePadX, pagePadTop, "pb-2.5 sm:pb-3")}>
          <div className={cn(pageContainer, "flex min-h-tap items-center gap-2.5 sm:gap-3")}>
            <Suspense fallback={<NavigationBackButton fallbackHref="/" />}>
              <PrivacyPageBackButton />
            </Suspense>
            <BrandMark tone="emphasis" className="h-9 w-9 shrink-0 sm:h-10 sm:w-10 lg:h-12 lg:w-12" />
            <div className="min-w-0 flex-1">
              <p className={cn(eyebrowText, "shrink-0")}>{privacyCopy.pageEyebrow}</p>
              <p className="mt-0.5 truncate text-sm font-semibold tracking-display text-[color:var(--text-heading)] sm:text-base-minus lg:text-lg">
                Data handling
              </p>
            </div>
            <div className="hidden shrink-0 sm:block">
              <PrintAction />
            </div>
          </div>
        </div>
      </div>

      <div className={cn(pagePadX, "py-5 sm:py-7 lg:py-10")}>
        <div className={cn(pageContainer, "space-y-5 sm:space-y-6")}>
          <div
            data-testid="privacy-trust-brief"
            className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] shadow-[var(--e1)]"
          >
            <header className="relative overflow-hidden px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-9">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_at_18%_0%,color-mix(in_srgb,var(--clinical-accent-soft)_72%,transparent),transparent_68%)]"
              />
              <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] lg:gap-10">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[color:var(--clinical-accent)]">Privacy overview</p>
                  <h1
                    id="privacy-page-title"
                    className="mt-2 max-w-[var(--measure-trust-heading)] text-balance text-2xl font-extrabold leading-tight tracking-tight text-[color:var(--text-heading)] sm:text-3xl lg:text-4xl"
                  >
                    {privacyCopy.pageTitle}
                  </h1>
                  <p className="mt-3 max-w-[var(--measure)] text-pretty text-sm font-medium leading-6 text-[color:var(--text-muted)] sm:text-base-minus sm:leading-7">
                    Understand what information PsychSift handles, where it is processed, how long it is retained, and
                    what you need to do before using it.
                  </p>
                </div>

                <dl className="grid self-end overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]/80 shadow-[var(--shadow-inset)]">
                  <div className="grid gap-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-3 lg:grid-cols-1">
                    <dt className={labelText}>Describes how PsychSift is set up as of</dt>
                    <dd className="text-sm font-semibold text-[color:var(--text-heading)]">
                      <time dateTime={PRIVACY_CONTENT_AS_OF} data-testid="privacy-as-of">
                        {asOfLabel}
                      </time>
                    </dd>
                  </div>
                  <div className="border-t border-[color:var(--border)] px-3 py-2.5">
                    <dt className={labelText}>Coverage</dt>
                    <dd className="mt-1 text-sm font-semibold text-[color:var(--text-heading)]">
                      Applies to every PsychSift mode
                    </dd>
                  </div>
                </dl>
              </div>

              <p
                role="note"
                data-testid="privacy-draft-disclaimer"
                className="relative mt-5 flex max-w-[var(--measure)] items-start gap-2 border-t border-[color:var(--border)] pt-4 text-xs leading-5 text-[color:var(--text-muted)]"
              >
                <Info aria-hidden="true" className="mt-0.5 size-icon-xs shrink-0 text-[color:var(--text-muted)]" />
                <span>{PRIVACY_DRAFT_DISCLAIMER}</span>
              </p>
            </header>

            <section
              aria-labelledby="privacy-important-heading"
              className="border-t border-[color:var(--warning-border)] bg-[color:var(--warning-bg)]"
            >
              <div className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1 px-4 py-3.5 sm:flex sm:flex-nowrap sm:gap-3 sm:px-6 sm:py-4 lg:px-8">
                <ShieldAlert className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--warning)]" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <h2 id="privacy-important-heading" className="text-sm font-bold text-[color:var(--warning-text)]">
                    Before you use PsychSift
                  </h2>
                  <p className="mt-1 max-w-[var(--measure)] text-sm font-semibold leading-5 text-[color:var(--text-heading)] sm:leading-6">
                    {PRIVACY_IMPORTANT_SHORT}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setNoticeOpen((value) => !value)}
                  aria-expanded={noticeOpen}
                  aria-controls={noticeId}
                  className={cn(
                    "col-start-2 inline-flex min-h-tap shrink-0 items-center justify-center gap-1 justify-self-start rounded-lg px-3 text-sm font-semibold text-[color:var(--warning-text)] transition hover:bg-[color:var(--surface-raised)]/70 sm:col-auto sm:self-center sm:justify-self-auto print:hidden",
                    searchFocusRing,
                  )}
                >
                  {noticeOpen ? "Show less" : "Read more"}
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "size-icon-xs transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
                      noticeOpen && "rotate-180",
                    )}
                  />
                </button>
              </div>
              <div
                id={noticeId}
                role="region"
                aria-labelledby="privacy-important-heading"
                className={cn(
                  "border-t border-[color:var(--warning-border)] bg-[color:var(--surface-raised)]/78 px-4 py-3.5 sm:px-6 lg:px-8",
                  !noticeOpen && "hidden",
                  "print:block",
                )}
              >
                <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-heading)]">
                  {PRIVACY_IMPORTANT_FULL}
                </p>
              </div>
            </section>
          </div>

          <PrivacyAtAGlance onOpenSection={openSection} />

          <ProcessingMap density="compact" />
        </div>
      </div>

      <div className={cn(pagePadX, "pb-8 lg:pb-12")}>
        <div
          data-print-stack
          className={cn(pageContainer, "grid grid-cols-1 gap-6 lg:grid-cols-[16.5rem_minmax(0,1fr)] lg:gap-8")}
        >
          <aside
            className="hidden h-fit rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-2.5 shadow-[var(--shadow-inset)] lg:sticky lg:block print:hidden"
            style={{ top: chromeSticky ? stickyChromeHeightPx + 12 : 12 }}
          >
            <p className={cn(labelText, "mb-1.5 px-2.5 pt-1.5")}>On this page</p>
            <PrivacySectionIndex activeId={activeId} onSelect={openSection} idPrefix={`${sectionIdPrefix}-desktop`} />
          </aside>

          <div className="min-w-0 space-y-4 sm:space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <p className={labelText}>Privacy details</p>
                <h2 className="mt-1 text-lg font-semibold tracking-display text-[color:var(--text-heading)] sm:text-xl">
                  How your information is handled
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-1 shadow-[var(--shadow-inset)] print:hidden">
                <button
                  type="button"
                  onClick={() => setPhoneIndexOpen((value) => !value)}
                  aria-expanded={phoneIndexOpen}
                  aria-controls={phoneIndexId}
                  className={cn(
                    "inline-flex min-h-tap items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-[color:var(--text)] transition hover:bg-[color:var(--surface-subtle)] lg:hidden",
                    searchFocusRing,
                  )}
                >
                  <ListTree aria-hidden="true" className="size-icon-xs shrink-0" />
                  Jump to a section
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "size-icon-xs shrink-0 transition-transform duration-[var(--duration-fast)] motion-reduce:transition-none",
                      phoneIndexOpen && "rotate-180",
                    )}
                  />
                </button>
                {expandAllButton}
              </div>
            </div>

            {/*
              In-flow, never sticky: `docs/search-chrome-behaviour.md` allows one
              phone nav owner per page, and this route's sticky bar is already it.
            */}
            <div
              id={phoneIndexId}
              className={cn(
                "rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-2 shadow-[var(--shadow-inset)] lg:hidden",
                !phoneIndexOpen && "hidden",
                "print:hidden",
              )}
            >
              <PrivacySectionIndex activeId={activeId} onSelect={openSection} idPrefix={`${sectionIdPrefix}-phone`} />
            </div>

            <PrivacySectionAccordion
              idPrefix={sectionIdPrefix}
              openIds={openIds}
              onToggle={toggleSection}
              sectionRefs={sectionRefs}
              stickyOffsetPx={chromeSticky ? stickyChromeHeightPx : 0}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--border)] px-1 py-4 sm:px-0">
              <p className="min-w-0 max-w-[var(--measure)] text-xs leading-5 text-[color:var(--text-muted)]">
                {PRIVACY_CLOSING_NOTE}
              </p>
              <PrintAction label="Print this page" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
