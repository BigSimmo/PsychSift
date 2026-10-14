"use client";

import { CrisisLinesCard } from "@/components/crisis-lines-card";
import { POISONS_INFORMATION_CONTACT, WA_CRISIS_CONTACTS } from "@/lib/crisis-contacts";
import { hasOverdoseWording } from "@/lib/crisis-wording";

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
 * 48px call link. Overdose or poisoning wording adds the Poisons Information Centre after 000.
 */
export function AnswerCrisisBanner({ query }: { readonly query?: string | null }) {
  const contacts = hasOverdoseWording(query)
    ? [EMERGENCY_CONTACT, POISONS_INFORMATION_CONTACT, MHERL_METRO_CONTACT, LIFELINE_CONTACT]
    : [EMERGENCY_CONTACT, MHERL_METRO_CONTACT, LIFELINE_CONTACT];
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
