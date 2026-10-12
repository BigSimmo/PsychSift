// Session-scoped persistence for the patient-considerations profile.
//
// The profile is anonymous physiology (age, renal/hepatic function, QTc,
// pregnancy/lactation, allergy classes) — deliberately NOT PHI. It is kept in
// `sessionStorage` so it survives navigation between the prescribing search and
// a medication detail page within a tab session, but clears when the tab closes
// (appropriate for transient patient context on a shared workstation). It is
// also patient-specific decision-support context, so the auth provider removes
// it through `clearPatientProfile` at every account transition — sign-out,
// session expiry and a change of signed-in user — the same boundary that clears
// recent queries: the next clinician at the same tab must never have their
// prescribing alerts evaluated against the previous patient's physiology.
//
// Exposed as an external store (snapshot + subscribe + write) so React can read
// it via `useSyncExternalStore` — the same pattern as `use-theme.ts` /
// `use-sidebar-collapsed.ts` — which shares state across the prescribing
// workspace and detail pages without a hydration mismatch or setState-in-effect.

import { SCR_UMOL_PER_MGDL } from "@/lib/medication-patient-alerts";
import type { AllergyClass, HepaticSeverity, PatientProfile, ScrUnit } from "@/lib/medication-patient-alerts";

export const PATIENT_PROFILE_STORAGE_KEY = "clinical-kb-patient-profile";
const PATIENT_PROFILE_CHANGE_EVENT = "clinical-kb-patient-profile-change";

export const EMPTY_PATIENT_PROFILE: PatientProfile = {
  ageYears: null,
  egfr: null,
  crcl: null,
  scr: null,
  scrUnit: "umol/L",
  hepatic: null,
  qtc: null,
  pregnant: false,
  breastfeeding: false,
  allergies: [],
  medications: [],
};

/**
 * Upper bound on the stored medication list. Not a clinical limit — a guard so a
 * corrupted or hand-edited sessionStorage value cannot make every result row
 * evaluate an unbounded list.
 */
export const PATIENT_PROFILE_MAX_MEDICATIONS = 40;

// Slugs are validated by SHAPE here, not against the catalogue. Importing the
// catalogue (or the interaction index) into this module would pull it into the
// global shell bundle via PatientProfileProvider, which mounts on every route —
// a real weight regression for data only the medication surfaces need. An
// unknown slug is inert downstream: it can never match an interaction row, and
// the picker only ever offers real catalogue entries.
const MEDICATION_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,60}$/;

const SCR_UNITS: ScrUnit[] = ["umol/L", "mg/dL"];
const HEPATIC_LEVELS: HepaticSeverity[] = ["none", "mild", "moderate", "severe"];
const ALLERGY_CLASSES: AllergyClass[] = [
  "penicillin",
  "sulfa",
  "nsaid",
  "cephalosporin",
  "macrolide",
  "fluoroquinolone",
];

// Physiological input-VALIDITY bounds (inclusive). These are deliberately NOT the
// clinical firing thresholds (RENAL_IMPAIRMENT_EGFR / QTC_PROLONGED_MS / the age
// cut-offs live in medication-patient-alerts.ts and must never be relaxed here):
// they only reject values that are physically impossible or a clear data-entry
// error. An out-of-range entry is rejected to `null` — never clamped — so the
// alert engine treats it as a missing input and surfaces a contraindication row
// as "unassessed" rather than reading garbage as a false all-clear. Ranges
// verified 2026-07-21 against clinical extremes: neonate age 0, anuric eGFR/CrCl
// 0, short-QT syndrome ~250 ms, augmented renal clearance CrCl ~350, severe-AKI
// creatinine ~2200 µmol/L.
export const PATIENT_PROFILE_NUMERIC_BOUNDS = {
  ageYears: { min: 0, max: 130 },
  egfr: { min: 0, max: 250 },
  crcl: { min: 0, max: 400 },
  qtc: { min: 240, max: 800 },
} as const;

// Serum creatinine bounds are canonical in µmol/L; a mg/dL entry is normalised by
// ×SCR_UMOL_PER_MGDL before the range check (the same conversion the alert engine
// applies), so a single bound covers both units with no unit/bound mismatch.
export const PATIENT_PROFILE_SCR_UMOL_BOUNDS = { min: 15, max: 3000 } as const;

function boundedNumberOrNull(value: unknown, bounds: { min: number; max: number }): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= bounds.min && value <= bounds.max
    ? value
    : null;
}

// Convert a serum-creatinine value between display units, preserving the
// underlying physiological quantity (µmol/L is canonical; the alert engine uses
// the same ×SCR_UMOL_PER_MGDL factor). Used when the clinician toggles the
// creatinine unit so the stored value follows the unit instead of being silently
// reinterpreted on the new scale. Rounds to the display precision of the target
// unit (integer µmol/L, 2 dp mg/dL). A null/non-finite value stays null.
export function convertScrValue(value: number | null | undefined, from: ScrUnit, to: ScrUnit): number | null {
  if (value == null || !Number.isFinite(value) || from === to) return value ?? null;
  const umol = from === "mg/dL" ? value * SCR_UMOL_PER_MGDL : value;
  const converted = to === "mg/dL" ? umol / SCR_UMOL_PER_MGDL : umol;
  return to === "mg/dL" ? Math.round(converted * 100) / 100 : Math.round(converted);
}

// Returns the entered value (in its own unit) when its µmol/L-normalised
// magnitude is physiologically valid, else null. The engine re-normalises the
// raw value itself, so we only use the normalised figure for the range check.
function scrOrNull(value: unknown, scrUnit: ScrUnit): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const umol = scrUnit === "mg/dL" ? value * SCR_UMOL_PER_MGDL : value;
  return umol >= PATIENT_PROFILE_SCR_UMOL_BOUNDS.min && umol <= PATIENT_PROFILE_SCR_UMOL_BOUNDS.max ? value : null;
}

export function sanitizeProfile(raw: unknown): PatientProfile {
  if (!raw || typeof raw !== "object") return { ...EMPTY_PATIENT_PROFILE };
  const value = raw as Record<string, unknown>;
  const hepatic = HEPATIC_LEVELS.includes(value.hepatic as HepaticSeverity) ? (value.hepatic as HepaticSeverity) : null;
  const scrUnit = SCR_UNITS.includes(value.scrUnit as ScrUnit) ? (value.scrUnit as ScrUnit) : "umol/L";
  const allergies = Array.isArray(value.allergies)
    ? value.allergies.filter((item): item is AllergyClass => ALLERGY_CLASSES.includes(item as AllergyClass))
    : [];
  return {
    ageYears: boundedNumberOrNull(value.ageYears, PATIENT_PROFILE_NUMERIC_BOUNDS.ageYears),
    egfr: boundedNumberOrNull(value.egfr, PATIENT_PROFILE_NUMERIC_BOUNDS.egfr),
    crcl: boundedNumberOrNull(value.crcl, PATIENT_PROFILE_NUMERIC_BOUNDS.crcl),
    scr: scrOrNull(value.scr, scrUnit),
    scrUnit,
    hepatic,
    qtc: boundedNumberOrNull(value.qtc, PATIENT_PROFILE_NUMERIC_BOUNDS.qtc),
    pregnant: value.pregnant === true,
    breastfeeding: value.breastfeeding === true,
    allergies,
    medications: sanitizeMedicationSlugs(value.medications),
  };
}

/** Shape-validate, de-duplicate, sort and cap the stored medication list. */
export function sanitizeMedicationSlugs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const slug = item.trim().toLowerCase();
    if (!MEDICATION_SLUG_PATTERN.test(slug)) continue;
    seen.add(slug);
    if (seen.size >= PATIENT_PROFILE_MAX_MEDICATIONS) break;
  }
  return Array.from(seen).sort();
}

// Cache the parsed snapshot keyed by the raw string so `useSyncExternalStore`
// receives a stable reference until the stored value actually changes.
let cachedRaw: string | null = null;
let cachedProfile: PatientProfile = EMPTY_PATIENT_PROFILE;

export function getPatientProfileSnapshot(): PatientProfile {
  if (typeof window === "undefined") return EMPTY_PATIENT_PROFILE;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(PATIENT_PROFILE_STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw === cachedRaw) return cachedProfile;
  cachedRaw = raw;
  try {
    cachedProfile = raw ? sanitizeProfile(JSON.parse(raw)) : { ...EMPTY_PATIENT_PROFILE };
  } catch {
    cachedProfile = { ...EMPTY_PATIENT_PROFILE };
  }
  return cachedProfile;
}

/**
 * True when the profile holds anything a clinician typed. The default unit
 * (`scrUnit`) is not content, so a profile that has only ever been opened and
 * emptied reads as empty and the Settings clear action stays disabled.
 */
export function patientProfileHasContent(profile: PatientProfile): boolean {
  return (
    profile.ageYears !== null ||
    profile.egfr !== null ||
    profile.crcl !== null ||
    profile.scr !== null ||
    profile.hepatic !== null ||
    profile.qtc !== null ||
    profile.pregnant ||
    profile.breastfeeding ||
    (profile.allergies?.length ?? 0) > 0 ||
    (profile.medications?.length ?? 0) > 0
  );
}

export function getServerPatientProfileSnapshot(): PatientProfile {
  return EMPTY_PATIENT_PROFILE;
}

export function subscribePatientProfile(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", onChange);
  window.addEventListener(PATIENT_PROFILE_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PATIENT_PROFILE_CHANGE_EVENT, onChange);
  };
}

export function writePatientProfile(profile: PatientProfile): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PATIENT_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Persistence is a convenience only; ignore quota/availability errors.
  }
  window.dispatchEvent(new Event(PATIENT_PROFILE_CHANGE_EVENT));
}

// The clear GENERATION: how many times the whole profile has been wiped in this
// tab. It exists because the stored value cannot carry that news on its own.
//
// A field refuses an out-of-range entry by storing `null` (see the bounds
// comment above — rejected, never clamped). A profile-wide clear also stores
// `null`. So a mounted input comparing its own last-committed value against the
// store sees `null === null` either way, and cannot tell "my 420 was refused,
// keep it on screen for correction" from "the profile this box belongs to was
// wiped, drop it" — #DTAMMK, where a refused CrCl of 420 survived a clear
// performed in a second mounted copy of the panel, and the next entry of 95
// landed after it and read 42095 mL/min.
//
// A counter, not a timestamp or a boolean: it only ever has to differ from what
// a consumer last saw, and two clears in the same millisecond must still read as
// two. Module-scoped, which is exactly the right scope — `sessionStorage` is
// per-tab and its `storage` event never fires for the tab that wrote it, so
// every consumer that needs this news shares this module instance with the
// writer. It resets to 0 on reload, when every consumer remounts anyway.
let clearGeneration = 0;

export function getPatientProfileClearGeneration(): number {
  return clearGeneration;
}

export function getServerPatientProfileClearGeneration(): number {
  return 0;
}

// Both clears below dispatch the store's own change event rather than relying on
// the `storage` event, which browsers only fire in *other* tabs: mounted
// medication surfaces cache the parsed snapshot by raw string and must re-read
// an empty profile in this tab. The generation is bumped BEFORE the dispatch so
// a subscriber re-reading synchronously sees both halves of the same clear.

/** Account-transition clear (sign-out, session expiry, user change). */
export function clearPatientProfile(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PATIENT_PROFILE_STORAGE_KEY);
  } catch {
    // Storage may be unavailable; the snapshot then reads as empty anyway.
  }
  clearGeneration += 1;
  window.dispatchEvent(new Event(PATIENT_PROFILE_CHANGE_EVENT));
}

/**
 * In-session clear — the panel's own Clear button, via the context.
 *
 * Writes an empty profile rather than removing the key, which is the difference
 * from `clearPatientProfile` above: this tab is still the same clinician's
 * session, so the profile stays present-and-empty (an explicitly emptied field
 * list) instead of absent. Both bump the same generation, because from a mounted
 * field's point of view they are the same event: everything you are showing is
 * gone, whoever asked for it.
 */
export function resetPatientProfile(): void {
  if (typeof window === "undefined") return;
  // Bumped first so the single write below carries both halves of the clear in
  // one change event, rather than notifying twice and rendering an in-between
  // state in which the profile is already empty but the fields do not yet know
  // a clear is what emptied it.
  clearGeneration += 1;
  writePatientProfile({ ...EMPTY_PATIENT_PROFILE, medications: [] });
}
