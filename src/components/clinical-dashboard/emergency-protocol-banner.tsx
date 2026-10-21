"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Phone, ShieldAlert, AlertTriangle, X } from "lucide-react";
import type { EmergencyClinicalProtocol } from "@/lib/emergency-protocols";
import { cn } from "@/components/primitive-recipes/recipes";

export interface EmergencyProtocolBannerProps {
  readonly protocol: EmergencyClinicalProtocol;
  readonly onDismiss?: () => void;
  readonly defaultExpanded?: boolean;
  readonly className?: string;
}

const telLink =
  "inline-flex items-center gap-1 font-bold underline underline-offset-2 text-[color:var(--danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

/**
 * Deterministic, instant (0ms latency, zero LLM) acute psychiatric emergency banner.
 * Displays immediate first-line clinical actions, warning notices, diagnostic criteria,
 * and toxicological/ICU escalation pathways for critical conditions (e.g. NMS, Serotonin
 * Syndrome, Acute Dystonic Reaction, Lithium Toxicity, Clozapine Myocarditis, Malignant Catatonia).
 */
export function EmergencyProtocolBanner({
  protocol,
  onDismiss,
  defaultExpanded = false,
  className,
}: EmergencyProtocolBannerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  // The Poisons call action only belongs on cards whose own escalation list names the service.
  const showPoisonsCall = protocol.specialistContacts.some((contact) => contact.includes("13 11 26"));

  return (
    <aside
      role="alert"
      aria-label={`Emergency clinical protocol: ${protocol.name}`}
      data-testid="emergency-protocol-banner"
      className={cn(
        "relative mb-4 overflow-hidden rounded-xl border-2 border-[color:var(--danger)] bg-[color:var(--surface-raised)] p-4 shadow-[var(--e2)] motion-safe:animate-fade-up",
        className,
      )}
    >
      {/* Top Bar: Icon, Eyebrow, Heading, Quick Poisons Call & Optional Dismiss */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]"
            aria-hidden="true"
          >
            <ShieldAlert aria-hidden="true" className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-2xs font-bold uppercase tracking-wider text-[color:var(--danger)]">
                Acute Emergency Protocol
              </span>
              <span className="rounded border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-1.5 py-0.25 text-2xs font-semibold uppercase text-[color:var(--danger)]">
                {protocol.category}
              </span>
              {protocol.acronym && (
                <span className="rounded bg-[color:var(--surface-subtle)] px-1.5 py-0.25 text-2xs font-mono font-bold text-[color:var(--text-muted)]">
                  {protocol.acronym}
                </span>
              )}
            </div>
            <h3 className="mt-0.5 text-base sm:text-lg font-bold leading-snug text-[color:var(--text-heading)]">
              {protocol.name}
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {showPoisonsCall && (
            <a
              href="tel:131126"
              className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-2.5 py-1 text-xs font-bold text-[color:var(--danger)] hover:bg-[color:var(--surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]"
              title="Call Poisons Information Centre (Australia 24/7)"
            >
              <Phone aria-hidden="true" className="h-3.5 w-3.5" />
              <span>Poisons: 13 11 26</span>
            </a>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss emergency protocol banner"
              className="grid h-tap w-tap place-items-center rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Immediate First-Line Action Callout */}
      <div className="mt-3 rounded-lg border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--danger)]" />
          <div className="min-w-0 text-sm">
            <span className="font-bold uppercase tracking-wide text-[color:var(--danger)]">First-Line Action: </span>
            <span className="font-semibold text-[color:var(--danger)]">{protocol.firstLineAction}</span>
          </div>
        </div>
      </div>

      {/* Warning Notice */}
      <p className="mt-2 text-xs font-medium leading-relaxed text-[color:var(--text-muted)]">
        {protocol.warningNotice}
      </p>

      {/* Where the card comes from, visible without expanding it (regulatory audit
          2026-10-20, R-12): the clinician can check the basis of a firm first-line step. */}
      <div
        className="mt-2 border-l-[3px] border-[color:var(--border)] pl-2 text-2xs leading-relaxed text-[color:var(--text-muted)]"
        data-testid="emergency-protocol-source"
      >
        <p>
          <span className="font-semibold">Based on: </span>
          {protocol.evidenceSource}{" "}
          {protocol.ownerReviewedOn ? null : (
            <span className="whitespace-nowrap rounded bg-[color:var(--warning-soft)] px-1.5 py-0.25 font-bold text-[color:var(--warning)]">
              Not yet reviewed
            </span>
          )}
        </p>
        <p>Fixed text, not written by AI. Follow local resuscitation and ICU protocols.</p>
      </div>

      {/* Accordion Toggle for Detailed Management */}
      <div className="mt-3 border-t border-[color:var(--border)] pt-2">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex min-h-tap w-full items-center justify-between rounded-lg px-2 text-xs font-semibold text-[color:var(--text)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)]"
        >
          <span>
            {expanded
              ? "Hide Detailed Protocol & Investigations"
              : "View Full Protocol, Urgent Labs & Management Steps"}
          </span>
          {expanded ? (
            <ChevronUp aria-hidden="true" className="h-4 w-4 text-[color:var(--text-muted)]" />
          ) : (
            <ChevronDown aria-hidden="true" className="h-4 w-4 text-[color:var(--text-muted)]" />
          )}
        </button>

        {expanded && (
          <div className="mt-3 space-y-4 text-xs">
            {/* Urgent Investigations */}
            <div>
              <h4 className="font-bold uppercase tracking-wider text-[color:var(--text-heading)]">
                Urgent Investigations
              </h4>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[color:var(--text)]">
                {protocol.urgentInvestigations.map((inv, idx) => (
                  <li key={idx} className="leading-relaxed">
                    {inv}
                  </li>
                ))}
              </ul>
            </div>

            {/* Diagnostic Features */}
            <div>
              <h4 className="font-bold uppercase tracking-wider text-[color:var(--text-heading)]">
                Key Diagnostic Features
              </h4>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[color:var(--text)]">
                {protocol.diagnosticFeatures.map((feat, idx) => (
                  <li key={idx} className="leading-relaxed">
                    {feat}
                  </li>
                ))}
              </ul>
            </div>

            {/* Immediate Management Steps */}
            <div>
              <h4 className="font-bold uppercase tracking-wider text-[color:var(--text-heading)]">
                Immediate Management Protocol
              </h4>
              <ol className="mt-1.5 space-y-2">
                {protocol.immediateManagement.map((step, idx) => (
                  <li
                    key={idx}
                    className={cn(
                      "rounded-lg border p-2.5 leading-relaxed",
                      step.isHighPriority
                        ? "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]/40 text-[color:var(--text)]"
                        : "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text)]",
                    )}
                  >
                    <div className="flex items-center gap-2 font-semibold text-[color:var(--text-heading)]">
                      <span>
                        {idx + 1}. {step.title}
                      </span>
                      {step.isHighPriority && (
                        <span className="rounded bg-[color:var(--danger)] px-1.5 py-0.25 text-2xs font-bold text-[color:var(--command-contrast)] uppercase">
                          Priority
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[color:var(--text)]">{step.detail}</p>
                  </li>
                ))}
              </ol>
            </div>

            {/* Specialist Referral Contacts */}
            <div>
              <h4 className="font-bold uppercase tracking-wider text-[color:var(--text-heading)]">
                Specialist & Escalation Contacts
              </h4>
              <ul className="mt-1.5 space-y-1 text-[color:var(--text)]">
                {protocol.specialistContacts.map((contact, idx) => {
                  const isPoisons = contact.includes("13 11 26");
                  return (
                    <li key={idx} className="flex items-center gap-1.5 leading-relaxed">
                      <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--danger)]" />
                      <span>{contact}</span>
                      {isPoisons && (
                        <a href="tel:131126" className={telLink}>
                          (Call 13 11 26)
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Caveat footer; the source sits above, outside the fold. */}
            <div className="border-t border-[color:var(--border)] pt-2 text-2xs text-[color:var(--text-muted)] space-y-0.5">
              <p className="font-medium italic">{protocol.caveat}</p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
