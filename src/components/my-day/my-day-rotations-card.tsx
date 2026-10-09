"use client";

import { CalendarCheck, ListOrdered } from "lucide-react";

import { ExampleTag } from "@/components/example-data/example-tag";
import { useLivePreview } from "@/components/live-version/live-version-provider";
import { WorkCard, WorkIconRow, WorkTag } from "@/components/mode-kit/work";
import { useRotations } from "@/components/roster/rotations/use-rotations";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { rotationTodayPrompt } from "@/lib/my-day/rotation-prompt";
import { rotationRoundHref } from "@/lib/work-calendar/entries";

/**
 * My Day Today's rotation card: "Rank your 2027 rotations" while a round is
 * open and the reader has not sent, and "Your rotations are out" for two weeks
 * after publishing. Draws nothing otherwise, outside the rotation preferences
 * preview, or where the launch switch hides the rotations screens. Example
 * rounds (Roster's example data on) carry the Example tag.
 */
export function MyDayRotationsCard({ now }: { readonly now: Date }) {
  const preview = useLivePreview("rotation-preferences");
  const visible = useWorkModeRouteVisible();
  const enabled = preview && visible("/roster/rotations");
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
          <span className="flex items-center gap-1.5">
            {prompt.example ? <ExampleTag /> : null}
            <WorkTag tone={rank ? "amber" : "green"}>{rank ? "Open" : "New"}</WorkTag>
          </span>
        }
      />
    </WorkCard>
  );
}
