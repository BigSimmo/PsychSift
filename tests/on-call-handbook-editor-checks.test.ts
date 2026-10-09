import { describe, expect, it } from "vitest";

import {
  handbookEditorWarnings,
  handbookPlacementLine,
  type HandbookEditorContent,
} from "@/lib/on-call/handbook-editor-checks";
import type { ServiceEntry } from "@/lib/on-call/service-model";

const SITE = "30000000-0000-4000-8000-00000000000a";

/** A minimal published contacts entry, for the "another entry" comparisons. */
function published(id: string, title: string, phone: string): ServiceEntry {
  const content = {
    siteId: SITE,
    section: "contacts" as const,
    kind: "operational" as const,
    title,
    body: "Synthetic example only",
    phone,
    sources: [],
    orientationPhase: "first_shift" as const,
  };
  return {
    id,
    revision: 1,
    publishedRevision: 1,
    content,
    publishedContent: content,
    status: "published",
    authorId: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewComment: "",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("handbookPlacementLine", () => {
  it("says where an entry will appear", () => {
    expect(
      handbookPlacementLine({
        title: "Medicine: Registrar",
        section: "contacts",
        kind: "operational",
        siteId: SITE,
        phone: "9000 0001",
      }),
    ).toBe("Will appear in: Call, then Hospital, then Medicine");
    expect(
      handbookPlacementLine({ title: "Ward: 4B", section: "resources", kind: "operational", siteId: SITE, phone: "" }),
    ).toBe("Will appear in: Find, then Wards");
    expect(
      handbookPlacementLine({
        title: "Emergency: Code",
        section: "contacts",
        kind: "clinical",
        siteId: SITE,
        phone: "55",
      }),
    ).toBe("Will appear in: Now (emergency) and Call, then Hospital");
  });
});

describe("handbookEditorWarnings", () => {
  it("tells the editor exactly when an emergency number will be pinned", () => {
    const texts = (over: Partial<HandbookEditorContent>) =>
      handbookEditorWarnings(
        { title: "Emergency: Code", section: "contacts", kind: "clinical", siteId: SITE, phone: "55", ...over },
        { entries: [], editingId: null, siteName: "Site A" },
      ).map((warning) => warning.text);
    expect(texts({})).toContain("This will be pinned as the emergency number at Site A.");
    expect(texts({ siteId: null })).toContain(
      "An emergency number needs a site to be pinned on Now. Without one it shows on Call only.",
    );
    expect(texts({ kind: "operational" })).toContain("Save it as clinical, with its source, to pin it on Now.");
  });

  it("flags a similar team and a wrong-length number, and never a duplicate title", () => {
    const entries = [published("a", "Medicine: Registrar", "9000 0001"), published("b", "ICU: Registrar", "9000 0002")];
    // Deviation from the r6 plan text: the plan's literal example phone,
    // "900 000 02", is 8 digits (a valid WA landline length) and would not
    // trigger this warning under the rule as written ("7, 9, or 11 or more
    // digits"). A 9-digit number is used instead so the case actually
    // exercises the rule; see the final report for this deviation.
    const warnings = handbookEditorWarnings(
      { title: "Medecine: Registrar", section: "contacts", kind: "operational", siteId: SITE, phone: "9000 00012" },
      { entries, editingId: null, siteName: "Site A" },
    );
    expect(warnings.map((warning) => warning.id).sort()).toEqual(["number-length", "similar-team"]);
    expect(warnings.map((warning) => warning.text)).toContain(
      'Is this the same team as "Medicine"? Teams group by exact name.',
    );
  });

  it("flags a number already used by another role, under a different title", () => {
    const entries = [published("a", "Medicine: Registrar", "9000 0001"), published("b", "ICU: Registrar", "9000 0002")];
    const shared = handbookEditorWarnings(
      { title: "Medicine: Registrar", section: "contacts", kind: "operational", siteId: SITE, phone: "9000 0002" },
      { entries, editingId: null, siteName: "Site A" },
    );
    expect(shared.map((warning) => warning.text)).toEqual(['The same number is saved for "ICU: Registrar".']);
  });

  it("warns about a brand-new team once, and never alongside a similar-team warning", () => {
    const entries = [published("a", "Medicine: Registrar", "9000 0001")];
    const warnings = handbookEditorWarnings(
      { title: "Renal: Registrar", section: "contacts", kind: "operational", siteId: SITE, phone: "9000 0009" },
      { entries, editingId: null, siteName: "Site A" },
    );
    expect(warnings).toEqual([{ id: "new-team", text: 'New team "Renal": it gets its own group on Call.' }]);
  });

  it("never warns about a known common team that has no entries yet", () => {
    const warnings = handbookEditorWarnings(
      { title: "Surgery: Registrar", section: "contacts", kind: "operational", siteId: SITE, phone: "9000 0009" },
      { entries: [], editingId: null, siteName: "Site A" },
    );
    expect(warnings.map((warning) => warning.id)).not.toContain("new-team");
  });

  it("excludes the entry being edited from the team and number comparisons", () => {
    const entries = [published("a", "Medicine: Registrar", "9000 0001")];
    const warnings = handbookEditorWarnings(
      { title: "Medicine: Registrar", section: "contacts", kind: "operational", siteId: SITE, phone: "9000 0001" },
      { entries, editingId: "a", siteName: "Site A" },
    );
    expect(warnings).toEqual([]);
  });
});
