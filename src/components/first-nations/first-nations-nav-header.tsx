"use client";
import { useMemo, type ReactNode } from "react";
import { InPageNavHeader } from "@/components/in-page-nav/in-page-nav-header";
import type { PageSection } from "@/components/in-page-nav/page-section-index";
import { useInPageSectionNav } from "@/components/in-page-nav/use-in-page-section-nav";
import { FIRST_NATIONS_ICONS, type FirstNationsIconName } from "@/components/first-nations/first-nations-icons";

export type FirstNationsTab = { id: string; label: string; icon: FirstNationsIconName };

export function FirstNationsNavHeader({
  title,
  sections,
  actions,
}: {
  title: string;
  sections: readonly FirstNationsTab[];
  actions?: ReactNode | ((close: () => void) => ReactNode);
}) {
  // Icons are resolved here, on the client, because a Lucide component cannot cross
  // the server-to-client boundary. Tabs carry no counts (design standard, final design).
  // Memoised: `useInPageSectionNav` re-resolves whenever the declared array changes.
  const declared: PageSection[] = useMemo(
    () =>
      sections.map((s) => ({
        id: s.id,
        label: s.label,
        icon: FIRST_NATIONS_ICONS[s.icon],
      })),
    [sections],
  );
  const { sections: resolved, activeId, selectSection } = useInPageSectionNav(declared);
  if (resolved.length === 0) return null;
  return (
    <InPageNavHeader
      title={title}
      titleHidden
      back={{ href: "/first-nations", label: "First Nations" }}
      sections={resolved}
      activeId={activeId}
      onSelectSection={selectSection}
      actions={actions}
      rail={{ label: "Sections of this page", density: "balanced-four", modeIdentity: "first-nations" }}
      className="max-sm:border-b-0 max-sm:bg-transparent"
      testIdPrefix="first-nations-section-header"
    />
  );
}
