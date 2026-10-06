"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { GlobalSearchShell } from "@/components/clinical-dashboard/global-search-shell";
import { MyDayReturnLink } from "@/components/my-day/my-day-return-link";
import type { ClinicalAskModeId } from "@/lib/clinical-ask/contracts";
import { searchShellPropsForPathname } from "@/lib/search-shell-props";

/**
 * Owns one GlobalSearchShell across mode homes so navigating between
 * /services, /dsm, /, etc. does not remount the shared composer chrome.
 *
 * It also mounts the one "‹ My Day" link, above the page, for a page opened
 * from My Day (`?from=my-day`), so no mode page has to carry it itself.
 */
export function SharedSearchAppShell({
  children,
  clinicalAskAvailableModeIds,
}: {
  children: ReactNode;
  clinicalAskAvailableModeIds: readonly ClinicalAskModeId[];
}) {
  const pathname = usePathname() ?? "/";
  const shellProps = searchShellPropsForPathname(pathname);
  return (
    <GlobalSearchShell {...shellProps} clinicalAskAvailableModeIds={clinicalAskAvailableModeIds}>
      <MyDayReturnLink />
      {children}
    </GlobalSearchShell>
  );
}
