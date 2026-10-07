import type { Metadata } from "next";

import { NotificationsPage } from "@/components/needs-you/notifications-page";

export const metadata: Metadata = {
  title: "Notifications | My Day | PsychSift",
  description:
    "What needs you across On Call, Roster, CPD, Teaching and Admin, overdue first, each opening the page that owns it.",
};

/** My Day › Notifications › To do: the bell's Notification centre as a page (new work mode). */
export default function MyDayNotificationsRoute() {
  return <NotificationsPage />;
}
