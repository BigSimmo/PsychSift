"use client";

import { Phone, Shield } from "lucide-react";
import { useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { onCallFilledButton, onCallOutlineButton } from "@/components/on-call/kit/calm";
import { OnCallDialSheet, onCallExtensionRoute, onCallMobileRoute } from "@/components/on-call/kit/dial-sheet";
import { OnCallGroupedList, OnCallRow } from "@/components/on-call/kit/grouped-list";
import { OnCallModuleSkeleton } from "@/components/on-call/kit/module-skeleton";
import { modeDot, modeModuleSurface } from "@/components/mode-kit/recipes";
import { modeNameText, modeNumberText } from "@/components/mode-kit/type";
import { useOnCallYouCalledAt } from "@/components/on-call/kit/use-you-called";
import type { HospitalHandbookState } from "@/components/on-call/use-hospital-handbook";
import { useOnCallHospitalPhone } from "@/components/on-call/call/call-device-stores";
import { cn } from "@/components/ui-primitives";
import { rememberOnCallYouCalled } from "@/lib/on-call/call-marks";
import { formatOnCallTime } from "@/lib/on-call/display-dates";
import { ON_CALL_YOU_CALLED_ENABLED } from "@/lib/on-call/feature-flags";
import type { HandbookItem } from "@/lib/on-call/handbook-items";
import { spokenOnCallNumber, type HandbookDial } from "@/lib/on-call/number-resolver";
import { recordOnCallRecent } from "@/lib/on-call/recent-storage";

/**
 * One pinned emergency route (mock-up v10 Now): the role, then the number for
 * the phone in the reader's hand as the one filled button, and the other route
 * beneath it, outlined.
 *
 * On a mobile (the "I'm on a hospital phone" switch off) the filled button is
 * the mobile route recorded beside the short code, "from your mobile", and the
 * short code sits beneath as "Dial 55 from a ward phone". That second button
 * opens the dial sheet rather than ringing, because a mobile keying 55 does not
 * reach the hospital. With the switch on, the order flips.
 *
 * A short code with no mobile route recorded has no call link on a mobile at
 * all: only the ward-phone button shows, so nothing is ever invented.
 */
function EmergencyRoute({
  item,
  hospitalName,
  now,
  testId,
}: {
  readonly item: HandbookItem;
  readonly hospitalName: string | null;
  readonly now?: Date;
  readonly testId: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const hospitalPhone = useOnCallHospitalPhone();
  const calledAt = useOnCallYouCalledAt(item.id);
  const dial: HandbookDial | null = item.dial.kind === "none" ? null : item.dial;
  const extension = dial && hospitalPhone ? onCallExtensionRoute(dial) : null;
  const mobile = dial ? onCallMobileRoute(dial, item.mobileDial) : null;
  const deskOnly = dial?.route === "hospital-phone";
  // The filled button: what THIS phone rings.
  const primary = extension ?? mobile;
  const primaryWhere = extension ? "from this hospital phone" : deskOnly ? "from your mobile" : null;
  const title = item.parsed.label;

  const recordCall = () => {
    recordOnCallRecent({ id: item.id, source: "handbook" });
    if (ON_CALL_YOU_CALLED_ENABLED) rememberOnCallYouCalled(item.id);
  };

  return (
    <li className="grid min-w-0 gap-2 p-3" data-testid={testId}>
      <p className="flex min-w-0 items-center gap-2">
        <Shield aria-hidden="true" strokeWidth={1.5} className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
        <span
          aria-hidden="true"
          data-testid={`${testId}-emergency-dot`}
          className={cn(modeDot, "bg-[color:var(--danger)]")}
        />
        <span
          className={cn(
            modeNameText,
            "min-w-0 break-words text-base-minus font-semibold text-[color:var(--text-heading)]",
          )}
        >
          {title}
        </span>
      </p>
      {primary?.tel ? (
        <a
          href={primary.tel}
          onClick={recordCall}
          aria-label={`Call ${title}${primaryWhere ? ` ${primaryWhere}` : ""}, emergency, ${spokenOnCallNumber(primary.display)}`}
          data-testid={`${testId}-call`}
          className={cn(onCallFilledButton, focusRing, "justify-start")}
        >
          <Phone aria-hidden="true" strokeWidth={1.75} className="size-icon-md shrink-0" />
          <span className={cn(modeNumberText, "font-semibold")}>{primary.display}</span>
          {primaryWhere ? <span className="text-sm font-normal">{primaryWhere}</span> : null}
        </a>
      ) : null}
      {dial && (deskOnly || !primary?.tel) && !extension ? (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setSheetOpen(true)}
          data-testid={`${testId}-ward-phone`}
          aria-label={`Dial ${dial.display} from a ward phone. Dialling details for ${title}`}
          className={cn(onCallOutlineButton, focusRing, "justify-start")}
        >
          <Phone aria-hidden="true" strokeWidth={1.5} className="size-icon-md shrink-0" />
          <span className={cn(modeNumberText, "font-semibold")}>{`Dial ${dial.display}`}</span>
          <span className="text-sm font-normal text-[color:var(--text-muted)]">from a ward phone</span>
        </button>
      ) : null}
      {extension && mobile?.tel && mobile !== extension ? (
        <a
          href={mobile.tel}
          onClick={recordCall}
          aria-label={`Call ${title} from a mobile, emergency, ${spokenOnCallNumber(mobile.display)}`}
          className={cn(onCallOutlineButton, focusRing, "justify-start")}
        >
          <Phone aria-hidden="true" strokeWidth={1.5} className="size-icon-md shrink-0" />
          <span className={cn(modeNumberText, "font-semibold")}>{mobile.display}</span>
          <span className="text-sm font-normal text-[color:var(--text-muted)]">from a mobile</span>
        </a>
      ) : null}
      {calledAt ? (
        <p
          className={cn(modeNumberText, "text-sm text-[color:var(--text-muted)]")}
        >{`You called ${formatOnCallTime(calledAt)}`}</p>
      ) : null}
      {dial ? (
        <OnCallDialSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={title}
          hospitalName={hospitalName}
          dial={dial}
          mobileDial={item.mobileDial}
          updatedAt={item.updatedAt}
          sources={item.sources}
          lastConfirmedAt={item.lastConfirmedAt}
          now={now}
          onCall={recordCall}
          hospitalPhone={hospitalPhone}
          testId={`${testId}-sheet`}
        />
      ) : null}
    </li>
  );
}

/**
 * The hospital's pinned emergency route, first under the hospital line: the
 * safety order puts it above everything else on Now.
 *
 * Only site-named, `clinical` `Emergency:` entries qualify (at most three,
 * `pinnedEmergencyEntries`), each keeping the quiet red dot. With nothing
 * qualifying, one quiet row says so ("not set up for this hospital") and links
 * to Service, where an editor records it: the app never invents an emergency
 * number, and never 000 in its place, so the row carries no call link at all.
 *
 * While the hospital loads, the slot is held as a static outline whenever the
 * device has seen this hospital before, so nothing lands above something the
 * reader is about to tap.
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
      <OnCallGroupedList surface="card" testId="on-call-now-emergency-not-set-up">
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
  return (
    <section aria-label="Emergency route" data-testid="on-call-now-emergency">
      <ul role="list" className={cn(modeModuleSurface, "divide-y divide-[color:var(--border)]")}>
        {pins.map((item) => (
          <EmergencyRoute
            key={item.id}
            item={item}
            hospitalName={hospitalName}
            now={now}
            testId={`on-call-now-emergency-${item.id}`}
          />
        ))}
      </ul>
    </section>
  );
}
