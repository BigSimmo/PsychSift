"use client";

import dynamic from "next/dynamic";
import { useState, type ComponentProps } from "react";

export const loadSettingsDialog = () =>
  import("@/components/clinical-dashboard/settings-dialog").then((module) => module.SettingsDialog);

export const SettingsDialog = dynamic(loadSettingsDialog, { ssr: false });

const loadAccountSetupDialog = () =>
  import("@/components/clinical-dashboard/account-setup-dialog").then((module) => module.AccountSetupDialog);

export const AccountSetupDialog = dynamic(loadAccountSetupDialog, { ssr: false });

export function prefetchAccountDialog() {
  void loadSettingsDialog();
  void loadAccountSetupDialog();
}

export function SidebarSettingsDialog(props: ComponentProps<typeof SettingsDialog>) {
  const [hasOpened, setHasOpened] = useState(props.open);
  if (props.open && !hasOpened) setHasOpened(true);
  return hasOpened ? <SettingsDialog {...props} /> : null;
}

export function SidebarAccountSetupDialog(props: ComponentProps<typeof AccountSetupDialog>) {
  const [hasOpened, setHasOpened] = useState(props.open);
  if (props.open && !hasOpened) setHasOpened(true);
  return hasOpened ? <AccountSetupDialog {...props} /> : null;
}
