import { describe, expect, it } from "vitest";
import {
  ON_CALL_RECURRENCE_FREQUENCIES,
  ON_CALL_REVIEW_INTERVAL_MONTHS,
  isOnCallHttpUrl,
  mergeOnCallEntryVerification,
  onCallEntryVerificationContentMatches,
  onCallDetailsSchemaFor,
  onCallEntryFreshness,
} from "@/lib/on-call/entry-model";
import { onCallEntryFixture } from "./helpers/on-call-entry-fixture";
import { selectCardEntries } from "@/lib/on-call/card-selection";

const NOW = new Date("2026-09-04T00:00:00.000Z");

describe("onCallEntryFreshness", () => {
  it("is stale when the entry has never been verified", () => {
    expect(onCallEntryFreshness({ lastVerifiedAt: null }, NOW)).toEqual({
      state: "stale",
      reason: "never-verified",
      lastVerifiedAt: null,
    });
  });

  it("is fresh one day inside the interval", () => {
    const justInside = new Date("2025-09-05T00:00:00.000Z").toISOString();
    expect(onCallEntryFreshness({ lastVerifiedAt: justInside }, NOW).state).toBe("fresh");
  });

  it("is stale exactly on the twelve-month boundary", () => {
    const onBoundary = new Date("2025-09-04T00:00:00.000Z").toISOString();
    expect(onCallEntryFreshness({ lastVerifiedAt: onBoundary }, NOW)).toEqual({
      state: "stale",
      reason: "overdue",
      lastVerifiedAt: onBoundary,
    });
  });

  it("uses a twelve-month interval", () => {
    expect(ON_CALL_REVIEW_INTERVAL_MONTHS).toBe(12);
  });

  it("does not let a leap-day entry stay fresh past its anniversary", () => {
    const leapDay = new Date("2024-02-29T00:00:00.000Z").toISOString();
    const dayAfterDue = new Date("2025-03-01T00:00:00.000Z");
    expect(onCallEntryFreshness({ lastVerifiedAt: leapDay }, dayAfterDue).state).toBe("stale");
    const onDue = new Date("2025-02-28T00:00:00.000Z");
    expect(onCallEntryFreshness({ lastVerifiedAt: leapDay }, onDue).state).toBe("stale");
  });
});

describe("onCallDetailsSchemaFor", () => {
  it("accepts a contact carrying only a role", () => {
    const parsed = onCallDetailsSchemaFor("contacts").safeParse({ role: "After-hours registrar" });
    expect(parsed.success).toBe(true);
  });

  it("rejects a contact with no role", () => {
    expect(onCallDetailsSchemaFor("contacts").safeParse({ phone: "9999 9999" }).success).toBe(false);
  });

  it("rejects unknown keys, so a typo cannot be silently stored", () => {
    const parsed = onCallDetailsSchemaFor("contacts").safeParse({
      role: "Ward 4B",
      phne: "9999 9999",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a teaching entry that carries no recurrence at all", () => {
    const parsed = onCallDetailsSchemaFor("education").safeParse({
      nextOccurrence: "Thursday 1pm",
      nextOccurrenceDate: "2026-09-17",
    });
    expect(parsed.success).toBe(true);
    // The stored rows that exist today have no structured rule, and they must
    // keep parsing to exactly what they parsed to before it was added.
    expect(parsed.success && parsed.data).toEqual({
      nextOccurrence: "Thursday 1pm",
      nextOccurrenceDate: "2026-09-17",
      topics: [],
    });
  });

  it("accepts a structured recurrence beside the owner's free text", () => {
    const parsed = onCallDetailsSchemaFor("education").safeParse({
      recurrence: "Thursday 1pm, weeks 1-10",
      nextOccurrenceDate: "2026-09-17",
      recurrenceRule: { frequency: "weekly" },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && (parsed.data as { recurrenceRule?: unknown }).recurrenceRule).toEqual({
      frequency: "weekly",
    });
  });

  it("names the three frequencies the app can compute with", () => {
    expect([...ON_CALL_RECURRENCE_FREQUENCIES]).toEqual(["weekly", "fortnightly", "monthly"]);
  });

  it("rejects a frequency the roll-forward has no rule for", () => {
    const parsed = onCallDetailsSchemaFor("education").safeParse({
      nextOccurrenceDate: "2026-09-17",
      recurrenceRule: { frequency: "termly" },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown key inside the recurrence rule", () => {
    const parsed = onCallDetailsSchemaFor("education").safeParse({
      nextOccurrenceDate: "2026-09-17",
      recurrenceRule: { frequency: "weekly", untilDate: "2026-12-01" },
    });
    expect(parsed.success).toBe(false);
  });

  it("requires an ordered escalation step to name who to call and when", () => {
    const parsed = onCallDetailsSchemaFor("playbook").safeParse({
      trigger: "Acute behavioural disturbance",
      escalationSteps: [{ order: 1, whoToCall: "In-house registrar", when: "Immediately" }],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("a date we cannot read", () => {
  // Fails to stale, never to fresh. `new Date("not-a-date").getTime()` is NaN,
  // and every comparison against NaN is false — so the overdue branch would
  // fall through and report a corrupt entry as freshly checked.
  it("treats an unparseable last-verified date as never verified", () => {
    const freshness = onCallEntryFreshness({ lastVerifiedAt: "not-a-date" }, new Date("2026-09-04T00:00:00.000Z"));
    expect(freshness.state).toBe("stale");
    expect(freshness.state === "stale" && freshness.reason).toBe("never-verified");
  });

  it("keeps an entry with an unreadable date off the printable card", () => {
    const entries = [
      {
        id: "a",
        slug: "corrupt",
        section: "contacts" as const,
        title: "Corrupt date",
        subtitle: null,
        body: null,
        details: { role: "Switchboard" },
        linkedDocumentIds: [],
        tags: [],
        isPersonal: false,
        includeOnCard: true,
        sortOrder: 0,
        lastVerifiedAt: "2026-13-45T99:99:99Z",
      },
    ];
    expect(selectCardEntries(entries, new Date("2026-09-04T00:00:00.000Z"))).toEqual([]);
  });
});

/**
 * Every stored URL is drawn as a link, so a `javascript:` value is script that
 * runs on a tap. `z.string().url()` alone accepts it.
 */
describe("link fields accept http and https only", () => {
  const cases = [
    ["education", { recordingUrl: "" }, "recordingUrl"],
    ["referrals", { referralFormUrl: "" }, "referralFormUrl"],
    ["logistics", { category: "Facilities", url: "" }, "url"],
    ["logistics", { category: "Registration", kind: "compliance", evidenceUrl: "" }, "evidenceUrl"],
  ] as const;

  it.each(cases)("%s rejects a javascript: %s", (section, base, key) => {
    for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<script>alert(1)</script>"]) {
      expect(onCallDetailsSchemaFor(section).safeParse({ ...base, [key]: bad }).success, bad).toBe(false);
    }
  });

  it.each(cases)("%s still accepts an https %s", (section, base, key) => {
    expect(onCallDetailsSchemaFor(section).safeParse({ ...base, [key]: "https://example.org/x" }).success).toBe(true);
    expect(onCallDetailsSchemaFor(section).safeParse({ ...base, [key]: "http://example.org/x" }).success).toBe(true);
  });

  it("isOnCallHttpUrl refuses anything that is not an http(s) URL", () => {
    expect(isOnCallHttpUrl("https://example.org")).toBe(true);
    expect(isOnCallHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isOnCallHttpUrl("not a url")).toBe(false);
    expect(isOnCallHttpUrl(undefined)).toBe(false);
  });
});

describe("verification response reconciliation", () => {
  const reviewed = onCallEntryFixture({
    section: "contacts",
    title: "Synthetic contact",
    details: { role: "Synthetic role", phone: "5100" },
    lastVerifiedAt: "2024-01-01T00:00:00Z",
  });
  it("compares content independently of JSON object-key order", () => {
    expect(
      onCallEntryVerificationContentMatches(reviewed, {
        ...reviewed,
        details: { phone: "5100", role: "Synthetic role" },
      }),
    ).toBe(true);
  });
  it("keeps a newer verification when an earlier verification arrives later", () => {
    const current = { ...reviewed, lastVerifiedAt: "2026-11-05T12:30:00Z" };
    expect(
      mergeOnCallEntryVerification(current, reviewed, { ...reviewed, lastVerifiedAt: "2026-11-05T12:00:00Z" }),
    ).toEqual(current);
  });
  it("does not attest content that differs in the returned server snapshot", () => {
    expect(
      mergeOnCallEntryVerification(reviewed, reviewed, {
        ...reviewed,
        title: "Changed remotely",
        lastVerifiedAt: "2026-11-05T12:00:00Z",
      }),
    ).toBeNull();
  });
});
