"use client";

import { BookOpen, Check, Clock, FileText, Plus, Target, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";

import { WorkButton, WorkChip, WorkChips, WorkDock, WorkEmpty, WorkTag } from "@/components/mode-kit/work";
import {
  AssessCallout,
  AssessHeader,
  AssessMeter,
  AssessNote,
  KindsStrip,
  type KindState,
} from "@/components/teaching/assessments/assess-kit";
import {
  Eyebrow,
  KeyValue,
  List,
  Panel,
  Pill,
  Row,
  ScreenHeader,
  SectionLabel,
  SectionNote,
  SmallPrint,
  StepRow,
  TextLink,
  viewHref,
} from "@/components/teaching/assessments/assessments-parts";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { Pgy2Rules, RuleLine, YearEnd } from "@/components/teaching/assessments/assessments-year-end";
import {
  EPAS,
  MEU_HOW_TO_REACH,
  caseComplexityName,
  epa as epaInfo,
  supervisionLevelName,
} from "@/lib/teaching/assessments/content";
import { samSignOff, type DctSignature, type DctState } from "@/lib/teaching/assessments/dct";
import {
  YEAR_WEEKS,
  endOfTermLine,
  endOfTermPill,
  epa1ThisTerm,
  epaCounts,
  epaNeedMore,
  epaRecords,
  epaRequestWords,
  epasInTerm,
  fromSpecialist,
  openEpaRequests,
  weeksDone,
  UNAPPROVED_WORDS,
  type AssessmentsState,
  type EpaRequest,
} from "@/lib/teaching/assessments/model";
import {
  SAMPLE_DOCTOR,
  SAMPLE_LEAVE,
  SAMPLE_SUPERVISOR,
  SAMPLE_TERMS,
  delegatedEndOfTermLine,
  kindName,
  registrarMidTermLine,
  sampleTerm,
  termKindsLabel,
  termNumbers,
  termsWithKind,
  type EpaRecord,
  type SampleTerm,
} from "@/lib/teaching/assessments/sample";
import {
  ABSENCE_RULE,
  KINDS_PER_TERM_RULE,
  PGY1_SERVICE_TERM_RULE,
  PGY1_TERM_LINES,
  YEAR_LENGTH_RULE,
} from "@/lib/teaching/assessments/year-rules";
import { withUnit } from "@/components/teaching/teaching-number";

/**
 * Green only once the DCT has signed off the term's form. The row's own line says "DCT sign-off done", so the tag
 * stays one short word and never squeezes the row's words into a sliver at 320 px.
 */
const SIGNED_PILL = <Pill pill={{ label: "Satisfactory", tone: "ok" }} />;
/** Term 4 once the DCT signs it off in the story. The rating itself is on the form, so the tag says only that. */
const SIGNED_OFF_PILL = <Pill pill={{ label: "Signed off", tone: "ok" }} />;

/**
 * The DCT's sign-off on Sam's term 4 form, once given. Only while Sam's own signature stands, so a remembered
 * sign-off never outlives a reset story.
 */
function termFourSignOff(s: AssessmentsState, dct: DctState): DctSignature | null {
  return s.sigs.doc ? samSignOff(dct) : null;
}

const signedOffLine = (signOff: DctSignature) => `DCT sign-off done ${signOff.date}`;

function Requirement({
  title,
  value,
  percent,
  ok,
  note,
}: {
  title: string;
  value: string;
  percent: number;
  ok?: boolean;
  note?: string;
}) {
  return (
    <li className="grid gap-1.5 px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <b className="text-sm font-semibold text-[color:var(--text-heading)]">{title}</b>
        {ok ? <WorkTag tone="neutral">On track</WorkTag> : null}
      </div>
      <span className="text-sm text-[color:var(--text-muted)]">{value}</span>
      <AssessMeter fraction={Math.max(0, Math.min(100, percent)) / 100} />
      {note ? <p className="m-0 text-xs text-[color:var(--text-muted)]">{note}</p> : null}
    </li>
  );
}

/** Kinds of experience A to D from the sample terms: done once the DCT signs off the term, now for this term. */
function kindsFor(s: AssessmentsState, signOff: DctSignature | null) {
  return (["A", "B", "C", "D"] as const).map((letter) => {
    const done = termsWithKind(letter, "done");
    const now = termsWithKind(letter, "current")[0];
    const state: KindState = done.length || (now && signOff) ? "done" : now ? "now" : "todo";
    const nowNote = signOff
      ? `Term 4 · ${signedOffLine(signOff)}`
      : s.sigs.doc
        ? "Term 4 · DCT sign-off next"
        : "Now, term 4";
    return {
      letter,
      name: kindName(letter),
      state,
      note: done.length ? termNumbers(done) : now ? nowNote : "Not yet",
    };
  });
}

export function YearRequirements({ s, openSheet, dct, tab }: ScreenProps & { tab?: boolean }) {
  const signOff = termFourSignOff(s, dct);
  const signedTerms = signOff ? 4 : 3;
  const w = weeksDone(s);
  const total = epaRecords(s).length;
  const more = epaNeedMore(s);
  const by = epaCounts(s);
  const thisTerm = epasInTerm(s, "t4");
  const specialistEpa = thisTerm.find(fromSpecialist);
  return (
    <>
      <AssessHeader
        eyebrow={`${SAMPLE_DOCTOR.grade} · 2026`}
        title={tab ? "Progress" : "Year requirements"}
        back={tab ? undefined : { href: viewHref("home"), label: "Assessments" }}
      />
      <div className="work-card work-card--pad grid gap-2">
        <div className="work-label">
          <span>Weeks of term time</span>
          <em className="work-label__count">{`${YEAR_WEEKS - w} to go`}</em>
        </div>
        <div className="assess-stat">
          <b>
            {w} <small>{`of ${withUnit(YEAR_WEEKS, "weeks")}`}</small>
          </b>
        </div>
        <AssessMeter fraction={w / YEAR_WEEKS} />
        <p className="m-0 text-sm text-[color:var(--text-muted)]">
          {`${YEAR_LENGTH_RULE} Your year runs 2 Feb 2026 to 31 Jan 2027.`}
        </p>
      </div>
      {epa1ThisTerm(s) ? null : (
        <AssessCallout
          icon={TriangleAlert}
          tone="amber"
          title="EPA 1 needed this term"
          action={
            <WorkButton variant="secondary" onClick={() => openSheet({ kind: "epa", pick: 1 })}>
              Request
            </WorkButton>
          }
        >
          By Sun 8 Nov. Needed every term.
        </AssessCallout>
      )}

      <SectionLabel end={<SectionNote>PGY1 needs all four</SectionNote>}>Kinds of experience</SectionLabel>
      <KindsStrip kinds={kindsFor(s, signOff)} />
      {/* [3C p.58-59]: the panel judges completion across the year. The DCT signs off each end-of-term form [TAF]. */}
      <AssessNote>
        {`${KINDS_PER_TERM_RULE} The DCT signs off each end-of-term form, and the panel judges completion across the year.`}
      </AssessNote>

      <SectionLabel>Terms and spread</SectionLabel>
      <List>
        <Requirement
          title="Terms with DCT sign-off"
          value={`${withUnit(signedTerms, "of")} at least 4`}
          percent={(signedTerms / 4) * 100}
          ok={!!signOff}
          note={
            signOff
              ? `Term 4: ${signedOffLine(signOff)}.`
              : s.sigs.doc
                ? "Term 4 is signed by you both. DCT sign-off is next."
                : "Term 4 is next, once you both sign and the DCT signs off."
          }
        />
        <Requirement title="Largest specialty" value="Medicine 42% planned · limit 50%" percent={84} ok />
        <Requirement
          title="Largest subspecialty"
          value="Geriatric Medicine 23% planned · limit 25%"
          percent={92}
          note="Close to the limit. Check with your MEU before swapping into another geriatric term."
        />
        <Requirement
          title="Service terms (relief, nights)"
          value="None · limit 20%"
          percent={0}
          ok
          note={PGY1_SERVICE_TERM_RULE}
        />
        <Requirement
          title="Sick, personal and carer's leave"
          value={`${SAMPLE_LEAVE.used} of ${SAMPLE_LEAVE.limit} working days`}
          percent={(SAMPLE_LEAVE.used / SAMPLE_LEAVE.limit) * 100}
          note={ABSENCE_RULE}
        />
        {PGY1_TERM_LINES.map((line) => (
          <RuleLine key={line}>{line}</RuleLine>
        ))}
      </List>

      <SectionLabel end={<TextLink onClick={() => openSheet({ kind: "epa", pick: 1 })}>Request one</TextLink>}>
        EPAs
      </SectionLabel>
      <List>
        <Requirement
          title="This year"
          value={`${total} recorded here · at least ${more} more needed`}
          percent={(total / (total + more)) * 100}
          note="At least 10 a year and at least 2 in every term, with EPA 1 in every term and at least 2 of each other EPA. For your terms that means at least 11."
        />
        <Requirement
          title="This term"
          value={`${thisTerm.length} recorded here · at least 2 needed`}
          percent={thisTerm.length * 50}
          ok={thisTerm.length >= 2}
        />
        <Requirement
          title="From your primary clinical supervisor or an equivalent specialist this term"
          value={
            specialistEpa
              ? `Done: EPA ${specialistEpa.epa} with ${specialistEpa.by.replace("Dr Robin Wattle", SAMPLE_SUPERVISOR.short)}`
              : "None recorded here yet"
          }
          percent={specialistEpa ? 100 : 0}
          ok={!!specialistEpa}
        />
        <li className="grid gap-1.5 px-3.5 py-3">
          <b className="text-sm font-semibold text-[color:var(--text-heading)]">Each EPA</b>
          {EPAS.map((x) => {
            const n = by[x.id];
            const need = x.id === 1 ? !epa1ThisTerm(s) : n < 2;
            const note =
              x.id === 1 ? (need ? "needed this term" : "done this term") : need ? `${2 - n} more by Jan` : "met";
            return (
              <div key={x.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-[color:var(--text-muted)]">
                  EPA {x.id} · {x.short}
                </span>
                <b
                  className={
                    need && x.id === 1
                      ? "text-right font-normal text-[color:var(--warning-text)] tabular-nums"
                      : "text-right font-normal text-[color:var(--text-heading)] tabular-nums"
                  }
                >
                  {n} · {note}
                </b>
              </div>
            );
          })}
        </li>
      </List>
      <SmallPrint>
        In this example, counts are the made-up EPAs on this page. A &quot;direct supervision&quot; result is recorded
        as feedback for that moment. It is not a fail on its own.
      </SmallPrint>

      <SectionLabel>Term assessments</SectionLabel>
      <List>
        <Requirement title="Mid-term (terms over 5 weeks)" value="4 of 4 so far" percent={100} ok />
        <Requirement
          title="End-of-term"
          value={`${withUnit(signedTerms, "of")} 5 with DCT sign-off`}
          percent={(signedTerms / 5) * 100}
        />
      </List>
      <YearEnd grade={SAMPLE_DOCTOR.grade} />
      <Pgy2Rules />
      <SmallPrint>{MEU_HOW_TO_REACH}</SmallPrint>
      <SmallPrint center>AMC National Framework 2024 · Medical Board of Australia</SmallPrint>
      <WorkDock>
        <WorkButton icon={Plus} onClick={() => openSheet({ kind: "epa", pick: epa1ThisTerm(s) ? 2 : 1 })}>
          Request an EPA
        </WorkButton>
        <WorkButton variant="secondary" href={viewHref("all")}>
          All assessments
        </WorkButton>
      </WorkDock>
    </>
  );
}

function EpaRecordRow({ r }: { r: EpaRecord }) {
  return (
    <Row
      icon={Target}
      iconTone={r.level === "direct" ? "muted" : "ok"}
      title={`EPA ${r.epa} · ${epaInfo(r.epa).title}`}
      subtitle={`${supervisionLevelName(r.level)}${r.complexity ? ` · ${caseComplexityName(r.complexity)} complexity` : ""} · ${r.by} (${r.role})${r.unapproved ? `. ${UNAPPROVED_WORDS}.` : ""}`}
      tag={r.unapproved ? <WorkTag tone="amber">Unapproved</WorkTag> : undefined}
    />
  );
}

/** An EPA the doctor asked for that is still open: waiting, not yet, or sent back. Opens what they can do. */
function EpaRequestRow({ r, index, openSheet }: { r: EpaRequest; index: number } & Pick<ScreenProps, "openSheet">) {
  const words = epaRequestWords(r);
  return (
    <Row
      icon={Clock}
      iconTone={r.status === "sent-back" ? "amber" : "muted"}
      title={`EPA ${r.epa} · ${epaInfo(r.epa).title}`}
      subtitle={words.line}
      tag={words.tag ? <WorkTag tone={r.status === "sent-back" ? "amber" : "neutral"}>{words.tag}</WorkTag> : undefined}
      onClick={() => openSheet({ kind: "myepa", index })}
    />
  );
}

export function TermDetails({ s, params, openSheet, dct }: ScreenProps) {
  const t = sampleTerm(params.get("term"));
  const signOff = termFourSignOff(s, dct);
  const current = t.status === "current";
  const done = t.status === "done";
  const eps = epasInTerm(s, t.id);
  let steps: ReactNode;
  if (current)
    steps = (
      <>
        <StepRow
          state="ok"
          title="Beginning-of-term discussion"
          detail="Wed 2 Sep · goals: formulation on ward round, EPA 1, lithium monitoring"
          href={viewHref("botd", { term: t.id })}
        />
        <StepRow
          state="ok"
          title="Mid-term assessment"
          detail="Signed Fri 2 Oct"
          href={viewHref("report", { of: "mid" })}
        />
        <StepRow
          state={signOff ? "ok" : "now"}
          title="End-of-term assessment"
          detail={signOff ? signedOffLine(signOff) : endOfTermLine(s)}
          tag={signOff ? SIGNED_OFF_PILL : <Pill pill={endOfTermPill(s)} />}
          href={viewHref("hub")}
        />
      </>
    );
  else if (done)
    steps = (
      <>
        <StepRow
          state="ok"
          title="Beginning-of-term discussion"
          detail={`${t.botd ? `${t.botd.date} with` : "With"} ${t.supervisor}. Goals agreed.`}
          href={viewHref("botd", { term: t.id })}
        />
        <StepRow
          state="ok"
          title="Mid-term assessment"
          detail={[`Signed ${t.midSigned}.`, registrarMidTermLine(t)].filter(Boolean).join(" ")}
          href={viewHref("pdf", { of: "past", kind: "mid", term: t.id })}
        />
        <StepRow
          state="ok"
          title="End-of-term assessment"
          detail={[`Signed ${t.signed} · DCT sign-off done.`, delegatedEndOfTermLine(t)].filter(Boolean).join(" ")}
          tag={SIGNED_PILL}
          href={viewHref("pdf", { of: "past", kind: "eot", term: t.id })}
        />
      </>
    );
  else
    steps = (
      <>
        <StepRow
          state="lock"
          title="Beginning-of-term discussion"
          detail={`At the start of the term, with ${t.supervisor}`}
        />
        <StepRow state="lock" title="Mid-term assessment" detail="Around the middle of the term" />
        {/* Rules audit U4: the booking window is PsychSift's own example feature. CLA and the AMC set none. */}
        <StepRow
          state="lock"
          title="End-of-term assessment"
          detail="In this example, booking opens two weeks before the end. That's a PsychSift feature, not a CLA rule."
        />
      </>
    );
  return (
    <>
      <ScreenHeader back={viewHref("home")} backLabel="Assessments" title={`Term ${t.n}`} subtitle={t.name} />
      <Panel>
        <Eyebrow accent>{termKindsLabel(t)}</Eyebrow>
        <h2 className="text-xl font-semibold text-[color:var(--text-heading)]">{t.name}</h2>
        <KeyValue k="Dates" v={`${t.from} to ${t.to}`} />
        <KeyValue k="Length" v={`${t.weeks} weeks`} />
        <KeyValue k="Term supervisor" v={t.supervisor} />
      </Panel>
      <SectionLabel>Assessments</SectionLabel>
      <List>{steps}</List>
      {t.status !== "next" ? (
        <>
          <SectionLabel
            end={current ? <TextLink onClick={() => openSheet({ kind: "epa", pick: 1 })}>Request</TextLink> : undefined}
          >
            EPAs this term
          </SectionLabel>
          <List>
            {eps.map((r, i) => (
              <EpaRecordRow key={`${r.epa}-${i}`} r={r} />
            ))}
            {current
              ? openEpaRequests(s).map(({ r, index }) => (
                  <EpaRequestRow key={`req-${index}`} r={r} index={index} openSheet={openSheet} />
                ))
              : null}
          </List>
        </>
      ) : null}
      {current ? (
        <>
          <SectionLabel end={<SectionNote>Shared only if you choose</SectionNote>}>
            Evidence from your Logbook
          </SectionLabel>
          <List>
            <Row
              icon={BookOpen}
              title="3 teaching sessions"
              subtitle="Lithium monitoring, Mental Health Act basics, risk formulation"
            />
            <Row icon={BookOpen} title="1 course" subtitle="Aboriginal cultural learning, part 2" />
          </List>
        </>
      ) : null}
    </>
  );
}

/**
 * The beginning-of-term discussion, read-only (rules audit M12, site audit A6). AMC Section 3A: "a mandatory
 * discussion between the prevocational doctor and term supervisor", which sets the learning objectives and the
 * term's assessments, including any extra EPAs or activities. CLA calls its form the BOTD [CLA-GL]. The mid-term
 * is completed by the primary clinical supervisor, or by a registrar "with formal sign-off by the primary clinical
 * supervisor" (AMC Section 3A). The EPA minimums are AMC Section 3A, p.50.
 */
export function BeginningOfTerm({ params }: ScreenProps) {
  const t = sampleTerm(params.get("term"));
  const back = viewHref("term", { term: t.id });
  const midHref =
    t.status === "current"
      ? viewHref("report", { of: "mid" })
      : t.status === "done"
        ? viewHref("pdf", { of: "past", kind: "mid", term: t.id })
        : undefined;
  return (
    <>
      <ScreenHeader
        back={back}
        backLabel={`Term ${t.n}`}
        title="Beginning-of-term discussion"
        subtitle={`Term ${t.n} · ${t.name}`}
      />
      <Panel>
        <Eyebrow accent>{t.botd ? "Done" : "Not yet"}</Eyebrow>
        <p className="text-sm text-[color:var(--text-heading)]">
          A required discussion between you and your term supervisor at the start of the term. It sets your learning
          goals and the assessments for the term.
        </p>
        <KeyValue k="With" v={`${t.supervisor}, term supervisor`} />
        <KeyValue k="When" v={t.botd ? `${t.botd.date} (made-up)` : "At the start of the term"} />
      </Panel>
      {t.botd ? (
        <>
          <SectionLabel>Goals agreed</SectionLabel>
          <List label="Goals agreed">
            {t.botd.goals.map((goal) => (
              <RuleLine key={goal}>{goal}</RuleLine>
            ))}
          </List>
        </>
      ) : null}
      <SectionLabel>Assessments for the term</SectionLabel>
      <List label="Assessments for the term">
        <Row
          icon={FileText}
          title="Mid-term"
          subtitle={
            registrarMidTermLine(t) ??
            "By your primary clinical supervisor. A registrar can do it, with formal sign-off by your primary clinical supervisor."
          }
          href={midHref}
        />
        <Row
          icon={Target}
          title="EPAs"
          subtitle="At least 2 this term, with EPA 1. At least one from your primary clinical supervisor or an equivalent specialist."
        />
        <Row
          icon={FileText}
          title="End-of-term"
          subtitle={
            delegatedEndOfTermLine(t) ??
            `By ${t.supervisor}, your term supervisor, or a clinical supervisor they delegate it to.`
          }
        />
      </List>
      <SmallPrint>In CLA this is the BOTD form. Made-up goals about skills, never about patients.</SmallPrint>
    </>
  );
}

type Filter = "all" | "todo" | "eot" | "mid" | "epa";
type Item =
  | {
      term: SampleTerm;
      type: "eot" | "mid";
      title: string;
      detail: string;
      tag?: ReactNode;
      href: string;
      todo?: boolean;
    }
  | { term: SampleTerm; type: "epa"; record: EpaRecord; todo?: false }
  | { term: SampleTerm; type: "epa"; request: EpaRequest; index: number; todo: true };

function allItems(s: AssessmentsState, signOff: DctSignature | null): Item[] {
  const items: Item[] = [];
  for (const t of SAMPLE_TERMS.filter((x) => x.status === "done")) {
    items.push({
      term: t,
      type: "eot",
      title: "End-of-term",
      detail: [`Signed ${t.signed} · DCT sign-off done.`, delegatedEndOfTermLine(t)].filter(Boolean).join(" "),
      tag: SIGNED_PILL,
      href: viewHref("pdf", { of: "past", kind: "eot", term: t.id }),
    });
    items.push({
      term: t,
      type: "mid",
      title: "Mid-term",
      detail: registrarMidTermLine(t)
        ? `Signed ${t.midSigned}. ${registrarMidTermLine(t)}`
        : `Signed ${t.midSigned} · ${t.supervisor}`,
      href: viewHref("pdf", { of: "past", kind: "mid", term: t.id }),
    });
    for (const record of epasInTerm(s, t.id)) items.push({ term: t, type: "epa", record });
  }
  const t4 = sampleTerm("t4");
  items.push({
    term: t4,
    type: "eot",
    title: "End-of-term",
    detail: signOff ? signedOffLine(signOff) : endOfTermLine(s),
    tag: signOff ? SIGNED_OFF_PILL : <Pill pill={endOfTermPill(s)} />,
    href: viewHref("hub"),
    // In CLA the form stays open until the DCT signs it off, so it stays in To do until then.
    todo: !signOff,
  });
  items.push({
    term: t4,
    type: "mid",
    title: "Mid-term",
    detail: "Signed Fri 2 Oct · Dr Robin Wattle",
    href: viewHref("report", { of: "mid" }),
  });
  for (const record of epasInTerm(s, "t4")) items.push({ term: t4, type: "epa", record });
  for (const { r, index } of openEpaRequests(s)) items.push({ term: t4, type: "epa", request: r, index, todo: true });
  return items;
}

const FILTERS: readonly [Filter, string][] = [
  ["all", "All"],
  ["todo", "To do"],
  ["eot", "End-of-term"],
  ["mid", "Mid-term"],
  ["epa", "EPAs"],
];

export function AllAssessments({ s, openSheet, dct }: ScreenProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = allItems(s, termFourSignOff(s, dct)).filter(
    (i) => filter === "all" || (filter === "todo" ? i.todo : i.type === filter),
  );
  const terms = [...new Set(shown.map((i) => i.term))].sort((a, b) => b.n - a.n);
  return (
    <>
      <ScreenHeader
        back={viewHref("home")}
        backLabel="Assessments"
        title="All assessments"
        subtitle={`${SAMPLE_DOCTOR.grade} · 2026`}
      />
      <WorkChips label="Show" scroll>
        {FILTERS.map(([id, label]) => (
          <WorkChip key={id} selected={filter === id} onClick={() => setFilter(id)}>
            {label}
          </WorkChip>
        ))}
      </WorkChips>
      {terms.length ? (
        terms.map((t) => (
          <section key={t.id} className="grid gap-1" aria-label={`Term ${t.n} · ${t.name}`}>
            <SectionLabel
              end={<SectionNote>{`${t.from} to ${t.to}`}</SectionNote>}
            >{`Term ${t.n} · ${t.name}`}</SectionLabel>
            <List>
              {shown
                .filter((i) => i.term === t)
                .map((i, n) => {
                  if (i.type === "epa")
                    return "request" in i ? (
                      <EpaRequestRow key={`r${n}`} r={i.request} index={i.index} openSheet={openSheet} />
                    ) : (
                      <EpaRecordRow key={`e${n}`} r={i.record} />
                    );
                  return (
                    <Row
                      key={`${i.type}${n}`}
                      icon={FileText}
                      iconTone={i.todo ? "muted" : "ok"}
                      title={i.title}
                      subtitle={i.detail}
                      tag={i.tag}
                      href={i.href}
                    />
                  );
                })}
            </List>
          </section>
        ))
      ) : (
        <WorkEmpty
          icon={Check}
          title="Nothing to do"
          body="Every assessment so far is signed."
          action={
            <WorkButton variant="secondary" onClick={() => setFilter("all")}>
              Show all
            </WorkButton>
          }
        />
      )}
    </>
  );
}
