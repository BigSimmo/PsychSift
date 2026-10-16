"use client";

import { CheckCircle2, ShieldAlert, Send } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { WorkButton, WorkCard, WorkChip, WorkChips, WorkSectionLabel, WorkTag } from "@/components/mode-kit/work";
import { AssessHeader, AssessNote, AssessTextField, OptionCard } from "@/components/teaching/assessments/assess-kit";
import {
  CASE_COMPLEXITIES,
  SUPERVISION_LEVELS,
  type CaseComplexity,
  type SupervisionLevel,
} from "@/lib/teaching/assessments/content";
import {
  getEpaMagicLinkByToken,
  submitEpaMagicLinkResponse,
  type EpaMagicLinkRecord,
} from "@/lib/teaching/assessments/magic-link";
import { EPA_FEEDBACK_MAX } from "@/lib/teaching/assessments/model";
import { checkPatientDetail } from "@/lib/work-text/patient-detail-check";

const LEVEL_OPTIONS = SUPERVISION_LEVELS.map((item) => ({
  id: item.id,
  title: item.formLabel,
  detail: item.detail,
}));

export default function EpaMagicLinkRespondPage() {
  const params = useParams<{ token?: string }>();
  const token = typeof params?.token === "string" ? params.token : "";

  const [record, setRecord] = useState<EpaMagicLinkRecord | null>(() => {
    if (!token) return null;
    const local = getEpaMagicLinkByToken(token);
    return local.ok ? local.request : (local.request ?? null);
  });
  const [statusError, setStatusError] = useState<string | null>(() => {
    if (!token) return "That assessment link was not found.";
    const local = getEpaMagicLinkByToken(token);
    return local.ok ? null : local.message;
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (!token) return false;
    const local = getEpaMagicLinkByToken(token);
    return !local.ok && local.status === "not_found";
  });

  const [level, setLevel] = useState<SupervisionLevel | null>(null);
  const [complexity, setComplexity] = useState<CaseComplexity | null>(null);
  const [assessorName, setAssessorName] = useState(() => record?.supervisorName ?? "");
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState<EpaMagicLinkRecord | null>(() => {
    if (!token) return null;
    const local = getEpaMagicLinkByToken(token);
    return !local.ok && local.status === "completed" && local.request ? local.request : null;
  });

  useEffect(() => {
    setFormError(null);
    if (!token) {
      setRecord(null);
      setCompleted(null);
      setStatusError("That assessment link was not found.");
      setLoading(false);
      return;
    }
    const local = getEpaMagicLinkByToken(token);
    if (local.ok) {
      setRecord(local.request);
      setAssessorName(local.request.supervisorName);
      setCompleted(null);
      setStatusError(null);
      setLoading(false);
      return;
    }
    if (local.status !== "not_found") {
      setRecord(local.request ?? null);
      setCompleted(local.status === "completed" && local.request ? local.request : null);
      setStatusError(local.message);
      setLoading(false);
      return;
    }

    setRecord(null);
    setCompleted(null);
    setStatusError(null);
    setLoading(true);

    let cancelled = false;
    void fetch(`/api/teaching/assessments/respond/${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as {
          request?: EpaMagicLinkRecord;
          message?: string;
        } | null;
        if (cancelled) return;
        if (response.ok && body?.request) {
          setRecord(body.request);
          setAssessorName(body.request.supervisorName);
          setStatusError(null);
        } else {
          setStatusError(body?.message ?? "That assessment link was not found.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatusError("Could not load this assessment link. Check your connection and try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const patientProblem =
    checkPatientDetail(strengths) ??
    checkPatientDetail(improvements) ??
    (assessorName.trim() ? checkPatientDetail(assessorName, { allowCapitals: true }) : null);

  async function handleSubmit() {
    setFormError(null);
    if (!level) {
      setFormError("Choose a supervision level first.");
      return;
    }
    if (patientProblem) {
      setFormError(patientProblem.body);
      return;
    }
    if (strengths.trim().length > EPA_FEEDBACK_MAX || improvements.trim().length > EPA_FEEDBACK_MAX) {
      setFormError(`Keep feedback under ${EPA_FEEDBACK_MAX} characters.`);
      return;
    }

    const resolvedAssessorName = assessorName.trim() || record?.supervisorName || "External Supervisor";

    setSubmitting(true);
    try {
      const response = await fetch(`/api/teaching/assessments/respond/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level,
          complexity,
          assessorName: resolvedAssessorName,
          strengths,
          improvements,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        request?: EpaMagicLinkRecord;
        message?: string;
      } | null;
      if (response.ok && payload?.request) {
        submitEpaMagicLinkResponse(token, {
          level,
          complexity,
          assessorName: resolvedAssessorName,
          strengths,
          improvements,
        });
        setCompleted(payload.request);
        setRecord(payload.request);
        return;
      }
      if (!response.ok) {
        setFormError(payload?.message ?? "Could not submit this EPA response.");
        return;
      }
    } catch {
      if (process.env.NODE_ENV !== "test") {
        setFormError("Could not submit this EPA response. Check your connection and try again.");
        return;
      }
    } finally {
      setSubmitting(false);
    }

    const localResult = submitEpaMagicLinkResponse(token, {
      level,
      complexity,
      assessorName: resolvedAssessorName,
      strengths,
      improvements,
    });
    if (localResult.ok) {
      setCompleted(localResult.request);
      setRecord(localResult.request);
      return;
    }
    setFormError(localResult.message);
  }

  return (
    <main
      data-mode-identity="teaching"
      data-work-frame=""
      data-testid="epa-magic-link-page"
      className="mx-auto grid max-w-xl gap-4 px-4 py-6"
    >
      <AssessHeader
        eyebrow="External supervisor EPA"
        title={record ? `${record.epaCode} · ${record.epaFormal}` : "EPA assessment request"}
        back={{ href: "/teaching/assessments", label: "Assessments" }}
      />

      {loading ? (
        <AssessNote>Loading assessment request…</AssessNote>
      ) : completed ? (
        <WorkCard padded testId="epa-magic-link-confirmed">
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 aria-hidden="true" className="size-icon-md" />
              <strong>EPA assessment recorded for {completed.traineeName}</strong>
            </div>
            <p className="m-0 text-sm">
              {completed.epaCode} ({completed.epaTitle}) has been submitted. No CLA account is needed; the hospital
              Medical Education Unit reviews external assessor entries.
            </p>
          </div>
        </WorkCard>
      ) : statusError || !record ? (
        <AssessNote icon={ShieldAlert}>{statusError ?? "That assessment link was not found."}</AssessNote>
      ) : (
        <div className="grid gap-3" data-testid="epa-magic-link-form">
          <WorkCard padded>
            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{record.traineeName}</strong>
                <WorkTag tone="neutral">{record.supervisorRole}</WorkTag>
              </div>
              <p className="m-0 text-sm">
                <strong>{record.epaCode}:</strong> {record.epaDetail}
              </p>
            </div>
          </WorkCard>

          <AssessTextField
            id="epa-magic-link-assessor-name"
            label="Your name and role (assessor)"
            value={assessorName}
            onChange={setAssessorName}
            single
          />

          <OptionCard
            legend={`Level of supervision ${record.traineeName} needed`}
            name="epa-magic-link-level"
            value={level}
            onChange={setLevel}
            options={LEVEL_OPTIONS}
          />

          <WorkSectionLabel>Case complexity (optional)</WorkSectionLabel>
          <WorkChips label="Case complexity">
            {CASE_COMPLEXITIES.map((item) => (
              <WorkChip
                key={item.id}
                selected={complexity === item.id}
                onClick={() => setComplexity(complexity === item.id ? null : item.id)}
              >
                {item.title}
              </WorkChip>
            ))}
          </WorkChips>

          <AssessTextField
            id="epa-magic-link-strengths"
            label="What went well (optional, no patient details)"
            value={strengths}
            onChange={setStrengths}
            single
          />

          <AssessTextField
            id="epa-magic-link-improvements"
            label="One thing to improve (optional, no patient details)"
            value={improvements}
            onChange={setImprovements}
            single
          />

          {patientProblem ? (
            <AssessNote icon={ShieldAlert}>{patientProblem.body}</AssessNote>
          ) : formError ? (
            <AssessNote icon={ShieldAlert}>{formError}</AssessNote>
          ) : null}

          <WorkButton
            icon={Send}
            size="wide"
            testId="epa-magic-link-submit"
            disabled={!level || Boolean(patientProblem) || submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting ? "Submitting…" : "Submit EPA assessment"}
          </WorkButton>
        </div>
      )}
    </main>
  );
}
