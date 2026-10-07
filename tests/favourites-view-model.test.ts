import { FileText } from "lucide-react";
import { describe, expect, it } from "vitest";

import {
  buildSetChips,
  continueWhenLabel,
  demoOpenedAt,
  favouritesSummary,
  groupForView,
  matchesFavouriteSearch,
  pickContinueItem,
  QUICK_LAUNCH_LIMIT,
  quickLaunchHasRoom,
  quickLaunchItems,
  recentTimeLabel,
  sortForView,
  type FavouriteItem,
} from "@/components/favourites/favourites-view-model";

// Tuesday 29 September 2026, 09:10 local time.
const now = new Date(2026, 8, 29, 9, 10).getTime();
const at = (day: number, hours: number, minutes: number) => new Date(2026, 8, day, hours, minutes).getTime();

function item(overrides: Partial<FavouriteItem> & Pick<FavouriteItem, "id">): FavouriteItem {
  return {
    title: overrides.id,
    description: "",
    type: "Service",
    tabId: "services",
    set: "Unsorted",
    evidence: "Service",
    lastUsed: "Saved",
    openedAt: null,
    action: "Open",
    href: `/services/${overrides.id}`,
    icon: FileText,
    ...overrides,
  };
}

const library = [
  item({
    id: "acamprosate",
    title: "Acamprosate renal screen",
    type: "Medication",
    set: "Ward round",
    openedAt: at(29, 8, 44),
    pinned: true,
    pinnedAt: 1,
  }),
  item({
    id: "lithium",
    title: "Lithium monitoring guideline",
    type: "Document",
    set: "Prescribing safety",
    openedAt: at(29, 8, 20),
    pinned: true,
    pinnedAt: 2,
  }),
  item({
    id: "clozapine",
    title: "Clozapine monitoring table",
    type: "Table",
    set: "Clozapine clinic",
    openedAt: at(28, 16, 12),
  }),
  item({
    id: "qt",
    title: "QT prolongation quote",
    type: "Source",
    set: "Prescribing safety",
    openedAt: at(27, 11, 3),
  }),
  item({
    id: "metabolic",
    title: "Metabolic monitoring schedule",
    type: "Table",
    set: "Clozapine clinic",
    openedAt: at(10, 10, 40),
  }),
  item({ id: "delirium", title: "Delirium versus dementia", type: "Differential", set: "Unsorted", openedAt: null }),
  item({ id: "activation", title: "Behavioural activation", type: "Therapy", set: "Unsorted", openedAt: null }),
];

describe("favourites view model", () => {
  it("groups Recent by calendar day with never-opened items last and alphabetical", () => {
    const groups = groupForView(library, "recent", now);
    expect(groups.map((group) => group.label)).toEqual([
      "Today",
      "Yesterday",
      "Earlier this week",
      "Older",
      "Not opened yet",
    ]);
    expect(groups[0]?.items.map((entry) => entry.id)).toEqual(["acamprosate", "lithium"]);
    expect(groups.at(-1)?.items.map((entry) => entry.id)).toEqual(["activation", "delirium"]);
  });

  it("groups by type in a fixed clinical order and sorts A to Z and My order without headings", () => {
    expect(groupForView(library, "type", now).map((group) => group.label)).toEqual([
      "Medications",
      "Differentials",
      "Therapies",
      "Documents",
      "Tables",
      "Sources",
    ]);
    const az = groupForView(library, "az", now);
    expect(az).toHaveLength(1);
    expect(az[0]?.label).toBe("");
    expect(az[0]?.items[0]?.id).toBe("acamprosate");
    const ordered = sortForView(
      [item({ id: "b", sortOrder: 20 }), item({ id: "a", sortOrder: 10 }), item({ id: "c", sortOrder: 10 })],
      "order",
    );
    expect(ordered.map((entry) => entry.id)).toEqual(["a", "c", "b"]);
    expect(groupForView([], "az", now)).toEqual([]);
  });

  it("builds set chips in the clinician's order, hides empty sets and puts Unsorted last", () => {
    const chips = buildSetChips(library, ["Clozapine clinic", "On call", "Ward round", "Prescribing safety"]);
    expect(chips).toEqual([
      { name: "Clozapine clinic", count: 2 },
      { name: "Ward round", count: 1 },
      { name: "Prescribing safety", count: 2 },
      { name: "Unsorted", count: 2 },
    ]);
    // A demo preset and an account set can share a fixed name; one chip each.
    expect(
      buildSetChips(library, ["Ward round", "Ward round"]).filter((chip) => chip.name === "Ward round"),
    ).toHaveLength(1);
  });

  it("picks the most recently opened item for Continue and nothing when nothing was opened", () => {
    expect(pickContinueItem(library)?.id).toBe("acamprosate");
    expect(pickContinueItem([item({ id: "never" })])).toBeNull();
  });

  it("keeps Quick launch in pin order and caps it at four", () => {
    const pins = Array.from({ length: 6 }, (_, index) =>
      item({ id: `pin-${index}`, pinned: true, pinnedAt: 10 - index }),
    );
    const tiles = quickLaunchItems(pins);
    expect(QUICK_LAUNCH_LIMIT).toBe(4);
    expect(tiles.map((entry) => entry.id)).toEqual(["pin-5", "pin-4", "pin-3", "pin-2"]);
    expect(quickLaunchHasRoom(pins)).toBe(false);
    expect(quickLaunchHasRoom(library)).toBe(true);
  });

  it("writes one plain summary line", () => {
    expect(favouritesSummary({ itemCount: 11, pinnedCount: 2 })).toBe("11 saved · 2 pinned");
    expect(favouritesSummary({ itemCount: 1, pinnedCount: 0 })).toBe("1 saved");
    expect(favouritesSummary({ itemCount: 0, pinnedCount: 0 })).toBe("0 saved");
  });

  it("labels times the way a clinician reads them", () => {
    expect(recentTimeLabel(at(29, 8, 44), now)).toBe("08:44");
    expect(recentTimeLabel(at(28, 16, 12), now)).toBe("16:12");
    expect(recentTimeLabel(at(27, 11, 3), now)).toBe("Sun");
    expect(recentTimeLabel(at(10, 10, 40), now)).toBe("10 Sep");
    expect(recentTimeLabel(null, now)).toBe("");
    expect(continueWhenLabel(at(29, 8, 44), now)).toBe("today at 08:44");
    expect(continueWhenLabel(at(28, 16, 12), now)).toBe("yesterday at 16:12");
    expect(continueWhenLabel(at(27, 11, 3), now)).toBe("on Sun");
  });

  it("turns demo labels into real times so fixtures sort like saved items", () => {
    expect(demoOpenedAt("Today 08:44", now)).toBe(at(29, 8, 44));
    expect(demoOpenedAt("Yesterday 16:12", now)).toBe(at(28, 16, 12));
    expect(demoOpenedAt("Mon 11:03", now)).toBe(at(28, 11, 3));
    expect(demoOpenedAt("Tue 07:00", now)).toBe(at(22, 7, 0));
    expect(demoOpenedAt("Saved", now)).toBeNull();
    expect(demoOpenedAt(undefined, now)).toBeNull();
  });

  it("matches search across title, type, set and evidence", () => {
    const lithium = library[1]!;
    expect(matchesFavouriteSearch(lithium, "  LITHIUM ")).toBe(true);
    expect(matchesFavouriteSearch(lithium, "prescribing")).toBe(true);
    expect(matchesFavouriteSearch(lithium, "document")).toBe(true);
    expect(matchesFavouriteSearch(lithium, "haloperidol")).toBe(false);
    expect(matchesFavouriteSearch(lithium, "")).toBe(true);
  });
});
