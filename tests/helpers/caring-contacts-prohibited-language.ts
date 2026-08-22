/**
 * The full prohibited vocabulary for caring-contacts interface copy, in ONE place.
 *
 * It was defined twice, byte for byte, in `caring-contacts-overlay-definitions.test.ts`
 * and `caring-contacts-overlay-host.dom.test.tsx`. Two copies of a safety list drift:
 * a term added to one would leave the other quietly checking the old set, and the
 * failure mode is a green suite that no longer covers what it claims to.
 *
 * Word boundaries keep `lead` from firing on `already` while still catching the sales
 * sense of the word.
 *
 * The list is deliberately wider than `PROVISIONAL_MESSAGE_RULES.prohibitedTerms` in
 * `src/lib/caring-contacts/message-rules.ts`, which governs the words that may appear
 * in a MESSAGE to a patient. This governs interface copy, and adds the scoring and
 * reply-monitoring claims that a message could not make but a screen could.
 */
export const CARING_CONTACTS_PROHIBITED_LANGUAGE =
  /\bhigh risk\b|\bsafe\b|\bengagement scores?\b|\bcampaigns?\b|\bleads?\b|\bconversions?\b|\bbest match\b|\binbox(es)?\b|\bconversations?\b|\bclinical risk\b|\brisk scores?\b|\bwellbeing scores?\b|monitor(s|ed|ing)? (the )?repl(y|ies)|repl(y|ies) (are|is) monitored/i;
