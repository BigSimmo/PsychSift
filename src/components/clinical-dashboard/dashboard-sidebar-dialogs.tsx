import { LazyGuideDialog } from "@/components/clinical-dashboard/lazy-guide-dialog";
import * as SidebarDialogs from "@/components/clinical-dashboard/lazy-sidebar-dialogs";
import type { SidebarIdentity } from "@/components/clinical-dashboard/ClinicalSidebar";

export interface DashboardSidebarDialogsProps {
  guideOpen: boolean;
  onCloseGuide: () => void;
  settingsOpen: boolean;
  onCloseSettings: () => void;
  sidebarIdentity: SidebarIdentity;
  onSignOut: () => Promise<void>;
  onOpenGuideFromSettings: () => void;
  onPrefetchGuide: () => void;
  settingsInitialFocus?: "close" | "guide";
  accountSetupOpen: boolean;
  onCloseAccountSetup: () => void;
  accountSetupIntent: "default" | "favourites" | "indexing";
}

export function DashboardSidebarDialogs({
  guideOpen,
  onCloseGuide,
  settingsOpen,
  onCloseSettings,
  sidebarIdentity,
  onSignOut,
  onOpenGuideFromSettings,
  onPrefetchGuide,
  settingsInitialFocus,
  accountSetupOpen,
  onCloseAccountSetup,
  accountSetupIntent,
}: DashboardSidebarDialogsProps) {
  return (
    <>
      <LazyGuideDialog open={guideOpen} onClose={onCloseGuide} />
      <SidebarDialogs.SidebarSettingsDialog
        open={settingsOpen}
        onClose={onCloseSettings}
        identity={sidebarIdentity}
        onSignOut={onSignOut}
        onOpenGuide={onOpenGuideFromSettings}
        onPrefetchGuide={onPrefetchGuide}
        initialFocus={settingsInitialFocus}
      />
      <SidebarDialogs.SidebarAccountSetupDialog
        open={accountSetupOpen}
        onClose={onCloseAccountSetup}
        intent={accountSetupIntent === "indexing" ? "default" : accountSetupIntent}
      />
    </>
  );
}
