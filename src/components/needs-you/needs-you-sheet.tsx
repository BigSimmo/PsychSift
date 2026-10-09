"use client";

import {
  Award,
  Bell,
  CalendarDays,
  CheckCheck,
  Clock,
  History,
  Phone,
  Presentation,
  RotateCcw,
  Settings,
  ShieldCheck,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import { useRemindMe } from "@/components/alerts/use-remind-me";
import {
  WorkButton,
  WorkChip,
  WorkChips,
  WorkEmpty,
  WorkIconCircle,
  WorkSectionLabel,
} from "@/components/mode-kit/work";
import { useNotificationFeed, type NotificationFeed } from "@/components/needs-you/use-notification-feed";
import { OnCallNotificationsPanel } from "@/components/on-call/on-call-notifications";
import { Sheet } from "@/components/ui/sheet";
import { remindMeClock, remindMeWhenOptions, type Reminder } from "@/lib/alerts/remind-me";
import {
  areaCounts,
  formatNotificationDue,
  formatSnoozeDay,
  groupNotifications,
  inSegment,
  nextWorkingDay,
  notificationAreaLabels,
  notificationSegmentLabels,
  notificationSegments,
  notificationUrgency,
  type NotificationArea,
  type NotificationGroup,
  type NotificationItem,
  type NotificationSegment,
} from "@/lib/needs-you/feed";
import { needsYouWaitingCopy } from "@/lib/needs-you/groups";

/**
 * The Notification centre (work-mode redesign, owner request 6 Oct 2026): the
 * header bell's sheet, upgraded from the shared "Needs you" sheet. One glass
 * sheet titled Notifications, with a settings link to Alerts; a segmented
 * control (All, Action needed, Updates); area chips with counts; the items
 * grouped Overdue, Today, This week and Coming up, each row in its area's colour
 * and opening the page that owns it; Snooze to the next working day and Remind
 * me from any row. On Call keeps its own group and wording (nothing there
 * claims anything about the reader's standing), and its own week-long snooze.
 *
 * Honest states: loading, failed (nothing checked is not nothing due), a
 * partial read naming what did not load, offline (as it last loaded), and
 * "You're all caught up". No push, no new storage: snoozes use My Day's device
 * store and reminders use Remind me's.
 */

export type NeedsYouSheetProps = {
  readonly open: boolean;
  readonly onClose: (navigated?: boolean) => void;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
};

/** What the bell shows: the same count as the sheet's All segment, or null until it is known. */
export type NotificationBadgeSummary = { readonly count: number; readonly overdue: number } | null;

const AREA_ICONS: Readonly<Record<NotificationArea, LucideIcon>> = {
  "on-call": Phone,
  roster: CalendarDays,
  cme: Award,
  teaching: Presentation,
  "my-work": ShieldCheck,
  "my-day": Bell,
};

/**
 * The clock the groups are sorted against: refreshed on open and every minute
 * while open. The Notifications page passes true for as long as it is shown.
 */
export function useNotificationClock(open: boolean): Date {
  const [clock, setClock] = useState(() => new Date());
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setClock(new Date());
  }
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [open]);
  return clock;
}

/** The sheet on its own: it reads its own feed (used where no centre is mounted). */
export function NeedsYouSheet(props: NeedsYouSheetProps) {
  const clock = useNotificationClock(props.open);
  const feed = useNotificationFeed({ clock });
  return <NotificationCentreSheet {...props} feed={feed} />;
}

/**
 * The bell's centre: reads the feed once (after the header is idle), reports
 * the badge count, and draws the sheet when open. The bell and the sheet share
 * this one read, so the badge always matches the All count.
 */
export function NeedsYouCentre({
  onSummary,
  ...props
}: NeedsYouSheetProps & { readonly onSummary: (summary: NotificationBadgeSummary) => void }) {
  const clock = useNotificationClock(props.open);
  const feed = useNotificationFeed({ clock });
  const ready = feed.status === "ready";
  const { count, overdue } = feed.summary;
  useEffect(() => {
    onSummary(ready ? { count, overdue } : null);
  }, [onSummary, ready, count, overdue]);
  return <NotificationCentreSheet {...props} feed={feed} />;
}

function perthClockLabel(date: Date | null): string {
  return date ? remindMeClock(date.getTime()) : "";
}

type UndoNote = { readonly id: number; readonly message: string; readonly undo?: () => void };

/** The line under the centre's title: what is waiting, or why nothing could be checked. */
export function notificationCentreDescription(feed: NotificationFeed): string {
  const { summary, status } = feed;
  return status === "loading"
    ? "Checking what needs you."
    : status === "signed-out"
      ? "Sign in to see what needs you."
      : status === "error"
        ? "Nothing could be checked."
        : summary.overdue > 0
          ? `${needsYouWaitingCopy(summary.count).replace(/\.$/, "")}, ${summary.overdue} overdue.`
          : needsYouWaitingCopy(summary.count);
}

function NotificationCentreSheet({
  open,
  onClose,
  returnFocusRef,
  feed,
}: NeedsYouSheetProps & { readonly feed: NotificationFeed }) {
  const navigate = () => onClose(true);
  return (
    <Sheet
      open={open}
      onClose={() => onClose()}
      title="Notifications"
      description={notificationCentreDescription(feed)}
      closeLabel="Close notifications"
      returnFocusRef={returnFocusRef}
      portal
      testId="needs-you-sheet"
      contentClassName="work-more-sheet notify-sheet"
      headerClassName="work-more-sheet__header"
      titleClassName="work-more-sheet__title"
      closeButtonClassName="work-more-sheet__close"
      bodyClassName="work-more-sheet__body"
      bodyTabIndex={0}
      headerActions={
        <Link
          href="/my-day/alerts"
          onClick={navigate}
          aria-label="Notification settings"
          title="Notification settings"
          className="work-more-sheet__close notify-sheet__settings"
          data-testid="needs-you-settings"
        >
          <Settings aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
        </Link>
      }
    >
      <NotificationCentreBody feed={feed} active={open} onNavigate={navigate} />
    </Sheet>
  );
}

export type NotificationCentreBodyProps = {
  readonly feed: NotificationFeed;
  /**
   * Whether the centre is showing. Going from shown to hidden resets it, so each
   * opening starts on All with nothing expanded. The page passes true.
   */
  readonly active: boolean;
  /** Runs when a row's link is followed (the sheet closes itself; the page does nothing). */
  readonly onNavigate: () => void;
};

/**
 * The Notification centre's body: the segmented control, area chips, grouped
 * rows, row options, snoozed list, notes and Undo bar, with every state the
 * centre has. The bell's sheet and the Notifications page both draw this.
 */
export function NotificationCentreBody({ feed, active, onNavigate }: NotificationCentreBodyProps) {
  const [segment, setSegment] = useState<NotificationSegment>("all");
  const [area, setArea] = useState<NotificationArea | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [note, setNote] = useState<UndoNote | null>(null);
  const noteSeq = useRef(0);
  // An Undo runs after the row's options have closed, so it reads the newest list from here.
  const remindersRef = useRef(feed.reminders);
  useEffect(() => {
    remindersRef.current = feed.reminders;
  }, [feed.reminders]);
  const getReminders = useCallback(() => remindersRef.current, []);

  const showNote = useCallback((message: string, undo?: () => void) => {
    noteSeq.current += 1;
    setNote({ id: noteSeq.current, message, undo });
  }, []);

  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote((current) => (current?.id === note.id ? null : current)), 8000);
    return () => window.clearTimeout(timer);
  }, [note]);

  // Each opening starts on All with nothing expanded.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) {
      setSegment("all");
      setArea(null);
      setExpanded(null);
      setNote(null);
    }
  }

  const { summary, status } = feed;
  const visible = summary.visible;
  const chips = useMemo(() => areaCounts(visible, segment), [visible, segment]);
  // A chosen area with nothing left in this segment falls back to every area.
  const activeArea = area !== null && chips.some((chip) => chip.area === area) ? area : null;
  const shown = visible.filter((item) => inSegment(item, segment) && (activeArea === null || item.area === activeArea));
  // On Call's own notifications keep On Call's panel. Any other On Call item (the
  // example day's) has no panel entry, so it takes an ordinary row instead.
  const onCallShown = shown.filter((item) => item.area === "on-call" && feed.onCall.has(item.id));
  const groups = groupNotifications(
    shown.filter((item) => !onCallShown.includes(item)),
    feed.now,
    "all",
    null,
    feed.zone,
  );
  const segmentCounts = useMemo(
    () =>
      Object.fromEntries(
        notificationSegments.map((key) => [key, visible.filter((item) => inSegment(item, key)).length]),
      ) as Record<NotificationSegment, number>,
    [visible],
  );

  const snoozeDay = nextWorkingDay(feed.today);
  const snoozeDayLabel = formatSnoozeDay(snoozeDay, feed.today);

  const snooze = (item: NotificationItem) => {
    feed.snooze(item.id, snoozeDay);
    setExpanded(null);
    showNote(`Snoozed to ${snoozeDayLabel}`, () => feed.unsnooze(item.id));
  };

  const renderGroup = (group: NotificationGroup) => (
    <section
      key={group.urgency}
      aria-labelledby={`needs-you-urgency-${group.urgency}`}
      className="notify-group"
      data-testid={`needs-you-urgency-${group.urgency}`}
    >
      <WorkSectionLabel as="h3" id={`needs-you-urgency-${group.urgency}`} count={group.items.length}>
        {group.label}
      </WorkSectionLabel>
      <ul className="work-card work-rows notify-list">
        {group.items.map((item) => (
          <NotificationRow
            key={item.id}
            item={item}
            now={feed.now}
            zone={feed.zone}
            snoozeLabel={`Snooze to ${snoozeDayLabel}`}
            reminders={feed.reminders}
            expanded={expanded === item.id}
            onToggle={() => setExpanded((current) => (current === item.id ? null : item.id))}
            onCollapse={() => setExpanded(null)}
            onNavigate={onNavigate}
            onSnooze={() => snooze(item)}
            onNote={showNote}
            getReminders={getReminders}
          />
        ))}
      </ul>
    </section>
  );

  return (
    <div className="notify">
      {!feed.online && status !== "signed-out" ? (
        <div className="notify-note" role="status" data-testid="needs-you-offline">
          <WorkIconCircle icon={WifiOff} tone="neutral" />
          <span className="notify-note__text">
            <b>You are offline</b>
            <small>
              {feed.checkedAt
                ? `This is what loaded at ${perthClockLabel(feed.checkedAt)}. New items appear when you are back online.`
                : "New items appear when you are back online."}
            </small>
          </span>
        </div>
      ) : null}

      {status === "signed-out" ? (
        <WorkEmpty
          icon={Bell}
          title="Your notifications live here"
          body={<span data-testid="needs-you-signed-out">Sign in to see what needs you.</span>}
        />
      ) : status === "loading" ? (
        <NotificationSkeleton />
      ) : status === "error" ? (
        <WorkEmpty
          icon={TriangleAlert}
          title="Notifications did not load"
          body={
            <span data-testid="needs-you-error">
              Nothing was checked, so this is not the same as nothing due. Check your connection and try again.
            </span>
          }
          action={
            <WorkButton variant="secondary" icon={RotateCcw} onClick={feed.retry} testId="needs-you-retry">
              Try again
            </WorkButton>
          }
        />
      ) : (
        <>
          {feed.failed.length > 0 ? (
            <div className="notify-note" data-tone="amber" role="status" data-testid="needs-you-partial">
              <WorkIconCircle icon={TriangleAlert} tone="amber" />
              <span className="notify-note__text">
                <b>{`${listNames(feed.failed.map((source) => source.label))} did not load`}</b>
                <small>Items from there may be missing. A missing item means not checked, not nothing due.</small>
                <span className="notify-note__action">
                  <WorkButton variant="secondary" icon={RotateCcw} onClick={feed.retry} testId="needs-you-retry">
                    Try again
                  </WorkButton>
                </span>
              </span>
            </div>
          ) : null}

          {summary.count > 0 ? (
            <>
              <SegmentedControl value={segment} counts={segmentCounts} onChange={setSegment} />
              {chips.length > 1 ? (
                <WorkChips scroll label="Areas">
                  <WorkChip
                    selected={activeArea === null}
                    onClick={() => setArea(null)}
                    count={segmentCounts[segment]}
                    testId="needs-you-area-all"
                  >
                    All
                  </WorkChip>
                  {chips.map((chip) => (
                    <span key={chip.area} className="contents" data-mode-identity={chip.area}>
                      <WorkChip
                        selected={activeArea === chip.area}
                        onClick={() => setArea(activeArea === chip.area ? null : chip.area)}
                        count={chip.count}
                        testId={`needs-you-area-${chip.area}`}
                      >
                        {chip.label}
                      </WorkChip>
                    </span>
                  ))}
                </WorkChips>
              ) : null}
            </>
          ) : null}

          {summary.count === 0 && feed.failed.length > 0 ? (
            // Something did not load, so an empty list is not "all caught up".
            <WorkEmpty
              icon={CheckCheck}
              title="Nothing in what loaded"
              body={<span data-testid="needs-you-empty-partial">The areas that loaded have nothing for you.</span>}
            />
          ) : summary.count === 0 ? (
            <WorkEmpty
              icon={CheckCheck}
              title="You're all caught up"
              body={<span data-testid="needs-you-empty">Nothing needs you right now.</span>}
            />
          ) : shown.length === 0 ? (
            <WorkEmpty
              icon={CheckCheck}
              title={segment === "update" ? "No updates" : "Nothing to act on"}
              body={
                <span data-testid="needs-you-filter-empty">
                  {activeArea
                    ? `Nothing in ${notificationAreaLabels[activeArea]} here right now.`
                    : "Nothing here right now."}
                </span>
              }
              action={
                <WorkButton
                  variant="secondary"
                  onClick={() => {
                    setSegment("all");
                    setArea(null);
                  }}
                >
                  Show all
                </WorkButton>
              }
            />
          ) : (
            <>
              {groups.filter((group) => group.urgency !== "later").map(renderGroup)}
              {onCallShown.length > 0 ? (
                <section aria-labelledby="needs-you-group-on-call" className="notify-group notify-oncall">
                  <WorkSectionLabel as="h3" id="needs-you-group-on-call" count={onCallShown.length}>
                    {notificationAreaLabels["on-call"]}
                  </WorkSectionLabel>
                  <div data-mode-identity="on-call">
                    <OnCallNotificationsPanel
                      notifications={onCallShown
                        .map((item) => feed.onCall.get(item.id))
                        .filter((notification) => notification !== undefined)}
                      heading={null}
                      onNavigate={onNavigate}
                      onSnooze={(type) => {
                        feed.snoozeOnCallType(type);
                        showNote("Snoozed for a week. Notification settings can bring it back.");
                      }}
                    />
                  </div>
                </section>
              ) : null}
              {groups.filter((group) => group.urgency === "later").map(renderGroup)}
            </>
          )}

          {summary.snoozed.length > 0 ? (
            <SnoozedList
              snoozed={summary.snoozed}
              today={feed.today}
              onBringBack={(item) => {
                feed.unsnooze(item.id);
                showNote(`${item.title} is back`);
              }}
            />
          ) : null}

          <p className="notify-stamp" data-tone={feed.failed.length > 0 ? "amber" : undefined}>
            <i aria-hidden="true" />
            {stampText(feed)}
          </p>
          <p className="notify-foot">
            <History aria-hidden="true" strokeWidth={2} />
            <span>
              Each item opens the page that owns it. Snooze hides it until the next working day, on this device only.
            </span>
          </p>
        </>
      )}

      <p className="sr-only" aria-live="polite" role="status">
        {note?.message ?? ""}
      </p>
      <div className="notify-undo-region">
        {note ? (
          <div className="notify-undo" key={note.id} data-testid="needs-you-undo">
            <span>{note.message}</span>
            {note.undo ? (
              <button
                type="button"
                onClick={() => {
                  note.undo?.();
                  setNote(null);
                }}
              >
                Undo
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function stampText(feed: NotificationFeed): string {
  const at = feed.checkedAt ? `Checked ${perthClockLabel(feed.checkedAt)}` : "Checked";
  if (feed.failed.length > 0) return `${at} · ${listNames(feed.failed.map((source) => source.label))} not loaded`;
  const sample = feed.sample ? " · includes example data" : "";
  return `${at} · every area loaded${sample}`;
}

/* ------------------------------------------------------------ segmented */

function SegmentedControl({
  value,
  counts,
  onChange,
}: {
  readonly value: NotificationSegment;
  readonly counts: Readonly<Record<NotificationSegment, number>>;
  readonly onChange: (segment: NotificationSegment) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = notificationSegments.indexOf(value);
    const last = notificationSegments.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    onChange(notificationSegments[next]!);
    refs.current[next]?.focus();
  };
  return (
    <div className="notify-seg" role="radiogroup" aria-label="Show" onKeyDown={onKeyDown}>
      {notificationSegments.map((segment, index) => (
        <button
          key={segment}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={value === segment}
          tabIndex={value === segment ? 0 : -1}
          onClick={() => onChange(segment)}
          className="notify-seg__option"
          data-testid={`needs-you-segment-${segment}`}
        >
          {notificationSegmentLabels[segment]}
          <span className="notify-seg__count">{counts[segment]}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ row */

function NotificationRow({
  item,
  now,
  zone,
  snoozeLabel,
  reminders,
  expanded,
  onToggle,
  onCollapse,
  onNavigate,
  onSnooze,
  onNote,
  getReminders,
}: {
  readonly getReminders: () => readonly Reminder[];
  readonly item: NotificationItem;
  readonly now: Date;
  readonly zone: string;
  readonly snoozeLabel: string;
  readonly reminders: readonly Reminder[];
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onCollapse: () => void;
  readonly onNavigate: () => void;
  readonly onSnooze: () => void;
  readonly onNote: (message: string, undo?: () => void) => void;
}) {
  const actionsId = useId();
  const optionsRef = useRef<HTMLButtonElement>(null);
  const overdue = notificationUrgency(item, now, zone) === "overdue";
  const due = formatNotificationDue(item.due, now, zone);
  const snoozable = item.snoozable !== false;
  const remindable = item.remindable !== false;
  const pending = remindable
    ? reminders.find((reminder) => reminder.doneAt === null && reminder.text === item.title.trim())
    : undefined;
  const hasOptions = snoozable || remindable || Boolean(item.complete);
  const sub = [item.detail, due].filter(Boolean).join(" · ");

  return (
    <li className="notify-row" data-expanded={expanded ? "" : undefined}>
      <div className="notify-row__main">
        <Link
          href={item.href}
          onClick={onNavigate}
          className="work-row notify-row__link"
          data-testid={`needs-you-item-${item.id}`}
        >
          <WorkIconCircle icon={AREA_ICONS[item.area]} leadsTo={item.area} />
          <span className="work-row__text">
            <span className="work-row__title">{item.title}</span>
            <span className="work-row__sub">
              <span data-tone={overdue ? "red" : undefined} className="notify-row__due">
                {sub || notificationAreaLabels[item.area]}
              </span>
              {pending ? (
                <span className="notify-row__reminder">
                  <Bell aria-hidden="true" strokeWidth={2.2} />
                  {`Reminder ${remindMeClock(Date.parse(pending.dueAt))}`}
                </span>
              ) : null}
            </span>
          </span>
          <span className="sr-only">{`, ${notificationAreaLabels[item.area]}`}</span>
        </Link>
        {hasOptions ? (
          <button
            ref={optionsRef}
            type="button"
            className="notify-row__more"
            aria-label={`Options for ${item.title}`}
            aria-expanded={expanded}
            aria-controls={expanded ? actionsId : undefined}
            onClick={onToggle}
            data-testid={`needs-you-options-${item.id}`}
          >
            <span aria-hidden="true" className="notify-row__dots">
              <i />
              <i />
              <i />
            </span>
          </button>
        ) : null}
      </div>
      {expanded ? (
        <RowActions
          id={actionsId}
          item={item}
          now={now}
          snoozeLabel={snoozable ? snoozeLabel : null}
          remindable={remindable}
          onSnooze={onSnooze}
          onNote={onNote}
          getReminders={getReminders}
          onDone={() => {
            onCollapse();
            requestAnimationFrame(() => optionsRef.current?.focus());
          }}
        />
      ) : null}
    </li>
  );
}

function RowActions({
  id,
  item,
  now,
  snoozeLabel,
  remindable,
  onSnooze,
  onNote,
  onDone,
  getReminders,
}: {
  readonly getReminders: () => readonly Reminder[];
  readonly id: string;
  readonly item: NotificationItem;
  readonly now: Date;
  readonly snoozeLabel: string | null;
  readonly remindable: boolean;
  readonly onSnooze: () => void;
  readonly onNote: (message: string, undo?: () => void) => void;
  readonly onDone: () => void;
}) {
  const { add, remove } = useRemindMe();
  const [choosing, setChoosing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Worked out once, when the options open, so a ticking clock never swaps a choice under the finger.
  const [openedAt] = useState(now);
  const options = useMemo(() => remindMeWhenOptions(openedAt, null), [openedAt]);

  const remind = (dueAt: string, label: string) => {
    const result = add(item.title, dueAt);
    if (result === "saved") {
      onDone();
      onNote(`Reminder set for ${label}`, () => {
        const saved = [...getReminders()]
          .reverse()
          .find(
            (reminder) => reminder.text === item.title.trim() && reminder.dueAt === dueAt && reminder.doneAt === null,
          );
        if (saved) remove(saved.id);
      });
      return;
    }
    setProblem(
      result === "unsafe"
        ? "This title can't go in a reminder, because reminders hold no names or patient details. Open the item instead."
        : result === "shared-device"
          ? "This is marked as a shared device, so it keeps no reminders."
          : result === "full"
            ? "This device already holds 20 reminders. Tick one off first."
            : "This phone couldn't save it. Try again.",
    );
  };

  return (
    <div
      id={id}
      className="notify-row__actions"
      role="group"
      aria-label={`Options for ${item.title}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onDone();
        }
      }}
    >
      <div className="notify-row__buttons">
        {item.complete ? (
          <WorkButton
            variant="tinted"
            icon={CheckCheck}
            onClick={() => {
              item.complete?.run();
              onDone();
              onNote(`Marked ${item.complete?.label.toLowerCase() ?? "done"}`);
            }}
            testId={`needs-you-complete-${item.id}`}
          >
            {item.complete.label}
          </WorkButton>
        ) : null}
        {snoozeLabel ? (
          <WorkButton variant="secondary" icon={Clock} onClick={onSnooze} testId={`needs-you-snooze-${item.id}`}>
            {snoozeLabel}
          </WorkButton>
        ) : null}
        {remindable ? (
          <WorkButton
            variant={choosing ? "tinted" : "secondary"}
            icon={Bell}
            onClick={() => {
              setChoosing((value) => !value);
              setProblem(null);
            }}
            testId={`needs-you-remind-${item.id}`}
          >
            Remind me
          </WorkButton>
        ) : null}
      </div>
      {choosing ? (
        <WorkChips label="When">
          {options.map((option) => (
            <WorkChip
              key={option.id}
              selected={false}
              onClick={() => remind(option.dueAt, option.label)}
              testId={`needs-you-remind-${option.id}`}
            >
              {option.label}
            </WorkChip>
          ))}
        </WorkChips>
      ) : null}
      {choosing && !problem ? (
        <p className="notify-row__hint">Kept on this phone only. The words are the item&apos;s title.</p>
      ) : null}
      {problem ? (
        <p className="notify-row__hint" data-tone="amber" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- snoozed */

function SnoozedList({
  snoozed,
  today,
  onBringBack,
}: {
  readonly snoozed: readonly { readonly item: NotificationItem; readonly until: string }[];
  readonly today: string;
  readonly onBringBack: (item: NotificationItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const first = snoozed[0]!;
  const until = formatSnoozeDay(first.until, today);
  return (
    <section className="notify-group" aria-label="Snoozed" data-testid="needs-you-snoozed">
      <div className="work-card">
        <button
          type="button"
          className="work-row notify-snoozed__toggle"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
        >
          <WorkIconCircle icon={Clock} tone="neutral" />
          <span className="work-row__text">
            <span className="work-row__title">{`${snoozed.length} snoozed`}</span>
            <span className="work-row__sub">
              {snoozed.length === 1 ? `${first.item.title}, back ${until}` : `The first comes back ${until}`}
            </span>
          </span>
          <span className="work-row__end">{open ? "Hide" : "Show"}</span>
        </button>
        {open ? (
          <ul id={listId} className="work-rows notify-snoozed__list">
            {snoozed.map(({ item, until: back }) => (
              <li key={item.id} className="work-row">
                <WorkIconCircle icon={AREA_ICONS[item.area]} leadsTo={item.area} size="sm" />
                <span className="work-row__text">
                  <span className="work-row__title">{item.title}</span>
                  <span className="work-row__sub">{`Back ${formatSnoozeDay(back, today)}`}</span>
                </span>
                <WorkButton
                  variant="quiet"
                  onClick={() => onBringBack(item)}
                  aria-label={`Bring back ${item.title}`}
                  testId={`needs-you-unsnooze-${item.id}`}
                >
                  Bring back
                </WorkButton>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- loading */

function NotificationSkeleton() {
  return (
    <div className="notify-group">
      <p className="notify-loading" data-testid="needs-you-loading">
        Checking what needs you.
      </p>
      <ul className="work-card work-rows notify-skeleton" aria-hidden="true">
        {[0, 1, 2].map((key) => (
          <li key={key} className="work-row">
            <span className="notify-skeleton__dot" />
            <span className="work-row__text">
              <span className="notify-skeleton__line" />
              <span className="notify-skeleton__line notify-skeleton__line--short" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
