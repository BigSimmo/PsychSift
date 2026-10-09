"use client";

import {
  Clock,
  Copy,
  Flag,
  GraduationCap,
  Heart,
  MessageSquare,
  PenLine,
  Phone,
  Send,
  Shield,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useState } from "react";

import { WorkButton, WorkChip, WorkChips, WorkTag } from "@/components/mode-kit/work";
import {
  AssessHeader,
  AssessNote,
  AssessSegmented,
  AssessTextField,
  CallStrip,
  OptionCard,
} from "@/components/teaching/assessments/assess-kit";
import {
  List,
  Row,
  SectionLabel,
  SectionNote,
  StepRow,
  WhyNot,
  viewHref,
} from "@/components/teaching/assessments/assessments-parts";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { Sheet } from "@/components/ui/sheet";
import {
  EPAS,
  GLOSSARY,
  SUPERVISION_LEVELS,
  epa as epaInfo,
  type EpaNumber,
  type SupervisionLevel,
} from "@/lib/teaching/assessments/content";
import { epa1ThisTerm, looksLikePatientDetails, pendingEpaRequest } from "@/lib/teaching/assessments/model";
import { SAMPLE_DOCTOR, SAMPLE_REGISTRAR, SAMPLE_SUPERVISOR } from "@/lib/teaching/assessments/sample";

const SUP = SAMPLE_SUPERVISOR.short;

export type SheetState =
  | null
  | { kind: "epa"; pick: EpaNumber }
  | { kind: "supepa"; index: number }
  | { kind: "recordepa"; pick?: EpaNumber }
  | { kind: "disagree" }
  | { kind: "words" };

function PhoneNumber({ children }: { children: string }) {
  return <WorkTag tone="neutral">{children}</WorkTag>;
}

export function ConcernsHelp({ openSheet, role }: ScreenProps) {
  const sup = role === "supervisor";
  return (
    <>
      <AssessHeader
        eyebrow="PsychSift doesn't tell your supervisor"
        title="Concerns and help"
        back={
          sup
            ? { href: viewHref("home", { as: "supervisor" }), label: "To do" }
            : { href: viewHref("home"), label: "Assessments" }
        }
      />
      <CallStrip sub="Or Lifeline 13 11 14, 24 hours" />
      <AssessNote icon={ShieldCheck}>
        PsychSift doesn&apos;t tell anyone you opened this page. It doesn&apos;t receive or pass on complaints. These
        are the usual routes in WA.
      </AssessNote>
      <SectionLabel>About an assessment</SectionLabel>
      <List label="About an assessment">
        <Row
          icon={MessageSquare}
          title="Talk it through first"
          subtitle={`With ${SUP} or your Director of Clinical Training (DCT). Most things are sorted this way.`}
        />
        <Row
          icon={PenLine}
          title="Disagree with a report"
          subtitle="Respond in writing to the DCT within 14 days. Ask your MEU when the 14 days start."
          onClick={() => openSheet({ kind: "disagree" })}
        />
        <Row
          icon={Clock}
          title="More time or a different assessor"
          subtitle="Ask your Medical Education Unit (MEU). They manage due dates and forms."
        />
      </List>
      <SectionLabel>Bullying, harassment or unsafe work</SectionLabel>
      <List label="Bullying, harassment or unsafe work">
        <Row
          icon={Users}
          title="Your DCT or Director of Postgraduate Medical Education"
          subtitle="They can advise and act. Ask what can stay confidential before you share details."
        />
        <Row
          icon={Flag}
          title="Your hospital's reporting line"
          subtitle="The name and process differ by site. Your MEU can tell you. Not checked for each site."
        />
        <Row
          icon={Shield}
          title="AMA (WA)"
          subtitle="Industrial advice and representation, including bullying, unsafe hours and pay."
        />
        <Row
          icon={GraduationCap}
          title="PMCWA"
          subtitle="Oversees prevocational training in WA."
          tag={<PhoneNumber>(08) 9222 4010</PhoneNumber>}
        />
      </List>
      <SectionLabel end={<SectionNote>Usually confidential</SectionNote>}>Your wellbeing</SectionLabel>
      <List label="Your wellbeing">
        <Row
          icon={Heart}
          iconTone="ok"
          title="Doctors' Health Advisory Service WA"
          subtitle="24 hours, for any doctor or medical student."
          tag={<PhoneNumber>(08) 9321 3098</PhoneNumber>}
        />
        <Row
          icon={Users}
          iconTone="ok"
          title="Employee Assistance Program"
          subtitle="Free counselling through your employer."
        />
        <Row
          icon={Phone}
          iconTone="ok"
          title="Lifeline"
          subtitle="24 hours, if things feel urgent."
          tag={<PhoneNumber>13 11 14</PhoneNumber>}
        />
      </List>
      <SectionLabel>Keep your own notes</SectionLabel>
      <AssessNote icon={PenLine}>
        Write down dates, places and what was said while it&apos;s fresh, somewhere you control, such as your personal
        email. PsychSift doesn&apos;t keep a private record for this.
      </AssessNote>
      <AssessNote center>Phone numbers to be checked against PMCWA and WA Health before release.</AssessNote>
    </>
  );
}

const LEVEL_OPTIONS = SUPERVISION_LEVELS.map((l) => ({
  id: l.id,
  title: l.title.replace(" supervision", ""),
  detail: l.detail,
}));

function RequestEpaSheet({
  s,
  dispatch,
  pick,
  close,
}: Pick<ScreenProps, "s" | "dispatch"> & { pick: EpaNumber; close: () => void }) {
  const [epa, setEpa] = useState<EpaNumber>(pick);
  const [who, setWho] = useState<"sup" | "reg">("sup");
  const dup = pendingEpaRequest(s, epa);
  return (
    <div className="grid gap-3">
      <OptionCard
        legend="EPA"
        name="assess-request-epa"
        value={String(epa)}
        onChange={(id) => setEpa(Number(id) as EpaNumber)}
        options={EPAS.map((e) => ({
          id: String(e.id),
          title: `EPA ${e.id} · ${e.title}`,
          detail: e.detail,
          tag: e.id === 1 && !epa1ThisTerm(s) ? <WorkTag tone="amber">Needed this term</WorkTag> : undefined,
        }))}
      />
      <AssessSegmented
        label="Assessor"
        value={who}
        onChange={setWho}
        options={[
          { value: "sup", label: SUP },
          { value: "reg", label: `${SAMPLE_REGISTRAR.name}, registrar` },
        ]}
      />
      <AssessNote>
        At least one EPA a term should be from your primary clinical supervisor or another specialist.
      </AssessNote>
      <WorkButton
        icon={Send}
        size="wide"
        disabled={!!dup}
        onClick={() => {
          dispatch({ type: "request-epa", epa, who });
          close();
        }}
      >
        Send request
      </WorkButton>
      {dup ? (
        <WhyNot id="assess-epa-dup">
          You&apos;ve already asked for EPA {epa}. It&apos;s waiting for{" "}
          {dup.who === "sup" ? SUP : SAMPLE_REGISTRAR.name}.
        </WhyNot>
      ) : null}
    </div>
  );
}

/** The supervisor's EPA: from the doctor's request (index), or straight from the dock (no index). */
function RecordEpaSheet({
  s,
  saveEpa,
  index,
  pick,
  close,
}: Pick<ScreenProps, "s" | "saveEpa"> & { index?: number; pick?: EpaNumber; close: () => void }) {
  const request = index === undefined ? null : s.epaRequests[index];
  const [chosen, setChosen] = useState<EpaNumber | null>(pick ?? null);
  const [level, setLevel] = useState<SupervisionLevel | null>(null);
  const [note, setNote] = useState("");
  if (index !== undefined && (!request || request.status !== "requested"))
    return <AssessNote center>This request has already been recorded.</AssessNote>;
  const epa = request ? request.epa : chosen;
  const info = epa ? epaInfo(epa) : null;
  const why = !epa ? "Choose which EPA first." : !level ? "Choose a supervision level first." : null;
  return (
    <div className="grid gap-3">
      {request ? (
        <AssessNote
          icon={MessageSquare}
        >{`${SAMPLE_DOCTOR.first} asked for this. ${info!.title}: ${info!.detail}`}</AssessNote>
      ) : (
        <>
          <WorkChips label="Which EPA">
            {EPAS.map((e) => (
              <WorkChip key={e.id} selected={chosen === e.id} onClick={() => setChosen(e.id)}>
                {`EPA ${e.id}`}
              </WorkChip>
            ))}
          </WorkChips>
          {info ? <AssessNote>{`${info.title}: ${info.detail}`}</AssessNote> : null}
        </>
      )}
      <OptionCard
        legend={`Level of supervision ${SAMPLE_DOCTOR.first} needed`}
        name="assess-epa-level"
        value={level}
        onChange={setLevel}
        options={LEVEL_OPTIONS}
      />
      <AssessNote>Direct is feedback for that moment, not a fail.</AssessNote>
      <AssessTextField
        id="assess-epa-note"
        label="One thing to keep doing (optional)"
        value={note}
        onChange={setNote}
        single
      />
      <WorkButton
        size="wide"
        disabled={!!why}
        onClick={() => {
          if (!epa || !level) return;
          const trimmed = note.trim() || undefined;
          if (index !== undefined) saveEpa({ type: "record-epa", index, level, note: trimmed });
          else saveEpa({ type: "record-epa-direct", epa, level, note: trimmed });
          close();
        }}
      >
        {epa ? `Save EPA ${epa}` : "Save EPA"}
      </WorkButton>
      {why ? <WhyNot id="assess-save-epa-why">{why}</WhyNot> : null}
    </div>
  );
}

function DisagreeSheet({ s, dispatch }: Pick<ScreenProps, "s" | "dispatch">) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className="grid gap-3">
      <ul role="list" className="work-card work-rows m-0 list-none p-0">
        <StepRow
          state="now"
          title="Write to your DCT within 14 days"
          detail="Check with your MEU when the 14 days start. Signing says you've discussed the report, not that you agree."
        />
        <StepRow
          state="lock"
          title="Say which parts and why"
          detail="Stick to what you did and saw. Leave out patient details."
        />
        <StepRow state="lock" title="Keep a copy" detail="Ask your MEU how your response is kept with the form." />
      </ul>
      <AssessTextField
        id="assess-disagree-draft"
        label="Draft (kept on this page, visible only to you)"
        value={s.disagreeDraft}
        onChange={(value) => dispatch({ type: "set-disagree-draft", value })}
        placeholder="I'd like to respond to my end-of-term report for Psychiatry."
      />
      <WorkButton
        icon={Copy}
        size="wide"
        // Copied out to an email, so text the shared check flags stays here until it is taken out.
        disabled={!s.disagreeDraft.trim() || looksLikePatientDetails(s.disagreeDraft)}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(s.disagreeDraft);
            setCopied("Copied. Paste it into an email to your DCT.");
          } catch {
            setCopied("Couldn't copy here. Select the text and copy it yourself.");
          }
        }}
      >
        Copy the draft to email your DCT
      </WorkButton>
      <p role="status" className="assess-note" data-center="">
        {copied ? <span>{copied}</span> : null}
      </p>
    </div>
  );
}

function WordsSheet() {
  return (
    <dl className="work-card m-0">
      {GLOSSARY.map(([term, meaning]) => (
        <div key={term} className="assess-word" data-long={term.length > 8 ? "" : undefined}>
          <dt>{term}</dt>
          <dd>{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AssessmentsSheets({
  sheet,
  close,
  s,
  dispatch,
  saveEpa,
}: Pick<ScreenProps, "s" | "dispatch" | "saveEpa"> & { sheet: SheetState; close: () => void }) {
  const title =
    sheet?.kind === "epa"
      ? "Request an EPA"
      : sheet?.kind === "supepa"
        ? `EPA ${s.epaRequests[sheet.index]?.epa ?? ""} · ${SAMPLE_DOCTOR.name}`
        : sheet?.kind === "recordepa"
          ? `Record an EPA · ${SAMPLE_DOCTOR.name}`
          : sheet?.kind === "disagree"
            ? "Disagree with a report"
            : "Words used here";
  return (
    <Sheet open={sheet !== null} onClose={close} title={title}>
      {/* The sheet opens outside the page, so it names the Teaching colours again. */}
      <div data-mode-identity="teaching" data-work-frame="" className="contents">
        {sheet?.kind === "epa" ? (
          <RequestEpaSheet key={sheet.pick} s={s} dispatch={dispatch} pick={sheet.pick} close={close} />
        ) : null}
        {sheet?.kind === "supepa" ? (
          <RecordEpaSheet key={`r${sheet.index}`} s={s} saveEpa={saveEpa} index={sheet.index} close={close} />
        ) : null}
        {sheet?.kind === "recordepa" ? (
          <RecordEpaSheet key={`d${sheet.pick ?? 0}`} s={s} saveEpa={saveEpa} pick={sheet.pick} close={close} />
        ) : null}
        {sheet?.kind === "disagree" ? <DisagreeSheet s={s} dispatch={dispatch} /> : null}
        {sheet?.kind === "words" ? <WordsSheet /> : null}
      </div>
    </Sheet>
  );
}
