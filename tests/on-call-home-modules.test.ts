import { describe, expect, it } from "vitest";

import type { OnCallEntry } from "@/lib/on-call/entry-model";
import {
  ON_CALL_CALL_FIRST_LIMIT,
  ON_CALL_WARD_STRIP_LIMIT,
  countOnCallEntriesBySection,
  isOnCallOutOfHours,
  msUntilOnCallHoursBoundary,
  onCallPrimaryNumber,
  onCallTelHref,
  selectCallFirstContacts,
  selectPinnedPlaybookEntry,
  selectSwitchboardContact,
  selectUpcomingSessions,
  selectWardContacts,
} from "@/lib/on-call/home-modules";
import { COMPLIANCE_KIND } from "@/lib/on-call/compliance";
import { onCallLocalDateKey } from "@/lib/on-call/local-date";
import { ROLE_EXPLAINER_KIND } from "@/lib/on-call/who-is-who";

/**
 * A Perth wall-clock instant, with the same arguments as `new Date(y, m, d, h)`
 * (month from 0). Working hours and "today" are read in the work time zone
 * (Perth by default), never the device's, so these tests no longer depend on
 * the zone the test runner happens to be in.
 */
const perthWall = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) =>
  new Date(Date.UTC(year, month, day, hour - 8, minute, second));

/**
 * The home is derived entirely from tags the owner controls. These tests pin the
 * derivation, and in particular the three ways it could put something useless on
 * the most-looked-at screen in the mode: a call card with no number, a role
 * explainer masquerading as a contact, and a teaching session that already
 * happened.
 */

let seq = 0;
function entry(overrides: Partial<OnCallEntry> & { section: OnCallEntry["section"] }): OnCallEntry {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${`${seq}`.padStart(12, "0")}`,
    slug: `entry-${seq}`,
    title: `Entry ${seq}`,
    subtitle: null,
    body: null,
    details: {},
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: null,
    ...overrides,
  };
}

const contact = (over: Partial<OnCallEntry> & { details?: unknown }) =>
  entry({ section: "contacts", details: { role: "Role" }, ...over });

/**
 * Perth wall-clock fixtures (`perthWall`, same arguments as `Date(y, m, d, h)`):
 * the rule is about the hour on the hospital's clock in the work time zone,
 * Perth by default, whatever zone the phone or the test runner is in.
 *
 * 16 September 2026 is a Wednesday, 19 September a Saturday, 20 September a
 * Sunday.
 */
const WEEKDAY_0900 = perthWall(2026, 8, 16, 9, 0, 0);
const WEEKDAY_2200 = perthWall(2026, 8, 16, 22, 0, 0);
const WEEKDAY_0800 = perthWall(2026, 8, 16, 8, 0, 0);
const WEEKDAY_0759 = perthWall(2026, 8, 16, 7, 59, 0);
const WEEKDAY_1700 = perthWall(2026, 8, 16, 17, 0, 0);
const WEEKDAY_1659 = perthWall(2026, 8, 16, 16, 59, 0);
const SATURDAY_MIDDAY = perthWall(2026, 8, 19, 12, 0, 0);
const SUNDAY_MIDDAY = perthWall(2026, 8, 20, 12, 0, 0);

describe("isOnCallOutOfHours", () => {
  it("is false during the weekday working day", () => {
    expect(isOnCallOutOfHours(WEEKDAY_0900)).toBe(false);
  });

  it("is true on a weekday evening", () => {
    expect(isOnCallOutOfHours(WEEKDAY_2200)).toBe(true);
  });

  it("treats 08:00 as the first in-hours minute and 17:00 as the first out-of-hours one", () => {
    expect(isOnCallOutOfHours(WEEKDAY_0759)).toBe(true);
    expect(isOnCallOutOfHours(WEEKDAY_0800)).toBe(false);
    expect(isOnCallOutOfHours(WEEKDAY_1659)).toBe(false);
    expect(isOnCallOutOfHours(WEEKDAY_1700)).toBe(true);
  });

  it("is true all weekend", () => {
    expect(isOnCallOutOfHours(SATURDAY_MIDDAY)).toBe(true);
    expect(isOnCallOutOfHours(SUNDAY_MIDDAY)).toBe(true);
  });
});

describe("onCallPrimaryNumber", () => {
  const both = contact({ details: { role: "R", phone: "1", afterHoursPhone: "2", pager: "3", extension: "4" } });

  it("offers the direct line during the working day", () => {
    expect(onCallPrimaryNumber(both, WEEKDAY_0900)).toEqual({ label: "Direct", value: "1" });
  });

  it("offers the after-hours line on a weekday evening, under its own name", () => {
    // The whole point of the mode: at 22:00 the direct desk line is not
    // answered, and a number shown under the wrong label is worse than none.
    expect(onCallPrimaryNumber(both, WEEKDAY_2200)).toEqual({ label: "After hours", value: "2" });
  });

  it("offers the after-hours line all weekend", () => {
    expect(onCallPrimaryNumber(both, SATURDAY_MIDDAY)).toEqual({ label: "After hours", value: "2" });
    expect(onCallPrimaryNumber(both, SUNDAY_MIDDAY)).toEqual({ label: "After hours", value: "2" });
  });

  it("switches at 08:00 and at 17:00", () => {
    expect(onCallPrimaryNumber(both, WEEKDAY_0759)).toEqual({ label: "After hours", value: "2" });
    expect(onCallPrimaryNumber(both, WEEKDAY_0800)).toEqual({ label: "Direct", value: "1" });
    expect(onCallPrimaryNumber(both, WEEKDAY_1659)).toEqual({ label: "Direct", value: "1" });
    expect(onCallPrimaryNumber(both, WEEKDAY_1700)).toEqual({ label: "After hours", value: "2" });
  });

  it("does not invent a second number for a contact that has only a direct line", () => {
    const directOnly = contact({ details: { role: "R", phone: "1" } });
    expect(onCallPrimaryNumber(directOnly, WEEKDAY_0900)).toEqual({ label: "Direct", value: "1" });
    expect(onCallPrimaryNumber(directOnly, WEEKDAY_2200)).toEqual({ label: "Direct", value: "1" });
  });

  it("does not invent a second number for a contact that has only an after-hours line", () => {
    const afterHoursOnly = contact({ details: { role: "R", afterHoursPhone: "2" } });
    expect(onCallPrimaryNumber(afterHoursOnly, WEEKDAY_0900)).toEqual({ label: "After hours", value: "2" });
    expect(onCallPrimaryNumber(afterHoursOnly, WEEKDAY_2200)).toEqual({ label: "After hours", value: "2" });
  });

  it("falls through to pager then extension in both windows", () => {
    const pagerAndExt = contact({ details: { role: "R", pager: "3", extension: "4" } });
    expect(onCallPrimaryNumber(pagerAndExt, WEEKDAY_0900)).toEqual({ label: "Pager", value: "3" });
    expect(onCallPrimaryNumber(pagerAndExt, WEEKDAY_2200)).toEqual({ label: "Pager", value: "3" });

    const extOnly = contact({ details: { role: "R", extension: "4" } });
    expect(onCallPrimaryNumber(extOnly, WEEKDAY_0900)).toEqual({ label: "Ext", value: "4" });
    expect(onCallPrimaryNumber(extOnly, WEEKDAY_2200)).toEqual({ label: "Ext", value: "4" });
  });

  it("is null for a contact with no number at all, in either window", () => {
    expect(onCallPrimaryNumber(contact({ details: { role: "R" } }), WEEKDAY_0900)).toBeNull();
    expect(onCallPrimaryNumber(contact({ details: { role: "R" } }), WEEKDAY_2200)).toBeNull();
  });

  it("is null for an entry that is not a contact", () => {
    expect(
      onCallPrimaryNumber(entry({ section: "logistics", details: { category: "Parking", phone: "5" } }), WEEKDAY_0900),
    ).toBeNull();
  });

  it("reads the real clock when no time is injected", () => {
    const now = new Date();
    expect(onCallPrimaryNumber(both)).toEqual(onCallPrimaryNumber(both, now));
  });
});

describe("onCallTelHref", () => {
  it("strips the formatting a human typed", () => {
    expect(onCallTelHref("(08) 9224 8888")).toBe("tel:0892248888");
  });

  it("keeps a leading plus, which is part of the number", () => {
    expect(onCallTelHref("+61 8 9224 8888")).toBe("tel:+61892248888");
  });

  it("is undefined when there are no digits to dial", () => {
    expect(onCallTelHref("via switchboard")).toBeUndefined();
    expect(onCallTelHref(undefined)).toBeUndefined();
    expect(onCallTelHref(null)).toBeUndefined();
  });
});

describe("selectCallFirstContacts", () => {
  it("takes the tagged contacts in the owner's order", () => {
    const second = contact({ tags: ["call-first"], sortOrder: 2, details: { role: "R", phone: "2" } });
    const first = contact({ tags: ["call-first"], sortOrder: 1, details: { role: "R", phone: "1" } });
    expect(selectCallFirstContacts([second, first]).map((e) => e.id)).toEqual([first.id, second.id]);
  });

  it("matches the tag regardless of case or padding", () => {
    const tagged = contact({ tags: ["  Call-First "], details: { role: "R", phone: "1" } });
    expect(selectCallFirstContacts([tagged])).toHaveLength(1);
  });

  it("never shows a call card that cannot call", () => {
    const noNumber = contact({ tags: ["call-first"], details: { role: "Consultant via switchboard" } });
    expect(selectCallFirstContacts([noNumber])).toEqual([]);
  });

  it("excludes a role explainer even when it is tagged", () => {
    const explainer = contact({
      tags: ["call-first"],
      details: { role: "Registrar", kind: ROLE_EXPLAINER_KIND, phone: "1" },
    });
    expect(selectCallFirstContacts([explainer])).toEqual([]);
  });

  it("excludes a personal contact even when it is tagged and has a number", () => {
    // Contacts already withholds personal digits so they cannot be read over a
    // shoulder. The home must not put the same number on the most-looked-at
    // cards in the mode.
    const personal = contact({
      tags: ["call-first"],
      isPersonal: true,
      details: { role: "My mobile", phone: "0400 111 222" },
    });
    expect(selectCallFirstContacts([personal])).toEqual([]);
  });

  it("caps at two, because a pair is the point", () => {
    const many = Array.from({ length: 5 }, (_, index) =>
      contact({ tags: ["call-first"], sortOrder: index, details: { role: "R", phone: `${index}` } }),
    );
    expect(selectCallFirstContacts(many)).toHaveLength(ON_CALL_CALL_FIRST_LIMIT);
  });
});

describe("selectSwitchboardContact", () => {
  it("returns the tagged contact", () => {
    const switchboard = contact({ tags: ["switchboard"], details: { role: "Switchboard", phone: "9" } });
    expect(selectSwitchboardContact([switchboard])?.id).toBe(switchboard.id);
  });

  it("returns one even when it carries no number, because 'ask switchboard' is still the answer", () => {
    const noNumber = contact({ tags: ["switchboard"], details: { role: "Switchboard" } });
    expect(selectSwitchboardContact([noNumber])?.id).toBe(noNumber.id);
  });

  it("is null when nothing is tagged", () => {
    expect(selectSwitchboardContact([contact({})])).toBeNull();
  });

  it("excludes a personal switchboard tag so the home does not print the digits", () => {
    const personal = contact({
      tags: ["switchboard"],
      isPersonal: true,
      details: { role: "My switch", phone: "9" },
    });
    expect(selectSwitchboardContact([personal])).toBeNull();
  });
});

describe("selectWardContacts", () => {
  it("keeps only tagged contacts that can actually be dialled", () => {
    const dialable = contact({ tags: ["ward"], details: { role: "Ward 4B", extension: "5210" } });
    const notDialable = contact({ tags: ["ward"], details: { role: "Ward 5A" } });
    expect(selectWardContacts([dialable, notDialable]).map((e) => e.id)).toEqual([dialable.id]);
  });

  it("excludes a personal ward contact", () => {
    const personal = contact({
      tags: ["ward"],
      isPersonal: true,
      details: { role: "Ward 4B", extension: "5210" },
    });
    expect(selectWardContacts([personal])).toEqual([]);
  });

  it("caps the strip so it stays one swipe", () => {
    const many = Array.from({ length: ON_CALL_WARD_STRIP_LIMIT + 4 }, (_, index) =>
      contact({ tags: ["ward"], sortOrder: index, details: { role: "W", extension: `${index}` } }),
    );
    expect(selectWardContacts(many)).toHaveLength(ON_CALL_WARD_STRIP_LIMIT);
  });
});

describe("selectPinnedPlaybookEntry", () => {
  it("returns the tagged playbook scenario", () => {
    const pinned = entry({
      section: "playbook",
      tags: ["pinned"],
      details: { trigger: "Owner-written trigger", escalationSteps: [] },
    });
    expect(selectPinnedPlaybookEntry([pinned])?.id).toBe(pinned.id);
  });

  it("pins one, not all of them", () => {
    const first = entry({
      section: "playbook",
      tags: ["pinned"],
      sortOrder: 1,
      details: { trigger: "a", escalationSteps: [] },
    });
    const second = entry({
      section: "playbook",
      tags: ["pinned"],
      sortOrder: 2,
      details: { trigger: "b", escalationSteps: [] },
    });
    expect(selectPinnedPlaybookEntry([second, first])?.id).toBe(first.id);
  });

  it("ignores a tagged entry from another section", () => {
    expect(selectPinnedPlaybookEntry([contact({ tags: ["pinned"] })])).toBeNull();
  });
});

describe("selectUpcomingSessions", () => {
  const dated = (date: string, title: string) =>
    entry({ section: "education", title, details: { nextOccurrenceDate: date, nextOccurrence: "Thursday 1pm" } });

  it("orders by date, soonest first", () => {
    const later = dated("2026-10-01", "Later");
    const sooner = dated("2026-09-16", "Sooner");
    expect(selectUpcomingSessions([later, sooner], "2026-09-12").map((s) => s.entry.title)).toEqual([
      "Sooner",
      "Later",
    ]);
  });

  it("includes a session happening today", () => {
    // A session at 08:00 is still today's session at 03:00, which is when this
    // screen is being read.
    expect(selectUpcomingSessions([dated("2026-09-12", "Today")], "2026-09-12")).toHaveLength(1);
  });

  it("drops a session that has already happened", () => {
    expect(selectUpcomingSessions([dated("2026-09-11", "Yesterday")], "2026-09-12")).toEqual([]);
  });

  it("omits an undated session rather than guessing where it belongs", () => {
    const undated = entry({ section: "education", details: { nextOccurrence: "first Tuesday of term" } });
    expect(selectUpcomingSessions([undated], "2026-09-12")).toEqual([]);
  });

  it("carries the owner's own wording through, where they gave one", () => {
    expect(selectUpcomingSessions([dated("2026-09-16", "Journal club")], "2026-09-12")[0]?.when).toBe("Thursday 1pm");
  });
});

describe("onCallLocalDateKey", () => {
  it("uses the work zone's day (Perth), not UTC", () => {
    // 23:00 on the 12th in Perth is still the 12th on the ward even though it is
    // 15:00 UTC; and 07:00 Perth on the 13th is the 13th though UTC says the 12th.
    const localLateEvening = perthWall(2026, 8, 12, 23, 0, 0);
    expect(onCallLocalDateKey(localLateEvening)).toBe("2026-09-12");
    expect(onCallLocalDateKey(perthWall(2026, 8, 13, 7, 0, 0))).toBe("2026-09-13");
  });

  it("pads single-digit months and days", () => {
    expect(onCallLocalDateKey(perthWall(2026, 0, 5, 12, 0, 0))).toBe("2026-01-05");
  });
});

describe("countOnCallEntriesBySection", () => {
  it("counts each section, and role explainers separately", () => {
    const { counts, roleExplainers } = countOnCallEntriesBySection([
      contact({}),
      contact({}),
      contact({ details: { role: "R", kind: ROLE_EXPLAINER_KIND } }),
      entry({ section: "logistics", details: { category: "Parking" } }),
    ]);
    expect(counts.get("contacts")).toBe(2);
    expect(counts.get("logistics")).toBe(1);
    expect(roleExplainers).toBe(1);
  });

  it("does not count a role explainer as a contact", () => {
    // Otherwise the Contacts tile promises a number that is not in the list.
    const { counts } = countOnCallEntriesBySection([contact({ details: { role: "R", kind: ROLE_EXPLAINER_KIND } })]);
    expect(counts.get("contacts")).toBeUndefined();
  });

  it("does not count a compliance requirement as an admin row", () => {
    // The exact mirror of the case above, and it was missing: compliance rows
    // are stored in `logistics` behind `details.kind`, so counting by section
    // made the Admin tile promise eight rows the Admin page refuses to render.
    const { counts, compliance } = countOnCallEntriesBySection([
      entry({ section: "logistics", details: { category: "Leave" } }),
      entry({ section: "logistics", details: { category: "Registration", kind: COMPLIANCE_KIND } }),
    ]);
    expect(counts.get("logistics")).toBe(1);
    expect(compliance).toBe(1);
  });

  it("subtracts both views, so no section count includes a page's worth of hidden rows", () => {
    // Asserted together rather than in two tests, because the bug was the
    // ASYMMETRY: one view was subtracted and the other was not, and each half
    // looked correct on its own.
    const { counts, roleExplainers, compliance } = countOnCallEntriesBySection([
      contact({}),
      contact({ details: { role: "R", kind: ROLE_EXPLAINER_KIND } }),
      entry({ section: "logistics", details: { category: "Leave" } }),
      entry({ section: "logistics", details: { category: "Registration", kind: COMPLIANCE_KIND } }),
    ]);
    expect(counts.get("contacts")).toBe(1);
    expect(counts.get("logistics")).toBe(1);
    expect(roleExplainers).toBe(1);
    expect(compliance).toBe(1);
  });
});

describe("msUntilOnCallHoursBoundary", () => {
  // Codex P1 on PR #2806: a phone left open across 17:00 kept offering the
  // daytime desk line, because React only re-renders on a state change and
  // nothing scheduled one. A comment claiming the page would "pick it up on its
  // next render" was wrong about a page nobody is touching, which is exactly the
  // page someone glances at overnight.
  it("counts down to 17:00 from inside the working day", () => {
    // Wednesday 16:00 Perth.
    expect(msUntilOnCallHoursBoundary(perthWall(2026, 8, 16, 16, 0, 0))).toBe(60 * 60 * 1000);
  });

  it("counts down to 08:00 from the small hours", () => {
    // Wednesday 02:30 Perth.
    expect(msUntilOnCallHoursBoundary(perthWall(2026, 8, 16, 2, 30, 0))).toBe(5.5 * 60 * 60 * 1000);
  });

  it("counts down to the next morning's 08:00 from the evening", () => {
    // Wednesday 22:00 Perth -> Thursday 08:00 Perth.
    expect(msUntilOnCallHoursBoundary(perthWall(2026, 8, 16, 22, 0, 0))).toBe(10 * 60 * 60 * 1000);
  });

  it("carries a Friday evening across the weekend to Monday 08:00", () => {
    // Friday 18:00 Perth. Saturday and Sunday are out of hours throughout, so
    // the next moment the answer can change is Monday morning -- waking at
    // Saturday 08:00 would re-render for nothing.
    const friday = perthWall(2026, 8, 18, 18, 0, 0);
    expect(friday.getDay()).toBe(5);
    expect(msUntilOnCallHoursBoundary(friday)).toBe(62 * 60 * 60 * 1000);
  });

  it("never returns zero or less, so a timer scheduled on it cannot spin", () => {
    for (const at of [
      perthWall(2026, 8, 16, 8, 0, 0),
      perthWall(2026, 8, 16, 17, 0, 0),
      perthWall(2026, 8, 19, 12, 0, 0),
    ]) {
      expect(msUntilOnCallHoursBoundary(at)).toBeGreaterThan(0);
    }
  });

  it("lands exactly on a boundary that flips the answer", () => {
    const at = perthWall(2026, 8, 16, 16, 0, 0);
    const next = new Date(at.getTime() + msUntilOnCallHoursBoundary(at));
    expect(isOnCallOutOfHours(at)).toBe(false);
    expect(isOnCallOutOfHours(next)).toBe(true);
  });
});

describe("external dialling safety", () => {
  it.each(["0001", "1234", "ext 9224", "(08) 9224 8888 ext 1", "++61 8 9224 8888", "call 000"])(
    "never dials an extension or ambiguous text: %s",
    (raw) => {
      expect(onCallTelHref(raw)).toBeUndefined();
    },
  );
  it("preserves explicitly recorded emergency and national numbers", () => {
    expect(onCallTelHref("000")).toBe("tel:000");
    expect(onCallTelHref("13 11 14")).toBe("tel:131114");
  });
});
