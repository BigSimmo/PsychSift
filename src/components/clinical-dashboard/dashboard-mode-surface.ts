/**
 * Pure mode-surface helpers extracted from ClinicalDashboard.tsx so the
 * dashboard stays under its maintainability no-growth budget. Behaviour is
 * unchanged — these are verbatim moves of the bottom-nav item builder and the
 * composer / also-matches / phone-reserve visibility decisions.
 */
import { FileImage, FileText, Heart, Quote, Search, Wrench, type LucideIcon } from "lucide-react";

import {
  mobileComposerIdleReserve,
  resolveDashboardVisibleMobileComposerReserve,
  resolveMobileComposerReserve,
} from "@/components/clinical-dashboard/mobile-composer-reserve";
import { shouldShowSharedHome } from "@/components/clinical-dashboard/clinical-dashboard-helpers";
import { shouldShowDashboardDegradedNotice } from "@/components/clinical-dashboard/document-manager-contracts";
import { desktopPageComposerSlotId, modeHomeDesktopComposerSlotId } from "@/lib/mode-home-composer";
import type { AppModeId, AppModeResultKind } from "@/lib/app-modes";
import { navigationHashes } from "@/components/clinical-dashboard/dashboard-contracts";

export type DashboardBottomNavItem = {
  label: string;
  description: string;
  icon: LucideIcon;
  href: (typeof navigationHashes)[number];
  count: number | null;
  empty?: boolean;
};

export function buildDashboardBottomNavItems({
  activeModeResultKind,
  activeModeSearch,
  answer,
  documentMatchCount,
  query,
  quoteCount,
  reviewSourceCount,
  toolCatalogCount,
  visualEvidenceCount,
  weakEvidence,
}: {
  activeModeResultKind: AppModeResultKind;
  activeModeSearch: { statusLabel: string; nextStep: string; readyTitle: string };
  answer: unknown;
  documentMatchCount: number;
  query: string;
  quoteCount: number;
  reviewSourceCount: number;
  toolCatalogCount: number;
  visualEvidenceCount: number;
  weakEvidence: boolean;
}): readonly DashboardBottomNavItem[] {
  return [
    {
      label: activeModeSearch.statusLabel,
      description:
        activeModeResultKind === "tools"
          ? query.trim()
            ? "Filtered tools"
            : "Browse tools"
          : activeModeResultKind === "favourites"
            ? query.trim()
              ? "Filtered favourites"
              : "Browse favourites"
            : activeModeResultKind === "answer"
              ? answer
                ? weakEvidence
                  ? "Read synthesis carefully"
                  : "Clinical synthesis"
                : activeModeSearch.nextStep
              : documentMatchCount
                ? "Document results"
                : activeModeSearch.readyTitle,
      icon:
        activeModeResultKind === "tools"
          ? Wrench
          : activeModeResultKind === "favourites"
            ? Heart
            : activeModeResultKind === "answer"
              ? Search
              : FileText,
      href: "#search",
      count:
        activeModeResultKind === "tools"
          ? toolCatalogCount
          : activeModeResultKind === "favourites"
            ? null
            : activeModeResultKind === "documents"
              ? documentMatchCount
              : null,
      empty: activeModeResultKind === "documents" && documentMatchCount === 0,
    },
    {
      label: "Quotes",
      description: answer ? (quoteCount ? "Exact source excerpts" : "No quotes yet") : "No quotes yet",
      icon: Quote,
      href: "#quotes",
      count: answer ? quoteCount : null,
      empty: !answer || quoteCount === 0,
    },
    {
      label: "Images",
      description: answer ? (visualEvidenceCount ? "Tables and diagrams" : "No images yet") : "No images yet",
      icon: FileImage,
      href: "#images",
      count: answer ? visualEvidenceCount : null,
      empty: !answer || visualEvidenceCount === 0,
    },
    {
      label: "Sources",
      description: answer ? (reviewSourceCount ? "Passages and documents" : "No sources yet") : "No sources yet",
      icon: FileText,
      href: "#sources",
      count: answer ? reviewSourceCount : null,
      empty: !answer || reviewSourceCount === 0,
    },
  ] as const;
}

export type DashboardModeSurfaceInput = {
  activeModeResultKind: AppModeResultKind;
  answer: unknown;
  answerFollowUpSuggestionCount: number;
  /** Differentials has a diagnosis ticked; the compare dock claims its band only then. */
  differentialsCompareHasSelection?: boolean;
  answerLifecycleStatus: string;
  answerProgressCompleted: boolean;
  answerProgressEventCount: number;
  apiUnavailable: boolean;
  bottomComposerHidden: boolean;
  canRunSearch: boolean;
  documentMatchCount: number;
  error: unknown;
  favouritesAccessible: boolean;
  isOnline: boolean;
  latestAnswerQuery: string | null | undefined;
  loading: boolean;
  modeSearchSubmitted: boolean;
  pathname: string;
  query: string;
  searchMode: AppModeId;
  startNewChat: () => void;
  focusComposerInput: () => void;
  submittedModeQuery: string | null | undefined;
  submittedUrlMode: string | null;
  submittedUrlQuery: string | null | undefined;
  submittedUrlRunRequested: boolean;
};

export type DashboardModeSurface = {
  showAuthPanel: boolean;
  showDegradedNotice: boolean;
  submittedAnswerSearchActive: boolean;
  showSharedHome: boolean;
  showAnswerCancelledNotice: boolean;
  showAnswerPending: boolean;
  showAnswerProgress: boolean;
  universalAlsoMatchesQuery: string;
  showUniversalAlsoMatches: boolean;
  toolsDirectoryWithoutComposer: boolean;
  showDesktopHomeComposer: boolean;
  desktopHomeComposerSlotId: string | undefined;
  desktopResultComposerSlotId: string | undefined;
  heroComposerBreakpoint: "all" | "sm-up";
  heroOwnsPhoneComposer: boolean;
  hasMobileBottomSearch: boolean;
  openSidebarSearch: () => void;
  centeredModeHome: boolean;
  compactMobileModeHome: boolean;
  differentialsCompareAddonActive: boolean;
  patientDetailsAddonActive: boolean;
  mobileComposerReserve: string;
};

/**
 * Derive the dashboard's shared-home / composer / also-matches surface flags.
 * Comments that document ownership (prescribing also-matches, tools composer,
 * cancel-vs-pending) travel with the logic so they stay next to the decisions.
 */
export function resolveDashboardModeSurface(input: DashboardModeSurfaceInput): DashboardModeSurface {
  const {
    activeModeResultKind,
    answer,
    answerFollowUpSuggestionCount,
    answerLifecycleStatus,
    answerProgressCompleted,
    answerProgressEventCount,
    apiUnavailable,
    bottomComposerHidden,
    canRunSearch,
    documentMatchCount,
    error,
    favouritesAccessible,
    focusComposerInput,
    isOnline,
    latestAnswerQuery,
    loading,
    modeSearchSubmitted,
    pathname,
    query,
    searchMode,
    startNewChat,
    submittedModeQuery,
    submittedUrlQuery,
    submittedUrlRunRequested,
  } = input;

  const showAuthPanel = false;
  const showDegradedNotice = shouldShowDashboardDegradedNotice({ isOnline, apiUnavailable, canRunSearch });
  const submittedAnswerSearchActive =
    activeModeResultKind === "answer" && !answer && canRunSearch && (modeSearchSubmitted || Boolean(submittedUrlQuery));
  const showSharedHome = shouldShowSharedHome({
    pathname,
    mode: input.submittedUrlMode,
    submittedUrlRunRequested,
    hasError: Boolean(error),
    hasAnswer: Boolean(answer),
    loading,
    submittedAnswerSearchActive,
  });
  // A stopped generation reports on the last action rather than describing the
  // page, so the notice renders at the top of the content column while this same
  // condition still short-circuits the mode-home empty-state chain below.
  const showAnswerCancelledNotice = answerLifecycleStatus === "cancelled" && activeModeResultKind === "answer";
  // `submittedAnswerSearchActive` stays true after the reader presses Stop, and a
  // cancel is not an `error`, so without the cancelled guard the pending branch
  // held its skeleton on screen indefinitely — a shimmering placeholder promising
  // an answer that was already abandoned, directly beneath the notice saying so.
  const showAnswerPending =
    activeModeResultKind === "answer" &&
    !answer &&
    !showAnswerCancelledNotice &&
    (loading || (submittedAnswerSearchActive && !error));
  const showAnswerProgress =
    activeModeResultKind === "answer" &&
    answerProgressEventCount > 0 &&
    (loading || (Boolean(answer) && answerProgressCompleted));
  // Answer mode already keyed off the generated answer's query. Every other mode keys off
  // the submitted query for the same reason: typing without pressing Enter must not fetch
  // cross-mode matches for the draft, nor replace the tray and its count with results the
  // primary cards do not share. Tools and Favourites never record a submission, so they
  // fall through to `query`, which is the only query they have.
  const universalAlsoMatchesQuery =
    activeModeResultKind === "answer" ? (latestAnswerQuery ?? query) : (submittedModeQuery ?? query);
  // Answer-mode also-matches wait for a completed generation (`answer && !loading`)
  // so the panel never sits under the drafting skeleton/stepper. Tools/Favourites
  // still mount on submission. Follow-ups hide the panel while loading so stale
  // matches for the prior query do not compete with the new Drafting stepper.
  const showUniversalAlsoMatches =
    !showSharedHome &&
    // Prescribing declares `resultKind: "documents"` on purpose (it searches the
    // indexed sources, not a forms table), so the documents arm below matches it
    // and this dashboard would mount a SECOND panel over the one
    // MedicationPrescribingWorkspace already renders under the medication list.
    // The workspace owns the mount, because only it knows where the result list
    // ends; the mode is named here rather than the result kind, because the kind
    // is shared and the ownership is not. `tests/ui-stress.spec.ts` pins the count
    // at one on `/?mode=prescribing`, which is how the duplicate was caught.
    searchMode !== "prescribing" &&
    Boolean(universalAlsoMatchesQuery.trim()) &&
    (activeModeResultKind === "tools" ||
      activeModeResultKind === "favourites" ||
      (activeModeResultKind === "answer" && Boolean(answer) && !loading) ||
      ((activeModeResultKind === "documents" ||
        activeModeResultKind === "services" ||
        activeModeResultKind === "forms") &&
        modeSearchSubmitted));
  // `/tools` owns the tools catalogue and stays composer-free, so a dashboard
  // path reaching the tools result kind must not mount a second ownership model
  // (hero/page/dock) behind it. Modes that only borrow the `tools` result kind
  // remain on the shared home and are intentionally exempt.
  const toolsDirectoryWithoutComposer = activeModeResultKind === "tools" && !showSharedHome;
  const showDesktopHomeComposer =
    !error &&
    (showSharedHome ||
      (!toolsDirectoryWithoutComposer && activeModeResultKind === "tools") ||
      (activeModeResultKind === "favourites" && favouritesAccessible) ||
      (!loading &&
        ((searchMode === "documents" &&
          activeModeResultKind === "documents" &&
          documentMatchCount === 0 &&
          !modeSearchSubmitted) ||
          // Prescribing keeps MedicationHome (and the hero/phone composer) until
          // an explicit submit — draft keystrokes must not flip to results/dock.
          (searchMode === "prescribing" && activeModeResultKind === "documents" && !modeSearchSubmitted) ||
          // Empty unsubmitted differentials visits 307 to the shared home;
          // keep the hero slot only while that idle dashboard branch mounts.
          (activeModeResultKind === "differentials" &&
            !modeSearchSubmitted &&
            !(query.trim() && documentMatchCount > 0)))));
  const desktopHomeComposerSlotId = showDesktopHomeComposer ? modeHomeDesktopComposerSlotId : undefined;
  const desktopResultComposerSlotId =
    !desktopHomeComposerSlotId && searchMode !== "answer" && !toolsDirectoryWithoutComposer
      ? desktopPageComposerSlotId
      : undefined;
  // Most mounted mode homes keep the in-flow hero pill on phones. The Tools
  // directory has no composer at any breakpoint. Modes borrowing `kind:
  // "tools"` (Factsheets, Dictionary, Therapy Compass) opt back in via
  // `showSharedHome`.
  const heroComposerBreakpoint: "all" | "sm-up" =
    showDesktopHomeComposer && (showSharedHome || activeModeResultKind !== "tools") ? "all" : "sm-up";
  const heroOwnsPhoneComposer = Boolean(desktopHomeComposerSlotId) && heroComposerBreakpoint === "all";
  const hasMobileBottomSearch = searchMode !== "answer" && !heroOwnsPhoneComposer && !toolsDirectoryWithoutComposer;
  // Tools owns its local catalogue controls, so the sidebar's cross-guide
  // search action must leave the directory before trying to focus a shared
  // composer that is intentionally absent.
  const openSidebarSearch = toolsDirectoryWithoutComposer ? startNewChat : focusComposerInput;
  // Favourites and Tools are content-rich hubs that stay top-aligned; the shared
  // home mounts neither, so it centres like every other mode.
  const centeredModeHome =
    showDesktopHomeComposer &&
    (showSharedHome || (activeModeResultKind !== "tools" && activeModeResultKind !== "favourites"));
  // Short mode homes (centred homes plus the services/forms registry homes)
  // drop the large mobile bottom padding so phones don't get a scrollbar for
  // content that already fits. Result views keep the full clearance.
  const compactMobileModeHome =
    centeredModeHome ||
    ((searchMode === "services" || searchMode === "forms") && !modeSearchSubmitted && !query.trim() && !loading);
  const differentialsCompareAddonActive =
    searchMode === "differentials" &&
    modeSearchSubmitted &&
    Boolean(query.trim()) &&
    input.differentialsCompareHasSelection !== false;
  // Prescribing submitted searches render here (there is no standalone results
  // route), so this is where the Patient details pill docks for that mode.
  const patientDetailsAddonActive = searchMode === "prescribing" && modeSearchSubmitted && Boolean(query.trim());
  // Hidden dock pad must stay at 0rem — Safari toolbar safe-area recreates a blank band.
  const mobileComposerReserve = resolveMobileComposerReserve(
    bottomComposerHidden,
    toolsDirectoryWithoutComposer
      ? mobileComposerIdleReserve
      : resolveDashboardVisibleMobileComposerReserve({
          searchMode,
          hasAnswerFollowUps: answerFollowUpSuggestionCount > 0,
          differentialsCompareAddonActive,
          patientDetailsAddonActive,
          heroOwnsPhoneComposer,
        }),
  );

  return {
    showAuthPanel,
    showDegradedNotice,
    submittedAnswerSearchActive,
    showSharedHome,
    showAnswerCancelledNotice,
    showAnswerPending,
    showAnswerProgress,
    universalAlsoMatchesQuery,
    showUniversalAlsoMatches,
    toolsDirectoryWithoutComposer,
    showDesktopHomeComposer,
    desktopHomeComposerSlotId,
    desktopResultComposerSlotId,
    heroComposerBreakpoint,
    heroOwnsPhoneComposer,
    hasMobileBottomSearch,
    openSidebarSearch,
    centeredModeHome,
    compactMobileModeHome,
    differentialsCompareAddonActive,
    patientDetailsAddonActive,
    mobileComposerReserve,
  };
}
