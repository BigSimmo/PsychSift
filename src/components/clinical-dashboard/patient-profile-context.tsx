"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

import { useClinicalToolAccess } from "@/components/mode-kit/use-clinical-tool-access";
import { isProfileEmpty, type AllergyClass, type PatientProfile, type ScrUnit } from "@/lib/medication-patient-alerts";
import {
  EMPTY_PATIENT_PROFILE,
  convertScrValue,
  getPatientProfileClearGeneration,
  getPatientProfileSnapshot,
  getServerPatientProfileClearGeneration,
  getServerPatientProfileSnapshot,
  resetPatientProfile,
  sanitizeMedicationSlugs,
  subscribePatientProfile,
  writePatientProfile,
} from "@/lib/patient-profile-storage";

export type PatientProfileContextValue = {
  profile: PatientProfile;
  updateField: <K extends keyof PatientProfile>(key: K, value: PatientProfile[K]) => void;
  setScrUnit: (unit: ScrUnit) => void;
  toggleAllergy: (allergy: AllergyClass) => void;
  toggleMedication: (slug: string) => void;
  clear: () => void;
  /**
   * How many times the whole profile has been cleared in this tab — by any
   * panel's Clear button or by an account transition. A consumer holding draft
   * text of its own watches this to know a clear happened; the profile alone
   * cannot tell it, because a refused entry and a cleared one are both `null`
   * (#DTAMMK). Only its CHANGE is meaningful; the number itself is not.
   */
  clearGeneration: number;
  isEmpty: boolean;
};

const PatientProfileContext = createContext<PatientProfileContextValue | null>(null);

export function PatientProfileProvider({ children }: { children: React.ReactNode }) {
  // Patient details, and every consideration and interaction flag drawn from them,
  // need sign-in from 1 November 2026 (docs/decisions/2026-10-20-clinical-decision-
  // tools-need-sign-in.md). Signed out, every consumer reads the empty profile, so no
  // tailored note or flag shows. Anything already stored stays in this tab's storage
  // and comes back on sign-in.
  // Only an allowed session reads the stored profile; while the session is still loading
  // ("checking") nothing patient-specific is exposed either.
  const accessAllowed = useClinicalToolAccess() === "allowed";
  // Read from the sessionStorage-backed external store so the profile is shared
  // across the prescribing workspace and detail pages with no hydration mismatch.
  const storedProfile = useSyncExternalStore(
    subscribePatientProfile,
    getPatientProfileSnapshot,
    getServerPatientProfileSnapshot,
  );
  const profile = accessAllowed ? storedProfile : EMPTY_PATIENT_PROFILE;

  // The same subscription, second reading: the clear generation travels with the
  // profile because a clear is the one change that alters both, and a consumer
  // must see them together to act on either.
  const clearGeneration = useSyncExternalStore(
    subscribePatientProfile,
    getPatientProfileClearGeneration,
    getServerPatientProfileClearGeneration,
  );

  const updateField = useCallback<PatientProfileContextValue["updateField"]>((key, value) => {
    writePatientProfile({ ...getPatientProfileSnapshot(), [key]: value });
  }, []);

  // Switching the creatinine unit must convert the stored value, not just relabel
  // it — otherwise the alert engine re-reads the same number on the new scale. The
  // convert + unit change is a single write so the sanitiser never sees the
  // mismatched intermediate (which a two-step update would drop to null).
  const setScrUnit = useCallback((unit: ScrUnit) => {
    const current = getPatientProfileSnapshot();
    const from = current.scrUnit ?? "umol/L";
    if (from === unit) return;
    writePatientProfile({ ...current, scr: convertScrValue(current.scr, from, unit), scrUnit: unit });
  }, []);

  const toggleAllergy = useCallback((allergy: AllergyClass) => {
    const current = getPatientProfileSnapshot();
    const allergies = current.allergies ?? [];
    const next = allergies.includes(allergy) ? allergies.filter((item) => item !== allergy) : [...allergies, allergy];
    writePatientProfile({ ...current, allergies: next });
  }, []);

  const toggleMedication = useCallback((slug: string) => {
    const current = getPatientProfileSnapshot();
    const medications = current.medications ?? [];
    const next = medications.includes(slug) ? medications.filter((item) => item !== slug) : [...medications, slug];
    writePatientProfile({ ...current, medications: sanitizeMedicationSlugs(next) });
  }, []);

  // Through the store, not by writing an empty profile here, so the clear bumps
  // the shared generation and every mounted field learns of it — including the
  // ones in a second copy of the panel, which this component never sees.
  const clear = useCallback(() => {
    resetPatientProfile();
  }, []);

  const value = useMemo<PatientProfileContextValue>(
    () => ({
      profile,
      updateField,
      setScrUnit,
      toggleAllergy,
      toggleMedication,
      clear,
      clearGeneration,
      isEmpty: isProfileEmpty(profile),
    }),
    [profile, updateField, setScrUnit, toggleAllergy, toggleMedication, clear, clearGeneration],
  );

  return <PatientProfileContext.Provider value={value}>{children}</PatientProfileContext.Provider>;
}

export function usePatientProfile(): PatientProfileContextValue {
  const value = useContext(PatientProfileContext);
  if (!value) {
    throw new Error("usePatientProfile must be used within a PatientProfileProvider");
  }
  return value;
}
