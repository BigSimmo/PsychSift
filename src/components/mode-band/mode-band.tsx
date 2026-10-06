"use client";

import { Check, ChevronLeft, CircleAlert, CloudOff, Info, Settings2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useEffect,
  useContext,
  useState,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type CSSProperties,
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
import {
  modePageVisible,
  useOpenShiftsIsPoster,
  useRosterHasEnabledTeam,
  useTeachingRoles,
} from "@/lib/teaching/page-visibility";
import { useClientTime } from "@/lib/use-client-time";
import { ModeBandShownContext, useModeBandShown } from "./mode-band-shown";

/**
 * Modes that carry their own identity colour (`data-mode-identity` in
 * globals.css). The rest take the product accent, which the `:root` aliases
 * already resolve `--mode-identity*` to.
 */
const IDENTITY_MODES: ReadonlySet<AppModeId> = new Set([
  "cme",
  "roster",
  "open-shifts",
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
  /** A fixed status line, for a mode whose status never changes on the client. */
  status?: ModeBandStatusValue;
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

const ModeBandCountContext = createContext<(tabId: string, count: number | null) => void>(() => {});
const ModeBandCurrentTabContext = createContext<(tabId: string | null) => void>(() => {});
const ModeBandStatusKindContext = createContext<(kind: ModeBandStatusValue["kind"] | null) => void>(() => {});

/** Counts could be wrong or invented while records are out of reach or examples. */
const COUNTS_HIDDEN: ReadonlySet<ModeBandStatusValue["kind"]> = new Set([
  "offline",
  "loading",
  "sample",
  "failed",
  "error",
]);

/**
 * Puts a page's to-do count on one of its mode's tabs ("Log 3") while that
 * page is open, and takes it off again when the page closes, so the band never
 * shows a count nothing on screen is keeping current. Pass null while the
 * count is unknown. The band hides counts while offline, loading or signed
 * out.
 */
export function useModeBandCount(tabId: string, count: number | null) {
  const setCount = useContext(ModeBandCountContext);
  useEffect(() => {
    setCount(tabId, count);
    return () => setCount(tabId, null);
  }, [setCount, tabId, count]);
}

export { useModeBandShown };

/**
 * Names the current tab when the address alone cannot: My Day switches its
 * pages with ?page= and by swipe, without a navigation. Pass null to fall back
 * to the address. The override ends when the page closes.
 */
export function useModeBandCurrentTab(tabId: string | null) {
  const setCurrentTab = useContext(ModeBandCurrentTabContext);
  useEffect(() => {
    setCurrentTab(tabId);
    return () => setCurrentTab(null);
  }, [setCurrentTab, tabId]);
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
  const now = useClientTime({ updateInterval: 60_000 });
  return <>{now ? greetingFor(new Date(now)) : fallback}</>;
}

const dateLong = new Intl.DateTimeFormat("en-AU", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Australia/Perth",
});

function modeHomePath(modeId: AppModeId): string | undefined {
  const mode = appModeDefinition(modeId);
  return "href" in mode ? mode.href : undefined;
}

function isHidden(pathname: string, hiddenOn: readonly string[] | undefined): boolean {
  return (hiddenOn ?? []).some((path) => (path.endsWith("/") ? pathname.startsWith(path) : pathname === path));
}

/**
 * Today's date, rendered after hydration so a server in another timezone, or a
 * page cached across midnight, can never show yesterday, and checked each
 * minute so a page left open moves on at midnight. The row keeps its height
 * either way.
 */
function TodayDate() {
  const time = useClientTime({ updateInterval: 60_000 });
  if (!time) return <span className="mode-band__date" />;
  const now = new Date(time);
  return <span className="mode-band__date">{dateLong.format(now)}</span>;
}

/**
 * The faint mode icon, drawn as a mask on an empty box rather than as an
 * inline svg. The design crops the icon at the band's right edge; an svg
 * cropped that way still reports its paths' boxes past the screen edge, which
 * the layout checks rightly read as cut-off content. The hidden svg is the
 * source: once mounted, its markup becomes the mask, and the box itself stops
 * at the band's edge.
 */
function ModeMark({ Icon }: { Icon: (typeof appModeIcons)[AppModeId] }) {
  const [source, setSource] = useState<SVGSVGElement | null>(null);
  const mask = useMemo(
    () =>
      source
        ? `url("data:image/svg+xml,${encodeURIComponent(source.outerHTML.replace(/currentColor/g, "black"))}")`
        : null,
    [source],
  );
  return (
    <>
      <Icon ref={setSource} aria-hidden="true" className="hidden" strokeWidth={1.25} />
      <span
        aria-hidden="true"
        className="mode-band__mark"
        data-ready={mask ? "" : undefined}
        style={mask ? ({ "--mode-band-mark": mask } as CSSProperties) : undefined}
      />
    </>
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
 * Scrolls the tab row sideways, never the page, so the current tab is in view
 * when a page opens on a tab past the phone's edge, or when a tab that arrives
 * after loading (Roster's Team, Teaching's Organise) pushes it there.
 */
function useCurrentTabInView(activeId: string | null, tabKey: string) {
  const [row, setRow] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const current = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !current) return;
    const left = current.offsetLeft - row.offsetLeft;
    const right = left + current.offsetWidth;
    if (left < row.scrollLeft || right > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: Math.max(0, left - (row.clientWidth - current.offsetWidth) / 2) });
    }
  }, [row, activeId, tabKey]);
  // The edge fade shows only while a tab is still cut off to the right, so it
  // never dims the last tab once the row is scrolled to its end, or fits.
  useLayoutEffect(() => {
    const nav = row?.parentElement;
    if (!row || !nav) return;
    const update = () => {
      nav.toggleAttribute("data-more", row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
    };
    update();
    row.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(row);
    return () => {
      row.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [row, tabKey]);
  return setRow;
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
/**
 * The tab naming this page. The shared page list answers for most modes; a mode
 * it has no rule for (First Nations) still marks a tab whose link is this page.
 */
function bandActiveId(modeId: AppModeId, pathname: string): string | null {
  return (
    activeModeSecondaryNavigationId(modeId, pathname) ??
    modeSecondaryNavigationEntries(modeId).find((entry) => entry.href?.split(/[?#]/)[0] === pathname)?.id ??
    null
  );
}

export function ModeBand({ children, counts, ...props }: ModeBandProps) {
  const pathname = usePathname() ?? "";
  const [pageCounts, setPageCounts] = useState<Readonly<Record<string, number>>>({});
  const setCount = useCallback((tabId: string, count: number | null) => {
    setPageCounts((current) => {
      if ((current[tabId] ?? null) === count) return current;
      const next = { ...current };
      if (count === null) delete next[tabId];
      else next[tabId] = count;
      return next;
    });
  }, []);
  const allCounts = useMemo(() => ({ ...counts, ...pageCounts }), [counts, pageCounts]);
  const [pageStatusKind, setPageStatusKind] = useState<ModeBandStatusValue["kind"] | null>(null);
  const statusKind = pageStatusKind ?? props.status?.kind ?? null;
  const hideCounts = statusKind !== null && COUNTS_HIDDEN.has(statusKind);
  const [pageTabId, setPageTabId] = useState<string | null>(null);
  const activeId = pageTabId ?? bandActiveId(props.modeId, pathname);
  const shown =
    !isHidden(pathname, props.hiddenOn) &&
    (activeId !== null || pathname === (props.homePath ?? modeHomePath(props.modeId)));
  return (
    <ModeBandShownContext.Provider value={shown}>
      <ModeBandCountContext.Provider value={setCount}>
        <ModeBandStatusKindContext.Provider value={setPageStatusKind}>
          <ModeBandCurrentTabContext.Provider value={setPageTabId}>
            {shown ? (
              <ModeBandHeader {...props} counts={hideCounts ? undefined : allCounts} activeId={activeId} />
            ) : null}
            {children}
          </ModeBandCurrentTabContext.Provider>
        </ModeBandStatusKindContext.Provider>
      </ModeBandCountContext.Provider>
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
  const openShiftsPoster = useOpenShiftsIsPoster();

  // The same pages the top bar's page list offers this reader, in its order:
  // flagged-off and editor-only pages, and the "tools" and "more" groups, stay
  // in the page list only.
  const tabEntries = useMemo(() => {
    if (!tabs) return [];
    const visible = visibleModeSecondaryNavigationEntries(
      modeSecondaryNavigationEntries(modeId).filter((entry) =>
        modePageVisible(modeId, entry.id, teachingRoles, rosterHasTeam, openShiftsPoster),
      ),
      { isEditor: false },
    );
    return groupModeSecondaryNavigationEntries(visible).main.filter((entry) => entry.href);
  }, [tabs, modeId, teachingRoles, rosterHasTeam, openShiftsPoster]);

  usePublishBandSurface(band, modeId);
  const tabRow = useCurrentTabInView(activeId, tabEntries.map((entry) => entry.id).join(" "));

  const Icon = appModeIcons[modeId];
  const modeName = appModeDefinition(modeId).label;
  const heading = title === "greeting" ? <GreetingTitle fallback={modeName} /> : (title ?? modeName);
  const hasStatus =
    status !== undefined || (Array.isArray(statusSlot) ? statusSlot.includes(pathname) : Boolean(statusSlot));

  return (
    // A named region, so everything on the page sits in a landmark; a header
    // element would add a second page banner beside the top bar's.
    <section
      ref={setBand}
      aria-label={modeName}
      className="mode-band"
      data-testid="mode-band"
      data-mode-identity={IDENTITY_MODES.has(modeId) ? modeId : undefined}
    >
      <ModeMark Icon={Icon} />
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
            {status ? (
              <span
                role={status.kind === "error" ? "alert" : "status"}
                data-mode-band-status={status.kind}
                className="contents"
              >
                <StatusLine value={status} />
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {tabEntries.length > 1 ? (
        <nav aria-label={`${modeName} pages`} className="mode-band__tabs" data-testid="mode-band-tabs">
          <div ref={tabRow} className="mode-band__tab-row">
            {tabEntries.map((entry) => {
              const count = counts?.[entry.id] ?? 0;
              return (
                <Link
                  key={entry.id}
                  href={entry.href!}
                  className="mode-band__tab"
                  aria-current={entry.id === activeId ? "page" : undefined}
                >
                  {entry.label}
                  {count > 0 ? (
                    // Hidden as a whole (the figure and its spoken words) when
                    // the band hides counts, so a screen reader never hears one
                    // that is not on screen.
                    <span className="mode-band__badge">
                      <span aria-hidden="true">{count}</span>
                      <span className="sr-only">, {count} to do</span>
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
    </section>
  );
}

const perthTime = new Intl.DateTimeFormat("en-AU", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Australia/Perth",
});
const perthDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Perth", dateStyle: "short" });
const perthDate = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Perth" });

/**
 * When records were last saved to the account, in 24-hour Perth time: "14:12"
 * today, otherwise "4 Oct 14:12". Never "just now": the line says where the
 * records are, not how fresh they feel.
 */
export function savedAtLabel(savedAt: Date, now: Date): string {
  const time = perthTime.format(savedAt);
  return perthDay.format(savedAt) === perthDay.format(now) ? time : `${perthDate.format(savedAt)} ${time}`;
}

export type ModeBandStatusValue =
  /** Records are in the account; the time is when they were last saved or loaded. */
  | { kind: "saved"; at: Date | string }
  /**
   * The page's records came from the account at this time. Used where the
   * page knows when it loaded them but not when they were last saved, so it
   * never claims a save it cannot see.
   */
  | { kind: "loaded"; at: Date | string }
  /** Part of the page's records did not load: say so, and show no counts. */
  | { kind: "failed"; text: string }
  /** Records live in the account, so offline they are simply out of reach. */
  | { kind: "offline" }
  /** Never say "Saved" when a save failed. The whole line retries. */
  | { kind: "error"; onRetry: () => void }
  | { kind: "loading" }
  /** Signed out: the page shows invented records. */
  | { kind: "sample" }
  /** A plain factual line, e.g. "Practice only · nothing here is saved yet". */
  | { kind: "text"; text: string; info?: boolean };

// The sign-in dialog loads only when someone asks for it.
const AccountSetupDialog = dynamic(
  () => import("@/components/clinical-dashboard/account-setup-dialog").then((module) => module.AccountSetupDialog),
  { ssr: false },
);

function SampleLine() {
  const [signInOpen, setSignInOpen] = useState(false);
  return (
    <span className="mode-band__sentence">
      Made-up example records ·{" "}
      <button type="button" className="mode-band__inline-action" onClick={() => setSignInOpen(true)}>
        Sign in
      </button>{" "}
      to keep your own
      {signInOpen ? <AccountSetupDialog open onClose={() => setSignInOpen(false)} /> : null}
    </span>
  );
}

function StatusLine({ value }: { value: ModeBandStatusValue }) {
  const time = useClientTime({ updateInterval: 60_000 });
  switch (value.kind) {
    case "saved": {
      const at = typeof value.at === "string" ? new Date(value.at) : value.at;
      return (
        <span className="mode-band__saved">
          <Check aria-hidden="true" className="mode-band__saved-tick" strokeWidth={2.5} />
          Saved to your account {savedAtLabel(at, time ? new Date(time) : at)}
        </span>
      );
    }
    case "loaded": {
      const at = typeof value.at === "string" ? new Date(value.at) : value.at;
      return (
        <span className="mode-band__saved">
          <Check aria-hidden="true" className="mode-band__saved-tick" strokeWidth={2.5} />
          In your account · loaded {savedAtLabel(at, time ? new Date(time) : at)}
        </span>
      );
    }
    case "failed":
      return (
        <span className="mode-band__warning">
          <CircleAlert aria-hidden="true" className="mode-band__saved-tick" strokeWidth={2.25} />
          {value.text}
        </span>
      );
    case "offline":
      return (
        <span className="mode-band__saved">
          <CloudOff aria-hidden="true" className="mode-band__saved-tick" strokeWidth={2} />
          Offline · your records reopen when you&apos;re back online
        </span>
      );
    case "error":
      return (
        <button type="button" className="mode-band__retry" onClick={value.onRetry}>
          <span className="mode-band__warning">
            <CircleAlert aria-hidden="true" className="mode-band__saved-tick" strokeWidth={2.25} />
            Not saved · <span className="mode-band__retry-word">Try again</span>
          </span>
        </button>
      );
    case "loading":
      return <span role="img" aria-label="Loading your records" className="mode-band__loading" />;
    case "sample":
      return <SampleLine />;
    case "text":
      return (
        <span className="mode-band__saved">
          {value.info ? <Info aria-hidden="true" className="mode-band__saved-tick" strokeWidth={2} /> : null}
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
 * The wrapper is a polite `role="status"`, or `role="alert"` when a save
 * failed, so only a change of state is announced.
 */
export function ModeBandStatus({ value, testId }: { value: ModeBandStatusValue | null; testId?: string }) {
  const shown = useModeBandShown();
  const host = useModeBandHost(modeBandStatusSlotId);
  const setStatusKind = useContext(ModeBandStatusKindContext);
  const kind = value?.kind ?? null;
  useEffect(() => {
    setStatusKind(kind);
    return () => setStatusKind(null);
  }, [setStatusKind, kind]);
  if (!value) return null;
  // Before hydration the band's slot is empty and so takes no room; this marker
  // tells it to keep the line, so the band does not grow when the status arrives.
  if (shown && host === undefined) return <span hidden data-mode-band-reserve="" />;
  const line = (
    <span
      role={value.kind === "error" ? "alert" : "status"}
      data-testid={testId}
      data-mode-band-status={value.kind}
      className="contents"
    >
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
  return (
    <h1 className={shown ? "sr-only" : className} data-under-band={shown ? "" : undefined}>
      {children}
    </h1>
  );
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
