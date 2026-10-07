"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { useModeBandShown } from "@/components/mode-band/mode-band";
import { universalHeaderLeadingSlotId } from "@/components/work-frame/work-frame-header";
import { useClaimWorkFrameBack } from "@/components/work-frame/work-frame-store";

const subscribeNever = () => () => {};

/**
 * The top bar's back button on screens opened from the Assessments supervisor view. It goes back
 * there (keeping as=supervisor), not up to Teaching, and claims the slot so the frame's arrow steps
 * aside. With no band it draws nothing, because the page is not in the work frame.
 */
export function AssessmentsSupervisorBack() {
  const shown = useModeBandShown();
  useClaimWorkFrameBack(shown);
  const host = useSyncExternalStore(
    subscribeNever,
    () => document.getElementById(universalHeaderLeadingSlotId),
    () => null,
  );
  if (!shown || !host) return null;
  return createPortal(
    <Link
      href="/teaching/assessments?as=supervisor"
      className="universal-header-icon-control work-frame-back"
      aria-label="Back to Assessments"
      data-testid="assessments-supervisor-back"
    >
      <ChevronLeft aria-hidden="true" className="size-icon-lg" strokeWidth={2.25} />
    </Link>,
    host,
  );
}
