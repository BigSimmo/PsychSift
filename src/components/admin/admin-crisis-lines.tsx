"use client";

import { CrisisLinesCard } from "@/components/crisis-lines-card";
import { POISONS_INFORMATION_CONTACT, WA_CRISIS_CONTACTS } from "@/lib/crisis-contacts";

const ADMIN_CRISIS_CONTACTS = [...WA_CRISIS_CONTACTS, POISONS_INFORMATION_CONTACT];

/**
 * Crisis lines, first on every state of Help (spec: "Crisis lines sit at the
 * top, reusing the app's existing crisis list"), then the Poisons Information
 * Centre. A flat white work card (work-mode redesign, owner request 6 Oct 2026),
 * no tint, no red border. Never filtered by "Find in Help", and never hidden by a
 * failed load: this section renders before that check.
 */
export function AdminCrisisLines() {
  return (
    <CrisisLinesCard contacts={ADMIN_CRISIS_CONTACTS} testId="admin-help-crisis" rowTestIdPrefix="admin-help-crisis" />
  );
}
