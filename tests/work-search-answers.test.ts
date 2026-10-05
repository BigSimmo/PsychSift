import { describe, expect, it } from "vitest";

import { onCallEntrySchema } from "@/lib/on-call/entry-model";
import { answerWorkQuestion, type WorkAnswerInput } from "@/lib/work-search/answers";
import { entryWorkItem, leaveWorkItems, sessionWorkItems, shiftWorkItems } from "@/lib/work-search/items";
import { workSearchAreas, type WorkAreaRead } from "@/lib/work-search/model";

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

const renewal = (id: string, title: string, expiresOn: string) => {
  const entry = onCallEntrySchema.parse({
    id,
    section: "logistics",
    slug: title.toLowerCase().replace(/\W+/g, "-"),
    title,
    details: { category: "Life support", kind: "compliance", expiresOn },
    isPersonal: true,
    isOwn: true,
  });
  return entryWorkItem(entry, `/admin/renewals#${id}`);
};

const items = [
  ...shiftWorkItems([
    night("n0", "2026-09-28"),
    night("n1", "2026-10-12"),
    night("n2", "2026-10-13"),
    night("n3", "2026-10-14"),
  ]),
  ...leaveWorkItems([
    { id: "l1", kind: "annual", startsOn: "2026-12-21", endsOn: "2026-12-24", status: "approved", serviceId: null },
  ]),
  ...sessionWorkItems([
    {
      occurrenceId: "o1",
      serviceId: "t",
      title: "Registrar teaching",
      startsAt: "2026-10-22T04:30:00.000Z",
      endsAt: "2026-10-22T05:30:00.000Z",
      venue: "Room 2",
      hasJoinLink: false,
      status: "scheduled",
      isPresenter: true,
      source: "teaching",
    },
  ]),
  renewal("11111111-1111-4111-8111-111111111111", "Basic life support", "2026-10-18"),
  renewal("22222222-2222-4222-8222-222222222222", "Fire safety", "2026-09-30"),
  renewal("33333333-3333-4333-8333-333333333333", "Registration", "2027-05-31"),
];

const input: WorkAnswerInput = { items, areas: ready, today, cpd: null };

describe("answerWorkQuestion", () => {
  it("answers the next night with the run length and says what it understood", () => {
    const answer = answerWorkQuestion("When am I next on nights?", input);
    expect(answer).toMatchObject({
      area: "roster",
      headline: "Monday 12 October",
      understood: "Showing your next night",
      source: "From your Roster",
    });
    expect(answer?.meta).toEqual(["First of 3 nights", "In 8 days"]);
    expect(answer?.action?.label).toBe("Open shift");
  });

  it("lists what is due, overdue first, and prints the window it used", () => {
    const answer = answerWorkQuestion("what's due this month", input);
    expect(answer?.understood).toBe("Showing renewals and talks due by Saturday 31 October, overdue first");
    expect(answer?.items.map((item) => item.title)).toEqual([
      "Fire safety",
      "Basic life support",
      "Registrar teaching",
    ]);
    expect(answer?.headline).toBe("1 overdue, 2 coming up");
  });

  it("defaults 'due' to the next 30 days and says so", () => {
    const answer = answerWorkQuestion("renewals due", input);
    expect(answer?.understood).toContain("in the next 30 days");
  });

  it("answers next leave and presenting", () => {
    expect(answerWorkQuestion("when is my next leave", input)).toMatchObject({
      headline: "Monday 21 December",
      meta: ["Until Thu 24 Dec", "Approved", "In 78 days"],
    });
    expect(answerWorkQuestion("am I presenting", input)).toMatchObject({
      headline: "Thursday 22 October",
      sub: "Registrar teaching",
    });
  });

  it("never answers from an area that failed to load", () => {
    const failed = {
      ...input,
      areas: ready.map((read) => (read.area === "my-work" ? { ...read, status: "failed" as const } : read)),
    };
    const answer = answerWorkQuestion("what's due", failed);
    expect(answer?.unavailable).toBe("Admin couldn't load, so this can't be answered yet.");
    expect(answer?.items).toEqual([]);
  });

  it("measures CPD against confirmed targets, and says when none are confirmed", () => {
    expect(answerWorkQuestion("cpd hours left", { ...input, cpd: { set: null, entries: [] } })?.headline).toBe(
      "No targets confirmed for this year",
    );
    const answer = answerWorkQuestion("how many cpd hours do I need", {
      ...input,
      cpd: {
        set: {
          year: 2026,
          confirmedOn: "2026-01-02",
          confirmedSource: "Test",
          totalHours: 50,
          requirements: [
            {
              id: "r1",
              label: "Total hours",
              source: "college" as never,
              spec: { shape: "hours-in-category", category: "educational", minimumHours: 12 },
              completedOn: null,
            },
          ],
        },
        entries: [],
      },
    });
    expect(answer).toMatchObject({
      area: "cme",
      headline: "1 target still short",
      sub: "0 of 1 targets met so far this year",
    });
    expect(answer?.progress?.[0]).toMatchObject({ label: "Total hours", met: false, fraction: 0 });
  });

  it("leaves ordinary words to word search", () => {
    expect(answerWorkQuestion("leave form", input)).toBeNull();
    expect(answerWorkQuestion("switchboard", input)).toBeNull();
  });
});
