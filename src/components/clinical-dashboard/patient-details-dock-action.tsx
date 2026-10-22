"use client";

import { ChevronRight, UserRound } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import { PatientDetailsGate } from "@/components/clinical-dashboard/patient-details-gate";
import { PatientProfilePanel } from "@/components/clinical-dashboard/patient-profile-panel";
import { usePatientProfile } from "@/components/clinical-dashboard/patient-profile-context";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { patientDetailsAddonSlotId } from "@/lib/mode-home-composer";

/**
 * The phone "Patient details" pill, docked above the search composer on the
 * medication and prescribing surfaces.
 *
 * It is NOT independently fixed-positioned. Like the Differentials Compare bar
 * it portals into a slot *inside* the phone dock's form, so it inherits the
 * dock's `position: fixed`, z-index, safe-area padding and — the point of the
 * exercise — its scroll-hide transform. There is no bottom-offset arithmetic
 * here and no second scroll listener; the composer hides, this hides with it.
 *
 * The media query is 639px to match the dock (`.phone-footer-layer` is
 * `sm:fixed`), deliberately NOT the 1023px the two Compare bars use. Their
 * wider gate means that between 640px and 1023px they render into a slot on a
 * form that is not fixed — a latent bug this component does not copy.
 */
export function PatientDetailsDockAction() {
  const { profile, isEmpty } = usePatientProfile();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const phoneMediaQuery = window.matchMedia("(max-width: 639px)");
    let observer: MutationObserver | null = null;
    let dockObserver: MutationObserver | null = null;
    let dock: HTMLElement | null = null;

    const syncDockOvershoot = () => {
      if (!dock) return;
      if (dock.dataset.footerAddon === "patient-details" && dock.dataset.scrollHidden === "true") {
        // The prescribing surface uses the dashboard dock class, whereas the
        // historical CSS overshoot selector was document-dock-only. Inline the
        // addon-specific hidden transform on that actual owner so no edge peeps
        // through while the whole dock is translated off screen.
        dock.style.transform = "translateY(calc(100% + 0.5rem + var(--safe-area-bottom)))";
      } else {
        dock.style.removeProperty("transform");
      }
    };

    const detachDockObserver = () => {
      dockObserver?.disconnect();
      dockObserver = null;
      dock?.style.removeProperty("transform");
      dock = null;
    };

    const syncHost = () => {
      const nextHost = document.getElementById(patientDetailsAddonSlotId);
      setHost(nextHost);
      const nextDock = nextHost?.closest(".answer-footer-search-dock") as HTMLElement | null;
      if (nextDock === dock) return;

      detachDockObserver();
      dock = nextDock;
      if (dock) {
        dockObserver = new MutationObserver(syncDockOvershoot);
        dockObserver.observe(dock, {
          attributes: true,
          attributeFilter: ["data-footer-addon", "data-scroll-hidden"],
        });
        syncDockOvershoot();
      }
    };

    const attachObserver = () => {
      if (observer) return;
      observer = new MutationObserver(syncHost);
      observer.observe(document.body, { childList: true, subtree: true });
    };

    const detachObserver = () => {
      observer?.disconnect();
      observer = null;
      detachDockObserver();
    };

    const onMediaChange = () => {
      if (phoneMediaQuery.matches) {
        syncHost();
        attachObserver();
      } else {
        setHost(null);
        detachObserver();
      }
    };

    // Initial state
    onMediaChange();
    phoneMediaQuery.addEventListener("change", onMediaChange);

    return () => {
      phoneMediaQuery.removeEventListener("change", onMediaChange);
      detachObserver();
    };
  }, []);

  // Count the entered dimensions, not just the medications, so the badge means
  // "how much context is loaded" rather than "how many drugs".
  const enteredCount = countEnteredFields(profile);
  // Stable id so the trigger can advertise `aria-controls`. `aria-expanded`
  // alone announces that something opened but never what — the same gap
  // `Disclosure` exists to close.
  const sheetId = useId();

  const sheet = (
    <Sheet
      id={sheetId}
      open={open}
      onClose={() => setOpen(false)}
      title="Patient details"
      description="Anonymous physiology and current medications. Cleared when the tab closes."
      mobilePlacement="bottom"
      testId="patient-details-sheet"
    >
      <PatientDetailsGate>
        <PatientProfilePanel variant="compact" defaultOpen />
      </PatientDetailsGate>
    </Sheet>
  );

  if (!host) {
    // Above the phone breakpoint the panel is already inline on these surfaces,
    // so there is nothing to render — but keep the sheet mounted if it is open
    // so a resize mid-edit does not drop the dialog and the focus with it.
    return open ? sheet : null;
  }

  return (
    <>
      {createPortal(
        <div className="patient-details-fab">
          <button
            type="button"
            onClick={() => setOpen(true)}
            data-testid="patient-details-dock-action"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={sheetId}
            className={cn("patient-details-fab__button", !isEmpty && "patient-details-fab__button--active")}
          >
            <UserRound className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="truncate">Patient details</span>
            {enteredCount > 0 ? (
              <span className="nums patient-details-fab__count" aria-hidden="true">
                {enteredCount}
              </span>
            ) : null}
            {/* The count is decorative; the real state goes to assistive tech here. */}
            <span className="sr-only">
              {isEmpty ? "No patient details entered" : `${enteredCount} details entered`}
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 opacity-70" aria-hidden="true" />
          </button>
        </div>,
        host,
      )}
      {sheet}
    </>
  );
}

/** How many profile dimensions carry a value. Drives the pill's count badge. */
function countEnteredFields(profile: {
  ageYears?: number | null;
  egfr?: number | null;
  crcl?: number | null;
  scr?: number | null;
  qtc?: number | null;
  hepatic?: string | null;
  pregnant?: boolean;
  breastfeeding?: boolean;
  allergies?: string[];
  medications?: string[];
}): number {
  let count = 0;
  for (const value of [profile.ageYears, profile.egfr, profile.crcl, profile.scr, profile.qtc]) {
    if (typeof value === "number" && Number.isFinite(value)) count += 1;
  }
  if (profile.hepatic && profile.hepatic !== "none") count += 1;
  if (profile.pregnant) count += 1;
  if (profile.breastfeeding) count += 1;
  count += profile.allergies?.length ?? 0;
  count += profile.medications?.length ?? 0;
  return count;
}
