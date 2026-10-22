// Pure text, JSONB and hashing helpers for ingestion writes. Moved verbatim from worker/main.ts.
import { createHash } from "node:crypto";

export function cleanString(val: string): string {
  if (typeof val !== "string") return val;
  return val
    .replace(/\u0000/g, "")
    .replace(/\\u0000/g, "")
    .toWellFormed();
}

type JsonbValue = string | number | boolean | null | { [key: string]: JsonbValue } | JsonbValue[];
type JsonbRecord = { [key: string]: JsonbValue };

function sanitizeJsonb(val: unknown): JsonbValue {
  if (typeof val === "string") return cleanString(val);
  if (Array.isArray(val)) return val.map((entry) => sanitizeJsonb(entry));
  if (val !== null && typeof val === "object") {
    const raw = val as { [key: string]: unknown };
    const res: JsonbRecord = {};
    for (const [key, value] of Object.entries(raw)) {
      res[key] = sanitizeJsonb(value);
    }
    return res;
  }
  return val as JsonbValue;
}

export function sanitizeJsonbRecord(value: unknown): JsonbRecord {
  const sanitized = sanitizeJsonb(value);
  return typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized) ? sanitized : {};
}

export function hashBytes(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function hashText(text: string) {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex");
}

export function hashEmbeddingFieldContent(content: string) {
  return createHash("md5").update(content).digest("hex");
}

export function compactSearchText(value: unknown, limit = 900) {
  const compact = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "";
  return compact.length > limit ? compact.slice(0, limit).trim() : compact;
}
