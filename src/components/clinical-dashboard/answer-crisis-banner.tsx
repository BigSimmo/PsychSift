"use client";

import { CrisisLinesCard } from "@/components/crisis-lines-card";
import { CAMHS_CRISIS_CONNECT_CONTACT, POISONS_INFORMATION_CONTACT, WA_CRISIS_CONTACTS } from "@/lib/crisis-contacts";
import { hasOverdoseWording } from "@/lib/crisis-wording";
import { hasUnder18Wording } from "@/lib/service-urgent-routing";

// Numbers come from the one shared module, looked up by id, so they can never drift from
// the Patient Safety Plan or any other surface that prints them.
function crisisContact(id: (typeof WA_CRISIS_CONTACTS)[number]["id"]) {
  const contact = WA_CRISIS_CONTACTS.find((candidate) => candidate.id === id);
  if (!contact) throw new Error(`missing crisis contact ${id}`);
  return contact;
}
const EMERGENCY_CONTACT = crisisContact("SYN-CRISIS-CONTACT-001");
const LIFELINE_CONTACT = crisisContact("SYN-CRISIS-CONTACT-005");
const MHERL_METRO_CONTACT = crisisContact("SYN-CRISIS-CONTACT-002");

/**
 * Shown above an Answer-mode reply whenever the question uses crisis wording (`hasCrisisWording`).
 * The same card and rows as Admin Help (design audit D02): every number visible, each with its own
 * 48px call link. Under-18 wording adds CAMHS Crisis Connect after 000, and overdose or poisoning
 * wording adds the Poisons Information Centre.
 */
export function AnswerCrisisBanner({ query }: { readonly query?: string | null }) {
  // Owner decision 2026-10-26 (D10): under-18 wording puts CAMHS Crisis Connect straight after 000.
  const contacts = [
    EMERGENCY_CONTACT,
    ...(hasUnder18Wording(query) ? [CAMHS_CRISIS_CONNECT_CONTACT] : []),
    ...(hasOverdoseWording(query) ? [POISONS_INFORMATION_CONTACT] : []),
    MHERL_METRO_CONTACT,
    LIFELINE_CONTACT,
  ];
  return (
    <div role="status" className="mb-3">
      <CrisisLinesCard
        contacts={contacts}
        testId="answer-crisis-banner"
        rowTestIdPrefix="answer-crisis"
        label="Crisis numbers"
        heading="If someone is in immediate danger, call 000."
      />
    </div>
  );
}
