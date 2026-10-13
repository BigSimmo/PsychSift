"use client";

import { useEffect, useMemo, useState } from "react";
import { identifierShapeWarning } from "@/lib/clinical-ask/context";
import type { AppModeId } from "@/lib/app-modes";

type PatientCheckModule = typeof import("@/lib/clinical-question-patient-check");

const FALLBACK_WARNING = "Remove identifiable patient details before searching.";

// Answer mode holds back a question that looks like it holds a patient detail (audit S2, 2026-10-13).
// The check loads once the Answer box has text, so pages that never type a question don't download
// it (bundle budget). Until it arrives the server check still refuses the question.
export function useComposerPatientCheck(query: string, searchMode: AppModeId) {
  const [patientCheck, setPatientCheck] = useState<PatientCheckModule | null>(null);
  const needsPatientCheck = searchMode === "answer" && Boolean(query) && !patientCheck;
  useEffect(() => {
    if (!needsPatientCheck) return;
    let live = true;
    void import("@/lib/clinical-question-patient-check").then((mod) => {
      if (live) setPatientCheck(mod);
    });
    return () => {
      live = false;
    };
  }, [needsPatientCheck]);
  return useMemo(() => {
    const detail =
      searchMode === "answer" && query && patientCheck ? patientCheck.clinicalQuestionPatientDetail(query) : null;
    return {
      clinicalPatientDetail: detail,
      hasPhiWarning: Boolean(detail || (query && identifierShapeWarning(query))),
      phiWarningText: patientCheck ? patientCheck.composerPatientDetailWarning(detail) : FALLBACK_WARNING,
    };
  }, [patientCheck, query, searchMode]);
}
