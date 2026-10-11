"use client";
import { OnCallDialRow } from "@/components/on-call/kit/dial-row";
import { OnCallGroupedList } from "@/components/on-call/kit/grouped-list";
import { OnCallUpdatedLine } from "@/components/on-call/kit/updated-line";
import { onCallCrisisLinesCompact, OnCallHandbookState } from "@/components/on-call/kit/handbook-state";
import { OnCallHospitalLine } from "@/components/on-call/kit/hospital-line";
import { OnCallCrisisLines } from "@/components/on-call/call/external-line-rows";
import { useHospitalHandbook } from "@/components/on-call/use-hospital-handbook";
import { useHospitalClock } from "@/components/on-call/use-hospital-clock";
import { handbookLadders, nearHospitalChangeover } from "@/lib/on-call/service-availability";
import { onCallLadderStepMarkId } from "@/lib/on-call/now-rows";
import { resolveHandbookPhone } from "@/lib/on-call/number-resolver";

export function HospitalLadders({ now: pinned }: { now?: Date }) {
  const handbook = useHospitalHandbook();
  const now = useHospitalClock(pinned);
  const hours = handbook.hours ?? null;
  const ladders = handbook.status === "ready" ? handbookLadders(handbook.items, hours, now) : [];
  return (
    <section className="grid gap-3" data-testid="on-call-hospital-ladders">
      <OnCallHospitalLine handbook={handbook} />
      <OnCallHandbookState handbook={handbook} page="now" />
      {handbook.status !== "ready" ? (
        <OnCallCrisisLines now={now} compact={onCallCrisisLinesCompact(handbook.status)} />
      ) : (
        <>
          <h2 className="text-base font-normal">Hospital playbook</h2>
          {!ladders.length ? (
            <p className="text-sm text-[color:var(--text-muted)]">
              No published hospital ladders for this time. Check with switchboard.
            </p>
          ) : null}
          {!hours ? (
            <p className="text-sm text-[color:var(--text-muted)]">
              Hospital hours are not set. Both in-hours and after-hours roles are shown.
            </p>
          ) : null}
          {nearHospitalChangeover(hours, now) ? (
            <p className="text-sm text-[color:var(--text-muted)]">
              Within 15 minutes of changeover: both roles are shown.
            </p>
          ) : null}
          {ladders.map((ladder) => {
            const item = handbook.items.find((item) => item.id === ladder.id)!;
            return (
              <OnCallGroupedList
                key={ladder.id}
                id={`hospital-ladder-${ladder.id}`}
                eyebrow={ladder.title}
                testId={`hospital-ladder-${ladder.id}`}
              >
                {ladder.steps
                  .filter((step) => step.appliesNow || nearHospitalChangeover(hours, now))
                  .map((step) => (
                    <OnCallDialRow
                      key={step.order}
                      id={onCallLadderStepMarkId(ladder.id, step.order)}
                      source="handbook"
                      title={step.whoToCall}
                      subtitle={`${step.when}${step.hours !== "any" ? ` · ${step.hours}` : ""}${step.waitMinutes ? ` · Hospital-set wait: ${step.waitMinutes} min` : ""}`}
                      dial={step.phone ? resolveHandbookPhone(step.phone) : null}
                      now={now}
                      hospitalName={handbook.siteName ?? handbook.serviceName}
                      updatedAt={item.updatedAt}
                      lastConfirmedAt={item.lastConfirmedAt}
                      sources={item.sources}
                      testId={`hospital-ladder-step-${ladder.id}-${step.order}`}
                    />
                  ))}
                <li className="px-3">
                  <OnCallUpdatedLine
                    updatedAt={item.updatedAt}
                    lastConfirmedAt={item.lastConfirmedAt}
                    sources={item.sources}
                    now={now}
                  />
                </li>
              </OnCallGroupedList>
            );
          })}
        </>
      )}
    </section>
  );
}
