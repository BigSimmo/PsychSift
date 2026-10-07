"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ModeBand } from "@/components/mode-band/mode-band";

/**
 * My Day's band. Its pages greet the reader, except the week page, which is named for what it shows
 * ("This week") with its date range under it, and Notifications, which its own tabs name.
 */
export function MyDayBand({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  // Notifications is an inner area with its own first tab, named "Notifications", not a greeting.
  const inNotifications = pathname === "/my-day/notifications" || pathname.startsWith("/my-day/notifications/");
  return (
    <ModeBand
      modeId="my-day"
      lead={{ kind: "date" }}
      title={pathname === "/my-day/week" ? "This week" : inNotifications ? undefined : "greeting"}
    >
      {children}
    </ModeBand>
  );
}
