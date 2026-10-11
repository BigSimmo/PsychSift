"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { RosterAskAnswer } from "@/components/roster/ask/roster-ask-answer";
import { useRosterAskContext } from "@/components/roster/ask/use-roster-ask-context";
import { answerQuestion, askNeedsTeamReady } from "@/lib/roster/ask/answer";
import { askIntentHref } from "@/lib/roster/ask/handoff";
import { parseAsk, type AskChoice, type AskContext, type AskResult } from "@/lib/roster/ask/parse";
import { formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";

/*
 * The answering half of Ask Roster: the grammar, the answer engine and the roster reads. It loads
 * only after a question is submitted, so the pages that show the ask box don't carry it up front.
 */

function readingFor(result: AskResult, ctx: AskContext): string | null {
  if (result.kind !== "change") return null;
  const intent = result.intent;
  if (intent.kind === "dates")
    return `${intent.dateKind === "prefer_off" ? "Prefer off" : "Can't work"} ${formatPerthDay(intent.from)}${intent.to === intent.from ? "" : `–${formatPerthDay(intent.to)}`}`;
  if (intent.kind === "leave")
    return `Request leave ${formatPerthDay(intent.from)}${intent.to === intent.from ? "" : `–${formatPerthDay(intent.to)}`}`;
  const shift = ctx.assignments.find((item) => item.id === intent.assignmentId);
  const detail = shift
    ? `${formatPerthDay(perthDateOf(shift.startsAt))} ${shift.kind.replace("_", " ")}`
    : "your shift";
  if (intent.kind === "swap") return `Swap ${detail}`;
  return `${intent.kind === "give_away" ? "Give away" : "Can't make"} ${detail}`;
}

export type Pending = { readonly id: number; readonly text: string };

export function RosterAskSession({
  pending,
  onNavigate,
}: {
  readonly pending: Pending | null;
  readonly onNavigate: () => void;
}) {
  const router = useRouter();
  const { parser, answers, teamChoices, selectedTeamId, selectTeam, loading, teamLoading } = useRosterAskContext();
  const [selection, setSelection] = useState<{ id: number; teamId: string | null; choice: AskChoice } | null>(null);
  const chosen =
    pending && selection?.id === pending.id && selection.teamId === selectedTeamId ? selection.choice : null;
  const ctx = {
    ...parser,
    ...(chosen?.date ? { selectedDate: chosen.date } : {}),
    ...(chosen?.userId ? { selectedUserId: chosen.userId } : {}),
  };
  const result = pending && !loading ? parseAsk(pending.text, ctx) : null;
  const waitingOnTeam = Boolean(result && askNeedsTeamReady(result) && teamLoading);
  const answer = result?.kind === "question" && !waitingOnTeam ? answerQuestion(result.q, answers) : null;
  const reading = result && !waitingOnTeam ? readingFor(result, ctx) : null;

  function choose(choice: AskChoice) {
    if (!pending) return;
    setSelection({ id: pending.id, teamId: selectedTeamId, choice });
  }

  function open() {
    if (result?.kind !== "change") return;
    const href = askIntentHref(result.intent, selectedTeamId);
    onNavigate();
    router.push(href);
  }

  return (
    <>
      {teamChoices.length > 1 ? (
        <label className="grid gap-1 px-3 text-sm text-[color:var(--text-muted)]">
          Team roster
          <select
            value={selectedTeamId ?? ""}
            onChange={(event) => {
              selectTeam(event.target.value);
              setSelection(null);
            }}
            className="min-h-12 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 text-[color:var(--text)]"
          >
            {teamChoices.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {pending && /\bbecause\b/i.test(pending.text) ? (
        <p className="px-3 text-sm text-[color:var(--text-muted)]">Reasons aren&apos;t saved.</p>
      ) : null}
      {waitingOnTeam ? (
        <p role="status" className="px-3 text-sm text-[color:var(--text-muted)]">
          Loading the team roster…
        </p>
      ) : null}
      {result && !waitingOnTeam ? (
        <RosterAskAnswer result={result} answer={answer} reading={reading} onChoice={choose} onOpen={open} />
      ) : null}
    </>
  );
}
