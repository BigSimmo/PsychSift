"use client";

import { BookOpen, Check, ChevronLeft, ChevronRight, Copy, Eye, EyeOff, FileText, Lock, Target } from "lucide-react";

import { focusRing } from "@/components/card-recipes";
import { modePressable } from "@/components/mode-kit/recipes";
import {
  Card,
  Eyebrow,
  Inset,
  List,
  NoteField,
  Panel,
  Row,
  ScreenHeader,
  SectionLabel,
  TextLink,
  WhyNot,
  labelText,
  secondaryText,
  viewHref,
} from "@/components/teaching/assessments/assessments-parts";
import type { ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { Button } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/chip";
import { cn, fieldControlPlain } from "@/components/ui-primitives";
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
  type Rating,
} from "@/lib/teaching/assessments/content";
import {
  epasInTerm,
  formBlockers,
  formMentionsPatient,
  lowDomains,
  needsImprovementPlan,
  selfDone,
  selfLocked,
  supLocked,
  supReady,
  type Who,
} from "@/lib/teaching/assessments/model";
import {
  SAMPLE_DOCTOR,
  SAMPLE_REGISTRAR,
  SAMPLE_REGISTRAR_NOTE,
  SAMPLE_SUPERVISOR,
} from "@/lib/teaching/assessments/sample";

const DOC = SAMPLE_DOCTOR;
const SUP = SAMPLE_SUPERVISOR.short;

function StepHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail?: string }) {
  return (
    <div className="grid gap-1 px-0.5" data-mode-identity="teaching">
      <Eyebrow accent>{eyebrow}</Eyebrow>
      <h3 className="text-lg font-semibold text-[color:var(--text-heading)]">{title}</h3>
      {detail ? <p className={secondaryText}>{detail}</p> : null}
    </div>
  );
}

/** One radio option drawn as a full-width row: the native input stays for keyboard and screen readers. */
function OptionRow({
  name,
  checked,
  onSelect,
  low,
  number,
  title,
  detail,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  low?: boolean;
  number?: number;
  title: string;
  detail?: string;
}) {
  return (
    <label
      data-mode-identity="teaching"
      className={cn(
        modePressable,
        "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[color:var(--focus)] forced-colors:border",
        checked
          ? low
            ? "border-[color:var(--danger-text)] bg-[color:var(--danger-bg)]"
            : "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity-soft)]"
          : "border-[color:var(--border)] bg-[color:var(--surface-raised)]",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      {number ? (
        <span
          aria-hidden="true"
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full text-sm font-normal tabular-nums",
            checked
              ? low
                ? "bg-[color:var(--danger-text)] text-[color:var(--surface-raised)]"
                : "bg-[color:var(--mode-identity)] text-[color:var(--mode-identity-contrast)]"
              : "border border-[color:var(--border)] text-[color:var(--text-muted)]",
          )}
        >
          {number}
        </span>
      ) : null}
      <span className="grid min-w-0 gap-0.5">
        <b className="text-sm font-semibold text-[color:var(--text-heading)]">{title}</b>
        {detail ? <span className={secondaryText}>{detail}</span> : null}
      </span>
      {checked ? (
        <Check aria-hidden="true" className="ml-auto size-icon-sm shrink-0 text-[color:var(--text-heading)]" />
      ) : null}
    </label>
  );
}

function OutcomeTick({
  checked,
  onToggle,
  title,
  detail,
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  detail?: string;
}) {
  return (
    <li className="border-t border-[color:var(--border)] first:border-t-0">
      <label
        className={cn(
          modePressable,
          "flex min-h-12 cursor-pointer items-start gap-3 px-3.5 py-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[color:var(--focus)]",
        )}
      >
        <input type="checkbox" checked={checked} onChange={onToggle} className="sr-only" />
        <span
          aria-hidden="true"
          className={cn(
            "mt-px grid size-5 shrink-0 place-items-center rounded-md border-2 forced-colors:border-[CanvasText]",
            checked
              ? "border-[color:var(--command)] bg-[color:var(--command)] text-[color:var(--command-contrast)]"
              : "border-[color:var(--border-strong)]",
          )}
        >
          {checked ? <Check aria-hidden="true" strokeWidth={3} className="size-icon-xs" /> : null}
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className="text-sm font-semibold text-[color:var(--text-heading)]">{title}</span>
          {detail ? <span className={secondaryText}>{detail}</span> : null}
        </span>
      </label>
    </li>
  );
}

function BlindNote() {
  return (
    <Inset tone="plain" icon={EyeOff}>
      {DOC.first}&apos;s self-ratings stay hidden until you finish your draft, so your view is your own.
    </Inset>
  );
}

export function AssessmentForm({ s, dispatch, who, go }: ScreenProps & { who: Who }) {
  const sup = who === "sup";
  const f = s[who];
  const locked = sup ? supLocked(s) : selfLocked(s);
  const stepIndex = locked ? LAST_FORM_STEP : f.step;
  const step = FORM_STEPS[stepIndex]!;
  const n = stepIndex + 1;
  const back = sup ? viewHref("home", { as: "supervisor" }) : viewHref("hub");
  const blind = sup && !supReady(s) ? <BlindNote /> : null;
  const setStep = (to: number) => {
    dispatch({ type: "form-step", who, step: to });
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  };

  let body: React.ReactNode;
  if (step === "about") {
    body = (
      <>
        {blind}
        <Panel>
          <Eyebrow accent>{sup ? `${DOC.name} · ${DOC.grade}` : "End-of-term · term 4"}</Eyebrow>
          <h3 className="text-xl font-semibold text-[color:var(--text-heading)]">Psychiatry, 31 Aug to 8 Nov</h3>
          <p className={secondaryText}>
            {sup
              ? "You're completing this as term supervisor. The form goes to the MEU by Fri 20 Nov, within 10 working days of the end of term."
              : `Optional, but it makes your meeting with ${SUP} more useful. ${SUP} sees it only after she finishes her own draft. PsychSift doesn't send it to the MEU or the Assessment Review Panel.`}
          </p>
        </Panel>
        {sup && s.request.registrar ? (
          <Card>
            <Eyebrow>{`Notes from ${SAMPLE_REGISTRAR.name}, registrar`}</Eyebrow>
            <p className="text-sm text-[color:var(--text-heading)] italic">{SAMPLE_REGISTRAR_NOTE}</p>
          </Card>
        ) : null}
        <fieldset className="grid gap-2" disabled={locked}>
          <legend className={cn(labelText, "mb-2 px-1")}>
            {sup ? "Sources of information" : "What are you drawing on?"}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {EVIDENCE_SOURCES.map((source) => (
              <ChoiceChip
                key={source}
                pressed={f.sources.includes(source)}
                onPressedChange={() => dispatch({ type: "toggle-source", who, source })}
              >
                {source}
              </ChoiceChip>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-1.5">
          <label
            htmlFor={`assess-other-${who}`}
            className="px-1 text-sm font-semibold text-[color:var(--text-heading)]"
          >
            Other (please specify)
          </label>
          <input
            id={`assess-other-${who}`}
            type="text"
            value={f.other}
            placeholder="For example, ward pharmacist"
            onChange={(event) => dispatch({ type: "set-other", who, value: event.target.value })}
            className={fieldControlPlain}
          />
        </div>
        <SectionLabel>{sup ? `${DOC.first}'s evidence this term` : "Your evidence this term"}</SectionLabel>
        <List>
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
            s.share.log ? (
              <Row
                icon={BookOpen}
                title="3 teaching sessions, 1 course"
                subtitle="Shared by Sam from Teaching › Logbook"
              />
            ) : null
          ) : (
            <Row
              icon={BookOpen}
              title="3 teaching sessions, 1 course"
              subtitle="From Teaching › Logbook. You choose whether to share it."
            />
          )}
          <Row icon={FileText} title="Mid-term report" subtitle="Fri 2 Oct · goals set then" />
        </List>
        <button
          type="button"
          onClick={() => dispatch({ type: "form-example", who })}
          className={cn(
            focusRing,
            "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border-2 border-dashed border-[color:var(--border-strong)] px-4 py-2 text-sm-minus font-semibold text-[color:var(--text-muted)]",
          )}
        >
          <Copy aria-hidden="true" className="size-icon-sm" />
          Fill with example answers (made-up records only)
        </button>
      </>
    );
  } else if (step.startsWith("d")) {
    const k = Number(step.slice(1)) as DomainNumber;
    const d = domainInfo(k);
    const r = f.ratings[k];
    const low = r !== null && r <= 2;
    body = (
      <>
        {blind}
        <StepHeading eyebrow={`Domain ${k} of 4`} title={d.title} detail={d.subtitle} />
        <SectionLabel
          end={
            <span className="flex gap-3">
              {sup ? (
                <TextLink onClick={() => dispatch({ type: "tick-all", who, domain: k })}>Tick all</TextLink>
              ) : null}
              <TextLink onClick={() => dispatch({ type: "toggle-wording", who })}>
                {f.fullWording ? "Short wording" : "Full wording"}
              </TextLink>
            </span>
          }
        >
          {sup ? "Outcomes you observed" : "Outcomes you've shown"}
        </SectionLabel>
        <ul role="list" aria-label={`Domain ${k} outcomes`} className="grid">
          {d.outcomes.map((o) => (
            <OutcomeTick
              key={o.id}
              checked={f.ticks[k].includes(o.id)}
              onToggle={() => dispatch({ type: "toggle-tick", who, domain: k, outcome: o.id })}
              title={`${o.id} ${o.name}`}
              detail={f.fullWording ? o.detail : undefined}
            />
          ))}
        </ul>
        <p className="px-1 text-xs text-[color:var(--text-muted)]">
          {f.ticks[k].length} of {d.outcomes.length} ticked.{" "}
          {sup
            ? "Not seen directly? Use other evidence, or leave it unticked (not applicable)."
            : "Tick the ones you could give an example of."}
        </p>
        <fieldset className="grid gap-2">
          <legend className={cn(labelText, "mb-2 px-1")}>
            {sup ? "Overall rating for this domain" : "How would you rate yourself?"}
          </legend>
          {RATING_LABELS.map((label, i) => (
            <OptionRow
              key={label}
              name={`rating-${who}-${k}`}
              number={i + 1}
              title={label}
              low={sup && i < 2}
              checked={r === i + 1}
              onSelect={() => dispatch({ type: "set-rating", who, domain: k, rating: (i + 1) as Rating })}
            />
          ))}
        </fieldset>
        {low && sup ? (
          <Inset tone="bad" title="A 1 or 2 means an improvement plan is needed">
            Say which outcomes weren&apos;t met below. Before you finish, you&apos;ll be asked to notify the MEU.
          </Inset>
        ) : null}
        {low && !sup ? (
          <Inset tone="plain" title="Worth raising at your meeting">
            Self-ratings aren&apos;t part of the official record.
          </Inset>
        ) : null}
        <NoteField
          id={`assess-fb-${who}-${k}`}
          label={`${sup ? "Feedback on this domain" : "Your notes"}${low && sup ? " (required)" : ""}`}
          value={f.feedback[k]}
          onChange={(value) => dispatch({ type: "set-feedback", who, domain: k, value })}
          placeholder={
            low && sup
              ? "Which outcomes were inconsistently or rarely met? Describe skills, not patients."
              : sup
                ? "What did you see? Describe skills, not patients."
                : "Kinds of situations you could talk about, not patient details"
          }
        />
      </>
    );
  } else if (step === "global") {
    body = (
      <>
        {blind}
        <StepHeading
          eyebrow="Overall"
          title={sup ? "Global rating for the term" : "How do you think the term went?"}
          detail={
            sup
              ? "Progress towards completing PGY1: working safely, taking more responsibility, and using and learning knowledge and skills."
              : `Optional. ${SUP}'s rating is the one that counts. Tap again to clear.`
          }
        />
        <fieldset className="grid gap-2">
          <legend className="sr-only">Global rating</legend>
          {GLOBAL_RATINGS.map((g) => (
            <OptionRow
              key={g.id}
              name={`global-${who}`}
              title={g.title}
              detail={g.detail}
              checked={f.global === g.id}
              onSelect={() => dispatch({ type: "set-global", who, rating: g.id })}
            />
          ))}
        </fieldset>
        {sup && (f.global === "cond" || f.global === "unsat") ? (
          <Inset tone="bad" title="This needs the DCT involved">
            Before you finish, you&apos;ll be asked to notify the MEU so an improvement plan can start.
          </Inset>
        ) : null}
        {sup ? (
          <Inset tone="plain" title="Existing improvement plans">
            None is open for {DOC.first}. If one were, you&apos;d review it here.
          </Inset>
        ) : null}
      </>
    );
  } else if (step === "summary") {
    body = (
      <>
        {blind}
        <StepHeading
          eyebrow="In your words"
          title={sup ? "Strengths and areas for improvement" : "Strengths and what to work on"}
        />
        <NoteField
          id={`assess-strengths-${who}`}
          label="Strengths"
          value={f.strengths}
          onChange={(value) => dispatch({ type: "set-text", who, field: "strengths", value })}
          placeholder={
            sup ? "What should they keep doing? Skills, not patients." : "What went well? Skills, not patients."
          }
        />
        <NoteField
          id={`assess-areas-${who}`}
          label="Areas for improvement"
          value={f.areas}
          onChange={(value) => dispatch({ type: "set-text", who, field: "areas", value })}
          placeholder={sup ? "One or two specific things for next term" : "What do you want more experience in?"}
        />
      </>
    );
  } else {
    const lows = lowDomains(f);
    const reasons = formBlockers(f, who);
    const ok = reasons.length === 0;
    const first = sup ? !supReady(s) : !selfDone(s);
    const whyId = `assess-why-${who}`;
    body = (
      <>
        {blind}
        {locked ? (
          <Inset
            tone="plain"
            icon={Lock}
            title={sup ? "Signed, so it can't be changed here" : `${SUP} has seen this, so it can't be changed now`}
          >
            {sup
              ? "To correct it, add a dated amendment through the MEU."
              : "You can still raise anything at your meeting."}
          </Inset>
        ) : null}
        <StepHeading
          eyebrow={locked ? "Your answers" : "Check and finish"}
          title={sup ? `${DOC.first}'s end-of-term assessment` : "Your self-assessment"}
        />
        <List label="Your answers">
          {DOMAINS.map((d) => {
            const rating = f.ratings[d.n];
            const words = `${f.ticks[d.n].length} of ${d.outcomes.length} outcomes · ${rating ? RATING_LABELS[rating - 1] : "not rated"}`;
            const score = (
              <b
                className={cn(
                  "text-lg font-normal tabular-nums",
                  rating
                    ? sup && rating <= 2
                      ? "text-[color:var(--danger-text)]"
                      : "text-[color:var(--text-heading)]"
                    : "text-[color:var(--text-muted)]",
                )}
              >
                {rating ?? "–"}
              </b>
            );
            return locked ? (
              <Row key={d.n} title={`${d.n} · ${d.title}`} subtitle={words} end={score} />
            ) : (
              <Row key={d.n} title={`${d.n} · ${d.title}`} subtitle={words} end={score} onClick={() => setStep(d.n)} />
            );
          })}
          {locked ? (
            <Row title="Overall" subtitle={f.global ? globalRatingName(f.global) : sup ? "Not chosen" : "Skipped"} />
          ) : (
            <Row
              title="Overall"
              subtitle={f.global ? globalRatingName(f.global) : sup ? "Not chosen" : "Skipped"}
              onClick={() => setStep(5)}
            />
          )}
        </List>
        {sup && lows.length && f.global === "sat" ? (
          <Inset tone="warm" title="Check this is what you mean">
            Domain {lows.join(", ")} is rated 1 or 2, but the overall rating is Satisfactory.
          </Inset>
        ) : null}
        {sup && needsImprovementPlan(f) && !locked ? (
          <ul role="list" className="grid">
            <OutcomeTick
              checked={f.ipap}
              onToggle={() => dispatch({ type: "toggle-ipap", who })}
              title={`Notify the MEU now, so they can start an improvement plan (IPAP) with ${DOC.first}.`}
            />
          </ul>
        ) : null}
        {formMentionsPatient(f) ? (
          <Inset tone="warm" title="Check for patient details">
            Something you wrote may be a name, URN, date or bed number. Please check before you finish.
          </Inset>
        ) : null}
        {locked ? null : (
          <>
            <Card className="bg-[color:var(--surface-subtle)]">
              <p className={secondaryText}>
                {sup
                  ? first
                    ? `When you finish your draft, you'll see ${DOC.first}'s self-assessment beside yours. You can still change your answers until you sign. Changes after that point are shown to ${DOC.first}.`
                    : `Changes are shown to ${DOC.first}. You sign after the meeting.`
                  : first
                    ? `Next, ask ${SUP} to complete the form. She won't see your ratings until she has finished her draft.`
                    : "Your changes are kept on this page."}
              </p>
            </Card>
            <Button
              variant="primary"
              block
              icon={sup ? Eye : Check}
              disabled={!ok}
              aria-describedby={ok ? undefined : whyId}
              onClick={() => {
                dispatch({ type: "form-finish", who });
                go(sup ? viewHref("side", { as: "supervisor" }) : viewHref("hub"));
              }}
            >
              {sup
                ? first
                  ? `Finish draft and see ${DOC.first}'s view`
                  : "Save changes"
                : first
                  ? "Save self-assessment"
                  : "Save changes"}
            </Button>
            {ok ? null : <WhyNot id={whyId}>{reasons.join(" ")}</WhyNot>}
          </>
        )}
      </>
    );
  }

  return (
    <>
      <ScreenHeader
        back={back}
        backLabel={sup ? "your requests" : "End-of-term"}
        title={sup ? `${DOC.first}'s end-of-term` : "Rate yourself"}
        subtitle={locked ? "View only" : `Step ${n} of ${FORM_STEPS.length}`}
        end={
          locked ? null : (
            <TextLink
              onClick={() => {
                dispatch({ type: "form-save-exit", who });
                go(back);
              }}
            >
              Save
            </TextLink>
          )
        }
      />
      {locked ? null : (
        <div
          role="progressbar"
          aria-label="Form progress"
          aria-valuemin={1}
          aria-valuemax={FORM_STEPS.length}
          aria-valuenow={n}
          aria-valuetext={`Step ${n} of ${FORM_STEPS.length}`}
          data-mode-identity="teaching"
          className="h-1 overflow-hidden rounded-full bg-[color:var(--border)]"
        >
          <i
            className="block h-full bg-[color:var(--mode-identity)] forced-colors:bg-[CanvasText]"
            style={{ width: `${(n / FORM_STEPS.length) * 100}%` }}
          />
        </div>
      )}
      {body}
      {stepIndex < LAST_FORM_STEP ? (
        <div className="sticky bottom-0 z-[var(--z-raised)] -mx-3 flex gap-2 border-t border-[color:var(--border)] bg-[color:var(--background)] px-3 py-2">
          {stepIndex > 0 ? (
            <Button icon={ChevronLeft} variant="secondary" onClick={() => setStep(stepIndex - 1)}>
              <span className="sr-only">Previous step</span>
            </Button>
          ) : null}
          <Button variant="primary" block trailingIcon={ChevronRight} onClick={() => setStep(stepIndex + 1)}>
            {stepIndex === 0 ? "Start" : "Next"}
          </Button>
        </div>
      ) : null}
    </>
  );
}
