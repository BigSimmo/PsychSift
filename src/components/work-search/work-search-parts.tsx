"use client";

import { Award, CalendarDays, ChevronRight, Folder, GraduationCap, Phone, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { KeyboardEvent, MouseEvent, ReactNode, RefObject } from "react";

import { cn } from "@/components/ui-primitives";
import { workSearchAreaLabels, type WorkItem, type WorkSearchArea } from "@/lib/work-search/model";
import { highlightWords } from "@/lib/work-search/terms";

/** Shared pieces of the "Search my work" screen, drawn to the approved mock-up. */

export const AREA_ICONS: Readonly<Record<WorkSearchArea, LucideIcon>> = {
  roster: CalendarDays,
  teaching: GraduationCap,
  cme: Award,
  "my-work": Folder,
  "on-call": Phone,
};

/**
 * Runs `then` only for a plain click. Ctrl/Cmd/Shift-click and middle-click open a
 * new tab, so the search should stay open behind them.
 */
export function onPlainClick(then: () => void) {
  return (event: MouseEvent<HTMLElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    then();
  };
}

export const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

/** The white, bordered card every list and answer sits in. */
export const cardSurface =
  "rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] shadow-[var(--e2)]";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function utcDay(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function daysFrom(today: string, date: string): number {
  return Math.round((utcDay(date).getTime() - utcDay(today).getTime()) / 86_400_000);
}

/** "Today", "Tomorrow", a weekday within the week, else "12 Oct". */
export function relativeDay(today: string, date: string): string {
  const days = daysFrom(today, date);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  const day = utcDay(date);
  if (days > 1 && days < 7) return WEEKDAY_LONG[day.getUTCDay()] ?? date;
  return `${day.getUTCDate()} ${MONTH_SHORT[day.getUTCMonth()]}`;
}

/** "18 October". */
export function dayMonthLong(date: string): string {
  const day = utcDay(date);
  return `${day.getUTCDate()} ${MONTH_LONG[day.getUTCMonth()]}`;
}

/** The item's detail line without its leading day, for rows that show the date in a tile. */
export function detailWithoutDay(item: WorkItem): string | null {
  if (!item.detail) return null;
  if (!item.date) return item.detail;
  const parts = item.detail.split(" · ");
  // Mappers lead with formatPerthDay ("Mon 12 Oct"); a tile already says that.
  if (/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}/.test(parts[0] ?? "")) parts.shift();
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Records that read best with a date tile; forms, guides and CPD activities keep their area icon. */
export function showsDateTile(item: WorkItem): boolean {
  return item.date !== null && item.kind !== "cpd-activity" && item.kind !== "entry";
}

export function AreaTile({ area, size = "sm" }: { area: WorkSearchArea; size?: "sm" | "md" | "lg" }) {
  const Icon = AREA_ICONS[area];
  return (
    <span
      data-mode-identity={area}
      className={cn(
        // The border keeps the tile's shape in dark mode and when the system forces its own colours.
        "grid shrink-0 place-items-center border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
        size === "sm" && "size-9 rounded-xl",
        size === "md" && "size-12 rounded-xl",
        size === "lg" && "size-12 rounded-2xl",
      )}
    >
      <Icon aria-hidden="true" className={size === "sm" ? "size-icon-sm" : "size-icon-md"} />
    </span>
  );
}

/** A date tile: the day number over the weekday (this week) or month (further out). */
export function DateTile({
  area,
  date,
  today,
  overdue = false,
}: {
  area: WorkSearchArea;
  date: string;
  today: string;
  overdue?: boolean;
}) {
  const day = utcDay(date);
  const days = daysFrom(today, date);
  const under = days >= 0 && days < 7 ? WEEKDAY_SHORT[day.getUTCDay()] : MONTH_SHORT[day.getUTCMonth()];
  return (
    <span
      data-mode-identity={area}
      className={cn(
        "grid size-12 shrink-0 content-center justify-items-center rounded-xl leading-none",
        overdue
          ? "border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]"
          : "border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
      )}
    >
      <span className="text-base-minus font-extrabold">{day.getUTCDate()}</span>
      <span className="mt-1 text-2xs font-extrabold uppercase tracking-wider">{under}</span>
    </span>
  );
}

/** Small uppercase heading over a group, with the area's dot and an optional action on the right. */
export function Kicker({
  children,
  area,
  action,
  id,
}: {
  children: ReactNode;
  area?: WorkSearchArea;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-3 px-1 pt-1">
      <h3
        id={id}
        data-mode-identity={area}
        className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-[color:var(--text-muted)]"
      >
        {area ? <span aria-hidden="true" className="size-2 rounded-full bg-[color:var(--mode-identity)]" /> : null}
        {children}
      </h3>
      {action}
    </div>
  );
}

const highlightCache = new Map<string, RegExp | null>();

/** The pattern for the typed words (and their alternatives), matched at the start of a word. */
function highlightPattern(query: string): RegExp | null {
  if (highlightCache.has(query)) return highlightCache.get(query) ?? null;
  const words = highlightWords(query).sort((a, b) => b.length - a.length);
  const pattern =
    words.length === 0
      ? null
      : new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu");
  if (highlightCache.size > 50) highlightCache.clear();
  highlightCache.set(query, pattern);
  return pattern;
}

/** Marks the typed words inside a title: bold and underlined in the area's colour. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const pattern = highlightPattern(query);
  if (!pattern) return <>{text}</>;
  const parts = text.split(pattern);
  // Only a match at the start of a word is marked ("on" in "On call", not in "Consultant").
  const atWordStart = (index: number) => !/[\p{L}\p{N}]$/u.test(parts[index - 1] ?? "");
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 && atWordStart(index) ? (
          <mark
            key={index}
            className="bg-transparent font-extrabold text-inherit underline decoration-[color:var(--mode-identity)] decoration-2 underline-offset-4 forced-colors:bg-[Mark] forced-colors:text-[MarkText]"
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** One record in a list card: a date tile or area icon, title and detail, then a chevron or area tag. */
export function ResultRow({
  item,
  today,
  query = "",
  showArea = false,
  withAreaInDetail = false,
  onOpen,
  compact = false,
}: {
  item: WorkItem;
  today: string;
  query?: string;
  showArea?: boolean;
  withAreaInDetail?: boolean;
  onOpen: () => void;
  compact?: boolean;
}) {
  const dated = showsDateTile(item) && item.date !== null;
  const detail = dated ? detailWithoutDay(item) : item.detail;
  const overdue = item.kind === "renewal" && item.date !== null && item.date < today;
  const line = withAreaInDetail ? [workSearchAreaLabels[item.area], detail].filter(Boolean).join(" · ") : detail;
  return (
    <li data-mode-identity={item.area}>
      <Link
        href={item.href}
        onClick={onPlainClick(onOpen)}
        data-work-search-result=""
        className={cn(
          // Room above for the sticky search box, so a row reached with the arrow keys is never hidden under it.
          "flex scroll-mb-6 scroll-mt-44 items-center gap-3 transition-colors hover:bg-[color:var(--surface-subtle)] motion-reduce:transition-none",
          compact ? "min-h-14 px-1 py-2.5" : "min-h-14 px-3.5 py-2.5",
          focusRing,
        )}
      >
        {dated && item.date ? (
          <DateTile area={item.area} date={item.date} today={today} overdue={overdue} />
        ) : (
          <AreaTile area={item.area} />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-snug text-[color:var(--text-heading)]">
            <Highlight text={item.title} query={query} />
          </span>
          {line ? (
            <span
              className={cn(
                "mt-0.5 block text-xs",
                overdue ? "font-bold text-[color:var(--warning)]" : "text-[color:var(--text-muted)]",
              )}
            >
              {overdue ? `Overdue · ${line}` : line}
            </span>
          ) : null}
        </span>
        {showArea ? (
          <span className="shrink-0 rounded-full bg-[color:var(--mode-identity-soft)] px-2 py-0.5 text-2xs font-bold text-[color:var(--mode-identity)]">
            {workSearchAreaLabels[item.area]}
          </span>
        ) : (
          <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" />
        )}
      </Link>
    </li>
  );
}

/** A white card holding rows separated by hairlines. */
export function ListCard({
  children,
  onKeyDown,
  labelledBy,
}: {
  children: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  labelledBy?: string;
}) {
  return (
    <ul
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      className={cn(cardSurface, "divide-y divide-[color:var(--border)] overflow-hidden")}
    >
      {children}
    </ul>
  );
}

/** A tappable row in a list card that runs an action rather than opening a record. */
export function ActionRow({
  icon,
  children,
  trailing,
  onClick,
  href,
  onNavigate,
}: {
  icon: ReactNode;
  children: ReactNode;
  trailing: ReactNode;
  onClick?: () => void;
  href?: string;
  onNavigate?: () => void;
}) {
  const className = cn(
    "flex min-h-12 w-full items-center gap-3 px-3.5 py-3 text-left text-sm text-[color:var(--text-heading)] transition-colors hover:bg-[color:var(--surface-subtle)] motion-reduce:transition-none",
    focusRing,
  );
  const body = (
    <>
      <span className="shrink-0 text-[color:var(--text-muted)]">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
      <span className="shrink-0 text-[color:var(--text-muted)]">{trailing}</span>
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} onClick={onNavigate ? onPlainClick(onNavigate) : undefined} className={className}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={className}>
          {body}
        </button>
      )}
    </li>
  );
}

/** Arrow keys move between results; ArrowUp from the first goes back to the box. */
export function moveFocus(event: KeyboardEvent<HTMLElement>, inputRef: RefObject<HTMLInputElement | null>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const scope = event.currentTarget.closest("[data-work-search-root]");
  const links = Array.from(scope?.querySelectorAll<HTMLAnchorElement>("[data-work-search-result]") ?? []);
  if (links.length === 0) return;
  const index = links.indexOf(document.activeElement as HTMLAnchorElement);
  event.preventDefault();
  if (event.key === "ArrowDown") links[Math.min(index + 1, links.length - 1)]?.focus();
  else if (index <= 0) inputRef.current?.focus();
  else links[index - 1]?.focus();
}
