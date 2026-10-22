import registry from "@/data/reviewed-guidance-differences.json";
import { clientAnswerFieldsSchema } from "@/lib/answer-client-fields";
import type { RagAnswer } from "@/lib/types";

/**
 * Owner decision (Josh, 2026-10-21): when a WA guideline and a national guideline differ on a
 * point, the answer still follows WA and one plain line under it names the national source.
 * The line only ever comes from an owner-signed entry in `src/data/reviewed-guidance-differences.json`,
 * never from model or heuristic comparison, because a wrong "guidance differs" claim is itself a
 * clinical hazard. Mockup approved 2026-10-21 (Live site visual checks, item 8).
 */
export type ReviewedGuidanceDifference = {
  id: string;
  topic: string;
  waDocumentId: string;
  waChunkIds: string[];
  national: {
    documentId: string;
    chunkId: string;
    title: string;
    publisher: string;
    year: number;
    page: number | null;
  };
  signedOffBy: "owner";
  signedOffAt: string;
  reviewBy: string;
};

export type GuidanceDifferenceNote = {
  differenceId: string;
  title: string;
  year: number;
  page: number | null;
  documentId: string;
  chunkId: string;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isReviewedDifference(value: unknown): value is ReviewedGuidanceDifference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as ReviewedGuidanceDifference;
  const national = entry.national;
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.waDocumentId === "string" &&
    Array.isArray(entry.waChunkIds) &&
    entry.waChunkIds.length > 0 &&
    entry.waChunkIds.every((chunkId) => typeof chunkId === "string" && chunkId.length > 0) &&
    entry.signedOffBy === "owner" &&
    datePattern.test(entry.signedOffAt) &&
    datePattern.test(entry.reviewBy) &&
    Boolean(national) &&
    typeof national.documentId === "string" &&
    national.documentId.length > 0 &&
    national.documentId !== entry.waDocumentId &&
    typeof national.chunkId === "string" &&
    national.chunkId.length > 0 &&
    typeof national.title === "string" &&
    national.title.trim().length > 0 &&
    Number.isInteger(national.year) &&
    (national.page === null || (Number.isInteger(national.page) && national.page > 0))
  );
}

function noteFor(entry: ReviewedGuidanceDifference): GuidanceDifferenceNote {
  return {
    differenceId: entry.id,
    title: entry.national.title.trim(),
    year: entry.national.year,
    page: entry.national.page,
    documentId: entry.national.documentId,
    chunkId: entry.national.chunkId,
  };
}

/**
 * The client boundary rejects a whole answer whose `guidanceDifference` fails its schema, so an
 * entry is only active when the note it would build already passes that same schema.
 */
function passesClientBoundary(entry: ReviewedGuidanceDifference) {
  return clientAnswerFieldsSchema.safeParse({ guidanceDifference: noteFor(entry) }).success;
}

/** Entries that are well formed and not past their review-by date; malformed entries are dropped, not repaired. */
export function activeReviewedGuidanceDifferences(
  entries: readonly unknown[] = registry.differences,
  now: Date = new Date(),
): ReviewedGuidanceDifference[] {
  const today = now.toISOString().slice(0, 10);
  return entries
    .filter(isReviewedDifference)
    .filter(passesClientBoundary)
    .filter((entry) => entry.reviewBy >= today)
    .sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * The note for an answer, or `undefined`. It needs a grounded answer whose directly supported
 * claims cite a signed-off WA chunk; partial support, refusals and ungrounded answers never carry it.
 */
export function guidanceDifferenceNoteForAnswer(
  answer: Pick<RagAnswer, "grounded" | "supportedClaims" | "sources">,
  differences: readonly ReviewedGuidanceDifference[] = activeReviewedGuidanceDifferences(),
): GuidanceDifferenceNote | undefined {
  if (!answer.grounded || differences.length === 0) return undefined;
  const servedChunkIds = new Set(answer.sources.map((source) => source.id));
  const directChunkIds = new Set(
    (answer.supportedClaims ?? [])
      .filter((claim) => claim.supportStatus === "direct")
      .flatMap((claim) => claim.supportingChunkIds)
      .filter((chunkId) => servedChunkIds.has(chunkId)),
  );
  const match = differences.find((entry) => entry.waChunkIds.some((chunkId) => directChunkIds.has(chunkId)));
  return match ? noteFor(match) : undefined;
}

/** "Example National Guideline, 2023, p 11": the linked part of the line, shared by screen and clipboard. */
export function guidanceDifferenceLabel(note: Pick<GuidanceDifferenceNote, "title" | "year" | "page">) {
  return [note.title, String(note.year), note.page ? `p ${note.page}` : null].filter(Boolean).join(", ");
}

/** The whole line as plain text, for copied answers. */
export function guidanceDifferenceSentence(note: Pick<GuidanceDifferenceNote, "title" | "year" | "page">) {
  return `National guidance differs on this point. See ${guidanceDifferenceLabel(note)}.`;
}
