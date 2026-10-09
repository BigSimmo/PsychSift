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

import { WorkButton, WorkChip, WorkChips, WorkTag, useWorkUndoToast } from "@/components/mode-kit/work";
import {
  AssessHeader,
  AssessNote,
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
  CASE_COMPLEXITIES,
  EPAS,
  GLOSSARY,
  SUPERVISION_LEVELS,
  epa as epaInfo,
  type CaseComplexity,
  type EpaNumber,
  type SupervisionLevel,
} from "@/lib/teaching/assessments/content";
import {
  EPA_REPLY_MAX,
  assessorName,
  epa1ThisTerm,
  epaOpenForDoctor,
  epaRequestWords,
  epaWithAssessor,
  GUEST_KINDS,
  looksLikePatientDetails,
  pendingEpaRequest,
  validReply,
  type EpaRequest,
  type GuestKind,
} from "@/lib/teaching/assessments/model";
import { SAMPLE_DOCTOR, SAMPLE_REGISTRAR, SAMPLE_SUPERVISOR } from "@/lib/teaching/assessments/sample";

const SUP = SAMPLE_SUPERVISOR.short;

export type SheetState =
  | null
  | { kind: "epa"; pick: EpaNumber }
  | { kind: "supepa"; index: number }
  | { kind: "recordepa"; pick?: EpaNumber }
  | { kind: "myepa"; index: number }
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

export const LEVEL_OPTIONS = SUPERVISION_LEVELS.map((l) => ({
  id: l.id,
  title: l.formLabel,
  detail: l.detail,
}));

/** CLA has no decline or send back button, so both sides are told how it really works there. */
export const IN_CLA_NOTE = "CLA has no send back button. In CLA, tell the doctor, and they cancel the request.";

function RequestEpaSheet({
  s,
  dispatch,
  pick,
  close,
}: Pick<ScreenProps, "s" | "dispatch"> & { pick: EpaNumber; close: () => void }) {
  const [epa, setEpa] = useState<EpaNumber>(pick);
  const [who, setWho] = useState<"sup" | "reg" | "guest">("sup");
  const [guest, setGuest] = useState<GuestKind | null>(null);
  const dup = pendingEpaRequest(s, epa);
  const why = who === "guest" && !guest ? "Choose their role first." : null;
  return (
    <div className="grid gap-3">
      <OptionCard
        legend="EPA"
        name="assess-request-epa"
        value={String(epa)}
        onChange={(id) => setEpa(Number(id) as EpaNumber)}
        options={EPAS.map((e) => ({
          id: String(e.id),
          title: `EPA ${e.id} · ${e.formal}`,
          detail: e.detail,
          tag: e.id === 1 && !epa1ThisTerm(s) ? <WorkTag tone="amber">Needed this term</WorkTag> : undefined,
        }))}
      />
      <OptionCard
        legend="Who assesses it"
        name="assess-request-who"
        value={who}
        onChange={setWho}
        options={[
          {
            id: "sup",
            title: `${SAMPLE_SUPERVISOR.name}, term supervisor`,
            detail: "Counts as this term's specialist EPA",
          },
          { id: "reg", title: `${SAMPLE_REGISTRAR.name}, registrar` },
          {
            id: "guest",
            title: "Someone else",
            detail: "Another specialist, a nurse or a pharmacist who has done EPA assessor training",
          },
        ]}
      />
      {who === "guest" ? (
        <>
          <WorkChips label="Their role">
            {GUEST_KINDS.map((k) => (
              <WorkChip key={k.id} selected={guest === k.id} onClick={() => setGuest(k.id)}>
                {k.title}
              </WorkChip>
            ))}
          </WorkChips>
          <AssessNote>
            They get an emailed link and need no CLA account. Their EPA shows as Unapproved until your MEU approves
            them.
          </AssessNote>
        </>
      ) : (
        <AssessNote>
          At least one EPA a term should be from your primary clinical supervisor or another specialist. Registrars,
          nurses and pharmacists can assess the rest once they have done EPA assessor training.
        </AssessNote>
      )}
      <WorkButton
        icon={Send}
        size="wide"
        disabled={!!dup || !!why}
        onClick={() => {
          if (who === "guest") {
            if (!guest) return;
            dispatch({ type: "request-epa", epa, who, guest });
          } else dispatch({ type: "request-epa", epa, who });
          close();
        }}
      >
        Send request
      </WorkButton>
      {dup ? (
        <WhyNot id="assess-epa-dup">
          You&apos;ve already asked for EPA {epa}. It&apos;s waiting for {dup.who === "sup" ? SUP : assessorName(dup)}.
        </WhyNot>
      ) : why ? (
        <WhyNot id="assess-epa-guest-why">{why}</WhyNot>
      ) : null}
    </div>
  );
}

/** The supervisor's EPA: from the doctor's request (index), or straight from the dock (no index). */
function RecordEpaSheet({
  s,
  dispatch,
  saveEpa,
  index,
  pick,
  close,
}: Pick<ScreenProps, "s" | "dispatch" | "saveEpa"> & { index?: number; pick?: EpaNumber; close: () => void }) {
  const request = index === undefined ? null : s.epaRequests[index];
  const [chosen, setChosen] = useState<EpaNumber | null>(pick ?? null);
  const [level, setLevel] = useState<SupervisionLevel | null>(null);
  const [complexity, setComplexity] = useState<CaseComplexity | null>(null);
  const [note, setNote] = useState("");
  const [answer, setAnswer] = useState<"not-yet" | "sent-back" | null>(null);
  if (index !== undefined && (!request || !epaWithAssessor(request)))
    return (
      <AssessNote center>
        {request?.status === "cancelled"
          ? `${SAMPLE_DOCTOR.first} cancelled this request.`
          : request?.status === "sent-back"
            ? `You sent this back to ${SAMPLE_DOCTOR.first}.`
            : "This request has already been recorded."}
      </AssessNote>
    );
  if (index !== undefined && request && answer)
    return (
      <AnswerEpaRequest
        index={index}
        request={request}
        kind={answer}
        dispatch={dispatch}
        onDone={close}
        onCancel={() => setAnswer(null)}
      />
    );
  const epa = request ? request.epa : chosen;
  const info = epa ? epaInfo(epa) : null;
  const why = !epa
    ? "Choose which EPA first."
    : !level
      ? "Choose a supervision level first."
      : looksLikePatientDetails(note)
        ? "Take out the patient details first."
        : null;
  return (
    <div className="grid gap-3">
      {request ? (
        <AssessNote icon={MessageSquare}>
          {request.status === "not-yet"
            ? `You said you can't assess this yet. ${info!.formal}: ${info!.detail}`
            : `${SAMPLE_DOCTOR.first} asked for this. ${info!.formal}: ${info!.detail}`}
        </AssessNote>
      ) : (
        <>
          <WorkChips label="Which EPA">
            {EPAS.map((e) => (
              <WorkChip key={e.id} selected={chosen === e.id} onClick={() => setChosen(e.id)}>
                {`EPA ${e.id}`}
              </WorkChip>
            ))}
          </WorkChips>
          {info ? <AssessNote>{`${info.formal}: ${info.detail}`}</AssessNote> : null}
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
          const extra = { ...(complexity ? { complexity } : {}), note: trimmed };
          if (index !== undefined) saveEpa({ type: "record-epa", index, level, ...extra });
          else saveEpa({ type: "record-epa-direct", epa, level, ...extra });
          close();
        }}
      >
        {epa ? `Save EPA ${epa}` : "Save EPA"}
      </WorkButton>
      {why ? <WhyNot id="assess-save-epa-why">{why}</WhyNot> : null}
      {index !== undefined ? (
        <WorkButton variant="tinted" size="wide" href={viewHref("epaform", { i: String(index) })}>
          Open the full EPA form
        </WorkButton>
      ) : null}
      {request ? (
        <div className="grid gap-2 pt-1" data-testid="assess-epa-cant">
          <p className="work-label m-0">{`Can't do it?`}</p>
          <div className="grid grid-cols-2 gap-2">
            {request.status === "requested" ? (
              <WorkButton variant="secondary" onClick={() => setAnswer("not-yet")}>
                {`Can't assess yet`}
              </WorkButton>
            ) : null}
            <WorkButton variant="secondary" onClick={() => setAnswer("sent-back")}>
              Send back
            </WorkButton>
          </div>
          <AssessNote>{IN_CLA_NOTE}</AssessNote>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The assessor's other two answers. "Can't assess yet" keeps the request with them (a note is optional).
 * "Send back" returns it to the doctor and needs a short note, so the doctor knows whom to ask instead.
 */
export function AnswerEpaRequest({
  index,
  request,
  kind,
  dispatch,
  onDone,
  onCancel,
}: Pick<ScreenProps, "dispatch"> & {
  index: number;
  /** The request as it is now, so Undo can put it back exactly. */
  request: EpaRequest;
  kind: "not-yet" | "sent-back";
  onDone: () => void;
  onCancel: () => void;
}) {
  const [reply, setReply] = useState("");
  const toast = useWorkUndoToast();
  const [done, setDone] = useState<string | null>(null);
  const back = kind === "sent-back";
  const trimmed = reply.trim();
  const why =
    back && !trimmed
      ? `Say why, so ${SAMPLE_DOCTOR.first} knows whom to ask.`
      : trimmed.length > EPA_REPLY_MAX
        ? `Keep it under ${EPA_REPLY_MAX} characters.`
        : looksLikePatientDetails(trimmed)
          ? "Take out the patient details first."
          : null;
  if (done) return <AssessNote center>{done}</AssessNote>;
  return (
    <div className="grid gap-3">
      <AssessNote icon={MessageSquare}>
        {back
          ? `${SAMPLE_DOCTOR.first} gets it back with your note and can ask someone else.`
          : `It stays in your list. ${SAMPLE_DOCTOR.first} sees that you can't assess it yet.`}
      </AssessNote>
      <AssessTextField
        id={`assess-epa-${kind}`}
        label={back ? `Why, for ${SAMPLE_DOCTOR.first}` : `What you still need to see (optional)`}
        value={reply}
        onChange={setReply}
        required={back}
        placeholder={
          back ? "I wasn't on the ward that day. Ask the night registrar." : "I'd like to see a full admission."
        }
        single
      />
      <WorkButton
        size="wide"
        disabled={!!why || !validReply(trimmed, back)}
        onClick={() => {
          const message = back
            ? `Sent back to ${SAMPLE_DOCTOR.name}`
            : `${SAMPLE_DOCTOR.first} told you can't assess it yet`;
          dispatch(
            back
              ? { type: "epa-send-back", index, reply: trimmed }
              : { type: "epa-not-yet", index, ...(trimmed ? { reply: trimmed } : {}) },
          );
          const undo = () => dispatch({ type: "undo-epa-answer", index, previous: request });
          if (toast) {
            toast(message, undo, 10000);
            onDone();
          } else setDone(`${message}.`);
        }}
      >
        {back ? `Send back to ${SAMPLE_DOCTOR.first}` : `Tell ${SAMPLE_DOCTOR.first}`}
      </WorkButton>
      {why ? <WhyNot id={`assess-epa-${kind}-why`}>{why}</WhyNot> : null}
      <WorkButton variant="secondary" size="wide" onClick={onCancel}>
        Back to recording
      </WorkButton>
    </div>
  );
}

/** The doctor's own open request: cancel it while it is with the assessor, or ask again once sent back. */
function MyEpaSheet({
  s,
  dispatch,
  openSheet,
  index,
  close,
}: Pick<ScreenProps, "s" | "dispatch" | "openSheet"> & { index: number; close: () => void }) {
  const toast = useWorkUndoToast();
  const [done, setDone] = useState<string | null>(null);
  const r = s.epaRequests[index];
  if (done) return <AssessNote center>{done}</AssessNote>;
  if (!r || !epaOpenForDoctor(r))
    return (
      <AssessNote center>
        {r?.status === "done" ? "This EPA has been recorded." : "This request is no longer open."}
      </AssessNote>
    );
  const info = epaInfo(r.epa);
  const name = assessorName(r);
  const cancel = () => {
    dispatch({ type: "cancel-epa-request", index });
    // Undo puts it back exactly as it was, including any note from the assessor.
    const undo = () => dispatch({ type: "restore-epa-request", index, request: r });
    const message = r.status === "sent-back" ? `EPA ${r.epa} request removed` : `EPA ${r.epa} request cancelled`;
    if (toast) {
      toast(message, undo, 10000);
      close();
    } else setDone(`${message}.`);
  };
  return (
    <div className="grid gap-3">
      <AssessNote icon={MessageSquare}>{`${info.formal}: ${info.detail}`}</AssessNote>
      <ul role="list" className="work-card work-rows m-0 list-none p-0">
        <StepRow
          state={r.status === "sent-back" ? "now" : "lock"}
          title={
            r.status === "sent-back"
              ? `Sent back by ${name}`
              : r.status === "not-yet"
                ? `${name.charAt(0).toUpperCase()}${name.slice(1)} can't assess it yet`
                : `Waiting for ${name}`
          }
          detail={r.reply ? `"${r.reply}"` : r.status === "requested" ? "Needed by Sun 8 Nov" : undefined}
          tag={
            epaRequestWords(r).tag ? (
              <WorkTag tone={r.status === "sent-back" ? "amber" : "neutral"}>{epaRequestWords(r).tag}</WorkTag>
            ) : undefined
          }
        />
      </ul>
      {r.status === "sent-back" ? (
        <WorkButton icon={Send} size="wide" onClick={() => openSheet({ kind: "epa", pick: r.epa })}>
          Ask someone else
        </WorkButton>
      ) : (
        <WorkButton variant="tinted" size="wide" href={viewHref("epaform", { i: String(index) })}>
          See what they get
        </WorkButton>
      )}
      <WorkButton variant="secondary" size="wide" onClick={cancel}>
        {r.status === "sent-back" ? "Remove from my list" : "Cancel request"}
      </WorkButton>
      <AssessNote>
        {r.status === "sent-back"
          ? IN_CLA_NOTE
          : "In CLA, cancelling is deleting the emailed form, from its three-dot menu."}
      </AssessNote>
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
  openSheet,
}: Pick<ScreenProps, "s" | "dispatch" | "saveEpa" | "openSheet"> & { sheet: SheetState; close: () => void }) {
  const title =
    sheet?.kind === "epa"
      ? "Request an EPA"
      : sheet?.kind === "supepa"
        ? `EPA ${s.epaRequests[sheet.index]?.epa ?? ""} · ${SAMPLE_DOCTOR.name}`
        : sheet?.kind === "myepa"
          ? `Your EPA ${s.epaRequests[sheet.index]?.epa ?? ""} request`
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
          <RecordEpaSheet
            key={`r${sheet.index}`}
            s={s}
            dispatch={dispatch}
            saveEpa={saveEpa}
            index={sheet.index}
            close={close}
          />
        ) : null}
        {sheet?.kind === "recordepa" ? (
          <RecordEpaSheet
            key={`d${sheet.pick ?? 0}`}
            s={s}
            dispatch={dispatch}
            saveEpa={saveEpa}
            pick={sheet.pick}
            close={close}
          />
        ) : null}
        {sheet?.kind === "myepa" ? (
          <MyEpaSheet
            key={`m${sheet.index}`}
            s={s}
            dispatch={dispatch}
            openSheet={openSheet}
            index={sheet.index}
            close={close}
          />
        ) : null}
        {sheet?.kind === "disagree" ? <DisagreeSheet s={s} dispatch={dispatch} /> : null}
        {sheet?.kind === "words" ? <WordsSheet /> : null}
      </div>
    </Sheet>
  );
}
