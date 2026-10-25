"use client";

import { useEffect } from "react";
import { identifierShapeWarning } from "@/lib/clinical-ask/context";

type PatientCheckModule = typeof import("@/lib/clinical-question-patient-check");

/** Held back when only the identifier-shape check is available (the full check has not loaded). */
export const SEARCH_IDENTIFIER_HELD_BACK =
  "This search looks like it holds a record number, date of birth, phone number or email. Remove it and search again.";

let loadedPatientCheck: PatientCheckModule | null = null;
let pendingPatientCheck: Promise<void> | null = null;

/** Starts loading the full patient-detail check, which stays out of the page bundle (bundle budget). */
export function preloadSearchPatientCheck(): Promise<void> {
  if (loadedPatientCheck) return Promise.resolve();
  if (pendingPatientCheck) return pendingPatientCheck;
  pendingPatientCheck = import("@/lib/clinical-question-patient-check").then(
    (mod) => {
      loadedPatientCheck = mod;
    },
    () => {
      // A failed download is retried on the next preload; the identifier-shape check still applies.
      pendingPatientCheck = null;
    },
  );
  return pendingPatientCheck;
}

/** Loads the full check once there is search text, so a later submit or mode switch can use it. */
export function usePreloadSearchPatientCheck(text: string) {
  const hasText = Boolean(text.trim());
  useEffect(() => {
    if (hasText) void preloadSearchPatientCheck();
  }, [hasText]);
}

/**
 * The held-back sentence when search text looks like it holds a patient detail, else null.
 * Navigation that writes typed text into a page address (`?q=`) calls this first, so the
 * detail never reaches the address bar, browser history or a request line (design audit
 * D-03). Uses the full check once it has loaded, and the identifier-shape check until then.
 */
export function searchTextPatientDetailRefusal(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (loadedPatientCheck) {
    const problem = loadedPatientCheck.clinicalQuestionPatientDetail(trimmed);
    return problem ? loadedPatientCheck.searchPatientDetailMessage(problem) : null;
  }
  return identifierShapeWarning(trimmed) ? SEARCH_IDENTIFIER_HELD_BACK : null;
}
