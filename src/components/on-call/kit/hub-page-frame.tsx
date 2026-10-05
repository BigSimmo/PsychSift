"use client";

import type { ReactNode } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import type { PageSection } from "@/components/in-page-nav/page-section-index";
import { ON_CALL_HUB_PAGE_TITLES, type OnCallHubPage } from "@/components/on-call/on-call-section-identity";

/**
 * The frame every hub page shares: the page shell, and an `<h1>` for the outline and screen readers that is not
 * painted (the header already names the page). `lead` is the first line above
 * the modules, such as the hospital line; the frame draws nothing of its own
 * beyond that, so each page keeps its modules and the frame stays generic.
 */
export function OnCallHubPageFrame({
  page,
  lead,
  children,
}: {
  readonly page: OnCallHubPage;
  /**
   * The page's groups. No longer drawn as a bar under the header: the mode
   * band's four tabs and each page's own switch replace it (mock-up v10).
   */
  readonly sections?: readonly PageSection[];
  readonly lead?: ReactNode;
  readonly children: ReactNode;
}) {
  const title = ON_CALL_HUB_PAGE_TITLES[page];
  return (
    <>
      <InformationPageShell testId={`on-call-${page}-main`}>
        <h1 className="sr-only">{title}</h1>
        {lead}
        {children}
      </InformationPageShell>
    </>
  );
}
