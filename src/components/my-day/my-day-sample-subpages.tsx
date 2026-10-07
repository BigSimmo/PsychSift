"use client";

import { useMemo, type ReactNode } from "react";

import { buildMyDaySample } from "@/components/my-day/my-day-sample";
import { zonedDateOf } from "@/lib/work-time/format";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";

/**
 * The signed-out samples of My Day's Week and Hours pages: the same invented
 * day My Day shows (built in the browser, read from no server, kept nowhere),
 * loaded on demand only for a signed-out visitor. Each page draws it with its
 * own screen through `children`, so this module never imports the pages.
 */
export type MyDaySubpageSample = ReturnType<typeof buildMyDaySample>;

export function MyDaySubpageSampleView({
  now,
  testId,
  children,
}: {
  readonly now: Date;
  readonly testId: string;
  readonly children: (sample: MyDaySubpageSample) => ReactNode;
}) {
  const { zone } = useWorkTimeZone();
  const sample = useMemo(() => buildMyDaySample(zonedDateOf(now, zone), now), [now, zone]);
  return (
    <div className="grid gap-5" data-testid={testId}>
      {children(sample)}
    </div>
  );
}
