"use client";

export type SiteProviderNumber = {
  readonly id: string;
  readonly site: string;
  readonly number: string;
};

export type DoctorCredentials = {
  readonly ahpraNumber: string;
  readonly prescriberNumber: string;
  readonly providerNumbers: readonly SiteProviderNumber[];
  readonly wwccNumber: string;
};

export const DEFAULT_CREDENTIALS: DoctorCredentials = {
  ahpraNumber: "",
  prescriberNumber: "",
  providerNumbers: [],
  wwccNumber: "",
};

import { DOCTOR_CREDENTIALS_STORAGE_KEY } from "@/lib/account-scoped-browser-state";

export const CREDENTIALS_STORAGE_KEY = DOCTOR_CREDENTIALS_STORAGE_KEY;

// Earlier versions pre-filled two blank hospital rows. Drop exactly those untouched rows on read so they
// stop reappearing; any row with a number the user entered is kept.
const LEGACY_DEFAULT_SITES: Readonly<Record<string, string>> = {
  p1: "Royal Perth Hospital",
  p2: "Sir Charles Gairdner",
};

function isUntouchedLegacyDefaultRow(row: Partial<SiteProviderNumber> | null | undefined): boolean {
  if (!row || typeof row.id !== "string") return false;
  return LEGACY_DEFAULT_SITES[row.id] === row.site && (row.number ?? "").trim() === "";
}

export function loadDoctorCredentials(): DoctorCredentials {
  if (typeof window === "undefined") return DEFAULT_CREDENTIALS;
  try {
    // Reading the getter can itself throw (SecurityError in restricted browsers), so it stays inside the try.
    const storage = window.localStorage;
    if (!storage) return DEFAULT_CREDENTIALS;
    const raw = storage.getItem(CREDENTIALS_STORAGE_KEY);
    if (!raw) return DEFAULT_CREDENTIALS;
    const parsed = JSON.parse(raw) as Partial<DoctorCredentials>;
    return {
      ahpraNumber: parsed.ahpraNumber ?? "",
      prescriberNumber: parsed.prescriberNumber ?? "",
      providerNumbers: Array.isArray(parsed.providerNumbers)
        ? parsed.providerNumbers.filter((row) => !isUntouchedLegacyDefaultRow(row))
        : DEFAULT_CREDENTIALS.providerNumbers,
      wwccNumber: parsed.wwccNumber ?? "",
    };
  } catch {
    return DEFAULT_CREDENTIALS;
  }
}

export function saveDoctorCredentials(creds: DoctorCredentials): boolean {
  if (typeof window === "undefined") return false;
  try {
    const storage = window.localStorage;
    if (!storage) return false;
    storage.setItem(CREDENTIALS_STORAGE_KEY, JSON.stringify(creds));
    return true;
  } catch {
    return false;
  }
}
