import { describe, expect, it } from "vitest";

import { ADMIN_REQUIREMENTS_CATALOGUE } from "@/lib/admin/requirements";
import { DEMO_ON_CALL_ENTRIES } from "@/lib/on-call/demo-entries";
import { onCallDetailsSchemaFor, onCallEntrySchema } from "@/lib/on-call/entry-model";
import {
  selectCallFirstContacts,
  selectPinnedPlaybookEntry,
  selectSwitchboardContact,
  selectUpcomingSessions,
  selectWardContacts,
} from "@/lib/on-call/home-modules";
import { onCallLocalDateKey } from "@/lib/on-call/local-date";
import { selectUpcomingTeachingSessions } from "@/lib/on-call/teaching-schedule";
import { partitionContactsEntries } from "@/lib/on-call/who-is-who";

/**
 * The demo corpus is two things at once: what a visitor with no account sees,
 * and the data the browser suite renders the eleven artboards against. Both
 * jobs have hard requirements, and neither is checked by anything else.
 */
describe("the On Call demo corpus", () => {
  it("validates against the real entry schema, row by row", () => {
    // A fixture that would be rejected by the API it stands in for is a
    // fixture that proves nothing about the page.
    for (const entry of DEMO_ON_CALL_ENTRIES) {
      const parsed = onCallEntrySchema.safeParse(entry);
      expect(parsed.success, `${entry.slug}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`).toBe(true);
      const details = onCallDetailsSchemaFor(entry.section).safeParse(entry.details);
      expect(details.success, `${entry.slug} details`).toBe(true);
    }
  });

  it("uses unique ids and slugs", () => {
    expect(new Set(DEMO_ON_CALL_ENTRIES.map((entry) => entry.id)).size).toBe(DEMO_ON_CALL_ENTRIES.length);
    expect(new Set(DEMO_ON_CALL_ENTRIES.map((entry) => entry.slug)).size).toBe(DEMO_ON_CALL_ENTRIES.length);
  });

  it("keeps every number obviously fake", () => {
    // A demo corpus that looks real is worse than an empty one: it is a
    // hospital directory a visitor might act on. Every number is a run of
    // zeroes, so nothing here can be mistaken for a line that rings.
    const numberFields = ["phone", "afterHoursPhone", "pager", "extension"] as const;
    for (const entry of DEMO_ON_CALL_ENTRIES) {
      const details = entry.details as Record<string, unknown>;
      for (const field of numberFields) {
        const value = details[field];
        if (typeof value !== "string") continue;
        expect(value, `${entry.slug}.${field} must be an all-zero placeholder`).toMatch(/^[0\s]*[0-9][0\s]*$/);
      }
      for (const step of (details.escalationSteps as { phone?: string }[] | undefined) ?? []) {
        if (step.phone) expect(step.phone, `${entry.slug} step phone`).toMatch(/^[0\s]*[0-9][0\s]*$/);
      }
    }
  });

  it("states no clinical fact", () => {
    // The mode's boundary, applied to its own fixtures: administrative content
    // only. A demo entry naming a drug or a dose would be the app authoring
    // clinical guidance in the one place nobody reviews.
    const forbidden = /\b(mg|mcg|dose|dosage|titrat|mmol|prescrib|contraindicat|diagnos)\w*/i;
    for (const entry of DEMO_ON_CALL_ENTRIES) {
      const text = [entry.title, entry.subtitle, entry.body, JSON.stringify(entry.details)].join(" ");
      expect(text, `${entry.slug} must not read as clinical guidance`).not.toMatch(forbidden);
    }
  });

  it("renders every module the home draws", () => {
    // The corpus exists so the drawing's modules have something to draw. A
    // module with no data silently disappears, and its browser assertion would
    // then be asserting an empty page.
    expect(selectCallFirstContacts(DEMO_ON_CALL_ENTRIES)).toHaveLength(2);
    expect(selectSwitchboardContact(DEMO_ON_CALL_ENTRIES)).not.toBeNull();
    expect(selectWardContacts(DEMO_ON_CALL_ENTRIES).length).toBeGreaterThanOrEqual(3);
    expect(selectPinnedPlaybookEntry(DEMO_ON_CALL_ENTRIES)).not.toBeNull();
    expect(selectUpcomingSessions(DEMO_ON_CALL_ENTRIES, onCallLocalDateKey(new Date())).length).toBeGreaterThan(0);
  });

  it("fills every section, and both sides of the contacts split", () => {
    for (const section of ["contacts", "playbook", "referrals", "orientation", "education", "logistics"] as const) {
      expect(
        DEMO_ON_CALL_ENTRIES.filter((entry) => entry.section === section).length,
        `${section} has no demo entry, so its page shows only an empty state`,
      ).toBeGreaterThan(0);
    }
    const { contacts, roleExplainers } = partitionContactsEntries(DEMO_ON_CALL_ENTRIES);
    expect(contacts.length).toBeGreaterThan(0);
    expect(roleExplainers.length).toBeGreaterThan(0);
  });

  it("carries the states the drawing shows, not just the happy ones", () => {
    // An overdue row, a private row, a wholly private group, and a checklist —
    // each is a distinct treatment on the boards, and each needs a row here or
    // it cannot be seen in a browser.
    expect(DEMO_ON_CALL_ENTRIES.some((entry) => entry.lastVerifiedAt === null)).toBe(true);
    expect(DEMO_ON_CALL_ENTRIES.some((entry) => entry.section === "contacts" && entry.isPersonal)).toBe(true);

    const gettingIn = DEMO_ON_CALL_ENTRIES.filter(
      (entry) => entry.section === "logistics" && (entry.details as { category?: string }).category === "Access",
    );
    expect(gettingIn.length).toBeGreaterThan(0);
    expect(gettingIn.every((entry) => entry.isPersonal)).toBe(true);

    const checklists = DEMO_ON_CALL_ENTRIES.filter(
      (entry) => entry.section === "orientation" && Array.isArray((entry.details as { checklist?: unknown }).checklist),
    );
    expect(checklists.length).toBeGreaterThanOrEqual(2);
  });

  it("dates teaching relative to today, so 'coming up' is never in the past", () => {
    const today = onCallLocalDateKey(new Date());
    const dated = DEMO_ON_CALL_ENTRIES.filter(
      (entry) => entry.section === "education" && (entry.details as { nextOccurrenceDate?: string }).nextOccurrenceDate,
    );
    expect(dated.length).toBeGreaterThan(0);
    for (const entry of dated) {
      const date = (entry.details as { nextOccurrenceDate: string }).nextOccurrenceDate;
      expect(date >= today, `${entry.slug} is dated in the past`).toBe(true);
    }
  });

  // The browser board test asserts a dated teaching card is visible on the home
  // in demo mode. That card comes from `selectUpcomingTeachingSessions`, not the
  // older selector above, so the demo corpus has to satisfy the NEW one — a
  // corpus that only satisfies the old one would leave the strip empty and the
  // browser test red, which is exactly how it went red on PR #2806.
  it("still offers a dated teaching session to the selector the home now uses", () => {
    const today = onCallLocalDateKey(new Date());
    expect(selectUpcomingTeachingSessions(DEMO_ON_CALL_ENTRIES, today).length).toBeGreaterThan(0);
  });
  it("names the overdue example item the same way Admin Today's card and list do", () => {
    // Admin Today's top card shows the record's own title and the list below
    // shows the requirement's title; the example once called one item two names.
    const lapsed = DEMO_ON_CALL_ENTRIES.find((entry) => entry.slug === "demo-basic-life-support-module");
    const requirementId = (lapsed?.details as { requirementId?: string } | undefined)?.requirementId;
    const requirement = ADMIN_REQUIREMENTS_CATALOGUE.find((item) => item.id === requirementId);
    expect(requirement).toBeDefined();
    expect(lapsed?.title).toBe(requirement?.title);
  });
});
