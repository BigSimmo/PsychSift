"use client";

import Link from "next/link";
import { useState } from "react";

import { ToggleSwitch } from "@/components/primitive-recipes/feedback";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn, textMuted } from "@/components/ui-primitives";
import {
  isSnoozed,
  MAX_ALERTS_PER_DAY,
  MIN_ALERTS_PER_DAY,
  perthDateKey,
  REMINDER_CALENDAR_REACH,
  REMINDER_LEAD_TIME_LABELS,
  REMINDER_LEAD_TIMES,
  REMINDER_TYPE_DISPLAY_ORDER,
  REMINDER_TYPE_LABELS,
  resumeReminder,
  updateReminderType,
  type ReminderLeadTime,
  type ReminderSettings,
  type ReminderType,
} from "@/lib/reminders/settings";

/**
 * Settings → Notifications → Reminders.
 *
 * Unlike the three notification switches above it, these work today: they
 * decide which CME and On Call nudges show in the app, and which calendar
 * events carry an alert in the calendar link and in a downloaded file. Every
 * change applies at once, like the rest of Settings, so the on/off controls
 * are switches rather than checkboxes.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-10-03" -> "3 Oct 2026". */
function formatDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

const LEAD_TIME_OPTIONS = REMINDER_LEAD_TIMES.map((value) => ({ value, label: REMINDER_LEAD_TIME_LABELS[value] }));

/** "The evening before" is a fixed-clock-time alarm that only makes sense for a shift's own start; every other row keeps the duration-based choices. */
function leadTimeOptionsFor(type: ReminderType) {
  return type === "shifts"
    ? LEAD_TIME_OPTIONS
    : LEAD_TIME_OPTIONS.filter((option) => option.value !== "evening-before");
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const value = `${String(hour).padStart(2, "0")}:00`;
  return { value, label: value };
});

/** Hourly choices, plus the stored time if it is not on the hour (set on another device, say). */
function timeOptions(current: string) {
  return HOUR_OPTIONS.some((option) => option.value === current)
    ? HOUR_OPTIONS
    : [...HOUR_OPTIONS, { value: current, label: current }].sort((a, b) => a.value.localeCompare(b.value));
}

const CAP_OPTIONS = Array.from({ length: MAX_ALERTS_PER_DAY - MIN_ALERTS_PER_DAY + 1 }, (_, index) => {
  const count = MIN_ALERTS_PER_DAY + index;
  return { value: String(count), label: `At most ${count} ${count === 1 ? "alert" : "alerts"} a day` };
});

const CALENDAR_REACH_NOTES: Partial<Record<ReminderType, string>> = {
  "on-call-checks": "In the app only. These are not calendar dates, so they cannot alert your phone.",
  "compliance-dates":
    "Alerts go only in a downloaded calendar file. Your calendar link never carries compliance dates. My Day always shows them, whatever Show in the app says, so a date is never missed.",
};

export function ReminderSettingsBlock({
  reminders,
  onChange,
  today: pinnedToday,
}: {
  reminders: ReminderSettings;
  onChange: (next: ReminderSettings) => void;
  /** Perth date, for tests. Defaults to today when the block first renders. */
  today?: string;
}) {
  const [openedOn] = useState(() => perthDateKey(new Date()));
  const today = pinnedToday ?? openedOn;
  const quiet = reminders.quietHours;

  return (
    <div className="grid gap-4 px-3.5 py-3.5" data-testid="settings-reminders">
      <div>
        <p id="settings-reminders-heading" className="text-sm font-semibold leading-5 text-[color:var(--text-heading)]">
          Reminders
        </p>
        <p className={cn("mt-0.5 text-xs font-medium leading-5", textMuted)}>
          These work now. They choose which CPD and On Call reminders show in the app, and which dates alert your phone
          through your calendar link or a downloaded calendar file. Nothing is sent anywhere else.{" "}
          <Link href="/my-day/alerts" className="text-[color:var(--clinical-accent)] underline">
            All alerts, including phone alerts
          </Link>
        </p>
      </div>

      <ul className="grid gap-3" aria-labelledby="settings-reminders-heading">
        {REMINDER_TYPE_DISPLAY_ORDER.map((type) => {
          const label = REMINDER_TYPE_LABELS[type];
          const settings = reminders.types[type];
          const headingId = `settings-reminder-${type}-heading`;
          const alertLabelId = `settings-reminder-${type}-alert-label`;
          const reach = REMINDER_CALENDAR_REACH[type];
          const note = CALENDAR_REACH_NOTES[type];
          const snoozed = isSnoozed(reminders, type, today);
          return (
            <li
              key={type}
              data-testid={`settings-reminder-${type}`}
              className="grid gap-2 border-t border-[color:var(--border)]/70 pt-3 first:border-t-0 first:pt-0"
            >
              <p id={headingId} className="text-sm font-semibold leading-5 text-[color:var(--text-heading)]">
                {label}
              </p>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[color:var(--text)]">Show in the app</span>
                <ToggleSwitch
                  enabled={settings.showInApp}
                  onToggle={() => onChange(updateReminderType(reminders, type, { showInApp: !settings.showInApp }))}
                  aria-label={`${label}: Show in the app`}
                />
              </div>
              {reach !== "none" ? (
                <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                  <span id={alertLabelId} className="text-sm text-[color:var(--text)]">
                    Phone calendar alert
                  </span>
                  <Select
                    label={`${label}: Phone calendar alert`}
                    hideLabel
                    aria-labelledby={`${headingId} ${alertLabelId}`}
                    value={settings.calendarAlert}
                    onChange={(event) =>
                      onChange(
                        updateReminderType(reminders, type, {
                          calendarAlert: event.target.value as ReminderLeadTime,
                        }),
                      )
                    }
                    options={leadTimeOptionsFor(type)}
                    fieldClassName="w-full md:w-56"
                  />
                </div>
              ) : null}
              {note ? <p className={cn("text-xs leading-5", textMuted)}>{note}</p> : null}
              {snoozed && settings.snoozedUntil ? (
                <div
                  className="flex items-center justify-between gap-3"
                  data-testid={`settings-reminder-${type}-snoozed`}
                >
                  <p className="text-xs font-medium leading-5 text-[color:var(--text)]">
                    Snoozed until {formatDay(settings.snoozedUntil)}.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Resume ${label}`}
                    onClick={() => onChange(resumeReminder(reminders, type))}
                  >
                    Resume
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="grid gap-2 border-t border-[color:var(--border)]/70 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-5 text-[color:var(--text-heading)]">Quiet hours</p>
            <p className={cn("text-xs leading-5", textMuted)}>
              A calendar alert that would go off in quiet hours moves to the end of them. Perth time.
            </p>
          </div>
          <ToggleSwitch
            enabled={quiet.enabled}
            onToggle={() => onChange({ ...reminders, quietHours: { ...quiet, enabled: !quiet.enabled } })}
            aria-label="Quiet hours"
          />
        </div>
        {quiet.enabled ? (
          <div className="grid grid-cols-2 gap-2">
            <Select
              label="From"
              value={quiet.start}
              onChange={(event) => onChange({ ...reminders, quietHours: { ...quiet, start: event.target.value } })}
              options={timeOptions(quiet.start)}
            />
            <Select
              label="Until"
              value={quiet.end}
              onChange={(event) => onChange({ ...reminders, quietHours: { ...quiet, end: event.target.value } })}
              options={timeOptions(quiet.end)}
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-1 border-t border-[color:var(--border)]/70 pt-3">
        <p
          id="settings-reminders-cap-label"
          className="text-sm font-semibold leading-5 text-[color:var(--text-heading)]"
        >
          Daily limit
        </p>
        <p className={cn("text-xs leading-5", textMuted)}>
          On a busy day the most important alerts are kept: compliance dates first, then shifts, CPD year-end, CPD
          routines and teaching.
        </p>
        <Select
          label="Daily limit for calendar alerts"
          hideLabel
          aria-labelledby="settings-reminders-cap-label"
          value={String(reminders.maxAlertsPerDay)}
          onChange={(event) => onChange({ ...reminders, maxAlertsPerDay: Number(event.target.value) })}
          options={CAP_OPTIONS}
          fieldClassName="w-full md:w-56"
        />
      </div>
    </div>
  );
}
