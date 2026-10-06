"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type RefObject } from "react";

import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { useMyDayItems } from "@/components/my-day/use-my-day-items";
import { OnCallNotificationsPanel } from "@/components/on-call/on-call-notifications";
import { Sheet } from "@/components/ui/sheet";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import { myDayEnabledForAuth } from "@/lib/my-day/model";
import { groupNeedsYouItems, needsYouModeLabels, needsYouWaitingCopy } from "@/lib/needs-you/groups";
import { useOnCallEntries } from "@/lib/on-call/entry-store";
import { deriveOnCallNotifications, visibleOnCallNotifications } from "@/lib/on-call/notifications";
import { perthDateKey, snoozeReminder, type ReminderType } from "@/lib/reminders/settings";
import { useAuthSession } from "@/lib/supabase/client";

/**
 * Shared in-app "Needs you" sheet: My Day's sources, grouped by mode, plus the
 * existing On Call notifications list. No lock-screen push.
 */
export function NeedsYouSheet({
  open,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  onClose: (navigated?: boolean) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { status } = useAuthSession();
  const enabled = myDayEnabledForAuth(status);
  const [now] = useState(() => new Date());
  const myDay = useMyDayItems({ enabled, now });
  const { entries } = useOnCallEntries();
  const { preferences, setPreference } = useAppPreferences();
  const reminderToday = perthDateKey(now);
  const onCallNotifications = useMemo(
    () => visibleOnCallNotifications(deriveOnCallNotifications(entries, now), preferences.reminders, reminderToday),
    [entries, now, preferences.reminders, reminderToday],
  );
  const otherGroups = useMemo(
    () => groupNeedsYouItems(myDay.items.filter((item) => item.mode !== "on-call")),
    [myDay.items],
  );
  const waiting = otherGroups.reduce((sum, group) => sum + group.items.length, 0) + onCallNotifications.length;
  const description = myDay.status === "loading" ? "Checking what needs you." : needsYouWaitingCopy(waiting);

  const snooze = (type: ReminderType) =>
    setPreference("reminders", snoozeReminder(preferences.reminders, type, reminderToday));

  return (
    <Sheet
      open={open}
      onClose={() => onClose()}
      title="Needs you"
      description={description}
      closeLabel="Close needs you"
      returnFocusRef={returnFocusRef}
      portal
      testId="needs-you-sheet"
    >
      {myDay.status === "signed-out" ? (
        <p className={cn("text-sm", textMuted)} data-testid="needs-you-signed-out">
          Sign in to see what needs you.
        </p>
      ) : myDay.status === "loading" ? (
        <p className={cn("text-sm", textMuted)} data-testid="needs-you-loading">
          Checking what needs you.
        </p>
      ) : waiting === 0 ? (
        <p className={cn("text-sm", textMuted)} data-testid="needs-you-empty">
          Nothing needs you right now.
        </p>
      ) : (
        <div className="grid gap-5">
          {onCallNotifications.length > 0 ? (
            <section aria-labelledby="needs-you-group-on-call" className="grid gap-2">
              <h3 id="needs-you-group-on-call" className={eyebrowText}>
                {needsYouModeLabels["on-call"]}
              </h3>
              <OnCallNotificationsPanel
                notifications={onCallNotifications}
                heading={null}
                onNavigate={() => onClose(true)}
                onSnooze={snooze}
              />
            </section>
          ) : null}
          {otherGroups.map((group) => (
            <section key={group.mode} aria-labelledby={`needs-you-group-${group.mode}`} className="grid gap-2">
              <h3 id={`needs-you-group-${group.mode}`} className={eyebrowText}>
                {group.label}
              </h3>
              <ul className="grid gap-1" data-testid={`needs-you-group-${group.mode}`}>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      onClick={() => onClose(true)}
                      data-testid={`needs-you-item-${item.id}`}
                      className={cn(
                        "flex min-h-tap items-start gap-2 rounded-md px-2 py-2 no-underline",
                        "text-[color:var(--text)] transition-colors motion-reduce:transition-none",
                        "hover:bg-[color:var(--surface-subtle)]",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                      )}
                    >
                      <span className="grid min-w-0 gap-0.5">
                        <span className="text-sm font-semibold text-[color:var(--text-heading)]">{item.title}</span>
                        <span className={cn("text-xs", textMuted)}>
                          {item.severity === "overdue"
                            ? item.detail
                              ? `Overdue · ${item.detail}`
                              : "Overdue"
                            : item.severity === "soon"
                              ? item.detail
                                ? `Due soon · ${item.detail}`
                                : "Due soon"
                              : (item.detail ?? group.label)}
                        </span>
                      </span>
                      <ChevronRight aria-hidden="true" className="ml-auto mt-0.5 size-icon-xs shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Sheet>
  );
}
