import { describe, expect, it } from "vitest";

import {
  daysUntilLearningStart,
  learningCountdownLabel,
  splitUpcomingLearning,
} from "@/lib/cme/learning-directory-view";

import directoryJson from "@/data/cme/wa-learning-directory.json";
import {
  defaultLearningSpecialty,
  filterLearningItems,
  groupLearningByMonth,
  isDirectoryStale,
  learningItemLogHref,
  loadLearningDirectory,
  parseLearningDirectory,
  pastLearningItems,
  unconfirmedLearningItems,
  upcomingLearningItems,
  type LearningDirectoryItem,
} from "@/lib/cme/learning-directory";

const TODAY_PERTH = "2026-09-26";

function item(overrides: Partial<LearningDirectoryItem> = {}): LearningDirectoryItem {
  return {
    id: "synthetic-item",
    title: "Synthetic workshop",
    provider: "Synthetic provider",
    kind: "event",
    datesConfirmed: true,
    startsOn: "2026-10-10",
    endsOn: null,
    mode: "in-person",
    location: "Perth",
    costNote: null,
    url: "https://example.org/event",
    sourceUrl: "https://example.org/event",
    lastCheckedOn: "2026-09-26",
    ...overrides,
  };
}

describe("the committed WA learning directory file", () => {
  it("validates, whether the list is empty or filled", () => {
    const directory = parseLearningDirectory(directoryJson);
    expect(directory.lastCheckedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(loadLearningDirectory()).toEqual(directory);
    for (const entry of directory.items) {
      expect(entry.url.startsWith("https://"), entry.id).toBe(true);
      expect(entry.sourceUrl.startsWith("https://"), entry.id).toBe(true);
      expect(entry.lastCheckedOn, entry.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("parseLearningDirectory", () => {
  it("accepts a well-formed synthetic directory", () => {
    const parsed = parseLearningDirectory({ lastCheckedOn: TODAY_PERTH, items: [item()] });
    expect(parsed.items).toHaveLength(1);
  });

  it("rejects a non-https link", () => {
    expect(() =>
      parseLearningDirectory({ lastCheckedOn: TODAY_PERTH, items: [item({ url: "http://example.org/event" })] }),
    ).toThrow(/https/);
  });

  it("rejects a relative link or one carrying credentials", () => {
    expect(() => parseLearningDirectory({ lastCheckedOn: TODAY_PERTH, items: [item({ sourceUrl: "/cme" })] })).toThrow(
      /https/,
    );
    expect(() =>
      parseLearningDirectory({ lastCheckedOn: TODAY_PERTH, items: [item({ url: "https://u:p@example.org/" })] }),
    ).toThrow(/https/);
  });

  it("requires a start date when the dates are confirmed, unless the item is recorded", () => {
    expect(() => parseLearningDirectory({ lastCheckedOn: TODAY_PERTH, items: [item({ startsOn: null })] })).toThrow(
      /start date/,
    );
    expect(() =>
      parseLearningDirectory({ lastCheckedOn: TODAY_PERTH, items: [item({ kind: "recorded", startsOn: null })] }),
    ).not.toThrow();
  });

  it("allows null dates for any kind when the dates are unconfirmed", () => {
    expect(() =>
      parseLearningDirectory({
        lastCheckedOn: TODAY_PERTH,
        items: [item({ datesConfirmed: false, startsOn: null, endsOn: null })],
      }),
    ).not.toThrow();
  });

  it("rejects a missing datesConfirmed flag, an unknown field, a bad date and duplicate ids", () => {
    const withoutFlag: Partial<LearningDirectoryItem> = item();
    delete withoutFlag.datesConfirmed;
    expect(() => parseLearningDirectory({ lastCheckedOn: TODAY_PERTH, items: [withoutFlag] })).toThrow();
    expect(() => parseLearningDirectory({ lastCheckedOn: TODAY_PERTH, items: [{ ...item(), extra: 1 }] })).toThrow();
    expect(() =>
      parseLearningDirectory({ lastCheckedOn: TODAY_PERTH, items: [item({ startsOn: "2026-02-30" })] }),
    ).toThrow();
    expect(() => parseLearningDirectory({ lastCheckedOn: TODAY_PERTH, items: [item(), item()] })).toThrow(/Duplicate/);
  });

  it("rejects an end date before the start date", () => {
    expect(() =>
      parseLearningDirectory({
        lastCheckedOn: TODAY_PERTH,
        items: [item({ startsOn: "2026-10-10", endsOn: "2026-10-09" })],
      }),
    ).toThrow(/before the start/);
  });

  it("accepts optional specialties and paired Perth times, rejecting duplicates or an incomplete time", () => {
    expect(() =>
      parseLearningDirectory({
        lastCheckedOn: TODAY_PERTH,
        items: [item({ specialties: ["psychiatry"], startsAt: "09:30", endsAt: "16:00" })],
      }),
    ).not.toThrow();
    expect(() => parseLearningDirectory({ lastCheckedOn: TODAY_PERTH, items: [item({ startsAt: "09:30" })] })).toThrow(
      /both start and end times/,
    );
    expect(() =>
      parseLearningDirectory({
        lastCheckedOn: TODAY_PERTH,
        items: [item({ specialties: ["psychiatry", "Psychiatry"] })],
      }),
    ).toThrow(/unique/);
  });
});

describe("Learning filters and groups", () => {
  const all = item({ id: "all", title: "All doctors", mode: "online", startsOn: "2026-10-01" });
  const psychiatry = item({ id: "psychiatry", specialties: ["psychiatry"], mode: "both", startsOn: "2026-10-02" });
  const surgery = item({ id: "surgery", specialties: ["surgery"], mode: "in-person", startsOn: "2026-11-01" });

  it("defaults to psychiatry only for the confirmed RANZCP preset, with All available in one change", () => {
    expect(defaultLearningSpecialty("au-ranzcp-2026-v1; https://example.org")).toBe("psychiatry");
    expect(defaultLearningSpecialty("Medical Board baseline")).toBe("all");
    expect(defaultLearningSpecialty(null)).toBe("all");
    expect(
      filterLearningItems([all, psychiatry, surgery], { specialty: "psychiatry", format: "any" }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["all", "psychiatry"]);
    expect(filterLearningItems([all, psychiatry, surgery], { specialty: "all", format: "any" })).toHaveLength(3);
  });

  it("includes mixed-mode events in either format and groups dates by month", () => {
    expect(
      filterLearningItems([all, psychiatry, surgery], { specialty: "all", format: "online" }).map((entry) => entry.id),
    ).toEqual(["all", "psychiatry"]);
    expect(
      filterLearningItems([all, psychiatry, surgery], { specialty: "all", format: "in-person" }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["psychiatry", "surgery"]);
    expect(
      groupLearningByMonth([all, psychiatry, surgery]).map((group) => [group.key, group.label, group.items.length]),
    ).toEqual([
      ["2026-10", "October 2026", 2],
      ["2026-11", "November 2026", 1],
    ]);
  });

  it("keeps only finished confirmed events in Past, most recent first", () => {
    const unconfirmed = item({ id: "guess", datesConfirmed: false, startsOn: "2026-01-01" });
    expect(pastLearningItems([all, psychiatry, surgery, unconfirmed], "2026-11-02").map((entry) => entry.id)).toEqual([
      "surgery",
      "psychiatry",
      "all",
    ]);
  });
});

describe("upcomingLearningItems", () => {
  const past = item({ id: "past", title: "Past", startsOn: "2026-09-25" });
  const today = item({ id: "today", title: "Today", startsOn: TODAY_PERTH });
  const runningMultiDay = item({ id: "running", title: "Running", startsOn: "2026-09-20", endsOn: "2026-09-27" });
  const endedMultiDay = item({ id: "ended", title: "Ended", startsOn: "2026-09-20", endsOn: "2026-09-25" });
  const later = item({ id: "later", title: "Later", startsOn: "2026-11-01" });
  const recorded = item({ id: "recorded", title: "Recorded", kind: "recorded", startsOn: null });
  const unconfirmedPast = item({
    id: "unconfirmed",
    title: "Unconfirmed",
    datesConfirmed: false,
    startsOn: "2026-01-01",
  });

  it("hides events that finished before today's Perth date and keeps ones running today", () => {
    const ids = upcomingLearningItems(
      [later, recorded, past, endedMultiDay, today, runningMultiDay, unconfirmedPast],
      TODAY_PERTH,
    ).map((entry) => entry.id);
    expect(ids).toEqual(["running", "today", "later", "recorded"]);
  });

  it("never hides or includes items whose dates are unconfirmed", () => {
    expect(upcomingLearningItems([unconfirmedPast], TODAY_PERTH)).toEqual([]);
    expect(unconfirmedLearningItems([later, unconfirmedPast]).map((entry) => entry.id)).toEqual(["unconfirmed"]);
  });
});

describe("isDirectoryStale", () => {
  it("is false at 45 days and true at 46", () => {
    expect(isDirectoryStale("2026-08-12", TODAY_PERTH)).toBe(false);
    expect(isDirectoryStale("2026-08-11", TODAY_PERTH)).toBe(true);
  });
});

describe("learningItemLogHref", () => {
  it("carries only a title and a source link", () => {
    const href = learningItemLogHref(item({ title: "A & B" }));
    const url = new URL(href, "https://psychiatry.tools");
    expect(url.pathname).toBe("/cme/new");
    expect([...url.searchParams.keys()]).toEqual(["title", "sourceUrl"]);
    expect(url.searchParams.get("title")).toBe("A & B");
    expect(url.searchParams.get("sourceUrl")).toBe("https://example.org/event");
  });
});

describe("learning countdown and upcoming split", () => {
  it("labels the countdown in plain words and never goes negative", () => {
    expect(learningCountdownLabel("2026-09-26", TODAY_PERTH)).toBe("Today");
    expect(learningCountdownLabel("2026-09-24", TODAY_PERTH)).toBe("On now");
    expect(learningCountdownLabel("2026-09-27", TODAY_PERTH)).toBe("Tomorrow");
    expect(learningCountdownLabel("2026-10-16", TODAY_PERTH)).toBe("In 20 days");
    expect(daysUntilLearningStart("2026-09-01", TODAY_PERTH)).toBe(0);
  });

  it("puts the next two first, then this year, then later years and any time", () => {
    const upcoming = [
      item({ id: "a", startsOn: "2026-10-01" }),
      item({ id: "b", startsOn: "2026-10-05" }),
      item({ id: "c", startsOn: "2026-12-01" }),
      item({ id: "d", startsOn: "2027-01-05" }),
      item({ id: "e", kind: "recorded", startsOn: null }),
    ];
    const split = splitUpcomingLearning(upcoming, TODAY_PERTH);
    expect(split.next.map((i) => i.id)).toEqual(["a", "b"]);
    expect(split.laterThisYear.map((i) => i.id)).toEqual(["c"]);
    expect(split.nextYearAndAnyTime.map((i) => i.id)).toEqual(["d", "e"]);
  });

  it("keeps something already running with this year, even when it started last year", () => {
    const upcoming = [
      item({ id: "a", startsOn: "2026-10-01" }),
      item({ id: "b", startsOn: "2026-10-05" }),
      item({ id: "running", startsOn: "2025-12-29" }),
    ];
    const split = splitUpcomingLearning(upcoming, "2026-01-01");
    expect(split.laterThisYear.map((i) => i.id)).toEqual(["running"]);
    expect(split.nextYearAndAnyTime).toEqual([]);
  });

  it("skips undated items when choosing the next two", () => {
    const split = splitUpcomingLearning([item({ id: "x", startsOn: null }), item({ id: "y" })], TODAY_PERTH);
    expect(split.next.map((i) => i.id)).toEqual(["y"]);
  });
});
