import type { ReactNode } from "react";

import { RecordCautions, RecordSection as SharedRecordSection } from "@/components/clinical-record-panels";

import { extractCitations, ProseBlock } from "../prose";
import { parseSteps, splitIndications } from "../data/select";
import type { Therapy } from "../data/types";
import { therapyKeyFactCards } from "./key-fact-cards";

/** One body section in the shared record style: a plain heading, the content below. */
function RecordSection({ title, children }: { title: string; children: ReactNode }) {
  return <SharedRecordSection title={title}>{children}</SharedRecordSection>;
}

function TextSection({ title, body }: { title: string; body: string | null }) {
  const text = body?.trim();
  if (!text) return null;
  return (
    <RecordSection title={title}>
      <ProseBlock text={text} label={title} />
    </RecordSection>
  );
}

/**
 * Delivery steps as an ordered list.
 *
 * `parseSteps` already knows the three shapes the catalogue writes these in
 * (numbered inline, newline-delimited, or one run of sentences); this only has
 * to render them, and lift the citation markers out of each step so a six-step
 * list does not repeat "(PubMed)" six times mid-line.
 */
function DeliverySection({ therapy }: { therapy: Therapy }) {
  const steps = parseSteps(therapy.deliverySteps);
  if (!steps.length) return <TextSection title="How to deliver it" body={therapy.deliverySteps} />;

  return (
    <RecordSection title="How to deliver it">
      <ol className="m-0 max-w-[68ch] list-none space-y-2 p-0">
        {steps.map((step, index) => {
          const { text, citations } = extractCitations(step);
          return (
            <li key={index} className="flex gap-2.5 text-sm-minus leading-relaxed text-[color:var(--text-muted)]">
              <span className="nums mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-3xs font-bold text-[color:var(--text-heading)]">
                {index + 1}
              </span>
              <span className="min-w-0">
                {text}
                {citations.length ? (
                  <span className="ml-1.5 text-3xs font-semibold text-[color:var(--clinical-accent)]">
                    {citations.join(" · ")}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </RecordSection>
  );
}

/**
 * Cautions, poor fit and limitations, in the one place a reader looks for them.
 *
 * `limitations` frequently repeats the tail of `contraindicationsOrCautions`;
 * it is appended only when it adds something new, so the block does not echo
 * itself. `alternatives` is deliberately not rendered: it is byte-identical to
 * `limitations` in every record in the catalogue.
 */
export function TherapySafetySection({ therapy }: { therapy: Therapy }) {
  const cautions = therapy.contraindicationsOrCautions?.trim() ?? "";
  const limitations = therapy.limitations?.trim() ?? "";
  const text = limitations && !cautions.includes(limitations) ? `${cautions} ${limitations}`.trim() : cautions;
  const warnings = therapy.warnings.filter(Boolean);
  if (!text && !warnings.length) return null;

  // Directly after At a glance and never clamped: safety text is read in full.
  return (
    <RecordCautions title="Safety & cautions" testId="therapy-safety-cautions">
      {text ? <ProseBlock text={text} label="Safety and cautions" tone="warning" clamp={false} /> : null}
      {warnings.length ? (
        <ul className="m-0 mt-2.5 list-disc space-y-1 pl-5 text-xs leading-relaxed text-[color:var(--warning-text)]">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </RecordCautions>
  );
}

/**
 * The record body.
 *
 * The old "When to use" block is gone, and its replacement is the reason this
 * file exists: the catalogue builds `indications` by concatenating
 * `bestUsedFor`, `targetSymptoms` and the treatment goals, so rendering it
 * whole repeated two sections the reader had just read. `splitIndications`
 * returns only the residue, which is the goals — the part that was never shown
 * on its own.
 *
 * `homework` is titled "Stepping up or switching" because that is what the
 * field actually holds in every record; the field name is an import artefact.
 *
 * A section whose text is exactly the value the At a glance card already shows
 * in full (Format, Setting, Suits) is not printed a second time.
 */
export function TherapyRecordSections({ therapy }: { therapy: Therapy }) {
  const goals = splitIndications(therapy);
  const glanced = new Set(
    therapyKeyFactCards(therapy)
      .filter((card) => card.id !== "cautions")
      .map((card) => card.body.trim()),
  );
  const unlessGlanced = (body: string | null | undefined) => {
    const text = body?.trim() ?? "";
    return text && glanced.has(text) ? null : (body ?? null);
  };

  return (
    <div className="flex flex-col gap-7">
      <TextSection title="Use when" body={therapy.bestUsedFor} />
      <TextSection title="What it targets" body={therapy.targetSymptoms} />
      <TextSection title="Treatment goals" body={goals} />
      <TextSection title="How it works" body={therapy.mechanism} />
      <DeliverySection therapy={therapy} />
      <TextSection title="Time and intensity" body={unlessGlanced(therapy.timeRequired)} />
      <TextSection title="Where it is delivered" body={unlessGlanced(therapy.setting)} />
      <TextSection title="Who it suits" body={unlessGlanced(therapy.patientPopulation)} />
      <TextSection title="Common pitfalls" body={therapy.commonPitfalls} />
      <TextSection title="Stepping up or switching" body={therapy.homework} />
    </div>
  );
}
