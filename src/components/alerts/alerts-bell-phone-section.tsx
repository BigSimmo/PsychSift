"use client";

import { AlertsButtonRow } from "@/components/alerts/alerts-rows";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import type { PhoneAlertState } from "@/lib/alerts/phone-state";
import { notificationAreaLabels } from "@/lib/needs-you/feed";
import { BELL_PHONE_AREAS, type BellPhoneArea, type ReminderSettings } from "@/lib/reminders/settings";

/** The one line the lock screen shows for a bell reminder (the service worker owns the words). */
export const BELL_LOCK_SCREEN_LINE = "Something in My Day needs you";

/** The master row's second line: what will actually happen on this device. */
export function bellPhoneSubtitle(
  settings: ReminderSettings,
  phone: PhoneAlertState,
  shared: boolean,
  quiet: boolean,
): string {
  if (!settings.bellPhone.enabled) return "Off · they still show in the bell";
  if (shared) return "On · not on this shared computer";
  if (phone !== "on") return "On · turn on phone alerts below to get them";
  if (!BELL_PHONE_AREAS.some((area) => settings.bellPhone.areas[area])) return "On · every area is off";
  return quiet ? "On · when each falls due, after quiet hours" : "On · when each falls due";
}

/**
 * Notifications › Settings › Bell reminders (live version switch, Newest only):
 * whether a reminder in the bell that falls due later buzzes the phone, and
 * from which areas. Off by default. The words stay on the phone; the lock
 * screen shows one line that names nothing.
 */
export function AlertsBellPhoneSection({
  reminders,
  onChange,
  phone,
  shared,
  className,
}: {
  readonly reminders: ReminderSettings;
  readonly onChange: (next: ReminderSettings) => void;
  readonly phone: PhoneAlertState;
  readonly shared: boolean;
  readonly className?: string;
}) {
  const bell = reminders.bellPhone;
  const setBell = (next: Partial<ReminderSettings["bellPhone"]>) =>
    onChange({ ...reminders, bellPhone: { ...bell, ...next } });
  const toggleArea = (area: BellPhoneArea) => setBell({ areas: { ...bell.areas, [area]: !bell.areas[area] } });
  const toggleAll = () => setBell({ enabled: !bell.enabled });

  return (
    <ModeGroupedList eyebrow="Bell reminders" testId="alerts-bell-phone" className={className}>
      <AlertsButtonRow
        title="Buzz my phone"
        subtitle={bellPhoneSubtitle(reminders, phone, shared, reminders.quietHours.enabled)}
        onSelect={toggleAll}
        toggle={{ enabled: bell.enabled, label: "Buzz my phone for bell reminders", onToggle: toggleAll }}
        testId="alerts-bell-phone-row"
      />
      {bell.enabled
        ? BELL_PHONE_AREAS.map((area) => (
            <AlertsButtonRow
              key={area}
              title={notificationAreaLabels[area]}
              onSelect={() => toggleArea(area)}
              toggle={{
                enabled: bell.areas[area],
                label: `${notificationAreaLabels[area]} reminders buzz my phone`,
                onToggle: () => toggleArea(area),
              }}
              testId={`alerts-bell-phone-${area}`}
            />
          ))
        : null}
      <ModeRow
        title="Your lock screen shows"
        subtitle={`"${BELL_LOCK_SCREEN_LINE}" and nothing else`}
        testId="alerts-bell-phone-lock-screen"
      />
    </ModeGroupedList>
  );
}
