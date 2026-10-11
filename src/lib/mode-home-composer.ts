export const modeHomeDesktopComposerSlotId = "mode-home-desktop-composer-slot";
export const desktopPageComposerSlotId = "desktop-page-search-composer-slot";

/** Set on page-owned composer slots only after the owning segment has hydrated. */
export const desktopComposerSlotReadyAttr = "data-composer-slot-ready";
export const desktopComposerSlotReadyValue = "true";

/**
 * Mode-home hero slots SSR with this attribute so settled composer geometry is
 * reserved before the portal attaches (CLS). MasterSearchHeader clears it when
 * the home media query does not match or portal adoption falls back, so a never-
 * filled phone slot collapses instead of leaving a permanent empty band.
 */
export const modeHomeComposerReserveAttr = "data-composer-reserve";
export const modeHomeComposerReservePendingValue = "pending";

export function isDesktopComposerSlotReady(slot: Element | null | undefined): boolean {
  return slot?.getAttribute(desktopComposerSlotReadyAttr) === desktopComposerSlotReadyValue;
}

export function setModeHomeComposerReservePending(slot: Element | null | undefined, pending: boolean): void {
  if (!slot) return;
  if (pending) {
    slot.setAttribute(modeHomeComposerReserveAttr, modeHomeComposerReservePendingValue);
  } else {
    slot.removeAttribute(modeHomeComposerReserveAttr);
  }
}

/**
 * Set the SSR reserve on a page-owned composer slot only once its owning
 * segment has hydrated; mutating it earlier causes a hydration mismatch.
 */
export function syncHydratedComposerReserve(slotId: string | null | undefined, pending: boolean): void {
  const slot = slotId ? document.getElementById(slotId) : null;
  if (isDesktopComposerSlotReady(slot)) setModeHomeComposerReservePending(slot, pending);
}

/** Re-run `onChange` whenever composer slots mount or report hydration readiness. */
export function observeDesktopComposerSlots(onChange: () => void): MutationObserver {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [desktopComposerSlotReadyAttr],
  });
  return observer;
}

/** Mobile/tablet search-composer slot for differentials compare actions. */
export const differentialsMobileCompareAddonSlotId = "differentials-mobile-compare-addon-slot";

/** Phone search-composer slot for the medication surfaces' Patient details pill. */
export const patientDetailsAddonSlotId = "patient-details-addon-slot";

/** Phone search-composer slot for the Therapy Compass compare tray. */
export const therapyCompareAddonSlotId = "therapy-compare-addon-slot";

/**
 * Which page-owned action currently occupies the phone dock's addon slot.
 *
 * The dock carries exactly ONE addon at a time — `data-footer-addon` is a single
 * attribute value, and the scrim height, hide transform, and content reserve are
 * all keyed off it. The two claimants are mutually exclusive by surface
 * (differentials vs medications/prescribing vs therapy) and
 * `tests/phone-dock-addon-contract.test.ts` pins that, so the slot never has to
 * hold two.
 */
export type PhoneDockAddonKind = "differentials-compare" | "patient-details" | "therapy-compare";

export const phoneDockAddonSlotId: Record<PhoneDockAddonKind, string> = {
  "differentials-compare": differentialsMobileCompareAddonSlotId,
  "patient-details": patientDetailsAddonSlotId,
  "therapy-compare": therapyCompareAddonSlotId,
};

/**
 * The one page-owned phone navigation host inside `universal-header-collapse`.
 * Portaled chrome here shares the universal header's scroll signal, safe-area
 * release, focus pinning, transition timing, and collapse-budget measurement.
 */
export const phoneHeaderCollapseAddonSlotId = "phone-header-collapse-addon-slot";

/**
 * The one page-owned control host in the universal header's TRAILING region,
 * beside (and in place of) the new-chat button.
 *
 * That region carried exactly one hard-coded control for all seventeen modes,
 * which is why the row reads as universal chrome. A mode whose right-hand
 * control should be something else — On Call, whose page menu matters and whose
 * "new chat" means nothing — portals it here, and `globals.css` hides the
 * new-chat button whenever this slot is occupied, so the region still holds one
 * control. A DOM slot rather than a prop because the shell renders above the
 * page and cannot be handed one, and rather than a per-mode branch in the header
 * because that is how one row becomes sixteen.
 */
export const universalHeaderTrailingSlotId = "universal-header-trailing-slot";
