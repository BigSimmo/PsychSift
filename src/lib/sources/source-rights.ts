import { strictSourceDate } from "@/lib/sources/source-date-policy";

/**
 * Rights and licence status for one source in the acquisition register
 * (regulatory audit finding R-07, ledger #SQ2FG9).
 *
 * The register records what a source says and who signed it off, but until now
 * nothing recorded whether the publisher lets us show it publicly or use it with
 * AI. This field gives that a typed home so it can be checked per source.
 *
 * It is record-keeping only. Nothing that readers see, and nothing the answer
 * engine uses, reads it: `acquisitionReference` does not carry it into the
 * catalogue.
 *
 * Whether a publisher's terms allow a use is a legal judgement for the owner and
 * their lawyer (ledger #HGEC4B). An agent never fills in a status other than
 * `unknown` on its own research. Absent means `unknown`, which is the state of
 * every record when this field was introduced.
 *
 * - `unknown`: nobody has established the rights position.
 * - `open_licence`: the publisher releases it under a named open licence, recorded in `licence`.
 * - `publisher_terms_allow`: the publisher's published terms of use allow the use.
 * - `permission_granted`: the publisher gave specific permission.
 * - `restricted`: the publisher's terms or a reply restrict or refuse the use.
 */
export const SOURCE_RIGHTS_STATUSES = [
  "unknown",
  "open_licence",
  "publisher_terms_allow",
  "permission_granted",
  "restricted",
] as const;

export type SourceRightsStatus = (typeof SOURCE_RIGHTS_STATUSES)[number];

/**
 * Whether one specific use is allowed. Kept separate from the status because a
 * licence can allow public display and still say nothing about AI use, or the
 * reverse. Absent means `unknown`.
 */
export const SOURCE_RIGHTS_USE_PERMISSIONS = ["unknown", "allowed", "not_allowed"] as const;

export type SourceRightsUsePermission = (typeof SOURCE_RIGHTS_USE_PERMISSIONS)[number];

export type SourceRights = {
  status: SourceRightsStatus;
  /** The named licence, for example "CC BY 4.0". Required for `open_licence`. */
  licence?: string | null;
  /** Showing the source, or excerpts of it, to readers of the public site. */
  publicDisplay?: SourceRightsUsePermission;
  /** Indexing the source for retrieval and AI-generated answers. */
  aiUse?: SourceRightsUsePermission;
  /** Where the licence, terms or permission can be read. */
  evidenceUrl?: string | null;
  note?: string | null;
  /** The day the rights position was checked, as an exact YYYY-MM-DD date. */
  checkedAt?: string | null;
  /** Who recorded the rights position. */
  recordedBy?: string | null;
};

const RIGHTS_FIELDS = [
  "status",
  "licence",
  "publicDisplay",
  "aiUse",
  "evidenceUrl",
  "note",
  "checkedAt",
  "recordedBy",
] as const satisfies readonly (keyof SourceRights)[];

const rightsFields = new Set<string>(RIGHTS_FIELDS);
const statuses = new Set<string>(SOURCE_RIGHTS_STATUSES);
const usePermissions = new Set<string>(SOURCE_RIGHTS_USE_PERMISSIONS);

export const UNKNOWN_SOURCE_RIGHTS: Readonly<SourceRights> = Object.freeze({
  status: "unknown",
  publicDisplay: "unknown",
  aiUse: "unknown",
});

function presentText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** The rights position a record states, with absent fields read as `unknown`. */
export function sourceRightsFor(rights: SourceRights | null | undefined): SourceRights {
  if (!rights) return { ...UNKNOWN_SOURCE_RIGHTS };
  return {
    ...rights,
    publicDisplay: rights.publicDisplay ?? "unknown",
    aiUse: rights.aiUse ?? "unknown",
  };
}

/**
 * Every rule a recorded rights position must satisfy. An absent field is valid
 * and reads as `unknown`. Returns human-readable issues prefixed with the record id.
 */
export function sourceRightsIssues(id: string, rights: unknown): string[] {
  if (rights === undefined) return [];
  if (rights === null || typeof rights !== "object" || Array.isArray(rights)) {
    return [`${id}: rights must be an object with a status, or be left out (which means unknown)`];
  }

  const issues: string[] = [];
  const value = rights as Record<string, unknown>;

  for (const key of Object.keys(value)) {
    if (!rightsFields.has(key)) {
      issues.push(`${id}: rights.${key} is not a recognised field (expected one of ${RIGHTS_FIELDS.join(", ")})`);
    }
  }

  const status = value.status;
  if (typeof status !== "string" || !statuses.has(status)) {
    issues.push(`${id}: rights.status must be one of ${SOURCE_RIGHTS_STATUSES.join(", ")}`);
  }

  for (const field of ["publicDisplay", "aiUse"] as const) {
    const permission = value[field];
    if (permission !== undefined && (typeof permission !== "string" || !usePermissions.has(permission))) {
      issues.push(`${id}: rights.${field} must be one of ${SOURCE_RIGHTS_USE_PERMISSIONS.join(", ")}`);
    }
  }

  for (const field of ["licence", "evidenceUrl", "note", "checkedAt", "recordedBy"] as const) {
    const text = value[field];
    if (text !== undefined && text !== null && typeof text !== "string") {
      issues.push(`${id}: rights.${field} must be text or null`);
    }
  }

  const evidenceUrl = presentText(value.evidenceUrl);
  if (evidenceUrl && !isHttpsUrl(evidenceUrl)) {
    issues.push(`${id}: rights.evidenceUrl must be an https link`);
  }

  const checkedAt = presentText(value.checkedAt);
  if (checkedAt && !strictSourceDate(checkedAt)) {
    issues.push(`${id}: rights.checkedAt must be an exact YYYY-MM-DD date, got ${JSON.stringify(checkedAt)}`);
  }

  if (status === "unknown") {
    // With no established rights position there is no basis for saying a use is allowed.
    for (const field of ["publicDisplay", "aiUse"] as const) {
      if (value[field] === "allowed") {
        issues.push(`${id}: rights.${field} cannot be "allowed" while rights.status is "unknown"`);
      }
    }
  } else if (typeof status === "string" && statuses.has(status)) {
    // A stated rights position is a judgement someone made on some evidence, so it
    // must say who made it, when, and on what.
    if (!presentText(value.recordedBy))
      issues.push(`${id}: rights.recordedBy is required when rights.status is ${status}`);
    if (!checkedAt) issues.push(`${id}: rights.checkedAt is required when rights.status is ${status}`);
    if (!evidenceUrl && !presentText(value.note)) {
      issues.push(`${id}: rights.evidenceUrl or rights.note is required when rights.status is ${status}`);
    }
    if (status === "open_licence" && !presentText(value.licence)) {
      issues.push(`${id}: rights.licence must name the licence when rights.status is open_licence`);
    }
  }

  return issues;
}

/** How many records sit at each rights status, counting an absent field as `unknown`. */
export function sourceRightsStatusCounts(
  records: readonly { rights?: SourceRights | null }[],
): Record<SourceRightsStatus, number> {
  const counts = Object.fromEntries(SOURCE_RIGHTS_STATUSES.map((status) => [status, 0])) as Record<
    SourceRightsStatus,
    number
  >;
  for (const record of records) {
    const status = sourceRightsFor(record.rights).status;
    counts[statuses.has(status) ? status : "unknown"] += 1;
  }
  return counts;
}
