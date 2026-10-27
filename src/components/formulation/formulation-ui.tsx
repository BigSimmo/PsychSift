import type { ReactNode } from "react";
import { Info, Network, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";

import { cardSurface } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { cn, eyebrowText } from "@/components/ui-primitives";
import type { FormulationEvidenceRef } from "@/lib/formulation-concepts";
import type { FormulationReviewState } from "@/lib/formulation-review-status";

/** Was byte-identical to `specifierCard`; both now name the shared recipe. */
export const formulationCard = cardSurface;

export function FormulationPageShell({ children, className }: { children: ReactNode; className?: string }) {
  return <InformationPageShell className={className}>{children}</InformationPageShell>;
}

export function MechanismDomainChips({ values, limit }: { values: string[]; limit?: number }) {
  const visible = typeof limit === "number" ? values.slice(0, limit) : values;
  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((value) => (
        <span
          key={value}
          className="inline-flex min-h-7 items-center rounded-md border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-2 text-xs font-bold text-[color:var(--clinical-accent)]"
        >
          {value}
        </span>
      ))}
      {typeof limit === "number" && values.length > limit ? (
        <span className="inline-flex min-h-7 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-2 text-xs font-semibold text-[color:var(--text-muted)]">
          +{values.length - limit}
        </span>
      ) : null}
    </div>
  );
}

export function MechanismBadge({ label = "Formulation mechanism" }: { label?: string }) {
  return (
    <span className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-2 text-xs font-bold text-[color:var(--text-muted)]">
      <Network className="h-3.5 w-3.5 text-[color:var(--clinical-accent)]" aria-hidden />
      {label}
    </span>
  );
}

/**
 * The record's own review state, beside its title.
 *
 * Sits in the header badge row so it is read before the clinical content, not
 * after it. The unreviewed case is the loud one by design: a record nobody has
 * signed off must not look like a record somebody has.
 */
export function RecordReviewBadge({ state }: { state: FormulationReviewState }) {
  const Icon = state.reviewed ? ShieldCheck : ShieldAlert;
  return (
    <span
      data-testid="formulation-review-badge"
      data-reviewed={state.reviewed ? "true" : "false"}
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-bold",
        state.reviewed
          ? "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text-muted)]"
          : "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {state.label}
    </span>
  );
}

/**
 * The same review state in full, for the body of the record.
 *
 * The badge says what the state is; this says what it means for the reader and
 * what the record itself recorded about its sources.
 */
export function RecordReviewNote({ state }: { state: FormulationReviewState }) {
  return (
    <aside
      aria-label="Review note"
      data-testid="formulation-review-note"
      data-reviewed={state.reviewed ? "true" : "false"}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border p-4 text-sm leading-5",
        state.reviewed
          ? "border-[color:var(--border)] bg-[color:var(--surface-inset)] text-[color:var(--text-muted)]"
          : "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--text-muted)]",
      )}
    >
      {state.reviewed ? (
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
      ) : (
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--warning)]" aria-hidden />
      )}
      <p>
        <span className="font-bold text-[color:var(--text-heading)]">{state.label}.</span> {state.detail}
      </p>
    </aside>
  );
}

export function FormulationSafetyNote({
  compact = false,
  id,
  className,
}: {
  compact?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <aside
      id={id}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-[color:var(--info-border)] bg-[color:var(--info-soft)] text-sm leading-5 text-[color:var(--text-muted)]",
        compact ? "px-3 py-2.5" : "p-4",
        className,
      )}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--info)]" aria-hidden />
      <p>
        Treat each mechanism as a hypothesis, not a diagnosis. Check the person’s context, culture, development, mental
        state, risk, and alternative explanations, then revise the formulation when new evidence does not fit.
      </p>
    </aside>
  );
}

export function SessionPrivacyNote() {
  return (
    <div className="flex items-start gap-2 text-xs font-medium leading-5 text-[color:var(--text-muted)]">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
      <p>Keep notes de-identified. Builder text remains in this browser session unless you copy it.</p>
    </div>
  );
}

export { SectionHeading } from "@/components/ui/section-heading";

export function MechanismCaveats({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <section
      aria-labelledby="formulation-caveats-label"
      className={cn(
        formulationCard,
        "grid gap-2.5 border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-4 sm:p-5",
      )}
    >
      <div className="flex items-center gap-2 text-[color:var(--warning)]">
        <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
        <p id="formulation-caveats-label" className={eyebrowText}>
          Caveats for this record
        </p>
      </div>
      <ul className="grid gap-1.5 text-sm font-medium leading-6 text-[color:var(--text-muted)]">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--warning)]" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Citations rendered where the claim is made.
 *
 * A reference whose host `source-url-policy.ts` does not govern keeps its
 * identity, its issuer and its DOI or PMID and loses only the outbound link.
 * Saying so is the point: a clinician can still find the work, and nobody is
 * told the repository has admitted a location it has not.
 */
export function EvidenceList({
  evidence,
  label = "Evidence",
  reviewed = false,
}: {
  evidence: FormulationEvidenceRef[];
  label?: string;
  /** The record is signed off by a named clinician, so its claims are no longer unapproved. */
  reviewed?: boolean;
}) {
  if (!evidence.length) return null;
  return (
    <div className="grid gap-3">
      {evidence.map((entry) => (
        <article
          key={`${entry.sourceId}-${entry.label}`}
          id={`evidence-${entry.label}`}
          className="grid scroll-mt-24 gap-1"
        >
          <p className="text-xs font-bold leading-5 text-[color:var(--text-heading)]">
            <span className="mr-1.5 inline-flex min-w-8 justify-center rounded bg-[color:var(--surface-subtle)] px-1.5 py-0.5 font-extrabold text-[color:var(--clinical-accent)]">
              {entry.label}
            </span>
            {entry.admission !== "held" && entry.url ? (
              <a
                href={entry.url}
                target="_blank"
                rel="noreferrer"
                className="text-[color:var(--clinical-accent)] hover:underline"
              >
                {entry.title}
              </a>
            ) : (
              entry.title
            )}
          </p>
          <p className="text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
            {[entry.issuer, entry.identifier, entry.locator].filter(Boolean).join(" · ")}
          </p>
          {entry.limitations.map((limitation) => (
            <p key={limitation} className="text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
              {limitation}
            </p>
          ))}
          {entry.admission === "held" ? (
            <p className="text-2xs font-medium leading-4 text-[color:var(--warning)]">
              Link withheld: this source remains held and is cited as metadata only.
            </p>
          ) : entry.urlStatus === "host_not_governed" ? (
            <p className="text-2xs font-medium leading-4 text-[color:var(--warning)]">
              Link withheld: this publisher&rsquo;s host is not on the governed source list.
            </p>
          ) : null}
        </article>
      ))}
      <p className="text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
        {reviewed
          ? `${label} references only. Each source's own limitations still apply.`
          : `${label} references only. Source metadata is reviewed; the clinical claim is not independently approved.`}
      </p>
    </div>
  );
}
