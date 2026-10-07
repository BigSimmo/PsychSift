/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";

import {
  addSavedNumber,
  checkNumberDraft,
  dialableDigits,
  forgetPinOrder,
  isMobileNumber,
  loadFavouritesLocal,
  MAX_SAVED_NUMBERS,
  removeSavedNumbers,
  resetFavouritesLocalForTesting,
  restoreSavedNumbers,
  setFavouritesLayout,
  setSavedNumbersPinned,
  telHref,
  type SavedNumber,
} from "@/lib/favourites/favourites-local";

beforeEach(() => {
  localStorage.clear();
  resetFavouritesLocalForTesting();
});

function seed(count: number): string[] {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const result = addSavedNumber({ label: `Ward ${index + 1}`, number: `6457 ${String(2000 + index)}` }, 1000 + index);
    if (!result.ok) throw new Error(`seed ${index} failed`);
    ids.push(result.id);
  }
  return ids;
}

describe("dialableDigits and checking", () => {
  it("accepts a number in brackets and dials its digits", () => {
    expect(checkNumberDraft({ label: "Pharmacy", number: "(08) 9224 2104" })).toEqual({});
    expect(dialableDigits("(08) 9224 2104")).toBe("0892242104");
    expect(telHref("(08) 9224 2104")).toBe("tel:0892242104");
  });

  it("drops a (0) trunk prefix after a country code", () => {
    expect(checkNumberDraft({ label: "Pharmacy", number: "+61 (0)8 6457 2210" })).toEqual({});
    expect(dialableDigits("+61 (0)8 6457 2210")).toBe("+61864572210");
    expect(dialableDigits("+61(0)8 6457 2210")).toBe("+61864572210");
  });

  it("recognises a mobile, at home or with the country code", () => {
    expect(isMobileNumber("0412 345 678")).toBe(true);
    expect(isMobileNumber("+61 412 345 678")).toBe(true);
    expect(isMobileNumber("(08) 9224 2104")).toBe(false);
  });

  it("refuses a patient's details as a name", () => {
    const problems = checkNumberDraft({ label: "Bed 12 John Smith DOB 01/02/1960", number: "6457 2210" });
    expect(problems.label).toMatch(/patient's details/);
    expect(addSavedNumber({ label: "Bed 12 John Smith DOB 01/02/1960", number: "6457 2210" }).ok).toBe(false);
  });

  it("reads names and notes with the shared patient-detail check, allowing a colleague's name only as a name", () => {
    // A saved number may be a colleague's, or a hospital service in capitals.
    expect(checkNumberDraft({ label: "Dr Grant, registrar", number: "6457 2210" })).toEqual({});
    expect(checkNumberDraft({ label: "RPH ED", number: "6457 2210" })).toEqual({});
    // Details the shared check catches and the older one did not: initials after a patient word, an age.
    expect(checkNumberDraft({ label: "Ward 4", number: "6457 2210", note: "pt js" }).note).toMatch(/patient's details/);
    expect(checkNumberDraft({ label: "Ward 4", number: "6457 2210", note: "45 year old male in bay 3" }).note).toMatch(
      /patient's details/,
    );
    expect(checkNumberDraft({ label: "Ward 4", number: "6457 2210", note: "Mrs Smith" }).note).toMatch(
      /patient's details/,
    );
  });
});

describe("restoreSavedNumbers", () => {
  it("refuses at the limit instead of dropping another number", () => {
    const [firstId] = seed(MAX_SAVED_NUMBERS);
    const removed = removeSavedNumbers(new Set([firstId!]));
    expect(removed).toHaveLength(1);
    expect(addSavedNumber({ label: "Pharmacy", number: "9224 2104" }).ok).toBe(true);
    expect(loadFavouritesLocal().numbers).toHaveLength(MAX_SAVED_NUMBERS);

    expect(restoreSavedNumbers(removed)).toEqual({ ok: false, reason: "full" });
    const numbers = loadFavouritesLocal().numbers;
    expect(numbers).toHaveLength(MAX_SAVED_NUMBERS);
    expect(numbers.some((entry) => entry.label === "Pharmacy")).toBe(true);
    expect(numbers.some((entry) => entry.id === firstId)).toBe(false);
  });

  it("puts a number back unpinned when My Day has no room", () => {
    const [id] = seed(1);
    setSavedNumbersPinned(new Set([id!]), true, 5000);
    const removed: readonly SavedNumber[] = removeSavedNumbers(new Set([id!]));
    expect(restoreSavedNumbers(removed, { pinRoom: 0 })).toEqual({ ok: true });
    expect(loadFavouritesLocal().numbers[0]).toMatchObject({ id, pinnedAt: null });

    removeSavedNumbers(new Set([id!]));
    expect(restoreSavedNumbers(removed, { pinRoom: 1 })).toEqual({ ok: true });
    expect(loadFavouritesLocal().numbers[0]).toMatchObject({ id, pinnedAt: 5000 });
  });
});

describe("forgetPinOrder", () => {
  it("drops unpinned or removed favourites from the My Day order", () => {
    setFavouritesLayout({ pinOrder: ["services:a", "number:n1", "work:day:week"] });
    expect(forgetPinOrder(["number:n1", "unknown"])).toBe(true);
    expect(loadFavouritesLocal().layout.pinOrder).toEqual(["services:a", "work:day:week"]);
    expect(forgetPinOrder(["missing"])).toBe(true);
    expect(loadFavouritesLocal().layout.pinOrder).toEqual(["services:a", "work:day:week"]);
  });
});

describe("write", () => {
  it("keeps the old state when the browser refuses the write", () => {
    seed(1);
    const before = loadFavouritesLocal();
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      expect(addSavedNumber({ label: "Pharmacy", number: "9224 2104" })).toEqual({ ok: false, reason: "storage" });
      expect(setFavouritesLayout({ shelfSize: 4 })).toBe(false);
      expect(loadFavouritesLocal()).toBe(before);
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });
});
