/**
 * Sign-off kind `source`: the owner's review of a candidate clinical source in the source
 * acquisition ledger, src/data/source-acquisitions.json. See ./index.mjs for the interface and
 * docs/source-acquisition-protocol.md section 4 for what a review is.
 *
 * Native fields, so every existing reader sees the sign-off with no second file:
 *
 *   validationStatus       `unverified` becomes `locally_reviewed`, the value the protocol
 *                          names for "read the source and confirmed it" (the queue, the
 *                          /sources band and score, and the adopted-must-be-reviewed rule all
 *                          key off it). `approved` is formal local governance approval,
 *                          which this tool does not grant.
 *   attestedBy             reviewedBy
 *   attestedAt             reviewedAt (a UTC ISO instant; acquisitionLedgerIssues accepts it)
 *   attestedAgainstSha256  reviewedContentSha256
 *
 * The pin is the ledger's own `acquisitionAttestedContentSha256`: every field of the record
 * except the three attestation fields, with validationStatus as signing leaves it. So the
 * digest this tool writes is the one `npm run check:source-acquisitions` recomputes, and an
 * edit to any field (title, publisher, URL, version, dates, status, rung, topics, intended
 * use, disposition, notes) reads as stale in both. Band and score are derived from those
 * fields plus the publisher register, so they are shown, not pinned: the ledger's digest
 * cannot carry them.
 *
 * Status: a record in `acquisitionReviewQueue()` (not rejected, still unverified) is
 * `drafted`, and so is one marked locally_reviewed with no attestation field at all (a review
 * recorded only in prose, which the owner can now sign properly; signing leaves its
 * validationStatus as it is). One that is locally_reviewed or approved AND names its reviewer
 * in attestedBy is `reviewed`; everything else (rejections, approved records reviewed only in
 * prose, and any partial attestation) is `pending`. Walk order: most local rung first, then
 * title.
 *
 * Signing a source does not adopt it. `disposition` stays `candidate` until clinical content
 * is written to cite it, which is a separate, deliberate edit.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const LEDGER_PATH = "src/data/source-acquisitions.json";
const ATTESTATION_FIELDS = ["attestedBy", "attestedAt", "attestedAgainstSha256"];
const VIEW_ONLY_FIELDS = ["status", "reviewedBy", "reviewedAt", "reviewedContentSha256"];
const REVIEWED_VALIDATION = new Set(["locally_reviewed", "approved"]);
const TITLE_COLLATOR = new Intl.Collator("en-AU");

/** The questions for a source (owner-facing wording; see the report for the reasoning). */
const SOURCE_CHECKLIST = Object.freeze([
  Object.freeze({
    key: "detailsMatchPublisher",
    label: "Publisher details",
    question: "The title, publisher, version and dates match the publisher's own page.",
  }),
  Object.freeze({
    key: "statusAndUseCorrect",
    label: "Status and use",
    question:
      "The document status shown (current, review due or outdated) is right, and the source is suitable for the use it was captured for.",
  }),
  Object.freeze({
    key: "safeToMarkReviewed",
    label: "Safe to mark reviewed",
    question: "It is safe to mark this source as reviewed.",
  }),
]);

const RUNG_LABELS = {
  1: "WA local (hospital or health service)",
  2: "WA state",
  3: "Australian national",
  4: "Other Australian state",
  5: "International",
};

const isPlainRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const presentText = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** What signing leaves in validationStatus; mirrors signedValidationStatus in the rating helper. */
const signedValidationStatus = (status) => (status === "unverified" ? "locally_reviewed" : status);

/**
 * Marked locally_reviewed with the review recorded only in prose: no attestation field at all
 * (not even an empty or null one). The owner may sign it with this tool like a drafted source,
 * which records the structured attestation the ledger lacks (owner decision, 2026-10-17). A
 * record carrying any attestation field, complete or partial, is never treated this way.
 */
export function isUnattestedLocalReview(native) {
  return (
    isPlainRecord(native) &&
    native.disposition !== "rejected" &&
    native.validationStatus === "locally_reviewed" &&
    ATTESTATION_FIELDS.every((key) => !Object.hasOwn(native, key))
  );
}

function sourceStatus(native) {
  if (native.disposition !== "rejected" && native.validationStatus === "unverified") return "drafted";
  if (isUnattestedLocalReview(native)) return "drafted";
  if (REVIEWED_VALIDATION.has(native.validationStatus) && presentText(native.attestedBy)) return "reviewed";
  return "pending";
}

function sourceView(native) {
  if (!isPlainRecord(native)) return native;
  for (const key of VIEW_ONLY_FIELDS) {
    if (Object.hasOwn(native, key)) {
      throw new Error(`Source ${native.id ?? ""} already has a "${key}" field; the sign-off view would hide it.`);
    }
  }
  const content = Object.fromEntries(Object.entries(native).filter(([key]) => !ATTESTATION_FIELDS.includes(key)));
  return {
    ...content,
    status: sourceStatus(native),
    reviewedBy: presentText(native.attestedBy),
    reviewedAt: presentText(native.attestedAt),
    reviewedContentSha256: presentText(native.attestedAgainstSha256),
  };
}

/** Every ledger record as a view, in the order acquisitionReviewQueue() reads them. */
function sourceRecords(document) {
  if (!Array.isArray(document)) throw new Error(`${LEDGER_PATH} must be a JSON array of records.`);
  return document
    .map(sourceView)
    .sort((left, right) => left.rung - right.rung || TITLE_COLLATOR.compare(left.title, right.title));
}

/** Write one sign-off into the record's native fields and change nothing else. */
function writeSourceReview(document, view) {
  if (!Array.isArray(document)) throw new Error(`${LEDGER_PATH} must be a JSON array of records.`);
  const matches = document.filter((native) => native?.id === view.id).length;
  if (matches !== 1) throw new Error(`Source ${view.id} matched ${matches} records in ${LEDGER_PATH}.`);
  return document.map((native) =>
    native?.id === view.id
      ? {
          ...native,
          validationStatus: signedValidationStatus(native.validationStatus),
          attestedBy: view.reviewedBy,
          attestedAt: view.reviewedAt,
          attestedAgainstSha256: view.reviewedContentSha256,
        }
      : native,
  );
}

/** The record exactly as acquisitionAttestedContentSha256 digests it once signed. */
function attestedSource(record) {
  const content = Object.fromEntries(Object.entries(record).filter(([key]) => !VIEW_ONLY_FIELDS.includes(key)));
  return { ...content, validationStatus: signedValidationStatus(record.validationStatus) };
}

export const kinds = {
  source: {
    noun: "Source",
    heading: "Candidate clinical sources (source acquisition ledger)",
    path: LEDGER_PATH,
    idField: "id",
    optional: true,
    statuses: Object.freeze(["pending", "drafted", "reviewed"]),
    checklist: SOURCE_CHECKLIST,
    records: sourceRecords,
    write: writeSourceReview,
    attested: attestedSource,
  },
};

const normalizedUrl = (value) => {
  const text = presentText(value);
  return text ? text.toLowerCase().replace(/\/+$/, "") : null;
};

/** For each record id, the other records filed against the same canonical URL. */
export function duplicateSources(document) {
  return relatedSources(document, (left, right) => left === right);
}

/**
 * For each record id, records whose link is a page inside this one's link, or the reverse
 * (NICE's /guidance/ng222 and /guidance/ng222/chapter/recommendations): very likely the same
 * work filed twice, but not certainly, so it is shown as possible rather than certain.
 */
export function possibleDuplicateSources(document) {
  return relatedSources(
    document,
    (left, right) => left !== right && (left.startsWith(`${right}/`) || right.startsWith(`${left}/`)),
  );
}

function relatedSources(document, related) {
  const linked = (Array.isArray(document) ? document : [])
    .map((record) => ({ id: record?.id, url: normalizedUrl(record?.canonicalUrl) }))
    .filter((entry) => entry.url);
  const result = {};
  for (const entry of linked) {
    const others = linked.filter((other) => other.id !== entry.id && related(entry.url, other.url));
    if (others.length) result[entry.id] = others.map((other) => other.id);
  }
  return result;
}

const DOCUMENT_STATUS_WORDS = {
  current: "Current",
  review_due: "Review due (the publisher's latest date is over five years old, or a review date has passed)",
  outdated: "Outdated",
};

function datesText(record) {
  const continuous = record.dateModel === "continuously_updated";
  return [
    continuous
      ? "Dated by: a review stamp (the publisher maintains this page rather than issuing it)"
      : "Dated by: publication date",
    `Published: ${record.publicationDate ?? "(none)"}${continuous ? "" : ` (${record.datePrecision} precision)`}`,
    `Review date: ${record.reviewDate ?? "(none)"}${continuous ? ` (${record.datePrecision} precision)` : ""}`,
    `Expiry date: ${record.expiryDate ?? "(none)"}`,
  ];
}

function ratingText(summary) {
  const notes = summary.warnings.length ? `; warnings: ${summary.warnings.join(", ")}` : "";
  return `band ${summary.band}, score ${summary.score}/100, validation ${summary.validationStatus}${notes}`;
}

function ratingRows(record, context) {
  const rating = context?.ratings?.[record.id];
  if (!rating) {
    return [
      [
        "Band and score",
        "(Could not be worked out on this computer. Run npm ci --include=dev, then open this record again.)",
      ],
    ];
  }
  const signing = record.status === "drafted";
  const rows = [
    [
      "This record rated on its own",
      [
        `Now: ${ratingText(rating.standalone.now)}`,
        ...(signing ? [`After this sign-off: ${ratingText(rating.standalone.ifReviewed)}`] : []),
        `Jurisdiction placed by the publisher register: ${rating.standalone.now.geography}`,
      ],
    ],
  ];
  if (rating.catalogue) {
    const { now, ifReviewed } = rating.catalogue;
    const others = now.usages - 1;
    const lines = [`Now: ${ratingText(now)}`];
    if (now.warnings.includes("metadata_conflict")) {
      lines.push(
        "Other references to this source disagree with its details, so /sources lists them separately and holds each at band D until the details agree.",
      );
    }
    lines.push(
      others > 0
        ? `Merged with ${others} other place${others === 1 ? "" : "s"} citing the same source; /sources shows the weakest validation status among them.`
        : "No other place is merged into this entry.",
    );
    if (signing) {
      lines.push(
        ifReviewed.validationStatus === now.validationStatus
          ? `After this sign-off: ${ratingText(ifReviewed)}. The validation shown does not change, because another reference to the same source is still ${now.validationStatus}.`
          : `After this sign-off: ${ratingText(ifReviewed)}`,
      );
    }
    rows.push(["As /sources shows it", lines]);
  }
  return rows;
}

export const display = {
  source(record, context) {
    const duplicates = context?.duplicates?.[record.id] ?? [];
    const possible = context?.possibleDuplicates?.[record.id] ?? [];
    return [
      ["Source", `${record.title} (${record.id})`],
      ...(duplicates.length
        ? [
            [
              "DUPLICATE",
              `DUPLICATE of ${duplicates.join(", ")}: the same canonical URL is filed more than once. ` +
                "Reconcile the duplicates before signing (ledger #QP7H3X); /sources merges them and shows the weaker status.",
            ],
          ]
        : []),
      ...(possible.length
        ? [
            [
              "POSSIBLE DUPLICATE",
              `POSSIBLE DUPLICATE of ${possible.join(", ")}: its link and this one are pages of the same publication. ` +
                "Check they are the same work before signing both.",
            ],
          ]
        : []),
      ["Publisher", `${record.publisher}${record.publisherCode ? ` (register code ${record.publisherCode})` : ""}`],
      ["Link", record.canonicalUrl ?? "(no link recorded, so /sources cannot open it)"],
      ["Jurisdiction", record.jurisdiction],
      ["Search rung", `${record.rung}: ${RUNG_LABELS[record.rung] ?? "(not a recognised rung)"}`],
      ["Version", record.version],
      ["Dates", datesText(record)],
      ["Document status", DOCUMENT_STATUS_WORDS[record.documentStatus] ?? record.documentStatus],
      ["Kind of evidence", record.evidenceType],
      ["How the site holds it", record.contentMode],
      ["Topics", record.topics ?? []],
      ["Captured for (its intended use)", record.capturedFor],
      ["Captured on", record.capturedAt],
      ["Decision so far", `${record.disposition}${record.dispositionReason ? `: ${record.dispositionReason}` : ""}`],
      ["Superseded by", record.supersededBy?.length ? record.supersededBy : "(nothing recorded)"],
      ["Notes", record.notes],
      ["Validation status now", record.validationStatus],
      ...ratingRows(record, context),
      [
        "What signing does",
        "Sets validationStatus to locally_reviewed and records your name, the time and a pin of every field above. " +
          "It takes the source off the owner review queue and changes its rating as shown above. It does not adopt " +
          "the source: disposition stays candidate until clinical content is written to cite it.",
      ],
    ];
  },
};

const ratingCache = new Map();

/**
 * Band and score for every record, from the app's own catalogue code run under tsx (this
 * plain-Node tool cannot import the app's TypeScript). Cached per ledger content, so the
 * walk-through re-rates only after a save. Undefined when the project tools are missing.
 */
function ledgerRatings(root, raw) {
  const key = `${root}\u0000${raw}`;
  if (ratingCache.has(key)) return ratingCache.get(key);
  let ratings;
  try {
    const helper = pathToFileURL(join(root, "src", "lib", "sources", "acquisition-sign-off-rating.ts")).href;
    const providers = pathToFileURL(join(root, "src", "lib", "sources", "repository-providers.ts")).href;
    const ledger = pathToFileURL(join(root, "src", "lib", "sources", "acquisition-ledger.ts")).href;
    const script =
      `Promise.all([import(${JSON.stringify(helper)}), import(${JSON.stringify(providers)}), import(${JSON.stringify(ledger)})])` +
      `.then(([{ acquisitionSignOffRatings }, { repositorySourceReferences }, { sourceAcquisitionRecords }]) => ` +
      `process.stdout.write(JSON.stringify(acquisitionSignOffRatings(sourceAcquisitionRecords, repositorySourceReferences()))));`;
    const output = execFileSync(process.execPath, [join(root, "scripts", "run-tsx.mjs"), "-e", script], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
    ratings = JSON.parse(output);
  } catch {
    ratings = undefined;
  }
  ratingCache.set(key, ratings);
  return ratings;
}

export async function loadContext(name, root) {
  if (name !== "source") return undefined;
  const path = join(root, LEDGER_PATH);
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  const document = JSON.parse(raw);
  return {
    duplicates: duplicateSources(document),
    possibleDuplicates: possibleDuplicateSources(document),
    ratings: ledgerRatings(root, raw),
  };
}
