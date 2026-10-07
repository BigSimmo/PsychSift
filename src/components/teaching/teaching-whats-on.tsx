"use client";

import { Check, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
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
import {
  filterWhatsOn,
  onNow,
  whatsOnFilters,
  whatsOnHeading,
  type WhatsOnFilter,
  type WhatsOnRowRead,
} from "@/components/teaching/whats-on-model";
import { cn } from "@/components/ui-primitives";
import { teachingErrorMessage, teachingPost } from "@/lib/teaching/client";
import type { HealthServiceCode } from "@/lib/teaching/model";
import {
  useSignedOutSampleRead,
  useTeachingDemoMode,
  useTeachingSignedOut,
} from "@/components/teaching/use-teaching-sample";

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

export function TeachingWhatsOn({
  demoMode: serverDemoMode,
  sampleData: serverSample,
}: {
  demoMode: boolean;
  sampleData?: WhatsOnRead;
}) {
  const demoMode = useTeachingDemoMode(serverDemoMode);
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
  const [inWeek, setInWeek] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const rows = useMemo(() => filterWhatsOn(read.data?.sessions ?? [], filter), [read.data, filter]);

  async function toggle(row: WhatsOnRowRead) {
    if (sampleData) {
      setNotice("The sample doesn’t save changes.");
      return;
    }
    const id = row.occurrenceId;
    const next = !(inWeek[id] ?? row.inMyWeek);
    setInWeek((current) => ({ ...current, [id]: next }));
    setNotice(null);
    try {
      const result = await teachingPost<{ inMyWeek: boolean }>("/api/teaching/whats-on", {
        action: next ? "week_add.set" : "week_add.unset",
        occurrenceId: id,
      });
      setInWeek((current) => ({ ...current, [id]: result.inMyWeek }));
    } catch (cause) {
      setInWeek((current) => ({ ...current, [id]: !next }));
      setNotice(teachingErrorMessage(cause));
    }
  }

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
          {demoMode ? (
            <span className="shrink-0 text-xs text-[color:var(--text-muted)]">Demo · made-up people</span>
          ) : null}
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
        {notice ? (
          <p role="status" className="text-xs font-semibold text-[color:var(--danger-text)]">
            {notice}
          </p>
        ) : (
          <p role="status" className="sr-only" />
        )}
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
                        added={inWeek[row.occurrenceId] ?? row.inMyWeek}
                        onToggle={() => void toggle(row)}
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

function WeekToggle({ title, added, onToggle }: { title: string; added: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={added}
      aria-label={added ? `Remove ${title} from my week` : `Add ${title} to my week`}
      onClick={onToggle}
      data-no-tab-swipe=""
      className={cn(focusRing, "grid size-12 shrink-0 place-items-center rounded-full")}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-8 place-items-center rounded-full border-[1.5px]",
          added
            ? "border-transparent bg-[color:var(--work-primary)] text-[color:var(--work-primary-text)]"
            : "border-[color:var(--mode-identity)] text-[color:var(--mode-identity)]",
        )}
      >
        {added ? <Check aria-hidden="true" className="size-4" /> : <Plus aria-hidden="true" className="size-4" />}
      </span>
      {added ? <span className="sr-only">In my week</span> : null}
    </button>
  );
}
