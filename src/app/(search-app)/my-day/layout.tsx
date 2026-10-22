import type { ReactNode } from "react";

import { MyDayBand } from "@/components/my-day/my-day-band";
import type { Metadata } from "next";
import { PRIVATE_APP_ROBOTS_METADATA } from "@/lib/crawler-policy";

// Personal work area: kept out of search results (repository audit F-30).
export const metadata: Metadata = {
  robots: PRIVATE_APP_ROBOTS_METADATA,
};

export default function MyDayLayout({ children }: { children: ReactNode }) {
  return <MyDayBand>{children}</MyDayBand>;
}
