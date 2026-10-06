"use client";

import { Check, Info } from "lucide-react";
import Link from "next/link";
import { useId } from "react";

import { AlertsQuietRow, ChoiceChips, SheetLabel } from "@/components/alerts/alerts-rows";
import { ModeRow } from "@/components/mode-kit/grouped-list";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { ToggleSwitch } from "@/components/primitive-recipes/feedback";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Select } from "@/components/ui/select";
import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";
import { ALERT_AREAS, LEAD_PHRASES, shortDay, type AlertAreaId, type RosterAlertChoices } from "@/lib/alerts/areas";
import { DEVICE_NAMES, type DeviceKind } from "@/lib/alerts/phone-state";
import {
  isSnoozed,
  MAX_ALERTS_PER_DAY,
  MIN_ALERTS_PER_DAY,
  REMINDER_CALENDAR_REACH,
  REMINDER_TYPE_LABELS,
  resumeReminder,
  updateReminderType,
  type ReminderLeadTime,
  type ReminderSettings,
  type ReminderType,
} from "@/lib/reminders/settings";

/** Each sheet's foot note: a quiet info line, as in the mock-up. */
function SheetNote({ children }: { readonly children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm leading-5 text-[color:var(--text-muted)]">
      <Info aria-hidden="true" strokeWidth={1.5} className="mt-0.5 size-icon-sm shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function DoneButton({ onClose }: { readonly onClose: () => void }) {
  return (
    <Button variant="primary" block onClick={onClose}>
      Done
    </Button>
  );
}

const CALENDAR_NOTES: Partial<Record<ReminderType, string>> = {
  "compliance-dates":
    "Renewals reach your calendar only through a downloaded calendar file, never your shared calendar link.",
  "cpd-routines": "Calendar alerts reach your phone through your calendar link or a downloaded file.",
  "cpd-year-end": "Calendar alerts reach your phone through your calendar link or a downloaded file.",
  teaching: "Calendar alerts reach your phone through your calendar link or a downloaded file.",
};

function leadOptions(type: ReminderType) {
  const leads: Exclude<ReminderLeadTime, "off">[] =
    type === "shifts" ? ["evening-before", "at-time", "1h", "1d"] : ["at-time", "1h", "1d", "1w"];
  return leads.map((value) => ({ value, label: LEAD_PHRASES[value].replace(/^./, (c) => c.toUpperCase()) }));
}

/** One reminder type's calendar choice: a switch, then when (only while it is on). */
function CalendarChoice({
  type,
  label,
  reminders,
  onChange,
}: {
  readonly type: ReminderType;
  readonly label: string;
  readonly reminders: ReminderSettings;
  readonly onChange: (next: ReminderSettings) => void;
}) {
  const whenId = useId();
  const lead = reminders.types[type].calendarAlert;
  const on = lead !== "off";
  return (
    <div className="grid gap-2" data-testid={`alerts-calendar-${type}`}>
      <ul role="list" className={modeModuleSurface}>
        <ModeRow
          title={label}
          subtitle={on ? `On · ${LEAD_PHRASES[lead]}` : "Off"}
          trailing={
            <ToggleSwitch
              enabled={on}
              onToggle={() =>
                onChange(
                  updateReminderType(reminders, type, {
                    calendarAlert: on ? "off" : type === "shifts" ? "evening-before" : "1d",
                  }),
                )
              }
              aria-label={`${label}: calendar alert`}
            />
          }
        />
      </ul>
      {on ? (
        <div className="grid gap-1">
          <SheetLabel id={whenId}>When</SheetLabel>
          <ChoiceChips
            labelledBy={whenId}
            options={leadOptions(type)}
            value={lead as Exclude<ReminderLeadTime, "off">}
            onChange={(value) => onChange(updateReminderType(reminders, type, { calendarAlert: value }))}
            testId={`alerts-when-${type}`}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Screen 10: one area's settings. Where it can reach you, then when. Every
 * switch here is a setting that already works; "On this phone" for areas the
 * phone sender does not cover yet says so instead of offering a switch.
 */
export function AlertsAreaSheet({
  area: areaId,
  open,
  onClose,
  reminders,
  onRemindersChange,
  roster,
  rosterReady,
  rosterMessage,
  onRosterChange,
  device,
  today,
}: {
  readonly area: AlertAreaId | null;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly reminders: ReminderSettings;
  readonly onRemindersChange: (next: ReminderSettings) => void;
  readonly roster: RosterAlertChoices;
  readonly rosterReady: boolean;
  /** Why the last Roster change didn't save, shown here because the switches are here. */
  readonly rosterMessage: string | null;
  readonly onRosterChange: (which: "changes" | "requests") => void;
  readonly device: DeviceKind;
  readonly today: string;
}) {
  const whereId = useId();
  const calendarId = useId();
  const area = areaId ? ALERT_AREAS[areaId] : null;
  const deviceName = DEVICE_NAMES[device];
  return (
    <Sheet
      open={open && area !== null}
      onClose={onClose}
      title={area?.title ?? "Area"}
      description={area?.description}
      footer={<DoneButton onClose={onClose} />}
      testId="alerts-area-sheet"
    >
      {area ? (
        <div className="grid min-w-0 gap-4">
          <section className="grid gap-2" aria-labelledby={whereId}>
            <SheetLabel id={whereId}>Where</SheetLabel>
            <ul role="list" className={modeModuleSurface}>
              {area.id === "roster" ? (
                roster.phoneOn ? (
                  <>
                    <ModeRow
                      title="Roster changes"
                      subtitle={`On this ${deviceName}, straight away`}
                      trailing={
                        <ToggleSwitch
                          enabled={roster.changes ?? false}
                          disabled={!rosterReady}
                          onToggle={() => onRosterChange("changes")}
                          aria-label="Roster changes on this device"
                        />
                      }
                    />
                    <ModeRow
                      title="Swap and open-shift requests"
                      subtitle={`On this ${deviceName}, except while you're working a night`}
                      trailing={
                        <ToggleSwitch
                          enabled={roster.requests ?? false}
                          disabled={!rosterReady}
                          onToggle={() => onRosterChange("requests")}
                          aria-label="Swap and open-shift requests on this device"
                        />
                      }
                    />
                  </>
                ) : (
                  <AlertsQuietRow
                    title={`On this ${deviceName}`}
                    reason={`Turn on phone alerts under This ${deviceName === "computer" ? "computer" : "phone"} first`}
                  />
                )
              ) : (
                <AlertsQuietRow title={`On this ${deviceName}`} reason="Arrives with the next update" />
              )}
              {area.myDayTypes.length === 0 ? (
                <ModeRow
                  title="In My Day"
                  subtitle="Always, so a date is never missed"
                  trailing={
                    <span className="pr-3">
                      <Check aria-hidden="true" className="size-icon-md text-[color:var(--text-muted)]" />
                      <span className="sr-only">Always on</span>
                    </span>
                  }
                />
              ) : (
                area.myDayTypes.map((type) => {
                  const settings = reminders.types[type];
                  const snoozed = isSnoozed(reminders, type, today) && settings.snoozedUntil;
                  return (
                    <ModeRow
                      key={type}
                      title="In My Day"
                      subtitle={
                        snoozed
                          ? `Snoozed until ${shortDay(settings.snoozedUntil!)}`
                          : settings.showInApp
                            ? "Shown on your Today list"
                            : "Hidden"
                      }
                      trailing={
                        snoozed ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onRemindersChange(resumeReminder(reminders, type))}
                          >
                            Resume
                          </Button>
                        ) : (
                          <ToggleSwitch
                            enabled={settings.showInApp}
                            onToggle={() =>
                              onRemindersChange(updateReminderType(reminders, type, { showInApp: !settings.showInApp }))
                            }
                            aria-label={`${area.title}: in My Day`}
                          />
                        )
                      }
                    />
                  );
                })
              )}
            </ul>
            {area.id === "roster" && roster.phoneOn && !rosterReady ? (
              <SheetNote>
                {roster.failed
                  ? "Roster settings couldn't be loaded, so these can't be changed right now. Try again shortly."
                  : "Loading your Roster settings…"}
              </SheetNote>
            ) : null}
            {area.id === "roster" && rosterMessage ? (
              <p role="status" className="text-sm leading-5 text-[color:var(--text-muted)]">
                {rosterMessage}
              </p>
            ) : null}
          </section>

          {area.types.some((type) => REMINDER_CALENDAR_REACH[type] !== "none") ? (
            <section className="grid gap-3" aria-labelledby={calendarId}>
              <SheetLabel id={calendarId}>In your calendar</SheetLabel>
              {area.id === "roster" && roster.calendarShifts === false ? (
                <SheetNote>
                  Turn on Shifts on my calendar link in{" "}
                  <Link
                    href="/roster/settings"
                    className={cn(focusRing, "rounded-xs text-[color:var(--clinical-accent)] underline")}
                  >
                    Roster settings
                  </Link>{" "}
                  first.
                </SheetNote>
              ) : (
                area.types
                  .filter((type) => REMINDER_CALENDAR_REACH[type] !== "none")
                  .map((type) => (
                    <CalendarChoice
                      key={type}
                      type={type}
                      label={
                        area.types.length > 1
                          ? REMINDER_TYPE_LABELS[type]
                          : type === "shifts"
                            ? "Your next shift"
                            : "Calendar alert"
                      }
                      reminders={reminders}
                      onChange={onRemindersChange}
                    />
                  ))
              )}
              {area.types.map((type) => CALENDAR_NOTES[type]).find(Boolean) ? (
                <SheetNote>{area.types.map((type) => CALENDAR_NOTES[type]).find(Boolean)}</SheetNote>
              ) : null}
            </section>
          ) : (
            <SheetNote>These aren&apos;t calendar dates, so they can&apos;t reach your calendar.</SheetNote>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const value = `${String(hour).padStart(2, "0")}:00`;
  return { value, label: value };
});

function timeOptions(current: string) {
  return HOUR_OPTIONS.some((option) => option.value === current)
    ? HOUR_OPTIONS
    : [...HOUR_OPTIONS, { value: current, label: current }].sort((a, b) => a.value.localeCompare(b.value));
}

/** Quiet hours: on or off, from and until, Perth time. */
export function AlertsQuietHoursSheet({
  open,
  onClose,
  reminders,
  onChange,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly reminders: ReminderSettings;
  readonly onChange: (next: ReminderSettings) => void;
}) {
  const quiet = reminders.quietHours;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Quiet hours"
      description="Perth time"
      footer={<DoneButton onClose={onClose} />}
      testId="alerts-quiet-sheet"
    >
      <div className="grid min-w-0 gap-4">
        <ul role="list" className={modeModuleSurface}>
          <ModeRow
            title="Quiet hours"
            subtitle={quiet.enabled ? `${quiet.start} to ${quiet.end}` : "Off"}
            trailing={
              <ToggleSwitch
                enabled={quiet.enabled}
                onToggle={() => onChange({ ...reminders, quietHours: { ...quiet, enabled: !quiet.enabled } })}
                aria-label="Quiet hours"
              />
            }
          />
        </ul>
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
        <SheetNote>
          A calendar alert that would go off in quiet hours moves to the end of them. Roster phone alerts don&apos;t
          follow quiet hours yet; that arrives with the next update.
        </SheetNote>
      </div>
    </Sheet>
  );
}

/**
 * The morning brief: on or off, and when on workdays and days off (Perth
 * time). After a night it waits until 14:00, and it never breaks through
 * quiet hours (owner decisions 2 and 3, 5 Oct 2026).
 */
export function AlertsBriefSheet({
  open,
  onClose,
  reminders,
  onChange,
  phoneOn,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly reminders: ReminderSettings;
  readonly onChange: (next: ReminderSettings) => void;
  readonly phoneOn: boolean;
}) {
  const brief = reminders.brief;
  const setBrief = (patch: Partial<ReminderSettings["brief"]>) =>
    onChange({ ...reminders, brief: { ...brief, ...patch } });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Morning brief"
      description="One alert instead of many"
      footer={<DoneButton onClose={onClose} />}
      testId="alerts-brief-sheet"
    >
      <div className="grid min-w-0 gap-4">
        <ul role="list" className={modeModuleSurface}>
          <ModeRow
            title="Morning brief"
            subtitle={brief.enabled ? "On" : "Off"}
            trailing={
              <ToggleSwitch
                enabled={brief.enabled}
                onToggle={() => setBrief({ enabled: !brief.enabled })}
                aria-label="Morning brief"
              />
            }
          />
        </ul>
        {brief.enabled ? (
          <div className="grid grid-cols-2 gap-2">
            <Select
              label="Workdays"
              value={brief.workday}
              onChange={(event) => setBrief({ workday: event.target.value })}
              options={timeOptions(brief.workday)}
            />
            <Select
              label="Days off"
              value={brief.dayOff}
              onChange={(event) => setBrief({ dayOff: event.target.value })}
              options={timeOptions(brief.dayOff)}
            />
          </div>
        ) : null}
        <SheetNote>
          A workday is a day with a shift in your roster. After a night shift the brief waits until 14:00, and in quiet
          hours it waits until they end, so a time inside quiet hours means it comes when they finish. Your lock screen
          only says that your brief is ready.
        </SheetNote>
        {brief.enabled && !phoneOn ? (
          <SheetNote>Turn on phone alerts under This phone for the brief to reach you.</SheetNote>
        ) : null}
      </div>
    </Sheet>
  );
}

const CAP_OPTIONS = Array.from({ length: MAX_ALERTS_PER_DAY - MIN_ALERTS_PER_DAY + 1 }, (_, index) => {
  const count = String(MIN_ALERTS_PER_DAY + index);
  return { value: count, label: count };
});

/** How many calendar alerts one day may carry. */
export function AlertsDailyLimitSheet({
  open,
  onClose,
  reminders,
  onChange,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly reminders: ReminderSettings;
  readonly onChange: (next: ReminderSettings) => void;
}) {
  const labelId = useId();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Alerts a day"
      description="The most a single day can carry"
      footer={<DoneButton onClose={onClose} />}
      testId="alerts-limit-sheet"
    >
      <div className="grid min-w-0 gap-4">
        <div className="grid gap-1">
          <SheetLabel id={labelId}>Up to</SheetLabel>
          <ChoiceChips
            labelledBy={labelId}
            options={CAP_OPTIONS}
            value={String(reminders.maxAlertsPerDay)}
            onChange={(value) => onChange({ ...reminders, maxAlertsPerDay: Number(value) })}
            testId="alerts-limit-choices"
          />
        </div>
        <SheetNote>
          On a busy day the most important are kept: renewal dates first, then shifts, CPD year-end, CPD routines and
          teaching. This limit covers calendar alerts today; Roster&apos;s own phone alerts are not counted yet.
        </SheetNote>
      </div>
    </Sheet>
  );
}
