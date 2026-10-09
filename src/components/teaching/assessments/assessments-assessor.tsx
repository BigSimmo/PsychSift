"use client";

import { MessageSquare, Send, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { WorkButton, WorkChip, WorkChips } from "@/components/mode-kit/work";
import {
  AssessCallout,
  AssessHeader,
  AssessKeyValue,
  AssessNote,
  AssessTextField,
  OptionCard,
} from "@/components/teaching/assessments/assess-kit";
import { AnswerEpaRequest, IN_CLA_NOTE, LEVEL_OPTIONS } from "@/components/teaching/assessments/assessments-help";
import { Card, SectionLabel, WhyNot, viewHref } from "@/components/teaching/assessments/assessments-parts";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import {
  CASE_COMPLEXITIES,
  epa as epaInfo,
  SUPERVISION_LEVELS,
  type CaseComplexity,
  type SupervisionLevel,
} from "@/lib/teaching/assessments/content";
import {
  EPA_FEEDBACK_MAX,
  assessorName,
  epaWithAssessor,
  looksLikePatientDetails,
  todayLabel,
  type EpaFeedback,
} from "@/lib/teaching/assessments/model";
import { SAMPLE_DOCTOR } from "@/lib/teaching/assessments/sample";

/*
 * What an assessor gets from the doctor's EPA request: the whole AMC EPA form on one page (feature for the
 * owner's 8 Oct review of CLA). In CLA this is the emailed link's "personalised response page", which needs no
 * account and stops working once submitted. The fields follow the AMC EPA assessment form: how the assessor
 * knows, the supervision level, case complexity, whether the rating was right for the level of training, and
 * what went well, what could be better and an agreed learning goal. MADE-UP SAMPLE ONLY.
 */

const DOC = SAMPLE_DOCTOR;
/** The doctor's own part of the made-up request. */
const DOCTOR_PART = { case: "Made-up case. No patient details.", own: "proximal" as SupervisionLevel };

/** The level as the AMC form words it ("Requires proximal supervision"). */
const formLevel = (id: SupervisionLevel) => SUPERVISION_LEVELS.find((l) => l.id === id)?.formLabel ?? id;

const OBSERVED_OPTIONS = [
  { id: "direct" as const, title: "I directly observed some part of it" },
  {
    id: "team" as const,
    title: "A team member who was there told me",
    detail: "Name their role in your feedback.",
  },
];

export function AssessorForm({ s, params, saveEpa, dispatch, role }: ScreenProps) {
  // The doctor opens this from "See what they get": a preview only, so they can never answer their own EPA
  // (site audit B3). The live form is the assessor's, on the supervisor's side.
  const preview = role === "doctor";
  const raw = params.get("i");
  const index = raw !== null && /^\d+$/.test(raw) ? Number(raw) : -1;
  const r = index >= 0 ? s.epaRequests[index] : undefined;
  const [observed, setObserved] = useState<"direct" | "team" | null>(null);
  const [level, setLevel] = useState<SupervisionLevel | null>(null);
  const [complexity, setComplexity] = useState<CaseComplexity | null>(null);
  const [rightLevel, setRightLevel] = useState<boolean | null>(null);
  const [well, setWell] = useState("");
  const [better, setBetter] = useState("");
  const [goal, setGoal] = useState("");
  const [answer, setAnswer] = useState<"not-yet" | "sent-back" | null>(null);
  const home = viewHref("home");
  if (!r) {
    return (
      <>
        <AssessHeader eyebrow="EPA request" title="Request not found" back={{ href: home, label: "Assessments" }} />
        <AssessNote>This made-up request isn&apos;t in the story. Go back to see the open ones.</AssessNote>
      </>
    );
  }
  const info = epaInfo(r.epa);
  const guest = r.who === "guest";
  const header = (
    <AssessHeader
      eyebrow={guest ? "EPA request · no account needed" : `EPA request · to ${assessorName(r)}`}
      title={preview ? "What the assessor sees" : `${DOC.name} asked you to assess EPA ${r.epa}`}
      back={{ href: home, label: "Assessments" }}
    />
  );
  if (r.status === "done") {
    return (
      <>
        {header}
        <AssessCallout icon={ShieldCheck} tone="neutral" title="Submitted" role="status" testId="assess-epa-form-done">
          {preview
            ? `${formLevel(r.level!)}. In CLA the link stops working once it is submitted.`
            : `${formLevel(r.level!)}. In CLA the link stops working now, and ${DOC.first} sees your answers.`}
        </AssessCallout>
        <Card>
          <AssessKeyValue k="EPA" v={`${r.epa} · ${info.formal}`} />
          {r.feedback?.observed ? (
            <AssessKeyValue k="How you know" v={r.feedback.observed === "direct" ? "Saw it" : "Told by the team"} />
          ) : null}
          {typeof r.feedback?.rightLevel === "boolean" ? (
            <AssessKeyValue k="Right for a PGY1 now" v={r.feedback.rightLevel ? "Yes" : "No"} />
          ) : null}
        </Card>
      </>
    );
  }
  if (!epaWithAssessor(r)) {
    return (
      <>
        {header}
        <AssessNote>
          {r.status === "cancelled"
            ? `${DOC.first} cancelled this request. In CLA the emailed link would no longer work.`
            : `This was sent back to ${DOC.first}, who can ask someone else.`}
        </AssessNote>
      </>
    );
  }
  if (answer && !preview) {
    return (
      <>
        {header}
        <AnswerEpaRequest
          index={index}
          request={r}
          kind={answer}
          dispatch={dispatch}
          onDone={() => setAnswer(null)}
          onCancel={() => setAnswer(null)}
        />
      </>
    );
  }
  const texts = [well, better, goal].map((x) => x.trim());
  const why = !observed
    ? "Say how you know first."
    : !level
      ? "Choose a supervision level first."
      : texts.some((x) => x.length > EPA_FEEDBACK_MAX)
        ? `Keep each answer under ${EPA_FEEDBACK_MAX} characters.`
        : texts.some(looksLikePatientDetails)
          ? "Take out the patient details first."
          : null;
  const submit = () => {
    if (why || !observed || !level) return;
    const feedback: EpaFeedback = {
      observed,
      ...(rightLevel === null ? {} : { rightLevel }),
      ...(texts[1] ? { better: texts[1] } : {}),
      ...(texts[2] ? { goal: texts[2] } : {}),
    };
    saveEpa({
      type: "record-epa",
      index,
      level,
      ...(complexity ? { complexity } : {}),
      ...(texts[0] ? { note: texts[0] } : {}),
      feedback,
    });
  };
  return (
    <>
      {header}
      <AssessNote icon={MessageSquare}>{`${info.formal}: ${info.detail}`}</AssessNote>
      {preview ? (
        <AssessNote>{`A preview of the form ${assessorName(r)} fills in. Only they can answer it.`}</AssessNote>
      ) : null}
      {r.status === "not-yet" && !preview ? (
        <AssessNote>{`You told ${DOC.first} you can't assess it yet. It stays here until you can.`}</AssessNote>
      ) : null}
      <SectionLabel>{`${DOC.first}'s part`}</SectionLabel>
      <Card>
        <AssessKeyValue k="When" v={todayLabel(s)} />
        <AssessKeyValue k="Case" v={DOCTOR_PART.case} />
        <AssessKeyValue k={`${DOC.first}'s own rating`} v={formLevel(DOCTOR_PART.own)} />
      </Card>
      <SectionLabel>How you know</SectionLabel>
      <OptionCard
        legend="How you know"
        name="assess-epa-observed"
        value={observed}
        onChange={setObserved}
        options={OBSERVED_OPTIONS}
        disabled={preview}
      />
      <SectionLabel>{`Level of supervision ${DOC.first} needed`}</SectionLabel>
      <OptionCard
        legend={`Level of supervision ${DOC.first} needed`}
        name="assess-epa-form-level"
        value={level}
        onChange={setLevel}
        options={LEVEL_OPTIONS}
        disabled={preview}
      />
      {/* A disabled fieldset turns the chips off in the preview: the kit's chips have no disabled prop. */}
      <fieldset disabled={preview} className="m-0 grid min-w-0 gap-3 border-0 p-0">
        <WorkChips label="Case complexity (optional)">
          {CASE_COMPLEXITIES.map((c) => (
            <WorkChip
              key={c.id}
              selected={complexity === c.id}
              onClick={() => setComplexity(complexity === c.id ? null : c.id)}
            >
              {c.title}
            </WorkChip>
          ))}
        </WorkChips>
        <WorkChips label={`Is that level right for a ${DOC.grade} at this stage? (optional)`}>
          {[true, false].map((yes) => (
            <WorkChip
              key={String(yes)}
              selected={rightLevel === yes}
              onClick={() => setRightLevel(rightLevel === yes ? null : yes)}
            >
              {yes ? "Yes" : "No"}
            </WorkChip>
          ))}
        </WorkChips>
      </fieldset>
      <AssessTextField
        id="assess-epa-well"
        label="What went well (optional)"
        value={well}
        onChange={setWell}
        readOnly={preview}
      />
      <AssessTextField
        id="assess-epa-better"
        label="What could be better (optional)"
        value={better}
        onChange={setBetter}
        readOnly={preview}
      />
      <AssessTextField
        id="assess-epa-goal"
        label="Agreed learning goal (optional)"
        value={goal}
        onChange={setGoal}
        readOnly={preview}
      />
      {preview ? (
        <AssessNote icon={ShieldCheck}>
          {`Example only. In CLA ${assessorName(r)} answers from the emailed link or on your device, and submits it themselves.`}
        </AssessNote>
      ) : (
        <>
          <WorkButton icon={Send} size="wide" disabled={!!why} onClick={submit}>
            {`Submit EPA ${r.epa}`}
          </WorkButton>
          {why ? <WhyNot id="assess-epa-form-why">{why}</WhyNot> : null}
          <div className="grid gap-2 pt-1">
            <p className="work-label m-0">{`Can't do it?`}</p>
            <div className="grid grid-cols-2 gap-2">
              {r.status === "requested" ? (
                <WorkButton variant="secondary" onClick={() => setAnswer("not-yet")}>
                  {`Can't assess yet`}
                </WorkButton>
              ) : null}
              <WorkButton variant="secondary" onClick={() => setAnswer("sent-back")}>
                Send back
              </WorkButton>
            </div>
          </div>
          <AssessNote icon={ShieldCheck}>
            {`Example only. In CLA the assessor answers from the emailed link, with no account needed. ${IN_CLA_NOTE}`}
          </AssessNote>
        </>
      )}
    </>
  );
}
