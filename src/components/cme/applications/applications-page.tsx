"use client";

import { Bell, CalendarDays, ChevronRight, FileText, HeartHandshake, Lock, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import {
  ActionDock,
  CpdFeaturePage,
  flatCard,
  flatRow,
  IconCircle,
  QuietNote,
  SectionLabel,
  useUndoNotice,
} from "@/components/cme/cpd-feature-kit";
import { RefereeList, RefereeSheet, type RefereeDraft } from "@/components/cme/applications/applications-referees";
import { SeasonDateSheet, SeasonRail, type SeasonDateDraft } from "@/components/cme/applications/applications-season";
import { WorkButton, WorkEmpty } from "@/components/mode-kit/work";
import { cn } from "@/components/ui-primitives";
import {
  addReferee,
  agreedCount,
  APPLICATION_STAGES,
  applicationsNeedsYouItems,
  newApplicationsId,
  quietReferees,
  recordNudge,
  REFEREE_LIMIT,
  refereeStatusLabel,
  removeReferee,
  removeSeasonDate,
  sampleApplications,
  seasonYear,
  setRefereeStatus,
  shortDate,
  stageLabel,
  updateRefereeDetails,
  upsertSeasonDate,
  type ApplicationStageId,
  type ApplicationsState,
} from "@/lib/cme/applications";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { useApplicationsStore } from "@/lib/cme/device-record";

type DateSheetState = { open: false } | { open: true; stage: ApplicationStageId | null };
type RefereeSheetState = { open: false } | { open: true; id: string | null };

/**
 * JOB APPLICATIONS SEASON (#22).
 *
 * The doctor's own plan for one recruitment season: the dates from the advert
 * on a season rail, the referees with a status each, and the way in to a CV
 * that fills itself. Kept on this device only. No recruitment date is built in
 * ("Date to be confirmed"), and nothing is sent to anyone.
 */
export function ApplicationsPage({ demoMode, now }: { readonly demoMode: boolean; readonly now: Date }) {
  const today = perthCalendarDate(now);
  const sample = useMemo(() => (demoMode ? sampleApplications(today) : null), [demoMode, today]);
  const store = useApplicationsStore(sample);
  const notify = useUndoNotice();
  const [dateSheet, setDateSheet] = useState<DateSheetState>({ open: false });
  const [refereeSheet, setRefereeSheet] = useState<RefereeSheetState>({ open: false });
  const [refused, setRefused] = useState(false);
  const state = store.state;

  if (!state) {
    return (
      <CpdFeaturePage eyebrow="Your own plan" title="Job applications" testId="applications-page">
        <div aria-hidden="true" className={cn(flatCard, "h-64 motion-safe:animate-pulse")} />
        <span role="status" className="sr-only">
          Loading your applications
        </span>
      </CpdFeaturePage>
    );
  }

  /** Applies a change; offers Undo back to exactly the state before it. */
  function change(next: (current: ApplicationsState) => ApplicationsState, message: string) {
    const before = store.state;
    if (!store.update(next)) {
      setRefused(true);
      return false;
    }
    setRefused(false);
    notify(message, before ? () => store.update(() => before) : undefined);
    return true;
  }

  function saveDate(draft: SeasonDateDraft) {
    const existed = state!.dates.some((date) => date.stage === draft.stage);
    const ok = change(
      (current) =>
        upsertSeasonDate(current, {
          stage: draft.stage,
          on: draft.on,
          time: draft.time,
          source: draft.source,
          remind: draft.remind,
          addedOn: current.dates.find((date) => date.stage === draft.stage)?.addedOn ?? today,
        }),
      `${stageLabel(draft.stage)} ${existed ? "changed" : "added"}`,
    );
    if (ok) setDateSheet({ open: false });
  }

  function removeDate(stage: ApplicationStageId) {
    if (change((current) => removeSeasonDate(current, stage), `${stageLabel(stage)} date removed`))
      setDateSheet({ open: false });
  }

  function saveReferee(draft: RefereeDraft, id: string | null) {
    if (!id) {
      if (change((current) => addReferee(current, draft, today, newApplicationsId("ref")), `${draft.name} added`))
        setRefereeSheet({ open: false });
      return;
    }
    const before = state!.referees.find((referee) => referee.id === id);
    const statusChanged = before && before.status !== draft.status;
    const ok = change(
      (current) => setRefereeStatus(updateRefereeDetails(current, id, draft), id, draft.status, today),
      statusChanged ? `${draft.name} marked ${refereeStatusLabel(draft.status)}` : `${draft.name} saved`,
    );
    if (ok) setRefereeSheet({ open: false });
  }

  function removeOne(id: string) {
    const referee = state!.referees.find((item) => item.id === id);
    if (change((current) => removeReferee(current, id), `${referee?.name ?? "Referee"} removed`))
      setRefereeSheet({ open: false });
  }

  function nudged(id: string) {
    // Recorded quietly: the sheet already says it was copied, and Undo would undo a copy that happened.
    store.update((current) => recordNudge(current, id, today));
  }

  const quiet = quietReferees(state, today);
  const reminders = applicationsNeedsYouItems(state, today).filter((item) => item.id.includes(":date:"));
  const empty = state.dates.length === 0 && state.referees.length === 0;
  const full = state.referees.length >= REFEREE_LIMIT;
  const openReferee =
    refereeSheet.open && refereeSheet.id ? (state.referees.find((r) => r.id === refereeSheet.id) ?? null) : null;

  return (
    <CpdFeaturePage
      eyebrow={`Season ${seasonYear(state, today)} · your own plan`}
      title="Job applications"
      testId="applications-page"
    >
      {store.mode !== "device" ? (
        <QuietNote icon={Lock} testId="applications-mode-note">
          {store.mode === "sample"
            ? "Sample season with made-up names and dates. Try any control, nothing is kept."
            : "This is marked as a shared device, so nothing here is kept after you leave the page. Use your own phone."}
        </QuietNote>
      ) : null}

      {reminders.map((item) => (
        <section
          key={item.id}
          data-testid="applications-reminder"
          className={cn(flatCard, "flex items-center gap-3 border-[color:var(--mode-identity-border)] p-3")}
        >
          <IconCircle icon={CalendarDays} />
          <span className="grid min-w-0 flex-1">
            <span className="text-base-minus font-medium text-[color:var(--text-heading)]">{item.title}</span>
            <span className="text-sm text-[color:var(--text-muted)]">
              {item.dueOn ? shortDate(item.dueOn, today) : null}
            </span>
          </span>
        </section>
      ))}

      {quiet.map(({ referee, days }) => (
        <section
          key={referee.id}
          data-testid="applications-quiet"
          className={cn(flatCard, "flex flex-wrap items-center gap-3 p-3")}
        >
          <IconCircle icon={Bell} tone="amber" />
          <span className="grid min-w-0 flex-1 basis-40">
            <span className="text-base-minus font-medium text-[color:var(--text-heading)]">
              {referee.name} has not replied
            </span>
            <span className="text-sm text-[color:var(--text-muted)]">
              <span className="nums">{days}</span> days since you asked
            </span>
          </span>
          <WorkButton
            variant="tinted"
            onClick={() => setRefereeSheet({ open: true, id: referee.id })}
            aria-label={`Nudge ${referee.name}`}
            testId="applications-nudge-open"
          >
            Nudge
          </WorkButton>
        </section>
      ))}

      {empty ? (
        <section className={flatCard}>
          <WorkEmpty
            icon={CalendarDays}
            title="Plan your application season"
            body="Add the dates from the advert, the people you will ask, and check your CV."
            testId="applications-empty"
            action={
              <WorkButton
                icon={Plus}
                onClick={() => setDateSheet({ open: true, stage: "close" })}
                testId="applications-first-date"
              >
                Add the first date
              </WorkButton>
            }
          />
        </section>
      ) : null}

      <section aria-labelledby="applications-season" className="grid gap-2">
        <SectionLabel
          id="applications-season"
          count={`${state.dates.length} of ${APPLICATION_STAGES.length} dates added`}
        >
          Season
        </SectionLabel>
        <div className={cn(flatCard, "p-3")}>
          <SeasonRail state={state} today={today} onEdit={(stage) => setDateSheet({ open: true, stage })} />
        </div>
      </section>

      <section aria-labelledby="applications-referees-label" className="grid gap-2">
        <SectionLabel
          id="applications-referees-label"
          count={state.referees.length ? `${agreedCount(state)} of ${state.referees.length} agreed` : undefined}
        >
          Referees
        </SectionLabel>
        <RefereeList
          referees={state.referees}
          today={today}
          full={full}
          onOpen={(id) => setRefereeSheet({ open: true, id })}
          onAdd={() => setRefereeSheet({ open: true, id: null })}
        />
      </section>

      <section aria-labelledby="applications-cv-label" className="grid gap-2">
        <SectionLabel id="applications-cv-label">CV</SectionLabel>
        <ul role="list" className={flatCard}>
          <li className={cn(flatRow, "p-0")}>
            <Link
              href="/cme/applications/cv"
              data-testid="applications-cv-link"
              className={cn(focusRing, "flex min-h-13 w-full items-center gap-3 px-3 py-2 no-underline")}
            >
              <IconCircle icon={FileText} />
              <span className="grid min-w-0 flex-1">
                <span className="text-base-minus font-medium text-[color:var(--text-heading)]">Your CV</span>
                <span className="text-sm text-[color:var(--text-muted)]">
                  Fills itself from CPD, Teaching and terms
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
            </Link>
          </li>
          <li className={cn(flatRow, "p-0")}>
            <Link
              href="/admin/help"
              data-testid="applications-support-link"
              className={cn(focusRing, "flex min-h-13 w-full items-center gap-3 px-3 py-2 no-underline")}
            >
              <IconCircle icon={HeartHandshake} tone="neutral" />
              <span className="grid min-w-0 flex-1">
                <span className="text-base-minus font-medium text-[color:var(--text-heading)]">
                  Applying can be hard going
                </span>
                <span className="text-sm text-[color:var(--text-muted)]">Support and contacts, in Admin</span>
              </span>
              <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
            </Link>
          </li>
        </ul>
      </section>

      {refused ? (
        <p role="alert" className="px-1 text-sm text-[color:var(--warning)]" data-testid="applications-refused">
          That change could not be kept. Nothing was changed. Try again.
        </p>
      ) : null}

      <QuietNote icon={Lock}>Kept on this phone only, never sent. No patient details anywhere here.</QuietNote>

      <ActionDock testId="applications-dock">
        <WorkButton
          variant="secondary"
          icon={Plus}
          onClick={() => setDateSheet({ open: true, stage: null })}
          testId="applications-add-date"
        >
          Add a date
        </WorkButton>
        <WorkButton
          variant={full ? "secondary" : "primary"}
          icon={Users}
          onClick={() =>
            full
              ? notify(`${REFEREE_LIMIT} referees is the most this keeps. Remove one first.`)
              : setRefereeSheet({ open: true, id: null })
          }
          testId="applications-add-referee"
        >
          Add referee
        </WorkButton>
      </ActionDock>

      <SeasonDateSheet
        open={dateSheet.open}
        initialStage={dateSheet.open ? dateSheet.stage : null}
        state={state}
        today={today}
        onClose={() => setDateSheet({ open: false })}
        onSave={saveDate}
        onRemove={removeDate}
      />
      <RefereeSheet
        open={refereeSheet.open}
        referee={openReferee}
        today={today}
        onClose={() => setRefereeSheet({ open: false })}
        onSave={(draft) => saveReferee(draft, refereeSheet.open ? refereeSheet.id : null)}
        onRemove={removeOne}
        onNudgeCopied={nudged}
      />
    </CpdFeaturePage>
  );
}
