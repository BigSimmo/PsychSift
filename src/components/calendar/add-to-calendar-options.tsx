"use client";

import { Download } from "lucide-react";

import { ExternalTextLink } from "@/components/ui/link";
import { cn, floatingControl, textMuted } from "@/components/ui-primitives";
import type { CalendarEvent } from "@/lib/calendar/calendar-event";
import { icsFileName, toIcs } from "@/lib/calendar/ics";
import { googleCalendarUrl, outlookCalendarUrl } from "@/lib/calendar/provider-links";
import { guardExampleAction, isExampleRecord } from "@/lib/example-data/guards";
import { applyReminderAlarms, type ReminderSettings } from "@/lib/reminders/settings";

/*
 * Adding one event, or a set of them, to the owner's own calendar: as a file
 * (nothing leaves the device), or through Google's or Outlook's own "add
 * event" page, which only opens when the owner taps it. Shared by the
 * calendar view's sheet and the one calendar's day list.
 */

/**
 * The file carries a calendar alarm on an event only when the owner turned
 * that reminder's "Phone calendar alert" on in Settings; with the defaults it
 * is exactly the file it always was.
 */
export function downloadIcs(events: readonly CalendarEvent[], name: string, reminders: ReminderSettings) {
  const now = new Date();
  const withAlarms = applyReminderAlarms(events, reminders, now);
  const blob = new Blob([toIcs(withAlarms, { name, now })], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = icsFileName(name);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AddToCalendarOptions({
  event,
  reminders,
  example,
}: {
  event: CalendarEvent;
  reminders: ReminderSettings;
  example: boolean;
}) {
  const blocked = example || isExampleRecord(event);
  return (
    <div className="flex flex-col gap-3 pb-2">
      <button
        type="button"
        className={cn(floatingControl, "justify-start")}
        onClick={() => {
          if (!guardExampleAction(blocked, "export")) return;
          downloadIcs([event], event.title, reminders);
        }}
        data-testid="calendar-add-file"
      >
        <Download aria-hidden="true" className="size-icon-sm" />
        Calendar file (Apple, any calendar)
      </button>
      <ExternalTextLink
        href={googleCalendarUrl(event)}
        tone="inherit"
        className={cn(floatingControl, "justify-start no-underline")}
        onClick={(click) => {
          if (!guardExampleAction(blocked, "export")) click.preventDefault();
        }}
        data-testid="calendar-add-google"
      >
        Google Calendar
      </ExternalTextLink>
      <ExternalTextLink
        href={outlookCalendarUrl(event)}
        tone="inherit"
        className={cn(floatingControl, "justify-start no-underline")}
        onClick={(click) => {
          if (!guardExampleAction(blocked, "export")) click.preventDefault();
        }}
        data-testid="calendar-add-outlook"
      >
        Outlook
      </ExternalTextLink>
      <p className={cn(textMuted, "text-xs")}>
        Google and Outlook open their own page with this event filled in, which sends its title and time to them. The
        calendar file stays on this device.
        {event.recurrence ? " Outlook adds the first date only. Set the repeat there, or use the calendar file." : ""}
      </p>
    </div>
  );
}
