import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { onCallEntrySchema } from "@/lib/on-call/entry-model";
import {
  cmeActivityWorkItems,
  entryWorkItem,
  leaveWorkItems,
  sessionWorkItems,
  shiftWorkItems,
} from "@/lib/work-search/items";
import { searchWork, workComingUp, workSearchCounts } from "@/lib/work-search/search";
import { clinicalSearchHref, looksClinical, looksLikePatientDetails } from "@/lib/work-search/signals";

const today = "2026-10-04";

const shifts = shiftWorkItems([
  {
    id: "s1",
    startsAt: "2026-10-12T13:00:00.000Z",
    endsAt: "2026-10-13T00:30:00.000Z",
    title: "Ward 4",
    location: "Ward 4",
    kind: "night",
  },
  {
    id: "s0",
    startsAt: "2026-09-20T13:00:00.000Z",
    endsAt: "2026-09-21T00:30:00.000Z",
    title: "Ward 4",
    location: "Ward 4",
    kind: "night",
  },
  {
    id: "s2",
    startsAt: "2026-10-05T00:00:00.000Z",
    endsAt: "2026-10-05T08:30:00.000Z",
    title: "",
    location: null,
    kind: "day",
  },
]);

const leave = leaveWorkItems([
  { id: "l1", kind: "annual", startsOn: "2026-12-21", endsOn: "2027-01-04", status: "approved", serviceId: null },
]);

const sessions = sessionWorkItems([
  {
    occurrenceId: "o1",
    serviceId: "t1",
    title: "Journal club: lithium monitoring",
    startsAt: "2026-10-08T04:30:00.000Z",
    endsAt: "2026-10-08T05:30:00.000Z",
    venue: "Seminar room",
    hasJoinLink: false,
    status: "scheduled",
    isPresenter: true,
    source: "teaching",
  },
  {
    occurrenceId: "o2",
    serviceId: "t1",
    title: "Cancelled talk",
    startsAt: "2026-10-09T04:30:00.000Z",
    endsAt: "2026-10-09T05:30:00.000Z",
    venue: null,
    hasJoinLink: false,
    status: "cancelled",
    isPresenter: false,
    source: "teaching",
  },
]);

const cpd = cmeActivityWorkItems([
  {
    id: "c1",
    date: "2026-09-10",
    title: "Peer review meeting",
    allocations: [{ category: "reviewing", hours: 1.5 }],
    reflection: "Discussed night handover structure",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
  },
  {
    id: "c2",
    date: "2026-09-11",
    title: "Archived",
    allocations: [],
    reflection: "",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
    archivedAt: "2026-09-12T00:00:00Z",
  },
]);

const contact = onCallEntrySchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  section: "contacts",
  slug: "switchboard",
  title: "Switchboard",
  details: { role: "Hospital switch", phone: "(08) 9224 1000" },
  isOwn: true,
});
const bls = onCallEntrySchema.parse({
  id: "22222222-2222-4222-8222-222222222222",
  section: "logistics",
  slug: "bls",
  title: "Basic life support",
  details: { category: "Life support", kind: "compliance", expiresOn: "2026-10-18" },
  isPersonal: true,
  isOwn: true,
});
const entries = [
  { entry: contact, item: entryWorkItem(contact, "/on-call/contacts#x") },
  { entry: bls, item: entryWorkItem(bls, "/admin/renewals#y") },
];

const items = [...shifts, ...leave, ...sessions, ...cpd];

describe("work search items", () => {
  it("maps each area's records with Perth dates and the page they open on", () => {
    expect(shifts[0]).toMatchObject({ area: "roster", date: "2026-10-12", href: "/roster/shifts" });
    expect(shifts[0]?.detail).toBe("Mon 12 Oct · 21:00 to 08:30 Tue · Ward 4");
    expect(shifts[2]?.title).toBe("Day shift");
    expect(leave[0]).toMatchObject({ title: "Annual leave", date: "2026-12-21" });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ href: "/teaching/session/o1", area: "teaching" });
    expect(sessions[0]?.detail).toContain("You're presenting");
    expect(cpd).toHaveLength(1);
    expect(cpd[0]).toMatchObject({ area: "cme", href: "/cme/log/c1" });
  });

  it("files a compliance row under Admin as a renewal with its recorded date", () => {
    expect(entries[1]?.item).toMatchObject({ area: "my-work", kind: "renewal", date: "2026-10-18" });
    expect(entries[0]?.item).toMatchObject({ area: "on-call", kind: "entry", date: null });
  });
});

describe("searchWork", () => {
  const search = (query: string, currentArea: Parameters<typeof searchWork>[2]["currentArea"] = null) =>
    searchWork({ items, entries }, query, { currentArea, today });

  it("returns nothing for an empty query", () => {
    expect(search("   ")).toEqual([]);
  });

  it("finds nights by kind, upcoming before past, then a note that mentions a night", () => {
    const ids = search("nights").map((hit) => hit.item.id);
    expect(ids).toEqual(["roster:shift:s1", "roster:shift:s0", "cme:activity:c1"]);
  });

  it("requires every word to match", () => {
    expect(search("ward 4").map((hit) => hit.item.id)).toContain("roster:shift:s1");
    expect(search("ward zebra")).toEqual([]);
  });

  it("matches phone numbers however they are typed, through On Call's own search", () => {
    expect(search("92241000").map((hit) => hit.item.id)).toEqual([`entry:entry:${contact.id}`]);
  });

  it("ranks a title match above a match only in a note", () => {
    const hits = search("night");
    const cpdHit = hits.find((hit) => hit.item.id === "cme:activity:c1");
    expect(cpdHit?.rank).toBe(2);
    expect(hits[0]?.rank).toBeLessThan(2);
  });

  it("puts the current area first among equal matches", () => {
    const hits = searchWork(
      { items: [...sessions, ...cpd.map((item) => ({ ...item, title: "Journal club notes" }))], entries: [] },
      "journal",
      { currentArea: "cme", today },
    );
    expect(hits[0]?.item.area).toBe("cme");
  });

  it("counts hits per area for the chips", () => {
    expect(workSearchCounts(search("ward"))).toEqual({ roster: 2 });
  });
});

describe("workComingUp", () => {
  it("shows the next dated item per area, soonest first, never past CPD activity", () => {
    const next = workComingUp(
      [...items, ...entries.map(({ item }) => item)],
      today,
      Date.parse(`${today}T00:00:00+08:00`),
    );
    expect(next.map((item) => item.id)).toEqual(["roster:shift:s2", "teaching:session:o1", `entry:renewal:${bls.id}`]);
  });
});

describe("work search privacy boundary", () => {
  it("never imports or reads the device-only patient-label store", () => {
    const roots = ["src/lib/work-search", "src/components/work-search"];
    for (const root of roots) {
      let files: string[] = [];
      try {
        files = readdirSync(root, { recursive: true }).map(String);
      } catch {
        continue;
      }
      for (const file of files.filter((name) => /\.tsx?$/.test(name))) {
        const source = readFileSync(path.join(root, file), "utf8");
        expect(source, file).not.toMatch(/from\s+["'][^"']*(?:patient-label|call-log|mha-timers|handover)/);
        expect(source, file).not.toMatch(/psychsift:patient-labels/);
      }
    }
  });
});

describe("work search signals", () => {
  it("spots patient details so they are never kept in Recent", () => {
    for (const query of ["bed 12 UR 447102", "UMRN 4471023", "DOB 03/04/1981", "mrn: 12345", "1234567"]) {
      expect(looksLikePatientDetails(query), query).toBe(true);
    }
    for (const query of ["leave form", "night shift allowance", "CPD hours 2026", "ward 4"]) {
      expect(looksLikePatientDetails(query), query).toBe(false);
    }
  });

  it("offers clinical search for clinical questions only", () => {
    for (const query of ["lithium level timing", "clozapine titration", "QTc on haloperidol"]) {
      expect(looksClinical(query), query).toBe(true);
    }
    for (const query of ["leave form", "when am I next on nights", "parking permit", "journal club"]) {
      expect(looksClinical(query), query).toBe(false);
    }
    expect(clinicalSearchHref(" lithium level ")).toBe("/?mode=answer&q=lithium+level&focus=1");
  });
});
