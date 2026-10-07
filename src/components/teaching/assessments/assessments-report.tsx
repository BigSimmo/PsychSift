"use client";

import { FileText, Flag, MessageSquare, PenLine, Target, TriangleAlert } from "lucide-react";
import { useRef, useState, type PointerEvent } from "react";

import { focusRing } from "@/components/card-recipes";
import {
  Card,
  Eyebrow,
  Inset,
  KeyValue,
  List,
  Panel,
  Pill,
  ScreenHeader,
  SectionLabel,
  SectionNote,
  SmallPrint,
  TickRow,
  WhyNot,
  secondaryText,
  viewHref,
} from "@/components/teaching/assessments/assessments-parts";
import { WorkButton } from "@/components/mode-kit/work";
import { AssessButton, CompareRow } from "@/components/teaching/assessments/assess-kit";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { cn, fieldControlPlain } from "@/components/ui-primitives";
import { globalRatingName } from "@/lib/teaching/assessments/content";
import {
  compareRatings,
  meetingDate,
  needsImprovementPlan,
  reportSummary,
  selfDone,
  suggestedGoals,
  supReady,
  todayLabel,
  type ComparisonRow,
  type SignatureInk,
  type Who,
} from "@/lib/teaching/assessments/model";
import { SAMPLE_DOCTOR, SAMPLE_MIDTERM, SAMPLE_SUPERVISOR } from "@/lib/teaching/assessments/sample";

const DOC = SAMPLE_DOCTOR;
const SUP = SAMPLE_SUPERVISOR.short;

/**
 * Domain by domain on a 1 to 5 line: the supervisor's rating as a filled dot,
 * the doctor's as a ring. Neutral: never green for agreeing, never red for differing.
 */
export function ComparisonChart({ rows, view }: { rows: ComparisonRow[]; view: "doc" | "sup" }) {
  const supName = view === "doc" ? SUP : "You";
  const docName = view === "doc" ? "You" : DOC.first;
  return (
    <div className="grid">
      <span className="assess-key self-end" aria-hidden="true">
        <span>
          <i data-who="you" />
          {supName}
        </span>
        <span>
          <i data-who="them" />
          {docName}
        </span>
      </span>
      {rows.map((row) => (
        <CompareRow
          key={row.domain}
          title={`${row.domain} · ${row.title}`}
          you={row.sup}
          them={row.self}
          youName={supName}
          themName={docName}
          message={row.message}
        />
      ))}
      <div className="assess-ax" aria-hidden="true">
        <span>1 Rarely met</span>
        <span>3 Consistently</span>
        <span>5 Exceeded</span>
      </div>
    </div>
  );
}

function SignatureMark({ who, mid, s }: { who: "sup" | "doc"; mid: boolean; s: ScreenProps["s"] }) {
  if (mid)
    return (
      <span className="font-serif text-base text-[color:var(--text-heading)] italic">
        {who === "sup" ? "Priya Nair" : "Sam Lee"}
      </span>
    );
  const sig = s.sigs[who];
  if (!sig)
    return <Pill pill={{ label: who === "doc" ? "Your turn" : "Not yet", tone: who === "doc" ? "warm" : "neutral" }} />;
  if (sig.image)
    return (
      <svg
        role="img"
        aria-label={`Signature of ${who === "sup" ? SAMPLE_SUPERVISOR.name : DOC.name}`}
        viewBox={`0 0 ${sig.image.width} ${sig.image.height}`}
        className="h-8 w-auto text-[color:var(--text-heading)]"
      >
        <path d={sig.image.path} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
      </svg>
    );
  return <span className="font-serif text-base text-[color:var(--text-heading)] italic">{sig.typed}</span>;
}

function SignatureLine({ role, name, mark }: { role: string; name: string; mark: React.ReactNode }) {
  return (
    <li className="flex min-h-14 items-center justify-between gap-3 border-t border-[color:var(--border)] px-3.5 py-2.5 first:border-t-0">
      <span className="grid gap-0.5">
        <span className="text-xs text-[color:var(--text-muted)]">{role}</span>
        <b className="text-sm font-semibold text-[color:var(--text-heading)]">{name}</b>
      </span>
      {mark}
    </li>
  );
}

export function AssessmentReport({ s, params, openSheet }: ScreenProps) {
  const mid = params.get("of") !== "eot";
  if (!mid && !supReady(s))
    return (
      <>
        <ScreenHeader back={viewHref("hub")} backLabel="End-of-term" title="End-of-term report" subtitle="Psychiatry" />
        <Inset tone="plain" title={`${SUP} hasn't finished her draft yet`}>
          The report appears here once she has, and you&apos;ve met.
        </Inset>
      </>
    );
  const self = mid ? SAMPLE_MIDTERM.self : selfDone(s) ? s.self : null;
  const sup = mid ? SAMPLE_MIDTERM.sup : s.sup;
  const ipap = !mid && needsImprovementPlan(s.sup);
  const g = mid ? null : s.sup.global;
  const good = g === "sat" && !ipap;
  const supSigned = mid || !!s.sigs.sup;
  const docSigned = mid || !!s.sigs.doc;
  return (
    <>
      <ScreenHeader
        back={mid ? viewHref("home") : viewHref("hub")}
        backLabel={mid ? "Assessments" : "End-of-term"}
        title={`${mid ? "Mid-term" : "End-of-term"} report`}
        subtitle={`Psychiatry · ${mid ? SAMPLE_MIDTERM.date : (meetingDate(s) ?? "not met yet")}`}
      />
      <Panel>
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-full",
              // Nothing shows green before the DCT countersigns, so a good rating stays neutral here.
              mid || good
                ? "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
                : "bg-[color:var(--warning-bg)] text-[color:var(--warning-text)]",
            )}
          >
            {mid || good ? (
              <MessageSquare aria-hidden="true" className="size-icon-md" />
            ) : (
              <TriangleAlert aria-hidden="true" className="size-icon-md" />
            )}
          </span>
          <div className="grid gap-0.5">
            <Eyebrow>{mid ? "Mid-term" : "Supervisor's overall rating"}</Eyebrow>
            <p className="text-lg font-semibold text-[color:var(--text-heading)]">
              {mid ? "Feedback only" : globalRatingName(g)}
            </p>
            <p className={secondaryText}>
              {mid
                ? "There's no overall rating at mid-term."
                : s.sigs.doc
                  ? "Not final until the DCT countersigns. The Assessment Review Panel reviews the year."
                  : "Not final until you've both signed and the DCT countersigns."}
            </p>
          </div>
        </div>
      </Panel>
      {ipap ? (
        <Inset tone="warm" title="Under the form, these ratings mean an improvement plan (IPAP) is needed">
          It is extra support with agreed goals and a review date. It is recorded, and the Assessment Review Panel sees
          it at the end of the year. Your DCT or MEU will contact you; you can also start the conversation.
        </Inset>
      ) : null}
      <SectionLabel>{`You and ${SUP}`}</SectionLabel>
      <Card>
        <ComparisonChart rows={compareRatings(self?.ratings ?? null, sup.ratings, "doc", DOC.first)} view="doc" />
        <hr className="border-[color:var(--border)]" />
        <p className={secondaryText}>{reportSummary(self, sup)}</p>
      </Card>
      <SectionLabel>{`${SUP}'s words`}</SectionLabel>
      <Card>
        <Eyebrow>Strengths</Eyebrow>
        <p className="text-sm text-[color:var(--text-heading)]">{sup.strengths}</p>
        <Eyebrow>Areas for improvement</Eyebrow>
        <p className="text-sm text-[color:var(--text-heading)]">{sup.areas}</p>
      </Card>
      <SectionLabel end={<SectionNote>Suggested from the ratings</SectionNote>}>
        {mid ? "Goals for the rest of term" : "Goals for next term"}
      </SectionLabel>
      <List>
        {suggestedGoals(sup.ratings).map((goal) => (
          <li
            key={goal}
            className="flex min-h-15 items-center gap-3 border-t border-[color:var(--border)] px-3.5 py-3 first:border-t-0"
          >
            <Target
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-icon-md shrink-0 text-[color:var(--text-muted)]"
            />
            <span className="min-w-0 flex-1 text-sm text-[color:var(--text-heading)]">{goal}</span>
          </li>
        ))}
      </List>
      <SmallPrint>
        Your self-assessment is shared only with {SUP}. Only the supervisor&apos;s form goes to the MEU; PsychSift
        doesn&apos;t send it for you.
      </SmallPrint>
      <SectionLabel>Signatures</SectionLabel>
      <ul role="list" className="grid">
        <SignatureLine
          role="Term supervisor"
          name={SAMPLE_SUPERVISOR.name}
          mark={
            supSigned ? (
              <SignatureMark who="sup" mid={mid} s={s} />
            ) : (
              <Pill pill={{ label: "Not yet", tone: "neutral" }} />
            )
          }
        />
        <SignatureLine
          role="You"
          name={DOC.name}
          mark={
            docSigned ? (
              <SignatureMark who="doc" mid={mid} s={s} />
            ) : (
              <Pill pill={{ label: "Your turn", tone: "warm" }} />
            )
          }
        />
        <SignatureLine
          role="DPME or DCT"
          name="Medical Education Unit"
          mark={
            <Pill
              pill={{
                label: mid
                  ? "Not needed at mid-term"
                  : docSigned
                    ? s.sentToMeu
                      ? "Waiting"
                      : "After you email it"
                    : "After you",
                tone: "neutral",
              }}
            />
          }
        />
      </ul>
      {!mid && s.sigs.sup && !s.sigs.doc ? (
        <WorkButton href={viewHref("sign")} icon={PenLine} size="wide">
          Read and sign
        </WorkButton>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <WorkButton href={viewHref("pdf", { of: mid ? "mid" : "eot" })} variant="secondary" icon={FileText}>
          View PDF
        </WorkButton>
        <AssessButton icon={Flag} variant="secondary" block onClick={() => openSheet({ kind: "disagree" })}>
          Disagree?
        </AssessButton>
      </div>
    </>
  );
}

/** Draw with a finger or a mouse. The drawing stays in page memory as line data. */
function SignaturePad({ onDraw, label }: { onDraw: (image: SignatureInk | null) => void; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const moved = useRef(false);
  const path = useRef("");
  const stroke = useRef("");
  const [drawn, setDrawn] = useState(false);
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top] as const;
  };
  const begin = (event: PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    // Size the canvas once, at screen density, so later strokes never wipe earlier ones.
    if (!c.dataset.sized) {
      const ratio = window.devicePixelRatio || 1;
      c.width = Math.round(c.clientWidth * ratio);
      c.height = Math.round(c.clientHeight * ratio);
      ctx.scale(ratio, ratio);
      c.dataset.sized = "1";
    }
    c.setPointerCapture(event.pointerId);
    drawing.current = true;
    moved.current = false;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = getComputedStyle(c).color;
    const [x, y] = point(event);
    stroke.current = `M${x.toFixed(1)} ${y.toFixed(1)}`;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const [x, y] = point(event);
    ctx.lineTo(x, y);
    ctx.stroke();
    stroke.current += `L${x.toFixed(1)} ${y.toFixed(1)}`;
    moved.current = true;
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    // A tap with no line drawn is not a signature.
    if (!moved.current) return;
    setDrawn(true);
    path.current += stroke.current;
    const c = canvas.current;
    onDraw(c ? { width: c.clientWidth, height: c.clientHeight, path: path.current } : null);
  };
  return (
    <div className="relative h-32 rounded-xl border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)]">
      {drawn ? null : (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-[color:var(--text-muted)]"
        >
          Sign here with your finger, or type your name below
        </span>
      )}
      <canvas
        ref={canvas}
        aria-label={label}
        role="img"
        className="absolute inset-0 size-full touch-none text-[color:var(--text-heading)]"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-4 bottom-7 h-px bg-[color:var(--border-strong)]"
      />
    </div>
  );
}

export function SignForm({ s, dispatch, go, openSheet, who }: ScreenProps & { who: Who }) {
  const sup = who === "sup";
  const name = sup ? SAMPLE_SUPERVISOR.name : DOC.name;
  const [typed, setTyped] = useState("");
  const [image, setImage] = useState<SignatureInk | null>(null);
  const [agree, setAgree] = useState(false);
  const [padKey, setPadKey] = useState(0);
  const hasSignature = !!image || typed.trim().length > 2;
  const can = hasSignature && agree;
  const back = sup ? viewHref("side", { as: "supervisor" }) : viewHref("report", { of: "eot" });
  const ready = sup ? meetingDate(s) !== null && !s.sigs.sup : !!s.sigs.sup && !s.sigs.doc;
  if (!ready)
    return (
      <>
        <ScreenHeader back={back} backLabel={sup ? "Side by side" : "Report"} title="Sign" />
        <Inset tone="plain" title={sup ? "Not ready to sign" : `Waiting for ${SUP}`}>
          {sup ? "You sign after the meeting, and only once." : `You sign after ${SUP} has signed.`}
        </Inset>
      </>
    );
  return (
    <>
      <ScreenHeader
        back={back}
        backLabel={sup ? "Side by side" : "Report"}
        title="Sign"
        subtitle={sup ? `${DOC.first}'s end-of-term` : "End-of-term report"}
      />
      <Panel>
        <Eyebrow accent>{sup ? "Term supervisor" : "Prevocational doctor"}</Eyebrow>
        <h2 className="text-xl font-semibold text-[color:var(--text-heading)]">{name}</h2>
        <p className={secondaryText}>
          {sup
            ? `I have completed this assessment and discussed it with ${DOC.first}.`
            : "I confirm I have discussed this report with my term supervisor or delegate, and know that if I disagree with any point I may respond in writing to the Director of Clinical Training within 14 days."}
        </p>
        <KeyValue k="Meeting held" v={meetingDate(s) ?? "Not recorded"} />
      </Panel>
      <SectionLabel
        end={
          <button
            type="button"
            className={cn(focusRing, "min-h-12 text-sm font-medium text-[color:var(--mode-identity)]")}
            data-mode-identity="teaching"
            onClick={() => {
              setImage(null);
              setPadKey((k) => k + 1);
            }}
          >
            Clear
          </button>
        }
      >
        Draw your signature
      </SectionLabel>
      <SignaturePad key={padKey} onDraw={setImage} label={`Signature pad for ${name}`} />
      <div className="grid gap-1.5">
        <label htmlFor="assess-sign-typed" className="px-1 text-sm font-semibold text-[color:var(--text-heading)]">
          Or type your name
        </label>
        <input
          id="assess-sign-typed"
          type="text"
          autoComplete="name"
          value={typed}
          placeholder={name.replace("Dr ", "")}
          onChange={(event) => setTyped(event.target.value)}
          className={fieldControlPlain}
        />
      </div>
      <ul role="list" className="grid">
        <TickRow checked={agree} onChange={() => setAgree((v) => !v)}>
          {sup ? "This is my signature as term supervisor." : "I've read the report and this is my signature."}
        </TickRow>
      </ul>
      <SmallPrint>
        Your signature is saved with the form, with the date and time{sup ? ", through your secure email link" : ""}. On
        these made-up records it stays on this page. Made-up date: {todayLabel(s)}.
      </SmallPrint>
      <AssessButton
        icon={PenLine}
        variant="primary"
        block
        disabled={!can}
        describedBy={can ? undefined : "assess-sign-why"}
        onClick={() => {
          dispatch({ type: "sign", who, typed: typed || name.replace("Dr ", ""), image });
          go(sup ? viewHref("side", { as: "supervisor" }) : viewHref("hub"));
        }}
      >
        Sign
      </AssessButton>
      {can ? null : (
        <WhyNot id="assess-sign-why">
          {hasSignature ? "" : "Draw or type your signature. "}
          {agree ? "" : "Tick the box to confirm."}
        </WhyNot>
      )}
      {sup ? null : (
        <AssessButton icon={Flag} variant="secondary" block onClick={() => openSheet({ kind: "disagree" })}>
          I disagree with part of this
        </AssessButton>
      )}
    </>
  );
}
