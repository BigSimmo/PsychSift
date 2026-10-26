import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyClinicalReview,
  collectionOf,
  finalizeClinicalReview,
  recordContentSha256,
  recordKinds,
  recordPinState,
  reviewProblems,
  signOffEligibilityProblem,
  signOffQueue,
} from "../scripts/lib/clinical-record-review-contract.mjs";
import {
  acuityLabel,
  display,
  loadContext,
  serviceContradictions,
  shownAcuityFlag,
} from "../scripts/lib/signoff-kinds/services.mjs";

import serviceRecordsReview from "../data/service-records-review.json";
import servicesSnapshot from "../data/services-snapshot.json";

import { canonicalServiceRecords } from "@/lib/service-governance";
import { loadServicesSnapshot } from "@/lib/service-catalog";
import { serviceSignOffFor } from "@/lib/service-record-sign-off";
import { loadServiceRecords } from "@/lib/services";
import { bundledServiceGovernance } from "@/lib/site-content/bundled-service-catalogue";

/**
 * The `service` sign-off kind (ledger #3E42FH): the curated WA service records no published
 * site-content release carries yet, signed off one row at a time in
 * data/service-records-review.json with a content pin over the whole curated record.
 */

const ROOT = process.cwd();
const NOW = new Date("2026-10-02T06:00:00.000Z");
const REVIEWED_AT = "2026-09-25T05:00:00.000Z";
const REVIEWER = "Dr Clinical Owner";
/** The 2026-08-24 site-content freeze: every curated record verified after it is unpublished. */
const FREEZE = "2026-08-24";

/** The 17 records PR #2814 added, which the owner decision (#ZPHK2F) needs signed first. */
const PR_2814_RECORDS = [
  "SVC-SV-001",
  "SVC-FDV-003",
  "SVC-SUI-003",
  "SVC-SUI-004",
  "SVC-POS-001",
  "SVC-POS-002",
  "SVC-POS-003",
  "SVC-POS-004",
  "SVC-YTH-004",
  "SVC-YTH-014",
  "SVC-YTH-015",
  "SVC-DEV-001",
  "SVC-PER-001",
  "SVC-ED-001",
  "SVC-GEN-001",
  "SVC-NAV-001",
  "SVC-REG-006",
];

type Json = Record<string, unknown>;
type Row = { id: string; status: string; reviewedBy: string | null; reviewedAt: string | null };
const clone = <T>(value: T): T => structuredClone(value);

const context = (await loadContext("service", ROOT)) as {
  services: Record<string, Json>;
  files: Record<string, string>;
};

function unsignedDocument() {
  const copy = clone(serviceRecordsReview) as { description?: string; entries: Json[] };
  for (const entry of copy.entries) {
    Object.assign(entry, { status: "drafted", reviewedBy: null, reviewedAt: null, reviewedContentSha256: null });
  }
  return copy;
}

function signed(document: unknown, id: string) {
  const record = collectionOf("service", document).find((entry: Json) => entry.id === id);
  const reviewed = finalizeClinicalReview(record, "service", {
    reviewedBy: REVIEWER,
    reviewedAt: REVIEWED_AT,
    context,
    now: NOW,
  });
  return applyClinicalReview(document, "service", reviewed) as { description?: string; entries: Json[] };
}

function displayText(id: string, ctx = context) {
  const row = { id, status: "drafted", reviewedBy: null, reviewedAt: null, reviewedContentSha256: null };
  return display.service(row, ctx);
}

function printed(id: string) {
  return displayText(id)
    .map(([label, value]) => `[${label}]\n${Array.isArray(value) ? value.join("\n") : String(value ?? "")}`)
    .join("\n");
}

describe("the service sign-off kind", () => {
  it("is registered with the contract under its own sidecar", () => {
    expect((recordKinds as Record<string, unknown>).service).toMatchObject({
      kind: "service",
      path: "data/service-records-review.json",
      collectionKey: "entries",
      idField: "id",
    });
  });

  it("reads the curated records exactly as the app imports them", () => {
    const app = canonicalServiceRecords();
    expect(Object.keys(context.services).sort()).toEqual(app.map((record) => record.id).sort());
    for (const record of app) expect(context.services[record.id], record.id).toEqual(record);
  });

  it("lists exactly the stand-alone curated records added after the freeze, one drafted row each", () => {
    const standalone = new Set(
      loadServicesSnapshot()
        .services.filter((service) => service.stable_id?.startsWith("SVC-") && service.id === service.stable_id)
        .map((service) => service.id),
    );
    const inScope = canonicalServiceRecords()
      .filter((record) => standalone.has(record.id) && record.verified > FREEZE)
      .map((record) => record.id);
    const ids = serviceRecordsReview.entries.map((entry) => entry.id);
    expect([...ids].sort()).toEqual([...inScope].sort());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of PR_2814_RECORDS) expect(ids, id).toContain(id);
    // Legacy-merged records are out: part of what the page shows for them is not in the pin.
    expect(ids).not.toContain("SVC-ABO-004");
    expect(ids).not.toContain("SVC-REG-005");
  });

  it("keeps every row on disk unsigned or signed against the current text", () => {
    const records = collectionOf("service", serviceRecordsReview);
    for (const record of records) {
      const state = recordPinState(record, "service", context);
      expect(record.status === "drafted" ? "unsigned" : state, record.id).not.toBe("stale");
      if (record.status === "drafted") expect(state, record.id).toBe("unsigned");
    }
    expect(reviewProblems(records, "service", { ...context, now: new Date() })).toEqual([]);
  });

  it("writes a sign-off to the target row alone, with a current pin", () => {
    const before = unsignedDocument();
    const after = signed(before, "SVC-SV-001");
    expect(after.description).toBe(before.description);
    expect(after.entries).toHaveLength(before.entries.length);
    after.entries.forEach((entry, index) => {
      if (entry.id === "SVC-SV-001") return;
      expect(entry, String(entry.id)).toEqual(before.entries[index]);
    });
    const row = after.entries.find((entry) => entry.id === "SVC-SV-001")!;
    expect(row).toMatchObject({ status: "reviewed", reviewedBy: REVIEWER, reviewedAt: REVIEWED_AT });
    expect(row.reviewedContentSha256).toBe(recordContentSha256(row, "service", context));
    expect(recordPinState(row, "service", context)).toBe("current");
    expect(reviewProblems(after.entries, "service", { ...context, now: NOW })).toEqual([]);
    expect(signOffQueue("service", after.entries, context)).not.toContain("SVC-SV-001");
  });

  it("goes stale when any field the reviewer saw is edited", () => {
    const row = signed(unsignedDocument(), "SVC-SV-001").entries.find((entry) => entry.id === "SVC-SV-001")!;
    const original = context.services["SVC-SV-001"];
    const edits: Array<[string, (record: Json) => void]> = Object.keys(original).map((key) => [
      key,
      (record) => {
        record[key] = typeof record[key] === "string" ? `${record[key]} (edited)` : ["edited"];
      },
    ]);
    edits.push(
      ["contact number", (record) => ((record.contacts as Json[])[0].value = "1800 000 000")],
      ["hours text", (record) => ((record.hours as Json).display = "9am to 5pm")],
      ["source URL", (record) => ((record.sources as Json[])[0].url = "https://example.org/")],
      ["source date", (record) => ((record.sources as Json[])[0].date = "Page last updated 1 January 2026")],
      ["referral route", (record) => ((record.routes as Json[])[0].summary = "Self-referral")],
      ["crisis tier", (record) => (record.tier = "B_common_referral")],
    );
    for (const [label, edit] of edits) {
      const service = clone(original);
      edit(service);
      const edited = { ...context, services: { ...context.services, "SVC-SV-001": service } };
      expect(recordPinState(row, "service", edited), label).toBe("stale");
      expect(signOffEligibilityProblem(row, "service", edited), label).toBeNull();
    }
  });

  it("shows everything a clinician sees for the service", () => {
    const records = loadServiceRecords();
    for (const { id } of serviceRecordsReview.entries) {
      const service = context.services[id] as Json & {
        contacts: Array<{ value: string }>;
        sources: Array<{ url: string; date: string }>;
        routes: Array<{ summary: string }>;
        hours: { display: string };
        tier: string;
      };
      const text = printed(id);
      for (const value of [
        service.name,
        service.bestUse,
        service.population,
        service.category,
        service.hours.display,
        ...(service.catchments as string[]),
        ...(service.notFor as string[]),
        ...(service.issues as string[]),
        ...service.contacts.map((contact) => contact.value),
        ...service.routes.map((route) => route.summary),
        ...service.sources.flatMap((source) => [source.url, source.date]),
      ]) {
        expect(text, `${id} shows ${String(value).slice(0, 40)}`).toContain(String(value));
      }
      if (service.website) expect(text, `${id} website`).toContain(String(service.website));
      expect(text, `${id} review date`).toContain(String(service.review));
      // The acuity chip named on screen is the one the Services page renders.
      const app = records.find((record) => record.catalogPayload?.stableId === id)!;
      expect(app, id).toBeTruthy();
      const label = acuityLabel(shownAcuityFlag(service.tier));
      expect(
        (app.statusChips ?? []).map((chip) => chip.label),
        id,
      ).toContain(label);
      expect(text, id).toContain(`Acuity chip: "${label}"`);
    }
  });

  it("puts a WARNING line on the WISH referral contradiction, and only where text disagrees", () => {
    const flagged = serviceRecordsReview.entries
      .map((entry) => entry.id)
      .filter((id) => serviceContradictions(context.services[id]).length > 0);
    expect(flagged).toEqual(["SVC-YTH-004"]);
    const rows = displayText("SVC-YTH-004");
    expect(rows[0][0]).toBe("WARNING");
    expect(String(rows[0][1])).toMatch(/sources disagree/i);
    expect(String(rows[0][1])).toContain("--exclude SVC-YTH-004");
    expect(displayText("SVC-SV-001").some(([label]) => label === "WARNING")).toBe(false);
  });

  it("flags the Fiona Stanley Mother and Baby Unit shape: not a crisis service, shown as Crisis / urgent", () => {
    // Ledger #4WSEG4. The legacy catalogue row (data/services-snapshot.json S115) had this shape
    // until the 26 Oct 2026 audit fix (MC-F-07) dropped its crisis flag, so the detector is
    // pinned on the old shape and the fixed row must no longer trip it.
    const legacy = (servicesSnapshot as { services: Json[] }).services.find((service) => service.id === "S115")!;
    expect(legacy.name).toBe("Mother and Baby Mental Health Unit (Fiona Stanley Hospital)");
    const tags = legacy.tags as { acuity_flags: string[]; specialist_groups?: string[] };
    const record = {
      name: legacy.name,
      exclusions: [legacy.exclusions, legacy.exclusion_rejection_criteria],
      groups: tags.specialist_groups ?? [],
    };
    const warnings = serviceContradictions(record, { acuityFlags: ["crisis_high", ...tags.acuity_flags] });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Not emergency/crisis service");
    expect(warnings[0]).toContain("Crisis / urgent");
    expect(serviceContradictions(record, { acuityFlags: tags.acuity_flags })).toEqual([]);
  });

  it("warns and refuses to describe a row whose curated record is missing", () => {
    const rows = displayText("SVC-NOT-REAL");
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("WARNING");
    const row = {
      id: "SVC-NOT-REAL",
      status: "drafted",
      reviewedBy: null,
      reviewedAt: null,
      reviewedContentSha256: null,
    };
    expect(() =>
      finalizeClinicalReview(row, "service", { reviewedBy: REVIEWER, reviewedAt: REVIEWED_AT, context, now: NOW }),
    ).toThrow(/no curated record/);
  });

  it("holds Aboriginal and Torres Strait Islander services out of the queue (owner rule 2026-09-26)", () => {
    const queue = signOffQueue("service", collectionOf("service", unsignedDocument()), context);
    for (const id of ["SVC-SUI-004", "SVC-POS-001", "SVC-YTH-004", "SVC-LEG-001"]) {
      expect(queue, id).not.toContain(id);
      const row = { id, status: "drafted", reviewedBy: null, reviewedAt: null, reviewedContentSha256: null };
      expect(signOffEligibilityProblem(row, "service", context), id).toMatch(/Indigenous/);
    }
    expect(queue).toContain("SVC-SV-001");
  });
});

describe("the site honours a service sign-off only where it said unverified", () => {
  afterEach(() => {
    vi.doUnmock("../data/service-records-review.json");
    vi.resetModules();
  });

  it("reads every in-scope record as unverified while the sidecar is unsigned", () => {
    const records = loadServiceRecords();
    for (const { id, status } of serviceRecordsReview.entries) {
      if (status === "reviewed") continue;
      expect(serviceSignOffFor(id), id).toBeNull();
      const record = records.find((entry) => entry.catalogPayload?.stableId === id)!;
      expect(bundledServiceGovernance(record).validationStatus, id).toBe("unverified");
    }
  });

  async function withRows(rows: Row[]) {
    vi.resetModules();
    vi.doMock("../data/service-records-review.json", () => ({ default: { entries: rows } }));
    const signOff = await import("@/lib/service-record-sign-off");
    const stopgap = await import("@/lib/site-content/bundled-service-catalogue");
    const services = await import("@/lib/services");
    const record = services.loadServiceRecords().find((entry) => entry.catalogPayload?.stableId === "SVC-SV-001")!;
    return { signOff, governance: stopgap.bundledServiceGovernance(record) };
  }

  const row = (overrides: Partial<Row>): Row => ({
    id: "SVC-SV-001",
    status: "reviewed",
    reviewedBy: REVIEWER,
    reviewedAt: REVIEWED_AT,
    ...overrides,
  });

  it("reads a signed record with a named reviewer and a real timestamp as locally reviewed", async () => {
    const { signOff, governance } = await withRows([row({})]);
    expect(signOff.serviceSignOffFor("SVC-SV-001")).toEqual({ reviewedBy: REVIEWER, reviewedAt: REVIEWED_AT });
    expect(governance.validationStatus).toBe("locally_reviewed");
  });

  it.each([
    ["drafted", row({ status: "drafted" })],
    ["no reviewer", row({ reviewedBy: "  " })],
    ["null reviewer", row({ reviewedBy: null })],
    ["no timestamp", row({ reviewedAt: null })],
    ["unparseable timestamp", row({ reviewedAt: "last Tuesday" })],
    ["future timestamp", row({ reviewedAt: "2999-01-01T00:00:00.000Z" })],
    ["unknown status", row({ status: "approved" })],
  ])("stays unverified when the row is %s", async (_label, entry) => {
    const { signOff, governance } = await withRows([entry]);
    expect(signOff.serviceSignOffFor("SVC-SV-001")).toBeNull();
    expect(governance.validationStatus).toBe("unverified");
  });

  it("stays unverified when the row is duplicated or belongs to another record", async () => {
    expect((await withRows([row({}), row({})])).governance.validationStatus).toBe("unverified");
    expect((await withRows([row({ id: "SVC-FDV-003" })])).governance.validationStatus).toBe("unverified");
  });
});
