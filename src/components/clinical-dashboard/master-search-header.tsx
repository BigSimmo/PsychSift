"use client";

import dynamic from "next/dynamic";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal, flushSync } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import {
  Check,
  ChevronDown,
  Loader2,
  Layers3,
  Menu,
  MessageSquarePlus,
  Briefcase,
  Search,
  Send,
  Stethoscope,
  X,
  ArrowLeft,
  LayoutGrid,
  type LucideIcon,
} from "lucide-react";

import { PatientDetailAlert, PrivacyInputNotice } from "@/components/privacy-input-notice";
import {
  splitFilterText,
  labelScopeFilterFields,
  type TextScopeFilterKey,
} from "@/components/clinical-dashboard/master-search-scope-helpers";
import { restoreFocusUnlessMoved, useDismissableLayer } from "@/components/use-dismissable-layer";
import { usePortalSlotFocus } from "@/components/clinical-dashboard/use-portal-slot-focus";
import { useHideOnScroll } from "@/components/clinical-dashboard/use-hide-on-scroll";
import { useEventCallback } from "@/components/clinical-dashboard/use-event-callback";
import { useLastAppMode } from "@/components/clinical-dashboard/use-last-app-mode";
import { useComposerPatientCheck } from "@/components/clinical-dashboard/use-composer-patient-check";
import { PhoneFooterLayerPortal } from "@/components/clinical-dashboard/phone-footer-layer-portal";
import { AnswerFollowUpSuggestions } from "@/components/clinical-dashboard/answer-follow-up-suggestions";
import { useIdlePreload } from "@/components/clinical-dashboard/idle-preload";
import {
  ModeActionPopup,
  modeActionItemsFor,
  type ModeActionId,
  type ModeActionModeOption,
  type ModeActionPlacement,
  type ModeActionSetId,
} from "@/components/clinical-dashboard/mode-action-popup";
import { executeMasterSearchHeaderModeAction } from "@/components/clinical-dashboard/master-search-header-actions";
import {
  cn,
  chatComposerInput,
  chatComposerShellBase,
  chatSendButton,
  glassOverlaySurface,
  eyebrowText,
} from "@/components/ui-primitives";
import { UniversalSearchCommandSurface } from "@/components/clinical-dashboard/universal-search-command-surface";
import { Sheet } from "@/components/ui/sheet";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useHeaderModePill } from "@/components/clinical-dashboard/master-search-header-mode-pill";
import { useScopeDocumentList } from "@/components/clinical-dashboard/master-search-header-scope-documents";
import { TWO_PANE_SIDE_MENU } from "@/lib/work-frame/side-menu-choice";
import { LargeTextFlag } from "@/components/work-frame/use-large-text";
import { modePickerHint } from "@/lib/mode-picker-hints";
import {
  modePickerCardClass,
  modePickerCardRowClass,
  ModePickerCurrentMode,
  modePickerGlassClass,
  ModePickerKeyHints,
  ModePickerRowContent,
  modePickerRowClass,
  ModePickerSheetBand,
  ModePickerSideToggle,
} from "@/components/mode-picker/mode-picker-row";
import {
  appModeDefinition,
  appModeDefinitions,
  appModeHasWorkSearch,
  appModeSelectionHref,
  appModeSearchConfig,
  factsheetsTopicsHref,
  isSearchableAppMode,
  visibleAppModeDefinitionsForSession,
  type AppModeId,
} from "@/lib/app-modes";
import { appModeIcons } from "@/lib/app-mode-icons";
import {
  isDesktopComposerSlotReady,
  observeDesktopComposerSlots,
  phoneHeaderCollapseAddonSlotId,
  setModeHomeComposerReservePending,
  syncHydratedComposerReserve,
  universalHeaderTrailingSlotId,
} from "@/lib/mode-home-composer";
import { modeSectionIcon } from "@/components/mode-nav/mode-nav-icons";
import {
  modePagesCheckClass,
  modePagesGroupHeadingClass,
  modePagesGroupHintClass,
  modePagesIconClass,
  modePagesIconStroke,
  modePagesLabelClass,
  modePagesRowClass,
  modePagesSheetTitleClass,
  modePagesTileClass,
} from "@/components/clinical-dashboard/mode-pages-sheet-classes";
import {
  groupModeSecondaryNavigationEntries,
  modeSecondaryNavigationEntries,
  visibleModeSecondaryNavigationEntries,
} from "@/lib/mode-secondary-navigation";
import { readOnCallEditorFlag, subscribeOnCallEditorFlag } from "@/lib/on-call/device-state-keys";
import {
  modePageVisible,
  useOpenShiftsIsPoster,
  useRosterHasEnabledTeam,
  useTeachingRoles,
} from "@/lib/teaching/page-visibility";
import {
  clinicalBandAttribute,
  modeMenuRowFor,
  modeMenuSideForMode,
  modeMenuSides,
  orderModesForSide,
  phoneModeGroupsForSide,
  type ModeMenuSideId,
} from "@/lib/phone-mode-groups";
import { resolveScrollBehavior } from "@/lib/scroll-behavior";
import type { CommandSurfacePlacement } from "@/lib/search-command-surface";
import { useCommandDropdownDisplayableByPlacement } from "@/components/clinical-dashboard/use-command-dropdown-displayable";
import type { ClinicalQueryMode } from "@/lib/types";
import { standaloneModeHomeHref } from "@/lib/search-route-ownership";
import { confirmShellNavigation } from "@/lib/navigation-guards";

// Lazy chunks; the clinical bell loads the bell alone, never AI Search.
const StaffWorkHeaderControls = dynamic(() =>
  import("@/components/needs-you/staff-work-header-controls").then((m) => m.StaffWorkHeaderControls),
);
const ClinicalHeaderBell = dynamic(() =>
  import("@/components/needs-you/needs-you-button").then((m) => m.NeedsYouButton),
);

export * from "./master-search-header-types";
import {
  composerPrivacyWarningId,
  phoneSearchLayoutMediaQuery,
  scopeSheetMediaQuery,
  desktopPageComposerMediaQuery,
  modeHomeComposerMediaQuery,
  modeHomeComposerSmUpMediaQuery,
  type MasterSearchHeaderProps,
  DEFAULT_DOCUMENTS,
  DEFAULT_SELECTED_DOCUMENT_IDS,
  DEFAULT_QUERY_MODE_OPTIONS,
  DEFAULT_RECENT_QUERIES,
  DEFAULT_SCOPE_FILTERS,
  NOOP_HANDLER,
} from "./master-search-header-types";

// The pins menu is the action popup's body and only mounts once the popup opens, so it
// stays off `/`'s load/hydration path and is warmed on idle before a first open.
const loadSearchPinsMenu = () =>
  import("@/components/clinical-dashboard/search-pins-menu").then((m) => m.SearchPinsMenu);
const SearchPinsMenu = dynamic(loadSearchPinsMenu, { ssr: false });
// The scope picker draws nothing until a scope popover/sheet opens. It mounts on first open
// (and then stays mounted so close animations are unchanged), warmed on idle beforehand.
const loadScopePicker = () =>
  import("@/components/clinical-dashboard/master-search-header-scope-picker").then(
    (m) => m.MasterSearchHeaderScopePicker,
  );
const MasterSearchHeaderScopePicker = dynamic(loadScopePicker, { ssr: false });

export function MasterSearchHeader(props: MasterSearchHeaderProps) {
  const { searchState, headerActions, mobileControls } = props;

  const demoMode = searchState?.demoMode ?? props.demoMode ?? false;
  const documents = searchState?.documents ?? props.documents ?? DEFAULT_DOCUMENTS;
  const documentTotal = searchState?.documentTotal ?? props.documentTotal;
  const query = searchState?.query ?? props.query ?? "";
  const searchMode = searchState?.searchMode ?? props.searchMode ?? "answer";
  const loading = searchState?.loading ?? props.loading ?? false;
  const selectedDocumentIds =
    searchState?.selectedDocumentIds ?? props.selectedDocumentIds ?? DEFAULT_SELECTED_DOCUMENT_IDS;
  const queryMode = searchState?.queryMode ?? props.queryMode ?? "guidance";
  const scopeFilters = searchState?.scopeFilters ?? props.scopeFilters ?? DEFAULT_SCOPE_FILTERS;
  const realDataReady = searchState?.realDataReady ?? props.realDataReady ?? false;
  const queryModeOptions = searchState?.queryModeOptions ?? props.queryModeOptions ?? DEFAULT_QUERY_MODE_OPTIONS;
  const queryInputRef = searchState?.queryInputRef ?? props.queryInputRef;
  const queryInputAutoFocus = searchState?.queryInputAutoFocus ?? props.queryInputAutoFocus ?? false;
  const composerPlaceholder = searchState?.composerPlaceholder ?? props.composerPlaceholder;
  const recentQueries = searchState?.recentQueries ?? props.recentQueries ?? DEFAULT_RECENT_QUERIES;
  const composerFollowUpSuggestions = searchState?.composerFollowUpSuggestions ?? props.composerFollowUpSuggestions;
  const composerFollowUpSuggestionsDisabled =
    searchState?.composerFollowUpSuggestionsDisabled ?? props.composerFollowUpSuggestionsDisabled ?? false;
  let canAccessFavourites = false;
  canAccessFavourites = searchState?.canAccessFavourites ?? props.canAccessFavourites ?? canAccessFavourites;

  const onQueryChange = headerActions?.onQueryChange ?? props.onQueryChange ?? NOOP_HANDLER;
  const onSearchModeChange = headerActions?.onSearchModeChange ?? props.onSearchModeChange ?? NOOP_HANDLER;
  const onAsk = headerActions?.onAsk ?? props.onAsk ?? NOOP_HANDLER;
  const onClearQuery = headerActions?.onClearQuery ?? props.onClearQuery ?? NOOP_HANDLER;
  const onClearScope = headerActions?.onClearScope ?? props.onClearScope ?? NOOP_HANDLER;
  const onQueryModeChange = headerActions?.onQueryModeChange ?? props.onQueryModeChange ?? NOOP_HANDLER;
  const onScopeFiltersChange = headerActions?.onScopeFiltersChange ?? props.onScopeFiltersChange ?? NOOP_HANDLER;
  const onToggleScope = headerActions?.onToggleScope ?? props.onToggleScope ?? NOOP_HANDLER;
  const onScopeOpenChange = headerActions?.onScopeOpenChange ?? props.onScopeOpenChange;
  const onOpenEvidence = headerActions?.onOpenEvidence ?? props.onOpenEvidence;
  const onOpenRecentDocuments = headerActions?.onOpenRecentDocuments ?? props.onOpenRecentDocuments;
  const onOpenLibrary = headerActions?.onOpenLibrary ?? props.onOpenLibrary;
  const onOpenDocumentAdmin = headerActions?.onOpenDocumentAdmin ?? props.onOpenDocumentAdmin;
  const canManageDocuments =
    headerActions?.canManageDocuments ?? searchState?.canManageDocuments ?? props.canManageDocuments ?? false;
  const onOpenSourcePdf = headerActions?.onOpenSourcePdf ?? props.onOpenSourcePdf;
  const onNewChat = headerActions?.onNewChat ?? props.onNewChat;
  const onOpenMobileSidebar = headerActions?.onOpenMobileSidebar ?? props.onOpenMobileSidebar;
  const onPickRecent = headerActions?.onPickRecent ?? props.onPickRecent;
  const onCrossModeSearch = headerActions?.onCrossModeSearch ?? props.onCrossModeSearch;
  const onPickComposerFollowUpSuggestion =
    headerActions?.onPickComposerFollowUpSuggestion ?? props.onPickComposerFollowUpSuggestion;
  const onRequestAccountSetup = headerActions?.onRequestAccountSetup ?? props.onRequestAccountSetup;
  const onBottomComposerHiddenChange =
    headerActions?.onBottomComposerHiddenChange ??
    mobileControls?.onBottomComposerHiddenChange ??
    props.onBottomComposerHiddenChange;

  const mobileSearchPlacement = mobileControls?.mobileSearchPlacement ?? props.mobileSearchPlacement ?? "default";
  const mobileBottomSearchVariant =
    mobileControls?.mobileBottomSearchVariant ?? props.mobileBottomSearchVariant ?? "default";
  const mobileHomeComposerPlacement =
    mobileControls?.mobileHomeComposerPlacement ?? props.mobileHomeComposerPlacement ?? "hero";
  const showPhoneSuggestionTickerOnHome =
    mobileControls?.showPhoneSuggestionTickerOnHome ?? props.showPhoneSuggestionTickerOnHome ?? false;
  const desktopSearchPlacement = mobileControls?.desktopSearchPlacement ?? props.desktopSearchPlacement ?? "default";
  const searchComposerVisible = mobileControls?.searchComposerVisible ?? props.searchComposerVisible ?? true;
  const desktopHomeComposerSlotId = mobileControls?.desktopHomeComposerSlotId ?? props.desktopHomeComposerSlotId;
  const desktopPageComposerSlotId = mobileControls?.desktopPageComposerSlotId ?? props.desktopPageComposerSlotId;
  const heroComposerBreakpoint = mobileControls?.heroComposerBreakpoint ?? props.heroComposerBreakpoint ?? "all";
  const mobileBottomSearchAddonSlotId =
    mobileControls?.mobileBottomSearchAddonSlotId ?? props.mobileBottomSearchAddonSlotId;
  const mobileBottomSearchAddonKind = mobileControls?.mobileBottomSearchAddonKind ?? props.mobileBottomSearchAddonKind;
  const hideOnScroll = mobileControls?.hideOnScroll ?? props.hideOnScroll;
  const showDesktopNewChat = mobileControls?.showDesktopNewChat ?? props.showDesktopNewChat ?? true;
  // Hosts pass the precomputed session decision in canAccessFavourites (auth || demo).
  // Do not OR demoMode again here — that would reopen Favourites when props diverge.
  const router = useRouter();
  useIdlePreload(loadSearchPinsMenu);
  useIdlePreload(loadScopePicker);
  // Direct pushes skip link guards and beforeunload: ask any page with unsaved work first.
  const pushIfLeaveConfirmed = (href: string) => confirmShellNavigation() && router.push(href);
  const currentPathname = usePathname();
  const [, setLastAppMode] = useLastAppMode();
  // The two-pane side menu (off again since 10 Oct 2026) keeps the menu button
  // beside Back on phones, so the menu opens from every work page.
  const twoPaneSideMenu = TWO_PANE_SIDE_MENU;
  const visibleAppModeOptions = visibleAppModeDefinitionsForSession({
    authenticated: canAccessFavourites,
    demoMode: false,
  });
  const trimmedQuery = query.trim();
  const { clinicalPatientDetail, hasPhiWarning, phiWarningText } = useComposerPatientCheck(query, searchMode);
  const composerPhiWarningId = "composer-phi-warning";
  const selectedSearch = appModeSearchConfig(searchMode);
  // The trigger names the route the user is viewing. Session filtering still
  // keeps gated modes out of the selectable menu below.
  const selectedAppMode = appModeDefinition(searchMode);
  const selectedSearchable = isSearchableAppMode(searchMode);
  const isAnswerFooterComposer = searchMode === "answer";
  const isMobileBottomComposer = searchComposerVisible && mobileSearchPlacement === "bottom" && !isAnswerFooterComposer;
  const isHeroDesktopComposer = desktopSearchPlacement === "hero" && isMobileBottomComposer;
  // Documents search is API-backed (`requestSourceLibrarySearch`) and
  // `ClinicalDashboard.executeSearch` rejects it when `!canRunSearch`. Only
  // catalogue / namespaced modes whose submit path never hits that gate stay
  // enabled while live data is not ready.
  const canRunLocalSearch =
    selectedSearch.kind === "forms" ||
    selectedSearch.kind === "services" ||
    selectedSearch.kind === "therapies" ||
    selectedSearch.kind === "tools" ||
    selectedSearch.kind === "calculators" ||
    selectedSearch.kind === "favourites" ||
    selectedSearch.kind === "specifiers" ||
    selectedSearch.kind === "formulation" ||
    selectedSearch.kind === "dsm";
  const searchSetupNotReady = !realDataReady && !canRunLocalSearch;
  const canAsk =
    trimmedQuery.length >= 1 && !loading && selectedSearchable && !searchSetupNotReady && !clinicalPatientDetail;
  const indexedDocumentTotal = documentTotal ?? documents.length;
  const hasUnloadedDocuments = indexedDocumentTotal > documents.length;
  const loadedScopeSummary = hasUnloadedDocuments
    ? `${documents.length.toLocaleString()} loaded of ${indexedDocumentTotal.toLocaleString()}`
    : `${documents.length.toLocaleString()} available`;
  const [scopeFilter, setScopeFilter] = useState("");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeSheetOpen, setScopeSheetOpen] = useState(false);
  const [scopePickerMounted, setScopePickerMounted] = useState(false);
  if (!scopePickerMounted && (scopeOpen || scopeSheetOpen)) setScopePickerMounted(true);
  const [scopeSheetFullscreen, setScopeSheetFullscreen] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [actionMenuPlacement, setActionMenuPlacement] = useState<ModeActionPlacement>("up");
  const [commandDropdownOpen, setCommandDropdownOpen] = useState(false);
  const [commandListboxId, setCommandListboxId] = useState<string>();
  const [commandActiveItemId, setCommandActiveItemId] = useState<string | null>(null);
  const commandDropdownDisplayableByPlacement = useCommandDropdownDisplayableByPlacement();
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  // Which room the open menu is showing. Opening the pill sets this from the
  // mode you are already in; the switch changes only the list.
  const [modeMenuSide, setModeMenuSide] = useState<ModeMenuSideId>("clinical");
  // Which menuitemradio should receive initial focus when the mode menu opens
  // (keyboard ArrowOpen or the active mode on tap). Shared by the desktop
  // popover and the phone bottom sheet.
  const [modeMenuFocusIndex, setModeMenuFocusIndex] = useState(0);
  const [usesScopeSheet, setUsesScopeSheet] = useState(false);
  // SSR and the first client hydration paint must agree (phone matchMedia is
  // unavailable on the server). Sync from matchMedia after mount; Mode open
  // paths also refresh from the live query so the first tap still picks Sheet.
  const [usesPhoneSearchLayout, setUsesPhoneSearchLayout] = useState(false);
  const sideModeMenuOptions = orderModesForSide(visibleAppModeOptions, modeMenuSide);
  const activeModeMenuOptions = sideModeMenuOptions;
  const [desktopComposerPortalActive, setDesktopComposerPortalActive] = useState(false);
  const [desktopComposerPortalFallback, setDesktopComposerPortalFallback] = useState(false);
  // SSR and first paint assume a declared home slot is media-eligible so the
  // header composer stays suppressed while ModeHomeTemplate reserves hero
  // geometry. The portal effect clears this when the home media query does not
  // match (e.g. future `sm-up` hero + phone dock), so we never blank search
  // for the 8s fallback window on a viewport that never hosts the hero slot.
  const [homeComposerMediaEligible, setHomeComposerMediaEligible] = useState(() => Boolean(desktopHomeComposerSlotId));
  // Phone-only hide-on-scroll: never hide while a header-owned surface is open
  // or while focus sits inside the header chrome (keyboard users must not tab
  // into invisible controls).
  const [headerChromeFocused, setHeaderChromeFocused] = useState(false);
  const [composerChromeFocused, setComposerChromeFocused] = useState(false);
  const [phoneHeaderCollapseAddonHost, setPhoneHeaderCollapseAddonHost] = useState<HTMLDivElement | null>(null);
  const setPhoneHeaderCollapseAddonRef = useCallback((node: HTMLDivElement | null) => {
    setPhoneHeaderCollapseAddonHost(node);
  }, []);
  const internalScrollHidden = useHideOnScroll({
    disabled: !hideOnScroll || hideOnScroll.scrollHidden !== undefined,
  });
  const scrollHidden = hideOnScroll?.scrollHidden !== undefined ? hideOnScroll.scrollHidden : internalScrollHidden;
  const headerCollapseOwnsPhoneAddonFocus = hideOnScroll?.strategy === "collapse";
  // Mode homes portal the composer into the hero slot. With "all" the hero owns
  // every width (the answer home keeps its in-flow pill on phones); "sm-up"
  // hero hosts hand phones the bottom dock instead.
  const heroComposerOwnsPhones = Boolean(desktopHomeComposerSlotId) && heroComposerBreakpoint === "all";
  const phoneBottomSearchDockActive =
    usesPhoneSearchLayout &&
    searchComposerVisible &&
    !heroComposerOwnsPhones &&
    (isAnswerFooterComposer || mobileSearchPlacement === "bottom");
  const hideOnScrollEnabled = Boolean(hideOnScroll);
  // Focus-capture pins can survive dock teardown when React skips blur (portal
  // swap, hero reclaim, breakpoint change). Ignore latched focus unless that
  // surface is still the active hide/reveal owner, then clear the latch async
  // (repo pattern — avoids react-hooks/set-state-in-effect).
  const composerFocusPinsChrome = composerChromeFocused && phoneBottomSearchDockActive && hideOnScrollEnabled;
  const headerFocusPinsChrome = headerChromeFocused && hideOnScrollEnabled;
  // Header and composer share one scroll signal, so any active surface or
  // focus inside either edge pins both edges. This preserves keyboard focus
  // safety without letting the unfocused header disappear above a still-
  // focused composer (or vice versa).
  const sharedChromePinned =
    modeMenuOpen ||
    actionMenuOpen ||
    commandDropdownOpen ||
    scopeOpen ||
    scopeSheetOpen ||
    headerFocusPinsChrome ||
    composerFocusPinsChrome;
  const headerChromeHidden = scrollHidden && !sharedChromePinned;
  // Compare addon chrome lives inside the phone dock; hide/reveal with it so
  // the search pill and Compare selected bar reclaim space together.
  const bottomComposerScrollHiddenActive = Boolean(hideOnScroll && phoneBottomSearchDockActive);
  const bottomComposerHidden = bottomComposerScrollHiddenActive && scrollHidden && !sharedChromePinned;

  useEffect(() => {
    if (phoneBottomSearchDockActive && hideOnScrollEnabled) return;
    queueMicrotask(() => {
      if (!phoneBottomSearchDockActive || !hideOnScrollEnabled) setComposerChromeFocused(false);
      if (!hideOnScrollEnabled) setHeaderChromeFocused(false);
    });
  }, [phoneBottomSearchDockActive, hideOnScrollEnabled]);

  useEffect(() => {
    const addonHost = phoneHeaderCollapseAddonHost;
    const clearHeaderFocus = () => setHeaderChromeFocused(false);
    if (!addonHost || !hideOnScrollEnabled || !headerCollapseOwnsPhoneAddonFocus) {
      queueMicrotask(clearHeaderFocus);
      return undefined;
    }

    // React portal focus events follow the source React tree, not the portal
    // host's synthetic-event ancestry. Listen at the real DOM host so focused
    // page-owned controls pin the same collapse track as the universal bar.
    const hostContainsActiveElement = () => {
      const activeElement = document.activeElement;
      return activeElement instanceof Node && addonHost.contains(activeElement);
    };
    const clearIfFocusLeftHost = () => {
      if (!hostContainsActiveElement()) setHeaderChromeFocused(false);
    };
    const handleFocusIn = () => setHeaderChromeFocused(true);
    const handleFocusOut = (event: FocusEvent) => {
      const nextTarget = event.relatedTarget;
      if (!(nextTarget instanceof Node) || !addonHost.contains(nextTarget)) {
        setHeaderChromeFocused(false);
      }
    };
    queueMicrotask(() => setHeaderChromeFocused(hostContainsActiveElement()));
    const observer = new MutationObserver(clearIfFocusLeftHost);
    observer.observe(addonHost, { childList: true, subtree: true });

    addonHost.addEventListener("focusin", handleFocusIn);
    addonHost.addEventListener("focusout", handleFocusOut);
    return () => {
      addonHost.removeEventListener("focusin", handleFocusIn);
      addonHost.removeEventListener("focusout", handleFocusOut);
      observer.disconnect();
      queueMicrotask(clearHeaderFocus);
    };
  }, [headerCollapseOwnsPhoneAddonFocus, hideOnScrollEnabled, phoneHeaderCollapseAddonHost]);

  const leadingSlotRef = useRef<HTMLDivElement>(null);
  usePortalSlotFocus(leadingSlotRef, Boolean(hideOnScroll), setHeaderChromeFocused);

  useEffect(() => {
    onBottomComposerHiddenChange?.(bottomComposerHidden);
  }, [bottomComposerHidden, onBottomComposerHiddenChange]);

  useEffect(() => {
    if (!loading || !commandDropdownOpen) return undefined;
    const frame = window.requestAnimationFrame(() => setCommandDropdownOpen(false));
    return () => window.cancelAnimationFrame(frame);
  }, [commandDropdownOpen, loading]);

  // Stable, header-owned element the composer is portaled into; we move it in and
  // out of the page-owned slot rather than portaling into the slot directly.
  const [desktopComposerPortalHost, setDesktopComposerPortalHost] = useState<HTMLDivElement | null>(null);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);
  const phoneModeMenuListRef = useRef<HTMLDivElement | null>(null);
  const modeButtonRef = useRef<HTMLButtonElement | null>(null);
  const modeMenuFocusRafRef = useRef<number | null>(null);
  const modeOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /**
   * Which level of the mode sheet is showing.
   *
   * The pill opens the mode list everywhere except in a mode that owns its own
   * pages and has no other place to list them. On Call is that mode: it has no
   * search surface, so the pill is the control a reader reaches for, and landing
   * on seventeen app modes when you wanted the Playbook is the wrong first
   * screen. The mode list is one tap away from here, never removed.
   *
   * Kept deliberately outside the roving-tabindex machinery below. The section
   * level is a list of ordinary links in ordinary tab order; wiring it through
   * `modeOptionRefs`, `activeModeMenuOptions` and the arrow-key handlers would
   * put a second row kind into focus code every one of the seventeen modes
   * shares, to no benefit — a link list needs no roving tabindex.
   */
  const [modeSheetView, setModeSheetView] = useState<"modes" | "sections">("modes");

  /**
   * This mode's own pages, when the pill should open them first.
   *
   * Gated on the mode declaring NO results surface, not on a hand-written mode
   * id: a mode with a search surface already has somewhere its pages are listed
   * and a composer the pill must keep pointing at.
   */
  const teachingRoles = useTeachingRoles();
  const rosterHasTeam = useRosterHasEnabledTeam();
  const openShiftsPoster = useOpenShiftsIsPoster();
  const modeOwnPages = useMemo(
    () =>
      selectedAppMode.search.resultsSurface === "none"
        ? modeSecondaryNavigationEntries(selectedAppMode.id).filter((entry) =>
            modePageVisible(selectedAppMode.id, entry.id, teachingRoles, rosterHasTeam, openShiftsPoster),
          )
        : [],
    [selectedAppMode, teachingRoles, rosterHasTeam, openShiftsPoster],
  );
  /**
   * Whether the pages sheet offers "Manage service": true for an editor, and
   * while the role is still unknown (S3), false only once the hub's own
   * handbook read has seen a non-editor. Read from the device, so the sheet
   * needs no fetch of its own (F24). False on the server.
   */
  const onCallEditor = useSyncExternalStore(subscribeOnCallEditorFlag, readOnCallEditorFlag, () => false);
  /** What the mode pill names (the page, the mode or a work area) and this address's work frame. */
  const {
    activeModePage,
    pillPageLine,
    pillShowsAreaOnly,
    pillModeLabel,
    routeWorkArea,
    routeWorkFrame,
    routeWorkFramed,
  } = useHeaderModePill({
    modeId: selectedAppMode.id,
    modeLabel: selectedAppMode.label,
    pathname: currentPathname ?? "",
    modeOwnPages,
  });
  /** A mode that shows no results has nowhere for a new conversation to land. */
  const modeHasConversation = selectedAppMode.search.resultsSurface !== "none";
  const pendingModeSelectionFocusRef = useRef<AppModeId | null>(null);
  const prefetchedModeHrefsRef = useRef(new Set<string>());
  const scopePopoverRef = useRef<HTMLDivElement | null>(null);
  const actionMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const actionMenuSheetReturnFocusRef = useRef<HTMLElement | null>(null);
  const scopeFilterInputRef = useRef<HTMLInputElement | null>(null);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    const pendingMode = pendingModeSelectionFocusRef.current;
    if (modeMenuOpen || pendingMode === null || pendingMode !== searchMode) return undefined;

    let settledFrame: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      settledFrame = window.requestAnimationFrame(() => {
        if (pendingModeSelectionFocusRef.current !== searchMode) return;
        // Phone Sheet may still mount #app-mode-menu during exit animation.
        // Leave pending armed so a later searchMode tick (or same-mode retry)
        // can finish restore instead of giving up on a no-op.
        if (document.getElementById("app-mode-menu")) return;
        restoreFocusUnlessMoved(modeButtonRef.current);
        pendingModeSelectionFocusRef.current = null;
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (settledFrame !== null) window.cancelAnimationFrame(settledFrame);
    };
  }, [modeMenuOpen, searchMode]);
  const {
    scopeSummary,
    scopePreview,
    matchingDocuments,
    requireScopeFilter,
    visibleScopeDocuments,
    hiddenScopeMatchCount,
  } = useScopeDocumentList({ documents, selectedDocumentIds, scopeFilter });
  const activeLabelFilterCount = labelScopeFilterFields.filter((field) => scopeFilters[field.key]?.length).length;
  const activeQuickFilterCount =
    (scopeFilters.sourceStatuses?.length ? 1 : 0) + (scopeFilters.locality ? 1 : 0) + activeLabelFilterCount;
  const submitLabel = trimmedQuery ? selectedSearch.submitBusyLabel : selectedSearch.submitIdleLabel;
  // One task-oriented placeholder per mode (PT-14): the follow-up composer must
  // not swap to brand copy that hides what the input actually does.
  const queryPlaceholder = composerPlaceholder ?? selectedSearch.placeholder;
  const SelectedAppModeIcon = appModeIcons[routeWorkArea?.identity ?? selectedAppMode.id]; // Open shifts wears Roster's badge
  const actionMenuModeOptions: ModeActionModeOption[] = visibleAppModeOptions.map((mode) => ({
    id: mode.id,
    label: mode.label,
    description: mode.id === "answer" ? "Source-backed mode" : mode.description,
    icon: appModeIcons[mode.id],
  }));
  const actionMenuSetId: ModeActionSetId =
    searchMode === "prescribing"
      ? "prescribing"
      : searchMode === "forms"
        ? "forms"
        : searchMode === "services"
          ? "services"
          : searchMode === "documents"
            ? "documents"
            : searchMode === "favourites"
              ? "favourites"
              : searchMode === "differentials"
                ? "differentials"
                : searchMode === "dsm"
                  ? "dsm"
                  : searchMode === "specifiers"
                    ? "specifiers"
                    : searchMode === "formulation"
                      ? "formulation"
                      : searchMode === "tools"
                        ? "tools"
                        : searchMode === "calculators"
                          ? "calculators"
                          : searchMode === "factsheets"
                            ? "factsheets"
                            : searchMode === "dictionary"
                              ? "dictionary"
                              : "answer";
  const actionMenuItems = modeActionItemsFor(actionMenuSetId, { canManageDocuments });
  const actionMenuButtonLabel = `Open ${selectedAppMode.label.toLowerCase()} options`;

  function currentUsesScopeSheet() {
    return window.matchMedia(scopeSheetMediaQuery).matches;
  }

  function currentUsesPhoneSearchLayout() {
    return window.matchMedia(phoneSearchLayoutMediaQuery).matches;
  }

  function openScopePicker() {
    setActionMenuOpen(false);
    setModeMenuOpen(false);
    const nextUsesScopeSheet = currentUsesScopeSheet();
    setScopeSheetFullscreen(currentUsesPhoneSearchLayout());
    setUsesScopeSheet(nextUsesScopeSheet);
    if (nextUsesScopeSheet) {
      setScopeSheetOpen(true);
    } else {
      setScopeOpen(true);
      onScopeOpenChange?.(true);
      focusScopeFilterWhenMounted();
    }
  }

  // The picker is a lazily loaded chunk: on a cold open it may still be downloading, so
  // wait for it, then retry for a few frames until its filter input has mounted.
  function focusScopeFilterWhenMounted() {
    void loadScopePicker()
      .catch(() => undefined)
      .then(() => {
        let frames = 0;
        const tryFocus = () => {
          const input = scopeFilterInputRef.current;
          if (input) {
            input.focus();
            return;
          }
          frames += 1;
          if (frames < 30) window.requestAnimationFrame(tryFocus);
        };
        window.requestAnimationFrame(tryFocus);
      });
  }

  function runModeAction(actionId: ModeActionId) {
    executeMasterSearchHeaderModeAction({
      actionId,
      trimmedQuery,
      onQueryModeChange,
      onQueryChange,
      onSearchModeChange,
      openScopePicker,
      onOpenEvidence,
      onOpenRecentDocuments,
      onOpenDocumentAdmin,
      onOpenLibrary,
      onOpenSourcePdf,
      pushIfLeaveConfirmed,
      factsheetsTopicsHref,
      canAccessFavourites: Boolean(canAccessFavourites),
      onRequestAccountSetup,
      onNewChat,
    });
  }

  function selectAppMode(mode: (typeof appModeDefinitions)[number]) {
    const standaloneHref = standaloneModeHomeHref(mode.id as AppModeId);
    if (standaloneHref && !confirmShellNavigation()) return;
    setModeMenuOpen(false);
    if (standaloneHref) {
      // Dedicated modes navigate to their canonical standalone homes
      // instead of retargeting the shared-home composer.
      // Persist the selection here rather than via onSearchModeChange: that
      // callback owns shared-home navigation and would race this canonical push.
      setLastAppMode(mode.id as AppModeId);
      pendingModeSelectionFocusRef.current = mode.id;
      router.push(standaloneHref);
      if (mode.id === searchMode) {
        const restoreSameModeFocus = () => {
          if (pendingModeSelectionFocusRef.current !== mode.id) return;
          if (document.getElementById("app-mode-menu")) {
            window.setTimeout(restoreSameModeFocus, 50);
            return;
          }
          restoreFocusUnlessMoved(modeButtonRef.current);
          pendingModeSelectionFocusRef.current = null;
        };
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(restoreSameModeFocus);
        });
      }
      return;
    }
    if (isSearchableAppMode(mode.id)) {
      // Wait until the URL-owned mode prop settles before returning focus. The
      // trigger's accessible name changes with that prop; focusing in the click
      // frame races the shared-home URL sync and can fall through to <body>.
      //
      // Same-mode reselect is different: shared-home replaceState keeps an
      // identical URL, so searchMode never changes and the pending-focus effect
      // gets only the menu-close tick — which can race phone Sheet teardown.
      if (mode.id === searchMode) {
        pendingModeSelectionFocusRef.current = mode.id;
        onSearchModeChange(mode.id);
        const restoreSameModeFocus = () => {
          if (pendingModeSelectionFocusRef.current !== mode.id) return;
          if (document.getElementById("app-mode-menu")) {
            window.setTimeout(restoreSameModeFocus, 50);
            return;
          }
          restoreFocusUnlessMoved(modeButtonRef.current);
          pendingModeSelectionFocusRef.current = null;
        };
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(restoreSameModeFocus);
        });
        return;
      }
      pendingModeSelectionFocusRef.current = mode.id;
      onSearchModeChange(mode.id);
      return;
    }
    if ("href" in mode && mode.href) pushIfLeaveConfirmed(mode.href);
  }

  function selectAppModeById(modeId: string) {
    const mode = visibleAppModeOptions.find((option) => option.id === modeId);
    if (mode) selectAppMode(mode);
  }

  useEffect(() => {
    if (!modeMenuOpen || !usesPhoneSearchLayout || modeSheetView !== "modes") return undefined;

    let settledFrame: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      settledFrame = window.requestAnimationFrame(() => {
        const menu = phoneModeMenuListRef.current;
        const target = modeOptionRefs.current[modeMenuFocusIndex];
        const scrollBody = menu?.parentElement;
        if (!menu || !target || !scrollBody) return;

        const bodyRect = scrollBody.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        if (targetRect.top >= bodyRect.top && targetRect.bottom <= bodyRect.bottom) return;

        // Keep positioning inside the fixed sheet body. scrollIntoView would
        // also visit document ancestors and can move the page behind the modal.
        const targetCenter = targetRect.top + targetRect.height / 2;
        const bodyCenter = bodyRect.top + bodyRect.height / 2;
        scrollBody.scrollTop += targetCenter - bodyCenter;
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (settledFrame !== null) window.cancelAnimationFrame(settledFrame);
    };
  }, [modeMenuFocusIndex, modeMenuOpen, modeSheetView, usesPhoneSearchLayout]);

  useEffect(
    () => () => {
      if (modeMenuFocusRafRef.current !== null) {
        window.cancelAnimationFrame(modeMenuFocusRafRef.current);
        modeMenuFocusRafRef.current = null;
      }
    },
    [],
  );

  // Both the hero-portal composer and the default composer bind the caller's
  // queryInputRef. During home <-> result transitions the two briefly coexist,
  // and React nulls a plain shared ref when the outgoing composer unmounts —
  // clobbering the surviving input's binding (quote follow-up focus broke).
  // A cleanup-function ref only clears the binding it still owns.
  const bindQueryInputRef = useCallback(
    (element: HTMLInputElement | null) => {
      if (!element || !queryInputRef) return undefined;
      // eslint-disable-next-line react-hooks/immutability
      queryInputRef.current = element;
      return () => {
        if (queryInputRef.current === element) queryInputRef.current = null;
      };
    },
    [queryInputRef],
  );

  function focusModeOption(index: number) {
    if (activeModeMenuOptions.length === 0) return;
    const nextIndex = (index + activeModeMenuOptions.length) % activeModeMenuOptions.length;
    setModeMenuFocusIndex(nextIndex);
    modeOptionRefs.current[nextIndex]?.focus();
  }

  function closeModeSurfaces() {
    setActionMenuOpen(false);
    setCommandDropdownOpen(false);
    closeScope(false);
    setScopeSheetOpen(false);
  }

  // Mode options are buttons (not Links), so Next cannot discover destinations.
  // Prefetch only the mode the user is about to choose — the highlighted option
  // on open, then whichever option receives focus/pointer while scanning.
  //
  // Most picks return to the shared home. Dedicated modes open their
  // canonical standalone directory/home, so warm that route instead.
  function prefetchModeSelection(modeId: AppModeId) {
    if (modeId === searchMode) return;
    const href = standaloneModeHomeHref(modeId) ?? appModeSelectionHref(modeId);
    if (prefetchedModeHrefsRef.current.has(href)) return;
    prefetchedModeHrefsRef.current.add(href);
    router.prefetch(href, {
      // Next's client cache can invalidate a prefetched RSC payload while this
      // long-lived shared header remains mounted. Let the next pointer/focus
      // intent warm it again instead of permanently treating the stale entry as
      // prefetched for the rest of the session.
      onInvalidate: () => {
        prefetchedModeHrefsRef.current.delete(href);
      },
      // Next 16.2.12's public guide documents onInvalidate as the only optional
      // field, while its bundled AppRouterInstance type incorrectly exposes the
      // internal required `kind`. Keep the public API shape without importing a
      // private router enum.
    } as Parameters<typeof router.prefetch>[1]);
  }

  function selectModeMenuSide(side: ModeMenuSideId) {
    setModeMenuSide(side);
    const options = orderModesForSide(visibleAppModeOptions, side);
    const selected = options.findIndex((mode) => mode.id === modeMenuRowFor(selectedAppMode.id));
    setModeMenuFocusIndex(selected >= 0 ? selected : 0);
  }

  function openModeMenuWithFocus(index: number, side: ModeMenuSideId) {
    closeModeSurfaces();
    const options = orderModesForSide(visibleAppModeOptions, side);
    if (options.length === 0) return;
    const nextIndex = (index + options.length) % options.length;
    const highlighted = options[nextIndex];
    if (highlighted) prefetchModeSelection(highlighted.id);
    const phoneLayout = currentUsesPhoneSearchLayout();
    setModeMenuSide(side);
    setUsesPhoneSearchLayout(phoneLayout);
    setModeMenuFocusIndex(nextIndex);
    // Keyboard entry (Arrow Down / Up on the pill) is a request to move through
    // the MODE list, so it opens at that level whatever the mode.
    setModeSheetView("modes");
    setModeMenuOpen(true);
    // Phone sheet owns initial focus via data-sheet-autofocus; desktop still
    // needs an rAF focus into the absolute menu after it mounts.
    //
    // Deliberately not `focusModeOption(nextIndex)` here: that helper
    // re-derives its bounds from `activeModeMenuOptions`, which is still the
    // previous render's list. `nextIndex` is already a valid position in the
    // side this call just chose.
    if (!phoneLayout) {
      if (modeMenuFocusRafRef.current !== null) {
        window.cancelAnimationFrame(modeMenuFocusRafRef.current);
        modeMenuFocusRafRef.current = null;
      }
      modeMenuFocusRafRef.current = window.requestAnimationFrame(() => {
        modeMenuFocusRafRef.current = null;
        setModeMenuFocusIndex(nextIndex);
        modeOptionRefs.current[nextIndex]?.focus();
      });
    }
  }

  const cancelModeMenuFocus = useCallback(() => {
    if (modeMenuFocusRafRef.current !== null) {
      window.cancelAnimationFrame(modeMenuFocusRafRef.current);
      modeMenuFocusRafRef.current = null;
    }
  }, []);

  const closeModeMenu = useCallback(() => {
    cancelModeMenuFocus();
    setModeMenuOpen(false);
  }, [cancelModeMenuFocus]);

  function toggleModeMenu() {
    closeModeSurfaces();
    if (modeMenuOpen) {
      closeModeMenu();
      return;
    }
    const side = modeMenuSideForMode(selectedAppMode.id);
    const openingOptions = orderModesForSide(visibleAppModeOptions, side);
    const openingIndex = Math.max(
      0,
      openingOptions.findIndex((mode) => mode.id === modeMenuRowFor(selectedAppMode.id)),
    );
    const highlighted = openingOptions[openingIndex];
    if (highlighted) prefetchModeSelection(highlighted.id);
    const phoneLayout = currentUsesPhoneSearchLayout();
    setModeMenuSide(side);
    setUsesPhoneSearchLayout(phoneLayout);
    setModeMenuFocusIndex(openingIndex);
    // The pill switches modes directly; page tabs already own section navigation.
    setModeSheetView("modes");
    setModeMenuOpen(true);
    if (!phoneLayout) {
      cancelModeMenuFocus();
      modeMenuFocusRafRef.current = window.requestAnimationFrame(() => {
        modeMenuFocusRafRef.current = null;
        if (!modeMenuRef.current?.contains(document.activeElement)) return;
        setModeMenuFocusIndex(openingIndex);
        modeOptionRefs.current[openingIndex]?.focus();
      });
    }
  }

  function returnToModeList() {
    setModeSheetView("modes");
    cancelModeMenuFocus();
    modeMenuFocusRafRef.current = window.requestAnimationFrame(() => {
      modeMenuFocusRafRef.current = null;
      if (!document.getElementById("app-mode-menu")) return;
      (modeOptionRefs.current[modeMenuFocusIndex] ?? modeOptionRefs.current[0])?.focus();
    });
  }

  function handleModeTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const side = modeMenuSideForMode(selectedAppMode.id);
      const options = orderModesForSide(visibleAppModeOptions, side);
      const current = Math.max(
        0,
        options.findIndex((mode) => mode.id === modeMenuRowFor(selectedAppMode.id)),
      );
      openModeMenuWithFocus(event.key === "ArrowDown" ? current : current - 1, side);
    } else if (event.key === "Tab" && modeMenuOpen && !usesPhoneSearchLayout) {
      // Desktop: Tab/Shift+Tab is leaving the trigger — close without trapping (APG
      // menu-button pattern; arrow keys are the entry into the menu). WebKit's
      // sequential focus navigation may never deliver a wrapper-escaping focusout
      // (links are excluded from its Tab order, and backward navigation can wrap
      // into the open menu), so keydown is the reliable dismiss signal; the wrapper
      // onBlur remains the net for pointer and programmatic focus moves.
      closeModeMenu();
    }
  }

  function handleModeOptionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusModeOption(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusModeOption(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusModeOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusModeOption(activeModeMenuOptions.length - 1);
    } else if (event.key === "Escape") {
      // Phone Sheet owns Escape + return-focus; handling here races its cleanup.
      if (usesPhoneSearchLayout) return;
      event.preventDefault();
      closeModeMenu();
      window.requestAnimationFrame(() => modeButtonRef.current?.focus());
    } else if (event.key === "Tab") {
      // Desktop: let focus leave the absolute menu and close it. Phone sheet
      // traps Tab itself — closing here would fight the dialog focus cycle.
      if (!usesPhoneSearchLayout) {
        closeModeMenu();
      }
    }
  }

  /**
   * The desktop mode popover's shell, shared by both of its levels.
   *
   * Two copies of this expression is how the section level quietly stops
   * looking like the mode level after the next tweak to one of them — the same
   * reason `modeMenuRowClass` below exists. It also kept a second legacy
   * shadow alias alive in this file for no design reason.
   */
  const modeMenuPopoverShell =
    "absolute left-0 top-[calc(100%+0.5rem)] z-[60] w-[min(25rem,calc(100vw-2rem))] overflow-hidden rounded-xl bg-[color-mix(in_srgb,var(--surface-lux)_84%,transparent)] text-[color:var(--text)] shadow-[var(--shadow-lux)]";
  /** A group of modes, inset inside the glass so the list reads as nested cards. */
  const modeMenuGroupCard =
    "rounded-lg border border-[color:var(--border-lux)] bg-[color-mix(in_srgb,var(--surface-raised)_92%,transparent)] p-1 shadow-[var(--shadow-inset)]";

  /**
   * The row treatment the mode menu uses, shared by the mode options and the
   * in-mode section rows below them.
   *
   * Extracted rather than copied: the section list is meant to be indistinguishable
   * from the mode list — same tile, same weight, same check disc — and two copies
   * of this expression is how "designed like everywhere else" quietly stops being
   * true after the next tweak to one of them.
   */
  function modeMenuRowClass(active: boolean) {
    // Picker B's rows on both the phone sheet and the desktop popover. The
    // popover's frosted shell and nested group cards come from #3351.
    return modePickerRowClass(active, usesPhoneSearchLayout);
  }

  function renderModeMenuRowContent({
    icon,
    label,
    description,
    active,
    showDescription = false,
    modeIconId,
    neutral,
  }: {
    icon: LucideIcon;
    label: string;
    /** The one-line phone hint (`modePickerHint`), not the registry description. */
    description?: string;
    active: boolean;
    /** Work's short list shows the line on desktop too. Clinical stays compact. */
    showDescription?: boolean;
    /** Only the mode list stamps this; the section list has no per-mode hook to offer. */
    modeIconId?: string;
    neutral?: boolean;
  }) {
    return (
      <ModePickerRowContent
        neutral={neutral}
        icon={icon}
        label={label}
        hint={description}
        showHint={showDescription}
        active={active}
        phone={usesPhoneSearchLayout}
        modeIconId={modeIconId}
      />
    );
  }

  function renderModeMenuOption(mode: (typeof visibleAppModeOptions)[number], index: number) {
    const active = mode.id === modeMenuRowFor(searchMode);
    return (
      <button
        key={mode.id}
        ref={(element) => {
          modeOptionRefs.current[index] = element;
        }}
        type="button"
        role="menuitemradio"
        aria-checked={active}
        aria-label={`${mode.label}. ${mode.description}`}
        tabIndex={active ? 0 : -1}
        data-sheet-autofocus={usesPhoneSearchLayout && index === modeMenuFocusIndex ? "true" : undefined}
        onFocus={() => prefetchModeSelection(mode.id)}
        onPointerEnter={() => prefetchModeSelection(mode.id)}
        onKeyDown={(event) => handleModeOptionKeyDown(event, index)}
        onClick={() => selectAppMode(mode)}
        className={cn(modeMenuRowClass(active), usesPhoneSearchLayout && modePickerCardRowClass)}
        // Each row wears its own area's colour (tile, tick, selected tint).
        data-mode-identity={mode.id}
      >
        {renderModeMenuRowContent({
          icon: appModeIcons[mode.id],
          label: mode.label,
          // The phone line is picker B's one-line hint. Work's desktop list shows
          // the registry description, as #3351 drew it.
          description: usesPhoneSearchLayout ? modePickerHint(mode.id) : mode.description,
          active,
          showDescription: modeMenuSide === "work",
          modeIconId: usesPhoneSearchLayout ? mode.id : undefined,
        })}
      </button>
    );
  }

  /**
   * One of this mode's own pages, drawn exactly like a mode row above it.
   *
   * A `<Link>`, not a `menuitemradio`: these navigate rather than switch a
   * setting, and they live outside the roving-tabindex list for the reason given
   * on `modeSheetView`. `aria-current="page"` marks the one you are on, which is
   * the link equivalent of the check disc the mode rows carry.
   */
  function renderModeSectionOption(entry: { readonly id: string; readonly label: string; readonly href?: string }) {
    if (!entry.href) return null;
    const active = currentPathname === entry.href;
    const Icon = modeSectionIcon(entry.id);
    if (!Icon) return null;
    // The pages level is on the 48/52 rule (kit 1.7); the "Choose mode" level
    // above keeps its own rows. Recipes in `mode-pages-sheet-classes.ts`.
    return (
      <Link
        key={entry.id}
        href={entry.href}
        onClick={dismissModeMenu}
        aria-current={active ? "page" : undefined}
        data-testid={`app-mode-section-${entry.id}`}
        className={modePagesRowClass(active)}
      >
        <span aria-hidden="true" className={modePagesTileClass(active)}>
          <Icon aria-hidden="true" className={modePagesIconClass} strokeWidth={modePagesIconStroke} />
        </span>
        <span className={modePagesLabelClass}>{entry.label}</span>
        {active ? <Check aria-hidden="true" className={modePagesCheckClass} strokeWidth={2} /> : null}
      </Link>
    );
  }

  /**
   * The section level's body: this mode's pages, then the one row that reaches
   * everything else.
   *
   * "All modes" sits below a rule at the foot rather than in the list, because it
   * is not a peer of the pages above it — it is the way out of this mode. The
   * sheet header also carries a back control, so the level is reversible in two
   * places, which is what stops it feeling like a dead end.
   */
  function renderModeSectionLevel() {
    // Hidden pages and editor-only pages leave the sheet; the pill still names
    // them when one is open, because `modeOwnPages` itself is unfiltered.
    const { main, tools, more } = groupModeSecondaryNavigationEntries(
      visibleModeSecondaryNavigationEntries(modeOwnPages, { isEditor: onCallEditor }),
    );
    return (
      <div data-testid="app-mode-section-list" className="grid pt-1">
        <div className="grid">{main.map((entry) => renderModeSectionOption(entry))}</div>
        {tools.length > 0 ? (
          <section
            role="group"
            aria-labelledby="app-mode-section-tools-heading"
            data-testid="app-mode-section-group-tools"
            className="mt-1.5 grid gap-1 border-t border-[color:var(--border)] pt-2"
          >
            <h3 id="app-mode-section-tools-heading" className={modePagesGroupHeadingClass}>
              Tools
            </h3>
            <div className="grid">{tools.map((entry) => renderModeSectionOption(entry))}</div>
          </section>
        ) : null}
        {more.length > 0 ? (
          <section
            role="group"
            aria-labelledby="app-mode-section-more-heading"
            aria-describedby="app-mode-section-more-hint"
            data-testid="app-mode-section-group-more"
            className="mt-1.5 grid gap-1 border-t border-[color:var(--border)] pt-2"
          >
            <h3 id="app-mode-section-more-heading" className={modePagesGroupHeadingClass}>
              More
            </h3>
            <p id="app-mode-section-more-hint" className={modePagesGroupHintClass}>
              Moving to their own modes
            </p>
            <div className="grid">{more.map((entry) => renderModeSectionOption(entry))}</div>
          </section>
        ) : null}
        <div className="mt-1.5 border-t border-[color:var(--border)] pt-1.5">
          <button
            type="button"
            onClick={returnToModeList}
            data-testid="app-mode-section-all-modes"
            className={cn(modeMenuRowClass(false), "text-left")}
          >
            {renderModeMenuRowContent({
              icon: LayoutGrid,
              label: "All modes",
              description: "Switch to another mode",
              active: false,
              neutral: true,
            })}
          </button>
        </div>
      </div>
    );
  }

  function renderModeSideToggle() {
    return <ModePickerSideToggle side={modeMenuSide} onChange={selectModeMenuSide} phone={usesPhoneSearchLayout} />;
  }

  function renderGroupedDesktopModeMenuOptions() {
    return phoneModeGroupsForSide(modeMenuSide).map((group) => {
      const groupModes = group.modeIds.flatMap((modeId) => {
        const mode = activeModeMenuOptions.find((candidate) => candidate.id === modeId);
        return mode ? [mode] : [];
      });
      if (groupModes.length === 0) return null;
      const rows = (
        <div className="grid gap-px">
          {groupModes.map((mode) =>
            renderModeMenuOption(
              mode,
              activeModeMenuOptions.findIndex((candidate) => candidate.id === mode.id),
            ),
          )}
        </div>
      );
      if (!group.showHeading) {
        return (
          <div key={group.id} className={modeMenuGroupCard}>
            {rows}
          </div>
        );
      }
      const headingId = `desktop-app-mode-group-${group.id}`;
      return (
        <section key={group.id} role="group" aria-labelledby={headingId} className={modeMenuGroupCard}>
          <h3 id={headingId} className={cn(eyebrowText, "px-2 pb-0.5 pt-1")}>
            {group.label}
          </h3>
          {rows}
        </section>
      );
    });
  }

  function renderModeMenuSideSwitch(controlsId: string, showHint = true) {
    const side = modeMenuSides.find((entry) => entry.id === modeMenuSide) ?? modeMenuSides[0];
    return (
      <div className="grid gap-1.5">
        <SegmentedControl
          label="Clinical or Work"
          layout="equal"
          value={modeMenuSide}
          onChange={selectModeMenuSide}
          ariaControls={controlsId}
          ariaDescribedBy="app-mode-side-hint"
          className="rounded-lg"
          options={modeMenuSides.map((entry) => ({
            value: entry.id,
            label: entry.label,
            icon: entry.id === "clinical" ? Stethoscope : Briefcase,
          }))}
        />
        {showHint ? (
          <p id="app-mode-side-hint" className="px-1 text-xs font-medium leading-4 text-[color:var(--text-muted)]">
            {side.hint}
          </p>
        ) : null}
      </div>
    );
  }

  const restoreActionMenuFocusRef = useRef(false);
  const closeScope = useCallback((restoreFocus = false) => {
    restoreActionMenuFocusRef.current = restoreFocus;
    setScopeOpen(false);
  }, []);

  useEffect(() => {
    if (scopeOpen || !restoreActionMenuFocusRef.current) return;
    restoreActionMenuFocusRef.current = false;
    window.requestAnimationFrame(() => {
      restoreFocusUnlessMoved(actionMenuTriggerRef.current);
    });
  }, [scopeOpen]);

  const closeScopeSheet = useCallback(() => {
    setScopeSheetOpen(false);
    window.requestAnimationFrame(() => {
      restoreFocusUnlessMoved(actionMenuTriggerRef.current);
    });
  }, []);
  const handleFocusSearchInput = useEventCallback(() => {
    queryInputRef?.current?.focus();
  });
  const retargetActionMenuSheetFocusToSearchInput = useEventCallback(() => {
    const target = queryInputRef?.current ?? null;
    actionMenuSheetReturnFocusRef.current = target;
    if (!currentUsesScopeSheet()) {
      window.requestAnimationFrame(() => {
        restoreFocusUnlessMoved(target);
      });
    }
  });
  const handleActionMenuCurrentSearch = useEventCallback(() => {
    retargetActionMenuSheetFocusToSearchInput();
    setActionMenuOpen(false);
  });
  const handleActionMenuGlobalSearch = useEventCallback(() => {
    retargetActionMenuSheetFocusToSearchInput();
    setActionMenuOpen(false);
    setCommandDropdownOpen(true);
  });

  const phoneLayoutGateRef = useRef<boolean | null>(null);
  useEffect(() => {
    const scopeMediaQuery = window.matchMedia(scopeSheetMediaQuery);
    const phoneMediaQuery = window.matchMedia(phoneSearchLayoutMediaQuery);
    const sync = () => {
      setUsesScopeSheet(scopeMediaQuery.matches);
      const nextPhoneLayout = phoneMediaQuery.matches;
      // Crossing the phone gate while open would swap Sheet ↔ absolute menu
      // under the user's finger/keyboard; close instead of mutating surface.
      if (phoneLayoutGateRef.current !== null && phoneLayoutGateRef.current !== nextPhoneLayout) {
        setModeMenuOpen(false);
      }
      phoneLayoutGateRef.current = nextPhoneLayout;
      setUsesPhoneSearchLayout(nextPhoneLayout);
    };
    sync();
    scopeMediaQuery.addEventListener("change", sync);
    phoneMediaQuery.addEventListener("change", sync);
    return () => {
      scopeMediaQuery.removeEventListener("change", sync);
      phoneMediaQuery.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    onScopeOpenChange?.(scopeOpen || scopeSheetOpen);
  }, [onScopeOpenChange, scopeOpen, scopeSheetOpen]);

  useEffect(() => {
    // A mode-home hero always takes precedence over the generic desktop page
    // slot. Hosts normally pass only one, but this keeps ownership deterministic
    // during route transitions where both slots can briefly coexist.
    const composerSlotId = desktopHomeComposerSlotId ?? desktopPageComposerSlotId;
    const composerSlotKind = desktopHomeComposerSlotId ? "home" : "page";
    // The page's first client render still expects its SSR reserve attribute.
    // Every mutation, including phone/suppression/fallback clears, must wait
    // for the owning segment's hydration, just like portal adoption does.
    const syncReserve = (pending: boolean) => syncHydratedComposerReserve(composerSlotId, pending);

    let cancelled = false;
    const resetPortal = () => {
      syncReserve(false);
      setDesktopComposerPortalActive(false);
      setDesktopComposerPortalHost(null);
      setDesktopComposerPortalFallback(false);
      setHomeComposerMediaEligible(false);
    };
    if (!composerSlotId) {
      queueMicrotask(() => !cancelled && resetPortal());
      return () => {
        cancelled = true;
      };
    }

    // The composer is portaled into a stable host we own, and we move that host
    // in and out of the page-owned slot as it appears/disappears. The slot is
    // rendered by page content and unmounts on navigation; portaling directly
    // into it made React reconcile the portal against a container that another
    // part of the tree had already removed, throwing a null-parentNode error.
    // Because the host is stable, React's portal container never disappears.
    // Hero slots retain their existing all/sm-up ownership. Generic page slots
    // start at sm so tablets and desktops share normal-flow search behaviour,
    // while phone docks remain unchanged.
    const host = searchComposerVisible ? document.createElement("div") : null;
    if (host) host.style.display = "contents";

    const mediaQuery = searchComposerVisible
      ? window.matchMedia(
          composerSlotKind === "home"
            ? heroComposerBreakpoint === "sm-up"
              ? modeHomeComposerSmUpMediaQuery
              : modeHomeComposerMediaQuery
            : desktopPageComposerMediaQuery,
        )
      : null;

    let retryTimeout: number | null = null;
    let portalFailureStartedAt: number | null = null;
    const portalFallbackDelayMs = 8_000;
    // Runs synchronously off the MutationObserver (which already coalesces
    // records into a microtask) rather than behind requestAnimationFrame.
    // Headless CI throttles/pauses rAF whenever the page is not actively
    // compositing, which stalled portal activation for seconds and made the
    // hero composer flake out of the mode-home slot. A microtask-driven sync
    // settles the portal on the same tick the slot mounts, no frame required.
    //
    // Ready-gate: page-owned slots mark `data-composer-slot-ready` only after
    // their React segment hydrates. Adopting the slot before that injects a
    // display:contents host into still-unhydrated RSC HTML (React #418).
    // True only for the synchronous call from this effect body, where React is
    // already committing and `flushSync` is not allowed.
    let syncingFromEffect = false;
    const syncTarget = () => {
      if (!searchComposerVisible || !host || !mediaQuery) {
        syncReserve(false);
        return;
      }
      if (composerSlotKind === "home") {
        setHomeComposerMediaEligible(mediaQuery.matches);
      }
      const homeSlot = composerSlotKind === "home" ? document.getElementById(composerSlotId) : null;
      const slot = mediaQuery.matches ? (homeSlot ?? document.getElementById(composerSlotId)) : null;
      if (slot && isDesktopComposerSlotReady(slot)) {
        if (retryTimeout !== null) {
          window.clearTimeout(retryTimeout);
          retryTimeout = null;
        }
        portalFailureStartedAt = null;
        const adopting = host.parentNode !== slot;
        if (adopting) slot.appendChild(host);
        // Portal host keeps height via `:not(:empty)`; drop the pending marker.
        setModeHomeComposerReservePending(slot, false);
        const activatePortal = () => {
          setDesktopComposerPortalHost(host);
          setDesktopComposerPortalActive(true);
          setDesktopComposerPortalFallback(false);
        };
        // Observer/timer/media callbacks run outside React. Adopting a slot there
        // inserts the still-empty host; commit the portal's composer in the same
        // task so no frame paints the slot without it. An empty host keeps the
        // slot's reserved height but not its width, so the shrink-to-fit phone
        // home column painted narrower for a frame and then widened (a CLS shift).
        if (adopting && !syncingFromEffect) flushSync(activatePortal);
        else activatePortal();
      } else {
        host.parentNode?.removeChild(host);
        setDesktopComposerPortalActive(false);
        if (!mediaQuery.matches) {
          if (retryTimeout !== null) {
            window.clearTimeout(retryTimeout);
            retryTimeout = null;
          }
          portalFailureStartedAt = null;
          setDesktopComposerPortalFallback(false);
          // Viewport never hosts this hero slot — collapse the SSR reserve band.
          syncReserve(false);
          return;
        }
        const now = window.performance.now();
        portalFailureStartedAt ??= now;
        const fallbackDelayRemaining = portalFallbackDelayMs - (now - portalFailureStartedAt);
        if (fallbackDelayRemaining > 0) {
          // Body mutations may arrive continuously while a route hydrates. They
          // must not consume the retry budget or reset its deadline; only one
          // elapsed-time poll is scheduled at once.
          if (retryTimeout === null) {
            retryTimeout = window.setTimeout(
              () => {
                retryTimeout = null;
                syncTarget();
              },
              Math.min(200, fallbackDelayRemaining),
            );
          }
          // Keep the SSR pending reserve while we retry adoption.
          syncReserve(true);
        } else {
          // A missing/unhydrated page slot must not remove search forever. Home
          // routes suppress the header fallback during the bounded retry window
          // because ModeHomeTemplate already reserves the settled hero geometry;
          // only surface the fallback after portal adoption has genuinely failed.
          // Collapse the empty hero band once the header fallback takes over.
          syncReserve(false);
          setDesktopComposerPortalFallback(true);
        }
      }
    };

    const observer = observeDesktopComposerSlots(syncTarget);
    if (!searchComposerVisible) {
      queueMicrotask(() => !cancelled && resetPortal());
    } else {
      syncingFromEffect = true;
      try {
        syncTarget();
      } finally {
        syncingFromEffect = false;
      }
      mediaQuery?.addEventListener("change", syncTarget);
    }
    return () => {
      cancelled = true;
      if (retryTimeout !== null) window.clearTimeout(retryTimeout);
      observer.disconnect();
      mediaQuery?.removeEventListener("change", syncTarget);
      host?.parentNode?.removeChild(host);
      if (searchComposerVisible) {
        syncHydratedComposerReserve(composerSlotId, false);
        setDesktopComposerPortalActive(false);
        setDesktopComposerPortalHost(null);
        setDesktopComposerPortalFallback(false);
      }
    };
  }, [desktopHomeComposerSlotId, desktopPageComposerSlotId, heroComposerBreakpoint, searchComposerVisible]);

  const dismissModeMenu = useCallback(() => closeModeMenu(), [closeModeMenu]);
  function dismissScope(reason: "outside" | "escape") {
    closeScope(reason === "escape");
  }

  useDismissableLayer({
    // Phone Mode uses Sheet (backdrop / Escape / focus trap). Keep the
    // dismissable-layer contract on the desktop absolute menu only.
    enabled: modeMenuOpen && !usesPhoneSearchLayout,
    refs: [modeMenuRef],
    restoreFocusRef: modeButtonRef,
    onDismiss: dismissModeMenu,
  });

  useDismissableLayer({
    enabled: scopeOpen,
    refs: [scopePopoverRef, actionMenuTriggerRef],
    restoreFocusRef: actionMenuTriggerRef,
    onDismiss: dismissScope,
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAsk) return;
    setActionMenuOpen(false);
    setCommandDropdownOpen(false);
    onAsk();
  }

  function updateTextScopeFilter(key: TextScopeFilterKey, value: string) {
    onScopeFiltersChange({ ...scopeFilters, [key]: splitFilterText(value) });
  }

  const hideStrategy = hideOnScroll?.strategy;
  const phoneMotion = hideOnScroll?.phoneMotion ?? "collapse";
  const phoneOverlayMotion = hideStrategy === "collapse" && phoneMotion === "overlay";
  // Outer-scope mirror of `renderSearchComposer`'s local `usesPhoneFooterDock`
  // for the "default" placement, where `isDesktopHomeComposer` is false. Needed
  // at the stack render site to decide whether the composer must portal out of
  // the transformed overlay layer; keep the two in step.
  const usesPhoneBottomDock = usesPhoneSearchLayout && (isAnswerFooterComposer || isMobileBottomComposer);
  // Overlay hosts that opt into all breakpoints take the header fully out of
  // flow (absolute over the scrolling <main>, which reserves matching top
  // padding) so content frosts under the glass bar at every width.
  const overlayAllBreakpoints = hideStrategy === "overlay" && Boolean(hideOnScroll?.allBreakpoints);
  const wideCollapseBehaviour = hideStrategy === "collapse" ? hideOnScroll?.wide : undefined;
  // Collapse hosts whose scrollport is internal at every width release the
  // header row at every width too; hosts that hand scrolling back to the
  // document above the phone breakpoint stick and translate there instead.
  const collapsesAtEveryWidth = wideCollapseBehaviour === "collapse";
  const sticksAbovePhones = wideCollapseBehaviour === "sticky";

  function renderSearchComposer(placement: "default" | "desktop-home" | "desktop-page") {
    const isDesktopHomeComposer = placement === "desktop-home";
    const isDesktopPageComposer = placement === "desktop-page";
    const isDefaultComposer = placement === "default";
    const isPageDesktopComposerPending =
      isDefaultComposer && Boolean(desktopPageComposerSlotId) && !desktopComposerPortalFallback;
    const usesAnswerFooterStyle = isAnswerFooterComposer && !isDesktopHomeComposer;
    const usesMobileBottomStyle = isMobileBottomComposer && !isDesktopHomeComposer;
    const usesBottomComposerPlacement = usesAnswerFooterStyle || (usesMobileBottomStyle && usesPhoneSearchLayout);
    // Sticky-top result composers (tablet+) share the footer chip layout so the
    // pill + chip row looks identical across homes, results, and the answer dock.
    const usesFooterChipLayout = usesBottomComposerPlacement || isDesktopHomeComposer || usesMobileBottomStyle;
    // Keep footer suggestion chips on tablet/desktop; phones reach the same actions via "+".
    const showFooterSearchChips = usesFooterChipLayout && !usesPhoneSearchLayout;
    const usesSendAffordance = searchMode === "answer" || usesFooterChipLayout;
    const usesModeIdentityAffordance = usesBottomComposerPlacement && !usesSendAffordance;
    const ModeIdentityIcon = appModeIcons[searchMode];
    const hasScopeFooterChip = searchMode === "answer" || searchMode === "documents" || searchMode === "forms";
    const usesPhoneFooterDock = usesBottomComposerPlacement && usesPhoneSearchLayout;
    const showsAnswerFollowUpRow = Boolean(
      usesPhoneFooterDock &&
      searchMode === "answer" &&
      composerFollowUpSuggestions?.length &&
      onPickComposerFollowUpSuggestion,
    );
    // Every phone dock is the compact single-row pill; the answer dock only
    // keeps the taller default treatment while its follow-up chip row renders
    // above the pill (the compact scrim would be too short for it).
    const usesCompactMobileBottomStyle =
      (usesMobileBottomStyle && mobileBottomSearchVariant === "compact") ||
      (usesAnswerFooterStyle && usesPhoneFooterDock && !showsAnswerFollowUpRow);
    // Differentials compare addon is dock chrome (search pill + Compare bar).
    // Hide/reveal the whole dock together; do not pin for the addon slot.
    const shouldHideBottomOnScroll = Boolean(hideOnScroll && usesPhoneFooterDock);
    // Phones show the APP-5 notice on the home hero (the answer mode
    // home's in-flow composer) and footer mode homes (e.g. tools); result
    // bottom docks omit it so content keeps maximum screen space.
    // `mobileHomeComposerPlacement === "footer"` alone is not enough: it is set
    // for every /tools-prefixed route, so the home slot must also be present to
    // distinguish the tools home from a tools result dock.
    // Tablet/desktop show it on the mode-home hero and the answer dock (its
    // own composer type). Submitted result views and page slots render the
    // compact pill alone, like the phone result dock.
    // Favourites is the one mode home without the line: owner decision
    // 2026-09-30, so the saved list starts closer to the top of the page.
    // Every other mode home and the answer dock keep it.
    const showsComposerPrivacyNotice =
      searchMode !== "favourites" &&
      (usesPhoneSearchLayout
        ? isDesktopHomeComposer || (mobileHomeComposerPlacement === "footer" && Boolean(desktopHomeComposerSlotId))
        : isDesktopHomeComposer || usesAnswerFooterStyle);

    const commandSurfacePlacement: CommandSurfacePlacement = usesBottomComposerPlacement ? "bottom-dock" : "inline";
    const commandDropdownDisplayable = commandDropdownDisplayableByPlacement[commandSurfacePlacement];
    // Search sits outside the collapsing top-bar row. Sticky hosts pin an outer
    // top-bar stack; result composers portal into page flow at sm+, so this
    // relative fallback only covers the brief pre-portal default placement (a
    // second sticky + top offset would overlay page controls). Collapse-
    // everywhere hosts have no outer stack, so their non-portaled composer
    // keeps its own sticky and drops the top-bar clearance while the bar is
    // hidden.
    const stickySearchOwnedByOuterStack = sticksAbovePhones;
    const stickySearchClearsTopBar = !(hideStrategy === "collapse" && headerChromeHidden);
    const stickySearchTopClass = stickySearchClearsTopBar
      ? "top-[calc(4.75rem+env(safe-area-inset-top))] sm:top-[calc(4.75rem+env(safe-area-inset-top))]"
      : "top-0 sm:top-0";
    const stickySearchPositionClass = cn("sm:sticky", stickySearchTopClass);

    return (
      <form
        role="search"
        aria-label="Search"
        onSubmit={submit}
        data-composer-placement={placement}
        onTouchStart={(e) => {
          touchStartY.current = e.touches[0].clientY;
        }}
        onTouchMove={(e) => {
          if (touchStartY.current === null) return;
          // Ignore swipes that originate inside a scrollable container
          if (e.target instanceof Element && e.target.closest(".overflow-y-auto, .overflow-auto, .overflow-x-auto")) {
            touchStartY.current = null;
            return;
          }
          const currentY = e.touches[0].clientY;
          const diff = currentY - touchStartY.current;
          if (diff > 50) {
            if (document.activeElement instanceof HTMLElement) {
              document.activeElement.blur();
            }
            touchStartY.current = null;
          }
        }}
        data-footer-variant={usesPhoneFooterDock ? (usesCompactMobileBottomStyle ? "compact" : "default") : undefined}
        data-footer-addon={
          usesPhoneFooterDock && mobileBottomSearchAddonSlotId
            ? (mobileBottomSearchAddonKind ?? "differentials-compare")
            : undefined
        }
        data-command-open={
          // Phones never show the command dropdown, so the dock scrim must not
          // grow for it — gate the open attribute to widths that can display it.
          usesBottomComposerPlacement && commandDropdownDisplayable && commandDropdownOpen ? "true" : undefined
        }
        data-scroll-hidden={shouldHideBottomOnScroll && bottomComposerHidden ? "true" : undefined}
        {...(shouldHideBottomOnScroll ? composerFocusProps : undefined)}
        className={cn(
          isDesktopHomeComposer
            ? "universal-home-search-edge mx-auto w-full"
            : isDesktopPageComposer
              ? "document-mobile-search-edge universal-top-search-edge relative z-20 mx-auto w-full max-w-3xl px-4 py-3 lg:max-w-4xl"
              : usesAnswerFooterStyle
                ? "phone-footer-layer floating-composer-edge dashboard-composer-edge bottom-0 z-40 mx-auto max-w-3xl sm:fixed lg:max-w-4xl"
                : usesMobileBottomStyle
                  ? cn(
                      usesPhoneFooterDock
                        ? "phone-footer-layer document-mobile-search-edge universal-top-search-edge z-40 w-full sm:fixed"
                        : cn(
                            "document-mobile-search-edge universal-top-search-edge z-40 mx-auto max-w-3xl sm:z-20 sm:w-full sm:px-4 sm:py-3 lg:max-w-4xl",
                            // Sticky-stack hosts pin the top bar; result search
                            // portals out at sm+. Never leave a fixed/sticky
                            // default composer in that stack — it overlays page
                            // controls (Services decision rail).
                            stickySearchOwnedByOuterStack
                              ? "relative"
                              : cn("fixed", isHeroDesktopComposer ? "sm:hidden" : stickySearchPositionClass),
                            stickySearchOwnedByOuterStack && isHeroDesktopComposer && "sm:hidden",
                          ),
                    )
                  : cn(
                      "universal-top-search-edge mx-auto box-border w-full px-3 py-3 sm:px-4",
                      stickySearchOwnedByOuterStack ? "relative z-20" : cn("sticky z-20", stickySearchTopClass),
                    ),
          isPageDesktopComposerPending && "sm:hidden",
          usesBottomComposerPlacement && "answer-footer-search-edge",
          usesPhoneFooterDock && "answer-footer-search-dock",
          usesCompactMobileBottomStyle && "document-mobile-search-compact",
          showFooterSearchChips && "flex flex-col items-center gap-2.5",
          shouldHideBottomOnScroll &&
            cn(
              "max-sm:transition-[transform,opacity] motion-reduce:transition-none",
              bottomComposerHidden
                ? "max-sm:duration-[var(--duration-slow)] max-sm:ease-[var(--ease-chrome-hide)]"
                : "max-sm:duration-[var(--duration-moderate)] max-sm:ease-[var(--ease-chrome-reveal)]",
            ),
        )}
      >
        {usesBottomComposerPlacement ? <div className="answer-footer-search-backdrop" aria-hidden="true" /> : null}
        {usesMobileBottomStyle && mobileBottomSearchAddonSlotId ? (
          <div
            id={mobileBottomSearchAddonSlotId}
            className="differentials-mobile-search-addon relative z-10 w-full empty:hidden"
          />
        ) : null}
        {showsAnswerFollowUpRow && composerFollowUpSuggestions?.length && onPickComposerFollowUpSuggestion ? (
          <AnswerFollowUpSuggestions
            suggestions={composerFollowUpSuggestions}
            onPick={onPickComposerFollowUpSuggestion}
            disabled={composerFollowUpSuggestionsDisabled}
            testId="answer-composer-follow-up-suggestions"
            layout="scroll"
            className="answer-suggestion-row-composer-followups relative z-10 w-full sm:hidden"
          />
        ) : null}
        <UniversalSearchCommandSurface
          demoMode={demoMode}
          canAccessFavourites={canAccessFavourites}
          modeId={searchMode}
          query={query}
          recentQueries={recentQueries}
          placement={commandSurfacePlacement}
          dropdownOpen={commandDropdownOpen}
          onDropdownOpenChange={setCommandDropdownOpen}
          onQueryChange={onQueryChange}
          onSearch={onAsk}
          onPickRecent={(recent) => {
            onQueryChange(recent);
            if (onPickRecent) {
              onPickRecent(recent);
              return;
            }
            onAsk();
          }}
          onCrossMode={(targetMode, crossQuery) => {
            if (targetMode === "favourites" && !canAccessFavourites) {
              onRequestAccountSetup?.();
              return;
            }
            if (onCrossModeSearch) {
              onCrossModeSearch(targetMode, crossQuery);
              return;
            }
            onQueryChange(crossQuery);
            onSearchModeChange(targetMode);
            onAsk();
          }}
          onRunModeAction={runModeAction}
          onListboxIdReady={setCommandListboxId}
          onActiveItemIdChange={setCommandActiveItemId}
          onFocusSearchInput={handleFocusSearchInput}
          // Favourites shows the pill alone on its home too (owner decision
          // 2026-09-30): no "Try this" ticker, "Try …" line or prompt rail.
          showPhoneSuggestionTicker={showPhoneSuggestionTickerOnHome && searchMode !== "favourites"}
          // Only the mode-home hero keeps the "Try …" line and prompt rail.
          // Result views, page slots, and the answer dock render the pill
          // alone in every mode.
          showHomeSuggestions={isDesktopHomeComposer && searchMode !== "favourites"}
        >
          <div
            data-menu-placement={actionMenuOpen ? actionMenuPlacement : undefined}
            className={cn(
              chatComposerShellBase,
              "answer-footer-search-pill relative z-10 w-full",
              actionMenuOpen && "answer-footer-search-pill-open",
              commandDropdownOpen && "answer-footer-search-pill-open",
            )}
          >
            <ModeActionPopup
              open={actionMenuOpen}
              title="Pins and search"
              titleIcon={Layers3}
              subtitle="Open a pin or choose where this search runs."
              buttonLabel={actionMenuButtonLabel}
              items={actionMenuItems}
              onOpenChange={setActionMenuOpen}
              onBeforeOpen={() => {
                actionMenuSheetReturnFocusRef.current = null;
                setUsesScopeSheet(currentUsesScopeSheet());
                setCommandDropdownOpen(false);
                setModeMenuOpen(false);
                setScopeOpen(false);
                setScopeSheetOpen(false);
              }}
              onAction={runModeAction}
              onPlacementChange={setActionMenuPlacement}
              triggerClassName="answer-footer-search-action"
              triggerRef={actionMenuTriggerRef}
              integrated={usesFooterChipLayout}
              integratedChipRow={showFooterSearchChips}
              useSheet={usesScopeSheet}
              sheetReturnFocusRef={actionMenuSheetReturnFocusRef}
              dismissIgnoreRefs={[modeMenuRef]}
              customBody={
                <SearchPinsMenu
                  key={actionMenuOpen ? "pins-menu-open" : "pins-menu-closed"}
                  currentModeId={selectedAppMode.id}
                  modeOptions={actionMenuModeOptions}
                  actions={actionMenuItems}
                  globalSearchAvailable={commandDropdownDisplayable}
                  onClose={() => setActionMenuOpen(false)}
                  onCurrentSearch={handleActionMenuCurrentSearch}
                  onGlobalSearch={handleActionMenuGlobalSearch}
                  onModeSelect={(modeId) => {
                    setActionMenuOpen(false);
                    selectAppModeById(modeId);
                  }}
                  onAction={(actionId) => {
                    setActionMenuOpen(false);
                    runModeAction(actionId);
                  }}
                />
              }
            />

            {/* The clear button is a flex sibling (not absolutely positioned): the
              unlayered .answer-footer-search-input padding beats a conditional
              pr-* utility, which let text run under an overlaid button. */}
            <div className="flex min-w-0 flex-1 items-center overflow-hidden">
              <input
                type="search"
                ref={bindQueryInputRef}
                id="global-search-input"
                name="query"
                data-testid="global-search-input"
                autoComplete="off"
                spellCheck={false}
                data-gramm="false"
                data-enable-grammarly="false"
                autoFocus={queryInputAutoFocus}
                disabled={searchSetupNotReady}
                title={searchSetupNotReady ? "Search setup not ready" : undefined}
                onFocus={(e) => {
                  e.target.scrollIntoView({ block: "nearest", behavior: resolveScrollBehavior() });
                }}
                value={query}
                enterKeyHint="search"
                inputMode="search"
                role="combobox"
                aria-expanded={commandDropdownOpen}
                aria-controls={commandDropdownOpen ? commandListboxId : undefined}
                aria-autocomplete="list"
                aria-activedescendant={commandDropdownOpen ? (commandActiveItemId ?? undefined) : undefined}
                aria-describedby={
                  hasPhiWarning
                    ? composerPhiWarningId
                    : showsComposerPrivacyNotice
                      ? composerPrivacyWarningId
                      : undefined
                }
                // React's onChange already fires on every input event; a duplicate
                // onInput called onQueryChange twice per keystroke, doubling the
                // controlled-state work on a large parent tree.
                onChange={(event) => onQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canAsk) onAsk();
                }}
                aria-label={`Search indexed guidelines by question or keyword - ${selectedSearch.inputAriaLabel}`}
                placeholder={queryPlaceholder}
                className={cn(chatComposerInput, "w-full min-w-0", "answer-footer-search-input")}
              />
              {query && (
                <button
                  type="button"
                  onClick={onClearQuery}
                  className="grid min-h-tap min-w-tap shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] sm:h-12 sm:w-12"
                  aria-label="Clear search question"
                >
                  <X aria-hidden="true" className="size-icon-md" />
                </button>
              )}
            </div>
            <span className="answer-footer-search-divider" aria-hidden="true" />
            <button
              type="submit"
              disabled={!canAsk}
              title={
                searchSetupNotReady
                  ? "Search setup not ready"
                  : trimmedQuery.length < 1
                    ? selectedSearch.emptyTitle
                    : selectedSearch.readyTitle
              }
              className={cn(chatSendButton, "answer-footer-search-send")}
              aria-label={selectedSearch.submitAriaLabel}
            >
              {loading ? (
                <Loader2 aria-hidden="true" className="size-icon-lg animate-spin" />
              ) : usesSendAffordance ? (
                <Send aria-hidden="true" className="size-icon-lg" />
              ) : usesModeIdentityAffordance ? (
                <ModeIdentityIcon aria-hidden="true" className="size-icon-lg" />
              ) : (
                <Search aria-hidden="true" className="size-icon-lg" />
              )}
              <span className="sr-only">{submitLabel}</span>
            </button>
          </div>
        </UniversalSearchCommandSurface>
        {/* Single site-wide APP-5 privacy line: the mode-home hero and the
            answer dock render exactly one compact notice below the pill; no
            other surface may duplicate it. Result composers omit it at every
            width — see showsComposerPrivacyNotice. */}
        {showsComposerPrivacyNotice ? (
          <div role="group" aria-label="Search privacy notice">
            <PrivacyInputNotice
              id={composerPrivacyWarningId}
              testId={composerPrivacyWarningId}
              className="mt-1.5 justify-center px-3 text-center sm:px-0"
              returnMode={searchMode === "answer" ? undefined : searchMode}
            />
          </div>
        ) : null}
        {hasPhiWarning ? (
          <PatientDetailAlert
            id={composerPhiWarningId}
            testId={composerPhiWarningId}
            className="mt-1.5 px-3 text-center"
          >
            {phiWarningText}
          </PatientDetailAlert>
        ) : null}
        {scopePickerMounted ? (
          <MasterSearchHeaderScopePicker
            usesScopeSheet={usesScopeSheet}
            scopeOpen={scopeOpen}
            scopeSheetOpen={scopeSheetOpen}
            scopeSheetFullscreen={scopeSheetFullscreen}
            closeScopeSheet={closeScopeSheet}
            scopePopoverRef={scopePopoverRef}
            scopeFilterInputRef={scopeFilterInputRef}
            actionMenuTriggerRef={actionMenuTriggerRef}
            hasScopeFooterChip={hasScopeFooterChip}
            scopePreview={scopePreview}
            scopeSummary={scopeSummary}
            loadedScopeSummary={loadedScopeSummary}
            selectedDocumentIds={selectedDocumentIds}
            documents={documents}
            matchingDocuments={matchingDocuments}
            visibleScopeDocuments={visibleScopeDocuments}
            requireScopeFilter={requireScopeFilter}
            hiddenScopeMatchCount={hiddenScopeMatchCount}
            scopeFilter={scopeFilter}
            setScopeFilter={setScopeFilter}
            onClearScope={onClearScope}
            onToggleScope={onToggleScope}
            scopeFilters={scopeFilters}
            onScopeFiltersChange={onScopeFiltersChange}
            queryMode={queryMode}
            onQueryModeChange={(mode) => onQueryModeChange(mode as ClinicalQueryMode)}
            queryModeOptions={queryModeOptions}
            activeQuickFilterCount={activeQuickFilterCount}
            activeLabelFilterCount={activeLabelFilterCount}
            updateTextScopeFilter={updateTextScopeFilter}
          />
        ) : null}
      </form>
    );
  }

  const chromeFocusProps = hideOnScroll
    ? {
        onFocusCapture: () => setHeaderChromeFocused(true),
        onBlurCapture: (event: ReactFocusEvent<HTMLElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeaderChromeFocused(false);
        },
      }
    : undefined;
  const composerFocusProps = hideOnScroll
    ? {
        onFocusCapture: () => setComposerChromeFocused(true),
        onBlurCapture: (event: ReactFocusEvent<HTMLElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setComposerChromeFocused(false);
        },
      }
    : undefined;

  // Top bar only (mode / new chat / menu). The search composer is intentionally
  // NOT part of this node: on tablet/desktop hide-on-scroll must reclaim the top
  // bar without taking the search field with it. Phone bottom docks are fixed and
  // escape any collapse wrapper; hero composers portal out of this tree.
  const topBar = (
    <header
      id="search"
      data-scroll-hidden={hideStrategy === "overlay" && headerChromeHidden ? "true" : undefined}
      // Work frame (glass buttons and pill) and band tints, decided from the mode and
      // address alone so they are in the server HTML (work-mode.css, mode-band.css).
      data-work-frame={routeWorkArea?.id}
      data-work-band={routeWorkFramed ? "" : undefined}
      data-mode-identity={routeWorkFrame?.area.identity}
      data-clinical-band={clinicalBandAttribute(selectedAppMode.id, currentPathname, Boolean(routeWorkArea))}
      className={cn(
        // No backdrop-filter on the header itself: it would form a backdrop
        // root and starve the .edge-glass-header-backdrop scrim (the single
        // source of the bar's frost) of the real page behind it.
        // Collapse hosts own the OS top inset via `chrome-safe-area-top`, so
        // this bar only needs its aesthetic 0.5rem pad. On phones that spacer
        // releases with hidden chrome; wider sticky hosts keep it pinned.
        // Overlay hosts still paint the inset themselves (answer mode keeps an
        // equivalent reserve on <main>).
        "edge-glass-header universal-header z-30 py-2 text-[color:var(--text)]",
        hideStrategy === "collapse" ? "pt-2" : "pt-[max(0.5rem,var(--safe-area-top))]",
        // Collapse hosts keep the top bar above an internally scrolling <main>,
        // so sticky is unnecessary wherever the row collapses and fights the
        // 0fr grid by pinning the bar inside the viewport. Sticky hosts pin an
        // outer stack (top bar + search) instead; this <header> stays relative
        // inside that stack. All-breakpoints overlay hosts take the bar out of
        // flow entirely (absolute over the padded <main>). Legacy overlay hosts
        // keep sticky (they ride document scroll) and translate away with no
        // layout shift.
        hideStrategy === "collapse"
          ? sticksAbovePhones || collapsesAtEveryWidth
            ? "relative"
            : "max-sm:relative sm:sticky sm:top-0"
          : overlayAllBreakpoints
            ? "phone-overlay-header sm:absolute sm:inset-x-0 sm:top-0"
            : "sticky top-0",
        // Overlay hide-on-scroll: a plain translate reveals the content already
        // flowing beneath it. No transform is applied while visible so the
        // fixed-position mobile mode menu keeps the viewport as its containing block.
        hideStrategy === "overlay" &&
          (overlayAllBreakpoints
            ? cn(
                "transition-transform motion-reduce:transition-none",
                headerChromeHidden
                  ? "duration-[var(--duration-slow)] ease-[var(--ease-chrome-hide)]"
                  : "duration-[var(--duration-moderate)] ease-[var(--ease-chrome-reveal)]",
              )
            : cn(
                "max-sm:transition-transform motion-reduce:transition-none",
                headerChromeHidden
                  ? "max-sm:duration-[var(--duration-slow)] max-sm:ease-[var(--ease-chrome-hide)]"
                  : "max-sm:duration-[var(--duration-moderate)] max-sm:ease-[var(--ease-chrome-reveal)]",
              )),
        hideStrategy === "overlay" &&
          headerChromeHidden &&
          (overlayAllBreakpoints ? "-translate-y-full" : "max-sm:-translate-y-full"),
      )}
      {...(hideStrategy === "overlay" ? chromeFocusProps : undefined)}
    >
      <div className="edge-glass-header-backdrop" aria-hidden="true" />
      <div className="universal-header-row relative mx-auto grid min-h-14 max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div
          className="universal-header-leading flex min-w-0 items-center gap-2 sm:gap-3"
          data-two-pane-menu={twoPaneSideMenu ? "" : undefined}
        >
          {/* A work page reached from its area's More sheet draws its back
              button here (`WorkFrameBack`); CSS then stands the menu button
              down, so the round left control is one or the other. With the
              two-pane side menu both show, the menu first. */}
          <div ref={leadingSlotRef} id="universal-header-leading" className="contents" />
          <button
            type="button"
            onClick={onOpenMobileSidebar}
            className="universal-header-menu universal-header-icon-control grid h-tap w-tap shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] md:hidden"
            aria-label="Open PsychSift menu"
          >
            <Menu aria-hidden="true" className="size-icon-lg" />
          </button>
          {/* The shared home draws no wordmark here (owner design review, 12 Oct
              2026): the side rail already carries the PsychSift mark on every
              desktop page, so a second lockup in the header showed the logo twice. */}
        </div>

        <div
          ref={modeMenuRef}
          onBlur={(event) => {
            // Phone Mode menu is portaled into Sheet; blur-leave on this wrapper
            // would close the sheet as soon as focus moved into the dialog.
            if (usesPhoneSearchLayout) return;
            const nextFocusedElement = event.relatedTarget;
            if (nextFocusedElement instanceof Node && event.currentTarget.contains(nextFocusedElement)) return;
            closeModeMenu();
          }}
          className="universal-header-mode relative z-[60] min-w-0 justify-self-center"
        >
          <button
            ref={modeButtonRef}
            type="button"
            onClick={toggleModeMenu}
            onKeyDown={handleModeTriggerKeyDown}
            className={cn(
              "universal-header-mode-button inline-grid h-tap w-auto min-w-0 max-w-[calc(100vw-9rem)] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 text-left transition hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:pr-3",
            )}
            aria-haspopup="dialog"
            aria-expanded={modeMenuOpen}
            aria-controls={modeMenuOpen ? "app-mode-menu" : undefined}
            // Still prefixed `Mode …`, and that is load-bearing: twelve test
            // files and the shared `tests/playwright-app-mode.ts` helper find
            // this control by that exact opening. The page is appended rather
            // than substituted, so the name gains information without any of
            // them going looking for a control that no longer answers.
            //
            // Where the pill shows the visible word "Modes" (non-work routes
            // other than `/`), the name must contain it (WCAG 2.5.3 Label in
            // Name). "Modes, current mode X" still contains `Mode X` for the
            // substring lookups above.
            aria-label={
              !routeWorkArea && currentPathname !== "/"
                ? `Modes, current mode ${selectedAppMode.label}${activeModePage ? `, page ${activeModePage.label}` : ""}`
                : activeModePage
                  ? `Mode ${selectedAppMode.label}, page ${activeModePage.label}`
                  : `Mode ${selectedAppMode.label}`
            }
            // The mode's own hue, on the mode's own control. Resolves to the
            // product accent for every mode that names no identity, so this is
            // inert everywhere but On Call — see the `--mode-identity` block in
            // `globals.css`.
            data-mode-identity={selectedAppMode.id}
            // Marks the area-only pill (pill 4b) for tests and styles.
            data-area-only={pillShowsAreaOnly ? "" : undefined}
          >
            <span
              // The badge shows at every width (Josh, 7 Oct 2026: the switchers
              // looked bare on phones without the area's image on the left, as the
              // mockup draws it). This reverses the earlier "no badge on phones".
              className="universal-header-mode-badge grid h-8 w-8 place-items-center rounded-full bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)] shadow-[var(--e1)]"
            >
              {/* 16px in the 32px pill, not the 14px metadata step: this is a
                  primary control, and 2.25 keeps its absolute stroke in line
                  with the larger glyphs beside it. */}
              <SelectedAppModeIcon aria-hidden="true" className="size-icon-md" strokeWidth={2.25} />
            </span>
            <span className="min-w-0">
              {!routeWorkArea && currentPathname !== "/" ? (
                <span className="block text-sm font-semibold text-[color:var(--text-heading)]">Modes</span>
              ) : pillPageLine ? (
                // Page first, mode underneath. The order is the point: the big
                // line answers "where am I", which changes, and the small
                // coloured line answers "which mode", which does not. Reversing
                // them puts the constant in the loud slot.
                //
                // The mode line shows at EVERY width, unlike the "Mode" eyebrow
                // it replaces. That eyebrow was a word for the control's kind
                // and could be dropped on a phone without losing anything; this
                // one is the only place the mode is named once the big line
                // stops naming it.
                <>
                  <span className="block truncate text-sm font-semibold leading-5 text-[color:var(--text-heading)]">
                    {pillPageLine.label}
                  </span>
                  <span className="universal-header-mode-area block truncate text-2xs font-semibold uppercase leading-3 tracking-eyebrow text-[color:var(--clinical-accent)]">
                    {pillModeLabel}
                  </span>
                </>
              ) : pillShowsAreaOnly ? (
                // Pill 4b (Josh, 7 Oct 2026): just the area, in the area's colour,
                // in normal lettering, at 600 like every other line of the pill. No "Mode" eyebrow: the coloured name and
                // badge already say what this control is.
                <span
                  data-testid="universal-header-mode-area-only"
                  className="block truncate text-base-minus font-semibold leading-5 text-[color:var(--clinical-accent)]"
                >
                  {pillModeLabel}
                </span>
              ) : (
                <span className="block truncate text-sm font-semibold leading-5 text-[color:var(--text-heading)]">
                  {selectedAppMode.label}
                </span>
              )}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "transition-transform motion-reduce:transition-none",
                // The area-only pill's chevron is smaller and quieter, so the
                // coloured name carries the control.
                pillShowsAreaOnly
                  ? "size-icon-sm text-[color:color-mix(in_srgb,var(--neutral-400)_60%,var(--neutral-500))]"
                  : "size-icon-md text-[color:var(--decoration-soft)]",
                modeMenuOpen && "rotate-180",
              )}
            />
          </button>

          {!usesPhoneSearchLayout && modeMenuOpen && modeSheetView === "sections" ? (
            // The same popover, one level in: this mode's own pages.
            <div
              id="app-mode-menu"
              role="dialog"
              aria-label={`${selectedAppMode.label} pages`}
              className={cn(glassOverlaySurface, modeMenuPopoverShell)}
            >
              <div className="m-1.5 mb-0 flex items-center gap-1.5 rounded-lg border border-[color:var(--border-lux)] bg-[color-mix(in_srgb,var(--surface-inset)_78%,transparent)] px-1.5 py-1 shadow-[var(--shadow-inset)]">
                <button
                  type="button"
                  onClick={returnToModeList}
                  aria-label="Back to all modes"
                  data-testid="app-mode-popover-back"
                  className="grid size-tap shrink-0 place-items-center rounded-md text-[color:var(--text-muted)] transition-colors hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text-heading)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus)]"
                >
                  <ArrowLeft aria-hidden="true" className="size-icon-md" />
                </button>
                <h2 className={cn(modePagesSheetTitleClass, "min-w-0 break-words text-[color:var(--text-heading)]")}>
                  {`${selectedAppMode.label} pages`}
                </h2>
              </div>
              <div className="p-1.5">{renderModeSectionLevel()}</div>
            </div>
          ) : null}

          {!usesPhoneSearchLayout && modeMenuOpen && modeSheetView === "modes" ? (
            <div
              id="app-mode-menu"
              role="dialog"
              aria-label="Choose app mode"
              className={cn(glassOverlaySurface, modeMenuPopoverShell)}
            >
              <div className="p-1.5 pb-0">
                <div className="rounded-lg border border-[color:var(--border-lux)] bg-[color-mix(in_srgb,var(--surface-inset)_78%,transparent)] p-1.5 shadow-[var(--shadow-inset)]">
                  {renderModeMenuSideSwitch("app-mode-options", false)}
                  <div className="mt-1 flex items-baseline justify-between gap-3 px-1">
                    <p
                      id="app-mode-side-hint"
                      className="min-w-0 truncate text-xs font-medium leading-4 text-[color:var(--text-muted)]"
                    >
                      {modeMenuSides.find((entry) => entry.id === modeMenuSide)?.hint}
                    </p>
                    <p
                      role="status"
                      className="nums shrink-0 text-2xs font-semibold tracking-kicker text-[color:var(--text-muted)]"
                    >
                      {`${activeModeMenuOptions.length} in ${modeMenuSides.find((entry) => entry.id === modeMenuSide)?.label ?? "Clinical"}`}
                    </p>
                  </div>
                </div>
              </div>

              <div className="polished-scroll max-h-[min(32rem,calc(100dvh-12rem))] overflow-y-auto px-1.5 pb-1.5 pt-1.5">
                <div id="app-mode-options" role="menu" aria-label="Choose app mode" className="grid gap-1.5">
                  {renderGroupedDesktopModeMenuOptions()}
                </div>
              </div>

              <div
                aria-hidden="true"
                className="flex items-center justify-center gap-3 border-t border-[color:var(--border-lux)] px-3 py-1.5 text-2xs font-medium text-[color:var(--text-muted)]"
              >
                <ModePickerKeyHints />
              </div>
            </div>
          ) : null}
        </div>

        <div
          className={cn(
            "universal-header-trailing relative flex min-w-0 shrink-0 items-center justify-end gap-1.5 justify-self-end sm:gap-2",
            // Search my work measures this column on wide screens: it opens out to its labelled
            // pill only when the pill fits beside the bell, so at large text it stays a round
            // icon instead of running under the mode switcher. Stretched to the column so the
            // measurement is the room there is, not the controls' own width.
            appModeHasWorkSearch(selectedAppMode.id) && "lg:@container/header-trailing lg:justify-self-stretch",
          )}
        >
          {/* The one extension point in this row.
              A page that owns a control belonging in the header portals it here
              through `UniversalHeaderTrailingPortal`; CSS then hides the new-chat
              button beside it, so the region still holds exactly one control and
              the row reads as one system rather than sixteen variants.

              A DOM slot rather than a React prop, and rather than a
              `searchMode === "…"` branch: the shell sits ABOVE the page in the
              tree, so a page cannot hand it a prop, and a branch here is how this
              row grows a second grammar. `PhoneHeaderCollapsePortal` uses the same
              mechanism for the collapse row directly below.

              On Call no longer occupies this slot: its home uses the Needs you
              bell beside Search my work. First Nations still portals an
              ellipsis here. */}
          <div id={universalHeaderTrailingSlotId} className="contents" />
          {/* A mode with no results surface has no conversation to start, so the
              button would open nothing. Gated on that declaration rather than on
              a mode id, for the same reason `modeOwnPages` above is: the next
              chat-less mode inherits the behaviour without editing this file.

              The `:has()` rule in `globals.css` still stands the button down
              whenever a page occupies the trailing slot; this covers the pages of
              a chat-less mode that own their control somewhere else — On Call's
              section pages moved the page menu into their own in-page header, and
              the button reappeared in a mode that has never had a chat. */}
          {appModeHasWorkSearch(selectedAppMode.id) ? null : (
            <ClinicalHeaderBell modeId={selectedAppMode.id} clinical />
          )}
          {modeHasConversation ? (
            <button
              type="button"
              onClick={onNewChat}
              className={cn(
                "universal-header-new-chat universal-header-icon-control inline-flex h-tap w-tap shrink-0 items-center justify-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] transition hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] xl:w-auto xl:px-3 xl:text-xs xl:font-semibold xl:text-[color:var(--text)]",
                !showDesktopNewChat && "md:hidden",
              )}
              aria-label="Start a new chat"
              title="New chat"
            >
              <MessageSquarePlus aria-hidden="true" className="size-icon-lg xl:size-icon-md" />
              <span className="hidden whitespace-nowrap xl:inline">New chat</span>
            </button>
          ) : null}
          {appModeHasWorkSearch(selectedAppMode.id) ? <StaffWorkHeaderControls modeId={selectedAppMode.id} /> : null}
          {/* At large text, work pages let cut-off labels wrap (work-mode.css).
              Favourites is drawn with the work tokens and rows, so it opts in
              too: at 320px with large text its tiles and labels were cut off
              (12 Oct 2026). Clinical reference pages stay untouched. */}
          {appModeHasWorkSearch(selectedAppMode.id) || selectedAppMode.id === "favourites" ? <LargeTextFlag /> : null}
        </div>
      </div>

      {/* Portaled outside the 3-column header grid so a non-portal regression
            cannot steal a grid track and shove trailing actions onto a new row. */}
      {usesPhoneSearchLayout ? (
        <Sheet
          open={modeMenuOpen}
          onClose={dismissModeMenu}
          title={modeSheetView === "sections" ? `${selectedAppMode.label} pages` : "Choose mode"}
          headerLeading={
            // Only at the section level, and it goes UP a level rather than
            // closing: the sheet must not dismiss and drop the reader back on the
            // page they were already looking at.
            modeSheetView === "sections" ? (
              <button
                type="button"
                onClick={returnToModeList}
                aria-label="Back to all modes"
                data-testid="app-mode-sheet-back"
                className="grid size-tap shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] transition-colors duration-[var(--duration-fast)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text-heading)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none"
              >
                <ArrowLeft aria-hidden="true" className="size-icon-lg" />
              </button>
            ) : undefined
          }
          // "Currently <mode>" is for the mode list. One level in, the title
          // already names the mode ("My Day pages"), so saying it twice is noise.
          descriptionContent={
            modeSheetView === "sections" ? undefined : (
              <ModePickerCurrentMode
                modeId={selectedAppMode.id}
                label={selectedAppMode.label}
                icon={SelectedAppModeIcon}
              />
            )
          }
          // Direction B (Josh, 7 Oct 2026): the header is a band in the current
          // mode's colour. Out of flow, so it adds no width beside the title.
          titleAccessory={<ModePickerSheetBand modeId={selectedAppMode.id} icon={SelectedAppModeIcon} />}
          // The Sheet's header-bottom slot bleeds 1rem left but, being a full-basis
          // flex item, stays only as wide as the header's content. So the toggle
          // steps back in on the left and keeps that full width, which lines it up
          // with the title and the close button. The phone smoke test pins it.
          headerBottom={
            modeSheetView === "sections" ? undefined : <div className="ml-4 w-full">{renderModeSideToggle()}</div>
          }
          closeLabel="Close mode menu"
          returnFocusRef={modeButtonRef}
          portal
          mobilePlacement="bottom"
          mobileSize="content"
          mobileHeaderSafeArea="padding"
          testId="app-mode-menu-sheet"
          contentClassName={cn(
            "max-h-[calc(100dvh-0.75rem)] rounded-t-[var(--work-radius-sheet,2rem)] sm:max-w-md sm:rounded-2xl",
            modeSheetView === "sections" ? "bg-[color:var(--surface-lux)]" : "bg-[color:var(--surface-wash)]",
          )}
          bodyClassName={
            modeSheetView === "sections"
              ? "bg-[color:var(--surface-lux)] px-2.5 pb-2 pt-0.5"
              : "bg-[color:var(--surface-wash)] px-4 pb-6 pt-4"
          }
          headerClassName="relative isolate border-b-0 bg-transparent px-4 pb-3.5 pt-1.5"
          titleClassName={
            modeSheetView === "sections"
              ? modePagesSheetTitleClass
              : "text-xl font-bold tracking-[var(--tracking-display)]"
          }
          closeButtonClassName={cn(
            "grid size-tap shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] transition-colors duration-[var(--duration-fast)] hover:text-[color:var(--text-heading)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none",
            modePickerGlassClass,
          )}
        >
          {/* Built only while open: the Sheet draws nothing closed, and this list is
              every mode's row, which the header would otherwise rebuild each time it
              slides away or back on a scroll. */}
          {!modeMenuOpen ? null : modeSheetView === "sections" ? (
            renderModeSectionLevel()
          ) : (
            <div
              ref={phoneModeMenuListRef}
              id="app-mode-menu"
              role="menu"
              aria-label="Choose app mode"
              className="grid gap-4"
            >
              {phoneModeGroupsForSide(modeMenuSide).map((group) => {
                const groupModes = group.modeIds.flatMap((modeId) => {
                  const mode = activeModeMenuOptions.find((candidate) => candidate.id === modeId);
                  return mode ? [mode] : [];
                });
                if (groupModes.length === 0) return null;
                const rows = (
                  <div className={modePickerCardClass}>
                    {groupModes.map((mode) =>
                      renderModeMenuOption(
                        mode,
                        activeModeMenuOptions.findIndex((candidate) => candidate.id === mode.id),
                      ),
                    )}
                  </div>
                );
                // Work is one list, and the toggle already names it (#3351).
                if (!group.showHeading) {
                  return (
                    <div key={group.id} data-mode-group={group.id}>
                      {rows}
                    </div>
                  );
                }
                const headingId = `app-mode-group-${group.id}`;
                return (
                  <section key={group.id} role="group" aria-labelledby={headingId} data-mode-group={group.id}>
                    <div className="flex min-w-0 items-baseline gap-2 px-1 pb-2">
                      <h3 id={headingId} className="shrink-0 text-sm font-bold text-[color:var(--text-heading)]">
                        {group.label}
                      </h3>
                      <p className="min-w-0 truncate text-xs text-[color:var(--text-muted)]">{group.hint}</p>
                    </div>
                    {rows}
                  </section>
                );
              })}
            </div>
          )}
        </Sheet>
      ) : null}
    </header>
  );

  const portalPlacement = desktopHomeComposerSlotId ? "desktop-home" : "desktop-page";
  const homePortalPending =
    Boolean(desktopHomeComposerSlotId) && homeComposerMediaEligible && !desktopComposerPortalFallback;
  const portalPending = homePortalPending;
  const searchComposer = searchComposerVisible ? (
    <>
      {/* ModeHomeTemplate and desktop page slots reserve their settled geometry
          in SSR, so a temporary header fallback would make the stack grow and
          shift all main content when the portal attaches (CLS 0.118 on desktop
          /documents/search). Mode home routes suppress the header fallback entirely
          because the hero slot in the page body reserves geometry during SSR;
          generic page slots keep the phone fallback rendered during SSR and
          unknown media state while applying sm:hidden so the desktop fallback
          never renders over the reserved page slot. A failed adoption restores
          the header fallback after the bounded retry window above. */}
      {desktopComposerPortalActive && desktopComposerPortalHost
        ? null
        : portalPending
          ? null
          : renderSearchComposer("default")}
      {desktopComposerPortalActive && desktopComposerPortalHost
        ? createPortal(renderSearchComposer(portalPlacement), desktopComposerPortalHost)
        : null}
    </>
  ) : null;

  if (hideStrategy === "collapse") {
    // Collapse hide-on-scroll applies to the TOP BAR only (mode / new chat). The
    // search composer stays a sibling so tablet/desktop keep a usable search
    // field while the top bar hides. A 1fr -> 0fr grid row animates the collapse
    // without height measurement; the bottom-anchored inner track slides the
    // top bar up out of the viewport. Phone footer layers escape its geometry:
    // viewport-fixed in browser tabs, shell-absolute in standalone; hero
    // composers portal out.
    //
    // Above the phone breakpoint a `wide: "sticky"` host scrolls the document,
    // so an outer sticky stack pins its chrome below the wide safe-area spacer.
    // Tablet and desktop result search portal into page flow, so the stack
    // contains only the top bar there. The host
    // ancestor uses `display: contents`, allowing this semantic sticky owner to
    // travel against the browser viewport and become static in standalone.
    const collapsingTopBar = (
      <div
        data-scroll-hidden={headerChromeHidden ? "true" : undefined}
        // `data-scroll-hidden` is `scrollHidden && !sharedChromePinned`, so its absence has
        // two causes a test cannot separate: this header's own scroll signal never arrived,
        // or it did and a pin held the chrome open. Publishing the raw signal makes that
        // observable. Nothing styles this attribute; it exists so a failing assertion can
        // name its cause. The page-owned document composer is NOT a proxy for it —
        // DocumentViewer runs its own reporters (use-document-viewer-chrome-scroll) while
        // this header is driven by the shell's separate one (global-search-shell.tsx
        // `chromeScrollHide`), and the two can legitimately disagree, notably where an
        // inner scroller moves but `window.scrollY` does not, which the shell's
        // document-only feed cannot see.
        data-scroll-signal={scrollHidden ? "hidden" : "visible"}
        data-phone-motion={phoneMotion}
        data-testid="universal-header-collapse"
        className={cn(
          "motion-reduce:transition-none",
          collapsesAtEveryWidth || sticksAbovePhones
            ? cn(
                phoneOverlayMotion
                  ? "sm:grid sm:transition-[grid-template-rows]"
                  : "grid transition-[grid-template-rows]",
                headerChromeHidden
                  ? phoneOverlayMotion
                    ? "sm:duration-[var(--duration-slow)] sm:ease-[var(--ease-chrome-hide)]"
                    : "duration-[var(--duration-slow)] ease-[var(--ease-chrome-hide)]"
                  : phoneOverlayMotion
                    ? "sm:duration-[var(--duration-moderate)] sm:ease-[var(--ease-chrome-reveal)]"
                    : "duration-[var(--duration-moderate)] ease-[var(--ease-chrome-reveal)]",
                headerChromeHidden
                  ? phoneOverlayMotion
                    ? "sm:[grid-template-rows:0fr]"
                    : "[grid-template-rows:0fr]"
                  : phoneOverlayMotion
                    ? "sm:[grid-template-rows:1fr]"
                    : "[grid-template-rows:1fr]",
              )
            : cn(
                "max-sm:grid max-sm:transition-[grid-template-rows]",
                headerChromeHidden
                  ? "max-sm:duration-[var(--duration-slow)] max-sm:ease-[var(--ease-chrome-hide)]"
                  : "max-sm:duration-[var(--duration-moderate)] max-sm:ease-[var(--ease-chrome-reveal)]",
                headerChromeHidden ? "max-sm:[grid-template-rows:0fr]" : "max-sm:[grid-template-rows:1fr]",
              ),
        )}
        {...chromeFocusProps}
      >
        <div
          className={cn(
            "w-full min-w-0 max-w-full max-sm:flex max-sm:min-h-0 max-sm:flex-col max-sm:justify-end",
            (collapsesAtEveryWidth || sticksAbovePhones) && "sm:flex sm:min-h-0 sm:flex-col sm:justify-end",
            // Clip only while hiding so the edge-glass-header gradient that
            // extends below the header keeps painting when the chrome is shown.
            !phoneOverlayMotion && headerChromeHidden && "max-sm:overflow-hidden",
            (collapsesAtEveryWidth || sticksAbovePhones) && headerChromeHidden && "sm:overflow-hidden",
          )}
        >
          {topBar}
          <div
            ref={setPhoneHeaderCollapseAddonRef}
            id={phoneHeaderCollapseAddonSlotId}
            data-testid="header-collapse-addon"
            className="w-full min-w-0 max-w-full empty:hidden"
          />
        </div>
      </div>
    );

    const chromeSafeAreaTop = (
      <div
        aria-hidden="true"
        data-testid="chrome-safe-area-top"
        // Tinted with the top bar from the first paint on a framed work page.
        data-work-band={routeWorkFramed ? "" : undefined}
        data-mode-identity={routeWorkFrame?.area.identity}
        className={cn(
          // Visible phone chrome owns the OS inset. Hidden phone chrome must
          // release it so the scroll surface reaches the physical viewport
          // edge instead of leaving an opaque status-bar band. Match the
          // header row's timing to avoid a one-frame gap during hide/reveal.
          // sm+ keeps its pinned inset because sticky top-bar chrome is a
          // separate wide-layout contract from page-flow search.
          //
          // Paint the header's own surface, not the page background. While the
          // spacer is visible it is the top of the header, so `--background`
          // drew a page-coloured status-bar band above a `--surface` bar on
          // every collapse-strategy mode — the seam answer mode never had,
          // because its overlay header pads the inset itself and paints
          // straight through. Opaque on purpose: the spacer must keep hiding
          // scrolled content at the sm+ pinned inset.
          "relative z-40 shrink-0 bg-[color:var(--surface)] motion-reduce:transition-none sm:h-[var(--safe-area-top)]",
          phoneOverlayMotion
            ? "max-sm:h-[var(--safe-area-top)]"
            : cn(
                "max-sm:transition-[height]",
                headerChromeHidden
                  ? "max-sm:h-0 max-sm:duration-[var(--duration-slow)] max-sm:ease-[var(--ease-chrome-hide)]"
                  : "max-sm:h-[var(--safe-area-top)] max-sm:duration-[var(--duration-moderate)] max-sm:ease-[var(--ease-chrome-reveal)]",
              ),
          sticksAbovePhones && "sm:sticky sm:top-0",
        )}
      />
    );

    if (sticksAbovePhones) {
      return (
        <div
          data-phone-motion={phoneMotion}
          data-scroll-hidden={phoneOverlayMotion && headerChromeHidden ? "true" : undefined}
          className={cn(
            "phone-sticky-header-stack sm:contents",
            phoneOverlayMotion &&
              "phone-overlay-header max-sm:transition-[transform,translate,opacity] motion-reduce:max-sm:transition-none",
            phoneOverlayMotion &&
              (headerChromeHidden
                ? "max-sm:pointer-events-none max-sm:-translate-y-full max-sm:opacity-0 max-sm:duration-[var(--duration-slow)] max-sm:ease-[var(--ease-chrome-hide)]"
                : "max-sm:opacity-100 max-sm:duration-[var(--duration-moderate)] max-sm:ease-[var(--ease-chrome-reveal)]"),
          )}
        >
          {chromeSafeAreaTop}
          <div className="sm:sticky sm:top-[var(--safe-area-top)] sm:z-30">
            {collapsingTopBar}
            {/*
              The overlay hide translates this stack, and a non-none `transform`
              makes an element a containing block for `position: fixed`
              descendants. A phone bottom dock left in this subtree therefore
              resolves `bottom: 0` against the ~72px header instead of the
              viewport, landing near the top of the screen. Portal it to the
              frame footer host on phones — the mechanism invariant 21 already
              requires of every phone footer — while `sm+` keeps it inline in
              this sticky stack; result composers have already portaled into
              page flow at tablet and desktop widths.
            */}
            {phoneOverlayMotion && usesPhoneBottomDock ? (
              <PhoneFooterLayerPortal>{searchComposer}</PhoneFooterLayerPortal>
            ) : (
              searchComposer
            )}
          </div>
        </div>
      );
    }

    // `collapsesAtEveryWidth` hosts (ClinicalDashboard's non-answer modes) take
    // the same phone overlay treatment as the sticky stack above: the phone
    // stack leaves flow and translates, so hiding costs the scroller no layout.
    // The wide layout is untouched — `sm:contents` still hands the top bar and
    // composer to the host's own column, and the collapse grid keeps its `sm:`
    // 1fr -> 0fr release.
    return (
      <div
        data-phone-motion={phoneMotion}
        data-scroll-hidden={phoneOverlayMotion && headerChromeHidden ? "true" : undefined}
        className={cn(
          "phone-sticky-header-stack sm:contents",
          phoneOverlayMotion &&
            "phone-overlay-header max-sm:transition-[transform,translate,opacity] motion-reduce:max-sm:transition-none",
          phoneOverlayMotion &&
            (headerChromeHidden
              ? "max-sm:pointer-events-none max-sm:-translate-y-full max-sm:opacity-0 max-sm:duration-[var(--duration-slow)] max-sm:ease-[var(--ease-chrome-hide)]"
              : "max-sm:opacity-100 max-sm:duration-[var(--duration-moderate)] max-sm:ease-[var(--ease-chrome-reveal)]"),
        )}
      >
        {chromeSafeAreaTop}
        {collapsingTopBar}
        {/*
          Same containing-block trap as the sticky stack: the hidden state's
          transform would make this element the containing block for a fixed
          phone dock, resolving its `bottom: 0` against the header instead of
          the viewport. Portal the dock to the frame footer host on phones;
          `sm+` keeps it inline for the host's own column.
        */}
        {phoneOverlayMotion && usesPhoneBottomDock ? (
          <PhoneFooterLayerPortal>{searchComposer}</PhoneFooterLayerPortal>
        ) : (
          searchComposer
        )}
      </div>
    );
  }

  return (
    <>
      {topBar}
      {searchComposer}
    </>
  );
}
