"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState, useSyncExternalStore } from "react";

import { focusRing } from "@/components/card-recipes";
import { cn, pageContainer } from "@/components/ui-primitives";
import { arrivedFromMyDay, isMyDayPathname, MY_DAY_PATH, myDayReturnScope } from "@/lib/my-day/return-link";

/**
 * "‹ My Day" at the top of a page opened from My Day.
 *
 * Mounted once by the shared search-app shell, so no mode page has to know
 * about My Day. It shows when the address carries `?from=my-day`, and stays
 * while the reader moves around inside that same mode (a saved CPD entry that
 * lands on the CPD log keeps the way back). Leaving the mode, or reaching My
 * Day, clears it.
 */
function MyDayReturnLinkInner() {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const [armedScope, setArmedScope] = useState<string | null>(null);
  const scope = myDayReturnScope(pathname);
  const onMyDay = isMyDayPathname(pathname);
  const nextArmed = onMyDay ? null : arrivedFromMyDay(searchParams) ? scope : armedScope === scope ? armedScope : null;
  // Adjusting state from the previous render's, the React-documented way.
  if (nextArmed !== armedScope) setArmedScope(nextArmed);
  if (nextArmed === null) return null;
  return (
    <nav
      aria-label="Return to My Day"
      data-testid="my-day-return"
      className={cn(pageContainer, "-mb-3 px-3 pt-1 sm:-mb-4 sm:px-5 lg:px-7")}
    >
      <Link
        href={MY_DAY_PATH}
        className={cn(
          focusRing,
          "-ml-2 inline-flex min-h-12 items-center gap-0.5 rounded-md px-2 text-sm font-medium text-[color:var(--clinical-accent)] no-underline",
        )}
      >
        <ChevronLeft aria-hidden="true" className="size-icon-sm" />
        My Day
      </Link>
    </nav>
  );
}

function subscribeNoop() {
  return () => undefined;
}

/** Client-only: the marker lives in the address, so nothing is rendered on the server. */
export function MyDayReturnLink() {
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <MyDayReturnLinkInner />
    </Suspense>
  );
}
