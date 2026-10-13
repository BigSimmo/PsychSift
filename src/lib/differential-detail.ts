import type { DifferentialCuratedEntry } from "@/lib/differential-curated";
import type { DifferentialSourceStatus, DifferentialValidationStatus } from "@/lib/differential-records";
import type {
  DifferentialLikelihood,
  DifferentialMapNode,
  DifferentialRecord,
  DifferentialSection,
} from "@/lib/differential-snapshot";

/** Pure presentation helpers for the differential diagnosis detail page.
 *  Client-safe by design: type-only imports and no catalog/snapshot access —
 *  the generated snapshot JSON must never enter the client bundle. Anything
 *  that needs the full catalog is computed server-side and travels in
 *  DifferentialDetailContext. */

export const DETAIL_TAB_IDS = ["overview", "compare", "map", "related", "source"] as const;
export type DifferentialDetailTabId = (typeof DETAIL_TAB_IDS)[number];

export type DifferentialRelatedMapDetail = {
  slug: string;
  title: string;
  status: DifferentialRecord["status"];
  clinicalHinge: string;
  /**
   * Scope of `clinicalHinge`. Every current record's hinge is its presentation
   * group's, so the map must label it rather than present it as this related
   * diagnosis's own discriminator. See `tests/differentials-presentation-scope.test.ts`.
   */
  clinicalHingeScope?: DifferentialRecord["clinicalHingeScope"];
  safetySummary: string;
};

export function isDetailTabId(value: string | null | undefined): value is DifferentialDetailTabId {
  return typeof value === "string" && (DETAIL_TAB_IDS as readonly string[]).includes(value);
}

export type DifferentialDetailContext = {
  /** related[].id values verified against the diagnosis catalog (safe to link). */
  knownRelatedSlugs: string[];
  /**
   * Small, server-derived summaries for verified related diagnoses. Keeping this
   * separate from `record.related` lets the map inspector show the selected
   * diagnosis's own hinge and safety content without shipping the full catalog
   * through the client boundary.
   */
  relatedMapDetails: Record<string, DifferentialRelatedMapDetail>;
  /**
   * Cleaned Watch-for tags + section item labels → diagnosis slug.
   * Exact catalog title or curated alias only (see differential-diagnosis-links).
   */
  termLinks: Record<string, string>;
  /**
   * Cleaned mimic/overlap item text → diagnosis slug.
   * Derived subset of `termLinks` for overlap-tone items (back-compat).
   */
  overlapLinks: Record<string, string>;
  /** First presentation workflow that lists this diagnosis as a candidate. */
  comparePresentation: { slug: string; title: string } | null;
  /**
   * This record's authored overlay entry, resolved server-side. Only the entry
   * for the record on screen crosses the boundary, so the authored prose of
   * every other record stays out of the client bundle.
   */
  curated: DifferentialCuratedEntry | null;
  source: {
    version: string;
    exportedAt: string;
    reviewStatus: string;
    sourceTitle: string;
    sourceStatus: DifferentialSourceStatus;
    validationStatus: DifferentialValidationStatus;
  };
};

/** Normalizes a generated snapshot item for display: collapses whitespace and
 *  strips the lone trailing full stop the export leaves on short fragments
 *  ("medication toxicity.") without touching real sentences or "e.g.". */
export function cleanDifferentialItem(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.endsWith(".") && collapsed.length <= 64 && !collapsed.slice(0, -1).includes(".")) {
    return collapsed.slice(0, -1).trimEnd();
  }
  return collapsed;
}

function comparableItemText(value: string) {
  return value.replace(/\s+/g, " ").trim().replace(/\.$/, "").toLowerCase();
}

/** Items actually worth rendering inside an expanded section. The generated
 *  export is noisy: `action`/`test` sections carry truncated copies of the
 *  record-level arrays (so prefer those), and many items duplicate the row
 *  summary or the record's clinical hinge. */
export function visibleSectionItems(section: DifferentialSection, record: DifferentialRecord): string[] {
  const source = section.tone === "test" && record.investigations.length > 0 ? record.investigations : section.items;
  const excluded = new Set([section.summary, record.clinicalHinge].map(comparableItemText).filter(Boolean));
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of source) {
    const cleaned = cleanDifferentialItem(raw);
    if (!cleaned) continue;
    const key = comparableItemText(cleaned);
    if (!key || excluded.has(key) || seen.has(key)) continue;
    seen.add(key);
    items.push(cleaned);
  }
  return items;
}

/** The noun each counted section is made of, singular then plural. The badge
 *  counts reference bullets, not findings about a patient, so it must name
 *  what is counted and never read as an assessment state such as "present",
 *  "possible", "positive" or "pending" (#KZDNNX, owner decision 2026-09-25). */
const sectionBadgeNoun: Partial<Record<DifferentialSection["tone"], readonly [string, string]>> = {
  fit: ["feature", "features"],
  warning: ["cause", "causes"],
  question: ["clue", "clues"],
  action: ["step", "steps"],
};

/** Count badge text for a section row, using the cleaned item count so the
 *  badge always matches the expanded list; null when there is nothing to show. */
export function sectionBadgeLabel(section: DifferentialSection, record: DifferentialRecord): string | null {
  const count = visibleSectionItems(section, record).length;
  if (count === 0) return null;
  const noun = sectionBadgeNoun[section.tone];
  if (!noun) return String(count);
  return `${count} ${count === 1 ? noun[0] : noun[1]}`;
}

export function differentialStatusLabel(status: DifferentialRecord["status"]): "Emergent" | "Urgent" | "Routine" {
  if (status === "emergent") return "Emergent";
  if (status === "urgent") return "Urgent";
  return "Routine";
}

/** Shown wherever authored content renders. Curated text is local clinical
 *  reference, not an extract from an indexed source, and must read that way.
 *  Declared here rather than beside the corpus so a client component can label
 *  authored content without importing every record's authored prose. */
export const curatedProvenanceLabel = "Locally authored \u2014 verify before use";

const reviewDateFormat = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Perth",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * The provenance line for one record's authored content. Once a clinician has signed
 * the overlay off (`npm run clinical:review -- --kind differential`), it names them in
 * place of "verify before use"; until then it is `curatedProvenanceLabel`.
 */
export function curatedProvenanceFor(curated: DifferentialCuratedEntry | null): string {
  const review = curated?.review;
  if (!review?.reviewedBy || !review.reviewedAt) return curatedProvenanceLabel;
  const date = new Date(review.reviewedAt);
  if (Number.isNaN(date.getTime())) return curatedProvenanceLabel;
  return `Locally authored, reviewed by ${review.reviewedBy} on ${reviewDateFormat.format(date)}`;
}

export type DifferentialSafetyFact = {
  id: "high-risk" | "onset" | "course" | "treatable" | "causes" | "tests" | "actions" | "related";
  label: string;
  value: string;
};

/** Clinically reviewed course facts now live in `differential-curated.ts` with
 *  the rest of the authored overlay. Only records listed there show qualitative
 *  Onset/Course/Treatable facts — every other record falls back to counts
 *  derived from its own data, so the card never fabricates clinical attributes
 *  the snapshot does not carry. */
export function resolveSafetyFacts(
  record: DifferentialRecord,
  curated: DifferentialCuratedEntry | null,
): DifferentialSafetyFact[] {
  const authored = curated?.atAGlance;
  if (authored?.length) return authored;

  const facts: DifferentialSafetyFact[] = [];
  const mustNotMiss = record.sections.find((section) => section.id === "must-not-miss");
  const causeCount = mustNotMiss ? visibleSectionItems(mustNotMiss, record).length : 0;
  if (causeCount > 0) facts.push({ id: "causes", label: "High-risk causes", value: String(causeCount) });
  if (record.investigations.length > 0) {
    facts.push({ id: "tests", label: "Core tests", value: String(record.investigations.length) });
  }
  if (record.immediateActions.length > 0) {
    facts.push({ id: "actions", label: "Immediate actions", value: String(record.immediateActions.length) });
  }
  if (record.related.length > 0) {
    facts.push({ id: "related", label: "Related differentials", value: String(record.related.length) });
  }
  return facts.slice(0, 4);
}

function normalizeSafetyToken(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:]+$/g, "")
    .toLowerCase();
}

/** Split a summary or tag into comparable watch-for tokens (comma, slash, "and"). */
function splitSafetyTokens(value: string): string[] {
  return value
    .split(/\s*(?:,|\/|\band\b)\s*/i)
    .map(normalizeSafetyToken)
    .filter(Boolean);
}

/** True when every summary token is already covered by the Watch-for tags.
 *  Prefer tags in the card; keep the summary whenever it adds any unique risk
 *  token (tags being a subset of the summary must not hide those extras). */
export function isRedundantSafetySummary(summary: string, tags: readonly string[]): boolean {
  const summaryTokens = [...new Set(splitSafetyTokens(summary))];
  if (summaryTokens.length === 0) return true;

  const tagTokens = [...new Set(tags.flatMap((tag) => splitSafetyTokens(tag)))];
  if (tagTokens.length === 0) return false;

  const tagSet = new Set(tagTokens);
  return summaryTokens.every((token) => tagSet.has(token));
}

/** Deterministic plain-text register of the record for the "Copy after
 *  review" action: headline, hinge, safety summary, then actionable lists,
 *  ending with the on-page disclaimer. */
export function formatDifferentialCopyText(record: DifferentialRecord): string {
  // The hinge, immediate actions and investigations are written about the
  // presentation group, not this diagnosis. Copied text ends up in a medical
  // record, so each of those blocks says whose text it is rather than reading as
  // an instruction for this diagnosis. See differentialGroupLabel below.
  const group = differentialGroupLabel(record);
  const groupSuffix = group
    ? ` (${group} group, not specific to ${record.title})`
    : " (presentation group, not diagnosis-specific)";
  const hingeScoped = record.clinicalHingeScope === "presentation";
  const lines: string[] = [`${record.title} — ${differentialStatusLabel(record.status)} differential`];
  if (record.subtitle.trim()) lines.push(record.subtitle.trim());
  if (record.clinicalHinge.trim()) {
    lines.push(
      "",
      `${hingeScoped ? `Presentation hinge${groupSuffix}` : "Clinical hinge"}: ${record.clinicalHinge.trim()}`,
    );
  }
  if (record.safetySnapshot.summary.trim()) {
    lines.push("", `Must-not-miss: ${record.safetySnapshot.summary.trim()}`);
  }
  const actions = record.immediateActions.map(cleanDifferentialItem).filter(Boolean).slice(0, 6);
  if (actions.length > 0) {
    lines.push("", `Immediate actions${groupSuffix}:`);
    for (const action of actions) lines.push(`- ${action}`);
  }
  const investigations = record.investigations.map(cleanDifferentialItem).filter(Boolean);
  if (investigations.length > 0) {
    lines.push("", `Investigations${groupSuffix}:`);
    for (const investigation of investigations) lines.push(`- ${investigation}`);
  }
  lines.push("", "Clinical reference — not validated decision support. Review before use.");
  return lines.join("\n");
}

/** The presentation group a record was derived from, for labelling text that
 *  belongs to the group rather than the diagnosis. */
export function differentialGroupLabel(record: DifferentialRecord): string {
  return record.currentPresentation.find((value) => value.trim())?.trim() ?? "";
}

/**
 * The warning that goes above generated first-moves: they are written about the
 * presentation group and stamped onto every diagnosis in it, so unlabelled they
 * read as specific to this one.
 *
 * Shared rather than duplicated because it now has two surfaces — the desktop
 * rail and the phone card — and the phone card shipped without it, which is
 * exactly the drift a second copy invites.
 */
export function differentialGroupScopeNote(record: DifferentialRecord): string {
  const group = differentialGroupLabel(record);
  return group
    ? `Applies to the ${group} group — not specific to ${record.title}`
    : `Applies to the presentation group — not specific to ${record.title}`;
}

/** Label for a section whose text describes the presentation group rather than
 *  this diagnosis, or null when the section is the diagnosis's own. */
export function sectionScopeLabel(section: DifferentialSection, record: DifferentialRecord): string | null {
  if (section.scope !== "presentation") return null;
  const group = differentialGroupLabel(record);
  return group ? `Applies to the ${group} group` : "Applies to the presentation group";
}

const clinicalHingePrefix = /^clinical hinge:\s*/i;

export type CurrentPresentationView =
  | { kind: "grouped"; groups: Array<{ title: string; candidates: string; hinge: string }> }
  | { kind: "flat"; items: Array<{ text: string; isHinge: boolean }> };

/** The generated currentPresentation list is usually a strict triplet stream
 *  (presentation title / candidate list / "CLINICAL HINGE: …") but many
 *  records deviate; fall back to a flat list with per-item hinge detection. */
export function groupCurrentPresentation(items: string[]): CurrentPresentationView {
  const cleaned = items.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean);
  const isTripletStream =
    cleaned.length >= 3 &&
    cleaned.length % 3 === 0 &&
    cleaned.every((item, index) => clinicalHingePrefix.test(item) === (index % 3 === 2));
  if (isTripletStream) {
    const groups: Array<{ title: string; candidates: string; hinge: string }> = [];
    for (let index = 0; index < cleaned.length; index += 3) {
      groups.push({
        title: cleaned[index]!,
        candidates: cleaned[index + 1]!,
        hinge: cleaned[index + 2]!.replace(clinicalHingePrefix, ""),
      });
    }
    return { kind: "grouped", groups };
  }
  return {
    kind: "flat",
    items: cleaned.map((text) => ({
      text: text.replace(clinicalHingePrefix, ""),
      isHinge: clinicalHingePrefix.test(text),
    })),
  };
}

export function differentialSourceStatusLabel(status: DifferentialSourceStatus): string {
  if (status === "current") return "Current";
  if (status === "review_due") return "Review due";
  if (status === "outdated") return "Outdated";
  return "Unknown";
}

export function differentialValidationStatusLabel(status: DifferentialValidationStatus): string {
  if (status === "approved") return "Approved";
  if (status === "locally_reviewed") return "Locally reviewed";
  return "Unverified";
}

/** Date-only slice of the snapshot's exportedAt ISO stamp; avoids
 *  locale-dependent formatting that could mismatch between server and client. */
export function formatExportedDate(exportedAt: string): string {
  const match = exportedAt.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : exportedAt;
}

/** Trailing counts for the section rail. `null` means the tab carries no
 *  countable collection, so the rail renders the label alone rather than a
 *  misleading zero — Source is a governance panel, not a list of things. */
export function detailTabCounts(
  record: DifferentialRecord,
  compareCount?: number,
): Record<DifferentialDetailTabId, number | null> {
  return {
    // No count. "Overview 6" would be a tally of section rows, which is a fact
    // about the layout rather than about the patient — and the tab already
    // carries that number in its section-sheet detail line.
    overview: null,
    // The compare queue is this diagnosis plus everything it is compared against.
    // Passed in rather than recomputed: the queue is capped and only carries
    // related diagnoses that resolve to a page, so deriving it here from
    // `record.related` made the tab disagree with the Compare button on the same
    // screen — "Compare (3)" on the control, "Compare (4)" on the tab.
    compare: compareCount ?? record.related.length + 1,
    map: record.related.length + 1,
    related: record.related.length || null,
    source: null,
  };
}

/**
 * Ordered first moves. Clinician-authored steps where a record has them,
 * otherwise the record's own generated immediate actions.
 *
 * `generatedLimit` caps the GENERATED fallback only, which is unreviewed and
 * often runs to a noisy list. An authored list is returned whole. That
 * distinction was bought the hard way on 2026-09-16: the cap applied to both,
 * seven of the ten authored records carry five steps, and in six of those the
 * fifth is the escalation instruction — "escalate to intensive care", "involve
 * the perinatal mental health service", "escalate for a seizure". The only
 * surface rendering these steps was therefore dropping the escalation from
 * every one of them. A reviewed clinical list is not the layout's to shorten;
 * if it ever grows too long for a surface, that surface discloses the rest.
 */
export function resolveDoNowSteps(
  record: DifferentialRecord,
  curated: DifferentialCuratedEntry | null,
  generatedLimit = 4,
): string[] {
  const authored = curated?.doNow;
  const isAuthored = Boolean(authored?.length);
  const source = isAuthored ? authored! : record.immediateActions;
  const limit = isAuthored ? Number.POSITIVE_INFINITY : generatedLimit;
  const seen = new Set<string>();
  const steps: string[] = [];
  for (const raw of source) {
    const cleaned = cleanDifferentialItem(raw);
    if (!cleaned) continue;
    const key = comparableItemText(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    steps.push(cleaned);
    if (steps.length >= limit) break;
  }
  return steps;
}

/** True when the record's own steps were replaced by authored ones, so the
 *  surface rendering them can say so. */
/** Heading for the first-moves card. Authored steps are actions ("Do now");
 *  generated text is written about the presentation group and reads as points,
 *  not steps, so it is not labelled as actions. */
export function doNowHeading(authored: boolean): string {
  return authored ? "Do now" : "Points for this presentation";
}

export function doNowStepsAreCurated(curated: DifferentialCuratedEntry | null): boolean {
  return (curated?.doNow?.length ?? 0) > 0;
}

export function curatedContentNote(curated: DifferentialCuratedEntry | null): string | null {
  return curated?.contentNote ?? null;
}

/**
 * True when this record's generated sections must not be rendered at all.
 *
 * Distinct from `curatedContentNote`, which warns about a body that is still
 * shown. This withholds it. See the field's own comment in
 * `differential-curated.ts` for the ruling behind it.
 */
export function generatedBodyWithheld(curated: DifferentialCuratedEntry | null): boolean {
  return curated?.generatedBodyUnreliable === true;
}

/**
 * Strip the generated body from a record whose export is known to describe a
 * different diagnosis.
 *
 * Every field emptied here is one the generated export asserts *about this
 * diagnosis*: the sections, the clinical hinge, the immediate actions and the
 * current-presentation list. The safety snapshot and investigations are correct
 * for the record and stay. `related` stays too, because emptying it would take
 * the Compare, Map and Related tabs down with it for no safety gain — the nodes
 * describe real conditions, they are just the wrong siblings, which the content
 * note says.
 *
 * Every consumer of these fields already handles the empty case, so one call at
 * the page boundary is enough: the hinge block returns null, the section list
 * renders nothing, and the clipboard text drops both. Records that are not
 * withheld are returned by identity, so this costs nothing on the other 200.
 */
export function withholdGeneratedBody(
  record: DifferentialRecord,
  curated: DifferentialCuratedEntry | null,
): DifferentialRecord {
  if (!generatedBodyWithheld(curated)) return record;
  return { ...record, sections: [], clinicalHinge: "", immediateActions: [], currentPresentation: [] };
}

export function hasCuratedContent(curated: DifferentialCuratedEntry | null): boolean {
  if (!curated) return false;
  return Boolean(
    curated.atAGlance?.length || curated.doNow?.length || curated.discriminators?.length || curated.contentNote,
  );
}

/** One row of the map's "tell them apart" table. */
export type DifferentialDiscriminatorRow = {
  slug: string;
  label: string;
  likelihood: DifferentialLikelihood;
  /** Set only for a slug verified against the catalogue, so no row links nowhere. */
  href: string | null;
  favoursRelated: string;
  /** Null when the record carries nothing that distinguishes it from this one —
   *  an empty cell is honest, an echo of the other column is not. */
  favoursFocus: string | null;
  curated: boolean;
};

/**
 * Builds the comparison rows for the map panel.
 *
 * Authored discriminators win where a record has them. Otherwise the row is
 * derived from data the catalogue already carries: the related diagnosis's own
 * clinical hinge (server-supplied in `relatedMapDetails`, falling back to the
 * edge's relationship note) against this record's hinge. Nothing is invented,
 * so a sparse record produces a sparse table rather than a confident-looking
 * empty one.
 */
export function buildDiscriminators(
  record: DifferentialRecord,
  options: {
    knownRelatedSlugs: readonly string[];
    relatedMapDetails: Record<string, DifferentialRelatedMapDetail>;
    curated?: DifferentialCuratedEntry | null;
  },
): DifferentialDiscriminatorRow[] {
  const known = new Set(options.knownRelatedSlugs);
  const curated = new Map((options.curated?.discriminators ?? []).map((entry) => [entry.relatedSlug, entry]));
  // A presentation-scoped hinge is the group's, and every candidate in the group
  // carries the same one — it cannot tell two of them apart, and printing it in a
  // "tell them apart" cell asserts it of that diagnosis. Fall through to the
  // per-edge relationship note, which is authored against this exact pair.
  const focusHinge = record.clinicalHingeScope === "presentation" ? "" : cleanDifferentialItem(record.clinicalHinge);

  return record.related.map((node: DifferentialMapNode) => {
    const authored = curated.get(node.id);
    const detail = options.relatedMapDetails[node.id];
    const relatedHinge = detail?.clinicalHingeScope === "presentation" ? "" : (detail?.clinicalHinge ?? "");
    const derivedRelated = cleanDifferentialItem(relatedHinge || node.note || "");
    const favoursRelated = authored ? authored.favoursRelated : derivedRelated;
    const favoursFocusRaw = authored ? authored.favoursFocus : focusHinge;
    const distinct =
      Boolean(favoursFocusRaw) && comparableItemText(favoursFocusRaw) !== comparableItemText(favoursRelated);

    return {
      slug: node.id,
      label: node.label,
      likelihood: node.likelihood,
      href: known.has(node.id) ? `/differentials/diagnoses/${node.id}` : null,
      favoursRelated,
      favoursFocus: distinct ? favoursFocusRaw : null,
      curated: Boolean(authored),
    };
  });
}
