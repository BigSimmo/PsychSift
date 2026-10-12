"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useState } from "react";

/**
 * The Recent pages recorder draws nothing and only writes after a page settles,
 * so it loads just after the page instead of adding to every page's first download.
 */
const RecentPagesRecorder = dynamic(
  () => import("@/components/recent-pages/recent-pages-recorder").then((m) => m.RecentPagesRecorder),
  { ssr: false },
);

/**
 * Mounted with the page. It only notes whether the reader navigated before the
 * recorder arrived, so the recorder never takes a title still on screen from an
 * earlier page as the name of the one it first sees.
 */
export function RecentPagesRecorderDeferred() {
  const pathname = usePathname();
  const [firstPathname] = useState(pathname);
  const [navigated, setNavigated] = useState(false);
  if (!navigated && pathname !== firstPathname) setNavigated(true);
  return <RecentPagesRecorder navigatedBeforeLoad={navigated} />;
}
