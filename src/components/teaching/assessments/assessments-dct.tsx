"use client";

import { ClipboardList, LayoutGrid, PenLine, Scale, ShieldCheck, TriangleAlert, UserCheck } from "lucide-react";
import { useState, type Dispatch } from "react";

import { WorkButton, WorkHero, WorkRing, WorkTag, useWorkUndoToast } from "@/components/mode-kit/work";
import {
  AssessCallout,
  AssessHeader,
  AssessKeyValue,
  AssessNote,
  AssessTextField,
} from "@/components/teaching/assessments/assess-kit";
import {
  Card,
  List,
  Row,
  SectionLabel,
  SectionNote,
  StepRow,
  viewHref,
} from "@/components/teaching/assessments/assessments-parts";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { Sheet } from "@/components/ui/sheet";
import { withUnit } from "@/components/teaching/teaching-number";
import { DOMAINS, globalRatingName } from "@/lib/teaching/assessments/content";
import {
  DCT_FEEDBACK_MAX,
  GUEST_ASSESSORS,
  IMPROVEMENT_PHASES,
  IMPROVEMENT_PLANS,
  PANEL_DATE,
  PANEL_FACTS,
  RESPONSE_DAYS,
  dctBehind,
  dctForm,
  dctForms,
  dctWaiting,
  improvementPlan,
  ratingWords,
  type DctAction,
  type DctForm,
  type DctState,
} from "@/lib/teaching/assessments/dct";
import { looksLikePatientDetails, todayLabel } from "@/lib/teaching/assessments/model";
import { overviewDoctors } from "@/lib/teaching/assessments/overview";

/*
 * The DCT's side of the made-up Assessments story: end-of-term forms to sign, improvement plans,
 * who is behind, and the parts of CLA the MEU runs. Facts and sources are in lib/teaching/assessments/dct.ts.
 */

export type DctProps = Pick<ScreenProps, "s" | "params" | "go"> & {
  readonly dct: DctState;
  readonly dctDispatch: Dispatch<DctAction>;
};

const asDct = { as: "dct" } as const;

function formLine(f: DctForm): string {
  return `${globalRatingName(f.global)} · ${f.supervisor} · both signed ${f.bothSigned}`;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/* ---------------------------------------------------------- home */

type DctSheet = null | "guests" | "panel";

export function DctHome({ s, dct }: DctProps) {
  const [sheet, setSheet] = useState<DctSheet>(null);
  const forms = dctForms(s);
  const waiting = dctWaiting(s, dct);
  const behind = dctBehind(s);
  const doctors = overviewDoctors(s).length;
  const signed = forms.length - waiting.length;
  return (
    <>
      <AssessHeader eyebrow="Director of Clinical Training" title="Assessments" />
      <WorkHero
        testId="assess-dct-hero"
        eyebrow="Example health service · PGY1 and PGY2"
        title={
          waiting.length
            ? `${waiting.length} ${waiting.length === 1 ? "form" : "forms"} to sign off`
            : "No forms to sign off"
        }
        sub={`${doctors} doctors this term. ${behind.length} ${behind.length === 1 ? "is" : "are"} behind on something.`}
        ring={
          <WorkRing
            value={`${signed}/${forms.length}`}
            label="signed"
            fraction={forms.length ? signed / forms.length : 1}
            accessibleLabel={`${withUnit(signed, "of")} ${forms.length} end-of-term forms signed off`}
          />
        }
      />
      <SectionLabel end={<SectionNote>{waiting.length}</SectionNote>}>Waiting for your sign-off</SectionLabel>
      {waiting.length ? (
        <List label="Waiting for your sign-off">
          {waiting.map((f) => (
            <Row
              key={f.id}
              avatar={f.initials}
              title={`${f.doctor} · ${f.term.split(" · ")[0]}`}
              subtitle={formLine(f)}
              tag={
                f.responseOpen ? (
                  <WorkTag tone="amber">{`Reply until ${f.responseUntil}`}</WorkTag>
                ) : (
                  <WorkTag tone="mode">Sign</WorkTag>
                )
              }
              href={viewHref("dctsign", { ...asDct, id: f.id })}
            />
          ))}
        </List>
      ) : (
        <AssessNote icon={ShieldCheck}>Every end-of-term form here is signed off.</AssessNote>
      )}
      <SectionLabel end={<SectionNote>{`${IMPROVEMENT_PLANS.length} open`}</SectionNote>}>
        Improvement plans
      </SectionLabel>
      <List label="Improvement plans">
        {IMPROVEMENT_PLANS.map((p) => (
          <Row
            key={p.id}
            avatar={p.initials}
            title={p.doctor}
            subtitle={`Phase ${p.phase}, ${IMPROVEMENT_PHASES[p.phase - 1]!.title.toLowerCase()} · review ${p.review}`}
            href={viewHref("plan", { ...asDct, id: p.id })}
          />
        ))}
      </List>
      <SectionLabel end={<SectionNote>{behind.length}</SectionNote>}>Behind this term</SectionLabel>
      {behind.length ? (
        <List label="Behind this term">
          {behind.map((r) => (
            <Row
              key={r.id}
              avatar={r.initials}
              title={r.name}
              subtitle={`${r.grade} · ${r.unit} · mid-term ${lowerFirst(r.mid.detail)} · EPAs ${r.epas.detail}`}
              tag={<WorkTag tone="red">Overdue</WorkTag>}
              href={viewHref("overview", { ...asDct, doctor: r.id })}
            />
          ))}
        </List>
      ) : (
        <AssessNote icon={ShieldCheck}>No one is overdue this term.</AssessNote>
      )}
      <SectionLabel>Across the service</SectionLabel>
      <List label="Across the service">
        <Row
          icon={LayoutGrid}
          title="Term overview"
          subtitle="Every doctor, status only, by supervisor"
          href={viewHref("overview", asDct)}
        />
        <Row
          icon={UserCheck}
          title="Guest assessors"
          subtitle="Waiting for the MEU to approve them"
          tag={<WorkTag tone="neutral">{String(GUEST_ASSESSORS.length)}</WorkTag>}
          onClick={() => setSheet("guests")}
        />
        <Row
          icon={Scale}
          title="Assessment Review Panel"
          subtitle={`Example date ${PANEL_DATE} · who sits on it and what it decides`}
          onClick={() => setSheet("panel")}
        />
      </List>
      <AssessNote icon={ShieldCheck}>
        Made-up doctors and forms. Real sign-offs happen in CLA, or on paper where a hospital doesn&apos;t use it.
      </AssessNote>
      <Sheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        title={sheet === "guests" ? "Guest assessors" : "Assessment Review Panel"}
      >
        <div data-mode-identity="teaching" data-work-frame="" className="contents">
          {sheet === "guests" ? <GuestAssessors /> : null}
          {sheet === "panel" ? <PanelFacts /> : null}
        </div>
      </Sheet>
    </>
  );
}

function GuestAssessors() {
  return (
    <div className="grid gap-3" data-testid="assess-dct-guests">
      <List label="Guest assessors">
        {GUEST_ASSESSORS.map((g) => (
          <Row
            key={g.name}
            icon={UserCheck}
            iconTone="amber"
            title={`${g.name}, ${g.role.toLowerCase()}`}
            subtitle={g.what}
            tag={<WorkTag tone="amber">Unapproved</WorkTag>}
          />
        ))}
      </List>
      <AssessNote>
        Someone who assesses an EPA from an emailed link, without a CLA account, shows as Unapproved until the MEU
        approves them in CLA. You see them here so nothing is missed. The MEU does the approving.
      </AssessNote>
    </div>
  );
}

function PanelFacts() {
  return (
    <div className="grid gap-3" data-testid="assess-dct-panel">
      <List label="About the panel">
        {PANEL_FACTS.map((fact) => (
          <Row key={fact} icon={Scale} title={fact} />
        ))}
      </List>
      <AssessNote>
        From the AMC&apos;s Guide to Assessment Review Panels. Your MEU sets the date and adds members in CLA. The date
        here is made up.
      </AssessNote>
    </div>
  );
}

/* ---------------------------------------------------------- one form to sign */

export function DctSignoff({ s, params, dct, dctDispatch, go }: DctProps) {
  const id = params.get("id");
  const form = dctForm(s, id);
  const [feedback, setFeedback] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const toast = useWorkUndoToast();
  const home = viewHref("home", asDct);
  if (!form) {
    return (
      <>
        <AssessHeader eyebrow="DCT sign-off" title="Form not found" back={{ href: home, label: "Assessments" }} />
        <AssessNote>This made-up form isn&apos;t in the story any more. Go back to see what is waiting.</AssessNote>
      </>
    );
  }
  const done = dct.signed[form.id];
  const first = form.doctor.replace(/^Dr /, "").split(" ")[0];
  const tooLong = feedback.trim().length > DCT_FEEDBACK_MAX;
  const patient = looksLikePatientDetails(feedback);
  const sign = () => {
    if (tooLong || patient) return;
    dctDispatch({ type: "dct-sign", id: form.id, date: todayLabel(s), feedback });
    const message = `Signed off for ${form.doctor}`;
    const undo = () => dctDispatch({ type: "dct-unsign", id: form.id });
    if (toast) {
      toast(message, undo, 10000);
      go(home);
    } else setNote(`${message}.`);
  };
  return (
    <>
      <AssessHeader
        eyebrow={`DCT sign-off · ${form.term.split(" · ")[0]!.toLowerCase()}`}
        title={form.doctor}
        back={{ href: home, label: "Assessments" }}
      />
      <Card>
        <p className="m-0 text-sm text-[color:var(--text-muted)]">{`${form.grade} · ${form.term.split(" · ")[1]} · ${form.dates}`}</p>
        <AssessKeyValue
          k="Global rating"
          v={globalRatingName(form.global)}
          tone={form.global === "unsat" ? "red" : form.global === "cond" ? "amber" : undefined}
        />
        <AssessKeyValue k="Term supervisor" v={form.supervisor} />
        <AssessKeyValue
          k="Improvement plan"
          v={form.ipap ? "Flagged by the supervisor" : "Not flagged"}
          tone={form.ipap ? "amber" : undefined}
        />
      </Card>
      <SectionLabel>Domains</SectionLabel>
      <List label="Domains">
        {DOMAINS.map((d) => (
          <Row
            key={d.n}
            title={`${d.n}. ${d.title}`}
            tag={<WorkTag tone="neutral">{ratingWords(form.ratings[d.n])}</WorkTag>}
          />
        ))}
      </List>
      {form.global === "cond" || form.global === "unsat" || form.ipap ? (
        <AssessCallout icon={TriangleAlert} tone="amber" title="Check the plan first">
          {form.global === "cond"
            ? "A conditional pass needs more information, assessment or support before a decision. "
            : ""}
          Agree an Improving Performance Action Plan with the supervisor and doctor if one isn&apos;t in place.
        </AssessCallout>
      ) : null}
      <SectionLabel>Before you sign</SectionLabel>
      <List label="Before you sign">
        <StepRow state="ok" title={`Discussed with ${first}`} detail={form.discussed} />
        <StepRow
          state="ok"
          title="Signed by both"
          detail={`${form.bothSigned}. The doctor's signature means discussed, not agreed.`}
        />
        <StepRow
          state={form.responseOpen ? "lock" : "ok"}
          title={form.responseOpen ? `${first} can still reply in writing` : `No written reply from ${first}`}
          detail={
            form.responseOpen
              ? `Until ${form.responseUntil}. A doctor who disagrees has ${RESPONSE_DAYS} days to write to you.`
              : `The ${RESPONSE_DAYS} days ended ${form.responseUntil}.`
          }
        />
        <StepRow
          state={done ? "ok" : "now"}
          title={done ? "Signed off by you" : "Your sign-off"}
          detail={done ? done.date : "Your signature and feedback finish the form"}
        />
      </List>
      {done ? (
        <AssessCallout
          icon={ShieldCheck}
          tone="neutral"
          title={`Signed off ${done.date}`}
          role="status"
          testId="assess-dct-signed"
          action={
            <WorkButton
              variant="secondary"
              onClick={() => {
                dctDispatch({ type: "dct-unsign", id: form.id });
                setNote(null);
              }}
            >
              Take back
            </WorkButton>
          }
        >
          {done.feedback ? `Your feedback: "${done.feedback}"` : "No feedback added."}
        </AssessCallout>
      ) : (
        <>
          <AssessTextField
            id="assess-dct-feedback"
            label={`Feedback for ${first} (optional)`}
            value={feedback}
            onChange={setFeedback}
          />
          {tooLong ? <AssessNote tone="amber">{`Keep it under ${DCT_FEEDBACK_MAX} characters.`}</AssessNote> : null}
          <WorkButton icon={PenLine} onClick={sign} disabled={tooLong || patient}>
            Sign off as DCT
          </WorkButton>
        </>
      )}
      {note ? (
        <p role="status" className="assess-note" data-center="">
          <span>{note}</span>
        </p>
      ) : null}
      <AssessNote icon={ShieldCheck}>
        Example only. The AMC term assessment form ends with the DCT&apos;s signature and feedback. Your MEU sets how
        that is done in CLA.
      </AssessNote>
    </>
  );
}

/* ---------------------------------------------------------- one improvement plan */

export function DctPlan({ params }: Pick<DctProps, "params">) {
  const plan = improvementPlan(params.get("id"));
  const home = viewHref("home", asDct);
  if (!plan) {
    return (
      <>
        <AssessHeader eyebrow="Improvement plan" title="Plan not found" back={{ href: home, label: "Assessments" }} />
        <AssessNote>This made-up plan isn&apos;t in the story. Go back to see the open plans.</AssessNote>
      </>
    );
  }
  return (
    <>
      <AssessHeader
        eyebrow={`Improvement plan · review ${plan.review}`}
        title={plan.doctor}
        back={{ href: home, label: "Assessments" }}
      />
      <Card>
        <AssessKeyValue k="Grade" v={plan.grade} />
        <AssessKeyValue k="Term supervisor" v={plan.supervisor} />
        <AssessKeyValue k="Next review" v={plan.review} />
      </Card>
      <SectionLabel>Phase</SectionLabel>
      <List label="Phase">
        {IMPROVEMENT_PHASES.map((p) => (
          <StepRow
            key={p.n}
            state={p.n < plan.phase ? "ok" : p.n === plan.phase ? "now" : "lock"}
            title={`${p.n}. ${p.title}`}
            detail={p.detail}
          />
        ))}
      </List>
      <SectionLabel end={<SectionNote>{plan.actions.length}</SectionNote>}>Agreed actions</SectionLabel>
      <List label="Agreed actions">
        {plan.actions.map((a) => (
          <Row
            key={a.outcome}
            icon={ClipboardList}
            title={a.action}
            subtitle={`${a.outcome} · ${a.who} · by ${a.by}`}
          />
        ))}
      </List>
      <AssessNote icon={ShieldCheck}>
        Example only. The AMC publishes the plan template: outcome statements, actions, who, by when, review dates and
        three signatures. Your MEU tells you where plans are kept.
      </AssessNote>
    </>
  );
}
