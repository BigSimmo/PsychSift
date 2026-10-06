import { describe, expect, it } from "vitest";

import { cmeMyDayItems } from "@/components/my-day/sources/cme";
import { rosterMyDayItems, type RosterMyDayInput } from "@/components/my-day/sources/roster";
import { cmeDraftPayloadSchema, type CmeDraft } from "@/lib/cme/drafts";
import type { CmeRoutine } from "@/lib/cme/routines";
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from "@/lib/reminders/settings";
import type { RosterManage, RosterSwap } from "@/lib/roster/team/model";

// Mon 5 Oct 2026, 10:00 in Perth.
const NOW = new Date("2026-10-05T02:00:00Z");
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SERVICE = "33333333-3333-4333-8333-333333333333";

function swap(overrides: Partial<RosterSwap>): RosterSwap {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    status: "requested",
    autoApproved: false,
    needsManagerBecause: null,
    cancelReason: null,
    requesterId: OTHER,
    counterpartyId: ME,
    give: null,
    take: null,
    expiresAt: "2026-10-04T00:00:00Z",
    createdAt: "2026-10-01T00:00:00Z",
    decidedAt: null,
    requesterName: "Sam",
    ...overrides,
  };
}

function rosterInput(overrides: Partial<RosterMyDayInput["teams"][number]> = {}, sample = false): RosterMyDayInput {
  return {
    actorId: ME,
    sample,
    teams: [
      {
        team: { serviceId: SERVICE, role: "member" },
        overview: { nextCutoffOn: null },
        requests: { swaps: [] },
        manage: null,
        ...overrides,
      },
    ],
  };
}

describe("rosterMyDayItems", () => {
  it("lists a swap waiting on the reader, with Today's wording, href and expiry", () => {
    const items = rosterMyDayItems(
      rosterInput({ requests: { swaps: [swap({ expiresAt: "2026-10-10T00:00:00Z" })] } }),
      NOW,
    );
    expect(items).toEqual([
      {
        id: "roster:swap:44444444-4444-4444-8444-444444444444",
        mode: "roster",
        title: "Sam asks to swap",
        due: "2026-10-10T00:00:00Z",
        severity: "soon",
        href: `/roster/swaps?team=${SERVICE}`,
      },
    ]);
  });

  it("falls back to 'A colleague' and leaves out swaps that are not waiting on the reader", () => {
    const items = rosterMyDayItems(
      rosterInput({
        requests: {
          swaps: [
            swap({ requesterName: null, expiresAt: "2026-12-01T00:00:00Z" }),
            swap({ id: "55555555-5555-4555-8555-555555555555", requesterId: ME, counterpartyId: OTHER }),
            swap({ id: "66666666-6666-4666-8666-666666666666", status: "declined" }),
            swap({ id: "77777777-7777-4777-8777-777777777777", expiresAt: "2026-10-01T00:00:00Z" }),
          ],
        },
      }),
      NOW,
    );
    expect(items.map((item) => [item.title, item.severity])).toEqual([["A colleague asks to swap", "info"]]);
  });

  it("counts manager waiting only for a manager, and never for a member", () => {
    const manage = {
      swaps: [],
      openShifts: [{ status: "claimed" }, { status: "reported" }, { status: "open" }],
    } as unknown as Pick<RosterManage, "swaps" | "openShifts">;
    const asManager = rosterMyDayItems(rosterInput({ team: { serviceId: SERVICE, role: "manager" }, manage }), NOW);
    expect(asManager).toEqual([
      {
        id: `roster:manage:${SERVICE}`,
        mode: "roster",
        title: "2 waiting in Manage",
        due: null,
        severity: "info",
        href: `/roster/manage?team=${SERVICE}`,
      },
    ]);
    expect(rosterMyDayItems(rosterInput({ manage }), NOW)).toEqual([]);
  });

  it("shows the cutoff only within 14 Perth days, as Today does", () => {
    const at = (nextCutoffOn: string | null) =>
      rosterMyDayItems(rosterInput({ overview: { nextCutoffOn } }), NOW).map((item) => item.id);
    expect(at("2026-10-19")).toEqual([`roster:cutoff:${SERVICE}`]);
    expect(at("2026-10-20")).toEqual([]);
    expect(at("2026-10-04")).toEqual([]);
    const [item] = rosterMyDayItems(rosterInput({ overview: { nextCutoffOn: "2026-10-08" } }), NOW);
    expect(item).toMatchObject({
      title: "Next roster closes Thu 8 Oct. Add dates you can't work.",
      due: "2026-10-08",
      severity: "soon",
      href: `/roster/requests?start=dates&team=${SERVICE}`,
    });
  });

  it("returns nothing for sample data, however much it holds", () => {
    expect(rosterMyDayItems(rosterInput({ requests: { swaps: [swap({})] } }, true), NOW)).toEqual([]);
  });

  it("returns nothing for a reader with no teams", () => {
    expect(rosterMyDayItems({ actorId: ME, teams: [] }, NOW)).toEqual([]);
  });
});

function routine(overrides: Partial<CmeRoutine>): CmeRoutine {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "Journal club",
    cadence: "monthly",
    usualHours: 1,
    usualAllocations: [],
    nextDue: "2026-10-05",
    archivedAt: null,
    ...overrides,
  };
}

function draft(overrides: Partial<CmeDraft>): CmeDraft {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    payload: cmeDraftPayloadSchema.parse({}),
    waitingOn: null,
    waitingNote: null,
    followUpOn: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
    ...overrides,
  };
}

const remindersOff: ReminderSettings = {
  ...DEFAULT_REMINDER_SETTINGS,
  types: {
    ...DEFAULT_REMINDER_SETTINGS.types,
    "cpd-routines": { ...DEFAULT_REMINDER_SETTINGS.types["cpd-routines"], showInApp: false },
  },
};

describe("cmeMyDayItems", () => {
  const reminders = DEFAULT_REMINDER_SETTINGS;

  it("lists a due routine with the reader's own title, the dashboard's log href and a severity", () => {
    const items = cmeMyDayItems(
      {
        routines: [
          routine({}),
          routine({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "Old", nextDue: "2026-09-30" }),
        ],
        drafts: [],
        year: 2026,
      },
      NOW,
      reminders,
    );
    expect(items).toEqual([
      {
        id: "cme:routine:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        mode: "cme",
        title: "Old",
        detail: "Routine due",
        due: "2026-09-30",
        severity: "overdue",
        href: "/cme/new?routine=cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      },
      {
        id: "cme:routine:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        mode: "cme",
        title: "Journal club",
        detail: "Routine due",
        due: "2026-10-05",
        severity: "soon",
        href: "/cme/new?routine=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    ]);
  });

  it("skips routines not yet due, archived or unscheduled", () => {
    const items = cmeMyDayItems(
      {
        routines: [
          routine({ nextDue: "2026-10-06" }),
          routine({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", archivedAt: "2026-09-01T00:00:00Z" }),
          routine({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", nextDue: null }),
        ],
        drafts: [],
        year: 2026,
      },
      NOW,
      reminders,
    );
    expect(items).toEqual([]);
  });

  it("hides routines when the CPD routines reminder is off, but still counts drafts", () => {
    const items = cmeMyDayItems({ routines: [routine({})], drafts: [draft({})], year: 2026 }, NOW, remindersOff);
    expect(items.map((item) => item.id)).toEqual(["cme:drafts"]);
  });

  it("counts only drafts waiting on the reader, with correct plurals and href", () => {
    const one = cmeMyDayItems({ routines: [], drafts: [draft({})], year: 2026 }, NOW, reminders);
    expect(one).toEqual([
      {
        id: "cme:drafts",
        mode: "cme",
        title: "Finish 1 CPD draft",
        due: null,
        severity: "info",
        href: "/cme/log?year=2026&tab=finish#cme-drafts",
      },
    ]);
    const two = cmeMyDayItems(
      {
        routines: [],
        drafts: [
          draft({}),
          draft({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff" }),
          draft({ id: "99999999-9999-4999-8999-999999999999", waitingOn: "supervisor" }),
        ],
        year: "2026",
      },
      NOW,
      reminders,
    );
    expect(two[0]?.title).toBe("Finish 2 CPD drafts");
    expect(
      cmeMyDayItems({ routines: [], drafts: [draft({ waitingOn: "workforce" })], year: 2026 }, NOW, reminders),
    ).toEqual([]);
  });

  it("never echoes draft titles, notes or reflections", () => {
    const secret = "Patient Zed reflection";
    const items = cmeMyDayItems(
      {
        routines: [],
        drafts: [draft({ payload: cmeDraftPayloadSchema.parse({ title: secret }), waitingNote: secret })],
        year: 2026,
      },
      NOW,
      reminders,
    );
    expect(JSON.stringify(items)).not.toContain(secret);
  });
});
