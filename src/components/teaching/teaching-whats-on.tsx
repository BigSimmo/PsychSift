"use client";

import { useMemo, useState } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { WorkTag } from "@/components/mode-kit/work";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import {
  T5Empty,
  T5Heading,
  T5Kicker,
  T5List,
  T5Meta,
  T5Note,
  T5Page,
  T5Panel,
  T5Row,
  T5Section,
  T5Segments,
  T5Time,
} from "@/components/teaching/t5-kit";
import { ActionStrip } from "@/components/teaching/teaching-actions";
import { addDays, mondayOf, perthDateKey, perthTime, shortDayLabel } from "@/components/teaching/teaching-dates";
import { DayRail } from "@/components/teaching/teaching-modules";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import { joinLabel, sessionHref, weekDays } from "@/components/teaching/teaching-view-model";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { useWeekAdd, WeekAddNotice, WeekToggle } from "@/components/teaching/week-add-toggle";
import {
  filterWhatsOn,
  onNow,
  whatsOnFilters,
  whatsOnHeading,
  type WhatsOnFilter,
  type WhatsOnRowRead,
} from "@/components/teaching/whats-on-model";
import type { HealthServiceCode } from "@/lib/teaching/model";
import { useSignedOutSampleRead, useTeachingSignedOut } from "@/components/teaching/use-teaching-sample";

/*
 * What's on (spec §5a): the reader's health service's week, "On now" first
 * with Join, a switch (All / My level / Online), the same day rail as Week,
 * and a plus to add a session to the reader's own week. The server decides
 * which rows a reader sees, so this page never widens them.
 *
 * The GET already answers with the demo programme in demo mode (S9, master
 * plan R8), so this always asks; only the personal write (the plus) is
 * refused there, and that failure shows as the same notice a real refusal
 * would.
 */
type WhatsOnRead = { healthServices: HealthServiceCode[]; sessions: WhatsOnRowRead[] };

export function TeachingWhatsOn({ sampleData: serverSample }: { demoMode: boolean; sampleData?: WhatsOnRead }) {
  const signedOut = useTeachingSignedOut();
  const now = useTeachingNow();
  const today = now ? perthDateKey(now) : null;
  const monday = today ? mondayOf(today) : null;
  // Signed out with no server sample: build the made-up week here, and ask the API for nothing.
  const built = useSignedOutSampleRead<WhatsOnRead>(signedOut && !serverSample, monday, async () => {
    const { demoWhatsOnSessions } = await import("@/lib/teaching/demo-programme");
    return {
      healthServices: ["demo"],
      sessions: demoWhatsOnSessions({ from: monday!, to: addDays(monday!, 6) }, new Date()),
    };
  });
  const sampleData = serverSample ?? built;
  const read = useTeachingResource<WhatsOnRead>(
    monday && !(signedOut && !sampleData) ? `/api/teaching/whats-on?weekStart=${monday}` : null,
    sampleData,
  );
  const [day, setDay] = useState<string | null>(null);
  const [filter, setFilter] = useState<WhatsOnFilter>("all");
  const weekAdd = useWeekAdd(Boolean(sampleData));
  const rows = useMemo(() => filterWhatsOn(read.data?.sessions ?? [], filter), [read.data, filter]);

  let body;
  if (read.status === "signed-out") body = <TeachingSignInNotice />;
  else if (read.status === "offline" || read.status === "error" || read.status === "setup")
    body = <TeachingStateNotice state={read.status} onRetry={read.retry} />;
  else if (!read.data || !now || !today || !monday) body = <ModeModuleSkeleton rows={4} twoLine eyebrow />;
  else {
    const selected = day ?? today;
    const live = onNow(rows, now);
    const dayRows = rows.filter((row) => perthDateKey(row.startsAt) === selected);
    const isToday = selected === today;
    body = (
      <>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm-minus font-bold text-[color:var(--text-heading)]">
            {whatsOnHeading(read.data.healthServices)}
          </p>
        </div>
        {live.length > 0 ? (
          <div className="grid gap-y-2.25" data-testid="teaching-whats-on-now">
            {live.map((row) => (
              <T5Panel hero key={row.occurrenceId} label={`On now: ${row.title}`}>
                <T5Kicker live>{`On now · ${perthTime(row.startsAt)} to ${perthTime(row.endsAt)}`}</T5Kicker>
                <T5Heading>{row.title}</T5Heading>
                <T5Meta>{[row.teamName, row.venue].filter(Boolean).join(" · ")}</T5Meta>
                <ActionStrip
                  surface="hero"
                  className="mt-1"
                  actions={[
                    ...(row.joinUrl
                      ? [{ id: "join", label: joinLabel(row.joinUrl), href: row.joinUrl, external: true }]
                      : []),
                    ...(sessionHref(row)
                      ? [{ id: "details", label: "Details", href: sessionHref(row)!, emphasis: "secondary" as const }]
                      : []),
                  ]}
                />
              </T5Panel>
            ))}
          </div>
        ) : null}
        <T5Segments value={filter} onChange={setFilter} options={whatsOnFilters(read.data.sessions)} label="Show" />
        <div className="work-card px-1">
          <DayRail days={weekDays(monday, rows, today)} value={selected} onChange={setDay} label="Day" />
        </div>
        <WeekAddNotice notice={weekAdd.notice} />
        {dayRows.length === 0 ? (
          <T5Empty>Nothing on this day.</T5Empty>
        ) : (
          <T5Section
            label={isToday ? "Today" : shortDayLabel(selected)}
            right={dayRows.some((row) => !row.own) ? "Tap plus to add to your week" : undefined}
          >
            <T5List testId="teaching-whats-on-list">
              {dayRows.map((row) => (
                <T5Row
                  key={row.occurrenceId}
                  lead={<T5Time time={perthTime(row.startsAt)} />}
                  title={row.title}
                  meta={[row.teamName, row.venue].filter(Boolean).join(" · ")}
                  href={sessionHref(row)}
                  past={Date.parse(row.endsAt) <= now.getTime()}
                  end={
                    row.own ? (
                      <WorkTag tone="mode">In your week</WorkTag>
                    ) : (
                      <WeekToggle
                        title={row.title}
                        added={weekAdd.added(row)}
                        onToggle={() => void weekAdd.toggle(row)}
                      />
                    )
                  }
                />
              ))}
            </T5List>
          </T5Section>
        )}
        <T5Note>Organisers of each session see who checked in</T5Note>
      </>
    );
  }

  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-whats-on">
      <T5Page>
        <h1 className="sr-only">{"What's on"}</h1>
        {body}
      </T5Page>
    </InformationPageShell>
  );
}
