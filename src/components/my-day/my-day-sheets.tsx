"use client";

import {
  Award,
  Bell,
  CalendarClock,
  CalendarPlus,
  ChevronRight,
  Phone,
  Plane,
  Repeat,
  Sunrise,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { useMyDayDeviceState } from "@/components/my-day/my-day-device-state";
import {
  AreaIcon,
  DateBlock,
  QuietLabel,
  QuietList,
  QuietRow,
  quietCard,
  quietPill,
  quietPrimary,
} from "@/components/my-day/my-day-quiet";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { MY_DAY_CARD_LABELS, MY_DAY_PAGE_CARDS, type MyDayCardId } from "@/lib/my-day/dashboard";
import { myDayActionLabel } from "@/lib/my-day/figures";
import { duePerthDate } from "@/lib/my-day/merge";
import type { MyDayItem, MyDaySourceMode } from "@/lib/my-day/model";
import { shortMonth } from "@/lib/my-day/quiet-figures";
import { withMyDayReturn } from "@/lib/my-day/return-link";
import { formatPerthDay } from "@/lib/roster/shifts/perth-time";

/*
 * My Day's three sheets (work-mode redesign, owner request 6 Oct 2026):
 * Customise (which cards show, over the hidden-card choice already kept on
 * this phone), Quick add (a tile per thing to start, each opening the page
 * that owns it), and Later (tomorrow, or the next rostered day when that is
 * not tomorrow). None of them stores anything new.
 */

const sheetBody = "grid min-w-0 gap-3";

// ---------------------------------------------------------------- customise

/** What each card is, under its name in the Customise sheet. */
const CARD_SUBLINE: Partial<Record<MyDayCardId, string>> = {
  "up-next": "Shift countdown and next talk",
  "next-up": "Next teaching session in the top card",
  flag: "One overdue item",
  "quick-actions": "Four shortcuts",
  "needs-you": "So nothing is missed",
  "this-week": "Week and month",
  cpd: "Hours against your target",
  renewals: "Next 6 months",
  calls: "Counts only, this phone",
  "coming-up": "Next talk and next on call",
  "whos-on": "Your team on shift now",
  "pinned-numbers": "Numbers you pinned in Admin",
  "next-talk": "The talk after tonight",
  glance: "Next leave and next renewal",
  hours: "Rostered hours, week and fortnight",
  "cpd-month": "Hours by month and pace",
  credentials: "Dates from Admin",
  "quick-note": "A note to yourself",
};

/** Cards that cannot be hidden: Needs you is how nothing gets missed. */
export const MY_DAY_ALWAYS_ON: ReadonlySet<MyDayCardId> = new Set(["needs-you"]);

const CUSTOMISE_GROUPS: readonly { readonly id: "today" | "work" | "me"; readonly title: string }[] = [
  { id: "today", title: "Today, top to bottom" },
  { id: "work", title: "On shift" },
  { id: "me", title: "My records" },
];

function SwitchRow({
  id,
  on,
  onToggle,
}: {
  readonly id: MyDayCardId;
  readonly on: boolean;
  readonly onToggle: () => void;
}) {
  const always = MY_DAY_ALWAYS_ON.has(id);
  const subline = CARD_SUBLINE[id];
  const body = (
    <span className="grid min-w-0 flex-1">
      <span className="text-sm-minus font-bold break-words text-[color:var(--work-ink)]">{MY_DAY_CARD_LABELS[id]}</span>
      {subline ? <span className="text-2xs break-words text-[color:var(--text-muted)]">{subline}</span> : null}
    </span>
  );
  if (always) {
    return (
      <li className="flex min-h-12 min-w-0 items-center gap-2.5 py-2" data-testid={`my-day-customise-${id}`}>
        {body}
        <span className="rounded-full bg-[color:var(--work-wash)] px-2 py-0.5 text-3xs font-bold text-[color:var(--text-muted)]">
          Always on
        </span>
      </li>
    );
  }
  return (
    <li className="min-w-0">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={onToggle}
        data-testid={`my-day-customise-${id}`}
        className={cn(focusRing, "flex min-h-12 w-full min-w-0 items-center gap-2.5 rounded-md py-2 text-left")}
      >
        {body}
        <span
          aria-hidden="true"
          className={cn(
            "relative inline-flex h-6 w-10 shrink-0 rounded-full transition-colors motion-reduce:transition-none forced-colors:border",
            on ? "bg-[color:var(--mode-identity)]" : "bg-[color:var(--work-line-strong)]",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 size-5 rounded-full bg-[color:var(--work-surface)] transition-transform motion-reduce:transition-none forced-colors:border",
              on && "translate-x-4",
            )}
          />
        </span>
      </button>
    </li>
  );
}

/**
 * Customise My Day: one switch per card, Today first, then On shift and My
 * records (so a card hidden there can always come back). The choice is the
 * hidden-card list already kept on this phone for this account.
 */
export function MyDayCustomiseSheet({
  open,
  onClose,
  today,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly today: string;
}) {
  const device = useMyDayDeviceState(today);
  const labelId = useId();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Customise My Day"
      description="Kept on this phone for your account"
      testId="my-day-customise-sheet"
      footer={
        <button
          type="button"
          onClick={onClose}
          className={cn(quietPrimary, "w-full")}
          data-testid="my-day-customise-done"
        >
          Done
        </button>
      }
    >
      <div className={sheetBody}>
        {CUSTOMISE_GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`${labelId}-${group.id}`} className="grid min-w-0 gap-1.5">
            <QuietLabel id={`${labelId}-${group.id}`} title={group.title} />
            <ul
              role="list"
              className={cn(quietCard, "grid px-3.5 [&>li+li]:border-t [&>li+li]:border-[color:var(--work-line)]")}
            >
              {MY_DAY_PAGE_CARDS[group.id].map((id) => (
                <SwitchRow
                  key={id}
                  id={id}
                  on={MY_DAY_ALWAYS_ON.has(id) || !device.hidden.has(id)}
                  onToggle={() => device.setHidden(id, !device.hidden.has(id))}
                />
              ))}
            </ul>
          </section>
        ))}
        <p className="m-0 text-2xs text-[color:var(--text-muted)]">
          Hidden cards wait here. A card with nothing to show stays out of the way on its own.
        </p>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- quick add

interface QuickAddTile {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly mode: MyDaySourceMode | "my-day";
  readonly href?: string;
  readonly testId: string;
}

const QUICK_ADD_TILES: readonly QuickAddTile[] = [
  { label: "Remind me", icon: Bell, mode: "my-day", testId: "my-day-add-remind" },
  { label: "Log a call", icon: Phone, mode: "on-call", href: "/on-call/call", testId: "my-day-add-call" },
  { label: "Log CPD", icon: Award, mode: "cme", href: "/cme/new", testId: "my-day-add-cpd" },
  {
    label: "Request leave",
    icon: Plane,
    mode: "roster",
    href: "/roster/requests?start=leave",
    testId: "my-day-add-leave",
  },
  { label: "Swap a shift", icon: Repeat, mode: "roster", href: "/roster/swaps", testId: "my-day-add-swap" },
  {
    label: "Renewal date",
    icon: CalendarPlus,
    mode: "my-work",
    href: "/admin/renewals?record=missing",
    testId: "my-day-add-renewal",
  },
];

function TileBody({ tile }: { readonly tile: QuickAddTile }) {
  return (
    <>
      <AreaIcon mode={tile.mode === "my-day" ? undefined : tile.mode} icon={tile.icon} />
      <span className="text-xs font-bold break-words text-[color:var(--work-ink)]">{tile.label}</span>
    </>
  );
}

const tileClass = cn(
  focusRing,
  quietCard,
  "grid min-h-20 content-center justify-items-center gap-1.5 px-2 py-3 text-center no-underline",
);

/**
 * Quick add: six tiles, each opening the page (or sheet) that owns the thing,
 * and one suggestion from the top CPD row in Needs you when there is one.
 */
export function MyDayQuickAddSheet({
  open,
  onClose,
  dateLine,
  suggested,
  today,
  onRemindMe,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  /** "Tuesday 6 October". */
  readonly dateLine: string;
  /** The top CPD item in Needs you, if any. */
  readonly suggested: MyDayItem | null;
  readonly today: string;
  readonly onRemindMe: () => void;
}) {
  const due = suggested ? (duePerthDate(suggested.due) ?? today) : today;
  return (
    <Sheet open={open} onClose={onClose} title="Quick add" description={dateLine} testId="my-day-quick-add-sheet">
      <div className={sheetBody}>
        <ul role="list" className="grid grid-cols-3 gap-2">
          {QUICK_ADD_TILES.map((tile) => (
            <li
              key={tile.testId}
              className="min-w-0"
              data-mode-identity={tile.mode === "my-day" ? undefined : tile.mode}
            >
              {tile.href ? (
                <Link
                  href={withMyDayReturn(tile.href)}
                  className={tileClass}
                  data-testid={tile.testId}
                  onClick={onClose}
                >
                  <TileBody tile={tile} />
                </Link>
              ) : (
                <button
                  type="button"
                  className={cn(tileClass, "w-full")}
                  data-testid={tile.testId}
                  onClick={onRemindMe}
                >
                  <TileBody tile={tile} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {suggested ? (
          <section aria-label="Suggested" className="grid min-w-0 gap-1.5" data-testid="my-day-add-suggested">
            <QuietLabel title="Suggested" as="h3" />
            <QuietList className={quietCard}>
              <QuietRow
                lead={<DateBlock number={Number(due.slice(8, 10))} word={shortMonth(due)} mode="cme" />}
                title={suggested.title}
                subtitle={suggested.detail ?? "From your CPD"}
                end={
                  <Link
                    href={withMyDayReturn(suggested.href)}
                    className={quietPill}
                    data-mode-identity="cme"
                    aria-label={`${myDayActionLabel(suggested)}: ${suggested.title}`}
                    onClick={onClose}
                  >
                    {myDayActionLabel(suggested)}
                  </Link>
                }
              />
            </QuietList>
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- later

function ChoiceRow({
  icon,
  title,
  subtitle,
  onSelect,
  testId,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly subtitle: ReactNode;
  readonly onSelect: () => void;
  readonly testId: string;
}) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onSelect}
        data-testid={testId}
        className={cn(focusRing, "flex min-h-14 w-full min-w-0 items-center gap-2.5 rounded-md px-3 py-2 text-left")}
      >
        <AreaIcon icon={icon} />
        <span className="grid min-w-0 flex-1">
          <span className="text-sm-minus font-bold break-words text-[color:var(--work-ink)]">{title}</span>
          <span className="text-2xs break-words text-[color:var(--text-muted)]">{subtitle}</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-[color:var(--text-muted)]" />
      </button>
    </li>
  );
}

/**
 * Later, when the next rostered day is not tomorrow (a weekend or days off):
 * hide the row until tomorrow, until the next working day, or set a timed
 * reminder on this phone instead.
 */
export function MyDayLaterSheet({
  item,
  tomorrow,
  nextWorkingDay,
  onClose,
  onPick,
  onRemindMe,
}: {
  readonly item: MyDayItem | null;
  readonly tomorrow: string;
  readonly nextWorkingDay: string;
  readonly onClose: () => void;
  readonly onPick: (item: MyDayItem, until: string) => void;
  readonly onRemindMe: (item: MyDayItem) => void;
}) {
  return (
    <Sheet
      open={item !== null}
      onClose={onClose}
      title="Later"
      description={item?.title ?? ""}
      testId="my-day-later-sheet"
    >
      {item ? (
        <ul role="list" className={cn(quietCard, "grid [&>li+li]:border-t [&>li+li]:border-[color:var(--work-line)]")}>
          <ChoiceRow
            icon={Sunrise}
            title="Tomorrow"
            subtitle={formatPerthDay(tomorrow)}
            onSelect={() => onPick(item, tomorrow)}
            testId="my-day-later-tomorrow"
          />
          <ChoiceRow
            icon={CalendarClock}
            title="Next working day"
            subtitle={`${formatPerthDay(nextWorkingDay)} · your next rostered day`}
            onSelect={() => onPick(item, nextWorkingDay)}
            testId="my-day-later-working-day"
          />
          <ChoiceRow
            icon={Bell}
            title="Remind me at a set time"
            subtitle="A reminder on this phone instead"
            onSelect={() => onRemindMe(item)}
            testId="my-day-later-remind"
          />
        </ul>
      ) : null}
    </Sheet>
  );
}
