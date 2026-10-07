"use client";

import type { PageSection } from "@/components/in-page-nav/page-section-index";
import { useInPageSectionNav } from "@/components/in-page-nav/use-in-page-section-nav";

import styles from "./admin-work.module.css";

/**
 * Admin's in-page section chips (work-mode redesign, owner request 6 Oct
 * 2026): one chip per section of the page, in the page flow (never sticky, so
 * it never stacks with the band), on the same `useInPageSectionNav` hook the
 * old underlined rail used, so anchors, the scroll spy and the
 * `admin-section-header-*` test ids keep working. The chips wrap rather than
 * scroll sideways, so none hides off the edge and a drag never fights the tab
 * swipe. The current section is `aria-current`.
 */
export function AdminNavHeader({ title, sections }: { title: string; sections: readonly PageSection[] }) {
  const { sections: resolved, activeId, selectSection } = useInPageSectionNav(sections);
  if (resolved.length === 0) return null;
  return (
    <div data-testid="admin-section-header-detail-header" className={styles.chipRail}>
      <nav aria-label="Sections of this page" data-testid="admin-section-header-section-rail" data-no-tab-swipe="">
        <ul className="work-chips flex-wrap" aria-label={title}>
          {resolved.map((section) => {
            const Icon = section.icon;
            const active = section.id === activeId;
            return (
              <li key={section.id}>
                <button
                  type="button"
                  className="work-chip"
                  aria-current={active ? "true" : undefined}
                  onClick={() => selectSection(section.id)}
                  data-testid={`admin-section-header-section-${section.id}`}
                >
                  {Icon ? <Icon aria-hidden="true" strokeWidth={2.2} /> : null}
                  <span>{section.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
