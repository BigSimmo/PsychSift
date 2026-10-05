"use client";

import { Check, ChevronLeft, CircleAlert, CloudOff, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useState,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { appModeIcons } from "@/lib/app-mode-icons";
import { appModeDefinition, type AppModeId } from "@/lib/app-modes";
import {
  activeModeSecondaryNavigationId,
  groupModeSecondaryNavigationEntries,
  modeSecondaryNavigationEntries,
  visibleModeSecondaryNavigationEntries,
} from "@/lib/mode-secondary-navigation";
import { modePageVisible, useRosterHasEnabledTeam, useTeachingRoles } from "@/lib/teaching/page-visibility";
import { useClientTime } from "@/lib/use-client-time";

/**
 * Modes that carry their own identity colour (`data-mode-identity` in
 * globals.css). The rest take the product accent, which the `:root` aliases
 * already resolve `--mode-identity*` to.
 */
const IDENTITY_MODES: ReadonlySet<AppModeId> = new Set([
  "cme",
  "roster",
  "teaching",
  "my-work",
  "on-call",
  "first-nations",
]);

/** Where the band's status line is drawn; `ModeBandStatus` portals into it. */
export const modeBandStatusSlotId = "mode-band-status";
const modeBandActionSlotId = "mode-band-action";

export type ModeBandLead =
  /** A child of another page: a small back link in the mode colour. */
  | { kind: "back"; href: string; label: string }
  /** A top-level page: today's date, in Perth. */
  | { kind: "date" };

export type ModeBandProps = {
  modeId: AppModeId;
  /**
   * Defaults to the mode's own name ("CPD"); the top bar already names the
   * page. "greeting" is the time-of-day greeting My Day leads with.
   */
  title?: string | "greeting";
  /** Defaults to a back link to My Day, the hub every mode is reached from. */
  lead?: ModeBandLead;
  /** Only where the page really has something to customise. */
  customiseHref?: string;
  /** The mode's pages as underline tabs. Defaults to on. */
  tabs?: boolean;
  /** A count beside a tab, shown only when above zero ("Log 3"). */
  counts?: Readonly<Record<string, number>>;
  /**
   * Keeps a line under the title for the page's `ModeBandStatus`, so the band
   * does not grow when the status arrives after hydration.
   */
  statusSlot?: boolean | readonly string[];
  /** A static status line, for pages whose status never changes on the client. */
  status?: ReactNode;
  /**
   * Paths (exact, or a prefix ending in "/") where this band must not draw,
   * because the page there has its own header (a record, an editor). The band
   * already draws only on the mode's own pages: its home, and any path the
   * page registry assigns to one of its tabs.
   */
  hiddenOn?: readonly string[];
  /** Where the mode's own home is, when it is not the mode's registered address. */
  homePath?: string;
  /** The mode's pages, drawn under the band. */
  children?: ReactNode;
};

const ModeBandShownContext = createContext(false);

/**
 * Whether this page sits under a mode band. Decided from the address alone, so
 * the server and the browser agree on the first paint. Pages use it to drop
 * their own copy of something the band now carries (a visible title, a
 * Customise button), so nothing shows twice, and keep it where no band is.
 */
export function useModeBandShown(): boolean {
  return useContext(ModeBandShownContext);
}

function greetingFor(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-AU", { hour: "numeric", hourCycle: "h23", timeZone: "Australia/Perth" }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** The greeting, settled after hydration so a cached page never greets the wrong part of the day. */
function GreetingTitle({ fallback }: { fallback: string }) {
  const now = useClientTime();
  return <>{now ? greetingFor(new Date(now)) : fallback}</>;
}

const dateLong = new Intl.DateTimeFormat("en-AU", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Australia/Perth",
});

function shortDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Australia/Perth",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("weekday")} ${pick("day")} ${pick("month")}`;
}

function modeHomePath(modeId: AppModeId): string | undefined {
  const mode = appModeDefinition(modeId);
  return "href" in mode ? mode.href : undefined;
}

function isHidden(pathname: string, hiddenOn: readonly string[] | undefined): boolean {
  return (hiddenOn ?? []).some((path) => (path.endsWith("/") ? pathname.startsWith(path) : pathname === path));
}

/**
 * Today's date, rendered after hydration so a server in another timezone, or a
 * page cached across midnight, can never show yesterday. The row keeps its
 * height either way.
 */
function TodayDate() {
  const time = useClientTime();
  if (!time) return <span className="mode-band__date" />;
  const now = new Date(time);
  return (
    <span className="mode-band__date">
      <span className="mode-band__date-long">{dateLong.format(now)}</span>
      <span className="mode-band__date-short">{shortDate(now)}</span>
    </span>
  );
}

/**
 * Paints the top bar in the band's colour while a band is on the page. The
 * colour is read from the band itself, so it is always the mode's own tint in
 * the current theme, and re-read when the theme changes.
 */
function usePublishBandSurface(band: HTMLElement | null, modeId: AppModeId) {
  useLayoutEffect(() => {
    if (!band) return;
    const root = document.documentElement;
    const publish = () => {
      root.style.setProperty("--mode-band-surface", getComputedStyle(band).backgroundColor);
      root.dataset.modeBand = modeId;
    };
    publish();
    const observer = new MutationObserver(publish);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      if (root.dataset.modeBand === modeId) {
        delete root.dataset.modeBand;
        root.style.removeProperty("--mode-band-surface");
      }
    };
  }, [band, modeId]);
}

/**
 * The mode page header (C4, "soft tint"), locked by the owner on 5 Oct 2026.
 *
 * Mounted once per mode in the mode's route layout, so every page of the mode
 * gets the same header without each page drawing its own. The top bar above
 * it is untouched; this draws only the band, its utility row, the title, the
 * status line and the tabs.
 *
 * It sits in page flow under the top bar rather than inside the header's
 * collapse track: the track's height is the page's top reserve, so a header
 * whose title folds away on scroll would move every element on the page.
 * Scrolling therefore takes the band with the page, and the top bar keeps its
 * own single hide-and-reveal (docs/search-chrome-behaviour.md).
 */
export function ModeBand({ children, ...props }: ModeBandProps) {
  const pathname = usePathname() ?? "";
  const activeId = activeModeSecondaryNavigationId(props.modeId, pathname);
  const shown =
    !isHidden(pathname, props.hiddenOn) &&
    (activeId !== null || pathname === (props.homePath ?? modeHomePath(props.modeId)));
  return (
    <ModeBandShownContext.Provider value={shown}>
      {shown ? <ModeBandHeader {...props} activeId={activeId} /> : null}
      {children}
    </ModeBandShownContext.Provider>
  );
}

function ModeBandHeader({
  modeId,
  title,
  lead = { kind: "back", href: "/my-day", label: "My Day" },
  customiseHref,
  tabs = true,
  counts,
  statusSlot = false,
  status,
  activeId,
}: Omit<ModeBandProps, "children" | "hiddenOn" | "homePath"> & { activeId: string | null }) {
  const pathname = usePathname() ?? "";
  const [band, setBand] = useState<HTMLElement | null>(null);
  const teachingRoles = useTeachingRoles();
  const rosterHasTeam = useRosterHasEnabledTeam();

  // The same pages the top bar's page list offers this reader, in its order:
  // flagged-off and editor-only pages, and the "tools" and "more" groups, stay
  // in the page list only.
  const tabEntries = useMemo(() => {
    if (!tabs) return [];
    const visible = visibleModeSecondaryNavigationEntries(
      modeSecondaryNavigationEntries(modeId).filter((entry) =>
        modePageVisible(modeId, entry.id, teachingRoles, rosterHasTeam),
      ),
      { isEditor: false },
    );
    return groupModeSecondaryNavigationEntries(visible).main.filter((entry) => entry.href);
  }, [tabs, modeId, teachingRoles, rosterHasTeam]);

  usePublishBandSurface(band, modeId);

  const Icon = appModeIcons[modeId];
  const modeName = appModeDefinition(modeId).label;
  const heading = title === "greeting" ? <GreetingTitle fallback={modeName} /> : (title ?? modeName);
  const hasStatus =
    status !== undefined || (Array.isArray(statusSlot) ? statusSlot.includes(pathname) : Boolean(statusSlot));

  return (
    <header
      ref={setBand}
      className="mode-band"
      data-testid="mode-band"
      data-mode-identity={IDENTITY_MODES.has(modeId) ? modeId : undefined}
    >
      <Icon aria-hidden="true" className="mode-band__mark" strokeWidth={1.25} />
      <div className="mode-band__inner">
        <div className="mode-band__utility">
          {lead.kind === "back" ? (
            <Link href={lead.href} className="mode-band__back" aria-label={`Back to ${lead.label}`}>
              <ChevronLeft aria-hidden="true" className="size-icon-lg shrink-0" strokeWidth={2.25} />
              {lead.label}
            </Link>
          ) : (
            <TodayDate />
          )}
          {customiseHref ? (
            <Link href={customiseHref} className="mode-band__customise" aria-label="Customise">
              <Settings2 aria-hidden="true" className="size-icon-lg shrink-0" strokeWidth={2} />
              <span className="mode-band__customise-label" aria-hidden="true">
                Customise
              </span>
            </Link>
          ) : (
            // A page's own action (My Day's Edit) takes Customise's place.
            <span id={modeBandActionSlotId} className="contents" />
          )}
        </div>
        {/* Not a heading: each page keeps its own h1 naming the page, which the
            top bar's pill also names; this is the mode's name. */}
        <p className="mode-band__title" data-testid="mode-band-title">
          {heading}
        </p>
        {hasStatus ? (
          <div id={modeBandStatusSlotId} className="mode-band__status" data-testid="mode-band-status">
            {status}
          </div>
        ) : null}
      </div>
      {tabEntries.length > 1 ? (
        <nav aria-label={`${modeName} pages`} className="mode-band__tabs" data-testid="mode-band-tabs">
          <div className="mode-band__tab-row">
            {tabEntries.map((entry) => {
              const count = counts?.[entry.id] ?? 0;
              return (
                <Link
                  key={entry.id}
                  href={entry.href!}
                  className="mode-band__tab"
                  aria-current={entry.id === activeId ? "page" : undefined}
                  aria-label={count > 0 ? `${entry.label}, ${count} to do` : undefined}
                >
                  {entry.label}
                  {count > 0 ? (
                    <span aria-hidden="true" className="mode-band__badge">
                      {count}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
          <span aria-hidden="true" className="mode-band__tab-fade" />
        </nav>
      ) : (
        <div aria-hidden="true" className="mode-band__end" />
      )}
    </header>
  );
}

/**
 * How long ago something was saved, in the words the header uses: "just now",
 * "4 min ago", then the time ("12:35") after an hour, then "yesterday", then
 * the date.
 */
export function savedAgo(savedAt: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - savedAt.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const day = (value: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Perth", dateStyle: "short" }).format(value);
  if (day(savedAt) === day(now)) {
    return new Intl.DateTimeFormat("en-AU", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Australia/Perth",
    }).format(savedAt);
  }
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (day(savedAt) === day(yesterday)) return "yesterday";
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Perth" }).format(
    savedAt,
  );
}

export type ModeBandStatusValue =
  /** Records are saved; the time is when they were last saved or loaded. */
  | { kind: "saved"; at: Date | string; verb?: string }
  | { kind: "offline" }
  /** Never say "Saved" when a save failed. The whole chip retries. */
  | { kind: "error"; onRetry: () => void }
  | { kind: "loading" }
  /** A plain factual line, e.g. "Example records" or "24 indexed sources". */
  | { kind: "text"; text: string; tick?: boolean };

function StatusLine({ value }: { value: ModeBandStatusValue }) {
  // Ages quietly once a minute; the line is not live-announced each tick.
  const time = useClientTime({ updateInterval: value.kind === "saved" ? 60_000 : undefined });
  const now = time ? new Date(time) : null;

  switch (value.kind) {
    case "saved": {
      const at = typeof value.at === "string" ? new Date(value.at) : value.at;
      return (
        <span className="mode-band__saved">
          <Check aria-hidden="true" className="mode-band__saved-tick" strokeWidth={2.5} />
          {value.verb ?? "Saved"} {now ? savedAgo(at, now) : "just now"}
        </span>
      );
    }
    case "offline":
      return (
        <span className="mode-band__chip mode-band__chip--offline">
          <CloudOff aria-hidden="true" className="size-icon-sm shrink-0" strokeWidth={2.25} />
          Offline · changes kept on this phone
        </span>
      );
    case "error":
      return (
        <button type="button" className="mode-band__retry" onClick={value.onRetry}>
          <span className="mode-band__chip mode-band__chip--error">
            <CircleAlert aria-hidden="true" className="size-icon-sm shrink-0" strokeWidth={2.25} />
            Not saved yet ·<span className="mode-band__retry-word">Try again</span>
          </span>
        </button>
      );
    case "loading":
      return <span role="img" aria-label="Loading your records" className="mode-band__loading" />;
    case "text":
      return (
        <span className="mode-band__saved">
          {value.tick ? <Check aria-hidden="true" className="mode-band__saved-tick" strokeWidth={2.5} /> : null}
          {value.text}
        </span>
      );
  }
}

const subscribeNever = () => () => {};

/** A band slot by id: undefined while server rendering, null when absent. */
function useModeBandHost(slotId: string): HTMLElement | null | undefined {
  // React re-reads the snapshot once it has committed, so a slot drawn in the
  // same render as this page is still found.
  return useSyncExternalStore(
    subscribeNever,
    () => document.getElementById(slotId),
    () => undefined,
  );
}

/**
 * A page's status line, drawn in its mode band. With no band above the page
 * it is drawn where it is placed instead, so the page still says it.
 *
 * `role="status"` sits on this wrapper, which only changes when the status
 * itself does: the minute-by-minute ageing of "Saved 4 min ago" is quiet.
 */
export function ModeBandStatus({ value, testId }: { value: ModeBandStatusValue | null; testId?: string }) {
  const shown = useModeBandShown();
  const host = useModeBandHost(modeBandStatusSlotId);
  if (!value) return null;
  const line = (
    <span role="status" data-testid={testId} className="contents">
      <StatusLine value={value} />
    </span>
  );
  if (!shown) return <div className="mode-band__status">{line}</div>;
  return host ? createPortal(line, host) : null;
}

/**
 * A page's own h1. Under a mode band the band and the top bar already name the
 * mode and the page, so the heading stays for screen readers only; anywhere
 * else it is drawn as before.
 */
export function PageTitleUnderBand({ className, children }: { className?: string; children: ReactNode }) {
  const shown = useModeBandShown();
  return <h1 className={shown ? "sr-only" : className}>{children}</h1>;
}

/**
 * A page's one header action, drawn opposite the date in its mode band (where
 * Customise sits on other modes) and styled like Customise there. With no
 * band it is drawn where it is placed, with the page's own look.
 */
export function ModeBandAction({ children }: { children: (underBand: boolean) => ReactNode }) {
  const shown = useModeBandShown();
  const host = useModeBandHost(modeBandActionSlotId);
  if (!shown) return <>{children(false)}</>;
  return host ? createPortal(children(true), host) : null;
}

/** Draws its children only on a page with no mode band above it. */
export function WithoutModeBand({ children }: { children: ReactNode }) {
  return useModeBandShown() ? null : <>{children}</>;
}
