import { createHash } from "node:crypto";

import { loadFormCatalogDetails } from "@/lib/form-catalog";
import { formPageHref } from "@/lib/form-register";
import formulationContent from "@/data/formulation-content.json";
import { curatedDifferentials } from "@/lib/differential-curated";
import differentialCuratedReview from "../../../data/differential-curated-review.json";
import formsContentReviewJson from "../../../data/forms-content-review.json";
import mhaSectionsJson from "../../../data/mha-2014-sections.json";
import mhaTimeframesJson from "../../../data/mha-timeframes.json";
import cpStandardsJson from "../../../data/chief-psychiatrist-standards.json";
import formsCulturalNotesJson from "../../../data/forms-cultural-notes.json";
import serviceRecordsReviewJson from "../../../data/service-records-review.json";
import todayRuleSignOffsJson from "@/lib/admin/today-rule-sign-offs.json";
import { loadDifferentialSnapshot } from "@/lib/differential-fixtures";
import { deriveGovernanceFromSnapshot } from "@/lib/differential-records";
import {
  dictionaryDefinitionReviews,
  isDefinitionReviewClinicallyApproved,
} from "@/lib/dictionary-editorial/definition-reviews";
import { dictionarySenseDrafts } from "@/lib/dictionary-editorial/sense-drafts";
import { isSpecifierClinicianReviewed, loadSpecifiersContent, specifierCatalogItems } from "@/lib/specifiers-content";
import { therapyNeedsReview, therapyRecords } from "@/lib/therapies";
import signableTherapySlugList from "@/data/therapy-signable-slugs.json";
import { isIndigenousContent, signedOffReviewer } from "@/lib/forms-reference-sign-off";
import {
  acquisitionAttestedContentSha256,
  acquisitionReviewQueue,
  sourceAcquisitionRecords,
} from "@/lib/sources/acquisition-ledger";
import {
  conceptReviewState,
  isFormulationSignedOffStatus,
  mechanismReviewState,
} from "@/lib/formulation-review-status";
import { formulationConcepts, formulationGuides } from "@/lib/formulation-concepts";
import { canonicalServiceRecords } from "@/lib/service-governance";

/**
 * Every clinical record in this repository that is waiting for a person to sign
 * it off, read from the files that already hold it.
 *
 * **This module unifies nothing.** Seven families use five unrelated review
 * vocabularies — `drafted`, `clinical_review_required`, `unverified`,
 * `pending`, `clinician-review-pending`, `needs_review`, `candidate` — and each
 * word means something specific in the governance document that defined it.
 * Collapsing them into one shared status type would be a refactor through
 * clinical code, and worse, it would make seven different review decisions look
 * like one. So every family keeps its own vocabulary untouched: `nativeStatus`
 * carries the source's own word verbatim, and `statusLabel` is a display string
 * produced at this boundary and nowhere else.
 *
 * **It is read-only.** Nothing here publishes, approves or unhides a record.
 * The dictionary layer in particular must stay unpublished — `publicationAllowed`
 * and `clinicalApproval` are read and never written, and
 * `assertNoDraftIsPublished` remains the gate that enforces it.
 *
 * **Counts are derived, never written down.** A hand-maintained total is the one
 * thing on a queue page that can quietly go stale; `tests/sign-off-queue.test.ts`
 * pins the per-family counts so the page cannot silently report zero.
 */
export type SignOffFamilyId =
  "wa-mha-forms" | "formulation" | "differentials" | "dictionary" | "specifiers" | "therapy" | "sources";

export type SignOffRow = {
  family: SignOffFamilyId;
  /**
   * Unique across the whole queue, and the only value safe to use as a React
   * key. The record ids are not: three differential presentation workflows
   * (`substance-intoxication`, `substance-withdrawal`, `depression`) share an id
   * with a diagnosis record of the same name, so keying a list on `id` would
   * silently render three fewer rows than the count above it claims.
   */
  key: string;
  /** The record's own id or slug, as its source file writes it. */
  id: string;
  title: string;
  /** The source vocabulary's own word for this record's state. Never normalised. */
  nativeStatus: string;
  /** A display label produced here, at the boundary, for this one row. */
  statusLabel: string;
  /** What a person has to do for this record to count as signed off. */
  requires: string;
  /** An in-app route that renders the record, or null when none exists. */
  href: string | null;
  /**
   * The local tool that signs this record off, or null when no tool can sign it
   * yet. This only names the command; the tool itself refuses to write unless a
   * person is typing at a real terminal, so nothing here can record a sign-off.
   */
  signOff: SignOffTool | null;
  /**
   * Position in the sign-off tool's own walk order, where that differs from the
   * order the rows are listed in. "Sign off today" follows it, so its sequence
   * agrees with the tool's `Next` line.
   */
  toolOrder?: number;
};

/**
 * The two local sign-off tools and the arguments that pick out one record.
 * `clinical:review` takes `--kind` plus `--code` (the record's own id field);
 * `therapy:review` takes `--slug`. Both are owner-only, interactive and
 * offline: see docs/clinical-sign-off-how-to.md.
 */
export type SignOffTool =
  { script: "clinical:review"; kind: string; code: string } | { script: "therapy:review"; slug: string };

export type SignOffFamily = {
  id: SignOffFamilyId;
  name: string;
  /** The file(s) the rows were read from, so a reader can go and open them. */
  source: string;
  /** The native field this family's status is read from, named exactly. */
  nativeField: string;
  /** What this family's own governance says about the state of these records. */
  note: string;
  /** True when no route in the app renders these records at all. */
  unrouted: boolean;
  rows: readonly SignOffRow[];
};

export type SignOffQueue = {
  families: readonly SignOffFamily[];
  /** Sum of every family's rows. Derived, so it cannot disagree with the list. */
  total: number;
};

/**
 * The tool for a record, or null when its content is Aboriginal, Torres Strait
 * Islander or other Indigenous content. Owner rule (2026-09-26): such content
 * needs Aboriginal governance review, not a clinician sign-off, and both sign-off
 * tools refuse it. The whole record is checked, keys included, with a pattern at
 * least as broad as the tools' own, so a false positive only withholds a command.
 */
function toolUnlessIndigenous(tool: SignOffTool, record: unknown): SignOffTool | null {
  return isIndigenousContent([JSON.stringify(record)]) ? null : tool;
}

/**
 * Therapy slugs `npm run therapy:review` will sign: the same rule as its
 * `therapyWalkQueue` — the record lists references to check against and has no
 * Indigenous content. Read from a small projection (`therapy-signable-slugs.json`)
 * rather than the 2.6 MB `therapies-source.json`, which would otherwise be traced
 * into the owner route's server bundle. `tests/sign-off-today.test.ts` fails if
 * the projection drifts from the source or from the tool's own walk queue.
 */
const signableTherapySlugs = new Set<string>(signableTherapySlugList.slugs);

type DifferentialReviewEntry = {
  slug: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewedContentSha256?: string;
};

const differentialReviewEntries = (differentialCuratedReview as { entries: DifferentialReviewEntry[] }).entries;

const REVIEW_METADATA_KEYS = ["status", "reviewedBy", "reviewedAt", "reviewedContentSha256"];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalize(record[key])]),
  );
}

function therapyContentSha256(record: Record<string, unknown>): string {
  const content = Object.fromEntries(
    Object.entries(record).filter(
      ([key]) => !["reviewStatus", "reviewChecklist", "reviewedBy", "reviewedAt", "reviewedContentSha256"].includes(key),
    ),
  );
  return createHash("sha256").update(JSON.stringify(canonicalize(content))).digest("hex");
}

/**
 * Mirrors `recordPinState`/`signOffQueue` in scripts/lib/clinical-record-review-contract.mjs
 * for the differential kind: an overlay waits when its review row is drafted, or
 * reviewed with a content pin that no longer matches the overlay as authored now
 * (an edit since sign-off). A test pins this to the tool for every overlay.
 */
export function differentialOverlayWaitsForSignOff(slug: string, overlay: unknown): boolean {
  const entry = differentialReviewEntries.find((row) => row.slug === slug);
  if (!entry) return false;
  if (entry.status === "drafted") return true;
  if (entry.status !== "reviewed") return false;
  if (typeof entry.reviewedContentSha256 !== "string") return false;
  const content = Object.fromEntries(Object.entries(entry).filter(([key]) => !REVIEW_METADATA_KEYS.includes(key)));
  const digest = createHash("sha256")
    .update(JSON.stringify(canonicalize({ ...content, curated: overlay })))
    .digest("hex");
  return digest !== entry.reviewedContentSha256;
}

/** The clinical:review tool's own walk position for a differential overlay (review-file order). */
function differentialToolOrder(slug: string): number {
  const index = differentialReviewEntries.findIndex((row) => row.slug === slug);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function formsFamily(): SignOffFamily {
  const rows = loadFormCatalogDetails()
    .filter((details) => details.contentReviewStatus !== "reviewed")
    .map<SignOffRow>((details) => ({
      family: "wa-mha-forms",
      key: `form:${details.id}`,
      id: details.id,
      title: `Form ${details.form} — ${details.name}`,
      // `contentReviewStatus` is optional on the catalogue type: a form absent
      // from the review register carries none. `form-catalog.ts` states the
      // default explicitly — a missing row is a gap in the record, not evidence
      // of review — so it falls to `drafted` here, which is also why the filter
      // above keeps such a form in the queue rather than dropping it.
      nativeStatus: details.contentReviewStatus ?? "drafted",
      statusLabel: "Drafted, no clinician sign-off",
      requires:
        "A named reviewer checks the operational guidance against the Act and the current approved form, then records sign-off via npm run clinical:review.",
      // `formPageHref`, never `/forms/${details.id}`. The catalogue id is
      // `form-<code>` unconditionally; the ROUTE slug is that only for the 50
      // forms without a legacy slug. Building the path from the id shipped four
      // dead links to statutory forms — 3A, 4A, 4B and 4C — each landing on
      // "not in your registry" instead of the Mental Health Act guidance.
      href: formPageHref(details.form),
      signOff: toolUnlessIndigenous({ script: "clinical:review", kind: "form", code: details.form }, details),
    }));
  return {
    id: "wa-mha-forms",
    name: "WA Mental Health Act forms",
    source: "data/forms-content-review.json",
    nativeField: "formContentReviewStatus(entry) — status + reviewedBy + reviewedAt",
    note: "Operational guidance drafted from the Act text and the approved form. Status alone is not a sign-off: all three fields have to be present, so a partial attestation falls back to drafted.",
    unrouted: false,
    rows,
  };
}

type FormulationMechanism = { id: string; name: string; reviewStatus: string };

/**
 * Formulation keeps its records in two files with two status fields: the 12
 * mechanisms carry `reviewStatus` in `formulation-content.json`, and the 46
 * contextual concepts and 6 guide modules carry `review.status` (plus a reviewer
 * slot) in `formulation-concepts.json`. Reading only the first file hid 52 of
 * the 64 unsigned records (ledger #33JDBW). Concepts and guides are filtered by
 * `conceptReviewState`, the same fail-closed decision their pages render, so the
 * queue and the badge cannot disagree about one record.
 */
function formulationFamily(): SignOffFamily {
  const mechanisms = (formulationContent as { mechanisms: FormulationMechanism[] }).mechanisms;
  const mechanismRows = mechanisms
    .filter((mechanism) => !isFormulationSignedOffStatus(mechanism.reviewStatus))
    .map<SignOffRow>((mechanism) => ({
      family: "formulation",
      key: `formulation:${mechanism.id}`,
      id: mechanism.id,
      title: mechanism.name,
      nativeStatus: mechanism.reviewStatus,
      statusLabel: "Clinical review required",
      requires:
        "A clinician confirms the mechanism description, its fit indicators and its treatment implications against the cited sources.",
      href: `/formulation/${mechanism.id}`,
      signOff: toolUnlessIndigenous(
        { script: "clinical:review", kind: "formulation-mechanism", code: mechanism.id },
        mechanism,
      ),
    }));
  const recordRows = [
    ...formulationConcepts.map((record) => ({ record, kind: "concept" as const })),
    ...formulationGuides.map((record) => ({ record, kind: "guide" as const })),
  ]
    .filter(({ record }) => !conceptReviewState(record).reviewed)
    .map<SignOffRow>(({ record, kind }) => ({
      family: "formulation",
      key: `formulation-${kind}:${record.id}`,
      id: record.id,
      title: record.title,
      nativeStatus: record.review.status,
      statusLabel: "Clinical review required",
      requires:
        kind === "guide"
          ? "A named clinician checks the guide module's instructions against the cited sources and records themselves as reviewer."
          : "A named clinician checks the concept's summary, qualifications and warnings against the cited sources and records themselves as reviewer.",
      // A held record 404s at /formulation/<id>, so it is listed unlinked.
      href: record.release === "published" ? `/formulation/${record.id}` : null,
      signOff: toolUnlessIndigenous(
        { script: "clinical:review", kind: `formulation-${kind}`, code: record.id },
        record,
      ),
    }));
  return {
    id: "formulation",
    name: "Formulation mechanisms, concepts and guides",
    source: "src/data/formulation-content.json, src/data/formulation-concepts.json",
    nativeField: "reviewStatus (mechanisms); review.status + review.reviewer (concepts and guide modules)",
    note: "Source metadata was reviewed; the clinical claims themselves are ungraded and carry no named confirmation. A concept or guide counts as signed off only with a named reviewer.",
    unrouted: false,
    rows: [...mechanismRows, ...recordRows],
  };
}

function differentialsFamily(): SignOffFamily {
  const snapshot = loadDifferentialSnapshot();
  const governance = deriveGovernanceFromSnapshot(snapshot);
  const authored = new Set(Object.keys(curatedDifferentials));

  const overlayWaits = (slug: string) =>
    authored.has(slug) &&
    differentialOverlayWaitsForSignOff(slug, curatedDifferentials[slug as keyof typeof curatedDifferentials]);

  const diagnoses = snapshot.diagnoses.map<SignOffRow>((record) => ({
    family: "differentials",
    key: `differential-diagnosis:${record.slug}`,
    id: record.slug,
    title: record.title,
    nativeStatus: `validation_status: ${governance.validation_status} (source_status: ${governance.source_status})`,
    statusLabel: !authored.has(record.slug)
      ? "Unverified"
      : overlayWaits(record.slug)
        ? "Unverified, with locally authored content"
        : "Unverified export; locally authored overlay signed off",
    requires: authored.has(record.slug)
      ? "A clinician verifies the exported record and, separately, the locally authored overlay in src/lib/differential-curated.ts that is shown on top of it."
      : "A clinician verifies the exported record against a named source before its validation_status can move off unverified.",
    href: `/differentials/diagnoses/${record.slug}`,
    // Only the locally authored overlay has a sign-off tool. The exported record
    // underneath has none, so a diagnosis with no overlay, or one whose overlay is
    // already signed, has nothing the owner can sign today.
    signOff: overlayWaits(record.slug)
      ? toolUnlessIndigenous({ script: "clinical:review", kind: "differential", code: record.slug }, [
          record,
          curatedDifferentials[record.slug as keyof typeof curatedDifferentials],
        ])
      : null,
    toolOrder: overlayWaits(record.slug) ? differentialToolOrder(record.slug) : undefined,
  }));

  const presentations = snapshot.presentations.map<SignOffRow>((workflow) => ({
    family: "differentials",
    key: `differential-presentation:${workflow.id}`,
    id: workflow.id,
    title: workflow.title,
    nativeStatus: `validation_status: ${governance.validation_status} (source_status: ${governance.source_status})`,
    statusLabel: "Unverified",
    requires:
      "A clinician verifies the presentation workflow's candidates and review checklist against a named source.",
    href: `/differentials/presentations/${workflow.id}`,
    signOff: null,
  }));

  return {
    id: "differentials",
    name: "Differentials",
    source: "data/differentials-snapshot.json, src/lib/differential-curated.ts",
    nativeField: "validation_status, via deriveGovernanceFromSnapshot",
    note: `The snapshot's own governance block reads "${snapshot.governance.reviewStatus}" (${snapshot.governance.version}), which derives unverified for every record in it. ${authored.size} of the diagnosis records also carry a locally authored overlay, which is a separate review.`,
    unrouted: false,
    rows: [...diagnoses, ...presentations],
  };
}

function dictionaryFamily(): SignOffFamily {
  const senses = dictionarySenseDrafts.map<SignOffRow>((draft) => ({
    family: "dictionary",
    key: `dictionary-sense:${draft.id}`,
    id: draft.id,
    // The corpus writes most expansions as "TOKEN — meaning" already, so
    // prefixing the token unconditionally produced "4AT — 4AT — rapid delirium
    // assessment". Prefixed only when the expansion does not already carry it.
    title: draft.expansion.startsWith(draft.token) ? draft.expansion : `${draft.token} — ${draft.expansion}`,
    nativeStatus: `clinicalApproval.status: ${draft.clinicalApproval.status} (reviewState: ${draft.reviewState}, priority ${draft.editorialPriority})`,
    statusLabel: "Pending — unpublished draft",
    requires:
      "A named reviewer signs the sense off record by record; promotion into the published dictionary is a clinical decision, not a data migration.",
    href: null,
    signOff: null,
  }));

  // A definition review signed off by `npm run clinical:review` carries a complete
  // `clinicalApproval` and leaves the queue. Approval does not apply the wording: that
  // is a later, separate step, so an approved rewrite is simply no longer awaiting sign-off.
  const reviews = dictionaryDefinitionReviews
    .filter((review) => !isDefinitionReviewClinicallyApproved(review))
    .map<SignOffRow>((review) => ({
      family: "dictionary",
      key: `dictionary-definition:${review.id}`,
      id: review.id,
      title: `${review.title} — ${review.verdict}`,
      // An unsigned review carries no `clinicalApproval` field of its own; the
      // equivalent state is the pair the module's own contract pins, so both are
      // reported rather than one being dressed up as the other.
      nativeStatus: `publicationAllowed: ${review.publicationAllowed}, reviewer: ${review.reviewer === null ? "null" : "set"}`,
      statusLabel: review.proposedWording ? "Proposed rewrite, unapplied" : "Verdict recorded, no rewrite proposed",
      requires: review.proposedWording
        ? "A clinician signs off the proposed wording after it is reconciled against the live definition by hash; nothing here applies automatically."
        : `A clinician confirms the verdict and the recorded disposition: ${review.disposition}`,
      href: `/dictionary/${review.entrySlug}`,
      // The tool signs only a drafted rewrite: a verdict with no proposed wording
      // is "pending" there and refused, so it gets no command.
      signOff: review.proposedWording
        ? toolUnlessIndigenous({ script: "clinical:review", kind: "dictionary-rewrite", code: review.id }, review)
        : null,
    }));

  return {
    id: "dictionary",
    name: "Dictionary editorial layer",
    source: "src/data/dictionary-sense-drafts.json, src/data/dictionary-definition-reviews.json",
    nativeField:
      "clinicalApproval.status (senses), publicationAllowed + reviewer, or clinicalApproval once signed (definition reviews)",
    // The reason this family is on the page at all: before this panel its only
    // importer was a contract test, so nothing in the running app ever showed
    // these records to the person who has to sign them off.
    note: "The sense drafts have no route, no component and no link anywhere else in the app — this list is the only place they are readable. They stay unpublished: every draft keeps publicationAllowed false and clinicalApproval pending, and assertNoDraftIsPublished is the gate that holds it.",
    unrouted: true,
    rows: [...senses, ...reviews],
  };
}

function specifiersFamily(): SignOffFamily {
  const content = loadSpecifiersContent();
  const items = specifierCatalogItems()
    .filter((item) => !isSpecifierClinicianReviewed(item.review))
    .map<SignOffRow>((item) => ({
      family: "specifiers",
      key: `specifier:${item.slug}`,
      id: item.slug,
      title: `${item.disorderName} · ${item.groupLabel} · ${item.label}`,
      nativeStatus: `${item.review.clinicianReviewStatus} (source: ${item.review.sourceVerificationStatus})`,
      statusLabel: "Clinician review pending",
      requires:
        "A clinician confirms the specifier against current DSM-5-TR / ICD-11 materials; the auto-generated definition is withheld until then.",
      href: `/specifiers/${item.slug}`,
      // The tool's `specifier` kind signs category definitions, keyed differently
      // from these catalogue items, so no command is offered rather than a guessed one.
      signOff: null,
    }));
  // The universal specifiers sit outside the per-disorder catalogue and carry
  // the same `clinician-review-pending` state on the same field. The family note
  // already told the reader they were pending, so omitting them made this page
  // describe records it did not list — the one failure mode a sign-off queue
  // cannot have. They are deliberately unlinked: `publicSpecifierRecords()` is
  // built from curated records plus `specifierCatalogItems()`, and a universal is
  // in neither, so `/specifiers/<slug>` would not resolve for one.
  const universals = content.universalSpecifiers
    .filter((specifier) => !isSpecifierClinicianReviewed(specifier.review))
    .map<SignOffRow>((specifier) => ({
      family: "specifiers",
      key: `specifier-universal:${specifier.review.rowKey}`,
      id: specifier.review.rowKey,
      title: `Universal · ${specifier.title}`,
      nativeStatus: `${specifier.review.clinicianReviewStatus} (source: ${specifier.review.sourceVerificationStatus})`,
      statusLabel: "Clinician review pending",
      requires:
        "A clinician confirms the specifier against current DSM-5-TR / ICD-11 materials; it applies across disorders, so a wrong reading here carries further than a single catalogue entry.",
      href: null,
      signOff: null,
    }));
  return {
    id: "specifiers",
    name: "Specifiers",
    source: "data/specifiers-content.json",
    nativeField: "review.clinicianReviewStatus",
    note: `The queue lists ${items.length} per-disorder specifier items pending clinician review, and a further ${universals.length} of the ${content.universalSpecifiers.length} universal specifiers carry the same pending status outside the per-disorder catalogue. Both are listed here; the universals are the rows with no link, because no route renders one. Specifiers is an aide-memoire reference surface, not automated clinical decision support.`,
    unrouted: universals.length > 0,
    rows: [...items, ...universals],
  };
}

function therapyFamily(): SignOffFamily {
  const rows = therapyRecords.filter(therapyNeedsReview).map<SignOffRow>((record) => ({
    family: "therapy",
    key: `therapy:${record.slug}`,
    id: record.slug,
    title: record.name,
    nativeStatus: record.reviewStatus,
    statusLabel: "Needs review",
    requires:
      "A qualified clinician signs the record off; until then every Therapy Compass surface shows the awaiting-review badge rather than hiding the record.",
    href: `/therapy-compass/${record.slug}`,
    signOff: signableTherapySlugs.has(record.slug) ? { script: "therapy:review", slug: record.slug } : null,
  }));
  return {
    id: "therapy",
    name: "Therapy Compass records",
    // Read from the index projection rather than therapies-source.json: it is
    // generated from that file by scripts/build-therapies-index.mjs, carries the
    // identical slug and reviewStatus for all 205 records, and is the module the
    // rest of the server already resolves therapies through — importing the
    // ~2.5 MB source here would put it in the server graph for no added fact.
    source: "src/data/therapies-index.json, generated from src/data/therapies-source.json",
    nativeField: "reviewStatus",
    note: "Reachability is deliberately not gated on review status: a record awaiting sign-off is disclosed as such rather than hidden.",
    unrouted: false,
    rows,
  };
}

function sourcesFamily(): SignOffFamily {
  // Reuses acquisitionReviewQueue rather than re-deriving the filter: that
  // function already encodes which records count as awaiting sign-off (not
  // rejected, still unverified) and the worst-rung-first order the source
  // acquisition protocol reads them in.
  const rows = acquisitionReviewQueue().map<SignOffRow>((record) => ({
    family: "sources",
    key: `source-acquisition:${record.id}`,
    id: record.id,
    title: record.title,
    nativeStatus: `${record.disposition} / validationStatus: ${record.validationStatus} (rung ${record.rung})`,
    statusLabel: "Captured, not yet verified",
    requires:
      "The owner verifies the source against the acquisition protocol before any clinical content may cite it; an adopted source with validationStatus unverified is already a ledger error.",
    href: null,
    signOff: toolUnlessIndigenous({ script: "clinical:review", kind: "source", code: record.id }, record),
  }));
  return {
    id: "sources",
    name: "Source acquisitions",
    source: "src/data/source-acquisitions.json",
    nativeField: "disposition + validationStatus, via acquisitionReviewQueue()",
    note: "Worst rung first, the order the source acquisition protocol reads them in. Rejected records are excluded by that queue, not by this page.",
    unrouted: true,
    rows,
  };
}

export function loadSignOffQueue(): SignOffQueue {
  const families: readonly SignOffFamily[] = [
    formsFamily(),
    formulationFamily(),
    differentialsFamily(),
    dictionaryFamily(),
    specifiersFamily(),
    therapyFamily(),
    sourcesFamily(),
  ];
  return {
    families,
    total: families.reduce((sum, family) => sum + family.rows.length, 0),
  };
}

/**
 * All 13 governed sign-off domains across the repository: both the 7 families
 * that appear in `loadSignOffQueue()` and the 6 additional governed registers
 * (`today-rules`, `mha-sections`, `mha-timeframes`, `cp-standards`,
 * `cultural-notes`, and `services`).
 */
export type SignOffDomainId =
  | "today-rules"
  | "wa-mha-forms"
  | "mha-sections"
  | "mha-timeframes"
  | "cp-standards"
  | "cultural-notes"
  | "differentials"
  | "formulation"
  | "specifiers"
  | "therapy"
  | "dictionary"
  | "sources"
  | "services";

export type SignedRecordRow = {
  domain: SignOffDomainId;
  key: string;
  id: string;
  title: string;
  whatFor: string;
  signedBy: string;
  signedAt: string | null;
  href: string | null;
};

export type UnsignedHoldRow = {
  domain: SignOffDomainId;
  domainName: string;
  key: string;
  id: string;
  title: string;
  reason: string;
  href: string | null;
};

export type SignOffDomainSummary = {
  id: SignOffDomainId;
  name: string;
  whatFor: string;
  source: string;
  toolHint: string;
  total: number;
  signedCount: number;
  waitingCount: number;
  signedByCounts: Readonly<Record<string, number>>;
  latestSignedAt: string | null;
  signedRows: readonly SignedRecordRow[];
  needsSigning: {
    signableNow: number;
    indigenousHold: number;
    awaitingPrerequisites: number;
    awaitingTool: number;
    summary: string;
    indigenousHoldRows: readonly UnsignedHoldRow[];
    prerequisiteRows: readonly UnsignedHoldRow[];
  };
  queueFamilyId: SignOffFamilyId | null;
};

export type SignOffLedger = {
  domains: readonly SignOffDomainSummary[];
  totalGoverned: number;
  totalSigned: number;
  totalWaiting: number;
  signedByTotals: Readonly<Record<string, number>>;
  waitingByCategory: {
    signableNow: number;
    indigenousHold: number;
    awaitingPrerequisites: number;
    awaitingTool: number;
  };
};

function countSignedBy(rows: readonly SignedRecordRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const signer = row.signedBy.trim() || "Unknown";
    counts[signer] = (counts[signer] ?? 0) + 1;
  }
  return counts;
}

function latestTimestamp(rows: readonly SignedRecordRow[]): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (!row.signedAt) continue;
    if (latest === null || row.signedAt > latest) {
      latest = row.signedAt;
    }
  }
  return latest;
}

function buildDomainSummary(input: {
  id: SignOffDomainId;
  name: string;
  whatFor: string;
  source: string;
  toolHint: string;
  signedRows: readonly SignedRecordRow[];
  signableNow: number;
  indigenousHoldRows: readonly UnsignedHoldRow[];
  awaitingPrerequisites?: number;
  prerequisiteRows?: readonly UnsignedHoldRow[];
  awaitingTool?: number;
  needsSigningSummary: string;
  queueFamilyId: SignOffFamilyId | null;
}): SignOffDomainSummary {
  const indigenousHold = input.indigenousHoldRows.length;
  const prerequisiteRows = input.prerequisiteRows ?? [];
  const awaitingPrerequisites = input.awaitingPrerequisites ?? prerequisiteRows.length;
  const awaitingTool = input.awaitingTool ?? 0;
  const waitingCount = input.signableNow + indigenousHold + awaitingPrerequisites + awaitingTool;
  const signedCount = input.signedRows.length;
  return {
    id: input.id,
    name: input.name,
    whatFor: input.whatFor,
    source: input.source,
    toolHint: input.toolHint,
    total: signedCount + waitingCount,
    signedCount,
    waitingCount,
    signedByCounts: countSignedBy(input.signedRows),
    latestSignedAt: latestTimestamp(input.signedRows),
    signedRows: input.signedRows,
    needsSigning: {
      signableNow: input.signableNow,
      indigenousHold,
      awaitingPrerequisites,
      awaitingTool,
      summary: input.needsSigningSummary,
      indigenousHoldRows: input.indigenousHoldRows,
      prerequisiteRows,
    },
    queueFamilyId: input.queueFamilyId,
  };
}

function todayRulesDomain(): SignOffDomainSummary {
  type RuleSignOffBlock = {
    enabled?: boolean;
    signedBy?: string | null;
    signedAt?: string | null;
  };
  const raw = todayRuleSignOffsJson as {
    fatigue?: RuleSignOffBlock;
    cpd?: RuleSignOffBlock;
    mhaTimerSwitch?: {
      medicalDeviceRuling?: { confirmedOn?: string };
      signOff?: RuleSignOffBlock;
    };
  };
  const items: { id: string; title: string; whatFor: string; block: RuleSignOffBlock | undefined; href: string }[] = [
    {
      id: "fatigue",
      title: "Roster fatigue rules (WA AMA 2024 cl 15)",
      whatFor:
        "Turns on consecutive-day, night-shift recovery, 48-hour break, and fortnightly hours fatigue alerts on Today (/).",
      block: raw.fatigue,
      href: "/",
    },
    {
      id: "cpd",
      title: "CPD category minimums & coaching",
      whatFor: "Turns on Medical Board of Australia annual CPD hour and category minimum coaching on Today (/).",
      block: raw.cpd,
      href: "/",
    },
    {
      id: "mha-timer-switch",
      title: `Mental Health Act per-order countdown switch (non-device ruling confirmed ${raw.mhaTimerSwitch?.medicalDeviceRuling?.confirmedOn ?? "2026-10-04"})`,
      whatFor:
        "Authorises the per-order statutory countdown switch after the owner's TGA non-device ruling confirmation.",
      block: raw.mhaTimerSwitch?.signOff,
      href: "/on-call",
    },
  ];

  const signedRows: SignedRecordRow[] = [];
  let signableNow = 0;
  for (const item of items) {
    const signedBy = item.block?.signedBy?.trim();
    const signedContentSha256 = (item.block as (RuleSignOffBlock & { signedContentSha256?: string }) | undefined)
      ?.signedContentSha256;
    if (
      item.block?.enabled === true &&
      signedBy &&
      item.block.signedAt &&
      typeof signedContentSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(signedContentSha256) &&
      (item.id !== "mha-timer-switch" || raw.mhaTimerSwitch?.medicalDeviceRuling?.record === "local")
    ) {
      signedRows.push({
        domain: "today-rules",
        key: `today-rule:${item.id}`,
        id: item.id,
        title: item.title,
        whatFor: item.whatFor,
        signedBy,
        signedAt: item.block.signedAt,
        href: item.href,
      });
    } else {
      signableNow += 1;
    }
  }

  return buildDomainSummary({
    id: "today-rules",
    name: "Today rule engines & medical device ruling",
    whatFor:
      "Turns on Roster fatigue warnings, CPD category coaching, and the MHA per-order countdown switch on Today and On Call.",
    source: "src/lib/admin/today-rule-sign-offs.json",
    toolHint: "Owner rule sign-off register (src/lib/admin/today-rule-sign-offs.json)",
    signedRows,
    signableNow,
    indigenousHoldRows: [],
    needsSigningSummary:
      signableNow === 0
        ? "Nothing waiting — all 3 rule engines and the medical device ruling are signed off."
        : `${signableNow} rule engine(s) awaiting owner sign-off.`,
    queueFamilyId: null,
  });
}

function formsDomain(): SignOffDomainSummary {
  type FormReviewRow = {
    code: string;
    status: string;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    reviewedContentSha256?: string | null;
  };
  const reviewRows = new Map(
    ((formsContentReviewJson as { forms: FormReviewRow[] }).forms ?? []).map((row) => [row.code, row]),
  );
  const signedRows: SignedRecordRow[] = [];
  const indigenousHoldRows: UnsignedHoldRow[] = [];
  let signableNow = 0;

  for (const details of loadFormCatalogDetails()) {
    const review = reviewRows.get(details.form);
    const href = formPageHref(details.form);
    const title = `Form ${details.form} — ${details.name}`;
    if (
      details.contentReviewStatus === "reviewed" &&
      review?.reviewedBy?.trim() &&
      review.reviewedAt &&
      typeof review.reviewedContentSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(review.reviewedContentSha256)
    ) {
      signedRows.push({
        domain: "wa-mha-forms",
        key: `signed-form:${details.id}`,
        id: details.form,
        title,
        whatFor:
          "Operational clinical guidance, maker/threshold rules, statutory clock, pre-use checks, and filing pathway.",
        signedBy: review?.reviewedBy?.trim() || "Psych Sift",
        signedAt: review?.reviewedAt ?? null,
        href,
      });
    } else if (isIndigenousContent([JSON.stringify(details)])) {
      indigenousHoldRows.push({
        domain: "wa-mha-forms",
        domainName: "WA Mental Health Act forms",
        key: `hold-form:${details.id}`,
        id: details.form,
        title,
        reason: "Held for Aboriginal and Torres Strait Islander governance review.",
        href,
      });
    } else {
      signableNow += 1;
    }
  }

  return buildDomainSummary({
    id: "wa-mha-forms",
    name: "WA Mental Health Act 2014 forms",
    whatFor:
      "Operational clinical guidance, priority facts, statutory clocks, and filing pathways for all 54 WA Mental Health Act forms.",
    source: "data/forms-content-review.json, data/forms-catalog.json",
    toolHint: 'npm run clinical:review -- --write --kind form --code "<form>" --reviewed-by',
    signedRows,
    signableNow,
    indigenousHoldRows,
    needsSigningSummary:
      signableNow === 0 && indigenousHoldRows.length === 0
        ? "Nothing waiting — all 54 WA Mental Health Act forms are signed off."
        : `${signableNow} ready to sign now; ${indigenousHoldRows.length} held for Aboriginal governance review.`,
    queueFamilyId: "wa-mha-forms",
  });
}

function mhaSectionsDomain(): SignOffDomainSummary {
  type SectionEntry = {
    section: string;
    title: string;
    summary: string;
    status: string;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
  };
  const sections = (mhaSectionsJson as { sections: SectionEntry[] }).sections ?? [];
  const signedRows: SignedRecordRow[] = [];
  const indigenousHoldRows: UnsignedHoldRow[] = [];
  let signableNow = 0;

  for (const entry of sections) {
    const id = `s${entry.section}`;
    const title = `s ${entry.section} — ${entry.title}`;
    const signedBy = entry.reviewedBy?.trim();
    if (entry.status === "reviewed" && signedBy && entry.reviewedAt) {
      signedRows.push({
        domain: "mha-sections",
        key: `signed-mha-section:${entry.section}`,
        id,
        title,
        whatFor: "Plain-English statutory section summary on /forms/act and form guidance sheets, pinned to Act text.",
        signedBy,
        signedAt: entry.reviewedAt,
        href: "/forms/act",
      });
    } else if (isIndigenousContent([entry.title, entry.summary])) {
      indigenousHoldRows.push({
        domain: "mha-sections",
        domainName: "WA Mental Health Act section summaries",
        key: `hold-mha-section:${entry.section}`,
        id,
        title,
        reason: "Held for Aboriginal and Torres Strait Islander governance review.",
        href: "/forms/act",
      });
    } else {
      signableNow += 1;
    }
  }

  return buildDomainSummary({
    id: "mha-sections",
    name: "WA Mental Health Act section summaries",
    whatFor:
      "Plain-English summaries of 110 WA Mental Health Act 2014 sections displayed on /forms/act and form guidance pages.",
    source: "data/mha-2014-sections.json",
    toolHint: 'npm run clinical:review -- --write --kind section --code "<section>" --reviewed-by',
    signedRows,
    signableNow,
    indigenousHoldRows,
    needsSigningSummary:
      signableNow === 0 && indigenousHoldRows.length === 0
        ? "Nothing waiting — all 110 WA Mental Health Act section summaries are signed off."
        : `${signableNow} ready to sign now; ${indigenousHoldRows.length} held for Aboriginal governance review.`,
    queueFamilyId: null,
  });
}

function mhaTimeframesDomain(): SignOffDomainSummary {
  type TimeframeEntry = {
    id: string;
    formCodes: string[];
    trigger: string;
    section: string;
    duration: { value: number; unit: string };
    status: string;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
  };
  const entries = (mhaTimeframesJson as { entries: TimeframeEntry[] }).entries ?? [];
  const signedRows: SignedRecordRow[] = [];
  const indigenousHoldRows: UnsignedHoldRow[] = [];
  let signableNow = 0;

  for (const entry of entries) {
    const formLabel = entry.formCodes.join("/");
    const title = `Form ${formLabel} (s ${entry.section}) — ${entry.trigger}`;
    const href = formPageHref(entry.formCodes[0] ?? "1A");
    const signedBy = entry.reviewedBy?.trim();
    if (entry.status === "reviewed" && signedBy && entry.reviewedAt) {
      signedRows.push({
        domain: "mha-timeframes",
        key: `signed-timeframe:${entry.id}`,
        id: entry.id,
        title,
        whatFor: `Quoted statutory duration (${entry.duration.value} ${entry.duration.unit}) driving form timelines and On Call MHA timers.`,
        signedBy,
        signedAt: entry.reviewedAt,
        href,
      });
    } else if (isIndigenousContent([JSON.stringify(entry)])) {
      indigenousHoldRows.push({
        domain: "mha-timeframes",
        domainName: "WA Mental Health Act statutory timeframes",
        key: `hold-timeframe:${entry.id}`,
        id: entry.id,
        title,
        reason: "Held for Aboriginal and Torres Strait Islander governance review.",
        href,
      });
    } else {
      signableNow += 1;
    }
  }

  return buildDomainSummary({
    id: "mha-timeframes",
    name: "WA Mental Health Act statutory timeframes",
    whatFor:
      "Quoted statutory detention, examination, transport, and review durations driving form timelines and On Call MHA timers.",
    source: "data/mha-timeframes.json",
    toolHint: 'npm run clinical:review -- --write --kind timeframe --code "<id>" --reviewed-by',
    signedRows,
    signableNow,
    indigenousHoldRows,
    needsSigningSummary:
      signableNow === 0 && indigenousHoldRows.length === 0
        ? "Nothing waiting — all 9 statutory timeframes are signed off and owner-confirmed."
        : `${signableNow} ready to sign now; ${indigenousHoldRows.length} held for Aboriginal governance review.`,
    queueFamilyId: null,
  });
}

function cpStandardsDomain(): SignOffDomainSummary {
  type StandardEntry = {
    id: string;
    title: string;
    summary: string;
    status?: string;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    reviewedContentSha256?: string | null;
  };
  const standards = (cpStandardsJson as { standards: StandardEntry[] }).standards ?? [];
  const signedRows: SignedRecordRow[] = [];
  const indigenousHoldRows: UnsignedHoldRow[] = [];
  let signableNow = 0;

  for (const standard of standards) {
    const reviewer = signedOffReviewer(standard, [standard.title, standard.summary]);
    if (reviewer) {
      signedRows.push({
        domain: "cp-standards",
        key: `signed-cp-standard:${standard.id}`,
        id: standard.id,
        title: standard.title,
        whatFor: "Summary of the WA Chief Psychiatrist's Standard for Clinical Care on /forms/act.",
        signedBy: reviewer,
        signedAt: standard.reviewedAt ?? null,
        href: "/forms/act",
      });
    } else if (isIndigenousContent([standard.title, standard.summary])) {
      indigenousHoldRows.push({
        domain: "cp-standards",
        domainName: "Chief Psychiatrist's Standards",
        key: `hold-cp-standard:${standard.id}`,
        id: standard.id,
        title: standard.title,
        reason:
          "Held for Aboriginal and Torres Strait Islander governance review (owner rule 2026-09-26: Aboriginal practice standard requires Aboriginal governance review, not a clinician sign-off).",
        href: "/forms/act",
      });
    } else {
      signableNow += 1;
    }
  }

  return buildDomainSummary({
    id: "cp-standards",
    name: "Chief Psychiatrist's Standards for Clinical Care",
    whatFor: "Plain-English summaries of the 8 WA Chief Psychiatrist's Standards for Clinical Care on /forms/act.",
    source: "data/chief-psychiatrist-standards.json",
    toolHint: 'npm run clinical:review -- --write --kind standard --code "<id>" --reviewed-by',
    signedRows,
    signableNow,
    indigenousHoldRows,
    needsSigningSummary:
      indigenousHoldRows.length > 0 && signableNow === 0
        ? "1 standard (Aboriginal Practice) held for Aboriginal and Torres Strait Islander governance review."
        : `${signableNow} ready to sign now; ${indigenousHoldRows.length} held for Aboriginal governance review.`,
    queueFamilyId: null,
  });
}

function culturalNotesDomain(): SignOffDomainSummary {
  type CulturalNoteEntry = {
    formCode: string;
    kind: string;
    text: string;
    sourceId: string;
    status?: string;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    reviewedContentSha256?: string | null;
  };
  const notes = (formsCulturalNotesJson as { notes: CulturalNoteEntry[] }).notes ?? [];
  const countsByPrefix = new Map<string, number>();
  const signedRows: SignedRecordRow[] = [];
  const indigenousHoldRows: UnsignedHoldRow[] = [];
  let signableNow = 0;

  for (const note of notes) {
    const prefix = `${note.formCode}-${note.kind}`;
    const ordinal = (countsByPrefix.get(prefix) ?? 0) + 1;
    countsByPrefix.set(prefix, ordinal);
    const code = `${prefix}-${ordinal}`;
    const snippet = note.text.length > 96 ? `${note.text.slice(0, 93).trimEnd()}…` : note.text;
    const title = `Form ${note.formCode} (${note.kind} #${ordinal}) — ${snippet}`;
    const href = formPageHref(note.formCode);
    const reviewer = signedOffReviewer(note, [note.kind, note.text]);
    if (reviewer) {
      signedRows.push({
        domain: "cultural-notes",
        key: `signed-cultural-note:${code}`,
        id: code,
        title,
        whatFor: `Statutory communication and interpreter duty note shown on Form ${note.formCode}.`,
        signedBy: reviewer,
        signedAt: note.reviewedAt ?? null,
        href,
      });
    } else if (isIndigenousContent([note.kind, note.text])) {
      indigenousHoldRows.push({
        domain: "cultural-notes",
        domainName: "WA Mental Health Act cultural & communication notes",
        key: `hold-cultural-note:${code}`,
        id: code,
        title,
        reason:
          "Held for Aboriginal and Torres Strait Islander governance review (Aboriginal liaison s 50 / Principle 7 and Aboriginal Interpreting WA notes).",
        href,
      });
    } else {
      signableNow += 1;
    }
  }

  return buildDomainSummary({
    id: "cultural-notes",
    name: "WA Mental Health Act cultural & communication notes",
    whatFor:
      "Statutory language, interpreter (s 9(2) / MP 0051/17), cultural exclusion (s 6(2)), and Aboriginal liaison (s 50) notes on MHA form pages.",
    source: "data/forms-cultural-notes.json",
    toolHint: 'npm run clinical:review -- --write --kind cultural-note --code "<formCode-kind-N>" --reviewed-by',
    signedRows,
    signableNow,
    indigenousHoldRows,
    needsSigningSummary:
      indigenousHoldRows.length > 0 && signableNow === 0
        ? `${indigenousHoldRows.length} notes (8 Aboriginal liaison notes + 1 Aboriginal Interpreting WA note) held for Aboriginal governance review.`
        : `${signableNow} ready to sign now; ${indigenousHoldRows.length} held for Aboriginal governance review.`,
    queueFamilyId: null,
  });
}

function differentialsDomain(): SignOffDomainSummary {
  const snapshot = loadDifferentialSnapshot();
  const diagnosesBySlug = new Map(snapshot.diagnoses.map((d) => [d.slug, d]));
  const signedRows: SignedRecordRow[] = [];
  const indigenousHoldRows: UnsignedHoldRow[] = [];
  let signableNow = 0;

  for (const entry of differentialReviewEntries) {
    const overlay = curatedDifferentials[entry.slug as keyof typeof curatedDifferentials];
    const diagnosis = diagnosesBySlug.get(entry.slug);
    const title = `${diagnosis?.title ?? entry.slug} — locally authored clinical overlay`;
    const href = `/differentials/diagnoses/${entry.slug}`;
    const waits = differentialOverlayWaitsForSignOff(entry.slug, overlay);
    if (!waits && entry.status === "reviewed" && entry.reviewedBy?.trim()) {
      signedRows.push({
        domain: "differentials",
        key: `signed-differential-overlay:${entry.slug}`,
        id: entry.slug,
        title,
        whatFor:
          "Locally authored bedside red flags, discriminators, and first-line steps layered on top of the differential diagnosis page.",
        signedBy: entry.reviewedBy.trim(),
        signedAt: entry.reviewedAt ?? null,
        href,
      });
    } else if (isIndigenousContent([JSON.stringify([diagnosis, overlay])])) {
      indigenousHoldRows.push({
        domain: "differentials",
        domainName: "Differentials",
        key: `hold-differential-overlay:${entry.slug}`,
        id: entry.slug,
        title,
        reason: "Held for Aboriginal and Torres Strait Islander governance review.",
        href,
      });
    } else {
      signableNow += 1;
    }
  }

  const awaitingTool = snapshot.diagnoses.length + snapshot.presentations.length;

  return buildDomainSummary({
    id: "differentials",
    name: "Differential diagnosis overlays & exported snapshot",
    whatFor:
      "11 locally authored bedside clinical overlays (red flags, discriminators, first-line steps) plus 232 exported diagnosis and presentation records in data/differentials-snapshot.json.",
    source: "data/differential-curated-review.json, src/lib/differential-curated.ts, data/differentials-snapshot.json",
    toolHint: 'npm run clinical:review -- --write --kind differential --code "<slug>" --reviewed-by',
    signedRows,
    signableNow,
    indigenousHoldRows,
    awaitingTool,
    needsSigningSummary:
      signableNow === 0
        ? `All ${signedRows.length} locally authored clinical overlays are signed off. The ${awaitingTool} underlying exported snapshot records (${snapshot.diagnoses.length} diagnoses + ${snapshot.presentations.length} presentation workflows) have no sign-off tool yet.`
        : `${signableNow} locally authored overlay(s) ready to sign; ${awaitingTool} exported snapshot records have no sign-off tool yet.`,
    queueFamilyId: "differentials",
  });
}

function formulationDomain(): SignOffDomainSummary {
  type FormulationMechanismRow = {
    id: string;
    name: string;
    reviewStatus: string;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
  };
  const mechanisms = (formulationContent as { mechanisms: FormulationMechanismRow[] }).mechanisms ?? [];
  const signedRows: SignedRecordRow[] = [];
  const indigenousHoldRows: UnsignedHoldRow[] = [];
  let signableNow = 0;

  for (const mechanism of mechanisms) {
    const state = mechanismReviewState(mechanism);
    const href = `/formulation/${mechanism.id}`;
    if (state.reviewed && mechanism.reviewedBy?.trim()) {
      signedRows.push({
        domain: "formulation",
        key: `signed-formulation-mechanism:${mechanism.id}`,
        id: mechanism.id,
        title: `Mechanism — ${mechanism.name}`,
        whatFor: "Maintaining cycle mechanism description, fit indicators, and treatment implications.",
        signedBy: mechanism.reviewedBy.trim(),
        signedAt: mechanism.reviewedAt ?? null,
        href,
      });
    } else if (isIndigenousContent([JSON.stringify(mechanism)])) {
      indigenousHoldRows.push({
        domain: "formulation",
        domainName: "Formulation mechanisms, guides & concepts",
        key: `hold-formulation-mechanism:${mechanism.id}`,
        id: mechanism.id,
        title: `Mechanism — ${mechanism.name}`,
        reason: "Held for Aboriginal and Torres Strait Islander governance review.",
        href,
      });
    } else {
      signableNow += 1;
    }
  }

  for (const { record, kind } of [
    ...formulationGuides.map((record) => ({ record, kind: "guide" as const })),
    ...formulationConcepts.map((record) => ({ record, kind: "concept" as const })),
  ]) {
    const state = conceptReviewState(record);
    const href = record.release === "published" ? `/formulation/${record.id}` : null;
    const prefix = kind === "guide" ? "Guide" : "Concept";
    const title = `${prefix} — ${record.title}`;
    if (state.reviewed && record.review.reviewer?.trim()) {
      signedRows.push({
        domain: "formulation",
        key: `signed-formulation-${kind}:${record.id}`,
        id: record.id,
        title,
        whatFor:
          kind === "guide"
            ? "Structured clinical formulation guide module and instructions."
            : "Contextual formulation concept summary, qualifications, clinical warnings, and evidence links.",
        signedBy: record.review.reviewer.trim(),
        signedAt: record.review.reviewedAt ?? record.review.preparedAt ?? null,
        href,
      });
    } else if (isIndigenousContent([JSON.stringify(record)])) {
      indigenousHoldRows.push({
        domain: "formulation",
        domainName: "Formulation mechanisms, guides & concepts",
        key: `hold-formulation-${kind}:${record.id}`,
        id: record.id,
        title,
        reason:
          record.releaseNote ??
          "Held for Aboriginal and Torres Strait Islander governance review (not published until cultural governance signs off).",
        href,
      });
    } else {
      signableNow += 1;
    }
  }

  return buildDomainSummary({
    id: "formulation",
    name: "Formulation mechanisms, guides & concepts",
    whatFor:
      "12 maintaining mechanisms, 6 structured guide modules, and 46 contextual formulation concepts across Biological, Psychological, Social, and Cultural domains.",
    source: "src/data/formulation-content.json, src/data/formulation-concepts.json",
    toolHint:
      'npm run clinical:review -- --write --kind formulation-mechanism|formulation-guide|formulation-concept --code "<id>" --reviewed-by',
    signedRows,
    signableNow,
    indigenousHoldRows,
    needsSigningSummary:
      indigenousHoldRows.length > 0 && signableNow === 0
        ? `All 12 mechanisms, 5 non-Indigenous guides, and 41 non-Indigenous concepts are signed off. ${indigenousHoldRows.length} Cultural/SEWB records (1 guide + 5 concepts) are held for Aboriginal governance review.`
        : `${signableNow} ready to sign now; ${indigenousHoldRows.length} held for Aboriginal governance review.`,
    queueFamilyId: "formulation",
  });
}

function specifiersDomain(): SignOffDomainSummary {
  const content = loadSpecifiersContent();
  const signedRows: SignedRecordRow[] = [];
  const indigenousHoldRows: UnsignedHoldRow[] = [];
  let signableNow = 0;
  let awaitingPrerequisites = 0;

  for (const item of specifierCatalogItems()) {
    const title = `${item.disorderName} · ${item.groupLabel} · ${item.label}`;
    const href = `/specifiers/${item.slug}`;
    if (isSpecifierClinicianReviewed(item.review)) {
      signedRows.push({
        domain: "specifiers",
        key: `signed-specifier:${item.slug}`,
        id: item.review.rowKey,
        title,
        whatFor: "Written DSM-5-TR / ICD-11 disorder-specific specifier definition and clinical note.",
        signedBy: item.review.reviewedBy!.trim(),
        signedAt: item.review.reviewedAt ?? null,
        href,
      });
    } else if (item.definitionStatus === "defined" && item.definition !== null) {
      if (isIndigenousContent([JSON.stringify(item)])) {
        indigenousHoldRows.push({
          domain: "specifiers",
          domainName: "Specifiers",
          key: `hold-specifier:${item.slug}`,
          id: item.review.rowKey,
          title,
          reason: "Held for Aboriginal and Torres Strait Islander governance review.",
          href,
        });
      } else {
        signableNow += 1;
      }
    } else {
      awaitingPrerequisites += 1;
    }
  }

  for (const universal of content.universalSpecifiers) {
    const title = `Universal · ${universal.title}`;
    if (isSpecifierClinicianReviewed(universal.review)) {
      signedRows.push({
        domain: "specifiers",
        key: `signed-specifier-universal:${universal.review.rowKey}`,
        id: universal.review.rowKey,
        title,
        whatFor: "Cross-disorder universal DSM-5-TR / ICD-11 course, severity, or feature specifier definition.",
        signedBy: universal.review.reviewedBy!.trim(),
        signedAt: universal.review.reviewedAt ?? null,
        href: null,
      });
    } else if (isIndigenousContent([JSON.stringify(universal)])) {
      indigenousHoldRows.push({
        domain: "specifiers",
        domainName: "Specifiers",
        key: `hold-specifier-universal:${universal.review.rowKey}`,
        id: universal.review.rowKey,
        title,
        reason: "Held for Aboriginal and Torres Strait Islander governance review.",
        href: null,
      });
    } else {
      signableNow += 1;
    }
  }

  return buildDomainSummary({
    id: "specifiers",
    name: "DSM-5-TR & ICD-11 diagnostic specifiers",
    whatFor:
      "71 written disorder-specific specifier definitions, 18 cross-disorder universal specifiers, and 514 catalog placeholders in Specifiers mode.",
    source: "data/specifiers-content.json",
    toolHint: 'npm run clinical:review -- --write --kind specifier --code "<rowKey>" --reviewed-by',
    signedRows,
    signableNow,
    indigenousHoldRows,
    awaitingPrerequisites,
    needsSigningSummary:
      signableNow === 0
        ? `All 89 written specifier definitions (71 disorder-specific + 18 universal) are signed off. The remaining ${awaitingPrerequisites} catalog rows have no written definition text yet (definition: null) and cannot be signed until definitions are authored.`
        : `${signableNow} written specifier(s) ready to sign now; ${awaitingPrerequisites} catalog placeholders awaiting written definition text.`,
    queueFamilyId: "specifiers",
  });
}

function therapyDomain(): SignOffDomainSummary {
  const signedRows: SignedRecordRow[] = [];
  const prerequisiteRows: UnsignedHoldRow[] = [];
  let signableNow = 0;

  for (const record of therapyRecords) {
    const href = `/therapy-compass/${record.slug}`;
    const canonical = record as unknown as Record<string, unknown>;
    if (
      !therapyNeedsReview(record) &&
      typeof canonical.reviewedBy === "string" &&
      canonical.reviewedBy.trim() &&
      typeof canonical.reviewedAt === "string" &&
      typeof canonical.reviewedContentSha256 === "string" &&
      canonical.reviewedContentSha256 === therapyContentSha256(canonical)
    ) {
      signedRows.push({
        domain: "therapy",
        key: `signed-therapy:${record.slug}`,
        id: record.slug,
        title: record.name,
        whatFor: `Evidence-based therapy profile (${record.category ?? "Psychological & psychosocial therapy"}) in Therapy Compass.`,
        signedBy: String(canonical.reviewedBy).trim(),
        signedAt: String(canonical.reviewedAt),
        href,
      });
    } else if (signableTherapySlugs.has(record.slug)) {
      signableNow += 1;
    } else {
      prerequisiteRows.push({
        domain: "therapy",
        domainName: "Therapy Compass records",
        key: `prereq-therapy:${record.slug}`,
        id: record.slug,
        title: record.name,
        reason:
          "Has an empty references: [] list in src/data/therapies-source.json; npm run therapy:review unlocks it once at least one governed guideline reference is added.",
        href,
      });
    }
  }

  return buildDomainSummary({
    id: "therapy",
    name: "Therapy Compass records",
    whatFor: "205 psychological, psychosocial, and biological therapy profiles in Therapy Compass.",
    source: "src/data/therapies-index.json, src/data/therapies-source.json",
    toolHint: 'npm run therapy:review -- --write --slug "<slug>" --reviewed-by',
    signedRows,
    signableNow,
    indigenousHoldRows: [],
    awaitingPrerequisites: prerequisiteRows.length,
    prerequisiteRows,
    needsSigningSummary:
      signableNow === 0
        ? `All ${signedRows.length} therapies with source references are signed off. The remaining ${prerequisiteRows.length} therapy records have empty references: [] arrays and become signable once guideline references are added.`
        : `${signableNow} therapy record(s) ready to sign now; ${prerequisiteRows.length} awaiting guideline references.`,
    queueFamilyId: "therapy",
  });
}

function dictionaryDomain(): SignOffDomainSummary {
  const signedRows: SignedRecordRow[] = [];
  const indigenousHoldRows: UnsignedHoldRow[] = [];
  let signableNow = 0;
  let awaitingPrerequisites = 0;

  for (const review of dictionaryDefinitionReviews) {
    const href = `/dictionary/${review.entrySlug}`;
    const title = `${review.title} — ${review.verdict}`;
    if (isDefinitionReviewClinicallyApproved(review) && review.clinicalApproval) {
      signedRows.push({
        domain: "dictionary",
        key: `signed-dictionary-rewrite:${review.id}`,
        id: review.id,
        title,
        whatFor: `Clinician-approved proposed wording rewrite for /dictionary/${review.entrySlug}.`,
        signedBy: review.clinicalApproval.reviewer.trim(),
        signedAt: review.clinicalApproval.reviewedAt,
        href,
      });
    } else if (review.proposedWording) {
      if (isIndigenousContent([JSON.stringify(review)])) {
        indigenousHoldRows.push({
          domain: "dictionary",
          domainName: "Dictionary editorial layer",
          key: `hold-dictionary-rewrite:${review.id}`,
          id: review.id,
          title,
          reason: "Held for Aboriginal and Torres Strait Islander governance review.",
          href,
        });
      } else {
        signableNow += 1;
      }
    } else {
      awaitingPrerequisites += 1;
    }
  }

  const awaitingTool = dictionarySenseDrafts.length;

  return buildDomainSummary({
    id: "dictionary",
    name: "Dictionary editorial rewrites & sense drafts",
    whatFor:
      "96 editorial definition reviews (28 with proposed rewrites, 68 verdicts without rewrite text) and 333 unpublished sense drafts.",
    source: "src/data/dictionary-definition-reviews.json, src/data/dictionary-sense-drafts.json",
    toolHint: 'npm run clinical:review -- --write --kind dictionary-rewrite --code "<id>" --reviewed-by',
    signedRows,
    signableNow,
    indigenousHoldRows,
    awaitingPrerequisites,
    awaitingTool,
    needsSigningSummary:
      signableNow === 0
        ? `All ${signedRows.length} dictionary reviews that propose a rewrite are signed off. The remaining ${awaitingPrerequisites} definition reviews record a verdict without proposed rewrite text yet, and the ${awaitingTool} unpublished sense drafts have no sign-off tool yet.`
        : `${signableNow} proposed rewrite(s) ready to sign; ${awaitingPrerequisites} verdicts have no rewrite text yet; ${awaitingTool} sense drafts have no sign-off tool yet.`,
    queueFamilyId: "dictionary",
  });
}

function sourcesDomain(): SignOffDomainSummary {
  const activeRecords = sourceAcquisitionRecords.filter((record) => record.disposition !== "rejected");
  const rejectedCount = sourceAcquisitionRecords.length - activeRecords.length;
  const signedRows: SignedRecordRow[] = [];
  const indigenousHoldRows: UnsignedHoldRow[] = [];
  let signableNow = 0;

  for (const record of activeRecords) {
    const completeAttestation =
      typeof record.attestedBy === "string" &&
      record.attestedBy.trim().length > 0 &&
      typeof record.attestedAt === "string" &&
      typeof record.attestedAgainstSha256 === "string" &&
      record.attestedAgainstSha256 === acquisitionAttestedContentSha256(record);
    if (record.validationStatus !== "unverified" && completeAttestation) {
      signedRows.push({
        domain: "sources",
        key: `signed-source:${record.id}`,
        id: record.id,
        title: record.title,
        whatFor: `Governed Rung ${record.rung} (${record.jurisdiction}) clinical source (${record.publisher}, ${record.disposition}).`,
        signedBy: record.attestedBy!.trim(),
        signedAt: record.attestedAt!,
        href: null,
      });
    } else if (isIndigenousContent([JSON.stringify(record)])) {
      indigenousHoldRows.push({
        domain: "sources",
        domainName: "Source acquisitions",
        key: `hold-source:${record.id}`,
        id: record.id,
        title: record.title,
        reason: "Held for Aboriginal and Torres Strait Islander governance review.",
        href: null,
      });
    } else {
      signableNow += 1;
    }
  }

  return buildDomainSummary({
    id: "sources",
    name: "Governed source acquisitions",
    whatFor: `${activeRecords.length} active clinical guidelines, legislation, and reference sources verified under the 5-rung acquisition protocol (${rejectedCount} rejected captures are excluded).`,
    source: "src/data/source-acquisitions.json",
    toolHint: 'npm run clinical:review -- --write --kind source --code "<id>" --reviewed-by',
    signedRows,
    signableNow,
    indigenousHoldRows,
    needsSigningSummary:
      indigenousHoldRows.length > 0 && signableNow === 0
        ? `All ${signedRows.length} non-Indigenous active sources are signed off. ${indigenousHoldRows.length} Indigenous health and SEWB sources are held for Aboriginal governance review.`
        : `${signableNow} source(s) ready to sign now; ${indigenousHoldRows.length} held for Aboriginal governance review.`,
    queueFamilyId: "sources",
  });
}

function servicesDomain(): SignOffDomainSummary {
  type ServiceReviewEntry = {
    id: string;
    status: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
    reviewedContentSha256: string | null;
  };
  const entries = (serviceRecordsReviewJson as { entries: ServiceReviewEntry[] }).entries ?? [];
  const canonicalById = new Map(canonicalServiceRecords().map((service) => [service.id, service]));
  const signedRows: SignedRecordRow[] = [];
  const indigenousHoldRows: UnsignedHoldRow[] = [];
  let signableNow = 0;

  for (const entry of entries) {
    const service = canonicalById.get(entry.id);
    const title = service ? `${service.name} (${entry.id})` : entry.id;
    const signedBy = entry.reviewedBy?.trim();
    if (entry.status === "reviewed" && signedBy && entry.reviewedAt) {
      signedRows.push({
        domain: "services",
        key: `signed-service:${entry.id}`,
        id: entry.id,
        title,
        whatFor: service
          ? `Curated WA service directory record (${service.category} · ${service.catchments.slice(0, 2).join(", ")}).`
          : "Curated WA mental health service directory record.",
        signedBy,
        signedAt: entry.reviewedAt,
        href: "/services",
      });
    } else if (isIndigenousContent([JSON.stringify(service ?? entry)])) {
      indigenousHoldRows.push({
        domain: "services",
        domainName: "WA service directory records",
        key: `hold-service:${entry.id}`,
        id: entry.id,
        title,
        reason: "Held for Aboriginal and Torres Strait Islander governance review.",
        href: "/services",
      });
    } else {
      signableNow += 1;
    }
  }

  return buildDomainSummary({
    id: "services",
    name: "Stand-alone WA service directory records",
    whatFor:
      "25 curated WA mental health, crisis, postvention, youth, interpreter, and legal service records added after the 2026-08-24 site-content freeze.",
    source: "data/service-records-review.json, src/lib/services-canonical-data/",
    toolHint: 'npm run clinical:review -- --write --kind service --code "<SVC-...>" --reviewed-by',
    signedRows,
    signableNow,
    indigenousHoldRows,
    needsSigningSummary:
      indigenousHoldRows.length > 0 && signableNow === 0
        ? `All ${signedRows.length} non-Indigenous stand-alone WA service records are signed off. ${indigenousHoldRows.length} Aboriginal-specific service records (Thirrili, StandBy WA, Kimberley CADS Youth, Legal Yarn) are held for Aboriginal governance review.`
        : `${signableNow} service record(s) ready to sign now; ${indigenousHoldRows.length} held for Aboriginal governance review.`,
    queueFamilyId: null,
  });
}

/**
 * Complete sign-off ledger across all 13 governed domains in the repository:
 * every item that has been signed off (who signed it, when, and what it is for)
 * and every item that still needs signing off, grouped by why it is waiting.
 */
export function loadSignOffLedger(): SignOffLedger {
  const domains: readonly SignOffDomainSummary[] = [
    todayRulesDomain(),
    formsDomain(),
    mhaSectionsDomain(),
    mhaTimeframesDomain(),
    cpStandardsDomain(),
    culturalNotesDomain(),
    differentialsDomain(),
    formulationDomain(),
    specifiersDomain(),
    therapyDomain(),
    dictionaryDomain(),
    sourcesDomain(),
    servicesDomain(),
  ];

  const signedByTotals: Record<string, number> = {};
  let totalGoverned = 0;
  let totalSigned = 0;
  let totalWaiting = 0;
  let signableNow = 0;
  let indigenousHold = 0;
  let awaitingPrerequisites = 0;
  let awaitingTool = 0;

  for (const domain of domains) {
    totalGoverned += domain.total;
    totalSigned += domain.signedCount;
    totalWaiting += domain.waitingCount;
    signableNow += domain.needsSigning.signableNow;
    indigenousHold += domain.needsSigning.indigenousHold;
    awaitingPrerequisites += domain.needsSigning.awaitingPrerequisites;
    awaitingTool += domain.needsSigning.awaitingTool;
    for (const [signer, count] of Object.entries(domain.signedByCounts)) {
      signedByTotals[signer] = (signedByTotals[signer] ?? 0) + count;
    }
  }

  return {
    domains,
    totalGoverned,
    totalSigned,
    totalWaiting,
    signedByTotals,
    waitingByCategory: {
      signableNow,
      indigenousHold,
      awaitingPrerequisites,
      awaitingTool,
    },
  };
}
