"use client";

import { OnCallDialRow } from "@/components/on-call/kit/dial-row";
import { OnCallGroupedList, OnCallRow } from "@/components/on-call/kit/grouped-list";
import { OnCallModuleSkeleton } from "@/components/on-call/kit/module-skeleton";
import { OnCallUpdatedLine } from "@/components/on-call/kit/updated-line";
import type { HospitalHandbookState } from "@/components/on-call/use-hospital-handbook";
import type { HandbookItem } from "@/lib/on-call/handbook-items";

/**
 * The hospital's pinned emergency route, first under the hospital line: the
 * safety order puts it above everything else on Now.
 *
 * Only site-named, `clinical` `Emergency:` entries qualify (at most three,
 * `pinnedEmergencyEntries`), each with the quiet red dot and disc. A short code
 * is desk-only and shows "From a hospital phone"; the mobile route recorded
 * beside it is the row's only call link. With nothing qualifying, one quiet
 * row says so ("not set up for this hospital") and links to Service, where an
 * editor records it: the app never invents an emergency number, and never 000
 * in its place, so the row carries no call link at all.
 *
 * The setup link names the selected service and site, so an editor lands in
 * this hospital's handbook and not the first one. Only an editor or admin of
 * that service gets the link; a member is told to ask an editor, because the
 * Service page hides the add control from them.
 *
 * While the hospital loads, the slot is held as a static outline whenever the
 * device has seen this hospital before (a yes or no, never the number): either
 * the pinned rows or the "not set up" row arrives there, so neither lands above
 * something the reader is about to tap. A hospital never loaded reserves nothing.
 */
export function NowEmergencyPin({
  handbook,
  pins,
  now,
}: {
  readonly handbook: HospitalHandbookState;
  readonly pins: readonly HandbookItem[];
  readonly now?: Date;
}) {
  if (handbook.status === "loading") {
    return handbook.emergencyPinExpected !== null ? (
      <OnCallModuleSkeleton rows={1} twoLine testId="on-call-now-emergency-outlines" />
    ) : null;
  }
  if (handbook.status !== "ready") return null;
  if (pins.length === 0) {
    const role = handbook.services.find((service) => service.id === handbook.serviceId)?.role;
    const canSetUp = role === "editor" || role === "admin";
    const params = new URLSearchParams();
    if (handbook.serviceId) params.set("service", handbook.serviceId);
    if (handbook.siteId) params.set("site", handbook.siteId);
    const query = params.toString();
    return (
      <OnCallGroupedList testId="on-call-now-emergency-not-set-up">
        <OnCallRow
          title="Emergency number not set up for this hospital"
          subtitle={
            canSetUp
              ? "Add it in Service. Until then, use your hospital's own emergency process."
              : "Ask a service editor to add it. Until then, use your hospital's own emergency process."
          }
          href={canSetUp ? `/on-call/service${query ? `?${query}` : ""}` : undefined}
          testId="on-call-now-emergency-set-up-link"
        />
      </OnCallGroupedList>
    );
  }
  const hospitalName = handbook.siteName ?? handbook.serviceName;
  const first = pins[0];
  return (
    <div className="grid min-w-0 gap-2">
      <OnCallGroupedList testId="on-call-now-emergency">
        {pins.map((item) => (
          <OnCallDialRow
            key={item.id}
            id={item.id}
            source="handbook"
            title={item.parsed.label}
            dial={item.dial}
            mobileDial={item.mobileDial}
            updatedAt={item.updatedAt}
            lastConfirmedAt={item.lastConfirmedAt}
            sources={item.sources}
            tone="emergency"
            hospitalName={hospitalName}
            now={now}
            testId={`on-call-now-emergency-${item.id}`}
          />
        ))}
      </OnCallGroupedList>
      {first ? (
        <div className="px-3">
          <OnCallUpdatedLine
            updatedAt={first.updatedAt}
            sources={first.sources}
            now={now}
            testId="on-call-now-emergency-updated"
          />
        </div>
      ) : null}
    </div>
  );
}
