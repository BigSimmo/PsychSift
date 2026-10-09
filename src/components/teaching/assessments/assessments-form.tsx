"use client";

import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Lock,
  Target,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";

import { WorkButton, WorkCheckRow, WorkChip, WorkChips, WorkDock } from "@/components/mode-kit/work";
import {
  AssessCallout,
  AssessHeader,
  AssessKeyValue,
  AssessNote,
  AssessTextField,
  DomainCard,
  OptionCard,
  OutcomeRow,
  RatingScale,
  StepBar,
  StepHeader,
  ToggleRow,
  closeIcon,
} from "@/components/teaching/assessments/assess-kit";
import {
  List,
  Row,
  SectionLabel,
  SectionNote,
  TextLink,
  viewHref,
} from "@/components/teaching/assessments/assessments-parts";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import {
  DOMAINS,
  EVIDENCE_SOURCES,
  FORM_STEPS,
  GLOBAL_RATINGS,
  LAST_FORM_STEP,
  RATING_LABELS,
  domain as domainInfo,
  epa as epaInfo,
  globalRatingName,
  supervisionLevelName,
  type DomainNumber,
  type GlobalRating,
} from "@/lib/teaching/assessments/content";
import {
  bookingLabel,
  epasInTerm,
  formBlockers,
  formMentionsPatient,
  lowDomains,
  needsImprovementPlan,
  selfDone,
  selfLocked,
  supLocked,
  supReady,
  type AssessmentForm as FormState,
  type Who,
} from "@/lib/teaching/assessments/model";
import {
  SAMPLE_DOCTOR,
  SAMPLE_REGISTRAR,
  SAMPLE_REGISTRAR_NOTE,
  SAMPLE_SUPERVISOR,
} from "@/lib/teaching/assessments/sample";
import { withUnit } from "@/components/teaching/teaching-number";

const DOC = SAMPLE_DOCTOR;
const SUP = SAMPLE_SUPERVISOR.short;
/** The step's title takes focus on each move, so keyboard and screen-reader users start at the top of it. */
const STEP_HEADING = {
  tabIndex: -1,
  "data-step-heading": "",
  className: "assess-dom__title scroll-mt-24 outline-none",
};

/** The short name of a step, for "Next: Clinical practice" and the line under the step bar. */
function stepName(index: number, sup: boolean): string {
  const step = FORM_STEPS[index];
  if (!step) return "";
  if (step === "about") return "About this form";
  if (step === "global") return sup ? "Global rating" : "Overall";
  if (step === "summary") return "Strengths";
  if (step === "review") return "Check and finish";
  return domainInfo(Number(step.slice(1)) as DomainNumber).title;
}

function BlindNote() {
  return (
    <AssessCallout icon={EyeOff} tone="neutral" title={`${DOC.first}'s ratings stay hidden`}>
      You see them after your draft is done, so your view is your own.
    </AssessCallout>
  );
}

function StepTitle({ kicker, title, sub }: { kicker: string; title: string; sub?: string }) {
  return <DomainCard kicker={kicker} title={title} sub={sub} headingProps={STEP_HEADING} />;
}

type StepProps = Pick<ScreenProps, "s" | "dispatch"> & { who: Who };

function AboutStep({ s, dispatch, who, locked }: StepProps & { locked: boolean }) {
  const sup = who === "sup";
  const f = s[who];
  return (
    <>
      {sup && !supReady(s) ? <BlindNote /> : null}
      <section className="work-card" aria-labelledby="assess-about-title">
        <div className="assess-dom">
          <div className="assess-dom__kicker">{sup ? `${DOC.name} · ${DOC.grade}` : "End-of-term · term 4"}</div>
          <h3 id="assess-about-title" {...STEP_HEADING}>
            Psychiatry, 31 Aug to 8 Nov
          </h3>
          <p className="assess-dom__sub">
            {sup
              ? "You're completing this as term supervisor. Your MEU sets when the form is due."
              : `Optional, but it makes your meeting with ${SUP} more useful. ${SUP} sees it only after she finishes her own draft. PsychSift doesn't send it to the MEU or the Assessment Review Panel.`}
          </p>
        </div>
        <AssessKeyValue k="Form" v="End-of-term" />
        <AssessKeyValue k="Due to the MEU" v="Fri 20 Nov" />
        <AssessKeyValue k="Meeting" v={s.booking ? bookingLabel(s.booking) : "Not booked yet"} />
      </section>
      {sup && s.request.registrar ? (
        <AssessCallout icon={BookOpen} tone="neutral" title={`Notes from ${SAMPLE_REGISTRAR.name}, registrar`}>
          <i>{SAMPLE_REGISTRAR_NOTE}</i>
        </AssessCallout>
      ) : null}
      <SectionLabel>{sup ? "Sources of information" : "What are you drawing on?"}</SectionLabel>
      <WorkChips label={sup ? "Sources of information" : "What are you drawing on?"}>
        {EVIDENCE_SOURCES.map((source) => (
          <WorkChip
            key={source}
            selected={f.sources.includes(source)}
            onClick={() => {
              if (!locked) dispatch({ type: "toggle-source", who, source });
            }}
          >
            {source}
          </WorkChip>
        ))}
      </WorkChips>
      <AssessTextField
        id={`assess-other-${who}`}
        label="Other (please specify)"
        value={f.other}
        placeholder="For example, ward pharmacist"
        onChange={(value) => dispatch({ type: "set-other", who, value })}
        readOnly={locked}
        single
      />
      <SectionLabel>{sup ? "Shared with you" : "Your evidence this term"}</SectionLabel>
      <List label={sup ? "Shared with you" : "Your evidence this term"}>
        {epasInTerm(s, "t4").map((r, i) => (
          <Row
            key={i}
            icon={Target}
            iconTone={r.level === "direct" ? "muted" : "ok"}
            title={`EPA ${r.epa} · ${epaInfo(r.epa).title}`}
            subtitle={`${supervisionLevelName(r.level)} · ${r.by} (${r.role})`}
          />
        ))}
        {sup ? (
          <Row
            icon={BookOpen}
            title="Logbook"
            subtitle={
              s.share.log ? `3 teaching sessions, 1 course. Shared by ${DOC.first}.` : `Not shared by ${DOC.first}`
            }
          />
        ) : (
          <Row
            icon={BookOpen}
            title="3 teaching sessions, 1 course"
            subtitle="From your Logbook. You choose whether to share it."
          />
        )}
        <Row icon={FileText} title="Mid-term report" subtitle="Fri 2 Oct · goals set then" />
      </List>
      {locked ? null : (
        <WorkButton variant="quiet" icon={Copy} onClick={() => dispatch({ type: "form-example", who })}>
          Fill with example answers
        </WorkButton>
      )}
    </>
  );
}

function DomainStep({ s, dispatch, who, k }: StepProps & { k: DomainNumber }) {
  const sup = who === "sup";
  const f = s[who];
  const d = domainInfo(k);
  const r = f.ratings[k];
  const low = r !== null && r <= 2;
  return (
    <>
      {sup && !supReady(s) ? <BlindNote /> : null}
      <StepTitle kicker={`Domain ${withUnit(k, "of")} 4`} title={d.title} sub={d.subtitle} />
      <SectionLabel
        end={
          <span className="flex gap-3">
            {sup ? <TextLink onClick={() => dispatch({ type: "tick-all", who, domain: k })}>Tick all</TextLink> : null}
            <TextLink onClick={() => dispatch({ type: "toggle-wording", who })}>
              {f.fullWording ? "Short wording" : "Full wording"}
            </TextLink>
          </span>
        }
      >
        {sup ? "Outcomes you observed" : "Outcomes you've shown"}
      </SectionLabel>
      <div className="work-card" role="group" aria-label={`Domain ${k} outcomes`}>
        {d.outcomes.map((o) => (
          <OutcomeRow
            key={o.id}
            number={o.id}
            title={o.name}
            detail={f.fullWording ? o.detail : undefined}
            checked={f.ticks[k].includes(o.id)}
            onToggle={() => dispatch({ type: "toggle-tick", who, domain: k, outcome: o.id })}
          />
        ))}
      </div>
      <AssessNote>
        {sup
          ? "Not seen directly? Use other evidence, or leave it unticked (not applicable)."
          : "Tick the ones you could give an example of."}
      </AssessNote>
      <SectionLabel
        end={<SectionNote>{`${withUnit(f.ticks[k].length, "of")} ${d.outcomes.length} ticked`}</SectionNote>}
      >
        {sup ? "Rating for this domain" : "How would you rate yourself?"}
      </SectionLabel>
      <RatingScale
        name={`rating-${who}-${k}`}
        legend={sup ? `Rating for domain ${k}` : `Your rating for domain ${k}`}
        value={r}
        lowIsRed={sup}
        onChange={(rating) => dispatch({ type: "set-rating", who, domain: k, rating })}
      />
      {low && sup ? (
        <AssessCallout icon={TriangleAlert} tone="red" title="A 1 or 2 needs an improvement plan">
          Say which outcomes weren&apos;t met. Before you finish, you&apos;ll be asked to notify the MEU.
        </AssessCallout>
      ) : null}
      {low && !sup ? (
        <AssessCallout icon={BookOpen} tone="neutral" title="Worth raising at your meeting">
          Self-ratings aren&apos;t part of the official record.
        </AssessCallout>
      ) : null}
      <AssessTextField
        id={`assess-fb-${who}-${k}`}
        label={sup ? "Feedback" : "Your notes"}
        value={f.feedback[k]}
        required={low && sup}
        onChange={(value) => dispatch({ type: "set-feedback", who, domain: k, value })}
        placeholder={
          low && sup
            ? "Which outcomes weren't met, and what would help"
            : sup
              ? "What did you see? Describe skills, not patients."
              : "Kinds of situations you could talk about, not patient details"
        }
      />
    </>
  );
}

function GlobalStep({ s, dispatch, who }: StepProps) {
  const sup = who === "sup";
  const f = s[who];
  return (
    <>
      {sup && !supReady(s) ? <BlindNote /> : null}
      <StepTitle
        kicker="End-of-term only"
        title={sup ? "Global rating" : "How do you think the term went?"}
        sub={
          sup
            ? `Against what is expected for ${DOC.grade} this term`
            : `Optional. ${SUP}'s rating is the one that counts.`
        }
      />
      <OptionCard<GlobalRating>
        name={`global-${who}`}
        legend="Global rating"
        value={f.global}
        onChange={(rating) => dispatch({ type: "set-global", who, rating })}
        options={GLOBAL_RATINGS}
      />
      {!sup && f.global ? (
        // The reducer clears the doctor's own rating when the same rating is sent again.
        <WorkButton variant="secondary" onClick={() => dispatch({ type: "set-global", who, rating: f.global! })}>
          Clear my rating
        </WorkButton>
      ) : null}
      {sup && (f.global === "cond" || f.global === "unsat") ? (
        <AssessCallout icon={TriangleAlert} tone="red" title="Conditional pass or Unsatisfactory">
          This needs the DCT involved. Before you finish, you&apos;ll be asked to notify the MEU so an improvement plan
          can start.
        </AssessCallout>
      ) : null}
      {sup ? (
        <AssessNote icon={Lock}>
          {`Not final until you both sign and the DCT countersigns. No improvement plan is open for ${DOC.first}.`}
        </AssessNote>
      ) : null}
    </>
  );
}

function SummaryStep({ s, dispatch, who }: StepProps) {
  const sup = who === "sup";
  const f = s[who];
  return (
    <>
      {sup && !supReady(s) ? <BlindNote /> : null}
      <StepTitle
        kicker="In your words"
        title={sup ? "Strengths and areas for improvement" : "Strengths and what to work on"}
      />
      <AssessTextField
        id={`assess-strengths-${who}`}
        label="Strengths"
        value={f.strengths}
        onChange={(value) => dispatch({ type: "set-text", who, field: "strengths", value })}
        placeholder={
          sup ? "What should they keep doing? Skills, not patients." : "What went well? Skills, not patients."
        }
      />
      <AssessTextField
        id={`assess-areas-${who}`}
        label="Areas for improvement"
        value={f.areas}
        onChange={(value) => dispatch({ type: "set-text", who, field: "areas", value })}
        placeholder={sup ? "One or two specific things for next term" : "What do you want more experience in?"}
      />
    </>
  );
}

function ReviewRows({
  f,
  sup,
  locked,
  setStep,
}: {
  f: FormState;
  sup: boolean;
  locked: boolean;
  setStep: (to: number) => void;
}) {
  const overall = f.global ? globalRatingName(f.global) : sup ? "Not chosen" : "Skipped";
  return (
    <List label="Your answers">
      {DOMAINS.map((d) => {
        const rating = f.ratings[d.n];
        const words = `${withUnit(f.ticks[d.n].length, "of")} ${withUnit(d.outcomes.length, "outcomes")} · ${rating ? RATING_LABELS[rating - 1] : "not rated"}`;
        const tone = !rating
          ? "text-[color:var(--text-muted)]"
          : sup && rating <= 2
            ? "text-[color:var(--danger-text)]"
            : "text-[color:var(--text-heading)]";
        const score = <b className={`text-lg font-normal tabular-nums ${tone}`}>{rating ?? "–"}</b>;
        return locked ? (
          <Row key={d.n} title={`${d.n} · ${d.title}`} subtitle={words} end={score} />
        ) : (
          <Row key={d.n} title={`${d.n} · ${d.title}`} subtitle={words} end={score} onClick={() => setStep(d.n)} />
        );
      })}
      {locked ? (
        <Row title="Overall" subtitle={overall} />
      ) : (
        <Row title="Overall" subtitle={overall} onClick={() => setStep(5)} />
      )}
    </List>
  );
}

export function AssessmentForm({ s, dispatch, who, go }: ScreenProps & { who: Who }) {
  const sup = who === "sup";
  const f = s[who];
  const locked = sup ? supLocked(s) : selfLocked(s);
  const stepIndex = locked ? LAST_FORM_STEP : f.step;
  const step = FORM_STEPS[stepIndex]!;
  const total = FORM_STEPS.length;
  const back = sup ? viewHref("home", { as: "supervisor" }) : viewHref("hub");
  const setStep = (to: number) => {
    dispatch({ type: "form-step", who, step: to });
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0 });
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-step-heading]")?.focus());
  };
  const previous =
    stepIndex > 0 ? (
      <WorkButton
        variant="secondary"
        icon={ChevronLeft}
        aria-label="Previous step"
        onClick={() => setStep(stepIndex - 1)}
      >
        <span className="sr-only">Previous step</span>
      </WorkButton>
    ) : null;

  let body: ReactNode;
  let dock: ReactNode = null;
  if (step === "about") body = <AboutStep s={s} dispatch={dispatch} who={who} locked={locked} />;
  else if (step === "global") body = <GlobalStep s={s} dispatch={dispatch} who={who} />;
  else if (step === "summary") body = <SummaryStep s={s} dispatch={dispatch} who={who} />;
  else if (step !== "review")
    body = <DomainStep s={s} dispatch={dispatch} who={who} k={Number(step.slice(1)) as DomainNumber} />;
  else {
    const lows = lowDomains(f);
    const reasons = formBlockers(f, who);
    const ok = reasons.length === 0;
    const first = sup ? !supReady(s) : !selfDone(s);
    const whyId = `assess-why-${who}`;
    body = (
      <>
        {locked ? (
          <AssessCallout
            icon={Lock}
            tone="neutral"
            title={sup ? "Signed, so it can't be changed here" : `${SUP} has seen this, so it can't be changed now`}
          >
            {sup
              ? "To correct it, add a dated amendment through the MEU."
              : "You can still raise anything at your meeting."}
          </AssessCallout>
        ) : sup && !supReady(s) ? (
          <BlindNote />
        ) : null}
        <StepTitle
          kicker={locked ? "Your answers" : "Check and finish"}
          title={sup ? `${DOC.first}'s end-of-term assessment` : "Your self-assessment"}
        />
        <ReviewRows f={f} sup={sup} locked={locked} setStep={setStep} />
        {f.strengths || f.areas ? (
          <div className="work-card work-card--pad grid gap-1.5">
            <span className="work-label">Strengths</span>
            <p className="m-0 text-sm text-[color:var(--text-heading)]">{f.strengths || "Not written"}</p>
            <span className="work-label pt-1.5">Areas for improvement</span>
            <p className="m-0 text-sm text-[color:var(--text-heading)]">{f.areas || "Not written"}</p>
          </div>
        ) : null}
        {sup && lows.length && f.global === "sat" ? (
          <AssessCallout icon={TriangleAlert} tone="amber" title="Check this is what you mean">
            {`Domain ${lows.join(", ")} is rated 1 or 2, but the overall rating is Satisfactory.`}
          </AssessCallout>
        ) : null}
        {sup && needsImprovementPlan(f) && !locked ? (
          <div className="work-card">
            <ToggleRow
              title="Notify the MEU now"
              sub={`So they can start an improvement plan (IPAP) with ${DOC.first}`}
              checked={f.ipap}
              onChange={() => dispatch({ type: "toggle-ipap", who })}
            />
          </div>
        ) : null}
        {formMentionsPatient(f) ? (
          <AssessCallout icon={TriangleAlert} tone="amber" title="Check for patient details">
            Something you wrote looks like patient details (a name, URN, date or bed number). This check only catches
            some, so please read it through before you finish.
          </AssessCallout>
        ) : null}
        {locked ? null : (
          <>
            <SectionLabel end={reasons.length ? <SectionNote>{reasons.length}</SectionNote> : undefined}>
              {reasons.length ? "Still needed" : "Ready"}
            </SectionLabel>
            <div className="work-card" id={whyId}>
              {reasons.length ? (
                reasons.map((reason) => (
                  <WorkCheckRow key={reason} tone="warn">
                    {reason}
                  </WorkCheckRow>
                ))
              ) : (
                <WorkCheckRow>Everything needed is done</WorkCheckRow>
              )}
            </div>
            <AssessNote>
              {sup
                ? first
                  ? `When you finish your draft, you'll see ${DOC.first}'s self-assessment beside yours. You can still change your answers until you sign. Changes after that point are shown to ${DOC.first}.`
                  : `Changes are shown to ${DOC.first}. You sign after the meeting.`
                : first
                  ? `Next, ask ${SUP} to complete the form. She won't see your ratings until she has finished her draft.`
                  : "Your changes are kept on this page."}
            </AssessNote>
          </>
        )}
      </>
    );
    if (!locked)
      dock = (
        <WorkDock>
          {previous}
          <WorkButton
            icon={ok ? (sup ? Eye : Check) : undefined}
            disabled={!ok}
            onClick={() => {
              dispatch({ type: "form-finish", who });
              go(sup ? viewHref("side", { as: "supervisor" }) : viewHref("hub"));
            }}
          >
            {!ok
              ? reasons[0]!.replace(/\.$/, "")
              : sup
                ? first
                  ? "Finish draft"
                  : "Save changes"
                : first
                  ? "Save self-assessment"
                  : "Save changes"}
          </WorkButton>
        </WorkDock>
      );
  }
  if (!locked && stepIndex < LAST_FORM_STEP)
    dock = (
      <WorkDock>
        {previous}
        <WorkButton icon={ChevronRight} onClick={() => setStep(stepIndex + 1)}>
          {`Next: ${stepName(stepIndex + 1, sup)}`}
        </WorkButton>
      </WorkDock>
    );

  return (
    <>
      <AssessHeader
        eyebrow={locked ? "View only" : `Step ${withUnit(stepIndex + 1, "of")} ${total}`}
        title={sup ? `${DOC.first}'s end-of-term` : "Rate yourself"}
        back={{ href: back, label: sup ? "To do" : "End-of-term" }}
        action={
          locked
            ? undefined
            : {
                icon: closeIcon,
                label: "Save and close",
                onClick: () => {
                  dispatch({ type: "form-save-exit", who });
                  go(back);
                },
              }
        }
      />
      {locked ? null : (
        <>
          <StepBar total={total} current={stepIndex} />
          <StepHeader
            left={stepName(stepIndex, sup)}
            right={f.status === "new" ? "Not started" : f.status === "done" ? "Finished" : "Kept on this page"}
          />
        </>
      )}
      {body}
      {dock}
    </>
  );
}
