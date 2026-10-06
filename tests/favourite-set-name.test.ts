import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  checkFavouriteSetName,
  favouriteSetNameMaxLength,
  isValidFavouriteSetName,
  normaliseFavouriteSetName,
} from "@/lib/favourite-set-name";
import { favouriteSetNameInputSchema, favouriteSetNames } from "@/lib/favourites-contract";

/**
 * Set names became free text on 2026-10-06. The reason the first release used a
 * fixed vocabulary has not gone away: a set name is clinician-typed text stored
 * on the live database, so it must not become a covert patient-note field.
 * These tests pin the identifiers the rules do block, and say plainly in the
 * last case which one they cannot.
 */
describe("favourite set names", () => {
  it("accepts ordinary workflow names, including the six originals", () => {
    for (const name of favouriteSetNames) {
      expect(checkFavouriteSetName(name)).toEqual({ ok: true, name });
    }
    for (const name of ["Clozapine clinic", "ECT list", "Mon & Thu rounds", "Ward 4B", "Registrar hand-over"]) {
      expect(checkFavouriteSetName(name).ok).toBe(true);
    }
  });

  it("refuses the identifiers most likely to be typed", () => {
    const refused = [
      "D4678677", // a UMRN
      "Smith 12345678",
      "Review 12/03/2026", // a date
      "Call 0412 345 678", // a phone number
      "josh@example.com", // an email address
      "Seen 1.2.26",
    ];
    for (const name of refused) {
      const check = checkFavouriteSetName(name);
      expect(check.ok, name).toBe(false);
      if (!check.ok) expect(check.message.length).toBeGreaterThan(0);
    }
  });

  it("refuses empty, over-long and app-reserved names", () => {
    expect(checkFavouriteSetName("   ").ok).toBe(false);
    expect(checkFavouriteSetName("x".repeat(favouriteSetNameMaxLength + 1)).ok).toBe(false);
    expect(checkFavouriteSetName("Unsorted").ok).toBe(false);
    expect(checkFavouriteSetName("all").ok).toBe(false);
  });

  it("normalises surrounding and repeated whitespace before storing", () => {
    expect(normaliseFavouriteSetName("  Ward   round  ")).toBe("Ward round");
    const check = checkFavouriteSetName("  Ward   round  ");
    expect(check).toEqual({ ok: true, name: "Ward round" });
    // The stored-name guard is strict: it accepts only the normalised form.
    expect(isValidFavouriteSetName("Ward round")).toBe(true);
    expect(isValidFavouriteSetName("  Ward round  ")).toBe(false);
  });

  it("gives the API the normalised name, with the refusal message on a bad one", () => {
    expect(favouriteSetNameInputSchema.parse("  Clozapine  clinic ")).toBe("Clozapine clinic");
    const refused = favouriteSetNameInputSchema.safeParse("D4678677");
    expect(refused.success).toBe(false);
    if (!refused.success) expect(refused.error.issues[0]?.message).toMatch(/UMRN/);
  });

  it("keeps the database CHECK in step with these rules", () => {
    // The migration is the backstop for anything that reaches the table by
    // another route. If a rule here moves, that CHECK has to move with it.
    const migration = readFileSync("supabase/migrations/20261006120000_favourite_set_custom_names.sql", "utf8");
    expect(migration).toContain("char_length(name) between 1 and 40");
    expect(migration).toContain("[0-9]{5}");
    expect(migration).toContain("[0-9][/.-][0-9]");
    expect(migration).toContain("position('@' in name) = 0");
    expect(migration).toContain("'unsorted', 'all'");
    expect(migration).toContain("user_favourite_sets_user_lower_name_key");
    expect(readFileSync("supabase/schema.sql", "utf8")).toContain("user_favourite_sets_user_lower_name_key");
  });

  it("cannot stop a typed patient name, which is why the sheet says so", () => {
    // Stated out loud rather than left implicit: "John Doe" is a valid set
    // name under any rule that allows ordinary words. The sheet's description
    // is the only control for it, so it is pinned here.
    expect(checkFavouriteSetName("John Doe").ok).toBe(true);
    const sheet = readFileSync("src/components/favourites/favourite-sheets.tsx", "utf8");
    expect(sheet).toContain("never by patient");
  });
});
