"use client";

import { CalendarCheck, ListOrdered } from "lucide-react";

import { WorkCard, WorkIconRow, WorkTag } from "@/components/mode-kit/work";
import { useRotations } from "@/components/roster/rotations/use-rotations";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { rotationTodayPrompt } from "@/lib/my-day/rotation-prompt";
import { rotationRoundHref } from "@/lib/work-calendar/entries";

/**
 * My Day Today's rotation card: "Rank your 2027 rotations" while a round is
 * open and the reader has not sent, and "Your rotations are out" for two weeks
 * after publishing. Draws nothing otherwise, or where the launch switch hides the rotations screens. Example
 * rounds (Roster's example data on) carry the Example tag.
 */
export function MyDayRotationsCard({ now }: { readonly now: Date }) {
  const visible = useWorkModeRouteVisible();
  const enabled = visible("/roster/rotations");
  const rotations = useRotations({ enabled });
  const { zone } = useWorkTimeZone();
  if (!enabled || rotations.status !== "ready") return null;
  const prompt = rotationTodayPrompt(rotations.mine, now, zone);
  if (!prompt) return null;
  const rank = prompt.kind === "rank";
  return (
    <WorkCard testId="my-day-rotations-card">
      <WorkIconRow
        icon={rank ? ListOrdered : CalendarCheck}
        leadsTo="roster"
        title={prompt.title}
        sub={prompt.sub}
        href={rotationRoundHref(prompt.roundId)}
        end={
          <WorkTag tone={rank ? "amber" : "green"}>{rank ? "Open" : "New"}</WorkTag>
        }
      />
    </WorkCard>
  );
}
