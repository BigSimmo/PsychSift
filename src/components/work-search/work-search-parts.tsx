"use client";

import {
  Award,
  BookOpen,
  Briefcase,
  CalendarDays,
  ChevronRight,
  FileText,
  Phone,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { KeyboardEvent, MouseEvent, ReactNode, RefObject } from "react";

import { cn } from "@/components/ui-primitives";
import { formatPerthDay, perthTimeOf } from "@/lib/perth-time";
import type { WorkItem, WorkSearchArea } from "@/lib/work-search/model";
import { highlightWords } from "@/lib/work-search/terms";

/**
 * Shared pieces of the "Search my work" screen, drawn to the locked work-mode
 * mockup (work-mode redesign, owner request 6 Oct 2026) with the work-mode kit's
 * classes (`work-card`, `work-row`, `work-date`, `work-ic`, `work-tag`), which
 * read the area palette from the nearest `data-mode-identity`. Flat: white cards
 * with a hairline, flat tinted icon circles, no lift.
 */

/** An undated record's icon, from the On Call section it is stored in: a contact, a guide or an admin record. */
const SECTION_ICONS: Readonly<Record<string, LucideIcon>> = {
  contacts: Phone,
  referrals: Phone,
  playbook: BookOpen,
  orientation: BookOpen,
  education: BookOpen,
  logistics: FileText,
};

function rowIcon(item: WorkItem): LucideIcon | undefined {
  if (item.kind === "cpd-activity") return Award;
  return item.kind === "entry" && item.facet ? SECTION_ICONS[item.facet] : undefined;
}

/** Each area's mark, as the mockup draws it: calendar, board, award, case, phone. */
export const AREA_ICONS: Readonly<Record<WorkSearchArea, LucideIcon>> = {
  roster: CalendarDays,
  teaching: Presentation,
  cme: Award,
  "my-work": Briefcase,
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

/** The white card every list, answer and notice sits in (the kit's `work-card`). */
export const cardSurface = "work-card";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function utcDay(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function daysFrom(today: string, date: string): number {
  return Math.round((utcDay(date).getTime() - utcDay(today).getTime()) / 86_400_000);
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

/** A flat tinted circle with the record's icon in its area's colour. */
export function AreaIcon({ area, icon }: { area: WorkSearchArea; icon?: LucideIcon }) {
  const Icon = icon ?? AREA_ICONS[area];
  return (
    <span aria-hidden="true" className="work-ic" data-mode-identity={area}>
      <Icon aria-hidden="true" strokeWidth={2} />
    </span>
  );
}

/** The kit's date tile: the weekday (this week) or month (further out), small, over the day. */
export function DateTile({ area, date, today }: { area: WorkSearchArea; date: string; today: string }) {
  const day = utcDay(date);
  const days = daysFrom(today, date);
  const over = days >= 0 && days < 7 ? WEEKDAY_SHORT[day.getUTCDay()] : MONTH_SHORT[day.getUTCMonth()];
  return (
    <span aria-hidden="true" className="work-date" data-mode-identity={area}>
      <span className="work-date__month">{over}</span>
      <span className="work-date__day">{day.getUTCDate()}</span>
    </span>
  );
}

/**
 * A group's heading: the area's tile and name at the left, "3 matches" or a
 * "See all 6" link at the right. Not small caps: the area name is the heading.
 */
export function GroupHead({
  id,
  area,
  icon: Icon,
  label,
  count,
  action,
}: {
  id: string;
  /** The palette the tile wears; none for a neutral group such as Pages. */
  area?: string;
  icon: LucideIcon;
  label: string;
  count?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-5 items-center justify-between gap-3 px-1">
      <h3
        id={id}
        data-mode-identity={area}
        className="m-0 inline-flex min-w-0 items-center gap-2 text-xs font-bold text-[color:var(--text-muted)]"
      >
        <span
          aria-hidden="true"
          className={cn(
            "grid size-5.5 shrink-0 place-items-center rounded-full",
            area
              ? "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
              : "bg-[color:var(--surface-inset)] text-[color:var(--text-muted)]",
          )}
        >
          <Icon aria-hidden="true" className="size-3" strokeWidth={2.2} />
        </span>
        <span className="truncate">{label}</span>
      </h3>
      {action ??
        (count ? (
          <span className="shrink-0 text-2xs font-semibold text-[color:var(--text-muted)]">{count}</span>
        ) : null)}
    </div>
  );
}

/** The small-caps label over a section ("Recent", "Next up"), with an optional action at the right. */
export function SectionLabel({ id, children, action }: { id?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="work-label px-1">
      <h3 id={id} className="m-0 inline-flex items-center gap-2 text-inherit">
        {children}
      </h3>
      {action}
    </div>
  );
}

/** A text action at the right of a label: "Clear", "See all 6". Accent colour, a 48px tap. */
export function LabelAction({
  children,
  onClick,
  ariaLabel,
}: {
  children: ReactNode;
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} className="work-label__link">
      {children}
    </button>
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

/** Marks the typed words inside a title: heavier, on a faint tint of the area's colour, as the mockup does. */
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
            className="rounded-xs bg-[color:color-mix(in_srgb,var(--mode-identity)_12%,transparent)] font-extrabold text-[color:var(--text-heading)] forced-colors:bg-[Mark] forced-colors:text-[MarkText]"
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

export type RowTagTone = "mode" | "amber" | "neutral";

/** A small-caps status word at the end of a row (the kit's `work-tag`): never colour alone. */
export function RowTag({ children, tone = "mode", area }: { children: ReactNode; tone?: RowTagTone; area?: string }) {
  return (
    <span className="work-tag" data-tone={tone === "mode" ? undefined : tone} data-mode-identity={area}>
      {children}
    </span>
  );
}

/** Perth hour of an instant, for "Tonight". */
function perthHour(iso: string): number {
  return Number(perthTimeOf(iso).slice(0, 2));
}

/** The one status word a row carries, worked out from the record alone. */
export function rowTag(
  item: WorkItem,
  today: string,
  now: number,
): { label: string; tone: RowTagTone; area?: string } | null {
  if (item.kind === "renewal" && item.date !== null && item.date < today) return { label: "Overdue", tone: "amber" };
  if (item.startsAt && item.endsAt && Date.parse(item.startsAt) <= now && Date.parse(item.endsAt) > now) {
    return { label: "On now", tone: "mode" };
  }
  if (item.kind === "leave" && /\bApplied for\b/.test(item.detail ?? "")) return { label: "Waiting", tone: "amber" };
  if (item.date === today) {
    if (item.kind === "shift" && item.startsAt && perthHour(item.startsAt) >= 17) {
      return { label: "Tonight", tone: "mode" };
    }
    return { label: "Today", tone: item.kind === "shift" ? "mode" : "neutral" };
  }
  if (item.facet === "presenting") return { label: "Talk", tone: "mode", area: "teaching" };
  return null;
}

/** One record in a list: a date tile or the area's icon, title and line, then its status word. */
export function ResultRow({
  item,
  today,
  now,
  query = "",
  onOpen,
}: {
  item: WorkItem;
  today: string;
  now: number;
  query?: string;
  onOpen: () => void;
}) {
  const dated = showsDateTile(item) && item.date !== null;
  const overdue = item.kind === "renewal" && item.date !== null && item.date < today;
  // A date tile already says the day, so the line under the title leaves it out.
  const line =
    overdue && item.date ? `Lapsed ${formatPerthDay(item.date)}` : dated ? detailWithoutDay(item) : item.detail;
  const tag = rowTag(item, today, now);
  return (
    <li data-mode-identity={item.area}>
      <Link
        href={item.href}
        onClick={onPlainClick(onOpen)}
        data-work-search-result=""
        // Room above for the sticky search box, so a row reached with the arrow keys is never hidden under it.
        className="work-row scroll-mb-6 scroll-mt-40"
      >
        {dated && item.date ? (
          <DateTile area={item.area} date={item.date} today={today} />
        ) : (
          <AreaIcon area={item.area} icon={rowIcon(item)} />
        )}
        <span className="work-row__text">
          <span className="work-row__title">
            <Highlight text={item.title} query={query} />
          </span>
          {line ? <span className="work-row__sub line-clamp-2">{line}</span> : null}
        </span>
        {tag ? (
          <span className="work-row__end">
            <RowTag tone={tag.tone} area={tag.area}>
              {tag.label}
            </RowTag>
          </span>
        ) : dated ? null : (
          <ChevronRight aria-hidden="true" className="work-row__chev" strokeWidth={2} />
        )}
      </Link>
    </li>
  );
}

/** A white card of rows, separated by hairlines. */
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
    <ul aria-labelledby={labelledBy} onKeyDown={onKeyDown} className="work-card work-rows">
      {children}
    </ul>
  );
}

/** A tappable row in a list card that runs an action rather than opening a record. */
export function ActionRow({
  icon,
  tone,
  area,
  children,
  sub,
  trailing,
  onClick,
  href,
  onNavigate,
  weight = "bold",
}: {
  icon: ReactNode;
  /** The icon circle's tint: the accent (default) or an area's colour, or neutral grey. */
  tone?: "mode" | "neutral";
  area?: string;
  children: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  href?: string;
  onNavigate?: () => void;
  weight?: "bold" | "semibold";
}) {
  const body = (
    <>
      <span
        aria-hidden="true"
        className="work-ic"
        data-tone={tone === "neutral" ? "neutral" : undefined}
        data-mode-identity={area}
      >
        {icon}
      </span>
      <span className="work-row__text">
        <span className={cn("work-row__title", weight === "semibold" && "font-semibold")}>{children}</span>
        {sub ? <span className="work-row__sub">{sub}</span> : null}
      </span>
      {trailing ?? <ChevronRight aria-hidden="true" className="work-row__chev" strokeWidth={2} />}
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} onClick={onNavigate ? onPlainClick(onNavigate) : undefined} className="work-row">
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className="work-row">
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
