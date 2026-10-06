/**
 * Rules for a favourite set name the clinician types.
 *
 * Set names are stored on the live database, so they must never become a
 * covert patient-note field. Free text cannot stop a typed patient name, but
 * these rules block the identifiers most likely to be typed: UMRNs and other
 * long numbers, dates, phone numbers and email addresses. The database CHECK
 * added in `20261006120000_favourite_set_custom_names.sql` repeats the length,
 * digit, date and reserved-name rules as a backstop.
 *
 * Client-safe on purpose (no Zod), so the Favourites sheet can explain a
 * refusal before anything is sent.
 */

export const favouriteSetNameMaxLength = 40;
export const maxFavouriteSetsPerAccount = 30;

/** Names the app already uses for its own buckets. */
const reservedNames = new Set(["unsorted", "all"]);

/**
 * Letters, ASCII digits, spaces and simple punctuation only. ASCII digits so the
 * digit rules below see every numeral, and no `@`, so no email addresses.
 */
const allowedCharacters = /^[\p{L}0-9 &'()/,.+-]+$/u;
const longDigitRun = /\d{5}/;
const dateLike = /\d[/.-]\d/;
const maxDigits = 4;

export type FavouriteSetNameCheck = { ok: true; name: string } | { ok: false; message: string };

export function normaliseFavouriteSetName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function checkFavouriteSetName(value: string): FavouriteSetNameCheck {
  const name = normaliseFavouriteSetName(value);
  if (name.length === 0) return { ok: false, message: "Enter a set name." };
  if (name.length > favouriteSetNameMaxLength) {
    return { ok: false, message: `Keep set names to ${favouriteSetNameMaxLength} characters or fewer.` };
  }
  if (!allowedCharacters.test(name)) {
    return { ok: false, message: "Use letters, numbers, spaces and simple punctuation only." };
  }
  if (reservedNames.has(name.toLowerCase())) {
    return { ok: false, message: `"${name}" is already used by the app. Choose another name.` };
  }
  const digitCount = name.replace(/\D/g, "").length;
  if (longDigitRun.test(name) || dateLike.test(name) || digitCount > maxDigits) {
    return {
      ok: false,
      message: "Set names can't hold numbers that look like a UMRN, date or phone number. Keep patient details out.",
    };
  }
  return { ok: true, name };
}

export function isValidFavouriteSetName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const check = checkFavouriteSetName(value);
  return check.ok && check.name === value;
}
