"use client";

import { ArrowLeft, ChevronDown, Ellipsis, type LucideIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { PhoneHeaderCollapsePortal } from "@/components/clinical-dashboard/phone-header-collapse-portal";
import { DocumentSectionList, DocumentSectionTrack } from "@/components/document-viewer/section-nav";
import { InPageSectionRail } from "@/components/in-page-nav/in-page-section-rail";
import { toDocumentSections, type PageSection } from "@/components/in-page-nav/page-section-index";
import { useInPageChromeMetrics } from "@/components/in-page-nav/use-in-page-chrome-metrics";
import { usePageSectionWeights } from "@/components/in-page-nav/use-page-section-weights";
import { useModeBandShown } from "@/components/mode-band/mode-band-shown";
import type { ModeNavDensityProfile } from "@/components/mode-nav/mode-nav-bands";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { cn, pageContainer } from "@/components/ui-primitives";
import { useStickyWorkTabs } from "@/components/work-frame/use-sticky-work-tabs";
import { WorkPageBack } from "@/components/work-frame/work-page-back";

type InPageNavHeaderSharedProps = {
  /**
   * `label` is the mode home's name: shown from `sm`, and the aria-label at
   * every width.
   *
   * OMIT IT for a page that is a destination rather than a child. On Call's
   * seven pages are all reached from the mode pill, which lists them and the
   * hub together, so an arrow pointing at the hub described a hierarchy that
   * does not exist — and it put a navigation control at the head of a row
   * whose entire job is navigating INSIDE this page. Leaving it out frees the
   * gutter for the page's own name, and the way out is the pill that got you
   * here.
   */
  back?: { href: string; label: string };
  title: string;
  /**
   * Information pages keep their large record title in the body, so the header
   * title is a `<span>` and the page still has exactly one `<h1>`. Pages whose
   * header *is* the only title (the document viewer shape) pass `"h1"`.
   */
  titleAs?: "span" | "h1";
  /**
   * `true` when chrome DIRECTLY ABOVE this header already names the page, so
   * painting the name again stacks two copies of one word.
   *
   * On Call is the case it exists for: its mode pill names the current page,
   * with the mode itself as a small line beneath, and this header sits in that
   * same pill's collapse row on a phone. The title is still required and still
   * reaches assistive technology — it names the section sheet and the actions
   * sheet — it simply is not drawn on the row.
   *
   * With nothing else claiming the row (no back, no promoted action, no view
   * mode, no actions sheet), the row is omitted rather than drawn empty, and a
   * rail becomes the whole header. That combination is only safe alongside a
   * rail, whose More slot is then the page's overflow: without one, hiding the
   * title would also hide the section disclosure and strand every section.
   */
  titleHidden?: boolean;
  /**
   * The one page action worth reaching at any scroll position. It is
   * deliberately singular: a second promoted control is what turns a header row
   * back into the wrapping toolbar this template replaced. Everything else
   * belongs in `actions`.
   */
  primaryAction?: {
    label: string;
    icon: LucideIcon;
    onClick: () => void;
    /**
     * Present only when the promoted action is a genuine two-state toggle (a
     * favourite). It sets `aria-pressed` and fills the glyph, so the state has a
     * shape channel as well as a colour one. Callers that pass it must also
     * change `label` between states ("Save" / "Saved") — the label is the
     * accessible name, and a name that never moves would leave the state
     * carried by the fill alone.
     */
    pressed?: boolean;
  };
  /**
   * `true` drops the promoted action's text label at every width, leaving the
   * icon. Use when the icon carries the meaning on its own (a person glyph for
   * patient details) and the label would only widen the group.
   */
  primaryActionIconOnly?: boolean;
  /**
   * A page-level view mode — how the page renders, not where you are in it.
   *
   * From `sm` it sits inline in the row and costs no extra height. Below `sm` it
   * moves **into the actions sheet** rather than claiming a full-width band
   * under the row: a view mode is set once and then read past, so it does not
   * earn permanent pinned chrome on the smallest screen. That band was the only
   * thing on any converted page that took a second phone row.
   *
   * It therefore requires `actions` — without a sheet to move into there would
   * be no way to reach it on a phone.
   */
  mode?: {
    /** Group label, e.g. "Reading level". */
    label: string;
    value: string;
    options: ReadonlyArray<SegmentedControlOption<string>>;
    onChange: (value: string) => void;
  };
  /** Section-sheet heading. Defaults to `title`. */
  sectionSheetTitle?: string;
  /**
   * Contents of the actions sheet. Omit and no ellipsis control is rendered at
   * all — a page with no actions gets no button that opens an empty sheet.
   *
   * A function form receives a callback that closes the sheet, for a client page
   * whose actions run handlers. Plain `ReactNode` exists because four of the
   * converted information pages are Server Components: React cannot pass a
   * function across that boundary, but server-rendered JSX passed as a slot is
   * fine. Those pages' actions are `<Link>`s, and the sheet closes on the
   * `pathname` change they cause.
   */
  actions?: ReactNode | ((close: () => void) => ReactNode);
  /** Actions-sheet heading, e.g. "This service". */
  actionsTitle?: string;
  actionsDescription?: string;
  /** Noun in the actions control labels, e.g. "service" -> "Open service actions". */
  actionsNoun?: string;
  /** `"service"` yields `service-detail-header`, `service-section-trigger`, and so on. */
  testIdPrefix: string;
  className?: string;
  /** Inner row width. Defaults to the shared `pageContainer`. */
  containerClassName?: string;
};

/**
 * Section navigation is all-or-nothing: a non-empty `sections` list renders the
 * disclosure, sheet, and track, so `onSelectSection` must be present or those
 * controls would click with no effect. Omit `sections` for the breadcrumb shape.
 */
export type InPageNavHeaderProps =
  | (InPageNavHeaderSharedProps & {
      /**
       * Omit on a page with no section index. The header then drops the title
       * disclosure, the section sheet and the segment track and renders the
       * breadcrumb shape: back, title, optional primary action, optional view mode,
       * ellipsis. `usePageSectionWeights` observes nothing for an empty list, so
       * those pages pay none of the measurement cost.
       */
      sections?: undefined;
      activeId?: undefined | null;
      onSelectSection?: undefined;
    })
  | (InPageNavHeaderSharedProps & {
      sections: readonly PageSection[];
      activeId?: string | null;
      onSelectSection: (id: string) => void;
      /**
       * Render the sections as a visible second rail instead of the weighted
       * track (`docs/search-chrome-behaviour.md`, "Two-rail adopters").
       *
       * Only for a route whose sections are discrete panels and few enough to
       * name in a row. The rail then owns "where am I", so from `sm` — where
       * every section fits — the title stops being a disclosure and the sheet is
       * not rendered at all. Below `sm` the rail scrolls and the disclosure
       * returns as its overflow.
       */
      rail?: {
        label: string;
        /**
         * Calibrated label family, moving only the band widths. Required: see
         * the note on `InPageSectionRail`'s own `density` for why inheriting a
         * default here shipped a regression.
         */
        density: ModeNavDensityProfile;
        /** `true` when every slot carries a count badge beside its label. */
        countedLabels?: boolean;
        /** An app-mode id when the bar should carry that mode's identity hue. */
        modeIdentity?: string;
      };
    });

/**
 * The repository's default in-page navigation, codified in
 * `docs/search-chrome-behaviour.md` ("Default in-page navigation template"):
 * back control, title carrying the active section on line two behind a chevron
 * disclosure, ellipsis page actions, and a weighted segment track pinned to the
 * header's bottom edge.
 *
 * It has two shapes, and the section list decides which. With `sections`, the
 * above. Without them — the record pages behind `InformationPageBreadcrumbs`
 * have no section index — the disclosure and the track would be a sheet listing
 * one item and a single full-width segment, so both are dropped and the row
 * becomes the breadcrumb shape: back, title, an optional `primaryAction`, an
 * optional view `mode`, ellipsis. Same row grammar, same single collapse owner,
 * none of the section machinery.
 *
 * Extracted from the differentials detail page, which built the template by hand
 * first. `DocumentViewer` keeps its own copy — it owns the `<h1>`, uses the
 * `edge-glass-header` treatment, and is pinned by visual baselines. That is a
 * settled non-adoption, not pending work: see "DocumentViewer keeps its own
 * header — decided, not pending" in `docs/search-chrome-behaviour.md`.
 *
 * `relative` on the header is load-bearing: the track is absolutely positioned
 * against it, and a `static` phone header would let the track escape to whichever
 * ancestor happens to be positioned. `sm:sticky` applies only from `sm`, because
 * below that `PhoneHeaderCollapsePortal` moves this subtree into the universal
 * header's collapse row, which owns the scroll motion — this must never grow a
 * scroll-hide hook of its own.
 *
 * `z-20`, one below `MasterSearchHeader`'s `z-30`, is load-bearing too: this bar
 * and the app header are siblings in the DOM (this one renders inside `<main>`,
 * after the header), not nested inside its stacking context. Equal z-index ties
 * resolve by DOM order, so a bare `z-30` here used to win the tie once scrolled
 * under the app header — painting over (and swallowing clicks meant for) the
 * open Mode menu and other header popovers, on desktop where this bar renders
 * in place instead of collapsing into the universal header.
 */
export function InPageNavHeader(props: InPageNavHeaderProps) {
  const {
    back,
    title,
    titleAs = "span",
    titleHidden = false,
    primaryAction,
    primaryActionIconOnly = false,
    mode,
    sectionSheetTitle,
    actions,
    actionsTitle,
    actionsDescription,
    actionsNoun = "page",
    testIdPrefix,
    className,
    containerClassName,
  } = props;
  // Discriminated: present `sections` always carries `onSelectSection`. Default
  // the list to empty for the breadcrumb shape so measurement sees nothing.
  const sections = props.sections ?? [];
  const activeId = props.activeId ?? null;
  const onSelectSection = props.sections ? props.onSelectSection : undefined;
  const rail = props.sections ? props.rail : undefined;
  // Both sheets record the route they were opened on rather than a bare
  // boolean, so navigating closes them without an effect that resets state.
  // This is load-bearing, not tidiness: most page actions are `<Link>`s, and
  // action JSX passed in from a Server Component has no way to call `close()`.
  // Deriving from the pathname covers every link generically, and matches the
  // shell already resetting phone scroll state on navigation (search-chrome
  // invariant 14).
  // `null` is the closed sentinel and must never be a value `currentPath` can
  // take: `usePathname()` returns null outside a router (which is how this
  // renders in DOM tests), and a null-vs-null match would read as open.
  const currentPath = usePathname() ?? "";
  const [sectionSheetPath, setSectionSheetPath] = useState<string | null>(null);
  const [actionsPath, setActionsPath] = useState<string | null>(null);
  const sectionSheetOpen = sectionSheetPath !== null && sectionSheetPath === currentPath;
  const actionsOpen = actionsPath !== null && actionsPath === currentPath;
  const setSectionSheetOpen = (open: boolean) => setSectionSheetPath(open ? currentPath : null);
  const setActionsOpen = (open: boolean) => setActionsPath(open ? currentPath : null);
  // The section sheet can open from the title disclosure or a priority rail's
  // More slot. Capture the button that actually opened it so closing never
  // returns focus to a breakpoint-hidden sibling.
  const sectionSheetOpenerRef = useRef<HTMLButtonElement | null>(null);
  const sectionTitleTriggerRef = useRef<HTMLButtonElement | null>(null);
  const openSectionSheet = (opener: HTMLButtonElement) => {
    sectionSheetOpenerRef.current = opener;
    setSectionSheetOpen(true);
  };
  const actionsTriggerRef = useRef<HTMLButtonElement | null>(null);

  // More can open the sheet at the three-slot band and then vanish under the
  // 33rem `@container` rule while the dialog is still open (rotate / resize).
  // Sheet only requires `isConnected` before restore, so a late resolver must
  // pick a currently displayed control — title disclosure or a rail section.
  const isDisplayedFocusTarget = (element: HTMLElement | null): element is HTMLElement => {
    if (!element?.isConnected) return false;
    let node: HTMLElement | null = element;
    while (node) {
      if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
      // Inline `display: none` is how DOM tests simulate the `@container` /
      // `sm:hidden` bands without loading stylesheet rules into jsdom.
      if (node.style.display === "none") return false;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      node = node.parentElement;
    }
    return true;
  };
  const resolveSectionSheetReturnFocus = useCallback((): HTMLElement | null => {
    const opener = sectionSheetOpenerRef.current;
    const titleTrigger = sectionTitleTriggerRef.current;
    // Keep the established rail-breakpoint contract: a title disclosure with
    // no layout box is hidden even when a stylesheet-free DOM test cannot
    // resolve the responsive `sm:hidden` class through computed styles.
    const titleTriggerIsDisplayed =
      isDisplayedFocusTarget(titleTrigger) && (!rail || titleTrigger.getClientRects().length > 0);
    if (opener !== titleTrigger && isDisplayedFocusTarget(opener)) return opener;
    if (titleTriggerIsDisplayed) return titleTrigger;
    const railRoot = window.document.querySelector<HTMLElement>(`[data-testid="${testIdPrefix}-section-rail"]`);
    if (!railRoot) return null;
    const active = railRoot.querySelector<HTMLButtonElement>('button[aria-current="true"]');
    if (isDisplayedFocusTarget(active)) return active;
    return Array.from(railRoot.querySelectorAll<HTMLButtonElement>("li button")).find(isDisplayedFocusTarget) ?? null;
  }, [rail, testIdPrefix]);

  useInPageChromeMetrics();

  const measuredWeights = usePageSectionWeights(sections);
  const documentSections = toDocumentSections(sections, measuredWeights);
  const activeIndex = documentSections.findIndex((section) => section.id === activeId);
  const activeSection = documentSections[activeIndex] ?? documentSections[0];
  const ActiveIcon = activeSection?.icon;
  const TitleTag = titleAs;
  // With the title unpainted and nothing else claiming the row, drawing it
  // would cost 48px of empty band directly under the pill that already names
  // the page — which is the height this whole redesign went looking for.
  // Back lives in the top bar's round left button (one Back, in the top bar),
  // so it no longer claims a place in this row.
  const rowHasContent = !titleHidden || Boolean(primaryAction || actions || mode);

  // Header standard (13 Oct 2026): a page with a tab rail behaves as a Work
  // band does. The title row scrolls away with the page, the rail pins under
  // the top bar, and the rail slides away and back with the bar. Under a mode
  // band the band's own tabs are the pinned row, so this one stays in the page.
  const underBand = useModeBandShown();
  const pinRail = Boolean(rail) && !underBand;
  const [pinnedHeader, setPinnedHeader] = useState<HTMLElement | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  useStickyWorkTabs(pinRail ? pinnedHeader : null, railRef);
  // While only the rail shows, the page's actions ride at its end, so the one
  // action worth reaching at any scroll position (a record's Save) is not
  // clipped away with the title row.
  const subscribeStuck = useCallback(
    (notify: () => void) => {
      if (!pinnedHeader || typeof MutationObserver === "undefined") return () => {};
      const observer = new MutationObserver(notify);
      observer.observe(pinnedHeader, { attributes: true, attributeFilter: ["data-stuck"] });
      return () => observer.disconnect();
    },
    [pinnedHeader],
  );
  const railStuck = useSyncExternalStore(
    subscribeStuck,
    () => pinRail && Boolean(pinnedHeader?.hasAttribute("data-stuck")),
    () => false,
  );
  // A row with no section navigation (a title and its actions) is a heading,
  // not navigation: it scrolls away with the page, as a Work band's title does,
  // so scrolling up brings back the top bar alone. Under a mode band the band's
  // tabs are the pinned row, so a record's own header stays in the page too
  // rather than returning beside them.
  const scrollsAway = !rail && documentSections.length === 0;
  const inFlow = pinRail || scrollsAway || underBand;
  const HeaderHost = inFlow ? InFlowHeader : PhoneHeaderCollapsePortal;

  const actionGroup =
    primaryAction || actions ? (
      // One joined group, not two free-standing controls. A bordered
      // promoted action beside a borderless ellipsis reads as two
      // unrelated things competing at the end of the row; a single
      // border with a hairline between the members reads as one control
      // with two actions. `sm:order-2` keeps the phone DOM order
      // (verbs before mode) as the keyboard order while desktop still
      // paints mode between the title and the verbs.
      <span
        data-testid={`${testIdPrefix}-action-group`}
        className="ml-auto inline-flex shrink-0 items-stretch overflow-hidden rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] shadow-[var(--shadow-inset)] sm:order-2"
      >
        {primaryAction ? (
          // Not the filled `--command` slab: a control pinned to every
          // scroll position should not be the page's heaviest. The label
          // is `sr-only` below `sm` so the accessible name never changes
          // with the breakpoint.
          <button
            type="button"
            onClick={primaryAction.onClick}
            title={primaryAction.label}
            aria-pressed={primaryAction.pressed}
            data-testid={`${testIdPrefix}-primary-action`}
            className={cn(
              // Explicit focus styles rather than `focus-ring-tab`: that
              // utility sets a `border-radius`, and a rounded child
              // inside a rounded, clipped group paints a second corner
              // against the group's own edge.
              "flex min-h-tap items-center justify-center gap-2 px-3 text-sm font-bold text-[color:var(--text-heading)] transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus)]",
              primaryActionIconOnly ? "w-tap px-0" : "max-sm:w-tap max-sm:gap-0 max-sm:px-0",
            )}
          >
            <primaryAction.icon
              className={cn(
                "h-5 w-5 shrink-0",
                primaryAction.pressed
                  ? "fill-current text-[color:var(--clinical-accent)]"
                  : "text-[color:var(--text-muted)]",
              )}
              aria-hidden
            />
            <span className={primaryActionIconOnly ? "sr-only" : "max-sm:sr-only"}>{primaryAction.label}</span>
          </button>
        ) : null}
        {actions ? (
          <button
            type="button"
            ref={actionsTriggerRef}
            onClick={() => setActionsOpen(true)}
            aria-label={`Open ${actionsNoun} actions`}
            aria-haspopup="dialog"
            aria-expanded={actionsOpen}
            title={`${actionsNoun.charAt(0).toUpperCase()}${actionsNoun.slice(1)} actions`}
            data-testid={`${testIdPrefix}-actions-trigger`}
            className={cn(
              "grid h-tap w-tap shrink-0 place-items-center text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text-heading)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus)]",
              primaryAction && "border-l border-[color:var(--border)]",
            )}
          >
            <Ellipsis className="h-5 w-5" strokeWidth={2.25} aria-hidden />
          </button>
        ) : null}
      </span>
    ) : null;

  return (
    <>
      {back ? <WorkPageBack href={back.href} label={back.label.toLowerCase()} testId={`${testIdPrefix}-back`} /> : null}
      <HeaderHost>
        <div
          ref={pinRail ? setPinnedHeader : undefined}
          data-testid={`${testIdPrefix}-detail-header`}
          data-print-hide
          data-inpage-sticky-header=""
          className={cn(
            // `inpage-nav-header` owns the phone gutter (`--header-edge-pad` +
            // safe-area). The collapse addon is a sibling of `.edge-glass-header`,
            // so this bar cannot inherit that inset — a literal `px-3` sat 4px
            // closer to the bezel than the hamburger / chat+ chrome above it.
            "inpage-nav-header relative z-20 border-b border-[color:var(--border)] bg-[color:var(--surface)] sm:px-6 lg:px-8",
            !inFlow && "sm:sticky sm:top-0",
            // With no row, the top padding is padding above a hairline, which
            // read as a divider floating loose under the chrome above. The bar
            // hangs off its own rule instead. From `sm` the bar is a bordered
            // card rather than a rule, so it keeps the breathing room.
            rowHasContent ? "py-2" : "pb-2 sm:pt-2",
            className,
          )}
        >
          {/* `flex-wrap` exists for the mode control alone: it is the only child
              that can claim a full row, and it does so only below `sm`. The
              title is `min-w-0 flex-1`, so every other child shrinks rather than
              wrapping. */}
          {rowHasContent ? (
            <div
              className={cn(containerClassName ?? pageContainer, "flex min-h-12 min-w-0 flex-wrap items-center gap-2")}
            >
              {rail && !titleHidden ? (
                // With a rail, every section is already named in the row below, so
                // from `sm` — where the whole rail fits — the disclosure would open
                // a list of the same destinations. The title goes back to being a
                // title. `sm:hidden` on the button rather than a second render of
                // the whole header keeps one DOM node per concern.
                <TitleTag className="hidden min-w-0 flex-1 truncate text-sm font-semibold text-[color:var(--text-heading)] sm:block sm:text-base">
                  {title}
                </TitleTag>
              ) : null}
              {titleHidden ? null : documentSections.length > 0 ? (
                // The title is the section-list disclosure. Line two names where
                // you are, which the track can place but never label.
                <button
                  type="button"
                  ref={sectionTitleTriggerRef}
                  onClick={(event) => openSectionSheet(event.currentTarget)}
                  aria-expanded={sectionSheetOpen}
                  aria-haspopup="dialog"
                  data-testid={`${testIdPrefix}-section-trigger`}
                  className={cn(
                    "focus-ring-tab flex min-h-tap min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1 text-left transition hover:bg-[color:var(--surface-subtle)]",
                    rail && "sm:hidden",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <TitleTag className="block truncate text-sm font-semibold leading-tight text-[color:var(--text-heading)] sm:text-base">
                      {title}
                    </TitleTag>
                    {activeSection && ActiveIcon ? (
                      <span className="mt-0.5 flex items-center gap-1.5 text-3xs font-bold text-[color:var(--clinical-accent)]">
                        <ActiveIcon className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="min-w-0 truncate">{activeSection.label}</span>
                      </span>
                    ) : null}
                  </span>
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 text-[color:var(--text-muted)] transition motion-reduce:transition-none",
                      sectionSheetOpen && "rotate-180",
                    )}
                  />
                </button>
              ) : (
                <TitleTag className="min-w-0 flex-1 truncate text-sm font-semibold text-[color:var(--text-heading)] sm:text-base">
                  {title}
                </TitleTag>
              )}
              {railStuck ? null : actionGroup}
              {mode ? (
                // Inline from `sm` only. Below that it renders inside the actions
                // sheet instead — see the `mode` prop docs. `order-1` pulls it
                // back beside the title on desktop.
                <SegmentedControl
                  label={mode.label}
                  value={mode.value}
                  options={mode.options}
                  onChange={mode.onChange}
                  // `fit`, not `equal`. `equal` gives each segment a `min-w-8rem`
                  // floor sized for a full-width group, but `sm:w-auto` makes the
                  // group shrink-to-fit and its intrinsic width is computed from
                  // the labels — 171px measured against 268px of segments, which
                  // overflowed under the primary action at 700–834px. `fit` sizes
                  // the segments to their labels, and the phone band gets its even
                  // split from the child override instead of from the floor.
                  layout="fit"
                  className="hidden sm:order-1 sm:flex sm:w-auto sm:shrink-0 sm:flex-nowrap"
                />
              ) : null}
            </div>
          ) : null}
          {rail ? (
            <div ref={railRef} className={cn(railStuck && "flex min-w-0 items-end gap-2")}>
              <div className={cn(railStuck && "min-w-0 flex-1")}>
                <InPageSectionRail
                  sections={sections}
                  activeId={activeSection?.id ?? null}
                  onSelect={(id) => onSelectSection?.(id)}
                  onOpenSectionSheet={openSectionSheet}
                  sectionSheetOpen={sectionSheetOpen}
                  label={rail.label}
                  density={rail.density}
                  countedLabels={rail.countedLabels}
                  modeIdentity={rail.modeIdentity}
                  flush={!rowHasContent}
                  testIdPrefix={testIdPrefix}
                />
              </div>
              {railStuck ? actionGroup : null}
            </div>
          ) : documentSections.length > 0 ? (
            <DocumentSectionTrack sections={documentSections} activeId={activeSection?.id ?? null} />
          ) : null}
        </div>
      </HeaderHost>
      {/* Both sheets are siblings of the portal, never children of it: a sheet
          inside the collapse row would be carried away with the header when the
          shared chrome scroll-hides. */}
      {documentSections.length > 0 ? (
        <Sheet
          open={sectionSheetOpen}
          onClose={() => setSectionSheetOpen(false)}
          title={sectionSheetTitle ?? title}
          headerLeading={
            rail ? (
              // A return, at the leading edge, only where the sheet is an
              // OVERFLOW of a visible bar. Reached from More, this list is the
              // tail of a row the reader can still see the head of, and the
              // owner's word for what they wanted back was "return": a way out
              // that reads as going back to the page rather than as dismissing
              // a dialog. The trailing X still closes; this one is named for
              // where it lands you, which is the difference.
              //
              // Not rendered for the title-disclosure shape, where the sheet IS
              // the navigation and a second dismissal would be furniture.
              <button
                type="button"
                onClick={() => setSectionSheetOpen(false)}
                aria-label={`Back to ${title}`}
                data-testid={`${testIdPrefix}-section-sheet-back`}
                className="focus-ring-tab grid h-tap w-tap place-items-center rounded-full text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text-heading)]"
              >
                <ArrowLeft className="h-5 w-5" aria-hidden />
              </button>
            ) : undefined
          }
          description={
            activeSection
              ? `${activeSection.label} · ${Math.max(activeIndex + 1, 1)} of ${documentSections.length}`
              : undefined
          }
          closeLabel="Close section list"
          returnFocusRef={sectionSheetOpenerRef}
          resolveReturnFocusTarget={resolveSectionSheetReturnFocus}
          testId={`${testIdPrefix}-section-sheet`}
        >
          <DocumentSectionList
            sections={documentSections}
            activeId={activeSection?.id ?? null}
            onSelect={(id) => {
              // Present only when `sections` was provided (discriminated props).
              onSelectSection?.(id);
              setSectionSheetOpen(false);
            }}
          />
        </Sheet>
      ) : null}
      {actions ? (
        <Sheet
          open={actionsOpen}
          onClose={() => setActionsOpen(false)}
          title={actionsTitle ?? `This ${actionsNoun}`}
          description={actionsDescription}
          closeLabel={`Close ${actionsNoun} actions`}
          returnFocusRef={actionsTriggerRef}
          testId={`${testIdPrefix}-actions-sheet`}
        >
          {mode ? (
            // The phone home for the view mode. `sm:hidden` rather than a
            // conditional render so there is exactly one `SegmentedControl` per
            // breakpoint and no state to keep in step — the inline copy above is
            // `hidden` below `sm`, this one from `sm`. Full-width here because a
            // sheet row has the space the header row does not.
            <div className="mb-4 sm:hidden" data-testid={`${testIdPrefix}-sheet-mode`}>
              <p className="mb-2 text-3xs font-black uppercase tracking-kicker text-[color:var(--text-muted)]">
                {mode.label}
              </p>
              <SegmentedControl
                label={mode.label}
                value={mode.value}
                options={mode.options}
                onChange={mode.onChange}
                layout="equal"
                className="w-full [&>button]:flex-1"
              />
            </div>
          ) : null}
          {typeof actions === "function" ? actions(() => setActionsOpen(false)) : actions}
        </Sheet>
      ) : null}
    </>
  );
}

/** Keeps a pinned-rail header in the page, where its rail can stick under the top bar. */
function InFlowHeader({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
