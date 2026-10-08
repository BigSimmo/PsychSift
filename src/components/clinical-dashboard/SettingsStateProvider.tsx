import * as React from "react";
import { useSidebarCollapsed } from "./use-sidebar-collapsed";
import { DocumentDrawerMode } from "./dashboard-contracts";
import type { IndexingAdministrationTab } from "./document-admin";

type SettingsStateContextType = {
  guideOpen: boolean;
  setGuideOpen: React.Dispatch<React.SetStateAction<boolean>>;
  settingsOpen: boolean;
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (next: boolean) => void;
  documentsDrawerOpen: boolean;
  setDocumentsDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  documentScopeOpen: boolean;
  setDocumentScopeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  documentsDrawerMode: DocumentDrawerMode;
  setDocumentsDrawerMode: React.Dispatch<React.SetStateAction<DocumentDrawerMode>>;
  indexingAdminDrawerOpen: boolean;
  setIndexingAdminDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  indexingAdminMobileTab: IndexingAdministrationTab;
  setIndexingAdminMobileTab: React.Dispatch<React.SetStateAction<IndexingAdministrationTab>>;
};

const SettingsStateContext = React.createContext<SettingsStateContextType | null>(null);

/**
 * The one query parameter that opens a dialog: `/?settings=open`.
 *
 * It exists so `/settings` has somewhere to land. That path used to 404 -- settings is a dialog
 * held in React state with no address of its own, so a bookmark, a support instruction ("open
 * Settings and turn that off") or a typed URL got a not-found page. Redirecting it to the home
 * page alone would have been a 404 with extra steps: you arrive somewhere that looks fine and
 * still have to find what you came for.
 */
const SETTINGS_OPEN_PARAM = "settings";
const SETTINGS_OPEN_VALUE = "open";

/**
 * Read once per page load, and latched.
 *
 * `useSyncExternalStore` rather than an effect that calls `setSettingsOpen`, which is what
 * `react-hooks/set-state-in-effect` correctly rejects and what `useSidebarCollapsed` in this same
 * provider already avoids the same way. The snapshot must be stable across renders or React loops,
 * hence the latch -- and the latch is also what lets the parameter be stripped from the URL
 * without the dialog closing again a moment later.
 */
let settingsParamRead = false;
let settingsParamOpen = false;

function settingsParamSnapshot(): boolean {
  if (settingsParamRead) return settingsParamOpen;
  settingsParamRead = true;
  try {
    settingsParamOpen = new URLSearchParams(window.location.search).get(SETTINGS_OPEN_PARAM) === SETTINGS_OPEN_VALUE;
  } catch {
    // A malformed query string is not a reason to fail the whole shell.
    settingsParamOpen = false;
  }
  return settingsParamOpen;
}

/** The server has no URL to read and must not paint the dialog. */
function settingsParamServerSnapshot(): boolean {
  return false;
}

/** Nothing changes it after the first read, so there is nothing to subscribe to. */
function subscribeToSettingsParam(): () => void {
  return () => {};
}

/** Test seam: the latch is module-scoped, so a suite rendering several URLs must be able to clear it. */
export function __resetSettingsParamForTests(): void {
  settingsParamRead = false;
  settingsParamOpen = false;
}

export function SettingsStateProvider({ children }: { children: React.ReactNode }) {
  const [guideOpen, setGuideOpen] = React.useState(false);
  const openedByUrl = React.useSyncExternalStore(
    subscribeToSettingsParam,
    settingsParamSnapshot,
    settingsParamServerSnapshot,
  );
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useSidebarCollapsed();
  const [documentsDrawerOpen, setDocumentsDrawerOpen] = React.useState(false);
  const [documentScopeOpen, setDocumentScopeOpen] = React.useState(false);
  const [documentsDrawerMode, setDocumentsDrawerMode] = React.useState<DocumentDrawerMode>("library");
  const [indexingAdminDrawerOpen, setIndexingAdminDrawerOpen] = React.useState(false);
  const [indexingAdminMobileTab, setIndexingAdminMobileTab] = React.useState<IndexingAdministrationTab>("jobs");

  // Strips the parameter once it has been consumed, so closing the dialog and reloading does not
  // silently re-open it, and so it never travels into a URL someone copies or bookmarks as if it
  // were part of the page's identity. No state is set here -- `openedByUrl` above already carries
  // the decision, and the latch keeps it true after the URL no longer says so.
  React.useEffect(() => {
    if (!openedByUrl) return;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get(SETTINGS_OPEN_PARAM) !== SETTINGS_OPEN_VALUE) return;
      params.delete(SETTINGS_OPEN_PARAM);
      const query = params.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
      );
    } catch {
      // Leaving the parameter in the URL is harmless; failing the shell is not.
    }
  }, [openedByUrl]);

  const value = React.useMemo(
    () => ({
      guideOpen,
      setGuideOpen,
      settingsOpen: settingsOpen || openedByUrl,
      setSettingsOpen,
      mobileSidebarOpen,
      setMobileSidebarOpen,
      sidebarCollapsed,
      setSidebarCollapsed,
      documentsDrawerOpen,
      setDocumentsDrawerOpen,
      documentScopeOpen,
      setDocumentScopeOpen,
      documentsDrawerMode,
      setDocumentsDrawerMode,
      indexingAdminDrawerOpen,
      setIndexingAdminDrawerOpen,
      indexingAdminMobileTab,
      setIndexingAdminMobileTab,
    }),
    [
      guideOpen,
      openedByUrl,
      settingsOpen,
      mobileSidebarOpen,
      sidebarCollapsed,
      documentsDrawerOpen,
      documentScopeOpen,
      documentsDrawerMode,
      indexingAdminDrawerOpen,
      indexingAdminMobileTab,
      setSidebarCollapsed,
    ],
  );

  return <SettingsStateContext.Provider value={value}>{children}</SettingsStateContext.Provider>;
}

export function useSettingsState() {
  const context = React.useContext(SettingsStateContext);
  if (!context) {
    throw new Error("useSettingsState must be used within SettingsStateProvider");
  }
  return context;
}
