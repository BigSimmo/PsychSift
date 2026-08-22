"use client";

import { ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ignoreUnavailableActivation } from "@/components/ui-primitives";
import { useWardFlow } from "@/components/ward-management/ward-flow-provider";
import { edById, unitById } from "@/components/ward-management/ward-sites";

import styles from "./ward-role-switcher.module.css";

const COORDINATOR_HREF = "/ward-management";
const OFFICER_HREF = "/ward-management/transport/officer";

/**
 * Task 12 (addendum R41/R42/R48/R52/R67). The role switcher: four roles, one control, and the
 * one piece of navigation the whole eleven-step journey (spec §14) relies on to prove the loop
 * survives a role change without a `page.goto()` resetting the world underneath it. Every
 * destination below is a real `<Link>`, never a `router.push` from a click handler that only
 * happens to look like navigation, so the routes stay reachable the same way the rest of this
 * phase's rail links do.
 *
 * **The coordinator has no place.** Spec §9 and the addendum both say this explicitly: the
 * coordinator is statewide, so this control shows that as a real fact ("Statewide — no ward or
 * department") rather than inventing a location for it the way a naive "current role's screen"
 * design would.
 *
 * **Ward and Emergency department are inferred from the shared `focusMovementId`** — the patient
 * last selected on the coordinator screen (`coordinator-screen.tsx`'s `selectMovement`, mirrored
 * into `WardFlowProvider` so it survives the screen unmounting on a role switch). Addendum R52:
 * where that movement implies exactly one destination, it is a direct link; where it implies
 * several — a live parallel referral, up to `PARALLEL_REFERRAL_CAP` units at once — every
 * candidate is offered rather than any one silently chosen. That is the same conservative-failure
 * discipline `shortlist-panel.tsx`'s `canRefer` and `ward-screen.tsx`'s blocked-reason helpers
 * already hold to, applied to navigation instead of a dispatch: this is a `?? array[0]` in
 * interaction form the moment it picks for you, and the addendum forbids exactly that. Where no
 * destination is implied at all (no patient selected yet), the control names that reason rather
 * than guessing — `aria-disabled` plus `title` plus an `ignoreUnavailableActivation` handler,
 * the same pattern `ed-screen.tsx`'s `examinationBlockedReason`/`handoverBlockedReason` and
 * every other conditionally-available control in this phase already use.
 */
export function WardRoleSwitcher() {
  const { movements, focusMovementId } = useWardFlow();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // The provider's own live `movements`, never a frozen fixture lookup — a movement referred or
  // accepted moments ago on the coordinator screen must resolve here too, on the very next
  // render, exactly like `coordinator-screen.tsx`'s own `selectedMovement` derivation.
  const focusMovement = focusMovementId ? movements.find((movement) => movement.id === focusMovementId) : undefined;

  // Ward candidates: an accepted destination is the definitive single answer (REFER_TO_UNITS's
  // own reducer case empties `referredUnitIds` the moment one unit accepts — see
  // `ward-flow-reducer.ts`'s `case "ACCEPT_IN_PRINCIPLE"`), so it is checked first. Short of
  // that, every currently live referral is a candidate destination — never just the first one.
  const wardCandidateIds = focusMovement
    ? focusMovement.acceptedUnitId
      ? [focusMovement.acceptedUnitId]
      : focusMovement.referredUnitIds
    : [];
  const wardCandidates = wardCandidateIds
    .map((unitId) => unitById(unitId))
    .filter((unit): unit is NonNullable<typeof unit> => unit !== undefined);

  // ED is never ambiguous — a movement carries exactly one `originEdId` — so this is always a
  // direct link once a patient is selected, never a picker.
  const edCandidate = focusMovement ? edById(focusMovement.originEdId) : undefined;

  function close() {
    setOpen(false);
  }

  return (
    <div className={styles.switcher} ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="ward-role-switcher-menu"
        aria-label="Switch role"
        title="Switch role"
        onClick={() => setOpen((value) => !value)}
      >
        <ArrowLeftRight aria-hidden="true" />
      </button>
      {open ? (
        <div id="ward-role-switcher-menu" className={styles.menu} role="menu" aria-label="Switch role">
          <Link href={COORDINATOR_HREF} role="menuitem" className={styles.menuItem} onClick={close}>
            <span className={styles.menuItemLabel}>Coordinator</span>
            <span className={styles.menuItemDetail}>Statewide — no ward or department</span>
          </Link>

          <div className={styles.menuGroup} role="group" aria-label="Ward">
            <span className={styles.menuGroupLabel}>Ward</span>
            {wardCandidates.length > 0 ? (
              wardCandidates.map((unit) => (
                <Link
                  key={unit.id}
                  href={`/ward-management/ward/${unit.id}`}
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={close}
                >
                  <span className={styles.menuItemLabel}>{unit.name}</span>
                </Link>
              ))
            ) : (
              <button
                type="button"
                role="menuitem"
                aria-disabled="true"
                aria-describedby="ward-role-switcher-ward-unavailable"
                title="Select a patient on the coordinator screen to see their ward."
                className={styles.menuItemDisabled}
                onClick={ignoreUnavailableActivation}
              >
                <span className={styles.menuItemLabel}>No ward implied</span>
              </button>
            )}
          </div>

          <Link href={OFFICER_HREF} role="menuitem" className={styles.menuItem} onClick={close}>
            <span className={styles.menuItemLabel}>Officer</span>
            <span className={styles.menuItemDetail}>Every transport job, statewide</span>
          </Link>

          <div className={styles.menuGroup} role="group" aria-label="Emergency department">
            <span className={styles.menuGroupLabel}>Emergency department</span>
            {edCandidate ? (
              <Link
                href={`/ward-management/ed/${edCandidate.id}`}
                role="menuitem"
                className={styles.menuItem}
                onClick={close}
              >
                <span className={styles.menuItemLabel}>{edCandidate.name}</span>
              </Link>
            ) : (
              <button
                type="button"
                role="menuitem"
                aria-disabled="true"
                aria-describedby="ward-role-switcher-ed-unavailable"
                title="Select a patient on the coordinator screen to see their department."
                className={styles.menuItemDisabled}
                onClick={ignoreUnavailableActivation}
              >
                <span className={styles.menuItemLabel}>No department implied</span>
              </button>
            )}
          </div>

          {wardCandidates.length === 0 ? (
            <span id="ward-role-switcher-ward-unavailable" className="sr-only">
              Select a patient on the coordinator screen to see their ward.
            </span>
          ) : null}
          {!edCandidate ? (
            <span id="ward-role-switcher-ed-unavailable" className="sr-only">
              Select a patient on the coordinator screen to see their department.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
