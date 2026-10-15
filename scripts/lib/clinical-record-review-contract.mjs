import { createHash } from "node:crypto";

import { publicReviewerAttributionProblem } from "./therapy-review-contract.mjs";
import { INDIGENOUS_CONTENT_RULE, indigenousContentTerm } from "./indigenous-content.mjs";
import { signOffKindModules } from "./signoff-kinds/index.mjs";

/**
 * The contract behind `npm run clinical:review`: how the clinical owner attests one
 * clinical record, and how a later edit to that record is caught.
 *
 * Three kinds of record carry a clinician sign-off:
 *
 *   form       data/forms-content-review.json  (one row per WA MHA 2014 form)
 *   section    data/mha-2014-sections.json     (one plain-English Act-section summary)
 *   timeframe  data/mha-timeframes.json        (one quoted statutory duration; the file
 *                                               arrives with the MHA timeline work, and
 *                                               every caller treats it as optional)
 *
 * A sign-off is four fields: `status: "reviewed"`, `reviewedBy`, `reviewedAt` and
 * `reviewedContentSha256`. The last is the pin. It is a SHA-256 over the canonical JSON
 * of exactly the content the owner attested, so an edit to that content after sign-off
 * makes `reviewProblems` report "content changed since sign-off" and the `--check` gates
 * turn red, forcing re-review rather than letting a sign-off vouch for text nobody signed.
 *
 * What the pin covers, per kind:
 *
 *   form       the review row (code, sections, contextualSections, basis, and any other
 *              non-review field) PLUS the form's operational guidance in
 *              data/forms-catalog.json -- the fields in FORM_ATTESTED_CATALOG_FIELDS, and
 *              from `sourceFacts` only `timings` and `sectionCue`. That includes
 *              `indexedClock`, which the app's Clock card shows when priorityFacts lacks a
 *              detail line. It also covers `renderedFormGuidance(entry)`: the text the app
 *              actually shows, including its generic fallback sentences for empty fields
 *              and the three Priority-facts cards. Search-index metadata (aliases, searchTerms, indexedTerms,
 *              riskLevel, ids) and PDF
 *              file metadata are deliberately outside it: the owner does not attest them,
 *              and pinning them would force a clinical re-review for a search tweak. The
 *              catalogue's `actSections` summaries are attested separately as `section`.
 *   section    every non-review field of the entry: section, title, summary and
 *              sourceTextSha256 (so re-pointing an attested summary at amended Act text
 *              without rewriting it also breaks the pin).
 *   timeframe  every non-review field of the entry: id, formCodes, trigger, section,
 *              quote, duration and anchor.
 *
 * Four more kinds keep their review state in the record's own native fields, so the app
 * reads a sign-off with no second file to consult. The tool works on a flat *view* of each
 * record (`view`), and writes a sign-off back into the native shape (`unview`):
 *
 *   formulation-guide      src/data/formulation-concepts.json  `guides`, review in `review`
 *   formulation-mechanism  src/data/formulation-content.json   `mechanisms`, `reviewStatus`
 *   formulation-concept    src/data/formulation-concepts.json  `concepts`, review in `review`
 *   differential           data/differential-curated-review.json, one row per locally
 *                          authored overlay in src/lib/differential-curated.ts
 *
 *   specifier              data/specifiers-content.json, every item with a written
 *                          definition plus the universal specifiers; review in `review`
 *   dictionary-rewrite     src/data/dictionary-definition-reviews.json, the reviews that
 *                          propose new wording; approval in `clinicalApproval`
 *
 *   specifier      the item's label and definition (or the universal's title and
 *                  description) with the category, disorder, ICD-11 context and group it
 *                  sits in, and its source status and source family.
 *   dictionary-rewrite  the entry, the current wording and its hash, the proposed wording,
 *                  the verdict, rationale and citation. Approving it does not change the
 *                  live dictionary; applying approved wording is a separate step.
 *   formulation-*  every field of the record except its review state. `searchTerms` is
 *                  included: guide search terms reach the public site-content body. A
 *                  mechanism also pins the `sourceLibrary` entries its `sources` ids
 *                  resolve to, because the page renders their titles and links.
 *   differential   the review row's slug PLUS the whole authored overlay entry for that
 *                  slug, read from src/lib/differential-curated.ts.
 *
 * The runtime rule is unchanged: `formContentReviewStatus` in src/lib/form-catalog.ts
 * still needs status + reviewedBy + reviewedAt. The pin is enforced by the offline
 * `--check` scripts and the unit suite, never at render time.
 */

/**
 * The therapy attribution rule, plus a guard for this tool's own documentation: the how-to
 * guide shows `--reviewed-by "<your name>"`, so a copied-but-unedited placeholder must never
 * become a sign-off.
 */
export function reviewerAttributionProblem(value) {
  const problem = publicReviewerAttributionProblem(value);
  if (problem) return problem;
  const words = (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
  if (
    /[<>[\]{}]/.test(value) ||
    /\byour\s+(?:own\s+)?(?:sur)?name\b/i.test(value) ||
    EXAMPLE_REVIEWER_NAMES.has(words)
  ) {
    return "reviewedBy still holds the example from the guide; replace it with your own public name.";
  }
  return null;
}

/** Example names that have appeared in this tool's guide, help text or tests: never a sign-off. */
const EXAMPLE_REVIEWER_NAMES = new Set([
  "dr j smith",
  "j smith",
  "dr jane citizen",
  "jane citizen",
  "dr john smith",
  "john smith",
  "dr your surname",
]);

/** Review metadata. Everything else in a record is content, and content is pinned. */
export const REVIEW_METADATA_KEYS = Object.freeze(["status", "reviewedBy", "reviewedAt", "reviewedContentSha256"]);
const ATTESTATION_KEYS = Object.freeze(["reviewedBy", "reviewedAt", "reviewedContentSha256"]);

/** Highest consequence first: the clocks where a wrong reading changes lawful detention. */
export const RECOMMENDED_FORM_ORDER = Object.freeze(["3C", "10B", "10E", "11B", "11E", "6C"]);

/** Operational guidance in data/forms-catalog.json that a form sign-off attests. */
export const FORM_ATTESTED_CATALOG_FIELDS = Object.freeze([
  "name",
  "purpose",
  "maker",
  "involved",
  "threshold",
  "clock",
  "destination",
  "authorises",
  "doesNotAuthorise",
  "boundaries",
  "before",
  "parallel",
  "after",
  "copies",
  "documentationStem",
  "traps",
  "safetyPearl",
  "legalNote",
  "practicePearls",
  "preUseChecks",
  "priorityFacts",
  // The app's Clock card falls back to `indexedClock` for its detail line when a form has no
  // curated priorityFacts.clock.detail (3A, 4A and 7A among others), so it is shown text.
  "indexedClock",
  "sourceFacts",
]);
const FORM_ATTESTED_SOURCE_FACTS = Object.freeze(["timings", "sectionCue"]);

/**
 * The three questions every sign-off asks, for every kind, one record at a time (owner-approved
 * wording). Any answer other than yes leaves the record unsigned.
 */
export const SIGN_OFF_QUESTIONS = Object.freeze([
  Object.freeze({
    key: "wordingMatchesSource",
    label: "Wording",
    question: "The wording matches its source.",
  }),
  Object.freeze({
    key: "clinicalMeaningCorrect",
    label: "Clinical meaning",
    question: "The clinical meaning is correct.",
  }),
  Object.freeze({
    key: "safeToShowAsReviewed",
    label: "Safe to show",
    question: "It is safe to show this as reviewed.",
  }),
]);

const UTC_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SHA256 = /^[a-f0-9]{64}$/;

function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Keep the review tool aligned with the site's specifier gate. Product or role
// attributions (for example, "PsychSift") are not clinician sign-offs.
function isNamedSpecifierReviewer(value) {
  if (typeof value !== "string") return false;
  const words = value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter((word) => /\p{L}/u.test(word));
  const titles = new Set(["dr", "dr.", "prof", "prof.", "professor", "a/prof", "mr", "ms", "mrs", "mx"]);
  const nameWords = words.filter((word) => !titles.has(word.toLowerCase()));
  return nameWords.length >= 2 && !nameWords.some((word) => /^(?:psychsift|system|pending|placeholder)$/i.test(word));
}

function isSpecifierClinicianReviewed(review) {
  return (
    review?.clinicianReviewStatus === "clinician-reviewed" &&
    isNamedSpecifierReviewer(review?.reviewedBy) &&
    typeof review?.reviewedAt === "string" &&
    UTC_ISO_TIMESTAMP.test(review.reviewedAt) &&
    Number.isFinite(Date.parse(review.reviewedAt))
  );
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

function pick(source, keys) {
  if (!isPlainRecord(source)) return source;
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

/**
 * The same UTC timestamp rule `npm run therapy:review` enforces (its helper is not
 * exported, and the therapy contract is not ours to change): a real UTC ISO instant,
 * never date-only, never an offset, never in the future.
 */
function utcTimestampProblem(value, now) {
  if (typeof value !== "string" || !UTC_ISO_TIMESTAMP.test(value)) {
    return "reviewedAt must be a UTC ISO timestamp (YYYY-MM-DDTHH:mm:ss[.sss]Z).";
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return "reviewedAt must be a real UTC calendar timestamp.";
  const normalized = value.includes(".") ? value : value.replace(/Z$/, ".000Z");
  if (new Date(milliseconds).toISOString() !== normalized) return "reviewedAt must be a real UTC calendar timestamp.";
  if (milliseconds > now.getTime()) return "reviewedAt must not be in the future.";
  return null;
}

/** A content-only digest: any change to a non-review field changes it. */
export function reviewedContentSha256(record) {
  if (!isPlainRecord(record)) throw new TypeError("Reviewed content must be an object.");
  const content = Object.fromEntries(Object.entries(record).filter(([key]) => !REVIEW_METADATA_KEYS.includes(key)));
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(content)))
    .digest("hex");
}

const displayText = (value) => (typeof value === "string" && value.trim() ? value.trim() : "");

function curatedCard(value) {
  if (!isPlainRecord(value)) return undefined;
  const title = displayText(value.title);
  if (!title) return undefined;
  return { title, detail: displayText(value.detail) || undefined, body: displayText(value.body) || undefined };
}

function cardSheet(fact, fallbackBody, fallbackDetail, label) {
  if (!fact && !fallbackBody.trim()) return null;
  const body = fact?.body?.trim() || fallbackBody.trim();
  if (!body) return null;
  return { title: fact?.title?.trim() || label, detail: fact?.detail?.trim() || fallbackDetail, body };
}

/**
 * The three Priority-facts cards exactly as the Forms page renders them: the card face
 * (`summaryCardsForDetails` in src/lib/form-catalog.ts) and the tap-for-detail sheet
 * (`priorityFactBody` in src/components/forms/form-priority-facts-section.tsx), including
 * their fallbacks to the catalogue prose and to `indexedClock`. Replicated here because
 * this plain-Node tool cannot import the app's TypeScript; the contract test compares it
 * with the app's own output for every form, so the two cannot drift apart silently.
 */
export function renderedPriorityCards(entry) {
  const facts = isPlainRecord(entry?.priorityFacts) ? entry.priorityFacts : {};
  const clock = curatedCard(facts.clock);
  const authority = curatedCard(facts.authority);
  const criteria = curatedCard(facts.criteria);
  // The cards read the app's resolved fields, fallback sentences included.
  const resolved = renderedGuidanceFields(entry);
  const field = (key) => (key === "indexedClock" ? displayText(entry?.[key]) : resolved[key]);
  const indexedClock = field("indexedClock") || undefined;
  return {
    clock: {
      title: clock?.title ?? field("clock"),
      detail: clock?.detail ?? indexedClock,
      sheet: cardSheet(clock, field("clock"), indexedClock, "Clock / review"),
    },
    authority: {
      title: authority?.title ?? field("maker"),
      detail: authority?.detail ?? field("authorises"),
      sheet: cardSheet(
        authority,
        [field("maker"), field("authorises"), field("doesNotAuthorise")].filter(Boolean).join(" "),
        field("authorises"),
        "Made by / authority",
      ),
    },
    criteria: {
      title: criteria?.title ?? field("threshold"),
      detail: criteria?.detail ?? field("doesNotAuthorise"),
      sheet: cardSheet(criteria, field("threshold"), field("doesNotAuthorise"), "Criteria / threshold"),
    },
  };
}

const displayList = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim().length > 0) : [];

/**
 * The form guidance exactly as the Forms page shows it: `detailsFor` in
 * src/lib/form-catalog.ts, including its generic fallback sentences for empty catalogue
 * fields (seven forms currently show fallback text for authorises, doesNotAuthorise,
 * legalNote, practicePearls or copies) and the three Priority-facts cards. Replicated for
 * the same reason as `renderedPriorityCards`, and parity-tested against the app for all 54
 * forms. The purpose fallback assumes a downloadable form, since the register's
 * availability is not in the catalogue; the parity test catches it if that ever matters.
 */
export function renderedFormGuidance(entry) {
  return { ...renderedGuidanceFields(entry), priorityCards: renderedPriorityCards(entry) };
}

function renderedGuidanceFields(entry) {
  const code = String(entry?.form ?? "");
  const field = (key, fallback = "") => displayText(entry?.[key]) || fallback;
  const list = (key, fallback = []) => (displayList(entry?.[key]).length ? displayList(entry?.[key]) : fallback);
  return {
    purpose: field(
      "purpose",
      `Use the current approved Form ${code} to record ${String(entry?.name ?? "").toLowerCase()} when the statutory and local requirements are met.`,
    ),
    maker: field(
      "maker",
      "Only an appropriately authorised person under the Mental Health Act 2014 and the approved form instructions.",
    ),
    involved: field(
      "involved",
      "Confirm the required recipients, support persons, records and local PSOLIS workflow on the current approved form.",
    ),
    threshold: field(
      "threshold",
      "Confirm the statutory criteria and completion instructions on the current approved form before use.",
    ),
    clock: field(
      "clock",
      "Confirm any time limit, expiry or review point on the current approved form and local policy.",
    ),
    destination: field("destination", "Confirm any required place or destination on the approved form."),
    authorises: field(
      "authorises",
      `Only the action or record expressly described by Form ${code} and the Mental Health Act 2014.`,
    ),
    doesNotAuthorise: field(
      "doesNotAuthorise",
      "No action beyond the current Act, approved form wording and the maker\u2019s lawful authority.",
    ),
    boundaries: list("boundaries"),
    before: list("before"),
    parallel: list("parallel"),
    after: list("after"),
    copies: field("copies", "Confirm notices, copies, handover and filing requirements on the approved form."),
    documentationStem: field("documentationStem"),
    traps: list("traps"),
    safetyPearl: field(
      "safetyPearl",
      "Open the current official source and confirm authority, timing, notices and filing requirements before completion.",
    ),
    sourceNote: field(
      "sourceNote",
      "Official title and availability checked against the Office of the Chief Psychiatrist register.",
    ),
    legalNote: field(
      "legalNote",
      "Use only the current approved form or PSOLIS pathway. This catalogue is a reference aid, not legal advice, and does not replace the Act, form instructions or local governance.",
    ),
    practicePearls: list("practicePearls", ["Treat the approved form and current legislation as authoritative."]),
    preUseChecks: list("preUseChecks", [
      "Open the current official form or PSOLIS workflow before use.",
      "Confirm the maker is appropriately authorised and all statutory criteria are met.",
      "Confirm identifiers, date, time, signatures, notices, copies and filing requirements.",
    ]),
  };
}

function catalogForms(catalog) {
  if (Array.isArray(catalog)) return catalog;
  if (isPlainRecord(catalog) && Array.isArray(catalog.forms)) return catalog.forms;
  throw new TypeError("A form sign-off needs the forms catalogue (data/forms-catalog.json).");
}

const withoutMetadata = (record) =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !REVIEW_METADATA_KEYS.includes(key)));

/**
 * The `sourceLibrary` entries a mechanism's `sources` ids resolve to. The mechanism page
 * renders their titles and links, so a library edit must break the mechanism's pin too.
 * An id the library does not hold is pinned as null, which is what the page shows: nothing.
 */
function resolvedMechanismSources(record, context) {
  const library = context?.sourceLibrary;
  if (!isPlainRecord(library)) {
    throw new TypeError(
      "A mechanism sign-off needs the Formulation sourceLibrary (src/data/formulation-content.json).",
    );
  }
  const ids = Array.isArray(record.sources) ? record.sources : [];
  return ids.map((id) => (isPlainRecord(library[id]) ? library[id] : null));
}

/** The native pending value becomes `drafted`; anything unrecognised stays as-is and fails validation. */
const nativeStatusToView = (status) => (status === "clinical_review_required" ? "drafted" : status);

function assertNoViewCollision(native, reserved, label) {
  for (const key of REVIEW_METADATA_KEYS) {
    if (!reserved.includes(key) && Object.hasOwn(native, key)) {
      throw new Error(`${label} ${native?.id ?? ""} already has a "${key}" field; the sign-off view would hide it.`);
    }
  }
}

/** Concepts and guide modules: the review lives in a nested `review` object. */
function formulationRecordView(native) {
  if (!isPlainRecord(native)) return native;
  assertNoViewCollision(native, [], "Formulation record");
  const { review, ...content } = native;
  const nested = isPlainRecord(review) ? review : {};
  return {
    ...content,
    status: nativeStatusToView(nested.status),
    reviewedBy: nested.reviewer ?? null,
    reviewedAt: nested.reviewedAt ?? null,
    reviewedContentSha256: nested.reviewedContentSha256 ?? null,
  };
}

function formulationRecordUnview(view, native) {
  return {
    ...native,
    review: {
      ...(isPlainRecord(native.review) ? native.review : {}),
      status: view.status,
      reviewer: view.reviewedBy,
      reviewedAt: view.reviewedAt,
      reviewedContentSha256: view.reviewedContentSha256,
    },
  };
}

/** Mechanisms: `reviewStatus` is the native status; the attestation sits beside it. */
function formulationMechanismView(native) {
  if (!isPlainRecord(native)) return native;
  assertNoViewCollision(native, ["reviewedBy", "reviewedAt", "reviewedContentSha256"], "Formulation mechanism");
  const { reviewStatus, reviewedBy, reviewedAt, reviewedContentSha256, ...content } = native;
  return {
    ...content,
    status: nativeStatusToView(reviewStatus),
    reviewedBy: reviewedBy ?? null,
    reviewedAt: reviewedAt ?? null,
    reviewedContentSha256: reviewedContentSha256 ?? null,
  };
}

function formulationMechanismUnview(view, native) {
  return {
    ...native,
    reviewStatus: view.status,
    reviewedBy: view.reviewedBy,
    reviewedAt: view.reviewedAt,
    reviewedContentSha256: view.reviewedContentSha256,
  };
}

function curatedOverlay(context, slug) {
  const curated = context?.curated;
  if (!isPlainRecord(curated)) {
    throw new TypeError("A differential sign-off needs the authored overlays (src/lib/differential-curated.ts).");
  }
  const entry = curated[slug];
  if (!isPlainRecord(entry))
    throw new Error(`Differential ${slug} has no authored overlay in src/lib/differential-curated.ts.`);
  return entry;
}

// The four kinds below are marked optional only so the report can run against a partial
// checkout or a test fixture; tests/clinical-signoff-kinds.test.ts requires every real file.

/** Every specifier record, flattened, with the context a reader sees it in. */
function specifierRecords(document) {
  const views = [];
  for (const universal of document?.universalSpecifiers ?? []) {
    views.push(specifierView(universal, { kind: "universal" }));
  }
  for (const category of document?.categories ?? []) {
    for (const disorder of category.disorders ?? []) {
      for (const group of disorder.groups ?? []) {
        for (const item of group.items ?? []) {
          views.push(
            specifierView(item, {
              kind: "item",
              categoryName: category.name,
              disorderName: disorder.name,
              icd11Context: disorder.icd11Context,
              groupLabel: group.label,
            }),
          );
        }
      }
    }
  }
  return views;
}

/**
 * Only records with real text can be signed: an item whose definition is still the
 * "pending clinician verification" placeholder, or needs none, reads as `pending`.
 */
function specifierView(native, placement) {
  const review = isPlainRecord(native.review) ? native.review : {};
  const signable = placement.kind === "universal" || native.definitionStatus === "defined";
  const unnamedStamp = review.clinicianReviewStatus === "clinician-reviewed" && !isSpecifierClinicianReviewed(review);
  const status =
    review.clinicianReviewStatus === "clinician-reviewed"
      ? unnamedStamp
        ? signable
          ? "drafted"
          : "pending"
        : "reviewed"
      : review.clinicianReviewStatus === "clinician-review-pending"
        ? signable
          ? "drafted"
          : "pending"
        : review.clinicianReviewStatus;
  const content =
    placement.kind === "universal"
      ? { title: native.title, description: native.description }
      : { label: native.label, definition: native.definition ?? null, definitionStatus: native.definitionStatus };
  return {
    id: review.rowKey,
    ...placement,
    ...content,
    sourceVerificationStatus: review.sourceVerificationStatus ?? null,
    sourceFamily: review.sourceFamily ?? null,
    status,
    // An unnamed stamp is not an attestation: the view shows none, and a real sign-off overwrites it.
    reviewedBy: unnamedStamp ? null : (review.reviewedBy ?? null),
    reviewedAt: unnamedStamp ? null : (review.reviewedAt ?? null),
    reviewedContentSha256: unnamedStamp ? null : (review.reviewedContentSha256 ?? null),
  };
}

function signSpecifierReview(review, view) {
  return {
    ...review,
    clinicianReviewStatus: "clinician-reviewed",
    reviewedBy: view.reviewedBy,
    reviewedAt: view.reviewedAt,
    reviewedContentSha256: view.reviewedContentSha256,
  };
}

function writeSpecifierReview(document, view) {
  let found = 0;
  const sign = (native) => {
    if (native?.review?.rowKey !== view.id) return native;
    found += 1;
    return { ...native, review: signSpecifierReview(native.review, view) };
  };
  const categories = (document.categories ?? []).map((category) => ({
    ...category,
    disorders: (category.disorders ?? []).map((disorder) => ({
      ...disorder,
      groups: (disorder.groups ?? []).map((group) => ({ ...group, items: (group.items ?? []).map(sign) })),
    })),
  }));
  const universalSpecifiers = (document.universalSpecifiers ?? []).map(sign);
  if (found !== 1) throw new Error(`Specifier ${view.id} matched ${found} records in data/specifiers-content.json.`);
  const items = categories.flatMap((category) =>
    category.disorders.flatMap((disorder) => disorder.groups.flatMap((group) => group.items)),
  );
  const pending = items.filter((item) => !isSpecifierClinicianReviewed(item?.review)).length;
  const stats = isPlainRecord(document.stats)
    ? { ...document.stats, itemsPendingClinicianReview: pending }
    : document.stats;
  return { ...document, stats, universalSpecifiers, categories };
}

/** A definition review proposing new wording can be approved; one without a proposal cannot. */
function dictionaryRewriteView(native) {
  if (!isPlainRecord(native)) return native;
  // The handover's own `reviewer` slot stays as imported; the approval lives in clinicalApproval.
  const { clinicalApproval, ...rest } = native;
  const approval = isPlainRecord(clinicalApproval) ? clinicalApproval : {};
  const status = !native.proposedWording
    ? "pending"
    : approval.status === "approved"
      ? "reviewed"
      : approval.status === undefined
        ? "drafted"
        : approval.status;
  return {
    ...rest,
    status,
    reviewedBy: approval.reviewer ?? null,
    reviewedAt: approval.reviewedAt ?? null,
    reviewedContentSha256: approval.reviewedContentSha256 ?? null,
  };
}

function dictionaryRewriteUnview(view, native) {
  return {
    ...native,
    clinicalApproval: {
      status: "approved",
      reviewer: view.reviewedBy,
      reviewedAt: view.reviewedAt,
      reviewedContentSha256: view.reviewedContentSha256,
    },
  };
}

const DICTIONARY_REWRITE_ATTESTED = Object.freeze([
  "id",
  "entrySlug",
  "title",
  "category",
  "verdict",
  "baselineWording",
  "baselineWordingSha256",
  "proposedWording",
  "disposition",
  "rationale",
  "legacyCitation",
]);

const FORMULATION_RECORD_KIND = {
  path: "src/data/formulation-concepts.json",
  optional: true,
  idField: "id",
  statuses: Object.freeze(["drafted", "reviewed"]),
  checklist: SIGN_OFF_QUESTIONS,
  view: formulationRecordView,
  unview: formulationRecordUnview,
  attested: (record) => withoutMetadata(record),
};

export const recordKinds = Object.freeze({
  form: Object.freeze({
    kind: "form",
    noun: "Form",
    heading: "Forms",
    path: "data/forms-content-review.json",
    collectionKey: "forms",
    idField: "code",
    statuses: Object.freeze(["drafted", "reviewed"]),
    checklist: SIGN_OFF_QUESTIONS,
    attested(record, context) {
      const code = normalizeCode(record.code);
      const entry = catalogForms(context?.catalog).find((form) => normalizeCode(form?.form) === code);
      if (!entry) throw new Error(`Form ${record.code} has no entry in data/forms-catalog.json.`);
      const catalog = pick(entry, FORM_ATTESTED_CATALOG_FIELDS);
      if (isPlainRecord(catalog.sourceFacts))
        catalog.sourceFacts = pick(catalog.sourceFacts, FORM_ATTESTED_SOURCE_FACTS);
      // Both the raw catalogue fields and the text the app actually renders from them,
      // including its fallback sentences, so neither can change under a sign-off.
      return { ...withoutMetadata(record), catalog, rendered: renderedFormGuidance(entry) };
    },
  }),
  section: Object.freeze({
    kind: "section",
    noun: "Section",
    heading: "Act sections",
    path: "data/mha-2014-sections.json",
    collectionKey: "sections",
    idField: "section",
    statuses: Object.freeze(["pending", "drafted", "reviewed"]),
    checklist: SIGN_OFF_QUESTIONS,
    attested: (record) => withoutMetadata(record),
  }),
  timeframe: Object.freeze({
    kind: "timeframe",
    noun: "Timeframe",
    heading: "Timeframes",
    path: "data/mha-timeframes.json",
    collectionKey: "entries",
    idField: "id",
    optional: true,
    statuses: Object.freeze(["drafted", "reviewed"]),
    checklist: SIGN_OFF_QUESTIONS,
    attested: (record) => withoutMetadata(record),
  }),
  differential: Object.freeze({
    kind: "differential",
    noun: "Differential",
    heading: "Differentials (locally authored overlays)",
    path: "data/differential-curated-review.json",
    collectionKey: "entries",
    optional: true,
    idField: "slug",
    statuses: Object.freeze(["drafted", "reviewed"]),
    checklist: SIGN_OFF_QUESTIONS,
    attested: (record, context) => ({ ...withoutMetadata(record), curated: curatedOverlay(context, record.slug) }),
  }),
  "formulation-guide": Object.freeze({
    ...FORMULATION_RECORD_KIND,
    kind: "formulation-guide",
    noun: "Guide",
    heading: "Formulation guide modules",
    collectionKey: "guides",
  }),
  "formulation-mechanism": Object.freeze({
    kind: "formulation-mechanism",
    noun: "Mechanism",
    heading: "Formulation mechanisms",
    path: "src/data/formulation-content.json",
    collectionKey: "mechanisms",
    optional: true,
    idField: "id",
    statuses: Object.freeze(["drafted", "reviewed"]),
    checklist: SIGN_OFF_QUESTIONS,
    view: formulationMechanismView,
    unview: formulationMechanismUnview,
    attested: (record, context) => ({
      ...withoutMetadata(record),
      resolvedSources: resolvedMechanismSources(record, context),
    }),
  }),
  "formulation-concept": Object.freeze({
    ...FORMULATION_RECORD_KIND,
    kind: "formulation-concept",
    noun: "Concept",
    heading: "Formulation concepts",
    collectionKey: "concepts",
  }),
  specifier: Object.freeze({
    kind: "specifier",
    noun: "Specifier",
    heading: "Specifiers (with written definitions)",
    path: "data/specifiers-content.json",
    collectionKey: "categories",
    idField: "id",
    optional: true,
    statuses: Object.freeze(["pending", "drafted", "reviewed"]),
    checklist: SIGN_OFF_QUESTIONS,
    records: specifierRecords,
    write: writeSpecifierReview,
    attested: (record) => withoutMetadata(record),
  }),
  "dictionary-rewrite": Object.freeze({
    kind: "dictionary-rewrite",
    noun: "Rewrite",
    heading: "Dictionary definition rewrites",
    path: "src/data/dictionary-definition-reviews.json",
    collectionKey: "reviews",
    idField: "id",
    optional: true,
    statuses: Object.freeze(["pending", "drafted", "reviewed"]),
    checklist: SIGN_OFF_QUESTIONS,
    view: dictionaryRewriteView,
    unview: dictionaryRewriteUnview,
    attested: (record) => pick(record, DICTIONARY_REWRITE_ATTESTED),
  }),
  // Kinds defined in ./signoff-kinds/*.mjs, with the standard questions unless they set their own.
  ...Object.fromEntries(
    signOffKindModules.flatMap((kindModule) =>
      Object.entries(kindModule.kinds).map(([name, kind]) => [
        name,
        Object.freeze({ checklist: SIGN_OFF_QUESTIONS, ...kind, kind: name }),
      ]),
    ),
  ),
});

function resolveKind(kind) {
  const resolved = typeof kind === "string" ? recordKinds[kind] : kind;
  if (!resolved || !recordKinds[resolved.kind]) {
    throw new Error(`Unknown record kind: ${String(kind)}. Use one of: ${Object.keys(recordKinds).join(", ")}.`);
  }
  return resolved;
}

export const recordId = (record, kind) => String(record?.[resolveKind(kind).idField] ?? "").trim();
export const sameRecordId = (left, right) => normalizeCode(left) === normalizeCode(right);

/**
 * The records inside a kind's data file, as the flat view every other function here
 * works on. Timeframes may be a bare array or `{ entries }`. Kinds with native review
 * fields (Formulation) are translated by their `view`.
 */
export function collectionOf(kind, document) {
  const resolved = resolveKind(kind);
  if (resolved.records) return resolved.records(document);
  const records = Array.isArray(document) ? document : document?.[resolved.collectionKey];
  if (!Array.isArray(records)) {
    throw new Error(`${resolved.path} must hold a "${resolved.collectionKey}" array.`);
  }
  return resolved.view ? records.map(resolved.view) : records;
}

/** Exactly what a sign-off of this record attests (and therefore what the pin covers). */
export function attestedContent(record, kind, context = {}) {
  if (!isPlainRecord(record)) throw new TypeError("A clinical record must be an object.");
  return resolveKind(kind).attested(record, context);
}

export function recordContentSha256(record, kind, context = {}) {
  return reviewedContentSha256(attestedContent(record, kind, context));
}

/** `unsigned` (not reviewed, or no pin), `current`, or `stale` (edited since sign-off). */
export function recordPinState(record, kind, context = {}) {
  if (record?.status !== "reviewed" || typeof record.reviewedContentSha256 !== "string") return "unsigned";
  try {
    return recordContentSha256(record, kind, context) === record.reviewedContentSha256 ? "current" : "stale";
  } catch {
    return "stale";
  }
}

/**
 * Every sign-off problem in one kind's records, without mutating them.
 *
 * @param {unknown} records
 * @param {string | object} kind
 * @param {{ now?: Date, catalog?: unknown, [key: string]: unknown }} [options]
 * @returns {string[]}
 */
export function reviewProblems(records, kind, { now = new Date(), ...context } = {}) {
  const resolved = resolveKind(kind);
  if (!Array.isArray(records)) return [`${resolved.path}: ${resolved.collectionKey} must be an array.`];
  const problems = [];
  const seen = new Set();

  for (const [index, record] of records.entries()) {
    if (!isPlainRecord(record)) {
      problems.push(`${resolved.noun} record[${index}] must be an object.`);
      continue;
    }
    const id = recordId(record, resolved);
    const label = `${resolved.noun} ${id || `record[${index}]`}`;
    if (!id) problems.push(`${label}: ${resolved.idField} must be a non-empty string.`);
    else if (seen.has(normalizeCode(id))) problems.push(`${label}: appears more than once.`);
    seen.add(normalizeCode(id));

    if (!resolved.statuses.includes(record.status)) {
      problems.push(`${label}: status must be one of ${resolved.statuses.join(", ")}.`);
      continue;
    }
    if (record.status !== "reviewed") {
      for (const key of ATTESTATION_KEYS) {
        if (record[key] !== undefined && record[key] !== null) {
          problems.push(
            `${label}: ${record.status} requires ${key} to be null or absent; a partial attestation is not a sign-off.`,
          );
        }
      }
      continue;
    }

    const indigenous = indigenousContentIn(record, resolved, context);
    if (indigenous) {
      problems.push(
        `${label}: signed off, but contains Indigenous content ("${indigenous}"); ${INDIGENOUS_CONTENT_RULE}. Return it to drafted.`,
      );
    }
    const attributionProblem = reviewerAttributionProblem(record.reviewedBy);
    if (attributionProblem) problems.push(`${label}: ${attributionProblem}`);
    const timestampProblem = utcTimestampProblem(record.reviewedAt, now);
    if (timestampProblem) problems.push(`${label}: ${timestampProblem}`);

    if (typeof record.reviewedContentSha256 !== "string" || !SHA256.test(record.reviewedContentSha256)) {
      problems.push(
        `${label}: reviewed requires a lowercase reviewedContentSha256, the content pin written by npm run clinical:review.`,
      );
      continue;
    }
    let expected;
    try {
      expected = recordContentSha256(record, resolved, context);
    } catch (error) {
      problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (expected !== record.reviewedContentSha256) {
      problems.push(
        `${label}: content changed since sign-off. The attested text was edited after it was signed; ` +
          `re-review it with npm run clinical:review.`,
      );
    }
  }
  return problems;
}

/**
 * The Indigenous term in what a sign-off of this record would attest, or null. Such a record
 * is never offered, never signable and, if found signed, reported as a problem.
 */
export function indigenousContentIn(record, kind, context = {}) {
  let content;
  try {
    content = attestedContent(record, kind, context);
  } catch {
    content = record;
  }
  return indigenousContentTerm(content);
}

/** A record may be signed when it is drafted, or when its earlier sign-off has gone stale. */
export function signOffEligibilityProblem(record, kind, context = {}) {
  const resolved = resolveKind(kind);
  const indigenous = indigenousContentIn(record, resolved, context);
  if (indigenous) {
    return `${resolved.noun} ${recordId(record, resolved)} contains Indigenous content ("${indigenous}"); ${INDIGENOUS_CONTENT_RULE}.`;
  }
  if (record?.status === "drafted") return null;
  if (record?.status === "reviewed" && recordPinState(record, resolved, context) === "stale") return null;
  if (record?.status === "reviewed") {
    return `${resolved.noun} ${recordId(record, resolved)} is already signed off and unchanged since; nothing to do.`;
  }
  return `Only a drafted ${resolved.noun.toLowerCase()} can be signed off; ${resolved.noun} ${recordId(record, resolved)} is ${String(record?.status)}.`;
}

/** The owner confirms one sign-off by typing that record's own code (for example 3C, or 26). */
export function clinicalReviewConfirmation(kind, record) {
  return recordId(record, kind);
}

/** Records still to sign, in walk order: drafted ones, plus signed ones edited since sign-off. */
export function signOffQueue(kind, records, context = {}) {
  const resolved = resolveKind(kind);
  const waiting = records.filter(
    (record) =>
      (record?.status === "drafted" ||
        (resolved.kind === "specifier" &&
          record?.status === "reviewed" &&
          !isNamedSpecifierReviewer(record?.reviewedBy)) ||
        (record?.status === "reviewed" && recordPinState(record, resolved, context) === "stale")) &&
      !indigenousContentIn(record, resolved, context),
  );
  if (resolved.kind !== "form") return waiting.map((record) => recordId(record, resolved));
  // Forms: the highest-consequence clocks first, then the rest in catalogue order.
  let catalogOrder = [];
  try {
    catalogOrder = catalogForms(context.catalog).map((entry) => normalizeCode(entry?.form));
  } catch {
    // Without a catalogue, fall back to the review file's own order.
  }
  const rank = (id) => {
    const recommended = RECOMMENDED_FORM_ORDER.findIndex((code) => sameRecordId(code, id));
    if (recommended !== -1) return recommended;
    const position = catalogOrder.indexOf(normalizeCode(id));
    return RECOMMENDED_FORM_ORDER.length + (position === -1 ? catalogOrder.length : position);
  };
  return waiting
    .map((record, index) => ({ id: recordId(record, resolved), index }))
    .sort((left, right) => rank(left.id) - rank(right.id) || left.index - right.index)
    .map(({ id }) => id);
}

/** Build the signed record in memory. Throws rather than return anything short of valid. */
export function finalizeClinicalReview(record, kind, { reviewedBy, reviewedAt, context = {}, now = new Date() }) {
  const resolved = resolveKind(kind);
  if (!isPlainRecord(record)) throw new TypeError("A clinical record must be an object.");
  const attributionProblem = reviewerAttributionProblem(reviewedBy);
  if (attributionProblem) throw new Error(attributionProblem);
  const timestampProblem = utcTimestampProblem(reviewedAt, now);
  if (timestampProblem) throw new Error(timestampProblem);
  const eligibility = signOffEligibilityProblem(record, resolved, context);
  if (eligibility) throw new Error(eligibility);

  const next = { ...record, status: "reviewed", reviewedBy: reviewedBy.trim(), reviewedAt };
  next.reviewedContentSha256 = recordContentSha256(next, resolved, context);
  const problems = reviewProblems([next], resolved, { ...context, now });
  if (problems.length > 0) throw new Error(`Sign-off would be invalid:\n- ${problems.join("\n- ")}`);
  return next;
}

/** Replace one record in its data file's document, keeping derived counts consistent. */
export function applyClinicalReview(document, kind, reviewed) {
  const resolved = resolveKind(kind);
  if (resolved.write) return resolved.write(document, reviewed);
  const records = Array.isArray(document) ? document : document?.[resolved.collectionKey];
  if (!Array.isArray(records)) throw new Error(`${resolved.path} must hold a "${resolved.collectionKey}" array.`);
  const id = recordId(reviewed, resolved);
  const index = records.findIndex((record) => sameRecordId(recordId(record, resolved), id));
  if (index === -1) throw new Error(`${resolved.noun} ${id} is not in ${resolved.path}.`);
  const written = resolved.unview ? resolved.unview(reviewed, records[index]) : reviewed;
  const nextRecords = records.map((record, position) => (position === index ? written : record));
  if (Array.isArray(document)) return nextRecords;

  const next = { ...document, [resolved.collectionKey]: nextRecords };
  if (resolved.kind === "section" && isPlainRecord(document.exportMetadata)) {
    const tally = (status) => nextRecords.filter((record) => record.status === status).length;
    next.exportMetadata = {
      ...document.exportMetadata,
      counts: {
        ...document.exportMetadata.counts,
        sections: nextRecords.length,
        reviewed: tally("reviewed"),
        drafted: tally("drafted"),
        pending: tally("pending"),
      },
    };
  }
  return next;
}
