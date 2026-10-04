"use client";

import { Check, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { addDays, mondayOf, perthDateKey, perthTime } from "@/components/teaching/teaching-dates";
import { DayRail, SessionTimeline, TeachingModule, TeachingSwitch } from "@/components/teaching/teaching-modules";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import { joinLabel, sessionHref, sessionRow, weekDays } from "@/components/teaching/teaching-view-model";
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
import { buttonFaceClass } from "@/components/ui/button";
import { cn, textMuted } from "@/components/ui-primitives";
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
const CONTEXT = { teams: [], attendance: [], showTeam: false } as const;

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
    body = (
      <>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-[color:var(--text-heading)]">
            {whatsOnHeading(read.data.healthServices)}
          </p>
          {demoMode ? <span className={cn("shrink-0 text-xs", textMuted)}>Demo · made-up people</span> : null}
        </div>
        {live.length > 0 ? (
          <TeachingModule title="On now" live freshKey="whats-on-now" testId="teaching-whats-on-now">
            <ModeGroupedList mode="teaching">
              {live.map((row) => (
                <ModeRow
                  key={row.occurrenceId}
                  title={row.title}
                  subtitle={`${row.teamName} · until ${perthTime(row.endsAt)}`}
                  trailing={row.joinUrl ? <JoinLink url={row.joinUrl} /> : undefined}
                />
              ))}
            </ModeGroupedList>
          </TeachingModule>
        ) : null}
        <TeachingSwitch value={filter} onChange={setFilter} options={whatsOnFilters(read.data.sessions)} label="Show" />
        <DayRail days={weekDays(monday, rows, today)} value={selected} onChange={setDay} label="Day" />
        {notice ? (
          <p role="status" className="text-sm text-[color:var(--text-heading)]">
            {notice}
          </p>
        ) : (
          <p role="status" className="sr-only" />
        )}
        {dayRows.length === 0 ? (
          <ModeNotice>Nothing on this day.</ModeNotice>
        ) : (
          <SessionTimeline
            testId="teaching-whats-on-list"
            groups={[
              {
                id: selected,
                label: "Sessions",
                count: null,
                rows: dayRows.map((row) => ({
                  ...sessionRow(row, CONTEXT),
                  href: sessionHref(row),
                  meta: [row.teamName, row.venue].filter(Boolean).join(" · "),
                  trailing: row.own ? undefined : (
                    <WeekToggle
                      title={row.title}
                      added={inWeek[row.occurrenceId] ?? row.inMyWeek}
                      onToggle={() => void toggle(row)}
                    />
                  ),
                })),
              },
            ]}
          />
        )}
      </>
    );
  }

  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-whats-on">
      <div className="grid gap-3">
        <h1 className="sr-only">{"What's on"}</h1>
        {body}
      </div>
    </InformationPageShell>
  );
}

/** A row's whole-surface link needs a real `<a>` (cmd-click, middle-click, long-press): `buttonFaceClass` borrows the Button face for it (`ModeActionButton` is icon-only and cannot carry this text). */
function JoinLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(buttonFaceClass({ variant: "primary", size: "sm" }), "no-underline")}
    >
      {joinLabel(url)}
    </a>
  );
}

function WeekToggle({ title, added, onToggle }: { title: string; added: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={added}
      aria-label={added ? `Remove ${title} from my week` : `Add ${title} to my week`}
      onClick={onToggle}
      className={cn(
        focusRing,
        "grid min-h-12 min-w-12 place-items-center rounded-lg",
        added ? textMuted : "text-[color:var(--primary)]",
      )}
    >
      {added ? (
        <>
          <Check aria-hidden="true" className="size-icon-md" />
          <span className="sr-only">In my week</span>
        </>
      ) : (
        <Plus aria-hidden="true" className="size-icon-md" />
      )}
    </button>
  );
}
