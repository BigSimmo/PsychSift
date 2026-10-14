"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ComponentProps } from "react";

import { restoreFocusUnlessMoved } from "@/components/use-dismissable-layer";

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
  const triggerRef = useRef<HTMLElement | null>(null);
  if (props.open && !hasOpened) setHasOpened(true);

  useEffect(() => {
    if (props.open) {
      if (
        typeof document !== "undefined" &&
        document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body
      ) {
        triggerRef.current = document.activeElement;
      }
      return undefined;
    }
    const target = triggerRef.current;
    if (!target) return undefined;
    const frame = window.requestAnimationFrame(() => {
      restoreFocusUnlessMoved(target);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.open]);

  return hasOpened ? <SettingsDialog {...props} /> : null;
}

export function SidebarAccountSetupDialog(props: ComponentProps<typeof AccountSetupDialog>) {
  const [hasOpened, setHasOpened] = useState(props.open);
  if (props.open && !hasOpened) setHasOpened(true);
  return hasOpened ? <AccountSetupDialog {...props} /> : null;
}
