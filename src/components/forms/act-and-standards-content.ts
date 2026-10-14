import chiefPsychiatristStandards from "../../../data/chief-psychiatrist-standards.json";
import formsActSectionCues from "../../../data/forms-act-section-cues.json";
import mhaSections from "../../../data/mha-2014-sections.json";
import { signedOffReviewer } from "@/lib/forms-reference-sign-off";
import { safeCanonicalSourceUrl } from "@/lib/sources/source-url-policy";

/**
 * Data assembly for the Forms "Act and Standards" page (`/forms/act`).
 *
 * Every input is a JSON import, so it is bundled at build. The runtime image does not
 * ship `data/`, so nothing here may read from disk at request time.
 */

export type ActReferenceSection = {
  section: string;
  title: string;
  summary?: string;
  status: "reviewed" | "drafted" | "pending";
};

export type ActReferenceGroup = {
  id: string;
  title: string;
  sections: ActReferenceSection[];
};

/** Accepts the raw JSON import, where `status` is widened to `string`. */
type CuratedSectionsFile = {
  sections: readonly { section: string; title: string; summary?: string; status: string }[];
};
type ReferenceTopicsFile = {
  referenceTopics?: readonly { id: string; title: string; sections: readonly string[]; basis?: string }[];
};

/** `--check` rejects any other status; anything unrecognised still renders as unwritten. */
function sectionStatus(status: string): ActReferenceSection["status"] {
  return status === "reviewed" || status === "drafted" ? status : "pending";
}

export const OTHER_FORM_SECTIONS_GROUP_ID = "other-form-sections";

const compareSections = (a: string, b: string) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b);

/**
 * Every curated Act section, grouped for reading: the reference topics first (in the
 * order the cue file states them), then every other section the forms cite, in
 * numeric order. Each section appears exactly once — a section in two topics shows
 * under the first.
 *
 * Throws when a topic names a section with no curated entry: `--check` already fails
 * on that, and rendering a heading with nothing under it would read as "the Act says
 * nothing here".
 */
export function actReferenceGroups(curated: CuratedSectionsFile, cues: ReferenceTopicsFile): ActReferenceGroup[] {
  const bySection = new Map<string, ActReferenceSection>(
    curated.sections.map((entry) => [
      entry.section,
      { section: entry.section, title: entry.title, summary: entry.summary, status: sectionStatus(entry.status) },
    ]),
  );
  const shown = new Set<string>();

  const topics = (cues.referenceTopics ?? []).map((topic) => ({
    id: topic.id,
    title: topic.title,
    sections: topic.sections.flatMap((section) => {
      const entry = bySection.get(section);
      if (!entry) {
        throw new Error(`Act reference topic ${topic.id} names section ${section}, which has no curated entry.`);
      }
      if (shown.has(section)) return [];
      shown.add(section);
      return [entry];
    }),
  }));

  const other = [...bySection.values()]
    .filter((entry) => !shown.has(entry.section))
    .sort((left, right) => compareSections(left.section, right.section));

  return [
    ...topics,
    ...(other.length
      ? [{ id: OTHER_FORM_SECTIONS_GROUP_ID, title: "Other sections cited by forms", sections: other }]
      : []),
  ];
}

/** The page's groups, from the committed curated summaries and cue file. */
export function loadActReferenceGroups(): ActReferenceGroup[] {
  return actReferenceGroups(mhaSections, formsActSectionCues);
}

export type ChiefPsychiatristStandard = {
  id: string;
  title: string;
  summary: string;
  /** Only a governed https URL; anything else renders no link. */
  sourceUrl: string | null;
  /**
   * True only for a complete, well-formed `npm run clinical:review` sign-off (status,
   * named reviewer, real UTC timestamp and content pin) on non-Indigenous content.
   */
  reviewed: boolean;
  /** The signing reviewer's public name when `reviewed`; otherwise null. */
  reviewedBy: string | null;
  /** The sign-off's UTC timestamp when `reviewed`; otherwise null. */
  reviewedAt: string | null;
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * Validates the Standards data defensively. Another workstream writes it, so a
 * malformed file or entry must leave the page rendering — with the Standards section
 * omitted or the bad entry dropped, never half-drawn.
 */
export function parseChiefPsychiatristStandards(value: unknown): ChiefPsychiatristStandard[] | null {
  if (!value || typeof value !== "object") return null;
  const standards = (value as { standards?: unknown }).standards;
  if (!Array.isArray(standards)) return null;

  return standards.flatMap((raw): ChiefPsychiatristStandard[] => {
    if (!raw || typeof raw !== "object") return [];
    const entry = raw as Record<string, unknown>;
    const id = text(entry.id);
    const title = text(entry.title);
    const summary = text(entry.summary);
    if (!id || !title || !summary) return [];
    const reviewedBy = signedOffReviewer(entry, [title, summary]);
    return [
      {
        id,
        title,
        summary,
        sourceUrl: safeCanonicalSourceUrl(text(entry.sourceUrl) || null),
        reviewed: reviewedBy !== null,
        reviewedBy,
        reviewedAt: reviewedBy !== null ? text(entry.reviewedAt) || null : null,
      },
    ];
  });
}

/** The committed Standards summaries; `null` only if the file's shape is unusable. */
export function loadChiefPsychiatristStandards(): ChiefPsychiatristStandard[] | null {
  return parseChiefPsychiatristStandards(chiefPsychiatristStandards);
}
