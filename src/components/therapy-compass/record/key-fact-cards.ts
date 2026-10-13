import { summarise } from "../data/select";
import type { Therapy } from "../data/types";
import { extractCitations } from "../prose";

/** Phone 2-up tile budget: two lines of `text-sm-minus`, never a mid-word clip. */
export const KEY_FACT_GLANCE_MAX_CHARS = 64;

export type TherapyKeyFactId = "cautions" | "format" | "setting" | "suits";

export type TherapyKeyFactCard = {
  id: TherapyKeyFactId;
  label: string;
  face: string;
  body: string;
  hasDetail: boolean;
};

/**
 * A complete glance phrase that fits the tile.
 *
 * Citation markers come off first so a trailing `(PubMed)` cannot eat the
 * budget. The first sentence is kept when it already fits; otherwise the cut
 * is at the last word boundary and an ellipsis is added. A mid-word clip
 * without `…` is the defect this exists to stop.
 */
export function glanceLine(text: string | null | undefined, options: { maxChars?: number } = {}): string {
  const maxChars = options.maxChars ?? KEY_FACT_GLANCE_MAX_CHARS;
  const raw = text?.trim() ?? "";
  if (!raw) return "";

  const stripped = extractCitations(raw).text;
  const first = summarise(stripped, 1) || stripped;
  if (first.length <= maxChars) return first;

  const budget = Math.max(1, maxChars - 1);
  const slice = first.slice(0, budget);
  const lastSpace = slice.lastIndexOf(" ");
  const trimmed = (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).replace(/[.,;:]+$/, "").trim();
  return trimmed ? `${trimmed}…` : `${slice.trimEnd()}…`;
}

/**
 * Comma-separated glance: one item as-is (or trimmed to the budget), otherwise
 * `{first} +N` so overflow is a count, not a hanging cutoff.
 */
export function glanceList(text: string | null | undefined, options: { maxChars?: number } = {}): string {
  const maxChars = options.maxChars ?? KEY_FACT_GLANCE_MAX_CHARS;
  const items = (text ?? "")
    .split(/\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!items.length) return "";
  if (items.length === 1) return glanceLine(items[0], { maxChars });

  const suffix = ` +${items.length - 1}`;
  const first = glanceLine(items[0], { maxChars: Math.max(12, maxChars - suffix.length) });
  return `${first}${suffix}`;
}

function cautionBody(therapy: Therapy): string {
  const cautions = therapy.contraindicationsOrCautions?.trim() ?? "";
  const limitations = therapy.limitations?.trim() ?? "";
  if (limitations && !cautions.includes(limitations)) {
    return `${cautions} ${limitations}`.trim();
  }
  return cautions;
}

function cautionFace(body: string): string {
  const stripped = extractCitations(body).text;
  return summarise(stripped, 1) || stripped;
}

function hasExtraDetail(face: string, body: string): boolean {
  const faceText = face.trim();
  const bodyText = body.trim();
  return Boolean(bodyText) && bodyText !== faceText;
}

/**
 * The four glance cards for a therapy record.
 *
 * Evidence/source is deliberately absent: review status is on the hero badge
 * and provenance is the collapsed strip at the foot. Cautions is the bedside
 * replacement. Faces are derived, so every catalogue row gets the same cards
 * without per-record copy.
 */
export function therapyKeyFactCards(therapy: Therapy): TherapyKeyFactCard[] {
  const cautionsBody = cautionBody(therapy) || "Cautions not recorded";
  // Cautions is a safety cue, so its face is never cut to the glance budget: it shows the
  // whole first sentence (citation markers lifted off), the same wording as the Avoid /
  // modify line on search and Recommend. The full field sits directly under the tiles.
  const cautionsFace = cautionBody(therapy) ? cautionFace(cautionsBody) : "Cautions not recorded";

  const formatText = therapy.sessionLength?.trim() || therapy.timeRequired?.trim() || "";
  const formatFace = formatText ? glanceLine(formatText) : "Format not recorded";
  const formatBody = therapy.timeRequired?.trim() || formatText || formatFace;

  const settingRecorded = Boolean(therapy.setting?.trim());
  const settingBody = therapy.setting?.trim() || "Setting not recorded";
  const settingFace = settingRecorded ? glanceList(therapy.setting) : "Setting not recorded";

  const suitsRecorded = Boolean(therapy.patientPopulation?.trim());
  const suitsBody = therapy.patientPopulation?.trim() || "Audience not recorded";
  const suitsFace = suitsRecorded ? glanceLine(therapy.patientPopulation) : "Audience not recorded";

  return [
    {
      id: "cautions",
      label: "Cautions",
      face: cautionsFace,
      body: cautionsBody,
      hasDetail: hasExtraDetail(cautionsFace, cautionsBody),
    },
    {
      id: "format",
      label: "Format",
      face: formatFace,
      body: formatBody,
      hasDetail: hasExtraDetail(formatFace, formatBody),
    },
    {
      id: "setting",
      label: "Setting",
      face: settingFace,
      body: settingBody,
      hasDetail: hasExtraDetail(settingFace, settingBody),
    },
    {
      id: "suits",
      label: "Suits",
      face: suitsFace,
      body: suitsBody,
      hasDetail: hasExtraDetail(suitsFace, suitsBody),
    },
  ];
}
