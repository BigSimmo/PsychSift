"use client";

import { BellOff, ChevronRight } from "lucide-react";
import Link from "next/link";

import { onCallEntryHref } from "@/components/on-call/on-call-entry-view";
import { focusOnCallEntryFromHash } from "@/components/on-call/on-call-page-anchors";
import { Button } from "@/components/ui/button";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import { onCallNotificationReminderType, type OnCallNotification } from "@/lib/on-call/notifications";
import { REMINDER_TYPES, type ReminderType } from "@/lib/reminders/settings";

/** What a snooze button names, in running text. */
const SNOOZE_NOUNS: Partial<Record<ReminderType, string>> = {
  "compliance-dates": "compliance dates",
  "on-call-checks": "On Call checks",
};

/**
 * What this hub is asking its owner to deal with.
 *
 * ## Why this is a panel and not a second header button
 *
 * `UniversalHeaderTrailingPortal` says in its own docblock that it moves *one*
 * page-owned control into the header, and that `globals.css` stands the
 * new-chat button down "so the region still holds exactly one control". A
 * second portalled button would render — two `createPortal` calls append to the
 * same host — but it would put two controls in a region documented to hold one,
 * on a phone header that was never laid out for two.
 *
 * So the page menu keeps the single trigger and grows a count, and this list
 * opens inside the sheet that trigger already opens. The ellipsis also holds
 * "Add an entry", which on an empty hub is the only way to put anything in;
 * taking that slot for notifications would have left a reader no way to add a
 * row.
 *
 * ## Why the list is derived rather than stored
 *
 * See `src/lib/on-call/notifications.ts`. In short: every item here is already
 * a fact about an entry the reader is holding, so a stored copy could only
 * disagree with the page it points at.
 *
 * ## Nothing here asserts compliance
 *
 * A compliance item says the recorded date has passed and that the record is
 * worth checking. It never says lapsed, expired, valid or current, and there is
 * no tick — the reader may have renewed last week and not updated the row.
 * `recordedExpiryHasPassed` carries the same rule in its own docblock, and
 * `tests/on-call-notifications.test.ts` holds the wording to it.
 */
export function OnCallNotificationsPanel({
  notifications,
  onNavigate,
  onSnooze,
  heading = "Needs attention",
}: {
  notifications: readonly OnCallNotification[];
  /**
   * Group heading. Pass `null` when a parent already names the group (the
   * shared Needs you sheet).
   */
  heading?: string | null;
  /** Closes the sheet the list lives in, so a tap does not leave it open over
   *  the page it just navigated to. */
  onNavigate?: () => void;
  /**
   * Hides one reminder type for a week (Settings, Notifications, Reminders
   * shows it and can resume it). One button per type in the list, because a
   * snooze covers the type, not a single row. Omitted: no buttons.
   */
  onSnooze?: (type: ReminderType) => void;
}) {
  const presentTypes = REMINDER_TYPES.filter((type) =>
    notifications.some((notification) => onCallNotificationReminderType(notification.kind) === type),
  );
  return (
    <section
      aria-labelledby={heading ? "on-call-notifications-heading" : undefined}
      aria-label={heading ? undefined : "On Call"}
      className="grid gap-2"
    >
      {heading ? (
        <h3 id="on-call-notifications-heading" className={eyebrowText}>
          {heading}
        </h3>
      ) : null}

      {notifications.length === 0 ? (
        <p className={cn("text-xs", textMuted)} data-testid="on-call-notifications-empty">
          Nothing right now. A requirement whose recorded date has passed, or an entry nobody has confirmed in a long
          time, appears here.
        </p>
      ) : (
        <ul className="grid gap-1" data-testid="on-call-notifications-list">
          {notifications.map((notification) => (
            <li key={notification.id}>
              <Link
                href={hrefFor(notification)}
                onClick={() => {
                  onNavigate?.();
                  requestAnimationFrame(focusOnCallEntryFromHash);
                }}
                data-testid={`on-call-notification-${notification.kind}`}
                className={cn(
                  "flex min-h-tap items-start gap-2 rounded-md px-2 py-2 no-underline",
                  "text-[color:var(--text)] transition-colors motion-reduce:transition-none",
                  "hover:bg-[color:var(--surface-subtle)]",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                )}
              >
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-semibold text-[color:var(--text-heading)]">{notification.title}</span>
                  <span className={cn("text-xs", textMuted)}>{notification.detail}</span>
                </span>
                <ChevronRight aria-hidden="true" className="ml-auto mt-0.5 size-icon-xs shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {onSnooze && presentTypes.length > 0 ? (
        <div className="flex flex-wrap gap-2" data-testid="on-call-notifications-snooze">
          {presentTypes.map((type) => (
            <Button key={type} variant="ghost" size="sm" icon={BellOff} onClick={() => onSnooze(type)}>
              {`Snooze ${SNOOZE_NOUNS[type] ?? type} for a week`}
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Where a notification goes.
 *
 * Through `onCallViewForEntry`, always — never the entry's stored section, and
 * never a special case on the notification's kind. Two of this mode's pages are
 * views over a stored section, and the entry alone decides which page holds a
 * row.
 *
 * The first version of this keyed on the kind: compliance items to the
 * Compliance view, everything else to `ON_CALL_SECTION_HREFS[section]`. That
 * is right only while a compliance row's date is what raised it. A requirement
 * whose recorded date is still ahead but which nobody has confirmed in a year
 * is raised as `never-verified`, fell through to the section map, and linked to
 * Admin — which filters compliance rows out. The reader would have landed on a
 * page not containing the thing they were just told about. Role explainers,
 * stored as `contacts` but shown under Who's who, had the same fault.
 *
 * `ON_CALL_VIEW_HREFS` is a total map over every view, so this cannot miss.
 */
function hrefFor(notification: OnCallNotification): string {
  return onCallEntryHref(notification.entry);
}
