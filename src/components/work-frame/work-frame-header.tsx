"use client";

import { Check, ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { Sheet } from "@/components/ui/sheet";
import { workFrameIcons } from "@/components/work-frame/work-frame-icons";
import {
  rememberedWorkAreaPage,
  rememberWorkAreaPage,
  setWorkFramePill,
  useWorkFrameActionsVersion,
  workFrameActionHandler,
} from "@/components/work-frame/work-frame-store";
import { readOnCallEditorFlag, subscribeOnCallEditorFlag } from "@/lib/on-call/device-state-keys";
import { useOpenShiftsIsPoster, useTeachingRoles } from "@/lib/teaching/page-visibility";
import type { AppModeId } from "@/lib/app-modes";
import {
  WORK_FRAME_MAX_TABS,
  workAreaParent,
  workFrameExtraTabs,
  workFrameTabIndex,
  workFrameTabLabel,
  type WorkArea,
  type WorkFrameGate,
  type WorkFrameItem,
} from "@/lib/work-frame/areas";

/** Where the top bar draws a page's back button in place of the menu button. */
export const universalHeaderLeadingSlotId = "universal-header-leading";

export type WorkFrameHeaderProps = {
  readonly area: WorkArea;
  /** The pill's mode id (Open shifts keeps its own, inside Roster's frame). */
  readonly modeId: AppModeId;
  readonly current: WorkFrameItem | null;
  readonly eyebrow: ReactNode;
  readonly title: ReactNode;
  /** The page's status line slot, drawn under the title. */
  readonly status: ReactNode;
  /** The one glass action (Customise, a page's own action slot). */
  readonly action: ReactNode;
  readonly counts?: Readonly<Record<string, number>>;
  readonly bandRef: (node: HTMLElement | null) => void;
};

function useGateOpen(): (gate: WorkFrameGate | undefined) => boolean {
  const roles = useTeachingRoles();
  const poster = useOpenShiftsIsPoster();
  const editor = useSyncExternalStore(subscribeOnCallEditorFlag, readOnCallEditorFlag, () => false);
  return useCallback(
    (gate) => {
      if (!gate) return true;
      if (gate === "teaching-organiser") return roles.some((role) => role === "organiser" || role === "admin");
      if (gate === "open-shifts-poster") return poster === true;
      return editor;
    },
    [roles, poster, editor],
  );
}

/**
 * The work-mode header band (work-mode redesign, owner request 6 Oct 2026):
 * the area's pale tint with a dot texture and a faint line drawing, an eyebrow
 * and title with one optional glass action, then the three pinned tabs and
 * More, which opens the area's whole navigation as a bottom sheet.
 *
 * The screen's width decides how many tabs show: the three pinned tabs
 * always, then the area's next pages from More as they fit, up to six. The
 * last slot is always More; on a page that is not showing as a tab it takes
 * that page's short name and stays underlined, so the row always says where
 * you are, and tapping it opens More again. An inner area (Open shifts, Manage team, Assessments) draws a
 * back arrow to its parent area on every page (navigation follow-up, owner
 * request 7 Oct 2026).
 *
 * The round glass buttons and the mode pill above it belong to the top bar,
 * which the band repaints through `html[data-work-frame]` (work-mode.css); the
 * band itself draws only what sits under them.
 */
export function WorkFrameHeader({
  area,
  modeId,
  current,
  eyebrow,
  title,
  status,
  action,
  counts,
  bandRef,
}: WorkFrameHeaderProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const gateOpen = useGateOpen();
  const extras = useMemo(
    () =>
      workFrameExtraTabs(area)
        .filter((item) => gateOpen(item.gate))
        .slice(0, WORK_FRAME_MAX_TABS - area.tabs.length),
    [area, gateOpen],
  );
  const fit = useTabsThatFit(navRef, extras);
  const currentId = current?.id ?? null;
  const onTab = workFrameTabIndex(area, currentId) >= 0 || extras.slice(0, fit).some((item) => item.id === currentId);
  const onMorePage = !onTab && current !== null;
  const parent = workAreaParent(area);

  useEffect(() => {
    setWorkFramePill({ modeId, area: area.name, page: current?.label ?? null });
    return () => setWorkFramePill(null);
  }, [modeId, area.name, current?.label]);

  // Remember where you were in a top-level area, for an inner area's back arrow.
  const currentHref = current?.href ?? null;
  useEffect(() => {
    if (!area.parent && currentHref) rememberWorkAreaPage(area.id, currentHref);
  }, [area.id, area.parent, currentHref]);

  useTabSwipe(navRef, currentHref);

  const tab = (item: WorkFrameItem, kind: "pinned" | "extra", out: boolean) => {
    const count = out ? 0 : (counts?.[item.id] ?? 0);
    return (
      <Link
        key={item.id}
        href={item.href!}
        className="work-band__tab"
        data-tab={kind}
        data-fit={out ? "out" : undefined}
        aria-hidden={out ? true : undefined}
        tabIndex={out ? -1 : undefined}
        aria-current={!out && item.id === currentId ? "page" : undefined}
      >
        {kind === "extra" ? workFrameTabLabel(item) : item.label}
        {count > 0 ? (
          <span className="mode-band__badge work-band__count">
            <span aria-hidden="true">{count}</span>
            <span className="sr-only">, {count} to do</span>
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <section
      ref={bandRef}
      aria-label={area.name}
      className="mode-band work-band"
      data-testid="mode-band"
      data-work-area={area.id}
      data-mode-identity={area.identity}
    >
      <span aria-hidden="true" className="work-band__mark" />
      {parent ? <WorkFrameBack parent={parent} /> : null}
      <div className="work-band__head">
        <div className="work-band__heading">
          {eyebrow ? <p className="work-band__eyebrow">{eyebrow}</p> : null}
          {/* Not a heading: each page keeps its own h1 for screen readers. */}
          <p className="mode-band__title work-band__title" data-testid="mode-band-title">
            {title}
          </p>
        </div>
        {action}
      </div>
      {status}
      <nav ref={navRef} aria-label={`${area.name} pages`} className="work-band__tabs" data-testid="mode-band-tabs">
        {area.tabs.map((item) => tab(item, "pinned", false))}
        {extras.map((item, index) => tab(item, "extra", index >= fit))}
        <button
          ref={moreButtonRef}
          type="button"
          className="work-band__tab work-band__more"
          data-tab="more"
          data-current={onMorePage ? "" : undefined}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
          data-testid="work-frame-more"
        >
          <span className="work-band__more-label">{onMorePage ? workFrameTabLabel(current) : "More"}</span>
          {onMorePage ? <span className="sr-only">, current page. Opens all {area.name} pages</span> : null}
          <ChevronDown aria-hidden="true" className="work-band__more-chev" strokeWidth={2.2} />
        </button>
      </nav>
      <WorkMoreSheet
        area={area}
        currentId={currentId}
        counts={counts}
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        returnFocusRef={moreButtonRef}
      />
    </section>
  );
}

/** Where an inner area's way back goes: the parent's page you left, or its first tab. */
function parentHref(parent: WorkArea): string {
  return rememberedWorkAreaPage(parent.id) ?? parent.tabs[0].href!;
}

/**
 * The back button inside an inner area: drawn in the top bar's round left
 * button, in place of the menu, and back to the parent area where you left it.
 */
function WorkFrameBack({ parent }: { parent: WorkArea }) {
  const host = useSyncExternalStore(
    subscribeNever,
    () => document.getElementById(universalHeaderLeadingSlotId),
    () => null,
  );
  if (!host) return null;
  return createPortal(
    <Link
      href={parentHref(parent)}
      className="universal-header-icon-control work-frame-back"
      aria-label={`Back to ${parent.name}`}
      data-testid="work-frame-back"
    >
      <ChevronLeft aria-hidden="true" className="size-icon-lg" strokeWidth={2.25} />
    </Link>,
    host,
  );
}

const subscribeNever = () => () => {};

export type WorkMoreSheetProps = {
  readonly area: WorkArea;
  readonly currentId: string | null;
  /** To-do counts by item id, as the band shows them; absent while counts are hidden. */
  readonly counts?: Readonly<Record<string, number>>;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
};

type SheetGroup = { readonly label: string; readonly items: readonly WorkFrameItem[]; readonly tabs?: true };

/**
 * Every page of a work area in one sheet: a search box, the pinned tabs as a
 * small row, then the area's groups with any to-do counts, the current page
 * ticked. An inner area is one wide row that says it has its own tabs, and an
 * inner area's sheet ends with the way back to its parent. A dialog with a
 * focus trap; Escape, the close button, the dim backdrop and a drag down on
 * the grip all close it, and focus returns to More.
 */
export function WorkMoreSheet({ area, currentId, counts, open, onClose, returnFocusRef }: WorkMoreSheetProps) {
  const gateOpen = useGateOpen();
  const actionsVersion = useWorkFrameActionsVersion();
  const parent = workAreaParent(area);
  const [query, setQuery] = useState("");
  const close = useCallback(() => {
    setQuery("");
    onClose();
  }, [onClose]);
  const groups = useMemo<readonly SheetGroup[]>(() => {
    // Re-read when a page offers or withdraws an action.
    void actionsVersion;
    const visible = (item: WorkFrameItem) =>
      gateOpen(item.gate) && (item.action ? workFrameActionHandler(item.action) !== null : Boolean(item.href));
    const all: readonly SheetGroup[] = [{ label: "Tabs", items: area.tabs, tabs: true }, ...area.groups];
    return all
      .map((group) => ({ ...group, items: group.items.filter(visible) }))
      .filter((group) => group.items.length > 0);
  }, [area, gateOpen, actionsVersion]);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => `${item.label} ${item.sub ?? ""}`.toLowerCase().includes(needle)),
        }))
        .filter((group) => group.items.length > 0)
    : groups;

  return (
    <Sheet
      open={open}
      onClose={close}
      title={area.name}
      description={parent ? `Inside ${parent.name}` : "All pages"}
      returnFocusRef={returnFocusRef}
      testId="work-more-sheet"
      contentClassName="work-more-sheet"
      headerClassName="work-more-sheet__header"
      titleClassName="work-more-sheet__title"
      closeButtonClassName="work-more-sheet__close"
      bodyClassName="work-more-sheet__body"
    >
      <div data-mode-identity={area.identity} className="work-more-sheet__groups">
        <label className="work-more-sheet__search">
          <Search aria-hidden="true" strokeWidth={2} />
          <span className="sr-only">Find a page</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Find a ${area.name} page`}
            autoComplete="off"
            enterKeyHint="search"
            data-testid="work-more-search"
          />
        </label>
        {shown.map((group) => (
          <section key={group.label} aria-label={group.label} className="work-more-sheet__group">
            <h3 className="work-label">{group.label}</h3>
            <ul className={group.tabs ? "work-more-sheet__grid work-more-sheet__grid--tabs" : "work-more-sheet__grid"}>
              {group.items.map((item) =>
                item.opens ? (
                  <li key={item.id} className="work-more-sheet__wide">
                    <WorkMoreAreaRow item={item} onClose={close} />
                  </li>
                ) : (
                  <li key={item.id} className="min-w-0">
                    <WorkMoreTile
                      item={item}
                      current={item.id === currentId}
                      count={counts?.[item.id] ?? 0}
                      compact={group.tabs === true}
                      onClose={close}
                    />
                  </li>
                ),
              )}
            </ul>
          </section>
        ))}
        {needle && shown.length === 0 ? (
          <p role="status" className="work-more-sheet__none">
            No {area.name} page called &ldquo;{query.trim()}&rdquo;. AI Search in the header finds your records.
          </p>
        ) : null}
        {parent && !needle ? (
          <section aria-label={`Leave ${area.name}`} className="work-more-sheet__group">
            <Link href={parentHref(parent)} className="work-more-area" onClick={close} data-testid="work-more-back">
              <span aria-hidden="true" className="work-ic work-ic--sm work-more-area__back">
                <ChevronLeft aria-hidden="true" strokeWidth={2.25} />
              </span>
              <span className="work-more-tile__text">
                <span className="work-more-tile__name">Back to {parent.name}</span>
                <span className="work-more-tile__sub">Where you left it</span>
              </span>
            </Link>
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}

/** An inner area in its parent's More: one wide row that says it has its own tabs. */
function WorkMoreAreaRow({ item, onClose }: { item: WorkFrameItem; onClose: () => void }) {
  const Icon = workFrameIcons[item.icon];
  return (
    <Link href={item.href!} className="work-more-area" onClick={onClose}>
      <span aria-hidden="true" className="work-ic work-ic--sm">
        <Icon aria-hidden="true" strokeWidth={2} />
      </span>
      <span className="work-more-tile__text">
        <span className="work-more-tile__name">{item.label}</span>
        {item.sub ? <span className="work-more-tile__sub">{item.sub}</span> : null}
      </span>
      <span className="work-more-area__tag">
        Own tabs<span className="sr-only">. Opens {item.label} with its own tabs</span>
      </span>
      <ChevronRight aria-hidden="true" className="work-more-area__chev" strokeWidth={2} />
    </Link>
  );
}

function WorkMoreTile({
  item,
  current,
  count,
  compact,
  onClose,
}: {
  item: WorkFrameItem;
  current: boolean;
  count: number;
  compact: boolean;
  onClose: () => void;
}) {
  const Icon = workFrameIcons[item.icon];
  const className = compact ? "work-more-tile work-more-tile--tab" : "work-more-tile";
  const body = (
    <>
      <span aria-hidden="true" className="work-ic work-ic--sm" data-mode-identity={item.leadsTo ?? undefined}>
        <Icon aria-hidden="true" strokeWidth={2} />
      </span>
      <span className="work-more-tile__text">
        <span className="work-more-tile__name">{item.label}</span>
        {item.sub && !compact ? <span className="work-more-tile__sub">{item.sub}</span> : null}
      </span>
      {count > 0 ? (
        <span className="mode-band__badge work-more-tile__count">
          <span aria-hidden="true">{count}</span>
          <span className="sr-only">, {count} to do</span>
        </span>
      ) : null}
      {current && !compact ? (
        <span aria-hidden="true" className="work-more-tile__tick">
          <Check aria-hidden="true" strokeWidth={3} />
        </span>
      ) : null}
    </>
  );
  if (item.action) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => {
          const run = workFrameActionHandler(item.action!);
          onClose();
          run?.();
        }}
      >
        {body}
      </button>
    );
  }
  return (
    <Link
      href={item.href!}
      className={className}
      aria-current={current ? "page" : undefined}
      data-current={current ? "" : undefined}
      onClick={onClose}
    >
      {body}
    </Link>
  );
}

/* ------------------------------------------------------------ tabs that fit */

/** Room kept free at the row's end, so a tab never sits flush against the edge. */
const FIT_SPARE = 8;

/**
 * How many of the extra tabs fit beside the pinned tabs and More, measured
 * from the row itself, so the screen's width, the labels and the reader's
 * text size all count. Every extra tab is drawn; those that do not fit are
 * measured but hidden. Re-measured whenever the row or a tab changes size.
 * Before measuring (server render) none show, so the row only ever grows.
 */
function useTabsThatFit(navRef: RefObject<HTMLElement | null>, extras: readonly WorkFrameItem[]): number {
  const [fit, setFit] = useState(0);
  const key = extras.map((item) => item.id).join(" ");
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || !key || typeof ResizeObserver === "undefined") {
      setFit(0);
      return;
    }
    const measure = () => {
      const style = getComputedStyle(nav);
      const gap = Number.parseFloat(style.columnGap) || 0;
      const room =
        nav.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
      const items = Array.from(nav.children) as HTMLElement[];
      let used = items
        .filter((item) => item.dataset.tab !== "extra")
        .reduce((total, item, index) => total + item.offsetWidth + (index > 0 ? gap : 0), 0);
      let count = 0;
      for (const item of items.filter((element) => element.dataset.tab === "extra")) {
        const width = item.offsetWidth + gap;
        if (used + width > room - FIT_SPARE) break;
        used += width;
        count += 1;
      }
      setFit(count);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    for (const item of Array.from(nav.children)) observer.observe(item);
    return () => observer.disconnect();
  }, [navRef, key]);
  return fit;
}

/* ------------------------------------------------------------- side swipe */

/** A horizontal swipe must travel this far, and twice as far as it drifts down. */
const SWIPE_DISTANCE = 72;
/** Touches that start this close to a screen edge belong to the phone's own back gesture. */
const EDGE_GUARD = 24;

function scrollsSideways(element: Element | null): boolean {
  for (let node = element; node && node !== document.body; node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.closest("[data-no-tab-swipe]")) return true;
    const overflowX = getComputedStyle(node).overflowX;
    if ((overflowX === "auto" || overflowX === "scroll") && node.scrollWidth > node.clientWidth + 1) return true;
  }
  return false;
}

function swipeBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [role="dialog"], header'))
    return true;
  return scrollsSideways(target);
}

/**
 * Swiping sideways on a phone moves along the tab row as it is drawn, as real
 * navigations: the tabs that fit this screen, then the More page that is
 * open, if the last slot names one. A swipe that starts on something that
 * scrolls sideways itself (a week strip, a chip row, a table), on a field, a
 * slider or a sheet, or at the screen's very edge is left alone. Marked
 * `data-no-tab-swipe` opts any other region out.
 */
function useTabSwipe(navRef: RefObject<HTMLElement | null>, currentHref: string | null) {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!currentHref) return;
    let start: { x: number; y: number; t: number } | null = null;
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch) {
        start = null;
        return;
      }
      if (touch.clientX < EDGE_GUARD || touch.clientX > window.innerWidth - EDGE_GUARD || swipeBlocked(event.target)) {
        start = null;
        return;
      }
      start = { x: touch.clientX, y: touch.clientY, t: event.timeStamp };
    };
    const onEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      const began = start;
      start = null;
      const nav = navRef.current;
      if (!began || !touch || !nav) return;
      const dx = touch.clientX - began.x;
      const dy = touch.clientY - began.y;
      if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 2 || event.timeStamp - began.t > 700) return;
      const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a.work-band__tab:not([data-fit="out"])'));
      const pages = links.map((link) => link.getAttribute("href") ?? "");
      let index = links.findIndex((link) => link.getAttribute("aria-current") === "page");
      if (index < 0 && nav.querySelector(".work-band__more[data-current]")) {
        pages.push(currentHref);
        index = pages.length - 1;
      }
      if (index < 0) return;
      const next = pages[index + (dx < 0 ? 1 : -1)];
      if (!next) return;
      const root = document.documentElement;
      root.dataset.workSwipe = dx < 0 ? "next" : "previous";
      window.setTimeout(() => {
        if (root.dataset.workSwipe) delete root.dataset.workSwipe;
      }, 400);
      router.push(next);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [navRef, currentHref, router, pathname]);
}
