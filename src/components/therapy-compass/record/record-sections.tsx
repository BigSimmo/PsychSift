import {
  ArrowUpRight,
  Clock,
  FileText,
  MapPin,
  ShieldCheck,
  Target,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cardSurface } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";

import { extractCitations, ProseBlock } from "../prose";
import { parseSteps, splitIndications } from "../data/select";
import type { Therapy } from "../data/types";

function RecordSection({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="flex gap-3 border-b border-[color:var(--border)] px-4 py-4 last:border-b-0 sm:px-5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="mb-1 text-sm font-semibold text-[color:var(--text-heading)]">{title}</h2>
        {children}
      </div>
    </section>
  );
}

function TextSection({ icon, title, body }: { icon: LucideIcon; title: string; body: string | null }) {
  const text = body?.trim();
  if (!text) return null;
  return (
    <RecordSection icon={icon} title={title}>
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
  if (!steps.length) return <TextSection icon={FileText} title="How to deliver it" body={therapy.deliverySteps} />;

  return (
    <RecordSection icon={FileText} title="How to deliver it">
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
 *
 * Rendered by the detail screen directly under the key-fact tiles, not at the foot of
 * the body, and never clamped: it is a safety cue and reads in full without a tap.
 */
export function TherapySafetySection({ therapy }: { therapy: Therapy }) {
  const cautions = therapy.contraindicationsOrCautions?.trim() ?? "";
  const limitations = therapy.limitations?.trim() ?? "";
  const text = limitations && !cautions.includes(limitations) ? `${cautions} ${limitations}`.trim() : cautions;
  const warnings = therapy.warnings.filter(Boolean);
  if (!text && !warnings.length) return null;

  return (
    <section className="flex gap-3 rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] px-4 py-4 sm:px-5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--surface)] text-[color:var(--warning-text)]">
        <TriangleAlert className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="mb-1 text-sm font-semibold text-[color:var(--warning-text)]">Safety &amp; cautions</h2>
        {text ? <ProseBlock text={text} label="Safety and cautions" tone="warning" clamp={false} /> : null}
        {warnings.length ? (
          <ul className="m-0 mt-2.5 list-disc space-y-1 pl-5 text-xs leading-relaxed text-[color:var(--warning-text)]">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
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
 */
export function TherapyRecordSections({ therapy }: { therapy: Therapy }) {
  const goals = splitIndications(therapy);

  return (
    <div className="space-y-3">
      <div className={cn(cardSurface, "overflow-hidden")}>
        <TextSection icon={ShieldCheck} title="Use when" body={therapy.bestUsedFor} />
        <TextSection icon={Target} title="What it targets" body={therapy.targetSymptoms} />
        <TextSection icon={Target} title="Treatment goals" body={goals} />
        <TextSection icon={Target} title="How it works" body={therapy.mechanism} />
        <DeliverySection therapy={therapy} />
        {/* `timeRequired` is prose about session counts, protocol length and
            intensity. The Format tile opens it in a sheet; the reading column
            still carries the full field. */}
        <TextSection icon={Clock} title="Time and intensity" body={therapy.timeRequired} />
        {/* The key-facts tile glances this as `{first} +N` and opens the full
            list in a sheet. Several records list four or five settings, so the
            reading column still carries the complete field. */}
        <TextSection icon={MapPin} title="Where it is delivered" body={therapy.setting} />
        <TextSection icon={Users} title="Who it suits" body={therapy.patientPopulation} />
        <TextSection icon={TriangleAlert} title="Common pitfalls" body={therapy.commonPitfalls} />
        <TextSection icon={ArrowUpRight} title="Stepping up or switching" body={therapy.homework} />
      </div>
    </div>
  );
}
