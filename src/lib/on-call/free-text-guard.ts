import { identifierShapeWarning } from "@/lib/clinical-ask/context";

const MAX_DETAILS_DEPTH = 8;

const extraIdentifierPatterns = [
  /\b(?:medical record|record|patient|hospital|u?mrn|urn|nhi)\s*(?:number|no\.?|#|id)?\s*[:=-]?\s*[A-Z0-9-]{4,}\b/i,
  /\b[A-Z]\d{6,8}\b/,
  /\b(?:dob|date of birth|born|d\.o\.b\.)\s*[:=-]?\s*(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/i,
  /\b(?:patient|pt)\s*[:=-]?\s*[A-Z][a-z]+\s+[A-Z][a-z]+\b/,
] as const;

function collectStrings(value: unknown, depth = 0, seen = new WeakSet<object>()): string[] {
  if (typeof value === "string") return [value];
  if (depth > MAX_DETAILS_DEPTH || typeof value !== "object" || value === null) return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStrings(item, depth + 1, seen));
  }
  return Object.values(value as Record<string, unknown>).flatMap((item) => collectStrings(item, depth + 1, seen));
}

function hasFreeTextIdentifier(text: string): boolean {
  return identifierShapeWarning(text) || extraIdentifierPatterns.some((pattern) => pattern.test(text));
}

/**
 * Spec review 11 & #HEWR5X: the server refuses text that looks like a patient
 * identifier across every On Call and Admin section's free-text fields.
 * Server-side only: the entries routes call it after parsing and before writing.
 */
export function adminFreeTextProblem(entry: {
  section: string;
  title: string;
  subtitle?: string | null;
  body?: string | null;
  details: unknown;
}): string | null {
  if (!entry.section || entry.section.trim().length === 0) return null;
  const fields = [entry.title, entry.subtitle, entry.body, ...collectStrings(entry.details)];
  return fields.some((field) => typeof field === "string" && hasFreeTextIdentifier(field))
    ? "Keep patient details out of Admin records. Say where your proof is, for example: email from Ahpra."
    : null;
}
