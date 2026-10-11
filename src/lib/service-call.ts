import type { ServiceContact, ServiceRecord } from "@/lib/service-ranker";

// "ext", "extn", "extension", "x" (not inside a word such as "fax") or "#", then digits.
const EXTENSION_TAIL = /(?:(?<![a-z])(?:ext(?:ension|n)?|x)(?![a-z])\.?|#)\s*\d.*$/i;

/**
 * The first dialable number in a contact string, as the digits a `tel:` link
 * needs. Shared by the service record page and the search result card so the
 * two can never dial different numbers for the same service.
 */
export function extractFirstDialablePhone(value: string): string | undefined {
  const sanitized = value.replace(/\b24\/7\b/gi, "").replace(/\((?:option|ext|line|menu)\s*\d+\)/gi, "");
  // An unbracketed extension ("ext 1", "extn 12", "x1", "#2") is not part of the number
  // to dial, so each number is cut where one starts.
  const parts = sanitized.split(/[;\n/]|\s+or\s+/i).map((p) => p.replace(EXTENSION_TAIL, "").trim());
  for (const part of parts) {
    const compact = part.replace(/[^\d+]/g, "");
    if (compact.length >= 3) return compact;
  }
  return undefined;
}

export type ServiceCallTarget = {
  /** `tel:` href built only from digits present in the record. */
  href: string;
  /** The number exactly as the record writes it, for visible text. */
  display: string;
};

// Australian numbers are at most 10 digits nationally (12 with +61). Anything
// longer is two numbers run together in one string, which is not dialable, so
// the card shows no call button rather than a wrong one.
const DIALABLE = /^\+?\d{3,12}$/;
const PHONE_RUN = /\+?\(?\d[\d\s()-]*\d/g;

function phoneContactFor(service: ServiceRecord): ServiceContact | undefined {
  const candidates = [service.primaryContact, ...(service.contacts ?? [])];
  return candidates.find(
    (contact): contact is ServiceContact => contact?.kind === "phone" && Boolean(contact.value?.trim()),
  );
}

/**
 * The one number a result card offers to call, or `null` when the record has
 * no dialable phone. Never derives a number from anything but the record's
 * own phone contact, and never invents one.
 */
export function serviceCallTarget(service: ServiceRecord): ServiceCallTarget | null {
  const value = phoneContactFor(service)?.value?.trim();
  if (!value) return null;
  const compact = extractFirstDialablePhone(value);
  if (!compact || !DIALABLE.test(compact)) return null;

  // Show the number in the record's own formatting ("(08) 9442 5000"), found
  // as the run of digits that dials to exactly `compact`.
  const digits = compact.replace(/\D/g, "");
  const run =
    (value.match(PHONE_RUN) ?? []).map((match) => match.trim()).find((match) => match.replace(/\D/g, "") === digits) ??
    compact;
  return { href: `tel:${compact}`, display: balanceParens(run) };
}

// Some catalogue values lost an opening bracket upstream ("08) 9442 5000").
// Drop unpaired brackets so the visible number reads cleanly; digits are untouched.
function balanceParens(value: string): string {
  const opens = (value.match(/\(/g) ?? []).length;
  const closes = (value.match(/\)/g) ?? []).length;
  if (opens === closes) return value;
  return value
    .replace(/[()]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
