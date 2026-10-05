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
  Users,
} from "lucide-react";
import { useState } from "react";

import {
  Inset,
  List,
  NoteField,
  Pill,
  Row,
  ScreenHeader,
  SectionLabel,
  SectionNote,
  SmallPrint,
  StepRow,
  WhyNot,
  labelText,
  secondaryText,
  viewHref,
} from "@/components/teaching/assessments/assessments-parts";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import {
  EPAS,
  GLOSSARY,
  SUPERVISION_LEVELS,
  epa as epaInfo,
  type EpaNumber,
  type SupervisionLevel,
} from "@/lib/teaching/assessments/content";
import { epa1ThisTerm, pendingEpaRequest } from "@/lib/teaching/assessments/model";
import { SAMPLE_DOCTOR, SAMPLE_REGISTRAR, SAMPLE_SUPERVISOR } from "@/lib/teaching/assessments/sample";

const SUP = SAMPLE_SUPERVISOR.short;

export type SheetState =
  | null
  | { kind: "epa"; pick: EpaNumber }
  | { kind: "supepa"; index: number }
  | { kind: "disagree" }
  | { kind: "words" };

function PhoneNumber({ children }: { children: string }) {
  return (
    <span className="rounded-md border border-[color:var(--border)] px-2 py-0.5 text-xs font-semibold text-[color:var(--text-heading)] tabular-nums">
      {children}
    </span>
  );
}

export function ConcernsHelp({ openSheet }: ScreenProps) {
  return (
    <>
      <ScreenHeader
        back={viewHref("home")}
        backLabel="Assessments"
        title="Concerns and help"
        subtitle="Not shared with your supervisor"
      />
      <Inset tone="warm" icon={Phone} title="In danger now? Call 000.">
        For urgent support, Lifeline is on 13 11 14, 24 hours.
      </Inset>
      <p className={cn(secondaryText, "px-1")}>
        Opening this page isn&apos;t shared with anyone. PsychSift doesn&apos;t receive or pass on complaints; these are
        the usual routes in WA.
      </p>
      <SectionLabel>About an assessment</SectionLabel>
      <List>
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
      <List>
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
      <SectionLabel end={<SectionNote>Confidential</SectionNote>}>Your wellbeing</SectionLabel>
      <List>
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
      <p className={cn(secondaryText, "px-1")}>
        Write down dates, places and what was said while it&apos;s fresh, somewhere you control, such as your personal
        email. PsychSift doesn&apos;t keep a private record for this.
      </p>
      <SmallPrint center>Phone numbers to be checked against PMCWA and WA Health before release.</SmallPrint>
    </>
  );
}

function OptionList<T extends string | number>({
  legend,
  name,
  value,
  onChange,
  options,
}: {
  legend: string;
  name: string;
  value: T | null;
  onChange: (value: T) => void;
  options: readonly { id: T; title: string; detail: string; tag?: React.ReactNode }[];
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className={cn(labelText, "mb-2 px-1")}>{legend}</legend>
      {options.map((o) => {
        const checked = value === o.id;
        return (
          <label
            key={o.id}
            data-mode-identity="teaching"
            className={cn(
              "grid cursor-pointer gap-0.5 rounded-xl border px-3 py-2.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[color:var(--focus)] forced-colors:border",
              checked
                ? "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity-soft)]"
                : "border-[color:var(--border)] bg-[color:var(--surface-raised)]",
            )}
          >
            <input type="radio" name={name} checked={checked} onChange={() => onChange(o.id)} className="sr-only" />
            <b className="text-sm font-semibold text-[color:var(--text-heading)]">{o.title}</b>
            <span className={secondaryText}>{o.detail}</span>
            {o.tag ? <span className="mt-1">{o.tag}</span> : null}
          </label>
        );
      })}
    </fieldset>
  );
}

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
      <OptionList
        legend="EPA"
        name="assess-request-epa"
        value={epa}
        onChange={setEpa}
        options={EPAS.map((e) => ({
          id: e.id,
          title: `EPA ${e.id} · ${e.title}`,
          detail: e.detail,
          tag: e.id === 1 && !epa1ThisTerm(s) ? <Pill pill={{ label: "Needed this term", tone: "warm" }} /> : undefined,
        }))}
      />
      <SegmentedControl
        label="Assessor"
        layout="equal"
        value={who}
        onChange={setWho}
        options={[
          { value: "sup", label: SUP },
          { value: "reg", label: `${SAMPLE_REGISTRAR.name}, registrar` },
        ]}
      />
      <SmallPrint>At least one EPA a term must be from your term supervisor or another specialist.</SmallPrint>
      <Button
        variant="primary"
        block
        disabled={!!dup}
        aria-describedby={dup ? "assess-epa-dup" : undefined}
        onClick={() => {
          dispatch({ type: "request-epa", epa, who });
          close();
        }}
      >
        <Send aria-hidden="true" className="size-icon-sm" />
        Send request
      </Button>
      {dup ? (
        <WhyNot id="assess-epa-dup">
          You&apos;ve already asked for EPA {epa}. It&apos;s waiting for{" "}
          {dup.who === "sup" ? SUP : SAMPLE_REGISTRAR.name}.
        </WhyNot>
      ) : null}
    </div>
  );
}

function RecordEpaSheet({
  s,
  dispatch,
  index,
  close,
}: Pick<ScreenProps, "s" | "dispatch"> & { index: number; close: () => void }) {
  const [level, setLevel] = useState<SupervisionLevel | null>(null);
  const r = s.epaRequests[index];
  if (!r) return <p className={secondaryText}>This request has already been recorded.</p>;
  const info = epaInfo(r.epa);
  return (
    <div className="grid gap-3">
      <p className={secondaryText}>
        {info.title}: {info.detail}
      </p>
      <OptionList
        legend={`Level of supervision ${SAMPLE_DOCTOR.first} needed`}
        name="assess-epa-level"
        value={level}
        onChange={setLevel}
        options={SUPERVISION_LEVELS.map((l) => ({ id: l.id, title: l.title, detail: l.detail }))}
      />
      <SmallPrint>Direct supervision is recorded as feedback for that moment. It is not a fail on its own.</SmallPrint>
      <Button
        variant="primary"
        block
        disabled={!level}
        onClick={() => {
          if (level) dispatch({ type: "record-epa", index, level });
          close();
        }}
      >
        Save EPA
      </Button>
    </div>
  );
}

function DisagreeSheet({ s, dispatch }: Pick<ScreenProps, "s" | "dispatch">) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className="grid gap-3">
      <ul role="list" className="grid">
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
      <NoteField
        id="assess-disagree-draft"
        label="Draft (kept on this page, visible only to you)"
        value={s.disagreeDraft}
        onChange={(value) => dispatch({ type: "set-disagree-draft", value })}
        placeholder="I'd like to respond to my end-of-term report for Psychiatry. No patient details."
      />
      <Button
        variant="primary"
        block
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(s.disagreeDraft);
            setCopied("Copied. Paste it into an email to your DCT.");
          } catch {
            setCopied("Couldn't copy here. Select the text and copy it yourself.");
          }
        }}
      >
        <Copy aria-hidden="true" className="size-icon-sm" />
        Copy the draft to email your DCT
      </Button>
      {copied ? (
        <p role="status" className="px-1 text-center text-xs text-[color:var(--text-muted)]">
          {copied}
        </p>
      ) : null}
    </div>
  );
}

function WordsSheet() {
  return (
    <dl className="grid">
      {GLOSSARY.map(([term, meaning]) => (
        <div key={term} className="grid gap-0.5 border-t border-[color:var(--border)] py-2.5 first:border-t-0">
          <dt className="text-sm font-bold text-[color:var(--text-heading)]">{term}</dt>
          <dd className={secondaryText}>{meaning}</dd>
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
}: Pick<ScreenProps, "s" | "dispatch"> & { sheet: SheetState; close: () => void }) {
  const title =
    sheet?.kind === "epa"
      ? "Request an EPA"
      : sheet?.kind === "supepa"
        ? `EPA ${s.epaRequests[sheet.index]?.epa ?? ""} · ${SAMPLE_DOCTOR.first}`
        : sheet?.kind === "disagree"
          ? "Disagree with a report"
          : "Words used here";
  return (
    <Sheet open={sheet !== null} onClose={close} title={title}>
      {sheet?.kind === "epa" ? (
        <RequestEpaSheet key={sheet.pick} s={s} dispatch={dispatch} pick={sheet.pick} close={close} />
      ) : null}
      {sheet?.kind === "supepa" ? (
        <RecordEpaSheet key={sheet.index} s={s} dispatch={dispatch} index={sheet.index} close={close} />
      ) : null}
      {sheet?.kind === "disagree" ? <DisagreeSheet s={s} dispatch={dispatch} /> : null}
      {sheet?.kind === "words" ? <WordsSheet /> : null}
    </Sheet>
  );
}
