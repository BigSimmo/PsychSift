import { onCallDialableNumber } from "@/lib/on-call/number-resolver";

/**
 * Where a number is shown (spec rule 11, standard §2). The hospital's own list
 * drops the WA area code ("9000 0012"). Outside lines keep it ("(08) 9000 0012").
 */
export type PhoneListScope = "own-list" | "outside";

const four = (digits: string) => `${digits.slice(0, 4)} ${digits.slice(4)}`;

/**
 * Display only: the `tel:` link keeps using `onCallTelHref`. Anything that is not a
 * plain Australian number (an extension, "via switchboard", 000, an international
 * number) comes back exactly as the owner wrote it, never reformatted into a guess.
 * A bare eight-digit number is taken as a WA (08) line, because every service
 * Admin serves is in WA Health.
 */
export function displayPhoneNumber(raw: string, scope: PhoneListScope): string {
  const digits = onCallDialableNumber(raw);
  if (!digits || digits.startsWith("+")) return raw;
  if (/^04\d{8}$/.test(digits) || /^1[38]00\d{6}$/.test(digits)) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  if (/^13\d{4}$/.test(digits)) return `13 ${digits.slice(2, 4)} ${digits.slice(4)}`;
  const landline = /^0([2378])(\d{8})$/.exec(digits) ?? (/^[2-9]\d{7}$/.test(digits) ? [digits, "8", digits] : null);
  if (!landline) return raw;
  const [, area, local] = landline;
  return scope === "own-list" && area === "8" ? four(local) : `(0${area}) ${four(local)}`;
}
