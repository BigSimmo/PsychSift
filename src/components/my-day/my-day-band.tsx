"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ModeBand } from "@/components/mode-band/mode-band";

/**
 * My Day's band. Its pages greet the reader, except the week page, which is named for what it shows
 * ("This week") with its date range under it.
 */
export function MyDayBand({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  return (
    <ModeBand modeId="my-day" lead={{ kind: "date" }} title={pathname === "/my-day/week" ? "This week" : "greeting"}>
      {children}
    </ModeBand>
  );
}
