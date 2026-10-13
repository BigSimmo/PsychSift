"use client";

/**
 * The phone side menu's own parts (owner pick "variant C", 11 Oct 2026): the
 * Clinical | Work tabs built into the foot of the brand band, the alerts bell
 * beside the close cross, and the Work tab's seven areas.
 *
 * The Clinical tab is the restored classic menu (New chat, Search, Recent chats,
 * Shortcuts), with every clinical page listed under the mode menu's groups in
 * place of the More modes sheet; `ClinicalMobileSidebar` assembles the drawer.
 *
 * Every number here is the notification feed's own (`useWorkSideCounts`, the
 * reader the header bell's centre also feeds). While that feed is unknown or
 * empty the menu shows no badge and no dot, never a placeholder number.
 */

import { Bell, BriefcaseMedical, Stethoscope, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRef, type KeyboardEvent } from "react";

import { useRecentPages } from "@/components/recent-pages/use-recent-pages";
import { cn, sidebarItem } from "@/components/ui-primitives";
import { rememberedWorkAreaPage, type WorkSideCountsState } from "@/components/work-frame/work-frame-store";
import { appModeIcons } from "@/lib/app-mode-icons";
import { notificationBadgeText } from "@/lib/needs-you/feed";
import type { ModeMenuSideId } from "@/lib/phone-mode-groups";
import { RECENT_PAGE_SECTION_LABEL, RECENT_PAGES_SHOWN } from "@/lib/recent-pages";
import { WORK_AREAS, type WorkAreaId } from "@/lib/work-frame/areas";
import {
  WORK_SIDE_AREAS,
  WORK_SIDE_NOTIFICATIONS_HREF,
  workSideBadgeText,
  workSideCountLabel,
  type WorkSideCount,
} from "@/lib/work-frame/side-nav";

const sideIcons: Record<ModeMenuSideId, LucideIcon> = { clinical: Stethoscope, work: BriefcaseMedical };
const sideLabels: Record<ModeMenuSideId, string> = { clinical: "Clinical", work: "Work" };
const sides: readonly ModeMenuSideId[] = ["clinical", "work"];

/** The id of a side's tab, so the panel can name the tab that labels it. */
export function clinicalMenuTabId(side: ModeMenuSideId): string {
  return `clinical-menu-tab-${side}`;
}

export const CLINICAL_MENU_PANEL_ID = "clinical-menu-panel";

/**
 * Underline tabs at the foot of the brand band, in the app's own tab language:
 * the selected tab is heavier, its icon takes the accent, and a 2px accent rule
 * sits on the band's bottom edge. A real tablist with a roving tab stop, so the
 * arrow keys, Home and End move between the two sides.
 *
 * The Work tab carries a small red dot only when something is overdue; its
 * accessible name says so in words.
 */
export function ClinicalMenuTabs({
  side,
  onChange,
  overdue,
}: {
  side: ModeMenuSideId;
  onChange: (side: ModeMenuSideId) => void;
  overdue: number;
}) {
  const tabRefs = useRef<Partial<Record<ModeMenuSideId, HTMLButtonElement | null>>>({});

  function select(next: ModeMenuSideId) {
    onChange(next);
    tabRefs.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = sides.indexOf(side);
    let next: ModeMenuSideId | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const step = event.key === "ArrowRight" ? 1 : -1;
      next = sides[(index + step + sides.length) % sides.length];
    } else if (event.key === "Home") {
      next = sides[0];
    } else if (event.key === "End") {
      next = sides[sides.length - 1];
    }
    if (!next) return;
    event.preventDefault();
    select(next);
  }

  return (
    <div role="tablist" aria-label="Menu sections" className="grid grid-cols-2 px-4 sm:px-5">
      {sides.map((option) => {
        const selected = option === side;
        const Icon = sideIcons[option];
        const showOverdue = option === "work" && overdue > 0;
        return (
          <button
            key={option}
            ref={(node) => {
              tabRefs.current[option] = node;
            }}
            id={clinicalMenuTabId(option)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={CLINICAL_MENU_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option)}
            onKeyDown={onKeyDown}
            data-testid={`clinical-menu-tab-${option}`}
            className={cn(
              "relative inline-flex min-h-12 min-w-0 items-center justify-center gap-2 text-sm transition-colors duration-[var(--duration-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none",
              selected
                ? "font-bold text-[color:var(--text-heading)]"
                : "font-semibold text-[color:var(--text-muted)] hover:text-[color:var(--text-heading)]",
            )}
          >
            <Icon
              aria-hidden="true"
              className={cn("size-icon-sm shrink-0", selected && "text-[color:var(--clinical-accent)]")}
              strokeWidth={2}
            />
            <span className="relative">
              {sideLabels[option]}
              {showOverdue ? (
                <span
                  aria-hidden="true"
                  data-testid="clinical-menu-work-overdue-dot"
                  className="absolute -right-2.5 top-0 size-1.5 rounded-full bg-[color:var(--danger)]"
                />
              ) : null}
            </span>
            {showOverdue ? <span className="sr-only">, {overdue} overdue</span> : null}
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-x-6 bottom-0 h-0.5 rounded-t-sm",
                selected ? "bg-[color:var(--clinical-accent)]" : "bg-transparent",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

/**
 * The alerts bell beside the close cross, drawn exactly like it: no glass, no
 * circle, the same 48px tap target, glyph size and colour. It goes to the same
 * Notifications page as the header bell. The red badge appears only while the
 * feed reports something waiting, capped at 9+ like the header bell.
 */
export function ClinicalMenuBell({
  counts,
  className,
  onNavigate,
}: {
  counts: Pick<WorkSideCountsState, "total" | "overdue"> | null;
  className: string;
  onNavigate: () => void;
}) {
  const waiting = counts && counts.total > 0 ? counts : null;
  const label = waiting ? `Alerts, ${workSideCountLabel(waiting)}` : "Alerts";
  return (
    <Link
      href={WORK_SIDE_NOTIFICATIONS_HREF}
      onClick={onNavigate}
      aria-label={label}
      title="Alerts"
      data-testid="clinical-menu-bell"
      className={cn(className, "relative")}
    >
      <Bell aria-hidden="true" />
      {waiting ? (
        <span
          aria-hidden="true"
          data-testid="clinical-menu-bell-badge"
          className="absolute right-1.5 top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-[color:var(--danger)] px-1 text-2xs font-bold leading-none tabular-nums text-[color:var(--surface)] ring-2 ring-[color:var(--surface-raised)]"
        >
          {notificationBadgeText(waiting.total)}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * The Work tab: the seven work areas with their colour tiles and what is
 * waiting in each, marked like the work rail. The row for the area on screen
 * is the one current row.
 */
export function ClinicalMenuWorkAreas({
  counts,
  currentArea,
  onNavigate,
}: {
  counts: WorkSideCountsState | null;
  currentArea: WorkAreaId | null;
  onNavigate: () => void;
}) {
  return (
    <>
      <WorkAreasNav counts={counts} currentArea={currentArea} onNavigate={onNavigate} />
      <ClinicalMenuRecentPages variant="work" onNavigate={onNavigate} />
    </>
  );
}

function WorkAreasNav({
  counts,
  currentArea,
  onNavigate,
}: {
  counts: WorkSideCountsState | null;
  currentArea: WorkAreaId | null;
  onNavigate: () => void;
}) {
  return (
    <nav aria-labelledby="clinical-menu-work-areas" className="min-w-0 shrink-0" data-testid="clinical-menu-work">
      <p
        id="clinical-menu-work-areas"
        className="flex h-9 items-center px-1 text-2xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]"
      >
        Work areas
      </p>
      <ul className="grid gap-0.5">
        {WORK_SIDE_AREAS.map((entry) => {
          const current = entry.id === currentArea;
          const Icon = appModeIcons[entry.modeId];
          const href = current ? entry.href : (rememberedWorkAreaPage(entry.id) ?? entry.href);
          return (
            <li key={entry.id}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={current ? "true" : undefined}
                data-mode-identity={WORK_AREAS[entry.id].identity}
                className="work-side-menu__row"
              >
                <span className="work-side-menu__tile" aria-hidden="true">
                  <Icon aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
                </span>
                <span className="work-side-menu__name">{entry.label}</span>
                <RowCount count={counts?.areas[entry.id]} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * "Recent pages" in the phone menu: the last five pages opened on this device,
 * across Work and Clinical, under the work areas on the Work tab and under the
 * recent chats on the Clinical tab. Paths and page titles only; hidden when
 * there are none.
 */
export function ClinicalMenuRecentPages({
  variant,
  onNavigate,
}: {
  variant: "clinical" | "work";
  onNavigate: () => void;
}) {
  const pages = useRecentPages({ limit: RECENT_PAGES_SHOWN });
  if (pages.length === 0) return null;
  const headingId = `clinical-menu-recent-pages-${variant}`;
  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 shrink-0"
      data-testid={`clinical-menu-recent-pages-${variant}`}
    >
      <h3
        id={headingId}
        className="flex h-9 items-center px-1 text-2xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]"
      >
        Recent pages
      </h3>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
        {pages.map((page) => {
          const Icon = appModeIcons[page.section];
          const sectionLabel = RECENT_PAGE_SECTION_LABEL[page.section];
          const work = page.mode === "work";
          return (
            <li key={page.path}>
              <Link
                href={page.path}
                onClick={onNavigate}
                title={page.title}
                data-mode-identity={work ? page.section : undefined}
                className={cn(
                  sidebarItem,
                  "border border-transparent",
                  variant === "work" && "gap-3 px-2 text-[color:var(--text-heading)]",
                )}
              >
                {variant === "work" ? (
                  <span
                    className={cn(
                      "grid size-7.5 shrink-0 place-items-center rounded-lg",
                      work
                        ? "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
                        : "bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
                    )}
                    aria-hidden="true"
                  >
                    <Icon aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
                  </span>
                ) : (
                  <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate text-left">{page.title}</span>
                {sectionLabel !== page.title ? (
                  <span className="max-w-[40%] shrink-0 truncate text-xs font-medium text-[color:var(--text-muted)]">
                    <span className="sr-only">, </span>
                    {sectionLabel}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RowCount({ count }: { count: WorkSideCount | undefined }) {
  if (!count || count.total === 0) return null;
  return (
    <>
      <span className="work-side-menu__count" data-overdue={count.overdue > 0 ? "true" : undefined} aria-hidden="true">
        {workSideBadgeText(count.total)}
      </span>
      <span className="sr-only">, {workSideCountLabel(count)}</span>
    </>
  );
}
