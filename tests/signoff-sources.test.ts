import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyClinicalReview,
  collectionOf,
  finalizeClinicalReview,
  indigenousContentIn,
  recordKinds,
  recordPinState,
  reviewProblems,
  signOffEligibilityProblem,
  signOffQueue,
} from "../scripts/lib/clinical-record-review-contract.mjs";
import {
  display,
  duplicateSources,
  isUnattestedLocalReview,
  loadContext,
  possibleDuplicateSources,
} from "../scripts/lib/signoff-kinds/sources.mjs";
import { removePathSync } from "../scripts/retryable-fs.mjs";
import { main, renderClinicalPack } from "../scripts/review-clinical-record.mjs";

import sourceAcquisitions from "../src/data/source-acquisitions.json";

import {
  acquisitionAttestedContentSha256,
  acquisitionLedgerIssues,
  acquisitionReviewQueue,
  type SourceAcquisitionRecord,
} from "@/lib/sources/acquisition-ledger";
import { acquisitionSignOffRatings, signedValidationStatus } from "@/lib/sources/acquisition-sign-off-rating";
import { canonicalizeSourceReferences } from "@/lib/sources/catalogue-core";
import { repositorySourceReferences } from "@/lib/sources/repository-providers";

/**
 * The `source` sign-off kind (scripts/lib/signoff-kinds/sources.mjs): the owner's review of a
 * candidate source in src/data/source-acquisitions.json, written into the ledger's own
 * validationStatus and attestation fields so the queue, /sources and check:source-acquisitions
 * all read it without a second file.
 */
// Real ledger signatures carry real dates, so "now" must be the real clock or they read as future-dated.
const NOW = new Date();
const REVIEWED_AT = "2026-09-25T05:00:00.000Z";
const REVIEWER = "Dr Clinical Owner";
const ATTESTATION_FIELDS = ["attestedBy", "attestedAt", "attestedAgainstSha256"];

type Json = Record<string, unknown>;
const ledger = sourceAcquisitions as unknown as Json[];
const clone = <T>(value: T): T => structuredClone(value);
const context = {
  duplicates: duplicateSources(ledger) as Record<string, string[]>,
  possibleDuplicates: possibleDuplicateSources(ledger) as Record<string, string[]>,
};
const views = () => collectionOf("source", ledger) as Json[];
const rowsText = (rows: unknown[][]) => rows.map(([label, value]) => `${label}\n${JSON.stringify(value)}`).join("\n");

/** The record as the owner first meets it, whatever has been signed on disk since. */
function asUnsigned(id: string) {
  return ledger.map((native) => {
    if (native.id !== id) return clone(native);
    const copy = clone(native);
    for (const field of ATTESTATION_FIELDS) delete copy[field];
    return { ...copy, validationStatus: "unverified" };
  });
}

function sign(id: string) {
  const before = asUnsigned(id);
  const view = (collectionOf("source", before) as Json[]).find((record) => record.id === id)!;
  const signed = finalizeClinicalReview(view, "source", { reviewedBy: REVIEWER, reviewedAt: REVIEWED_AT, now: NOW });
  return { before, after: applyClinicalReview(clone(before), "source", signed) as Json[] };
}

/** The first record the walk-through offers: in the review queue and not held. */
const firstOffered = () =>
  views().find((record) => record.disposition === "candidate" && !indigenousContentIn(record, "source"))!.id as string;

describe("source sign-offs on disk", () => {
  it("every ledger record is unsigned or carries a current pin", () => {
    expect(reviewProblems(views(), "source", { now: new Date() })).toEqual([]);
    for (const record of views()) {
      expect(["unsigned", "current"]).toContain(recordPinState(record, "source"));
    }
  });

  it("offers exactly the acquisition review queue, in its order, less the records held from sign-off", () => {
    const queue = acquisitionReviewQueue().map((record) => record.id);
    // Reviews recorded only in prose are also drafted (owner decision, 2026-10-17); the
    // ledger's own queue lists unverified records only, so compare without them.
    const drafted = views()
      .filter((record) => record.status === "drafted" && record.validationStatus === "unverified")
      .map((record) => record.id);
    expect(drafted).toEqual(queue);

    const held = views().filter(
      (record) =>
        record.status === "drafted" &&
        record.validationStatus === "unverified" &&
        signOffEligibilityProblem(record, "source"),
    );
    const unattested = views()
      .filter((record) => record.status === "drafted" && record.validationStatus === "locally_reviewed")
      .map((record) => record.id as string);
    const offered = signOffQueue("source", views()) as string[];
    expect(offered.filter((id) => !unattested.includes(id))).toEqual(
      queue.filter((id) => !held.some((record) => record.id === id)),
    );
    expect(offered.filter((id) => unattested.includes(id))).toEqual(unattested);
    expect(offered.length - unattested.length + held.length).toBe(acquisitionReviewQueue().length);
    // The owner rule of 2026-09-26 holds Indigenous content back; this one is the named example.
    expect(held.map((record) => record.id)).toContain("therapy-wa-aboriginal-impact-policy");
    for (const record of held) expect(indigenousContentIn(record, "source")).not.toBeNull();
  });

  it("reads a review recorded only in prose, and every rejection, as pending rather than signed", () => {
    for (const record of views().filter((entry) => entry.status === "pending")) {
      const native = ledger.find((entry) => entry.id === record.id)!;
      expect(native.disposition === "rejected" || !native.attestedBy).toBe(true);
    }
    expect(views().filter((record) => record.validationStatus === "locally_reviewed").length).toBeGreaterThan(0);
  });

  it("asks questions about a source, not about clinical wording", () => {
    expect(
      (recordKinds as unknown as Record<string, { checklist: Json[] }>).source!.checklist.map(
        (check) => check.question,
      ),
    ).toEqual([
      "The title, publisher, version and dates match the publisher's own page.",
      "The document status shown (current, review due or outdated) is right, and the source is suitable for the use it was captured for.",
      "It is safe to mark this source as reviewed.",
    ]);
  });
});

describe("source sign-off round trip", () => {
  it("writes validationStatus and the three attestation fields of the target record, and nothing else", () => {
    const id = firstOffered();
    const { before, after } = sign(id);
    expect(after).toHaveLength(before.length);
    for (const [index, native] of after.entries()) {
      if (native.id !== id) {
        expect(native).toEqual(before[index]);
        continue;
      }
      const changed = Object.keys({ ...before[index], ...native }).filter(
        (key) => JSON.stringify(native[key]) !== JSON.stringify(before[index]![key]),
      );
      expect(changed.sort()).toEqual(["attestedAgainstSha256", "attestedAt", "attestedBy", "validationStatus"]);
      expect(native).toMatchObject({
        validationStatus: "locally_reviewed",
        attestedBy: REVIEWER,
        attestedAt: REVIEWED_AT,
      });
      // The pin is the ledger's own digest, so check:source-acquisitions agrees with it.
      expect(native.attestedAgainstSha256).toBe(
        acquisitionAttestedContentSha256(native as unknown as SourceAcquisitionRecord),
      );
    }
    expect(acquisitionLedgerIssues(after as unknown as SourceAcquisitionRecord[])).toEqual([]);

    const view = (collectionOf("source", after) as Json[]).find((record) => record.id === id)!;
    expect(view).toMatchObject({ status: "reviewed", reviewedBy: REVIEWER, reviewedAt: REVIEWED_AT });
    expect(recordPinState(view, "source")).toBe("current");
    expect(reviewProblems(collectionOf("source", after), "source", { now: NOW })).toEqual([]);
    expect(signOffQueue("source", collectionOf("source", after))).not.toContain(id);
    expect(
      acquisitionReviewQueue(after as unknown as SourceAcquisitionRecord[]).map((record) => record.id),
    ).not.toContain(id);
  });

  it.each([
    ["title", "A different title"],
    ["publisher", "Someone else"],
    ["canonicalUrl", "https://www.health.wa.gov.au/elsewhere"],
    ["version", "Second edition"],
    ["publicationDate", "2001-01-01"],
    ["reviewDate", "2030-01-01"],
    ["documentStatus", "outdated"],
    ["evidenceType", "other"],
    ["contentMode", "metadata_only"],
    ["topics", ["Something else"]],
    ["rung", 5],
    ["capturedFor", "A different use"],
    ["disposition", "adopted"],
    ["dispositionReason", "Changed"],
    ["supersededBy", ["another-source"]],
    ["notes", "An edited note"],
  ])("goes stale when %s is edited after sign-off", (field, value) => {
    const id = firstOffered();
    const { after } = sign(id);
    const edited = after.map((native) => (native.id === id ? { ...native, [field]: value } : native));
    const view = (collectionOf("source", edited) as Json[]).find((record) => record.id === id)!;
    expect(recordPinState(view, "source")).toBe("stale");
    expect(signOffQueue("source", collectionOf("source", edited))).toContain(id);
    expect(acquisitionLedgerIssues(edited as unknown as SourceAcquisitionRecord[])).toContain(
      `${id}: attestedAgainstSha256 is stale; content changed after sign-off`,
    );
  });

  it("refuses a record that is not in the queue", () => {
    const rejected = views().find((record) => record.disposition === "rejected")!;
    expect(signOffEligibilityProblem(rejected, "source")).toMatch(/Only a drafted source/);
  });
});

describe("source sign-off screen", () => {
  it("marks each record that duplicates another record's canonical URL", () => {
    expect(context.duplicates).toEqual({
      "ps-diff-src-au-ausprescr-movement-2019": ["dictionary-australian-prescriber-movement-2019"],
      "dictionary-australian-prescriber-movement-2019": ["ps-diff-src-au-ausprescr-movement-2019"],
      "ps-diff-src-au-ausprescr-lithium-2020": ["australian-prescriber-lithium-therapy-and-its-interactions"],
      "australian-prescriber-lithium-therapy-and-its-interactions": ["ps-diff-src-au-ausprescr-lithium-2020"],
    });
    for (const [id, others] of Object.entries(context.duplicates)) {
      const record = views().find((entry) => entry.id === id)!;
      const text = rowsText(display.source(record, context));
      expect(text).toContain(`DUPLICATE of ${others.join(", ")}`);
    }
    const unique = views().find((record) => !context.duplicates[record.id as string] && record.status === "drafted")!;
    expect(rowsText(display.source(unique, context))).not.toContain("DUPLICATE of");
  });

  it("shows every pinned field a reader or the rating uses", () => {
    for (const record of views()) {
      const text = rowsText(display.source(record, context));
      for (const field of [
        "title",
        "publisher",
        "publisherCode",
        "canonicalUrl",
        "jurisdiction",
        "version",
        "publicationDate",
        "reviewDate",
        "expiryDate",
        "datePrecision",
        "documentStatus",
        "evidenceType",
        "contentMode",
        "capturedFor",
        "capturedAt",
        "disposition",
        "dispositionReason",
        "notes",
        "validationStatus",
      ]) {
        const value = record[field];
        if (typeof value !== "string" || field === "documentStatus") continue;
        expect(text, `${record.id} ${field}`).toContain(JSON.stringify(value).slice(1, -1));
      }
      for (const topic of record.topics as string[]) expect(text).toContain(topic);
      expect(text).toContain(`${record.rung}: `);
    }
  });

  it("puts the duplicate warning in the review pack as well", () => {
    const unsigned = collectionOf(
      "source",
      ledger.map((record) => {
        const copy = clone(record);
        for (const field of ATTESTATION_FIELDS) delete copy[field];
        if (copy.disposition !== "rejected") copy.validationStatus = "unverified";
        return copy;
      }),
    );
    const html = renderClinicalPack("source", unsigned, context, { generatedAt: NOW });
    expect(html).toContain("DUPLICATE of australian-prescriber-lithium-therapy-and-its-interactions");
  });

  it("loads the duplicates and the band and score for the screen", async () => {
    const loaded = (await loadContext("source", process.cwd())) as Json;
    expect(loaded.duplicates).toEqual(context.duplicates);
    const ratings = loaded.ratings as Record<string, Json>;
    expect(Object.keys(ratings).sort()).toEqual(ledger.map((record) => record.id).sort());
    const text = rowsText(
      display.source(
        collectionOf("source", asUnsigned(firstOffered())).find((record: Json) => record.id === firstOffered())!,
        loaded,
      ),
    );
    expect(text).toMatch(/After this sign-off: band [A-D], score \d+\/100, validation locally_reviewed/);
  }, 60_000);
});

describe("source sign-off ratings", () => {
  const records = sourceAcquisitions as unknown as SourceAcquisitionRecord[];
  const references = repositorySourceReferences();
  const ratings = acquisitionSignOffRatings(records, references);

  it("rates the /sources entry exactly as the full catalogue does", () => {
    const catalogue = canonicalizeSourceReferences(references);
    for (const record of records) {
      const entry = catalogue.find((candidate) =>
        candidate.usedBy.some((usage) => usage.field === "acquisition_ledger" && usage.recordId === record.id),
      )!;
      expect(ratings[record.id]!.catalogue?.now, record.id).toMatchObject({
        band: entry.rating.band,
        score: entry.rating.score,
        validationStatus: entry.validationStatus,
        usages: entry.usedBy.length,
      });
    }
  });

  it("shows signing lift accuracy assurance from unverified to locally reviewed", () => {
    expect(signedValidationStatus("unverified")).toBe("locally_reviewed");
    expect(signedValidationStatus("approved")).toBe("approved");
    for (const record of acquisitionReviewQueue(records)) {
      const { now, ifReviewed } = ratings[record.id]!.standalone;
      expect(ifReviewed.score - now.score).toBe(15);
      expect(ifReviewed.warnings).not.toContain("verification_unknown");
    }
  });
});

/**
 * Owner decision, 2026-10-17: a source marked locally_reviewed whose review was recorded only in
 * prose (no attestation field at all) can be signed with clinical:review like a drafted source,
 * so the owner can record the structured attestation it lacks. Every other guard stays.
 */
describe("signing a source reviewed only in prose", () => {
  const PROSE_ONLY = ["ocp-wa-standard-authorisation-of-hospitals", "ocp-wa-standards-for-clinical-care"];
  const LEDGER = join("src", "data", "source-acquisitions.json");
  // A person's full name, which the --write attribution rule accepts.
  const SIGNER = "Dr Alex Morgan";
  const temporaryDirectories: string[] = [];
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) removePathSync(directory, { recursive: true });
  });

  const native = (id: string) => clone(ledger.find((record) => record.id === id)!);
  const attestedNative = () =>
    clone(
      ledger.find(
        (record) =>
          record.validationStatus === "locally_reviewed" &&
          typeof record.attestedBy === "string" &&
          record.disposition !== "rejected" &&
          !indigenousContentIn(record, "source"),
      )!,
    );
  const viewOf = (record: Json) => (collectionOf("source", [record]) as Json[])[0]!;

  function fixtureRoot(records: Json[]) {
    const root = mkdtempSync(join(tmpdir(), "source-signoff-"));
    temporaryDirectories.push(root);
    mkdirSync(join(root, "src", "data"), { recursive: true });
    writeFileSync(join(root, LEDGER), `${JSON.stringify(records, null, 2)}\n`);
    return root;
  }

  async function runWrite(root: string, code: string, answers: string[]) {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80 });
    const text: string[] = [];
    output.on("data", (chunk: Buffer) => {
      const value = chunk.toString();
      text.push(value);
      if (/(Type yes, no, or quit: |type its code \([^)]*\), or quit to stop: )$/.test(value)) {
        const next = answers.shift();
        if (next !== undefined) setImmediate(() => input.write(`${next}\n`));
      }
    });
    const errors = new PassThrough();
    errors.resume();
    const exit = await main(["--write", "--kind", "source", "--code", code, "--reviewed-by", SIGNER], {
      root,
      input,
      output,
      errorOutput: errors,
    });
    return { exit, text: text.join("") };
  }

  it("finds exactly the two OCP WA standards in the ledger today, and offers them for sign-off", () => {
    const proseOnly = ledger.filter((record) => isUnattestedLocalReview(record)).map((record) => record.id);
    expect([...proseOnly].sort()).toEqual(PROSE_ONLY);
    for (const id of PROSE_ONLY) {
      const view = views().find((record) => record.id === id)!;
      expect(view).toMatchObject({ status: "drafted", validationStatus: "locally_reviewed", reviewedBy: null });
      // The screen must not promise a rating change: validationStatus is already locally_reviewed.
      const text = rowsText(display.source(view, context));
      expect(text).toContain("already locally_reviewed and stays so, so its rating does not change");
      expect(text).not.toContain("Sets validationStatus to locally_reviewed");
      expect(signOffEligibilityProblem(view, "source")).toBeNull();
      expect(signOffQueue("source", views())).toContain(id);
    }
  });

  it("accepts a reviewed-but-unsigned source for --write and records only the attestation", async () => {
    const id = "ocp-wa-standards-for-clinical-care";
    const before = [native(id), attestedNative()];
    const root = fixtureRoot(before);
    const { exit, text } = await runWrite(root, id, ["yes", "yes", "yes", id]);
    expect(exit).toBe(0);
    expect(text).toContain(`Saved: Source ${id} is signed off.`);

    const after = JSON.parse(readFileSync(join(root, LEDGER), "utf8")) as Json[];
    expect(after[1]).toEqual(before[1]);
    const changed = Object.keys({ ...before[0], ...after[0] }).filter(
      (key) => JSON.stringify(after[0]![key]) !== JSON.stringify(before[0]![key]),
    );
    expect(changed.sort()).toEqual(["attestedAgainstSha256", "attestedAt", "attestedBy"]);
    expect(after[0]).toMatchObject({ validationStatus: "locally_reviewed", attestedBy: SIGNER });
    expect(after[0]!.attestedAgainstSha256).toBe(
      acquisitionAttestedContentSha256(after[0] as unknown as SourceAcquisitionRecord),
    );
    expect(acquisitionLedgerIssues(after as unknown as SourceAcquisitionRecord[])).toEqual([]);
    const view = viewOf(after[0]!);
    expect(view.status).toBe("reviewed");
    expect(recordPinState(view, "source")).toBe("current");
  }, 60_000);

  it("refuses a source that already carries an attestation, before asking anything", async () => {
    const attested = attestedNative();
    expect(isUnattestedLocalReview(attested)).toBe(false);
    expect(signOffEligibilityProblem(viewOf(attested), "source")).toMatch(/already signed off/);
    const root = fixtureRoot([attested]);
    const raw = readFileSync(join(root, LEDGER), "utf8");
    await expect(runWrite(root, attested.id as string, [])).rejects.toThrow(/already signed off/);
    expect(readFileSync(join(root, LEDGER), "utf8")).toBe(raw);
  });

  it.each([
    ["attestedBy only", { attestedBy: "Dr Someone Else" }],
    ["attestedAt only", { attestedAt: "2026-09-06T00:00:00.000Z" }],
    ["attestedAgainstSha256 only", { attestedAgainstSha256: "0".repeat(64) }],
    ["a null attestation field", { attestedBy: null }],
    ["an empty attestation field", { attestedAt: "" }],
  ])("refuses a locally_reviewed source with a partial attestation (%s)", (_label, fields) => {
    const record = { ...native("ocp-wa-standards-for-clinical-care"), ...fields };
    expect(isUnattestedLocalReview(record)).toBe(false);
    expect(signOffEligibilityProblem(viewOf(record), "source")).not.toBeNull();
  });

  it("tells the owner an approved source keeps its status when a stale sign-off is redone", () => {
    const record = { ...attestedNative(), validationStatus: "approved" };
    const text = rowsText(display.source(viewOf(record), context));
    expect(text).toContain("already approved and stays so");
    expect(text).not.toContain("Sets validationStatus to locally_reviewed");
  });

  it.each([
    ["approved", { validationStatus: "approved" }],
    ["rejected", { disposition: "rejected" }],
  ])("does not offer a prose-only review that is %s", (_label, fields) => {
    const record = { ...native("ocp-wa-standards-for-clinical-care"), ...fields };
    expect(isUnattestedLocalReview(record)).toBe(false);
    expect(signOffEligibilityProblem(viewOf(record), "source")).toMatch(/Only a drafted source/);
  });

  it("still refuses --write for a reviewed-but-unsigned source without an interactive TTY", () => {
    const path = join(process.cwd(), LEDGER);
    const before = readFileSync(path, "utf8");
    for (const id of PROSE_ONLY) {
      const refused = spawnSync(
        process.execPath,
        [
          join(process.cwd(), "scripts", "review-clinical-record.mjs"),
          "--write",
          "--kind",
          "source",
          "--code",
          id,
          "--reviewed-by",
          SIGNER,
        ],
        { cwd: process.cwd(), encoding: "utf8", input: `yes\nyes\nyes\n${id}\n` },
      );
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toContain("interactive TTY");
    }
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("still refuses a product name as the signer for a reviewed-but-unsigned source", async () => {
    const id = "ocp-wa-standards-for-clinical-care";
    const root = fixtureRoot([native(id)]);
    const raw = readFileSync(join(root, LEDGER), "utf8");
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80 });
    output.resume();
    await expect(
      main(["--write", "--kind", "source", "--code", id, "--reviewed-by", "PsychSift"], {
        root,
        input,
        output,
        errorOutput: output,
      }),
    ).rejects.toThrow();
    expect(readFileSync(join(root, LEDGER), "utf8")).toBe(raw);
  });
});
