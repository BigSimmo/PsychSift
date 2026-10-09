"use client";

import { CalendarClock } from "lucide-react";

import { useRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import { Button } from "@/components/ui/button";
import { cn, textMuted } from "@/components/ui-primitives";
import { formatDateEcho } from "@/lib/admin/renewal-dates";

/**
 * A suggestion, never a fill: when the doctor's own roster team records when
 * their rotation ends, offer that date. A rotation is not always a contract,
 * so it is one tap to use and the words say so. Mounted only while the add
 * sheet is open, so the roster is read only then. The example team shown
 * while the real-staff release is held is never offered.
 */
export function RotationEndSuggestion({
  today,
  current,
  onUse,
}: {
  today: string;
  current: string;
  onUse: (date: string) => void;
}) {
  const teams = useRosterTeams();
  const team =
    teams.status === "ready" && !teams.data?.sample && Array.isArray(teams.data?.teams)
      ? (teams.data.teams.find((candidate) => candidate.enabled) ?? null)
      : null;
  const overview = useRosterRead(team?.serviceId ?? null, "overview");
  const endsOn = overview.status === "ready" ? (overview.data?.me?.rotationEndsOn ?? null) : null;
  if (!endsOn || endsOn < today || endsOn === current) return null;
  return (
    <div
      className="flex min-w-0 items-start gap-2.5 rounded-lg border border-[color:var(--border)] p-3"
      data-testid="admin-contract-rotation"
    >
      <CalendarClock
        aria-hidden="true"
        strokeWidth={1.5}
        className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--text-muted)]"
      />
      <span className="grid min-w-0 gap-1.5">
        <span className="text-sm text-[color:var(--text)]">
          Your roster team has this rotation ending <span className="nums font-semibold">{formatDateEcho(endsOn)}</span>
          .
        </span>
        <span className={cn(textMuted, "text-xs")}>Use it only if your contract ends then too.</span>
        <span>
          <Button variant="secondary" size="sm" onClick={() => onUse(endsOn)} testId="admin-contract-rotation-use">
            Use this date
          </Button>
        </span>
      </span>
    </div>
  );
}
