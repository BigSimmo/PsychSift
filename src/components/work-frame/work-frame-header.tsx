"use client";

import { Check, ChevronDown, ChevronLeft } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { Sheet } from "@/components/ui/sheet";
import { useTabSwipe } from "@/components/work-swipe/use-tab-swipe";
import { workFrameIcons } from "@/components/work-frame/work-frame-icons";
import {
  setWorkFramePill,
  useWorkFrameActionsVersion,
  workFrameActionHandler,
} from "@/components/work-frame/work-frame-store";
import { readOnCallEditorFlag, subscribeOnCallEditorFlag } from "@/lib/on-call/device-state-keys";
import { useOpenShiftsIsPoster, useTeachingRoles } from "@/lib/teaching/page-visibility";
import type { AppModeId } from "@/lib/app-modes";
import { workFrameTabIndex, type WorkArea, type WorkFrameGate, type WorkFrameItem } from "@/lib/work-frame/areas";

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
  const currentId = current?.id ?? null;
  const tabIndex = workFrameTabIndex(area, currentId);
  const onTab = tabIndex >= 0;

  useEffect(() => {
    setWorkFramePill({ modeId, area: area.name, page: current?.label ?? null });
    return () => setWorkFramePill(null);
  }, [modeId, area.name, current?.label]);

  useTabSwipe(area, onTab ? tabIndex : -1);

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
      {!onTab ? <WorkFrameBack area={area} /> : null}
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
      <nav aria-label={`${area.name} pages`} className="work-band__tabs" data-testid="mode-band-tabs">
        {area.tabs.map((tab) => {
          const count = counts?.[tab.id] ?? 0;
          return (
            <Link
              key={tab.id}
              href={tab.href!}
              className="work-band__tab"
              aria-current={tab.id === currentId ? "page" : undefined}
            >
              {tab.label}
              {count > 0 ? (
                <span className="mode-band__badge work-band__count">
                  <span aria-hidden="true">{count}</span>
                  <span className="sr-only">, {count} to do</span>
                </span>
              ) : null}
            </Link>
          );
        })}
        <button
          ref={moreButtonRef}
          type="button"
          className="work-band__tab work-band__more"
          data-current={!onTab && current ? "" : undefined}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
          data-testid="work-frame-more"
        >
          More
          {!onTab && current ? <span className="sr-only">, current page {current.label}</span> : null}
          <ChevronDown aria-hidden="true" className="work-band__more-chev" strokeWidth={2.2} />
        </button>
      </nav>
      <WorkMoreSheet
        area={area}
        currentId={currentId}
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        returnFocusRef={moreButtonRef}
      />
    </section>
  );
}

/**
 * The back button for a page reached from More: drawn in the top bar's round
 * left button, in place of the menu, and back to the area's first tab.
 */
function WorkFrameBack({ area }: { area: WorkArea }) {
  const host = useSyncExternalStore(
    subscribeNever,
    () => document.getElementById(universalHeaderLeadingSlotId),
    () => null,
  );
  const home = area.tabs[0];
  if (!host) return null;
  return createPortal(
    <Link
      href={home.href!}
      className="universal-header-icon-control work-frame-back"
      aria-label={`Back to ${area.name}`}
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
  readonly open: boolean;
  readonly onClose: () => void;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * Every page of a work area in one sheet: the pinned tabs first, then the
 * area's groups, the current page ticked. A dialog with a focus trap; Escape,
 * the close button, the dim backdrop and a drag down on the grip all close it,
 * and focus returns to More.
 */
export function WorkMoreSheet({ area, currentId, open, onClose, returnFocusRef }: WorkMoreSheetProps) {
  const gateOpen = useGateOpen();
  const actionsVersion = useWorkFrameActionsVersion();
  const groups = useMemo(() => {
    // Re-read when a page offers or withdraws an action.
    void actionsVersion;
    const visible = (item: WorkFrameItem) =>
      gateOpen(item.gate) && (item.action ? workFrameActionHandler(item.action) !== null : Boolean(item.href));
    return [{ label: "Tabs", items: [...area.tabs] }, ...area.groups]
      .map((group) => ({ label: group.label, items: group.items.filter(visible) }))
      .filter((group) => group.items.length > 0);
  }, [area, gateOpen, actionsVersion]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={area.name}
      description="All pages"
      returnFocusRef={returnFocusRef}
      testId="work-more-sheet"
      contentClassName="work-more-sheet"
      headerClassName="work-more-sheet__header"
      titleClassName="work-more-sheet__title"
      closeButtonClassName="work-more-sheet__close"
      bodyClassName="work-more-sheet__body"
    >
      <div data-mode-identity={area.identity} className="work-more-sheet__groups">
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label} className="work-more-sheet__group">
            <h3 className="work-label">{group.label}</h3>
            <ul className="work-more-sheet__grid">
              {group.items.map((item) => (
                <li key={item.id} className="min-w-0">
                  <WorkMoreTile item={item} current={item.id === currentId} onClose={onClose} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  );
}

function WorkMoreTile({ item, current, onClose }: { item: WorkFrameItem; current: boolean; onClose: () => void }) {
  const Icon = workFrameIcons[item.icon];
  const body = (
    <>
      <span aria-hidden="true" className="work-ic work-ic--sm" data-mode-identity={item.leadsTo ?? undefined}>
        <Icon aria-hidden="true" strokeWidth={2} />
      </span>
      <span className="work-more-tile__text">
        <span className="work-more-tile__name">{item.label}</span>
        {item.sub ? <span className="work-more-tile__sub">{item.sub}</span> : null}
      </span>
      {current ? (
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
        className="work-more-tile"
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
      className="work-more-tile"
      aria-current={current ? "page" : undefined}
      data-current={current ? "" : undefined}
      onClick={onClose}
    >
      {body}
    </Link>
  );
}
