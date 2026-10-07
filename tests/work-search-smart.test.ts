import { describe, expect, it } from "vitest";

import { onCallEntrySchema } from "@/lib/on-call/entry-model";
import { answerWorkQuestion, type WorkAnswerInput } from "@/lib/work-search/answers";
import { entryWorkItem, leaveWorkItems, shiftWorkItems } from "@/lib/work-search/items";
import { workSearchAreas, type WorkAreaRead } from "@/lib/work-search/model";
import { searchWorkPages, workSearchPages } from "@/lib/work-search/pages";
import { buildWorkSearchIndex, searchWork, workSearchCorrection } from "@/lib/work-search/search";

/**
 * The "smart and fast" layer of Search my work (work-mode redesign, owner
 * request 6 Oct 2026): typo-tolerant questions, more ways to ask, the CPD pace
 * line, urgency ordering, the once-built index and Pages. No AI, no network.
 */

const today = "2026-10-04";
const ready: WorkAreaRead[] = workSearchAreas.map((area) => ({ area, status: "ready", sample: false }));

const night = (id: string, date: string) => ({
  id,
  startsAt: `${date}T13:00:00.000Z`,
  endsAt: `${date}T23:30:00.000Z`,
  title: "Ward 4",
  location: "Ward 4",
  kind: "night" as const,
});

const renewal = (id: string, title: string, expiresOn: string) =>
  entryWorkItem(
    onCallEntrySchema.parse({
      id,
      section: "logistics",
      slug: title.toLowerCase().replace(/\W+/g, "-"),
      title,
      details: { category: "Life support", kind: "compliance", expiresOn },
      isPersonal: true,
      isOwn: true,
    }),
    `/admin/renewals#${id}`,
  );

const items = [
  ...shiftWorkItems([night("n1", "2026-10-12"), night("n2", "2026-10-13")]),
  ...leaveWorkItems([
    { id: "l1", kind: "annual", startsOn: "2026-12-21", endsOn: "2026-12-24", status: "approved", serviceId: null },
  ]),
  renewal("11111111-1111-4111-8111-111111111111", "Basic life support refresher", "2026-11-18"),
  renewal("22222222-2222-4222-8222-222222222222", "Basic life support", "2026-09-23"),
];

const input: WorkAnswerInput = { items, areas: ready, today, cpd: null };

describe("questions with a word one letter out", () => {
  it("reads the typo, answers, and says which word it read as what", () => {
    const answer = answerWorkQuestion("when am i next on nihgts", input);
    expect(answer).toMatchObject({ area: "roster", headline: "Monday 12 October" });
    expect(answer?.readAs).toEqual([{ typed: "nihgts", read: "nights" }]);
  });

  it("corrects the date words too", () => {
    expect(answerWorkQuestion("am i workign tomorow", input)?.readAs).toEqual([
      { typed: "workign", read: "working" },
      { typed: "tomorow", read: "tomorrow" },
    ]);
  });

  it("never reads an ordinary word as a question word", () => {
    expect(answerWorkQuestion("when might i be free", input)?.readAs).toBeUndefined();
    expect(answerWorkQuestion("leave form", input)).toBeNull();
  });

  it("leaves a question it understood as typed untouched", () => {
    expect(answerWorkQuestion("When am I next on nights?", input)?.readAs).toBeUndefined();
  });
});

describe("more ways to ask", () => {
  it("knows AL, PDL and time off as leave", () => {
    for (const question of ["when is my next AL", "next pdl", "when is my next time off"]) {
      expect(answerWorkQuestion(question, input)?.label, question).toBe("Your next leave");
    }
  });

  it("knows night shift, nightshift and overnights as nights", () => {
    for (const question of ["when is my next night shift", "next nightshift", "when am I next on overnights"]) {
      expect(answerWorkQuestion(question, input)?.headline, question).toBe("Monday 12 October");
    }
  });

  it("knows CME, points and hours left as CPD", () => {
    const cpd = { set: null, entries: [] };
    for (const question of ["how many cme points do I need", "how many hours left", "am I on track"]) {
      expect(answerWorkQuestion(question, { ...input, cpd })?.area, question).toBe("cme");
    }
  });
});

describe("CPD answer", () => {
  const set = {
    year: 2026,
    confirmedOn: "2026-01-08T01:00:00.000Z",
    confirmedSource: "Test",
    totalHours: 50,
    requirements: [
      {
        id: "r1",
        label: "Educational activities",
        source: "college" as never,
        spec: { shape: "hours-in-category" as const, category: "educational" as const, minimumHours: 12.5 },
        completedOn: null,
      },
    ],
  };
  const entries = [
    {
      id: "e1",
      date: "2026-03-02",
      title: "Journal club",
      allocations: [{ category: "educational" as const, hours: 32.5 }],
    },
  ] as never;

  it("says hours logged against the target and the weekly pace to 31 December", () => {
    const answer = answerWorkQuestion("How many CPD hours do I still need?", { ...input, cpd: { set, entries } });
    // 17.5 h to go over 88 days (12.6 weeks) is about 1.4 h a week.
    expect(answer?.meta).toEqual(["32.5 of 50 h logged", "About 1.4 h a week to 31 Dec"]);
    expect(answer?.ring).toEqual({ value: "17.5", unit: "h to go", fraction: 0.65 });
  });

  it("has no pace line once the total is reached", () => {
    const done = [
      {
        id: "e1",
        date: "2026-03-02",
        title: "Journal club",
        allocations: [{ category: "educational" as const, hours: 52 }],
      },
    ] as never;
    const answer = answerWorkQuestion("cpd hours left", { ...input, cpd: { set, entries: done } });
    expect(answer?.meta).toEqual(["52 of 50 h logged"]);
    expect(answer?.ring).toMatchObject({ value: "52", unit: "h logged", fraction: 1 });
  });
});

describe("urgency and recency", () => {
  it("puts a lapsed renewal above an upcoming one, and both above undated records", () => {
    const hits = searchWork({ items, entries: [] }, "basic life support", { currentArea: null, today });
    expect(hits.map((hit) => hit.item.title)).toEqual(["Basic life support", "Basic life support refresher"]);
  });
});

describe("the in-memory index", () => {
  it("collects every word once, so a typo is read without rescanning records", () => {
    const index = buildWorkSearchIndex({ items, entries: [] });
    expect(index.words).toContain("support");
    expect(new Set(index.words).size).toBe(index.words.length);
    expect(workSearchCorrection(index, "suport")).toEqual({ typed: "suport", read: "support" });
    expect(searchWork(index, "nights", { currentArea: null, today })).toHaveLength(2);
  });
});

describe("Pages", () => {
  it("lists each page once, never an action or a gated page", () => {
    const pages = workSearchPages();
    expect(new Set(pages.map((page) => page.href)).size).toBe(pages.length);
    expect(pages.some((page) => page.href === "/open-shifts/post")).toBe(false);
    expect(pages.some((page) => page.href === "/on-call/service")).toBe(false);
    expect(pages.every((page) => page.href.startsWith("/"))).toBe(true);
  });

  it("finds a page by its name or a word people use for it", () => {
    expect(searchWorkPages("leave")[0]?.page).toMatchObject({
      label: "Leave",
      area: "Roster",
      href: "/roster/requests",
    });
    expect(searchWorkPages("export")[0]?.page.href).toBe("/admin/compliance/export");
    expect(searchWorkPages("fit test")[0]?.page.href).toBe("/admin/compliance");
    expect(searchWorkPages("switchboard")[0]?.page.href).toBe("/on-call/call");
    expect(searchWorkPages("sync")[0]?.page.href).toBe("/roster/calendar");
  });

  it("ranks a name match above an area-name match", () => {
    const hits = searchWorkPages("swaps");
    expect(hits[0]?.page.label).toBe("Swaps");
    expect(searchWorkPages("parking permit")).toEqual([]);
  });
});
