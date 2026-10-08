"use client";

import { Check, ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
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

import { WorkPageFavouriteButton } from "@/components/favourites/work-page-favourite-button";
import { Sheet } from "@/components/ui/sheet";
import { useNewWorkMode, useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { useTabSwipe } from "@/components/work-swipe/use-tab-swipe";
import { useStickyWorkTabs } from "@/components/work-frame/use-sticky-work-tabs";
import { workFrameIcons } from "@/components/work-frame/work-frame-icons";
import {
  rememberedWorkAreaPage,
  rememberWorkAreaPage,
  usePageBackClaimed,
  setWorkFramePill,
  useWorkFrameActionsVersion,
  workFrameActionHandler,
} from "@/components/work-frame/work-frame-store";
import { useWorkTabPicks } from "@/components/work-frame/work-tab-picks";
import { readOnCallEditorFlag, subscribeOnCallEditorFlag } from "@/lib/on-call/device-state-keys";
import { useOpenShiftsIsPoster, useTeachingRoles } from "@/lib/teaching/page-visibility";
import type { AppModeId } from "@/lib/app-modes";
import {
  WORK_TAB_PICKS_MAX,
  workAreaParent,
  workAreaPillName,
  workFrameTabChoices,
  workFrameTabRow,
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
  const newWorkMode = useNewWorkMode();
  return useCallback(
    (gate) => {
      if (!gate) return true;
      if (gate === "teaching-organiser") return roles.some((role) => role === "organiser" || role === "admin");
      if (gate === "open-shifts-poster") return poster === true;
      if (gate === "new-work-mode") return newWorkMode;
      if (gate === "classic-work-mode") return !newWorkMode;
      return editor;
    },
    [roles, poster, editor, newWorkMode],
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
  const routeVisible = useWorkModeRouteVisible();
  const [picked, setPicked] = useWorkTabPicks(area.id);
  const { first, extras } = useMemo(
    // A new-only page never becomes an extra tab for a reader on the classic work mode.
    () => workFrameTabRow(area, picked, (item) => gateOpen(item.gate) && (!item.href || routeVisible(item.href))),
    [area, picked, gateOpen, routeVisible],
  );
  const fit = useTabsThatFit(navRef, [...first, ...extras].map((item) => item.id).join(" "));
  const shownTabs = useMemo(() => [...first, ...extras.slice(0, fit)], [first, extras, fit]);
  const currentId = current?.id ?? null;
  const onTab = shownTabs.some((item) => item.id === currentId);
  const onMorePage = !onTab && current !== null;
  const parent = workAreaParent(area);
  // Saving work pages to Favourites is part of the new work mode.
  const newWorkMode = useNewWorkMode();

  const pillName = workAreaPillName(area);
  useEffect(() => {
    // The pill names the area only (owner pick, 7 Oct 2026): the tab row
    // already names the page, as an underlined tab or in More's slot.
    setWorkFramePill({ modeId, area: pillName, page: null });
    return () => setWorkFramePill(null);
  }, [modeId, pillName]);

  // Remember where you were in a top-level area, for an inner area's back arrow.
  const currentHref = current?.href ?? null;
  useEffect(() => {
    if (!area.parent && currentHref) rememberWorkAreaPage(area.id, currentHref);
  }, [area.id, area.parent, currentHref]);

  useTabSwipe(navRef, currentHref);

  // The tab row stays pinned under the top bar on scroll (owner request 8 Oct 2026).
  const [band, setBand] = useState<HTMLElement | null>(null);
  useStickyWorkTabs(band, navRef);
  const setBandNode = useCallback(
    (node: HTMLElement | null) => {
      setBand(node);
      bandRef(node);
    },
    [bandRef],
  );

  const tab = (item: WorkFrameItem, kind: "pinned" | "extra", out: boolean) => {
    // Hidden tabs keep their badge, so a tab measures the same hidden or shown.
    const count = counts?.[item.id] ?? 0;
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
        <span className="work-band__tab-label">{workFrameTabLabel(item)}</span>
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
      ref={setBandNode}
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
        <div className="ml-auto flex shrink-0 items-end gap-2">
          {newWorkMode &&
          current?.href &&
          !current.leadsTo &&
          current.id !== area.tabs[0].id &&
          current.id !== "my-day-favourites" ? (
            <WorkPageFavouriteButton
              areaId={area.id}
              itemId={current.id}
              pageName={current.title ?? current.label}
              className="work-band__action"
            />
          ) : null}
          {action}
        </div>
      </div>
      {status}
      <nav ref={navRef} aria-label={`${area.name} pages`} className="work-band__tabs" data-testid="mode-band-tabs">
        {first.map((item) => tab(item, "pinned", false))}
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
        tabs={shownTabs}
        first={first}
        onPick={setPicked}
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
  const claimed = usePageBackClaimed();
  const host = useSyncExternalStore(
    subscribeNever,
    () => document.getElementById(universalHeaderLeadingSlotId),
    () => null,
  );
  if (!host || claimed) return null;
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
  /** The tabs the row shows right now, at this width. Defaults to the area's own three. */
  readonly tabs?: readonly WorkFrameItem[];
  /** The row's first three, which the reader may choose. */
  readonly first?: readonly WorkFrameItem[];
  /** Saves the reader's first tabs; an empty list goes back to the area's own. Absent, no Change button. */
  readonly onPick?: (ids: readonly string[]) => void;
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
export function WorkMoreSheet({
  area,
  currentId,
  counts,
  tabs = area.tabs,
  first = area.tabs,
  onPick,
  open,
  onClose,
  returnFocusRef,
}: WorkMoreSheetProps) {
  const gateOpen = useGateOpen();
  const routeVisible = useWorkModeRouteVisible();
  const actionsVersion = useWorkFrameActionsVersion();
  const parent = workAreaParent(area);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<readonly string[] | null>(null);
  // Leaving the picker puts focus back on Change, which re-mounts with the list.
  const changeRef = useRef<HTMLButtonElement>(null);
  const refocusChange = useRef(false);
  useEffect(() => {
    if (draft !== null || !refocusChange.current) return;
    refocusChange.current = false;
    changeRef.current?.focus();
  }, [draft]);
  const close = useCallback(() => {
    setQuery("");
    setDraft(null);
    onClose();
  }, [onClose]);
  const groups = useMemo<readonly SheetGroup[]>(() => {
    // Re-read when a page offers or withdraws an action.
    void actionsVersion;
    // A new-only screen stays out of the sheet for a reader on the classic work mode.
    const visible = (item: WorkFrameItem) =>
      gateOpen(item.gate) &&
      (item.action ? workFrameActionHandler(item.action) !== null : Boolean(item.href) && routeVisible(item.href!));
    // The Tabs row mirrors the tab row as it stands at this width; each page shows once.
    const inRow = new Set(tabs.map((item) => item.id));
    const all: readonly SheetGroup[] = [
      { label: "Tabs", items: tabs, tabs: true },
      ...(area.tabs.some((item) => !inRow.has(item.id))
        ? [{ label: "Other pages", items: area.tabs.filter((item) => !inRow.has(item.id)) }]
        : []),
      ...area.groups.map((group) => ({ ...group, items: group.items.filter((item) => !inRow.has(item.id)) })),
    ];
    return all
      .map((group) => ({ ...group, items: group.items.filter(visible) }))
      .filter((group) => group.items.length > 0);
  }, [area, tabs, gateOpen, routeVisible, actionsVersion]);
  const choices = useMemo(
    () => workFrameTabChoices(area).filter((item) => gateOpen(item.gate) && (!item.href || routeVisible(item.href))),
    [area, gateOpen, routeVisible],
  );
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
        {draft && onPick ? (
          <WorkTabPicker
            area={area}
            choices={choices}
            draft={draft}
            onChange={setDraft}
            onDone={(ids) => {
              onPick(ids);
              refocusChange.current = true;
              setDraft(null);
            }}
          />
        ) : (
          <>
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
                {group.tabs && onPick && !needle && choices.length > WORK_TAB_PICKS_MAX ? (
                  <div className="work-more-sheet__head">
                    <h3 className="work-label">{group.label}</h3>
                    <button
                      ref={changeRef}
                      type="button"
                      className="work-more-sheet__edit"
                      onClick={() => setDraft(first.map((item) => item.id))}
                      data-testid="work-tabs-change"
                    >
                      Change<span className="sr-only"> your first tabs</span>
                    </button>
                  </div>
                ) : (
                  <h3 className="work-label">{group.label}</h3>
                )}
                <ul
                  className={group.tabs ? "work-more-sheet__grid work-more-sheet__grid--tabs" : "work-more-sheet__grid"}
                >
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
          </>
        )}
      </div>
    </Sheet>
  );
}

/**
 * Choosing an area's first tabs: every page that can be a tab, tap to put it
 * in the next of three first slots or take it out. Done saves, Reset goes back
 * to the area's own. Further tabs still join by width, in More's order.
 */
function WorkTabPicker({
  area,
  choices,
  draft,
  onChange,
  onDone,
}: {
  area: WorkArea;
  choices: readonly WorkFrameItem[];
  draft: readonly string[];
  onChange: (ids: readonly string[]) => void;
  onDone: (ids: readonly string[]) => void;
}) {
  const full = draft.length >= WORK_TAB_PICKS_MAX;
  const own = area.tabs.map((item) => item.id);
  const isOwn = draft.length === own.length && draft.every((id, index) => id === own[index]);
  // Opening the picker moves focus to its heading, since Change has gone.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <section aria-labelledby="work-tab-picker-title" className="work-more-sheet__group" data-testid="work-tab-picker">
      <h3 ref={headingRef} tabIndex={-1} id="work-tab-picker-title" className="work-label outline-none">
        Your first tabs
      </h3>
      <p className="work-more-sheet__hint" role="status">
        {full
          ? "Three chosen. Tap one to take it out, then pick another."
          : `Tap up to three, in order. Then more join as your screen allows.`}
      </p>
      <ul className="work-more-sheet__grid">
        {choices.map((item) => {
          const slot = draft.indexOf(item.id);
          const picked = slot >= 0;
          const Icon = workFrameIcons[item.icon];
          return (
            <li key={item.id} className="min-w-0">
              <button
                type="button"
                className="work-more-tile work-more-tile--pick"
                aria-pressed={picked}
                aria-disabled={!picked && full ? true : undefined}
                data-picked={picked ? "" : undefined}
                onClick={() => {
                  if (picked) onChange(draft.filter((id) => id !== item.id));
                  else if (!full) onChange([...draft, item.id]);
                }}
              >
                <span aria-hidden="true" className="work-ic work-ic--sm">
                  <Icon aria-hidden="true" strokeWidth={2} />
                </span>
                <span className="work-more-tile__text">
                  <span className="work-more-tile__name">{workFrameTabLabel(item)}</span>
                </span>
                <span aria-hidden="true" className="work-more-tile__slot">
                  {picked ? slot + 1 : ""}
                </span>
                {picked ? <span className="sr-only">, tab {slot + 1}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="work-more-sheet__actions">
        <button
          type="button"
          className="work-more-sheet__edit"
          disabled={isOwn}
          onClick={() => onDone([])}
          data-testid="work-tabs-reset"
        >
          Reset
        </button>
        <button
          type="button"
          className="work-more-sheet__done"
          onClick={() => onDone(isOwn ? [] : draft)}
          data-testid="work-tabs-done"
        >
          Done
        </button>
      </div>
    </section>
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
function useTabsThatFit(navRef: RefObject<HTMLElement | null>, key: string): number {
  const [fit, setFit] = useState(0);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || !nav.querySelector('[data-tab="extra"]') || typeof ResizeObserver === "undefined") {
      setFit(0);
      return;
    }
    const measure = () => {
      const style = getComputedStyle(nav);
      const gap = Number.parseFloat(style.columnGap) || 0;
      const room =
        nav.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
      const items = Array.from(nav.children) as HTMLElement[];
      // A tab's share of the row: its box, its own margins (tabs reach into the
      // gaps with negative margins) and the gap after it.
      const share = (item: HTMLElement) => {
        const own = getComputedStyle(item);
        return (
          item.offsetWidth + (Number.parseFloat(own.marginLeft) || 0) + (Number.parseFloat(own.marginRight) || 0) + gap
        );
      };
      let used = items
        .filter((item) => item.dataset.tab !== "extra")
        .reduce((total, item) => total + share(item), -gap);
      let count = 0;
      for (const item of items.filter((element) => element.dataset.tab === "extra")) {
        const width = share(item);
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
