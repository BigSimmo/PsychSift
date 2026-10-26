"use client";

import { useEffect } from "react";
import { identifierShapeWarning } from "@/lib/clinical-ask/context";

type PatientCheckModule = typeof import("@/lib/clinical-question-patient-check");

/** Held back when only the identifier-shape check is available (the full check has not loaded). */
export const SEARCH_IDENTIFIER_HELD_BACK =
  "This search looks like it holds a record number, date of birth, phone number or email. Remove it and search again.";

/** Held back while the full check is still loading: a name is not let through unchecked (privacy audit CA-04). */
export const SEARCH_CHECK_LOADING = "Checking this search for patient details. Try again in a moment.";

/** Held back when the full check could not load (a dropped connection); the next search tries the download again. */
export const SEARCH_CHECK_UNAVAILABLE =
  "Could not check this search for patient details. Check your connection and try again.";

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
 * D-03). Uses the full check once it has loaded. Until then it fails closed (privacy audit
 * CA-04, 2026-10-26): an identifier shape gets its own sentence, and anything else is held
 * back as still being checked while the full check loads, so a name never slips through in
 * that window.
 */
export function searchTextPatientDetailRefusal(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (loadedPatientCheck) {
    const problem = loadedPatientCheck.clinicalQuestionPatientDetail(trimmed);
    return problem ? loadedPatientCheck.searchPatientDetailMessage(problem) : null;
  }
  void preloadSearchPatientCheck();
  return identifierShapeWarning(trimmed) ? SEARCH_IDENTIFIER_HELD_BACK : SEARCH_CHECK_LOADING;
}

/**
 * The same check for a caller that can wait: it waits for the full check to load, then reads
 * the text with it. A check that cannot load holds the search back (fails closed). Used before
 * a search request leaves the page, such as a typing-pause fetch or a deep link on arrival
 * (privacy audit CA-02 and CA-05).
 */
export async function checkSearchTextPatientDetail(text: string): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  await preloadSearchPatientCheck();
  if (!loadedPatientCheck)
    return identifierShapeWarning(trimmed) ? SEARCH_IDENTIFIER_HELD_BACK : SEARCH_CHECK_UNAVAILABLE;
  return searchTextPatientDetailRefusal(trimmed);
}

/** Thrown inside a search request chain when the check holds the text back; its message is the held-back sentence. */
export class SearchHeldBack extends Error {}

/**
 * For a box that writes each keystroke into the page address: the text is written only once
 * the check passes. Text held back clears the address's copy and says why (privacy audit CA-03).
 */
export function writeCheckedSearchText(
  text: string,
  write: (value: string) => void,
  warn: (message: string) => void,
): void {
  void checkSearchTextPatientDetail(text).then((refusal) => {
    if (!refusal) {
      write(text);
      return;
    }
    write("");
    warn(refusal);
  });
}
