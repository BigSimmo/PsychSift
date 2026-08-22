// src/lib/caring-contacts-server/config.ts
//
// Database configuration for the caring-contacts workspace, kept deliberately outside the sealed
// domain at ../caring-contacts: the sealed domain may not read environment variables, and this
// module reads exactly one -- CARING_CONTACTS_DATABASE_URL -- and nothing else.
//
// The variable shares no value with any NEXT_PUBLIC_SUPABASE_* or SUPABASE_* variable, and
// assertNotClinicalKbProject refuses two distinct ways a misconfiguration could point this
// synthetic prototype at the live Clinical KB database: the pinned Clinical KB project reference
// appearing in the URL, or the URL being byte-identical to the value Clinical KB itself reads for
// its own connection.
//
// Never print the URL. Every error message here names the environment variable, never its value.
import "server-only";

export type CaringContactsDataMode = "postgres" | "in-memory";

const CARING_CONTACTS_DATABASE_URL_VAR = "CARING_CONTACTS_DATABASE_URL";
const CLINICAL_KB_PROJECT_REF = "sjrfecxgysukkwxsowpy";

/** Environment variables the Clinical KB database itself may be configured with -- see
 * src/lib/env.ts (SUPABASE_DB_URL). DATABASE_URL is included as a generic alias some hosting
 * providers inject for the same connection. */
const CLINICAL_KB_DATABASE_URL_VARS = ["SUPABASE_DB_URL", "DATABASE_URL"] as const;

export class CaringContactsProjectSeparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaringContactsProjectSeparationError";
  }
}

/** Blank or whitespace-only is treated as unset, matching the repo's env-scrub convention. */
export function caringContactsDatabaseUrl(): string | null {
  const value = process.env[CARING_CONTACTS_DATABASE_URL_VAR]?.trim();
  return value ? value : null;
}

/** "in-memory" whenever the variable is unset -- the mode the demo and the offline suite use. */
export function caringContactsDataMode(): CaringContactsDataMode {
  return caringContactsDatabaseUrl() ? "postgres" : "in-memory";
}

/**
 * Throws `CaringContactsProjectSeparationError` when `url` could resolve to the live Clinical KB
 * database: it names the pinned project reference, or it is byte-identical to the value Clinical
 * KB itself reads from `SUPABASE_DB_URL` or `DATABASE_URL`. Never includes `url` -- or the value
 * either check compares it against -- in the thrown message.
 */
export function assertNotClinicalKbProject(url: string): void {
  // Case-insensitive: DNS hostnames are case-insensitive, so a connection string spelled with a
  // different case for the project reference resolves to the identical live Clinical KB host --
  // and a case-sensitive check here would be the exact bypass this function exists to close.
  if (url.toLowerCase().includes(CLINICAL_KB_PROJECT_REF)) {
    throw new CaringContactsProjectSeparationError(
      `${CARING_CONTACTS_DATABASE_URL_VAR} names the pinned Clinical KB project reference. ` +
        "Caring Contacts must run against its own database, never the live Clinical KB project.",
    );
  }

  // Trimmed on both sides: two connection strings that differ only by surrounding whitespace are
  // the same connection, and an untrimmed comparison would let that whitespace hide a collision.
  const trimmedUrl = url.trim();
  const collidesWith = CLINICAL_KB_DATABASE_URL_VARS.find((name) => {
    const clinicalKbValue = process.env[name]?.trim();
    return clinicalKbValue !== undefined && clinicalKbValue !== "" && clinicalKbValue === trimmedUrl;
  });
  if (collidesWith) {
    throw new CaringContactsProjectSeparationError(
      `${CARING_CONTACTS_DATABASE_URL_VAR} is identical to ${collidesWith}. Caring Contacts must ` +
        "run against its own database, never the same connection as the Clinical KB project.",
    );
  }
}
