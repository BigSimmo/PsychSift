"use client";

import { ChevronRight, LayoutGrid, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, type ReactNode } from "react";

import { ModeBandStatus, PageTitleUnderBand, type ModeBandStatusValue } from "@/components/mode-band/mode-band";
import { Button } from "@/components/ui/button";
import { modeInsetHairline, modePressable } from "@/components/mode-kit/recipes";
import { formatHours, gradeLabel, hoursBetween, kindLabel } from "@/lib/open-shifts/model";
import { groupPosted } from "@/lib/open-shifts/posted";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

import { LoadFailed } from "./open-shifts-states";
import {
  FlatList,
  ListSkeleton,
  SectionHeading,
  formatShiftTimes,
  formatWeekday,
  postedShiftHref,
} from "./open-shifts-ui";
import { usePostedShifts, type PostedShift, type PostedShiftsState } from "./use-posted-shifts";

export function postedStatus(state: PostedShiftsState): ModeBandStatusValue | null {
  if (state.offline) return { kind: "offline" };
  if (state.status === "loading") return { kind: "loading" };
  if (state.status === "error") return { kind: "failed", text: "Your posted shifts couldn't be reached" };
  if (state.failedTeams.length > 0) return { kind: "failed", text: `Couldn't read ${state.failedTeams.join(", ")}` };
  if (state.readAt) return { kind: "text", text: `Shift list updated ${perthTimeOf(state.readAt)}` };
  return null;
}

function PostedRow({ shift, line }: { shift: PostedShift; line: ReactNode }) {
  const date = perthDateOf(shift.startsAt);
  return (
    <li className={modeInsetHairline}>
      <Link
        href={postedShiftHref(shift.serviceId, shift.id)}
        className={`flex min-h-13 items-start gap-4 px-3 py-3.5 no-underline ${modePressable} focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--command)]`}
      >
        <span className="flex w-12 shrink-0 flex-col items-center text-center nums">
          <span className="text-2xs font-semibold uppercase text-[color:var(--text-muted)]">{formatWeekday(date)}</span>
          <span className="text-lg-minus font-semibold leading-6 text-[color:var(--text-heading)]">
            {Number(date.slice(8))}
          </span>
          <span className="text-2xs text-[color:var(--text-muted)]">{perthTimeOf(shift.startsAt)}</span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-base-minus font-medium text-[color:var(--text-heading)]">
            {`${shift.siteName ?? shift.teamName} · ${gradeLabel(shift.minGrade)}`}
          </span>
          <span className="text-sm nums text-[color:var(--text-muted)]">
            {`${formatShiftTimes(shift.startsAt, shift.endsAt)} · ${kindLabel(shift.kind)} · ${formatHours(hoursBetween(shift.startsAt, shift.endsAt))}`}
          </span>
          <span className="text-sm text-[color:var(--text-muted)]">{line}</span>
        </span>
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.6}
          className="mt-3 size-icon-md shrink-0 text-[color:var(--text-soft)]"
        />
      </Link>
    </li>
  );
}

export function OpenShiftsPostedPage() {
  const state = usePostedShifts();
  const now = useMemo(() => new Date(), []);
  const groups = useMemo(() => groupPosted(state.shifts, now), [state.shifts, now]);
  const teamNames = state.teams.map((team) => team.name).join(", ");

  return (
    <div className="mx-auto w-full max-w-reading pb-10" data-mode-identity="open-shifts">
      <PageTitleUnderBand className="px-3 pt-4 text-xl font-semibold text-[color:var(--text-heading)]">
        Post
      </PageTitleUnderBand>
      <ModeBandStatus value={postedStatus(state)} testId="open-shifts-status" />
      {state.status === "loading" ? (
        <ListSkeleton rows={4} />
      ) : state.status === "error" ? (
        <LoadFailed what="Your posted shifts" message={state.message} onRetry={state.reload} />
      ) : state.status !== "ready" ? (
        <div className="px-3 py-8">
          <h2 className="text-base font-semibold text-[color:var(--text-heading)]">Only roster managers post shifts</h2>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">
            Ask your team&apos;s roster manager to post the shift. If you&apos;ve been offered a shift directly, you can
            log it for yourself.
          </p>
          <Link
            href="/open-shifts/log"
            className="mt-3 inline-flex min-h-12 items-center text-sm font-medium text-[color:var(--mode-identity)]"
          >
            Log a shift offered to me
          </Link>
        </div>
      ) : (
        <>
          <p className="px-3 pt-3 text-sm text-[color:var(--text-muted)]">
            {`Posting as roster manager for ${teamNames}. Requests come to you and your team's other roster managers to approve.`}
          </p>

          {groups.hasRequest.length > 0 ? (
            <section>
              <SectionHeading count={groups.hasRequest.length}>Needs a decision</SectionHeading>
              <FlatList label="Needs a decision">
                {groups.hasRequest.map((shift) => (
                  <PostedRow
                    key={shift.id}
                    shift={shift}
                    line={
                      <span className="font-medium text-[color:var(--text-heading)]">
                        {shift.status === "reported"
                          ? `${shift.postedByName ?? "A team member"} can't work it: post it to the team?`
                          : `Requested by ${shift.claimantName ?? "a team member"}`}
                      </span>
                    }
                  />
                ))}
              </FlatList>
            </section>
          ) : null}

          <section>
            <SectionHeading count={groups.open.length}>Open</SectionHeading>
            {groups.open.length > 0 ? (
              <FlatList label="Open">
                {groups.open.map((shift) => (
                  <PostedRow
                    key={shift.id}
                    shift={shift}
                    line={shift.urgent ? "Urgent · no requests yet" : "No requests yet"}
                  />
                ))}
              </FlatList>
            ) : (
              <p className="px-3 py-2 text-sm text-[color:var(--text-muted)]">
                {state.failedTeams.length > 0
                  ? `None in the teams read. Couldn't read ${state.failedTeams.join(", ")}.`
                  : "Nothing open. Shifts you post show here until someone is approved."}
              </p>
            )}
          </section>

          <section>
            <SectionHeading count={groups.filledThisWeek.length}>Filled in the next 7 days</SectionHeading>
            {groups.filledThisWeek.length > 0 ? (
              <FlatList label="Filled in the next 7 days">
                {groups.filledThisWeek.map((shift) => (
                  <PostedRow key={shift.id} shift={shift} line={`Filled by ${shift.claimantName ?? "a team member"}`} />
                ))}
              </FlatList>
            ) : (
              <p className="px-3 py-2 text-sm text-[color:var(--text-muted)]">
                {state.failedTeams.length > 0 ? "None in the teams read." : "None yet."}
              </p>
            )}
          </section>

          <div className="mt-6 flex flex-col gap-2 px-3">
            {state.offline ? (
              <Button variant="secondary" block disabled onClick={() => undefined}>
                Offline: can&apos;t post
              </Button>
            ) : (
              <Link
                href="/open-shifts/post/new"
                className="flex min-h-12 items-center justify-center gap-2 rounded-md bg-[color:var(--command)] px-4 text-sm font-semibold text-[color:var(--command-contrast)] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--command)]"
              >
                <Plus aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />
                Post a shift
              </Link>
            )}
            <Link
              href="/open-shifts/board"
              className="hidden min-h-12 items-center justify-center gap-2 rounded-md border border-[color:var(--border-strong)] px-4 text-sm font-medium text-[color:var(--text-heading)] no-underline focus-visible:outline-2 focus-visible:outline-[color:var(--command)] md:flex"
            >
              <LayoutGrid aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />
              Week board
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
