"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { useModeBandShown } from "@/components/mode-band/mode-band";
import { rememberedRole, type AssessRole } from "@/components/teaching/assessments/assess-memory";
import { universalHeaderLeadingSlotId } from "@/components/work-frame/work-frame-header";
import { useClaimWorkFrameBack } from "@/components/work-frame/work-frame-store";
import { TopBarBack } from "@/components/work-setup/top-bar-back";

const subscribeNever = () => () => {};

function isSide(value: string | null): value is AssessRole {
  return value === "doctor" || value === "supervisor" || value === "dct";
}

/**
 * Where Back goes: Assessments on the side the reader was using. The remembered side wins when it is
 * the supervisor's or the DCT's, because a link may name a side the reader did not choose (a DCT
 * opening a doctor's page lands on an address that says as=supervisor). Otherwise the address's own
 * side, and failing that the supervisor's, whose screens these are.
 */
export function assessmentsBackHref(remembered: AssessRole, search: string): string {
  const fromAddress = new URLSearchParams(search).get("as");
  const side = remembered !== "doctor" ? remembered : isSide(fromAddress) ? fromAddress : "supervisor";
  return `/teaching/assessments?as=${side}`;
}

/**
 * The top bar's back button on screens opened from Assessments (Export and a doctor's page). It goes
 * back there on the reader's side (doctor, supervisor or DCT), not up to Teaching, and claims the slot
 * so the frame's arrow steps aside. A screen whose band is hidden (a doctor's own page) still gets it,
 * in place of the menu, as setup and help do, so it is never a dead end.
 */
export function AssessmentsBack() {
  const shown = useModeBandShown();
  useClaimWorkFrameBack(shown);
  const host = useSyncExternalStore(
    subscribeNever,
    () => document.getElementById(universalHeaderLeadingSlotId),
    () => null,
  );
  // The remembered side is module memory, so it is read on the client only. Both buttons below draw on
  // the client only too, so the server's answer never shows.
  const href = useSyncExternalStore(
    subscribeNever,
    () => assessmentsBackHref(rememberedRole(), window.location.search),
    () => "/teaching/assessments?as=supervisor",
  );
  if (!shown) return <TopBarBack label="Back to Assessments" href={href} testId="assessments-back" />;
  if (!host) return null;
  return createPortal(
    <Link
      href={href}
      className="universal-header-icon-control work-frame-back"
      aria-label="Back to Assessments"
      data-testid="assessments-back"
    >
      <ChevronLeft aria-hidden="true" className="size-icon-lg" strokeWidth={2.25} />
    </Link>,
    host,
  );
}
