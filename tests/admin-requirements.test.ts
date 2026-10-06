import { describe, expect, it } from "vitest";

import { ADMIN_REQUIREMENT_IDS } from "@/lib/admin/requirement-ids";
import {
  ADMIN_REQUIREMENT_GROUPS,
  ADMIN_REQUIREMENTS_CATALOGUE,
  requirementChecklistRows,
  requirementDateDescription,
  requirementsRecordedCount,
  type AdminRequirementCatalogueItem,
} from "@/lib/admin/requirements";
import { complianceBucket, complianceBucketCounts } from "@/lib/admin/compliance-overview";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { DEMO_ON_CALL_ENTRIES } from "@/lib/on-call/demo-entries";
import { onCallDetailsSchemaFor } from "@/lib/on-call/entry-model";
import { complianceFixture } from "./helpers/on-call-entry-fixture";

/** A minimal, self-contained catalogue item for tests that must not depend on
 *  the exact wording of the real 20-item content. */
function item(
  overrides: Partial<AdminRequirementCatalogueItem> & Pick<AdminRequirementCatalogueItem, "id" | "title">,
): AdminRequirementCatalogueItem {
  return {
    group: "registration",
    status: "confirmed",
    sourceName: "Test source",
    sourceUrl: "https://example.org/test",
    updated: "2026-09-26",
    rule: "A test rule.",
    ...overrides,
  };
}

describe("the requirements catalogue (requirements-content.md)", () => {
  it("has exactly 20 items, each with an https official source URL and the checked date", () => {
    expect(ADMIN_REQUIREMENTS_CATALOGUE).toHaveLength(20);
    for (const requirement of ADMIN_REQUIREMENTS_CATALOGUE) {
      expect(requirement.sourceUrl.startsWith("https://")).toBe(true);
      expect(requirement.updated).toBe("2026-09-26");
      expect(requirement.sourceName.trim().length).toBeGreaterThan(0);
    }
  });

  it("never states a needs-checking item's rule as fact", () => {
    for (const requirement of ADMIN_REQUIREMENTS_CATALOGUE) {
      if (requirement.status === "needs-checking") {
        expect(requirement.rule).toBeUndefined();
        expect(requirement.whatIsUnconfirmed?.trim().length).toBeGreaterThan(0);
      } else {
        expect(requirement.rule?.trim().length).toBeGreaterThan(0);
        expect(requirement.whatIsUnconfirmed).toBeUndefined();
      }
    }
  });

  it("gives each item a 2-4 word title and one of the five known groups", () => {
    for (const requirement of ADMIN_REQUIREMENTS_CATALOGUE) {
      const words = requirement.title.trim().split(/\s+/);
      expect(words.length).toBeGreaterThanOrEqual(2);
      expect(words.length).toBeLessThanOrEqual(4);
      expect(ADMIN_REQUIREMENT_GROUPS).toContain(requirement.group);
    }
  });

  it("has no duplicate ids", () => {
    const ids = ADMIN_REQUIREMENTS_CATALOGUE.map((requirement) => requirement.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it(
    "has exactly the ids ADMIN_REQUIREMENT_IDS lists, so the entry-model.ts schema that validates a " +
      "stored requirementId against that leaf list can never drift from the catalogue it is meant to match",
    () => {
      const catalogueIds = ADMIN_REQUIREMENTS_CATALOGUE.map((requirement) => requirement.id).sort();
      expect(catalogueIds).toEqual([...ADMIN_REQUIREMENT_IDS].sort());
    },
  );
});

describe("matching a doctor's own entries to the catalogue", () => {
  const byId = item({ id: "req-a", title: "Widget licence" });
  const byTitle = item({ id: "req-b", title: "Gadget permit" });
  const unmatched = item({ id: "req-c", title: "Gizmo pass" });
  const catalogue = [byId, byTitle, unmatched];

  it("matches by a stored requirementId first, then by title, and leaves the rest as not-recorded slots", () => {
    const viaId = complianceFixture("My own name for it", {
      category: "Registration",
      requirementId: "req-a",
      expiresOn: "2027-03-01",
    });
    const viaTitle = complianceFixture("Gadget permit", { category: "Registration", expiresOn: "2027-04-01" });
    const rows = requirementChecklistRows(catalogue, [viaId, viaTitle]);
    expect(rows.find((row) => row.item.id === "req-a")?.entry).toBe(viaId);
    expect(rows.find((row) => row.item.id === "req-b")?.entry).toBe(viaTitle);
    expect(rows.find((row) => row.item.id === "req-c")?.entry).toBeNull();
    expect(rows.find((row) => row.item.id === "req-c")?.state).toBe("not-recorded");
  });

  it("treats a matching entry flagged not for this job as no match", () => {
    const flagged = complianceFixture("Gizmo pass", { category: "Registration", notForThisJob: true });
    const rows = requirementChecklistRows(catalogue, [flagged]);
    expect(rows.find((row) => row.item.id === "req-c")?.entry).toBeNull();
  });

  it("matches titles without regard to case or surrounding whitespace", () => {
    const viaTitle = complianceFixture("  gadget PERMIT  ", { category: "Registration", expiresOn: "2027-04-01" });
    const rows = requirementChecklistRows(catalogue, [viaTitle]);
    expect(rows.find((row) => row.item.id === "req-b")?.entry).toBe(viaTitle);
  });

  it("prefers an unflagged entry over a flagged one when two entries both match the same item", () => {
    const flagged = complianceFixture("Some other name", {
      category: "Registration",
      requirementId: "req-a",
      notForThisJob: true,
    });
    const unflagged = complianceFixture("Widget licence", { category: "Registration", expiresOn: "2027-05-01" });
    const rows = requirementChecklistRows(catalogue, [flagged, unflagged]);
    const row = rows.find((r) => r.item.id === "req-a");
    expect(row?.entry).toBe(unflagged);
    expect(row?.state).toBe("needs-action");
  });
});

describe("the recorded count", () => {
  const a = item({ id: "req-a", title: "Widget licence" });
  const b = item({ id: "req-b", title: "Gadget permit" });
  const c = item({ id: "req-c", title: "Gizmo pass" });
  const catalogue = [a, b, c];

  it("counts recorded items against the whole catalogue", () => {
    const recorded = complianceFixture("Widget licence", {
      category: "Registration",
      requirementId: "req-a",
      expiresOn: "2027-01-01",
    });
    expect(requirementsRecordedCount(catalogue, [recorded])).toEqual({ recorded: 1, total: 3 });
  });

  it("removes an item from both the recorded count and the total when its record is not for this job", () => {
    const flagged = complianceFixture("Widget licence", {
      category: "Registration",
      requirementId: "req-a",
      notForThisJob: true,
      expiresOn: "2027-01-01",
    });
    expect(requirementsRecordedCount(catalogue, [flagged])).toEqual({ recorded: 0, total: 2 });
  });

  it(
    "agrees with requirementChecklistRows when two entries match one item, one flagged and one not: the item " +
      "counts as recorded, not as excluded (Important review issue: the count must never re-derive its own answer)",
    () => {
      const flagged = complianceFixture("Some other name", {
        category: "Registration",
        requirementId: "req-a",
        notForThisJob: true,
      });
      const unflagged = complianceFixture("Widget licence", { category: "Registration", expiresOn: "2027-05-01" });
      const entries = [flagged, unflagged];
      expect(requirementsRecordedCount(catalogue, entries)).toEqual({ recorded: 1, total: 3 });
      // Same answer requirementChecklistRows gives for the same item, from the same entries.
      const row = requirementChecklistRows(catalogue, entries).find((r) => r.item.id === "req-a");
      expect(row?.entry).toBe(unflagged);
    },
  );
});

describe("checklist ordering (spec review 29: soonest first)", () => {
  const noEnd = item({ id: "no-end", title: "No end item" });
  const missing = item({ id: "missing", title: "Missing item" });
  const later = item({ id: "later", title: "Later item" });
  const soon = item({ id: "soon", title: "Soon item" });
  // Deliberately out of order, so a passing test proves the sort, not fixture order.
  const catalogue = [noEnd, missing, later, soon];

  it("orders items needing action soonest first, then no end date, then not recorded yet", () => {
    const entries = [
      complianceFixture("Later item", { category: "Registration", requirementId: "later", expiresOn: "2028-01-01" }),
      complianceFixture("Soon item", { category: "Registration", requirementId: "soon", expiresOn: "2027-01-01" }),
      complianceFixture("No end item", { category: "Registration", requirementId: "no-end" }),
    ];
    const rows = requirementChecklistRows(catalogue, entries);
    expect(rows.map((row) => row.item.id)).toEqual(["soon", "later", "no-end", "missing"]);
    expect(rows.map((row) => row.state)).toEqual(["needs-action", "needs-action", "no-end-date", "not-recorded"]);
  });
});

describe("requirementDateDescription", () => {
  const now = new Date("2026-09-26T01:00:00Z"); // 26 Sep 2026, 09:00 Perth

  it("describes a recorded date, and a date that has passed in words, never 'expired'", () => {
    expect(requirementDateDescription("2027-01-01", now)).toBe("Recorded as expiring 1 Jan 2027");
    expect(requirementDateDescription("2026-01-01", now)).toBe(
      "Recorded as expiring 1 Jan 2026 — that date has passed",
    );
    expect(requirementDateDescription("2026-01-01", now)).not.toMatch(/expired/i);
    expect(requirementDateDescription(undefined, now)).toBe("");
  });
});

describe("requirementId (entry-model.ts): a short slug, and one of the catalogue's own ids", () => {
  const base = { category: "Registration" };
  const schema = onCallDetailsSchemaFor("logistics");

  it("accepts a real catalogue id", () => {
    for (const id of ADMIN_REQUIREMENT_IDS) {
      expect(schema.safeParse({ ...base, requirementId: id }).success, id).toBe(true);
    }
  });

  it("accepts no requirementId at all", () => {
    expect(schema.safeParse(base).success).toBe(true);
  });

  it("refuses an id that is not in the catalogue, even if it is slug-shaped", () => {
    expect(schema.safeParse({ ...base, requirementId: "not-a-real-requirement" }).success).toBe(false);
  });

  it("refuses anything that is not a short lowercase slug", () => {
    for (const requirementId of [
      "",
      "Medical-Registration-Renewal", // uppercase
      "medical registration renewal", // spaces
      "medical_registration_renewal", // underscores
      "a".repeat(41), // over the 40-character cap
      "jane.citizen@example.com", // identifier-shaped, and not a slug either
    ]) {
      expect(schema.safeParse({ ...base, requirementId }).success, JSON.stringify(requirementId)).toBe(false);
    }
  });
});

describe("catalogue ids are a storage contract (M12)", () => {
  // Rows store `details.requirementId`, and the details schema accepts only a
  // listed id. Removing one would make every stored row carrying it fail to
  // parse, blanking its expiry date. Ids may be added; never removed or renamed.
  const SHIPPED_2026_09_26 = [
    "medical-registration-renewal",
    "cpd-home-and-hours",
    "recency-of-practice",
    "professional-indemnity-insurance",
    "medicare-provider-number",
    "working-with-children-check",
    "wwc-check-applicability",
    "criminal-record-screening",
    "immunisation-requirements",
    "annual-influenza-vaccination",
    "respirator-fit-testing",
    "mandatory-training-modules",
    "resuscitation-competence",
    "als-course-certification",
    "credentialing-and-scope",
    "provisional-to-general-registration",
    "img-supervised-practice",
    "img-visa-requirements",
    "code-of-conduct",
    "aboriginal-cultural-elearning",
  ];

  it("keeps every id that has ever shipped", () => {
    expect([...ADMIN_REQUIREMENT_IDS]).toEqual(expect.arrayContaining(SHIPPED_2026_09_26));
    for (const id of SHIPPED_2026_09_26) {
      const details = { kind: "compliance", category: "registration", requirementId: id };
      expect(onCallDetailsSchemaFor("logistics").safeParse(details).success, id).toBe(true);
    }
  });
});

describe("the demo corpus (what CI's demo-mode browser journeys see)", () => {
  it("records a few catalogue items, so demo Renewals shows 'Soonest first' and not only 'Not recorded yet'", () => {
    const rows = requirementChecklistRows(ADMIN_REQUIREMENTS_CATALOGUE, DEMO_ON_CALL_ENTRIES);
    const recorded = rows.filter((row) => row.state === "needs-action").map((row) => row.item.id);
    expect(recorded).toEqual(
      expect.arrayContaining([
        "medical-registration-renewal",
        "professional-indemnity-insurance",
        "working-with-children-check",
      ]),
    );
    expect(rows.some((row) => row.state === "not-recorded")).toBe(true);
  });

  it("fills the sample Renewals checklist as the mock-up does: 20 items, 1 passed, 3 to start, 2 not recorded, 14 recorded", () => {
    const rows = requirementChecklistRows(ADMIN_REQUIREMENTS_CATALOGUE, DEMO_ON_CALL_ENTRIES);
    const today = perthCalendarDate(new Date());
    const counts = complianceBucketCounts(rows.map((row) => complianceBucket(row, today)));
    expect(rows).toHaveLength(20);
    expect(counts).toEqual({ "date-passed": 1, "start-renewing": 3, "not-recorded": 2, recorded: 14 });
    // Enough dated rows inside twelve months to fill the timeline's eight.
    const dated = rows.filter((row) => row.state === "needs-action" && row.expiresOn);
    expect(dated.length).toBeGreaterThanOrEqual(8);
  });
});
