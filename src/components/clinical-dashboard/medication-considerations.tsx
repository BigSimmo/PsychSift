"use client";

import {
  Ban,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Info,
  Pill,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import {
  BadgeCluster,
  ClinicalBadge,
  clinicalBadgeToneClass,
  type ClinicalBadgeItem,
} from "@/components/clinical-dashboard/clinical-badge";
import { usePatientProfile } from "@/components/clinical-dashboard/patient-profile-context";
import {
  evaluateMedicationInteractions,
  interactionNoteBody,
  interactionReviewInput,
  medicationDisplayName,
  severityLabel,
  type MedicationInteraction,
  type MedicationVerdict,
} from "@/lib/medication-interactions";
import {
  evaluatePatientAlerts,
  noticeToneForSemanticTone,
  type MedicationConsideration,
} from "@/lib/medication-patient-alerts";
import type { MedicationRecord } from "@/lib/medications";
import type { SemanticTone } from "@/lib/semantic-tone";
import { ContentReviewNotice } from "@/components/content-review/content-review-notice";
import { Disclosure } from "@/components/ui/disclosure";
import { cn, InlineNotice } from "@/components/ui-primitives";

/** "A", "A and B", "A, B and C" — the drug names read as prose, not as an array. */
function formatMedicationList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Verdict edge for the DESKTOP results table rows, which sit in a divided list
 * and already own their edge with an inset `ring-*` for selection.
 *
 * The phone cards do not use this. Their edge is set in `globals.css` via
 * `.medication-mobile-result[data-verdict="…"]`, because the existing
 * `[data-selected="true"]` rule there is unlayered and pins `border-color` —
 * a Tailwind border utility loses to it on exactly the top hit. Two mechanisms,
 * one per surface, each matching what that surface already used.
 */
export function medicationVerdictRingClass(tone: SemanticTone): string | null {
  const byTone: Record<SemanticTone, string | null> = {
    danger: "ring-1 ring-inset ring-[color:var(--danger-border)]",
    warning: "ring-1 ring-inset ring-[color:var(--warning-border)]",
    success: "ring-1 ring-inset ring-[color:var(--success-border)]",
    clinical: "ring-1 ring-inset ring-[color:var(--clinical-accent)]/40",
    info: "ring-1 ring-inset ring-[color:var(--info-border)]",
    // Neutral keeps the list's own divider as its edge — see the border variant.
    neutral: null,
  };
  return byTone[tone];
}

/**
 * Glyph for a verdict badge — one per state, including the two that the shared
 * badge default deliberately leaves icon-free.
 *
 * `ClinicalBadge` only auto-ices danger and warning, to keep ordinary metadata
 * badges quiet. That default is right in general and wrong here: this badge is
 * the card's safety verdict, so "checked, nothing found" and "could not check"
 * have to be distinguishable from each other — and from the two alert states —
 * without relying on the border colour. Overridden for this badge only, by
 * passing an explicit icon rather than by changing the shared default.
 */
export const VERDICT_ICONS: Record<SemanticTone, LucideIcon> = {
  danger: Ban,
  warning: TriangleAlert,
  success: ShieldCheck,
  neutral: CircleHelp,
  clinical: ClipboardList,
  info: Info,
};

export function verdictIcon(tone: SemanticTone): LucideIcon {
  return VERDICT_ICONS[tone];
}

/**
 * One badge summarising the composed verdict for a result row.
 *
 * Never returns null once a profile exists: "no interaction found" and "needs
 * manual review" are findings the clinician should see stated, not absences to
 * be inferred from a missing badge.
 */
export function verdictSummaryBadge(verdict: MedicationVerdict): ClinicalBadgeItem {
  const findings = verdict.interactionCount + verdict.considerationCount;
  if (findings > 0) {
    const parts: string[] = [];
    if (verdict.interactionCount > 0) {
      parts.push(`${verdict.interactionCount} interaction${verdict.interactionCount === 1 ? "" : "s"}`);
    }
    if (verdict.considerationCount > 0) {
      parts.push(`${verdict.considerationCount} alert${verdict.considerationCount === 1 ? "" : "s"}`);
    }
    if (verdict.incomplete) parts.push("Needs manual review");
    return {
      id: "patient-verdict",
      label: parts.join(" · "),
      tone: verdict.tone,
      icon: verdictIcon(verdict.tone),
    };
  }
  if (verdict.incomplete) {
    return {
      id: "patient-verdict",
      label: "Needs manual review",
      tone: "neutral",
      icon: verdictIcon("neutral"),
    };
  }
  return {
    id: "patient-verdict",
    label: "No interaction found",
    tone: "success",
    icon: verdictIcon("success"),
  };
}

const PATIENT_VERDICT_COPY: Record<SemanticTone, { label: string; context: string }> = {
  danger: { label: "Danger", context: "For this patient" },
  warning: { label: "Caution", context: "For this patient" },
  neutral: { label: "Manual review", context: "Patient check incomplete" },
  success: { label: "No alert found", context: "From entered details" },
  clinical: { label: "Clinical action", context: "For this patient" },
  info: { label: "Patient information", context: "Review for this patient" },
};

/**
 * Dedicated patient-specific verdict band for search results.
 *
 * Match quality and catalogue metadata remain ordinary badges. This band owns
 * the safety hierarchy, states the severity in words, and keeps the result
 * scoped to the entered patient details so colour is never the only signal and
 * a non-firing check is never presented as a general guarantee.
 */
export function PatientVerdictSignal({ verdict, className }: { verdict: MedicationVerdict; className?: string }) {
  const summary = verdictSummaryBadge(verdict);
  const copy = PATIENT_VERDICT_COPY[verdict.tone];
  // Indexing the stable map keeps the rendered component static for React lint.
  const Icon = VERDICT_ICONS[verdict.tone];

  return (
    <div
      role="group"
      aria-label={`${copy.label}. ${copy.context}. ${summary.label}.`}
      data-patient-verdict-signal="true"
      data-tone={verdict.tone}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md border border-l-[3px] px-2 py-1.5 shadow-[var(--shadow-inset)]",
        clinicalBadgeToneClass(verdict.tone),
        className,
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 leading-tight">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="text-2xs font-extrabold uppercase tracking-eyebrow">{copy.label}</span>
          <span className="text-2xs font-semibold opacity-80">{copy.context}</span>
        </span>
        <span className="mt-0.5 block break-words text-xs font-semibold">{summary.label}</span>
      </span>
    </div>
  );
}

/**
 * "Open <counterparty>" — the other half of the interaction is a medication in
 * this catalogue, and reading its own page is the obvious next step from an
 * alert. Rendered as a `<Link>` per the repo's internal-navigation rule.
 */
function CounterpartyLink({ interaction }: { interaction: MedicationInteraction }) {
  // The 48px tap box keeps its size; -my-3 lets it reach into the card's p-3 padding so
  // the 12px label does not leave a blank band above and below it.
  return (
    <Link
      href={`/medications/${interaction.counterpartySlug}`}
      data-testid={`patient-interaction-link-${interaction.counterpartySlug}`}
      className="-my-3 inline-flex min-h-tap items-center gap-1 text-xs font-semibold text-[color:var(--clinical-accent)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
    >
      Open {interaction.counterpartyName}
      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

/**
 * Top-of-page callout on a medication record: the interactions this drug has
 * with the patient's entered medications, named and linked.
 *
 * The full block lives inside the patient sheet, which the reader has to open.
 * That is the wrong place for a finding this consequential — arriving at
 * sertraline from a result row flagged "2 interactions" should not require
 * hunting for them. So the headline findings are stated on the page itself, each
 * linking to the counterparty's own record, with a link through to the full
 * Key Interactions section for the catalogue's own wording.
 *
 * Shows the three highest-severity interactions; `interactions` is already
 * priority-sorted by `evaluateMedicationInteractions`.
 *
 * COMPACT BY DEFAULT. Always-expanded, this took ~180px above the fold on a
 * phone and pushed the drug's own content down for prose the reader had not
 * asked for yet. It is now a `Disclosure`, whose trigger still carries
 * everything needed to triage — the severity glyph, the count, the interacting
 * drug names, and the worst severity token. Only the verbatim wording and the
 * two actions sit behind the tap, so nothing safety-bearing is hidden; the
 * detail is.
 *
 * `Disclosure` is the adopted primitive for this, which is why there is no new
 * CSS class here: it already gives a real button carrying both `aria-expanded`
 * and `aria-controls`, a `min-h-tap` trigger, and `print:block` on the panel so
 * a collapsed interaction still prints — the one case where "hidden until
 * tapped" would otherwise become "silently absent" on paper.
 */
export function MedicationInteractionCallout({
  record,
  onOpenPatientDetails,
  onOpenInteractionsSection,
  className,
}: {
  record: MedicationRecord;
  onOpenPatientDetails: () => void;
  /** Switches the record page to the tab holding the Key Interactions section. */
  onOpenInteractionsSection: () => void;
  className?: string;
}) {
  const { profile } = usePatientProfile();
  const result = useMemo(
    () => evaluateMedicationInteractions(record.slug, profile.medications ?? [], record),
    [record, profile.medications],
  );

  if (result.interactions.length === 0) return null;

  const headline = result.interactions.slice(0, MAX_CALLOUT_INTERACTIONS);
  const remaining = result.interactions.length - headline.length;
  const tone = result.highestTone ?? "warning";
  // Indexed, not `verdictIcon(tone)` — a component produced by a call
  // expression during render trips `react-hooks/static-components`.
  const Icon = VERDICT_ICONS[tone];
  const count = result.interactions.length;
  // Every matched drug, not just the three the panel details — the trigger is
  // where the reader decides whether to open at all.
  const counterparties = result.interactions.map((interaction) => interaction.counterpartyName).join(" · ");

  return (
    <div data-testid="medication-interaction-callout" className={cn("min-w-0", className)}>
      <Disclosure
        headingLevel={2}
        title={
          <span className="inline-flex items-center gap-1.5">
            <Icon className="size-icon-sm shrink-0" aria-hidden="true" />
            {count} interaction{count === 1 ? "" : "s"} with this patient
          </span>
        }
        description={counterparties}
        meta={result.interactions[0]?.severity.toUpperCase()}
        // Border + soft fill only. The bundled toneDanger/toneWarning recipes
        // also set the text colour, which would put same-hue text on a same-hue
        // wash — the readability lesson recorded on the hero tiles (#659).
        // Disclosure's own title is already --text-heading; leave it there.
        className={cn(
          tone === "danger"
            ? "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]"
            : "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)]",
        )}
      >
        {/* One card per interaction, on the panel's own surface rather than the
            tinted wash behind it: body text on a same-hue fill is the
            readability trap (#659), and it is also what made these read as an
            undifferentiated block. */}
        <ul className="space-y-2">
          {headline.map((interaction) => (
            <li
              key={interaction.id}
              className="min-w-0 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-2.5"
              data-testid={`medication-callout-${interaction.counterpartySlug}`}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Link
                  href={`/medications/${interaction.counterpartySlug}`}
                  className="inline-flex min-h-tap items-center gap-1 text-sm-minus font-semibold text-[color:var(--text-heading)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                >
                  {interaction.counterpartyName}
                  <ChevronRight className="size-icon-sm text-[color:var(--decoration-soft)]" aria-hidden="true" />
                </Link>
                {/* Per-row severity: the trigger only reports the worst one, so a
                    HIGH sitting under a CRITICAL was otherwise unlabelled. */}
                <ClinicalBadge label={severityLabel(interaction.severity)} tone={interaction.tone} compact />
              </div>
              {/* Verbatim catalogue text, minus the redundant "CRITICAL — " that
                  the badge above already states. Unclamped: this is behind a tap,
                  so there is no space to reclaim by truncating a safety note. */}
              {interaction.note ? (
                <p className="mt-1 text-pretty text-xs leading-5 text-[color:var(--text)]">
                  {interactionNoteBody(interaction.note)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>

        {remaining > 0 ? (
          <p className="mt-1.5 text-2xs font-semibold text-[color:var(--text-muted)]">
            +{remaining} more with this patient&rsquo;s medications
          </p>
        ) : null}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenInteractionsSection}
            data-testid="medication-callout-open-section"
            className={calloutActionClass}
          >
            See Key Interactions
          </button>
          <button
            type="button"
            onClick={onOpenPatientDetails}
            data-testid="medication-callout-open-patient"
            className={calloutActionClass}
          >
            Patient details
          </button>
        </div>
      </Disclosure>
    </div>
  );
}

const MAX_CALLOUT_INTERACTIONS = 3;

const calloutActionClass =
  "inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 text-2xs font-semibold text-[color:var(--text-heading)] transition hover:border-[color:var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

function considerationBadges(consideration: MedicationConsideration): ClinicalBadgeItem[] {
  return [
    ...consideration.factorLabels.map((label, index) => ({
      id: `${consideration.id}-factor-${index}`,
      label,
      tone: consideration.tone,
    })),
    ...consideration.reasons.map((reason, index) => ({
      id: `${consideration.id}-reason-${index}`,
      label: reason,
      tone: "neutral" as const,
    })),
  ];
}

/**
 * Serial list for contraindication and advisory missing input lists: "eGFR",
 * "eGFR and QTc", "eGFR, QTc and hepatic status". The sentence continues into a
 * relative clause immediately after the list, so a bare comma join ("use eGFR,
 * QTc, which this profile does not include") reads as one run-on and hides where
 * the list ends. Formatted with serial "and" / Oxford conjunction.
 */
export function formatInputList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Detail-page block: evaluates the entered profile against a single medication
 * and renders the applicable considerations, an all-clear when none apply, and a
 * hint for any gate the profile did not supply — split into the contraindication
 * tier and the dosing/monitoring tier, which carry different consequences.
 *
 * The all-clear is conditional, exactly as the interactions block below is: an
 * empty list with an unread gate is "we could not check", not "we checked and
 * found nothing", so the notice drops to neutral and points at the gap. A green
 * banner with "Enter eGFR" underneath it is the failure this guards against.
 */
export function MedicationConsiderations({ record, className }: { record: MedicationRecord; className?: string }) {
  const { profile, isEmpty } = usePatientProfile();
  const result = useMemo(() => evaluatePatientAlerts(record, profile), [record, profile]);
  // Either tier is enough to disqualify the all-clear: both mean a criterion on
  // this medication was never evaluated.
  const hasUnassessedGates = result.unassessed.length > 0 || result.unassessedAdvisory.length > 0;

  return (
    <section aria-label="Patient considerations" className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden="true" />
        <h2 className="text-sm-minus font-semibold text-[color:var(--text-heading)]">
          Considerations for this patient
        </h2>
        {!isEmpty && result.considerations.length > 0 ? (
          <span className="rounded-full bg-[color:var(--surface-subtle)] px-2 py-0.5 text-2xs font-semibold text-[color:var(--text-muted)]">
            {result.considerations.length}
          </span>
        ) : null}
      </div>

      {isEmpty ? (
        <div className="rounded-lg border border-dashed border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-3 text-sm text-[color:var(--text-muted)]">
          Enter patient details above to surface dosing, safety, and contraindication considerations for this
          medication.
        </div>
      ) : result.considerations.length === 0 ? (
        <InlineNotice tone={hasUnassessedGates ? "neutral" : "success"}>
          {hasUnassessedGates ? (
            <>
              No considerations matched the details entered. Some checks could not be run — see below. Always confirm
              against source.
            </>
          ) : (
            <>No matching considerations for the entered patient profile. Always confirm against source.</>
          )}
        </InlineNotice>
      ) : (
        <div className="space-y-2">
          {result.considerations.map((consideration) => (
            <InlineNotice key={consideration.id} tone={noticeToneForSemanticTone(consideration.tone)}>
              <div className="min-w-0 space-y-1.5" data-testid={`patient-consideration-${consideration.id}`}>
                <BadgeCluster items={considerationBadges(consideration)} compact />
                {consideration.note ? (
                  <p className="text-xs leading-5 text-[color:var(--text-heading)]">{consideration.note}</p>
                ) : null}
              </div>
            </InlineNotice>
          ))}
        </div>
      )}

      {/* Two tiers, two sentences. The contraindication tier keeps the accented
          `info` treatment it already had; the advisory tier sits below it in
          neutral, so the visual order matches the clinical order without either
          gap being folded into the other — or into the all-clear above. */}
      {!isEmpty && result.unassessed.length > 0 ? (
        <InlineNotice tone="info">
          Not assessed. Contraindication checks for this medication use {formatInputList(result.unassessed)}, which this
          profile does not include. Enter {result.unassessed.length === 1 ? "it" : "them"}, or check the source, before
          treating this panel as complete.
        </InlineNotice>
      ) : null}

      {/* The closing clause states what is missing, never whether the entry
          applies. Gates are now collected from rows that FIRED as well, so an
          advisory row can be rendered above as a live alert while one of its
          other criteria is still unread — "enter it to see whether it applies"
          would then invite deferring an alert that already applies. What the
          system can stand behind is narrower and always true: the input is
          absent, and entering it completes the check. */}
      {!isEmpty && result.unassessedAdvisory.length > 0 ? (
        <InlineNotice tone="neutral">
          Not assessed. {result.unassessedAdvisoryCount} dosing and monitoring{" "}
          {result.unassessedAdvisoryCount === 1 ? "entry uses" : "entries use"}{" "}
          {formatInputList(result.unassessedAdvisory)}, which this profile does not include. Enter{" "}
          {result.unassessedAdvisory.length === 1 ? "it" : "them"} to complete{" "}
          {result.unassessedAdvisoryCount === 1 ? "that check" : "those checks"}.
        </InlineNotice>
      ) : null}

      <MedicationInteractionBlock record={record} />
    </section>
  );
}

/**
 * Interactions between this medication and the patient's current medication list.
 *
 * Three branches, mirroring the considerations block above — and a fourth that
 * only this surface has: when the catalogue carries interaction rows whose
 * counterparty could not be machine-resolved, that is stated plainly instead of
 * being folded into the all-clear. "We found nothing" and "we could not read
 * some of it" are different claims, and only the first is reassuring.
 */
function MedicationInteractionBlock({ record }: { record: MedicationRecord }) {
  const { profile } = usePatientProfile();
  const result = useMemo(
    () => evaluateMedicationInteractions(record.slug, profile.medications ?? [], record),
    [record, profile.medications],
  );

  const hasList = (profile.medications ?? []).length > 0;
  const medicationCount = profile.medications?.length ?? 0;

  return (
    <section aria-label="Interactions with current medications" className="space-y-2 pt-1">
      <div className="flex items-center gap-2">
        <Pill className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden="true" />
        <h3 className="text-sm-minus font-semibold text-[color:var(--text-heading)]">
          Interactions with this patient&rsquo;s medications
        </h3>
        {result.interactions.length > 0 ? (
          <span className="rounded-full bg-[color:var(--surface-subtle)] px-2 py-0.5 text-2xs font-semibold text-[color:var(--text-muted)]">
            {result.interactions.length}
          </span>
        ) : null}
      </div>

      {!hasList ? (
        <div className="rounded-lg border border-dashed border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-3 text-sm text-[color:var(--text-muted)]">
          {result.dataAvailable ? (
            <>
              Add the patient&rsquo;s current medications to cross-check them against this drug&rsquo;s{" "}
              {result.totalRowCount} catalogued interaction {result.totalRowCount === 1 ? "row" : "rows"}.
            </>
          ) : (
            <>This catalogue carries no interaction data for this medication, so there is nothing to cross-check.</>
          )}
        </div>
      ) : result.interactions.length === 0 ? (
        <InlineNotice
          tone={
            result.unresolvedRowCount > 0 ||
            result.unreachableCounterparties.length > 0 ||
            result.reverseUnresolvedCounterparties.length > 0
              ? "neutral"
              : "success"
          }
        >
          No interaction found between this medication and the {medicationCount}{" "}
          {medicationCount === 1 ? "medication" : "medications"} entered. Always confirm against source.
        </InlineNotice>
      ) : (
        <div className="space-y-2">
          {result.interactions.map((interaction) => (
            <InlineNotice key={interaction.id} tone={noticeToneForSemanticTone(interaction.tone)}>
              <div className="min-w-0 space-y-1.5" data-testid={`patient-interaction-${interaction.id}`}>
                <div className="flex max-w-full flex-wrap items-center gap-1.5">
                  <ClinicalBadge
                    label={`With ${interaction.counterpartyName}`}
                    tone={interaction.tone}
                    icon={verdictIcon(interaction.tone)}
                    compact
                  />
                  <BadgeCluster
                    items={[
                      { id: `${interaction.id}-severity`, label: severityLabel(interaction.severity), tone: "neutral" },
                      { id: `${interaction.id}-kind`, label: interaction.kind, tone: "neutral" },
                    ]}
                    compact
                  />
                </div>
                {/* Verbatim catalogue text — never a paraphrase. The leading
                    "CRITICAL — " is dropped only because the badges above already
                    state it; no sentence is removed or reworded. */}
                {interaction.note ? (
                  <p className="text-pretty text-xs leading-5 text-[color:var(--text-heading)]">
                    {interactionNoteBody(interaction.note)}
                  </p>
                ) : null}
                <ContentReviewNotice review={interactionReviewInput(interaction)} hideStates={["unknown"]} />
                <CounterpartyLink interaction={interaction} />
              </div>
            </InlineNotice>
          ))}
        </div>
      )}

      {/* Three distinct reasons this medication cannot be shown as clear, and
          they need different words. `dataAvailable === false` means the catalogue
          carries no interaction rows for it at all, in which case
          `unresolvedRowCount` is a synthetic 1 against a `totalRowCount` of 0 —
          phrasing that as "1 of 0 rows" would be nonsense. The third names the
          entered drugs outside the resolved interaction graph, which is a statement about the
          patient's list rather than about this medication, so it renders
          alongside the other two rather than instead of them. */}
      {result.unreachableCounterparties.length > 0 ? (
        <InlineNotice tone="neutral">
          This catalogue has no machine-resolved interaction involving{" "}
          {formatMedicationList(result.unreachableCounterparties.map(medicationDisplayName))}, so{" "}
          {result.unreachableCounterparties.length === 1 ? "it was" : "they were"} not cross-checked in either
          direction. The absence of a warning above is not evidence of safety for{" "}
          {result.unreachableCounterparties.length === 1 ? "that drug" : "those drugs"}. Review manually.
        </InlineNotice>
      ) : null}

      {!result.dataAvailable ? (
        <InlineNotice tone="neutral">
          This catalogue carries no interaction data for this medication, so nothing could be cross-checked against the
          entered list. Review manually. It is not shown as clear.
        </InlineNotice>
      ) : result.unresolvedRowCount > 0 ? (
        <InlineNotice tone="neutral">
          {result.unresolvedRowCount} of this medication&rsquo;s {result.totalRowCount} interaction{" "}
          {result.totalRowCount === 1 ? "row" : "rows"} could not be matched automatically — review the Key Interactions
          section below manually. This medication is not shown as clear.
        </InlineNotice>
      ) : null}

      {/* The patient-side twin of the unresolved-row notice above: the entered
          drug's own rows could not all be matched, so one of them may reach this
          medication without naming it. */}
      {result.reverseUnresolvedCounterparties.length > 0 ? (
        <InlineNotice tone="neutral">
          Some interaction rows for{" "}
          {formatMedicationList(result.reverseUnresolvedCounterparties.map(medicationDisplayName))} could not be matched
          automatically, so they were not fully cross-checked against this medication. Review manually.
        </InlineNotice>
      ) : null}
    </section>
  );
}
