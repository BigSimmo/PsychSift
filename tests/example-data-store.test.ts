// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { clearAccountScopedBrowserStorage } from "@/lib/account-scoped-browser-state";
import { exampleId, guardExampleAction, isExampleRecord, withoutExampleRecords } from "@/lib/example-data/guards";
import { EXAMPLE_DATA_STORAGE_KEY, decodeExampleCookie, encodeExampleCookie } from "@/lib/example-data/keys";
import {
  areaDataState,
  exampleActiveFor,
  isNewAccount,
  markRealRecordAdded,
  readExampleData,
  reportAreaData,
  resetExampleDataForTests,
  setExampleDataOn,
} from "@/lib/example-data/store";

beforeEach(() => {
  window.localStorage.clear();
  document.cookie = "psychsift_example_data=; Path=/; Max-Age=0";
  resetExampleDataForTests();
});

describe("which areas show example data", () => {
  const none = { v: 1 as const, choice: null, addedWhileOn: [], realAreas: [] };

  it("is off for an existing account that never chose", () => {
    expect(exampleActiveFor(none, "rost", "empty", false)).toBe(false);
  });

  it("auto shows it in every area not known to hold real data, for a new account or visitor", () => {
    expect(exampleActiveFor(none, "rost", "empty", true)).toBe(true);
    expect(exampleActiveFor(none, "rost", "unknown", true)).toBe(true);
    expect(exampleActiveFor({ ...none, realAreas: ["rost"] }, "rost", "unknown", true)).toBe(false);
    expect(exampleActiveFor(none, "rost", "has-data", true)).toBe(false);
  });

  it("explicit on fills every area until a real record is added there", () => {
    const on = { ...none, choice: "on" as const, addedWhileOn: ["cpd" as const] };
    expect(exampleActiveFor(on, "rost", "has-data", false)).toBe(true);
    expect(exampleActiveFor(on, "cpd", "has-data", false)).toBe(false);
  });

  it("explicit off wins over auto", () => {
    expect(exampleActiveFor({ ...none, choice: "off" }, "rost", "empty", true)).toBe(false);
  });

  it("counts an account as new for 14 days", () => {
    const now = Date.parse("2026-10-07T00:00:00Z");
    expect(isNewAccount("2026-10-01T00:00:00Z", now)).toBe(true);
    expect(isNewAccount("2026-09-01T00:00:00Z", now)).toBe(false);
    expect(isNewAccount(undefined, now)).toBe(false);
    expect(isNewAccount("garbage", now)).toBe(false);
  });
});

describe("the stored switch", () => {
  it("turning on starts fresh and a real record takes that area back", () => {
    setExampleDataOn(true);
    markRealRecordAdded("rost");
    expect(readExampleData().addedWhileOn).toEqual(["rost"]);
    expect(decodeExampleCookie(/psychsift_example_data=([^;]*)/.exec(document.cookie)?.[1])).not.toContain("rost");
    setExampleDataOn(true);
    expect(readExampleData().addedWhileOn).toEqual([]);
  });

  it("turning off clears the server cookie", () => {
    setExampleDataOn(true);
    expect(document.cookie).toContain("psychsift_example_data=day.rost");
    setExampleDataOn(false);
    expect(document.cookie).not.toContain("psychsift_example_data=day");
  });

  it("remembers areas with real data but keeps empty reports in memory only", () => {
    reportAreaData("cpd", "has-data");
    reportAreaData("teach", "empty");
    expect(JSON.parse(window.localStorage.getItem(EXAMPLE_DATA_STORAGE_KEY) ?? "{}").realAreas).toEqual(["cpd"]);
    resetExampleDataForTests();
    expect(areaDataState("cpd")).toBe("has-data");
    expect(areaDataState("teach")).toBe("unknown");
  });

  it("is cleared with its cookie at an account transition", () => {
    setExampleDataOn(true);
    clearAccountScopedBrowserStorage();
    expect(window.localStorage.getItem(EXAMPLE_DATA_STORAGE_KEY)).toBeNull();
    expect(document.cookie).not.toContain("psychsift_example_data=day");
    expect(readExampleData().choice).toBeNull();
  });

  it("survives a corrupt stored value", () => {
    window.localStorage.setItem(EXAMPLE_DATA_STORAGE_KEY, "{not json");
    resetExampleDataForTests();
    expect(readExampleData().choice).toBeNull();
  });
});

describe("no-bleed guards", () => {
  it("strips example records from any list", () => {
    const list = [{ id: exampleId("1") }, { id: "real-1" }, { id: undefined }];
    expect(withoutExampleRecords(list)).toEqual([{ id: "real-1" }, { id: undefined }]);
    expect(isExampleRecord("example:x")).toBe(true);
    expect(exampleId("example:x")).toBe("example:x");
  });

  it("blocks an action only while example data is showing, and asks for the sheet", () => {
    const seen: string[] = [];
    window.addEventListener("psychsift:example-blocked", (event) => seen.push((event as CustomEvent).detail));
    expect(guardExampleAction(false, "export")).toBe(true);
    expect(guardExampleAction(true, "export")).toBe(false);
    expect(seen).toEqual(["export"]);
  });

  it("round-trips the cookie and ignores unknown areas", () => {
    expect(encodeExampleCookie(["teach", "day"])).toBe("day.teach");
    expect(decodeExampleCookie("day.bogus.call")).toEqual(["day", "call"]);
  });
});
