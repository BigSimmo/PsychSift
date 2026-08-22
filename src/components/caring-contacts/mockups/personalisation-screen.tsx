"use client";

import { ArrowLeft, ArrowRight, Eye, LockKeyhole, MessageSquareText } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import {
  AUTOMATED_REPLY_RESPONSE,
  EXACT_MESSAGE_GSM7,
  EXACT_PATIENT_VISIBLE_MESSAGE,
  PATIENT_VISIBLE_NO_REPLY_NOTICE,
} from "@/lib/caring-contacts/message-copy";
import { calculateGsm7, type Gsm7Evidence } from "@/lib/caring-contacts/message-policy";

import {
  ROWAN_SELECTED_SENDING_PREFERENCE,
  syntheticPatients,
  syntheticTeamMembers,
  syntheticTemplates,
} from "./fixtures";
import { DefinitionRow, OperationalStatus } from "./prototype-primitives";
import type { SyntheticPathway, SyntheticTemplate } from "./types";

export {
  calculateGsm7,
  type Gsm7Evidence,
  AUTOMATED_REPLY_RESPONSE,
  EXACT_MESSAGE_GSM7,
  EXACT_PATIENT_VISIBLE_MESSAGE,
  PATIENT_VISIBLE_NO_REPLY_NOTICE,
};

export type ActivationGovernanceState = {
  pathway: SyntheticPathway;
  template: SyntheticTemplate;
};

export type ActivationBlocker = { reason: string; remedy: string };

function blockersForVersion(label: "Pathway" | "Message", version: SyntheticPathway | SyntheticTemplate) {
  const blockers: ActivationBlocker[] = [];
  if (version.lifecycle !== "Current") {
    blockers.push({
      reason: `${label} version is not current. Lifecycle: ${version.lifecycle}.`,
      remedy: `Select a current, locally approved ${label.toLowerCase()} version with complete two-person approval evidence.`,
    });
  }
  if (version.approvalState !== "Locally approved") {
    blockers.push({
      reason: `${label} version is awaiting two-person approval.`,
      remedy: `Select a current, locally approved ${label.toLowerCase()} version with complete two-person approval evidence.`,
    });
  } else if (!version.approvalEvidence) {
    blockers.push({
      reason: `${label} version has incomplete two-person approval evidence.`,
      remedy: `Select a current, locally approved ${label.toLowerCase()} version with complete two-person approval evidence.`,
    });
  }
  return blockers;
}

export function getActivationBlockers({ pathway, template }: ActivationGovernanceState) {
  return [...blockersForVersion("Pathway", pathway), ...blockersForVersion("Message", template)];
}

export function canActivateGovernedVersions(governance: ActivationGovernanceState) {
  return getActivationBlockers(governance).length === 0;
}

export function MessagePreview({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? "space-y-[var(--gap-stack)]"
          : "space-y-[var(--gap-stack)] rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:var(--surface-inset)] p-[var(--pad-card)]"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-[var(--gap-tight)]">
        <p className="text-xs font-semibold uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--text-muted)]">
          Exact patient-visible message
        </p>
        <OperationalStatus tone="info">
          {EXACT_MESSAGE_GSM7.septets} septets · {EXACT_MESSAGE_GSM7.segments} of 2 SMS segments
        </OperationalStatus>
      </div>
      <blockquote className="break-words rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-[var(--pad-card)] text-sm leading-6 text-[color:var(--text)] shadow-[var(--shadow-inset)]">
        {EXACT_PATIENT_VISIBLE_MESSAGE}
      </blockquote>
      <p className="flex items-start gap-2 text-xs text-[color:var(--text-muted)]">
        <LockKeyhole aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0" />
        GSM-7 encoding · non-receiving sender · discreet lock-screen wording · maximum two segments.
      </p>
    </div>
  );
}

export function CompactMessagePreview({ stageName }: { stageName: string }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewTriggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Button
        ref={previewTriggerRef}
        variant="secondary"
        icon={Eye}
        onClick={() => setPreviewOpen(true)}
        className="lg:hidden"
      >
        Open exact message preview
      </Button>
      <Sheet
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Exact patient-visible message"
        description={`Fully substituted fictional text for ${stageName}.`}
        closeLabel="Close exact message preview"
        returnFocusRef={previewTriggerRef}
        mobileSize="viewport"
        testId="caring-contact-message-preview-sheet"
      >
        <MessagePreview compact />
        <div className="mt-[var(--gap-block)] rounded-[var(--radius-lg)] border border-[color:var(--border)] p-[var(--pad-card)] text-sm text-[color:var(--text-muted)]">
          <p className="flex items-start gap-2 font-medium text-[color:var(--text)]">
            <MessageSquareText aria-hidden="true" className="mt-0.5 size-icon-md shrink-0" />
            One-way programme boundary
          </p>
          <p className="mt-2">{PATIENT_VISIBLE_NO_REPLY_NOTICE}. Caring contacts supplement usual care.</p>
        </div>
      </Sheet>
    </>
  );
}

export function PersonalisationScreen({ onBack, onContinue }: { onBack: () => void; onContinue: () => void }) {
  const patient = syntheticPatients[1];
  const coordinator = syntheticTeamMembers[0];
  const template = syntheticTemplates[0];

  return (
    <section className="min-w-0 pb-24 md:pb-0" data-testid="caring-contact-screen-personalisation">
      <div className="mb-[var(--gap-block)] rounded-[var(--radius-lg)] border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] p-[var(--pad-card)] forced-colors:border-[CanvasText]">
        <p className="text-xs font-semibold uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--clinical-accent)]">
          Patient identity remains in flow
        </p>
        <p className="mt-1 break-words font-semibold">
          {patient.fullName} · {patient.id} · 3 Nov 1987
        </p>
      </div>

      <div className="grid min-w-0 gap-[var(--gap-block)] lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)]">
        <div className="min-w-0 rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-[var(--pad-panel)]">
          <p className="text-xs font-semibold uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--clinical-accent)]">
            Stage 3 of 4
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight" data-caring-contact-stage-heading tabIndex={-1}>
            Personalisation
          </h2>
          <p className="mt-2 max-w-[var(--measure)] text-sm text-[color:var(--text-muted)]">
            Choose only governed substitutions. Free text, generated authoring and dynamic translation are absent.
          </p>

          <dl className="mt-[var(--gap-block)] text-sm">
            <DefinitionRow term="Preferred name">
              {patient.preferredName} · imported from the fictional referral
            </DefinitionRow>
            <DefinitionRow term="Team identity">Example Aftercare Team · neutral sender label</DefinitionRow>
            <DefinitionRow term="Coordinator signature">{coordinator.displayName}</DefinitionRow>
            <DefinitionRow term="Approved variant">
              {template.variant} · {template.version}
            </DefinitionRow>
            <DefinitionRow term="Approval evidence">
              <span className="font-medium text-[color:var(--text)]">Two-person approval complete</span>
              <span className="mt-1 block">{template.approvalEvidence?.clinicalProgrammeLead}</span>
              <span className="mt-1 block">{template.approvalEvidence?.livedExperienceContentReviewer}</span>
            </DefinitionRow>
            <DefinitionRow term="Segment evidence">
              {EXACT_MESSAGE_GSM7.septets} septets · {EXACT_MESSAGE_GSM7.segments} of 2 SMS segments · GSM-7 encoding
            </DefinitionRow>
            <DefinitionRow term="Selected sending preference">
              {ROWAN_SELECTED_SENDING_PREFERENCE.windowLabel} · applies to all 10 planned contacts
            </DefinitionRow>
            <DefinitionRow term="First send">
              15 Aug 2026 · {ROWAN_SELECTED_SENDING_PREFERENCE.windowLabel}
            </DefinitionRow>
          </dl>

          <div className="mt-[var(--gap-block)] flex flex-col-reverse gap-[var(--gap-inline)] sm:flex-row sm:justify-between">
            <Button variant="secondary" icon={ArrowLeft} onClick={onBack}>
              Back to pathway selection
            </Button>
            <div className="flex flex-col gap-[var(--gap-inline)] sm:flex-row">
              <CompactMessagePreview stageName="Personalisation" />
              <Button variant="primary" trailingIcon={ArrowRight} onClick={onContinue}>
                Continue to review and activation
              </Button>
            </div>
          </div>
        </div>

        <aside aria-label="Wide exact message preview" className="hidden min-w-0 lg:block">
          <MessagePreview />
        </aside>
      </div>
    </section>
  );
}
