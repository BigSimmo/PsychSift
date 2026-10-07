"use client";

import "@/components/needs-you/notification-centre.css";

import { InformationPageShell } from "@/components/information-page-shell";
import { PageTitleUnderBand, useModeBandHeading } from "@/components/mode-band/mode-band";
import { useModeBandShown } from "@/components/mode-band/mode-band-shown";
import {
  NotificationCentreBody,
  notificationCentreDescription,
  useNotificationClock,
} from "@/components/needs-you/needs-you-sheet";
import { useNotificationFeed } from "@/components/needs-you/use-notification-feed";

/** The same body width and gutter as My Day's other pages (`MyDayFrame`). */
const PAGE_WIDTH = "mx-auto grid w-full max-w-2xl min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5 px-3 pt-3 pb-8";

function stay() {}

/**
 * My Day › Notifications › To do: the bell's Notification centre as a page,
 * for readers on the new work mode. The frame band draws the title, the three
 * tabs (To do, Earlier, Settings) and the way back to My Day; this draws the
 * centre's own body with every state it has (loading, signed out, failed,
 * partial, offline, all caught up, nothing in this filter, Undo).
 */
export function NotificationsPage() {
  const clock = useNotificationClock(true);
  const feed = useNotificationFeed({ clock });
  const description = notificationCentreDescription(feed);
  useModeBandHeading({ eyebrow: description });
  const bandShown = useModeBandShown();
  return (
    <InformationPageShell testId="notifications-page" width="bleed" className="bg-[color:var(--work-wash)]">
      <div className={`${PAGE_WIDTH} notify-page`}>
        <header className={bandShown ? "sr-only" : "grid gap-0.5 px-1"} data-testid="notifications-page-header">
          <PageTitleUnderBand className="text-2xl font-bold tracking-tight text-[color:var(--work-ink)]">
            Notifications
          </PageTitleUnderBand>
          <p className="text-sm text-[color:var(--text-muted)]">{description}</p>
        </header>
        <NotificationCentreBody feed={feed} active onNavigate={stay} />
      </div>
    </InformationPageShell>
  );
}
