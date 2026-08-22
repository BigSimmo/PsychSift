import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CaringContactsProjectSeparationError,
  assertNotClinicalKbProject,
  caringContactsDataMode,
  caringContactsDatabaseUrl,
} from "@/lib/caring-contacts-server/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("caring-contacts database configuration", () => {
  it("falls back to the in-memory store when unconfigured", () => {
    vi.stubEnv("CARING_CONTACTS_DATABASE_URL", "");
    expect(caringContactsDataMode()).toBe("in-memory");
  });

  // Review round 1, Minor 2: the brief's four tests all pin the unconfigured (in-memory) branch.
  // An implementation that returned "in-memory" unconditionally would pass every one of them, so
  // the configured branch needs its own coverage.
  it("reports postgres mode and the trimmed URL when the variable is configured", () => {
    vi.stubEnv("CARING_CONTACTS_DATABASE_URL", "  postgres://demo@example.invalid:5432/postgres  ");
    expect(caringContactsDataMode()).toBe("postgres");
    expect(caringContactsDatabaseUrl()).toBe("postgres://demo@example.invalid:5432/postgres");
  });

  it("refuses the pinned Clinical KB project reference", () => {
    expect(() =>
      assertNotClinicalKbProject("postgres://user@db.sjrfecxgysukkwxsowpy.supabase.co:5432/postgres"),
    ).toThrow(CaringContactsProjectSeparationError);
  });

  // Review round 1, Important 1: DNS hostnames are case-insensitive, so a connection string
  // spelled with a different case for the project reference resolves to the identical live
  // Clinical KB host. A case-sensitive check would be the exact bypass this function exists to
  // close.
  it("refuses the pinned Clinical KB project reference regardless of case", () => {
    expect(() =>
      assertNotClinicalKbProject("postgres://user@db.SJRFECXGYSUKKWXSOWPY.supabase.co:5432/postgres"),
    ).toThrow(CaringContactsProjectSeparationError);
  });

  it("refuses a URL that is byte-identical to the Clinical KB connection", () => {
    vi.stubEnv("SUPABASE_DB_URL", "postgres://shared@example.invalid:5432/postgres");
    expect(() => assertNotClinicalKbProject("postgres://shared@example.invalid:5432/postgres")).toThrow(
      CaringContactsProjectSeparationError,
    );
  });

  // Review round 1, Minor 1: the configured URL is trimmed before comparison; the Clinical KB
  // value it is compared against was not, so two connections differing only by surrounding
  // whitespace would otherwise pass as distinct.
  it("refuses a URL matching the Clinical KB connection only after both sides are trimmed", () => {
    vi.stubEnv("SUPABASE_DB_URL", "  postgres://shared@example.invalid:5432/postgres  ");
    expect(() => assertNotClinicalKbProject("postgres://shared@example.invalid:5432/postgres")).toThrow(
      CaringContactsProjectSeparationError,
    );
  });

  it("never puts a connection string into its error message", () => {
    try {
      assertNotClinicalKbProject("postgres://secret@db.sjrfecxgysukkwxsowpy.supabase.co:5432/postgres");
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as Error).message).not.toContain("secret");
      expect((error as Error).message).toContain("CARING_CONTACTS_DATABASE_URL");
    }
  });
});
