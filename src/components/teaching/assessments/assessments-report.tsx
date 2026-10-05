"use client";

import { FileText, Flag, MessageSquare, PenLine, Target, TriangleAlert } from "lucide-react";
import Link from "next/link";
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
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { Button, buttonFaceClass } from "@/components/ui/button";
import { cn, fieldControlPlain, ignoreUnavailableActivation } from "@/components/ui-primitives";
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
  type Who,
} from "@/lib/teaching/assessments/model";
import { SAMPLE_DOCTOR, SAMPLE_MIDTERM, SAMPLE_SUPERVISOR } from "@/lib/teaching/assessments/sample";

const DOC = SAMPLE_DOCTOR;
const SUP = SAMPLE_SUPERVISOR.short;

const position = (rating: number) => `${((rating - 1) / 4) * 100}%`;

function Marker({ value, kind }: { value: number; kind: "you" | "sup" | "both" }) {
  return (
    <span
      aria-hidden="true"
      data-mode-identity="teaching"
      className={cn(
        "absolute top-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-xs font-normal tabular-nums forced-colors:border",
        kind === "sup" && "bg-[color:var(--text-heading)] text-[color:var(--surface-raised)]",
        kind === "you" &&
          "border-2 border-[color:var(--text-heading)] bg-[color:var(--surface-raised)] text-[color:var(--text-heading)]",
        kind === "both" && "bg-[color:var(--mode-identity)] text-[color:var(--mode-identity-contrast)]",
      )}
      style={{ left: position(value) }}
    >
      {value}
    </span>
  );
}

function LegendDot({ kind, children }: { kind: "you" | "sup" | "both"; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        data-mode-identity="teaching"
        className={cn(
          "size-3 rounded-full",
          kind === "sup" && "bg-[color:var(--text-heading)]",
          kind === "you" && "border-2 border-[color:var(--text-heading)]",
          kind === "both" && "bg-[color:var(--mode-identity)]",
        )}
      />
      {children}
    </span>
  );
}

/** Self against supervisor on one 1-to-5 line per domain, in neutral grey: neither rating is "right". */
export function ComparisonChart({ rows, view }: { rows: ComparisonRow[]; view: "doc" | "sup" }) {
  const selfName = view === "sup" ? DOC.first : "You";
  const supName = view === "sup" ? "You" : SUP;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-4 text-xs text-[color:var(--text-muted)]">
        <LegendDot kind="you">{selfName}</LegendDot>
        <LegendDot kind="sup">{supName}</LegendDot>
        <LegendDot kind="both">Same</LegendDot>
      </div>
      {rows.map((row) => {
        const both = row.self === row.sup;
        return (
          <div key={row.domain} className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <b className="text-sm font-semibold text-[color:var(--text-heading)]">
                {row.domain} · {row.title}
              </b>
              <span className="text-xs text-[color:var(--text-muted)]">{row.message}</span>
            </div>
            <div
              role="img"
              aria-label={`${selfName}: ${row.self ?? "none"}. ${supName}: ${row.sup}. Out of 5.`}
              className="relative mx-3 h-7"
            >
              <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-[color:var(--border-strong)]" />
              {[0, 25, 50, 75, 100].map((p) => (
                <span
                  key={p}
                  aria-hidden="true"
                  className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-[color:var(--border-strong)]"
                  style={{ left: `${p}%` }}
                />
              ))}
              {row.self && !both ? (
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-[color:var(--border-strong)]"
                  style={{
                    left: position(Math.min(row.self, row.sup)),
                    width: `${(Math.abs(row.sup - row.self) / 4) * 100}%`,
                  }}
                />
              ) : null}
              {row.self && both ? <Marker value={row.sup} kind="both" /> : null}
              {row.self && !both ? <Marker value={row.self} kind="you" /> : null}
              {!both || !row.self ? <Marker value={row.sup} kind="sup" /> : null}
            </div>
          </div>
        );
      })}
      <div className="flex justify-between text-2xs text-[color:var(--text-muted)]">
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
      // eslint-disable-next-line @next/next/no-img-element -- a drawn signature held in page memory as a data URL
      <img
        src={sig.image}
        alt={`Signature of ${who === "sup" ? SAMPLE_SUPERVISOR.name : DOC.name}`}
        className="h-8 w-auto dark:invert"
      />
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

const unavailableNoteId = "assess-goal-unavailable";

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
      <SectionLabel end={<SectionNote>Suggested from the ratings · edit before adding</SectionNote>}>
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
            <button
              type="button"
              aria-disabled="true"
              aria-describedby={unavailableNoteId}
              title="Adding goals — coming soon"
              onClick={ignoreUnavailableActivation}
              className={cn(buttonFaceClass({ variant: "secondary", size: "sm" }), "shrink-0 aria-disabled:opacity-60")}
            >
              Edit and add
            </button>
          </li>
        ))}
      </List>
      <p id={unavailableNoteId} className="sr-only">
        Adding goals to next term is not built yet.
      </p>
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
        <Link
          href={viewHref("sign")}
          className={cn(buttonFaceClass({ variant: "primary", block: true }), "no-underline")}
        >
          <PenLine aria-hidden="true" className="size-icon-sm" />
          Read and sign
        </Link>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Link
          href={viewHref("pdf", { of: mid ? "mid" : "eot" })}
          className={cn(buttonFaceClass({ variant: "secondary", block: true }), "no-underline")}
        >
          <FileText aria-hidden="true" className="size-icon-sm" />
          View PDF
        </Link>
        <Button icon={Flag} variant="secondary" block onClick={() => openSheet({ kind: "disagree" })}>
          Disagree?
        </Button>
      </div>
    </>
  );
}

/** Draw with a finger or a mouse. The drawing stays in page memory as an image. */
function SignaturePad({ onDraw, label }: { onDraw: (image: string | null) => void; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const moved = useRef(false);
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
    // Fixed ink, so the saved image reads the same in either theme (it is shown inverted in dark).
    ctx.strokeStyle = "black";
    const [x, y] = point(event);
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
    moved.current = true;
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    // A tap with no line drawn is not a signature.
    if (!moved.current) return;
    setDrawn(true);
    onDraw(canvas.current?.toDataURL("image/png") ?? null);
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
        className="absolute inset-0 size-full touch-none dark:invert"
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
  const [image, setImage] = useState<string | null>(null);
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
      <Button
        icon={PenLine}
        variant="primary"
        block
        disabled={!can}
        aria-describedby={can ? undefined : "assess-sign-why"}
        onClick={() => {
          dispatch({ type: "sign", who, typed: typed || name.replace("Dr ", ""), image });
          go(sup ? viewHref("side", { as: "supervisor" }) : viewHref("hub"));
        }}
      >
        Sign
      </Button>
      {can ? null : (
        <WhyNot id="assess-sign-why">
          {hasSignature ? "" : "Draw or type your signature. "}
          {agree ? "" : "Tick the box to confirm."}
        </WhyNot>
      )}
      {sup ? null : (
        <Button icon={Flag} variant="secondary" block onClick={() => openSheet({ kind: "disagree" })}>
          I disagree with part of this
        </Button>
      )}
    </>
  );
}
