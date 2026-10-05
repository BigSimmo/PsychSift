"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { PhoneHeaderCollapsePortal } from "@/components/clinical-dashboard/phone-header-collapse-portal";
import { cn } from "@/components/ui-primitives";

type CmeTab = { label: string; href: string; active: boolean };

/** The old addresses stay real pages; these links make their five-page ownership visible. */
export function CmePageTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const year = searchParams.get("year");
  const withYear = (href: string) =>
    year ? `${href}${href.includes("?") ? "&" : "?"}year=${encodeURIComponent(year)}` : href;

  let label: string;
  let tabs: CmeTab[];
  // Year has no inner row: the mode header's Year tab covers both pages, and the
  // year check is reached from the Year page's own "Year check" link.
  if (pathname === "/cme/log" || pathname === "/cme/routines") {
    label = "Log";
    const finish = pathname === "/cme/log" && searchParams.get("tab") === "finish";
    tabs = [
      { label: "Activities", href: withYear("/cme/log"), active: pathname === "/cme/log" && !finish },
      { label: "To finish", href: withYear("/cme/log?tab=finish"), active: finish },
      { label: "Routines", href: withYear("/cme/routines"), active: pathname === "/cme/routines" },
    ];
  } else if (pathname === "/cme/plan" || pathname === "/cme/calendar" || pathname === "/cme/training") {
    label = "Plan";
    tabs = [
      { label: "Goals", href: withYear("/cme/plan"), active: pathname === "/cme/plan" },
      { label: "Calendar", href: withYear("/cme/calendar"), active: pathname === "/cme/calendar" },
      { label: "Training", href: withYear("/cme/training"), active: pathname === "/cme/training" },
    ];
  } else if (pathname === "/cme/learning") {
    label = "Learning";
    const past = searchParams.get("view") === "past";
    tabs = [
      { label: "Upcoming", href: "/cme/learning", active: !past },
      { label: "Past", href: "/cme/learning?view=past", active: past },
    ];
  } else {
    return null;
  }

  return (
    <PhoneHeaderCollapsePortal>
      <nav
        aria-label={`${label} tabs`}
        data-testid="cme-page-tabs"
        className="w-full border-b border-[color:var(--border)] bg-[color:var(--surface)]"
      >
        <div className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-4 sm:px-6">
          {tabs.map((tab) => (
            <Link
              key={tab.label}
              href={tab.href}
              aria-current={tab.active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-tap shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium",
                tab.active
                  ? "border-[color:var(--clinical-accent)] text-[color:var(--text)]"
                  : "border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text)]",
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>
    </PhoneHeaderCollapsePortal>
  );
}
