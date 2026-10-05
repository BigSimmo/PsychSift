"use client";

import { BookOpen, Check, Clock, FileText, Target } from "lucide-react";
import { useState, type ReactNode } from "react";

import { WeeksRing } from "@/components/teaching/assessments/assessments-home";
import {
  Card,
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
  secondaryText,
  viewHref,
} from "@/components/teaching/assessments/assessments-parts";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { ChoiceChip } from "@/components/ui/chip";
import { cn } from "@/components/ui-primitives";
import { EPAS, epa as epaInfo, supervisionLevelName } from "@/lib/teaching/assessments/content";
import {
  YEAR_WEEKS,
  endOfTermLine,
  endOfTermPill,
  epa1ThisTerm,
  epaCounts,
  epaNeedMore,
  epaRecords,
  epasInTerm,
  weeksDone,
  type AssessmentsState,
} from "@/lib/teaching/assessments/model";
import {
  SAMPLE_DOCTOR,
  SAMPLE_LEAVE,
  SAMPLE_REGISTRAR,
  SAMPLE_SUPERVISOR,
  SAMPLE_TERMS,
  sampleTerm,
  type EpaRecord,
  type SampleTerm,
} from "@/lib/teaching/assessments/sample";

function Meter({ percent, ok }: { percent: number; ok?: boolean }) {
  return (
    <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-[color:var(--border)]">
      <i
        data-mode-identity="teaching"
        className={cn(
          "block h-full rounded-full forced-colors:bg-[CanvasText]",
          ok ? "bg-[color:var(--success-text)]" : "bg-[color:var(--mode-identity)]",
        )}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  );
}

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
    <li className="grid gap-1.5 border-t border-[color:var(--border)] px-3.5 py-3 first:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <b className="text-sm font-semibold text-[color:var(--text-heading)]">{title}</b>
        {ok ? <Pill pill={{ label: "On track", tone: "ok" }} /> : null}
      </div>
      <span className={secondaryText}>{value}</span>
      <Meter percent={percent} ok={ok} />
      {note ? <p className="text-xs text-[color:var(--text-muted)]">{note}</p> : null}
    </li>
  );
}

const KINDS: readonly [string, string, string | null][] = [
  ["A", "Undifferentiated illness", "Term 1"],
  ["B", "Chronic illness", null],
  ["C", "Acute and critical illness", "Term 3"],
  ["D", "Peri-operative / procedural", "Term 2"],
];

function KindBoxes({ s }: { s: AssessmentsState }) {
  return (
    <ul role="list" className="grid grid-cols-2 gap-2">
      {KINDS.map(([k, name, done]) => (
        <li
          key={k}
          data-mode-identity="teaching"
          className={cn(
            "grid gap-0.5 rounded-xl border p-2.5",
            done
              ? "border-transparent bg-[color:var(--success-bg)]"
              : "border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)]",
          )}
        >
          <b
            className={cn(
              "text-base font-bold",
              done ? "text-[color:var(--success-text)]" : "text-[color:var(--mode-identity)]",
            )}
          >
            {k}
          </b>
          <span className="text-xs text-[color:var(--text-heading)]">{name}</span>
          <small className="text-2xs text-[color:var(--text-muted)]">
            {done ?? (s.sigs.doc ? "Term 4 · awaiting DCT" : "Now, term 4")}
          </small>
        </li>
      ))}
    </ul>
  );
}

export function YearRequirements({ s, openSheet }: ScreenProps) {
  const w = weeksDone(s);
  const total = epaRecords(s).length;
  const more = epaNeedMore(s);
  const by = epaCounts(s);
  const thisTerm = epasInTerm(s, "t4");
  const fromSpecialist = thisTerm.find((r) => r.role !== "registrar");
  return (
    <>
      <ScreenHeader
        back={viewHref("home")}
        backLabel="Assessments"
        title="Year requirements"
        subtitle={`${SAMPLE_DOCTOR.grade} · 2026`}
      />
      <Panel>
        <div className="flex items-center justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <Eyebrow accent>Weeks: on track</Eyebrow>
            <h2 className="text-xl font-extrabold text-[color:var(--text-heading)]">{YEAR_WEEKS - w} weeks to go</h2>
            <p className={secondaryText}>
              At least 47 weeks of supervised practice, including professional development leave. Your year runs 2 Feb
              2026 to 31 Jan 2027.
            </p>
          </div>
          <WeeksRing weeks={w} />
        </div>
        {epa1ThisTerm(s) ? null : (
          <p className={cn(secondaryText, "flex flex-wrap items-center gap-2")}>
            <Pill pill={{ label: "1 thing needs attention", tone: "warm" }} /> EPA 1 is needed this term, by Sun 8 Nov.
          </p>
        )}
      </Panel>

      <SectionLabel end={<SectionNote>PGY1 needs all four</SectionNote>}>Kinds of experience</SectionLabel>
      <Card>
        <KindBoxes s={s} />
        <p className="text-xs text-[color:var(--text-muted)]">
          Each term&apos;s kind is set by its accreditation. A term counts once the DCT countersigns it.
        </p>
      </Card>

      <SectionLabel>Terms and spread</SectionLabel>
      <List>
        <Requirement
          title="Terms completed"
          value="3 of at least 4 countersigned"
          percent={75}
          note={
            s.sigs.doc
              ? "Term 4 is signed by you both and counts once the DCT countersigns."
              : "Term 4 counts once it's signed and the DCT countersigns."
          }
        />
        <Requirement title="Largest specialty" value="Medicine 42% planned · limit 50%" percent={84} ok />
        <Requirement
          title="Largest subspecialty"
          value="Geriatric Medicine 23% planned · limit 25%"
          percent={92}
          ok
          note="Close to the limit. Check with your MEU before swapping into another geriatric term."
        />
        <Requirement title="Service terms (relief, nights)" value="None · limit 20%" percent={0} ok />
        <Requirement
          title="Sick, personal and carer's leave"
          value={`${SAMPLE_LEAVE.used} of ${SAMPLE_LEAVE.limit} working days`}
          percent={(SAMPLE_LEAVE.used / SAMPLE_LEAVE.limit) * 100}
          note="Over 10 working days, the Assessment Review Panel will monitor your progress."
        />
      </List>

      <SectionLabel end={<TextLink onClick={() => openSheet({ kind: "epa", pick: 1 })}>Request one</TextLink>}>
        EPAs
      </SectionLabel>
      <List>
        <Requirement
          title="This year"
          value={`${total} recorded here · at least ${more} more needed`}
          percent={(total / (total + more)) * 100}
          note="At least 10 a year, with EPA 1 in every term and at least 2 of each other EPA. For your terms that means at least 11."
        />
        <Requirement
          title="This term"
          value={`${thisTerm.length} recorded here · at least 2 needed`}
          percent={thisTerm.length * 50}
          ok={thisTerm.length >= 2}
        />
        <Requirement
          title="From a term supervisor or specialist this term"
          value={
            fromSpecialist
              ? `Done: EPA ${fromSpecialist.epa} with ${fromSpecialist.by.replace("Dr Priya Nair", SAMPLE_SUPERVISOR.short)}`
              : "None recorded here yet"
          }
          percent={fromSpecialist ? 100 : 0}
          ok={!!fromSpecialist}
        />
        <li className="grid gap-1.5 border-t border-[color:var(--border)] px-3.5 py-3">
          <b className="text-sm font-semibold text-[color:var(--text-heading)]">Each EPA</b>
          {EPAS.map((x) => {
            const n = by[x.id];
            const need = x.id === 1 ? !epa1ThisTerm(s) : n < 2;
            const note =
              x.id === 1 ? (need ? "needed this term" : "done this term") : need ? `${2 - n} more by Jan` : "met";
            return (
              <div key={x.id} className="flex items-baseline justify-between gap-3 text-sm-minus">
                <span className="text-[color:var(--text-muted)]">
                  EPA {x.id} · {x.short}
                </span>
                <b
                  className={cn(
                    "text-right font-semibold tabular-nums",
                    need && x.id === 1 ? "text-[color:var(--warning-text)]" : "text-[color:var(--text-heading)]",
                  )}
                >
                  {n} · {note}
                </b>
              </div>
            );
          })}
        </li>
      </List>
      <SmallPrint>
        Counts are EPAs recorded in PsychSift. Any recorded only in Clinical Learning Australia (CLA) won&apos;t show
        here. A &quot;direct supervision&quot; result is recorded as feedback for that moment; it is not a fail on its
        own.
      </SmallPrint>

      <SectionLabel>Term assessments</SectionLabel>
      <List>
        <Requirement title="Mid-term (terms over 5 weeks)" value="4 of 4 so far" percent={100} ok />
        <Requirement title="End-of-term" value="3 of 5 countersigned" percent={60} />
      </List>
      <SmallPrint>PGY2 has its own rules. They&apos;ll show here when you start PGY2.</SmallPrint>
      <SmallPrint center>
        AMC National Framework 2024 · rules to be checked against the source before release
      </SmallPrint>
    </>
  );
}

function EpaRecordRow({ r }: { r: EpaRecord }) {
  return (
    <Row
      icon={Target}
      iconTone={r.level === "direct" ? "muted" : "ok"}
      title={`EPA ${r.epa} · ${epaInfo(r.epa).title}`}
      subtitle={`${supervisionLevelName(r.level)} · ${r.by} (${r.role})`}
    />
  );
}

function requestedFrom(who: "sup" | "reg") {
  return who === "sup" ? SAMPLE_SUPERVISOR.name : SAMPLE_REGISTRAR.name;
}

export function TermDetails({ s, params, openSheet }: ScreenProps) {
  const t = sampleTerm(params.get("term"));
  const current = t.status === "current";
  const done = t.status === "done";
  const eps = epasInTerm(s, t.id);
  let steps: ReactNode;
  if (current)
    steps = (
      <>
        <StepRow
          state="ok"
          title="Beginning-of-term talk"
          detail="Wed 2 Sep · goals: formulation on ward round, EPA 1, lithium monitoring"
        />
        <StepRow
          state="ok"
          title="Mid-term assessment"
          detail="Signed Fri 2 Oct"
          href={viewHref("report", { of: "mid" })}
        />
        <StepRow
          state="now"
          title="End-of-term assessment"
          detail={endOfTermLine(s)}
          tag={<Pill pill={endOfTermPill(s)} />}
          href={viewHref("hub")}
        />
      </>
    );
  else if (done)
    steps = (
      <>
        <StepRow state="ok" title="Beginning-of-term talk" detail={`With ${t.supervisor}`} />
        <StepRow
          state="ok"
          title="Mid-term assessment"
          detail={`Signed ${t.midSigned}`}
          href={viewHref("pdf", { of: "past", kind: "mid", term: t.id })}
        />
        <StepRow
          state="ok"
          title="End-of-term assessment"
          detail={`Signed ${t.signed} · countersigned by the DCT`}
          tag={<Pill pill={{ label: "Satisfactory · countersigned", tone: "ok" }} />}
          href={viewHref("pdf", { of: "past", kind: "eot", term: t.id })}
        />
      </>
    );
  else
    steps = (
      <>
        <StepRow state="lock" title="Beginning-of-term talk" detail={`In your first week, with ${t.supervisor}`} />
        <StepRow state="lock" title="Mid-term assessment" detail="Around the middle of the term" />
        <StepRow state="lock" title="End-of-term assessment" detail="Booking opens two weeks before the end" />
      </>
    );
  return (
    <>
      <ScreenHeader back={viewHref("home")} backLabel="Assessments" title={`Term ${t.n}`} subtitle={t.name} />
      <Panel>
        <Eyebrow accent>{`${t.category} · ${t.categoryName}`}</Eyebrow>
        <h2 className="text-xl font-extrabold text-[color:var(--text-heading)]">{t.name}</h2>
        <KeyValue k="Dates" v={`${t.from} to ${t.to}`} />
        <KeyValue k="Length" v={`${t.weeks} weeks`} />
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
              ? s.epaRequests
                  .filter((r) => r.status === "requested")
                  .map((r) => (
                    <Row
                      key={`req-${r.epa}`}
                      icon={Clock}
                      title={`EPA ${r.epa} · ${epaInfo(r.epa).title}`}
                      subtitle={`Requested from ${requestedFrom(r.who)}`}
                    />
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
  | { term: SampleTerm; type: "epa"; request: { epa: 1 | 2 | 3 | 4; who: "sup" | "reg" }; todo: true };

function allItems(s: AssessmentsState): Item[] {
  const items: Item[] = [];
  for (const t of SAMPLE_TERMS.filter((x) => x.status === "done")) {
    items.push({
      term: t,
      type: "eot",
      title: "End-of-term",
      detail: `Signed ${t.signed} · countersigned by the DCT`,
      tag: <Pill pill={{ label: "Satisfactory · countersigned", tone: "ok" }} />,
      href: viewHref("pdf", { of: "past", kind: "eot", term: t.id }),
    });
    items.push({
      term: t,
      type: "mid",
      title: "Mid-term",
      detail: `Signed ${t.midSigned} · ${t.supervisor}`,
      href: viewHref("pdf", { of: "past", kind: "mid", term: t.id }),
    });
    for (const record of epasInTerm(s, t.id)) items.push({ term: t, type: "epa", record });
  }
  const t4 = sampleTerm("t4");
  items.push({
    term: t4,
    type: "eot",
    title: "End-of-term",
    detail: endOfTermLine(s),
    tag: <Pill pill={endOfTermPill(s)} />,
    href: viewHref("hub"),
    todo: !s.sigs.doc,
  });
  items.push({
    term: t4,
    type: "mid",
    title: "Mid-term",
    detail: "Signed Fri 2 Oct · Dr Priya Nair",
    href: viewHref("report", { of: "mid" }),
  });
  for (const record of epasInTerm(s, "t4")) items.push({ term: t4, type: "epa", record });
  for (const r of s.epaRequests.filter((x) => x.status === "requested"))
    items.push({ term: t4, type: "epa", request: { epa: r.epa, who: r.who }, todo: true });
  return items;
}

const FILTERS: readonly [Filter, string][] = [
  ["all", "All"],
  ["todo", "To do"],
  ["eot", "End-of-term"],
  ["mid", "Mid-term"],
  ["epa", "EPAs"],
];

export function AllAssessments({ s }: ScreenProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = allItems(s).filter((i) => filter === "all" || (filter === "todo" ? i.todo : i.type === filter));
  const terms = [...new Set(shown.map((i) => i.term))].sort((a, b) => b.n - a.n);
  return (
    <>
      <ScreenHeader
        back={viewHref("home")}
        backLabel="Assessments"
        title="All assessments"
        subtitle={`${SAMPLE_DOCTOR.grade} · 2026`}
      />
      <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
        {FILTERS.map(([id, label]) => (
          <ChoiceChip key={id} pressed={filter === id} onPressedChange={() => setFilter(id)}>
            {label}
          </ChoiceChip>
        ))}
      </div>
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
                      <Row
                        key={`r${n}`}
                        icon={Clock}
                        title={`EPA ${i.request.epa} · ${epaInfo(i.request.epa).title}`}
                        subtitle={`Requested from ${requestedFrom(i.request.who)}`}
                      />
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
        <Card className="justify-items-center text-center">
          <Check aria-hidden="true" className="size-icon-lg text-[color:var(--success-text)]" />
          <h2 className="text-base font-bold text-[color:var(--text-heading)]">Nothing to do</h2>
          <p className={secondaryText}>Every assessment so far is signed.</p>
        </Card>
      )}
    </>
  );
}
