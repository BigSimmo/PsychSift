import type { RefObject } from "react";
import type { AppModeId } from "@/lib/app-modes";
import type { PhoneDockAddonKind } from "@/lib/mode-home-composer";
import type { SearchScopeFilters } from "@/lib/search-scope";
import type { ClinicalDocument, ClinicalQueryMode } from "@/lib/types";

// Shared between the composer input's aria-describedby and the rendered
// PrivacyInputNotice id/testId so the wiring cannot drift apart.
export const composerPrivacyWarningId = "answer-composer-privacy-warning";

export const phoneSearchLayoutMediaQuery = "(max-width: 639px)";
export const scopeSheetMediaQuery = "(max-width: 1023px)";
export const desktopPageComposerMediaQuery = "(min-width: 640px)";
export const modeHomeComposerMediaQuery = "(min-width: 0px)";
export const modeHomeComposerSmUpMediaQuery = "(min-width: 640px)";

export type MasterSearchHeaderScrollConfig = {
  strategy: "overlay" | "collapse";
  /**
   * Phone-only motion for collapse-strategy hosts. "collapse" releases the
   * row's layout height; "overlay" keeps the complete phone stack stable and
   * translates it over page content. Defaults to "collapse".
   */
  phoneMotion?: "collapse" | "overlay";
  /**
   * Overlay-only: apply the hide/reveal (and the out-of-flow absolute header)
   * at every breakpoint instead of phones only. The host must reserve
   * matching top padding on its scroll container.
   */
  allBreakpoints?: boolean;
  /**
   * Collapse-only: how the chrome hides above the phone breakpoint. Omitting
   * it keeps the hide/reveal phone-only.
   */
  wide?: "collapse" | "sticky";
  /** Parent-owned hidden state for hosts that report scroll via React `onScroll`. */
  scrollHidden?: boolean;
};

export type MasterSearchHeaderState = {
  demoMode: boolean;
  documents: ClinicalDocument[];
  documentTotal?: number;
  query: string;
  searchMode: AppModeId;
  loading: boolean;
  selectedDocumentIds: string[];
  queryMode: ClinicalQueryMode;
  scopeFilters: SearchScopeFilters;
  realDataReady: boolean;
  queryModeOptions: Array<{ value: ClinicalQueryMode; label: string }>;
  queryInputRef?: RefObject<HTMLInputElement | null>;
  queryInputAutoFocus?: boolean;
  /** Overrides the mode's default input placeholder (e.g. "Ask a follow-up..." mid-thread). */
  composerPlaceholder?: string;
  recentQueries?: string[];
  composerFollowUpSuggestions?: string[];
  composerFollowUpSuggestionsDisabled?: boolean;
  canAccessFavourites?: boolean;
  canManageDocuments?: boolean;
};

export type MasterSearchHeaderActions = {
  onQueryChange: (query: string) => void;
  onSearchModeChange: (mode: AppModeId) => void;
  onAsk: (query?: string) => void;
  onClearQuery: () => void;
  onClearScope: () => void;
  onQueryModeChange: (mode: ClinicalQueryMode) => void;
  onScopeFiltersChange: (filters: SearchScopeFilters) => void;
  onToggleScope: (documentId: string) => void;
  onScopeOpenChange?: (open: boolean) => void;
  onOpenEvidence?: () => void;
  onOpenRecentDocuments?: () => void;
  onOpenLibrary?: () => void;
  /** Opens the administrator document/indexing surface. Paired with `canManageDocuments`. */
  onOpenDocumentAdmin?: () => void;
  /** Gates the administrator-only rows in the mode action list. Defaults to hidden. */
  canManageDocuments?: boolean;
  onOpenSourcePdf?: () => void;
  onNewChat?: () => void;
  onOpenMobileSidebar?: () => void;
  onPickRecent?: (query: string) => void;
  onCrossModeSearch?: (modeId: AppModeId, query: string) => void;
  onPickComposerFollowUpSuggestion?: (suggestion: string) => void;
  /** Invoked when the user tries to open Favourites without access. */
  onRequestAccountSetup?: () => void;
  /** Notify hosts when the phone bottom composer is actually hidden (not merely scrolled). */
  onBottomComposerHiddenChange?: (hidden: boolean) => void;
};

export type MasterSearchHeaderMobileControls = {
  /** Keep the product identity stable while `/` retargets between modes. */
  sharedHomeIdentity?: boolean;
  mobileSearchPlacement?: "default" | "bottom";
  /** "compact" drops the phone footer chip row and hugs the bottom edge so
   *  content keeps maximum screen space. Every phone dock uses it now; the
   *  "default" value remains for hosts that need the taller legacy dock. */
  mobileBottomSearchVariant?: "default" | "compact";
  /** Which placement the home hero vs footer uses on phones. Tools uses "footer"
   *  so its search pill sits in the bottom dock like a submitted search while
   *  retaining the home privacy notice. */
  mobileHomeComposerPlacement?: "hero" | "footer";
  /** Show the compact phone suggestion ticker only for standalone-mode homes. */
  showPhoneSuggestionTickerOnHome?: boolean;
  desktopSearchPlacement?: "default" | "hero";
  searchComposerVisible?: boolean;
  /** Mode-home slot the composer portals into so the search pill sits in the
   *  middle of the hero instead of docking to the bottom edge. Which widths the
   *  hero owns is controlled by `heroComposerBreakpoint`. */
  desktopHomeComposerSlotId?: string;
  /** Normal-flow page slot used by submitted/search views from tablet widths up.
   * Phones keep the bottom dock. */
  desktopPageComposerSlotId?: string;
  /** Widths where the mode-home hero slot hosts the composer. "all" keeps the
   *  hero pill on phones too (the answer home); "sm-up" reserves the hero for
   *  sm+ widths and hands phones the compact bottom dock instead. */
  heroComposerBreakpoint?: "all" | "sm-up";
  /** Mobile/tablet slot rendered above the search pill for page-specific composer addons. */
  mobileBottomSearchAddonSlotId?: string;
  /** Which page-owned action occupies the dock addon slot. One at a time. */
  mobileBottomSearchAddonKind?: PhoneDockAddonKind;
  /** Phone-only hide-on-scroll for the universal header and bottom search dock. */
  hideOnScroll?: MasterSearchHeaderScrollConfig;
  /** Keep the phone new-chat action, but hide its desktop copy when a visible sidebar already owns the action. */
  showDesktopNewChat?: boolean;
  /** Notify hosts when the phone bottom composer is actually hidden (not merely scrolled). */
  onBottomComposerHiddenChange?: (hidden: boolean) => void;
};

export type MasterSearchHeaderProps = (
  | {
      searchState: MasterSearchHeaderState;
      headerActions: MasterSearchHeaderActions;
      mobileControls?: MasterSearchHeaderMobileControls;
    }
  | (MasterSearchHeaderState & MasterSearchHeaderActions & MasterSearchHeaderMobileControls)
) &
  Partial<MasterSearchHeaderState & MasterSearchHeaderActions & MasterSearchHeaderMobileControls> & {
    searchState?: Partial<MasterSearchHeaderState>;
    headerActions?: Partial<MasterSearchHeaderActions>;
    mobileControls?: Partial<MasterSearchHeaderMobileControls>;
  };

export const DEFAULT_DOCUMENTS: ClinicalDocument[] = [];
export const DEFAULT_SELECTED_DOCUMENT_IDS: string[] = [];
export const DEFAULT_QUERY_MODE_OPTIONS: Array<{ value: ClinicalQueryMode; label: string }> = [];
export const DEFAULT_RECENT_QUERIES: string[] = [];
export const DEFAULT_SCOPE_FILTERS: SearchScopeFilters = {};
export const NOOP_HANDLER = () => {};
