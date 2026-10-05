import { WA_CRISIS_CONTACTS, type PublicCrisisContact } from "@/lib/crisis-contacts";
import { onCallDigitsOf, onCallFieldMatches, onCallSearchTerms } from "@/lib/on-call/entry-search";
import { handbookResources } from "@/lib/on-call/handbook-resources";
import { resolveHandbookPhone, type HandbookDial } from "@/lib/on-call/number-resolver";

/**
 * Outside lines: public, statewide or national numbers from the app's own
 * sourced lists, never from a hospital (Global Constraint 15). Each one keeps
 * its area, its official https source and the day that source was read
 * (Global Constraint 10), and is shown in the outside form, "(08) 9000 0012".
 */
export type OnCallExternalLine = {
  readonly id: string;
  readonly title: string;
  /** Where the line serves, as the source states it. */
  readonly area: string;
  /** When the line answers ("24 hours, every day"), when its source says. */
  readonly availability?: string;
  /** A limitation the source states, shown wherever the number is shown ("not an emergency service"). */
  readonly caveat?: string | null;
  readonly dial: HandbookDial;
  readonly updatedAt: string;
  readonly sources: readonly { readonly label: string; readonly url: string }[];
};

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function fromCrisisContact(contact: PublicCrisisContact): OnCallExternalLine {
  return {
    id: contact.id.toLowerCase(),
    title: contact.name,
    area: contact.coverage,
    availability: contact.availability,
    caveat: contact.caveat,
    dial: resolveHandbookPhone(contact.telephoneDisplay, "outside"),
    updatedAt: contact.verifiedOn,
    sources: [{ label: hostLabel(contact.sourceUrl), url: contact.sourceUrl }],
  };
}

const EMERGENCY_ID = "SYN-CRISIS-CONTACT-001";
const MHERL_PERTH_ID = "SYN-CRISIS-CONTACT-002";
const LIFELINE_ID = "SYN-CRISIS-CONTACT-005";

function crisisContact(id: string): PublicCrisisContact | null {
  return WA_CRISIS_CONTACTS.find((contact) => contact.id === id) ?? null;
}

/**
 * The lines that show in every loading, signed-out and failure state (owner
 * decision): 000, MHERL for Perth and Lifeline. They are part of the app, so
 * they never wait on the hospital's handbook.
 */
export function onCallCrisisLines(): OnCallExternalLine[] {
  return [EMERGENCY_ID, MHERL_PERTH_ID, LIFELINE_ID]
    .map(crisisContact)
    .filter((contact): contact is PublicCrisisContact => contact !== null)
    .map(fromCrisisContact);
}

/**
 * Call's External group: 000 first, then the handbook shelf's sourced contact
 * lines (MHERL, Poisons, Rurallink), then Lifeline.
 */
export function onCallExternalLines(): OnCallExternalLine[] {
  const emergency = crisisContact(EMERGENCY_ID);
  const lifeline = crisisContact(LIFELINE_ID);
  const shelf = handbookResources
    .filter((resource) => resource.group === "contacts" && resource.phone)
    .map((resource): OnCallExternalLine => {
      // The same number on the app's crisis list carries the hours and caveat its
      // source states ("not an emergency service"), which must show with it.
      const digits = onCallDigitsOf(resource.phone ?? "");
      const listed = WA_CRISIS_CONTACTS.find((contact) => onCallDigitsOf(contact.telephoneDisplay) === digits);
      return {
        id: resource.id,
        title: resource.title,
        area: resource.jurisdiction,
        availability: listed?.availability,
        caveat: listed?.caveat ?? null,
        dial: resolveHandbookPhone(resource.phone ?? "", "outside"),
        updatedAt: resource.checkedOn,
        sources: [{ label: resource.sourceLabel, url: resource.sourceUrl }],
      };
    });
  return [
    ...(emergency ? [fromCrisisContact(emergency)] : []),
    ...shelf,
    ...(lifeline ? [fromCrisisContact(lifeline)] : []),
  ];
}

/** Outside lines whose name, area or number matches every term; `[]` for an empty query. */
export function searchExternalLines(lines: readonly OnCallExternalLine[], query: string): OnCallExternalLine[] {
  const terms = onCallSearchTerms(query);
  if (terms.length === 0) return [];
  return lines.filter((line) =>
    terms.every((term) => {
      const termDigits = onCallDigitsOf(term);
      return [line.title, line.area, line.dial.display].some((field) => onCallFieldMatches(field, term, termDigits));
    }),
  );
}
