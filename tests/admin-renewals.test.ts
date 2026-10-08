import { describe, expect, it } from "vitest";

import {
  buildIssuerCheckStampBody,
  buildNotForThisJobCreateBody,
  buildNotForThisJobToggleBody,
  buildRenewedEntryBody,
  buildRestoreEntryBody,
  complianceExpiryHistory,
  groupComplianceEntries,
  issuerCheckStampLabel,
  renewalCalendarEvent,
  renewalsCalendarFile,
  workforceCopyText,
  workforceRequirementLine,
} from "@/lib/admin/renewals";
import { createOnCallEntrySchema, updateOnCallEntrySchema } from "@/lib/on-call/api-schemas";
import { ADMIN_REQUIREMENTS_CATALOGUE } from "@/lib/admin/requirements";
import { complianceIssuerCheckedOn, mayContainOnCallCompliance } from "@/lib/on-call/compliance";
import { onCallDetailsSchemaFor } from "@/lib/on-call/entry-model";
import { complianceFixture, onCallEntryFixture } from "./helpers/on-call-entry-fixture";

const NOW = new Date("2026-09-26T01:00:00Z"); // 09:00 Perth
const registration = complianceFixture("Medical registration", {
  category: "Registration",
  consequence: "stops-work",
  expiresOn: "2026-12-20",
  issuingBody: "The national board",
  proofNote: "Email from the board",
  evidenceUrl: "https://example.org/reg.pdf",
});

describe("the Renewed sheet's record", () => {
  it("stores the typed date, keeps the old one in history, and round-trips every other field", () => {
    const result = buildRenewedEntryBody(registration, {
      newExpiresOn: "2027-12-20",
      proofNote: "Email from the board, 3 Oct",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.earlier).toBe(false);
    expect(updateOnCallEntrySchema.safeParse(result.body).success).toBe(true);
    expect(onCallDetailsSchemaFor("logistics").safeParse(result.body.details).success).toBe(true);
    expect(result.body.details).toMatchObject({
      expiresOn: "2027-12-20",
      expiryHistory: ["2026-12-20"],
      proofNote: "Email from the board, 3 Oct",
      provenance: "typed",
      issuingBody: "The national board",
    });
    expect(result.body.lastVerifiedAt).toBe(registration.lastVerifiedAt);
  });

  it("does not set issuerCheckedOn when Renewed alone runs", () => {
    const stamped = complianceFixture("Medical registration", {
      category: "Registration",
      expiresOn: "2026-12-20",
      issuerCheckedOn: "2026-08-01",
    });
    const result = buildRenewedEntryBody(stamped, { newExpiresOn: "2027-12-20", proofNote: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.body.details as { issuerCheckedOn?: string }).issuerCheckedOn).toBe("2026-08-01");
    const fresh = buildRenewedEntryBody(registration, { newExpiresOn: "2027-12-20", proofNote: "" });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.body.details).not.toHaveProperty("issuerCheckedOn");
    expect(fresh.body.lastVerifiedAt).toBe(registration.lastVerifiedAt);
  });

  it("refuses a missing, malformed or unchanged date, and an over-long proof note", () => {
    const base = { proofNote: "" };
    expect(buildRenewedEntryBody(registration, { ...base, newExpiresOn: "" })).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(buildRenewedEntryBody(registration, { ...base, newExpiresOn: "20/12/2027" })).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(buildRenewedEntryBody(registration, { ...base, newExpiresOn: "2026-12-20" })).toEqual({
      ok: false,
      reason: "unchanged",
    });
    expect(buildRenewedEntryBody(registration, { newExpiresOn: "2027-12-20", proofNote: "x".repeat(121) })).toEqual({
      ok: false,
      reason: "too-long",
    });
  });

  it("saves an earlier date and says so, so the sheet can offer Undo instead of a confirm dialog", () => {
    const result = buildRenewedEntryBody(registration, { newExpiresOn: "2026-12-01", proofNote: "" });
    expect(result.ok && result.earlier).toBe(true);
  });

  it("restores the row exactly as it was for Undo", () => {
    const restore = buildRestoreEntryBody(registration);
    expect(updateOnCallEntrySchema.safeParse(restore).success).toBe(true);
    expect(restore.details).toEqual(registration.details);
  });

  it("keeps at most ten earlier dates, newest first", () => {
    const history = Array.from({ length: 10 }, (_, i) => `20${10 + i}-01-01`).reverse();
    const long = complianceFixture("Registration", {
      category: "Registration",
      expiresOn: "2026-12-20",
      expiryHistory: history,
    });
    const result = buildRenewedEntryBody(long, { newExpiresOn: "2027-12-20", proofNote: "" });
    expect(result.ok && complianceExpiryHistory({ ...long, details: result.body.details })).toEqual(
      ["2026-12-20", ...history].slice(0, 10),
    );
  });

  it("treats the new keys as compliance markers, so public reads and the device cache still fail closed", () => {
    expect(mayContainOnCallCompliance("logistics", { category: "Pay", proofNote: "x" })).toBe(true);
    expect(mayContainOnCallCompliance("logistics", { category: "Pay", expiryHistory: [] })).toBe(true);
    expect(mayContainOnCallCompliance("logistics", { category: "Pay", notForThisJob: true })).toBe(true);
    expect(mayContainOnCallCompliance("logistics", { category: "Pay", issuerCheckedOn: "2026-09-26" })).toBe(true);
  });
});

describe("issuer check stamp (holder action)", () => {
  it("parses and serialises issuerCheckedOn on compliance details", () => {
    const parsed = onCallDetailsSchemaFor("logistics").safeParse({
      category: "Registration",
      kind: "compliance",
      expiresOn: "2026-12-20",
      issuerCheckedOn: "2026-09-26",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({ issuerCheckedOn: "2026-09-26" });
    expect(
      onCallDetailsSchemaFor("logistics").safeParse({
        category: "Registration",
        issuerCheckedOn: "26/09/2026",
      }).success,
    ).toBe(false);
  });

  it("sets and clears the stamp without touching lastVerifiedAt", () => {
    const set = buildIssuerCheckStampBody(registration, "2026-09-26");
    expect(set).toEqual(expect.objectContaining({ ok: true }));
    if (!set.ok) return;
    expect(updateOnCallEntrySchema.safeParse(set.body).success).toBe(true);
    expect(set.body.details).toMatchObject({ issuerCheckedOn: "2026-09-26", expiresOn: "2026-12-20" });
    expect(set.body.lastVerifiedAt).toBe(registration.lastVerifiedAt);
    expect(complianceIssuerCheckedOn({ ...registration, details: set.body.details })).toBe("2026-09-26");

    const clear = buildIssuerCheckStampBody({ ...registration, details: set.body.details }, null);
    expect(clear.ok).toBe(true);
    if (!clear.ok) return;
    expect(clear.body.details).not.toHaveProperty("issuerCheckedOn");
    expect(clear.body.lastVerifiedAt).toBe(registration.lastVerifiedAt);
  });

  it("phrases the stamp as a holder action, never verified or compliant", () => {
    expect(issuerCheckStampLabel(undefined)).toBe("No issuer check recorded");
    expect(issuerCheckStampLabel("2026-09-26")).toBe("Last checked with issuer · 26 Sep 2026 · by you");
    expect(issuerCheckStampLabel("2026-09-26")).not.toMatch(/\bverified\b/i);
    expect(issuerCheckStampLabel("2026-09-26")).not.toMatch(/\bcompliant\b/i);
  });
});

describe("Add to my calendar (spec review 9)", () => {
  it("is the calendar export's own expiry event, same id, with alerts at 09:00 Perth", () => {
    expect(renewalCalendarEvent(registration, NOW)).toMatchObject({
      id: `on-call-expiry-${registration.id}`,
      date: "2026-12-20",
      // start of the lead time (20 Nov) and one week before (13 Dec), each 09:00 Perth = 01:00 UTC
      alarmsAt: ["2026-11-20T01:00:00.000Z", "2026-12-13T01:00:00.000Z"],
    });
    expect(renewalCalendarEvent(complianceFixture("Undated", { category: "Training" }), NOW)).toBeNull();
  });

  it("drops an alert whose moment has already passed", () => {
    const soon = complianceFixture("ALS", { category: "Training", expiresOn: "2026-10-01" });
    expect(renewalCalendarEvent(soon, NOW)?.alarmsAt).toEqual([]);
  });

  it("writes one file with every dated renewal, two alarms each, and no calendar name", () => {
    const file = renewalsCalendarFile([registration, complianceFixture("Undated", { category: "Training" })], NOW);
    expect(file).not.toBeNull();
    expect(file!.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(file!.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(file!).toContain(`UID:on-call-expiry-${registration.id}@`);
    expect(file!).not.toContain("X-WR-CALNAME");
    expect(renewalsCalendarFile([], NOW)).toBeNull();
  });
});

describe("Copy for workforce", () => {
  it("names ready, Not recorded yet, missing proof, and the issuer stamp when present", () => {
    const stamped = complianceFixture("Medical registration", {
      category: "Registration",
      consequence: "stops-work",
      expiresOn: "2026-12-20",
      issuingBody: "The national board",
      proofNote: "Email from the board",
      evidenceUrl: "https://example.org/reg.pdf",
      issuerCheckedOn: "2026-09-01",
      requirementId: "medical-registration-renewal",
    });
    const undated = complianceFixture("Police check", {
      category: "Clearances",
      requirementId: "criminal-record-screening",
    });
    expect(workforceRequirementLine(stamped.title, stamped)).toBe(
      "Medical registration (The national board): ready · recorded as expiring 20 Dec 2026 · Last checked with issuer · 1 Sep 2026 · by you",
    );
    expect(workforceRequirementLine(undated.title, undated)).toBe("Police check: Not recorded yet · missing proof");
    expect(workforceRequirementLine("Visa and work rights", null)).toBe(
      "Visa and work rights: Not recorded yet · missing proof",
    );

    const text = workforceCopyText([stamped, undated], NOW);
    const lines = text.split("\n");
    expect(lines[0]).toBe("Dates as I recorded them, copied 26 Sep 2026. Not checked with issuers");
    expect(lines).toContainEqual(
      "Medical registration renewal (The national board): ready · recorded as expiring 20 Dec 2026 · Last checked with issuer · 1 Sep 2026 · by you",
    );
    expect(lines).toContainEqual("Criminal record screening: Not recorded yet · missing proof");
    expect(lines.some((line) => line.includes("Not recorded yet"))).toBe(true);
    expect(text).not.toMatch(/\bverified\b/i);
    expect(text).not.toMatch(/\bcompliant\b/i);
  });

  it("lists catalogue gaps as missing lines, not silent omit", () => {
    const text = workforceCopyText([registration], NOW);
    expect(text.split("\n").length).toBeGreaterThan(ADMIN_REQUIREMENTS_CATALOGUE.length);
    expect(text).toContain("Not recorded yet · missing proof");
  });
});

describe('"Not for this job" (owner-approved, spec 28)', () => {
  it("splits compliance entries into counted and not-for-this-job groups, and counts recorded vs total", () => {
    const unrecorded = complianceFixture("Police check", { category: "Clearances" });
    const excluded = complianceFixture("Old college training", { category: "Training", notForThisJob: true });
    const groups = groupComplianceEntries([registration, unrecorded, excluded]);
    expect(groups.counted).toEqual([registration, unrecorded]);
    expect(groups.notForThisJob).toEqual([excluded]);
    expect(groups.counts).toEqual({ recorded: 1, total: 2, notForThisJob: 1 });
  });

  it("drops rows from other sections and non-compliance Admin rows, same as partitionLogisticsEntries", () => {
    const adminRow = onCallEntryFixture({ section: "logistics", details: { category: "Pay" } });
    const otherSection = onCallEntryFixture({ section: "contacts", details: { role: "Registrar" } });
    const groups = groupComplianceEntries([adminRow, otherSection]);
    expect(groups.counted).toEqual([]);
    expect(groups.notForThisJob).toEqual([]);
    expect(groups.counts).toEqual({ recorded: 0, total: 0, notForThisJob: 0 });
  });

  it("toggles the flag on and round-trips every other field", () => {
    const result = buildNotForThisJobToggleBody(registration, true);
    expect(updateOnCallEntrySchema.safeParse(result).success).toBe(true);
    expect(onCallDetailsSchemaFor("logistics").safeParse(result.details).success).toBe(true);
    expect(result.details).toMatchObject({ notForThisJob: true, expiresOn: "2026-12-20" });
    expect(result.lastVerifiedAt).toBe(registration.lastVerifiedAt);
  });

  it("clears the flag rather than storing it as false", () => {
    const flagged = complianceFixture("Old training", { category: "Training", notForThisJob: true });
    const result = buildNotForThisJobToggleBody(flagged, false);
    expect(result.details).not.toHaveProperty("notForThisJob");
  });

  it("undoes with buildRestoreEntryBody, following the Renewed sheet's own undo pattern", () => {
    const toggled = buildNotForThisJobToggleBody(registration, true);
    expect(toggled.details).not.toEqual(registration.details);
    const restored = buildRestoreEntryBody(registration);
    expect(updateOnCallEntrySchema.safeParse(restored).success).toBe(true);
    expect(restored.details).toEqual(registration.details);
  });
});

describe('"Not for this job" on an item never recorded (I4)', () => {
  it("creates a minimal private compliance row with no date, that the API and details schema accept", () => {
    const item = ADMIN_REQUIREMENTS_CATALOGUE.find((candidate) => candidate.id === "img-visa-requirements")!;
    const body = buildNotForThisJobCreateBody(item, "ab12cd");
    expect(createOnCallEntrySchema.safeParse(body).success).toBe(true);
    expect(onCallDetailsSchemaFor("logistics").safeParse(body.details).success).toBe(true);
    expect(body).toMatchObject({ section: "logistics", title: item.title, isPersonal: true, includeOnCard: false });
    expect(body.details).toEqual({
      kind: "compliance",
      category: item.group,
      requirementId: item.id,
      notForThisJob: true,
    });
  });
});

describe("rows marked not for this job leave the exports (M13)", () => {
  const flagged = complianceFixture("IMG visa requirements", {
    category: "job",
    expiresOn: "2027-03-01",
    notForThisJob: true,
    requirementId: "img-visa-requirements",
  });

  it("are not in Add all to my calendar", () => {
    const file = renewalsCalendarFile([registration, flagged], NOW) ?? "";
    expect(file).toContain("Medical registration");
    expect(file).not.toContain("IMG visa requirements");
    expect(renewalsCalendarFile([flagged], NOW)).toBeNull();
  });

  it("are not in Copy for workforce as a recorded row", () => {
    const text = workforceCopyText([registration, flagged], NOW);
    expect(text).toContain("Medical registration");
    // Flagged catalogue items leave the job checklist; they must not appear as ready.
    expect(text).not.toMatch(/IMG visa requirements: ready/);
    expect(text).not.toMatch(/IMG visa requirements: recorded as expiring/);
  });
});
