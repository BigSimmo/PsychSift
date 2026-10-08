"use client";
import { Clock } from "lucide-react";

import { focusRing } from "@/components/card-recipes";
import { onCallActionLink, onCallLeadingIcon } from "@/components/on-call/kit/calm";
import { cn } from "@/components/ui-primitives";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { OnCallHospitalChooser } from "@/components/on-call/kit/handbook-state";
import type { HospitalHandbookState } from "@/components/on-call/use-hospital-handbook";
import type { OnCallShift } from "@/lib/roster/shifts/model";

export function HospitalShiftUpdates({
  handbook,
  shifts,
  now,
}: {
  handbook: HospitalHandbookState;
  shifts: readonly Pick<OnCallShift, "startsAt" | "endsAt" | "workplace">[];
  now: Date;
}) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (handbook.status !== "ready") return null;
  const active = shifts.filter(
    (shift) => Date.parse(shift.startsAt) <= now.getTime() && Date.parse(shift.endsAt) > now.getTime(),
  );
  // Overlapping shifts can disagree: never select one by array order.
  const workplaces = [...new Set(active.flatMap((shift) => (shift.workplace ? [shift.workplace.trim()] : [])))];
  const workplace = workplaces.length === 1 ? workplaces[0] : null;
  const current = handbook.siteName ?? handbook.serviceName;
  const mismatch = workplace && current && workplace.toLocaleLowerCase() !== current.toLocaleLowerCase();
  const promptKey = `${handbook.hospitalKey}:${workplace}`;
  const lastEnd = Math.max(...shifts.map((shift) => Date.parse(shift.endsAt)).filter((time) => time < now.getTime()));
  const changed = Number.isFinite(lastEnd)
    ? handbook.items.filter(
        (item) => item.updatedAt && Date.parse(item.updatedAt) > lastEnd && Date.parse(item.updatedAt) <= now.getTime(),
      )
    : [];
  return (
    <>
      {mismatch && dismissed !== promptKey ? (
        <section className="grid gap-2 px-1" data-testid="on-call-roster-site-prompt">
          <p className="text-sm text-[color:var(--text-heading)]">
            Your roster says {workplace}, but you are viewing {current}. Check the hospital before calling.
          </p>
          <OnCallHospitalChooser handbook={handbook} />
          <Button variant="ghost" onClick={() => setDismissed(promptKey)}>
            Keep this hospital
          </Button>
        </section>
      ) : null}
      {changed.length ? (
        <section
          className="flex min-w-0 items-center gap-3 px-3"
          aria-label="What changed since your last shift"
          data-testid="on-call-published-changes"
        >
          <Clock aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />
          <p className="min-w-0 flex-1 break-words text-sm text-[color:var(--text-muted)]">
            <span className="font-semibold text-[color:var(--text-heading)]">
              {changed.some((item) => item.section === "cover") ? "Cover changed" : "Changed"}
            </span>
            {` since your last shift: ${changed
              .slice(0, 2)
              .map((item) => (item.section === "cover" ? "role cover" : item.title))
              .join(", ")}${changed.length > 2 ? ` and ${changed.length - 2} more` : ""}`}
          </p>
          {/* One "See" for the list: the first change's entry in Service. */}
          <Link
            className={cn(onCallActionLink, focusRing)}
            href={`/on-call/service#on-call-entry-${changed[0]!.id}`}
            aria-label="See what changed since your last shift"
          >
            See
          </Link>
        </section>
      ) : null}
    </>
  );
}
