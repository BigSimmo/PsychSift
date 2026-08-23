export type ForbiddenPublicSourceIdentity = "healthdirect" | "etg_complete" | "australian_medicines_handbook";

export type PublicSourceWorkerPolicyViolation = "protected_source_identity" | "public_source_policy_invalid";

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const acceptedSourcePolicyDigest = "sha256:02dcc095258338d0c355af79dfa1889c024f25f385b553e5b6c802207546855d";
const protectedCatalogueKeys = new Set(["healthdirect", "etg-complete", "australian-medicines-handbook"]);

// HTML's legacy named references are the names browsers may decode without a
// trailing semicolon in text. Match a valid prefix and preserve following text
// so `&nbspdirect` becomes a boundary plus `direct`, never the spelling `nbsp`.
const legacySemicolonlessHtmlReferences = [
  "aelig",
  "amp",
  "aacute",
  "acirc",
  "acute",
  "agrave",
  "aring",
  "atilde",
  "auml",
  "brvbar",
  "ccedil",
  "cedil",
  "cent",
  "copy",
  "curren",
  "deg",
  "divide",
  "eacute",
  "ecirc",
  "egrave",
  "eth",
  "euml",
  "frac12",
  "frac14",
  "frac34",
  "gt",
  "iacute",
  "icirc",
  "iexcl",
  "igrave",
  "iquest",
  "iuml",
  "laquo",
  "lt",
  "macr",
  "micro",
  "middot",
  "nbsp",
  "not",
  "ntilde",
  "oacute",
  "ocirc",
  "ograve",
  "ordf",
  "ordm",
  "oslash",
  "otilde",
  "ouml",
  "para",
  "plusmn",
  "pound",
  "quot",
  "raquo",
  "reg",
  "sect",
  "shy",
  "sup1",
  "sup2",
  "sup3",
  "szlig",
  "thorn",
  "times",
  "uacute",
  "ucirc",
  "ugrave",
  "uml",
  "uuml",
  "yacute",
  "yen",
  "yuml",
].sort((left, right) => right.length - left.length);

export function replaceHtmlCharacterReferencesWithBoundaries(input: string): string {
  let output = "";
  let index = 0;
  while (index < input.length) {
    if (input[index] !== "&") {
      output += input[index];
      index += 1;
      continue;
    }

    if (input[index + 1] === "#") {
      let cursor = index + 2;
      const hexadecimal = input[cursor]?.toLowerCase() === "x";
      if (hexadecimal) cursor += 1;
      const digitsStart = cursor;
      const digitPattern = hexadecimal ? /[0-9a-f]/i : /[0-9]/;
      while (cursor < input.length && digitPattern.test(input[cursor] ?? "")) cursor += 1;
      if (cursor > digitsStart) {
        if (input[cursor] === ";") cursor += 1;
        output += " ";
        index = cursor;
        continue;
      }
    } else {
      let cursor = index + 1;
      while (cursor < input.length && /[a-z0-9]/i.test(input[cursor] ?? "")) cursor += 1;
      const candidate = input.slice(index + 1, cursor);
      if (candidate && input[cursor] === ";") {
        output += " ";
        index = cursor + 1;
        continue;
      }
      const candidateLower = candidate.toLowerCase();
      const legacyName = legacySemicolonlessHtmlReferences.find((name) => candidateLower.startsWith(name));
      if (legacyName) {
        output += " ";
        index += legacyName.length + 1;
        continue;
      }
    }

    output += "&";
    index += 1;
  }
  return output;
}

function normalizedProtectedIdentity(value: string) {
  const decoded = replaceHtmlCharacterReferencesWithBoundaries(value)
    .normalize("NFKC")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .toLocaleLowerCase("en-AU")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { spaced: decoded, compact: decoded.replace(/\s+/g, "") };
}

export function forbiddenPublicSourceIdentity(value: string): ForbiddenPublicSourceIdentity | null {
  const { spaced, compact } = normalizedProtectedIdentity(value);
  if (compact.includes("healthdirect")) return "healthdirect";
  if (/(?:^| )etg(?: |$)/.test(spaced) || compact.includes("therapeuticguideline")) return "etg_complete";
  if (/(?:^| )amh(?: |$)/.test(spaced) || compact.includes("australianmedicineshandbook")) {
    return "australian_medicines_handbook";
  }
  return null;
}

export function containsForbiddenPublicSourceChunkContent(rows: ReadonlyArray<{ content: string }>): boolean {
  // Join with no separator as well as scanning individual rows so protected
  // identities split at a deterministic chunk boundary remain visible.
  return (
    rows.some((row) => forbiddenPublicSourceIdentity(row.content) !== null) ||
    forbiddenPublicSourceIdentity(rows.map((row) => row.content).join("")) !== null
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function publicSourcePolicyViolation(
  metadata: Record<string, unknown> | null | undefined,
  containsProtectedSourceContent = false,
): PublicSourceWorkerPolicyViolation | null {
  const value = metadata ?? {};
  const isPublicSource =
    value.corpus_scope === "australian_public" ||
    nonEmptyString(value.source_catalogue_key) ||
    nonEmptyString(value.public_source_lifecycle);
  if (!isPublicSource) return null;
  if (
    containsProtectedSourceContent ||
    nonEmptyString(value.forbidden_source_identity) ||
    (nonEmptyString(value.source_catalogue_key) && protectedCatalogueKeys.has(value.source_catalogue_key))
  ) {
    return "protected_source_identity";
  }
  if (
    value.corpus_scope !== "australian_public" ||
    !nonEmptyString(value.source_catalogue_key) ||
    value.source_policy_version !== "australian-source-policy-v1" ||
    value.source_policy_digest !== acceptedSourcePolicyDigest ||
    value.content_mode !== "indexed_content" ||
    value.licence_policy !== "public_index_permitted" ||
    !["shadow", "approved"].includes(String(value.public_source_lifecycle ?? "")) ||
    value.source_policy_checked !== true ||
    value.content_identity_verdict !== "clear" ||
    value.content_identity_verdict_version !== "public-source-content-identity-v1" ||
    value.content_identity_hash !== value.content_hash ||
    !digestPattern.test(String(value.source_content_hash ?? "")) ||
    !digestPattern.test(String(value.content_hash ?? "")) ||
    !nonEmptyString(value.source_exact_url) ||
    !nonEmptyString(value.source_exact_version) ||
    !digestPattern.test(String(value.licence_evidence_digest ?? ""))
  ) {
    return "public_source_policy_invalid";
  }
  return null;
}
