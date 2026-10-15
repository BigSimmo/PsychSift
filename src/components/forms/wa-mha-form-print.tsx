"use client";

import React from "react";

export interface WaMhaFormPrintProps {
  /** Form 6A (Authorised hospital) or 6B (General hospital) */
  formCode: "6A" | "6B";
  patientName?: string;
  patientDob?: string;
  patientId?: string;
  facilityName?: string;
  treatingPsychiatrist?: string;
  orderDateTime?: string;
  expiryDateTime?: string;
  isChild?: boolean;
  leastRestrictiveReasoning?: string;
  physicalHealthJustification?: string;
  chiefPsychiatristConsent?: boolean;
  className?: string;
}

const FORM_METADATA = {
  "6A": {
    code: "Form 6A",
    title: "Inpatient treatment order in authorised hospital",
    act: "Mental Health Act 2014 (WA)",
    sections: "Sections 55, 56, 72, 89, 90, 120, 123, 131",
    purpose: "Compulsory inpatient treatment in an authorised hospital setting",
    threshold: "Inpatient treatment order criteria met and less restrictive options are insufficient",
    destination: "Authorised Hospital",
    statutoryNotes: [
      "Authorises compulsory inpatient treatment according to the order.",
      "Adult initial period: up to 21 days from the day order is made.",
      "Child (< 18 years) initial period: up to 14 days from the day order is made.",
      "Pre-expiry examination must occur on or within 7 days before the period ends.",
    ],
  },
  "6B": {
    code: "Form 6B",
    title: "Inpatient treatment order in general hospital",
    act: "Mental Health Act 2014 (WA)",
    sections: "Sections 61, 89, 90, 131",
    purpose: "Compulsory inpatient treatment in a general hospital setting due to physical health needs",
    threshold: "Criteria met; Chief Psychiatrist consent obtained; physical health transfer risk is significant",
    destination: "General Hospital",
    statutoryNotes: [
      "Authorises compulsory inpatient treatment in a general hospital setting.",
      "Adult initial period: up to 21 days; Child initial period: up to 14 days.",
      "Requires documented Chief Psychiatrist consent.",
      "Ongoing justification for general hospital detention must be actively reviewed.",
    ],
  },
} as const;

// A blank field prints as a visible gap, never as invented patient, clinician or clinical content.
const NOT_ENTERED = "Not entered";

/**
 * Printable leaf component for WA Mental Health Act 2014 Form 6A and 6B (#C4CFFP).
 *
 * Designed to ensure form headers, titles, and statutory metadata print visibly
 * without rendering blank under browser print media rules.
 *
 * NOT FOR USE YET. Nothing renders this component. Its statutory text (section lists, the
 * 6B Chief Psychiatrist wording, examination timing and copy recipients) has not been checked
 * against the Act, and the app's own forms register describes the 6B attachment as a report to
 * the Chief Psychiatrist rather than a consent. It needs legal and clinical sign-off before it
 * is wired into any page.
 */
export function WaMhaFormPrint({
  formCode,
  patientName = NOT_ENTERED,
  patientDob = NOT_ENTERED,
  patientId = NOT_ENTERED,
  facilityName = NOT_ENTERED,
  treatingPsychiatrist = NOT_ENTERED,
  orderDateTime = NOT_ENTERED,
  expiryDateTime,
  isChild,
  leastRestrictiveReasoning = NOT_ENTERED,
  physicalHealthJustification = NOT_ENTERED,
  chiefPsychiatristConsent = false,
  className = "",
}: WaMhaFormPrintProps) {
  const meta = FORM_METADATA[formCode];
  const ageClassification = isChild === undefined ? "Not established" : isChild ? "Child" : "Adult";
  const maxDays = isChild === undefined ? null : isChild ? 14 : 21;

  return (
    <div
      className={`wa-mha-form-print p-6 max-w-4xl mx-auto bg-[color:var(--surface)] text-[color:var(--text-heading)] font-sans ${className}`}
      data-wa-mha-form-print="true"
      data-testid="wa-mha-form-print-root"
    >
      <div
        className="mb-4 border-2 border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-3 text-center text-sm font-bold uppercase tracking-wide"
        role="alert"
        data-testid="form-print-use-warning"
      >
        NOT FOR USE YET — Requires legal and clinical sign-off before use.
      </div>

      {/* Printable Form Header - ensured visible via @media print in print.css */}
      <header
        className="wa-mha-print-header form-print-header border-b-2 border-[color:var(--text-heading)] pb-4 mb-4"
        data-print-header="true"
        data-testid="form-print-header"
      >
        <div className="flex justify-between items-start mb-2">
          <div>
            <span
              className="inline-block px-2 py-0.5 text-sm font-bold bg-[color:var(--text-heading)] text-[color:var(--surface)] rounded mr-2"
              data-testid="form-code-badge"
            >
              {meta.code}
            </span>
            <span className="text-xs uppercase tracking-wider font-semibold text-[color:var(--text-heading)]">
              Government of Western Australia · Department of Health
            </span>
          </div>
          <span className="text-xs font-mono">{meta.act}</span>
        </div>

        <h1
          className="form-print-title text-xl font-bold tracking-tight text-[color:var(--text-heading)] mt-1 mb-2"
          data-print-title="true"
          data-testid="form-print-title"
        >
          {meta.title}
        </h1>

        <div
          className="statutory-metadata text-xs space-y-1 text-[color:var(--text-heading)] border-t border-[color:var(--border)] pt-2"
          data-statutory-metadata="true"
          data-testid="statutory-metadata"
        >
          <div className="flex flex-wrap gap-x-4">
            <span>
              <strong>Statutory Authority:</strong> {meta.sections}
            </span>
            <span>
              <strong>Facility Setting:</strong> {meta.destination}
            </span>
            <span>
              <strong>Age Classification:</strong> {ageClassification}
              {maxDays !== null && (
                <span>
                  <strong>Maximum Initial Period:</strong> {maxDays} days ({ageClassification})
                </span>
              )}
            </span>
          </div>
          <p className="italic">{meta.purpose}</p>
        </div>
      </header>

      {/* Patient & Order Particulars */}
      <section className="form-print-section mb-4" data-testid="patient-details-section">
        <h2 className="text-sm font-bold uppercase tracking-wider bg-[color:var(--surface-subtle)] p-1.5 border border-[color:var(--text-heading)] mb-2">
          1. Person Details
        </h2>
        <table className="form-print-table w-full text-xs border border-[color:var(--text-heading)] mb-2">
          <tbody>
            <tr>
              <td className="w-1/3 p-1.5 border border-[color:var(--text-heading)]">
                <span className="font-semibold">Full Name:</span> {patientName}
              </td>
              <td className="w-1/3 p-1.5 border border-[color:var(--text-heading)]">
                <span className="font-semibold">DOB:</span> {patientDob} ({ageClassification})
              </td>
              <td className="w-1/3 p-1.5 border border-[color:var(--text-heading)]">
                <span className="font-semibold">Identifier:</span> {patientId}
              </td>
            </tr>
            <tr>
              <td colSpan={2} className="p-1.5 border border-[color:var(--text-heading)]">
                <span className="font-semibold">Facility / Hospital:</span> {facilityName}
              </td>
              <td className="p-1.5 border border-[color:var(--text-heading)]">
                <span className="font-semibold">Order Made:</span> {orderDateTime}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Statutory Criteria & Reasons */}
      <section className="form-print-section mb-4" data-testid="clinical-grounds-section">
        <h2 className="text-sm font-bold uppercase tracking-wider bg-[color:var(--surface-subtle)] p-1.5 border border-[color:var(--text-heading)] mb-2">
          2. Statutory Findings & Least Restrictive Reasoning
        </h2>
        <div className="border border-[color:var(--text-heading)] p-2 text-xs space-y-2">
          <p>
            <strong>Statutory Threshold:</strong> {meta.threshold}
          </p>
          <div>
            <strong>Least Restrictive Treatment Justification:</strong>
            <p className="mt-1 pl-2 border-l-2 border-[color:var(--border-strong)]">{leastRestrictiveReasoning}</p>
          </div>
          {formCode === "6B" && (
            <div className="bg-[color:var(--warning-soft)] p-2 border border-[color:var(--warning-border)] text-xs">
              <p>
                <strong>General Hospital Detention Justification:</strong>
              </p>
              <p className="mt-0.5">{physicalHealthJustification}</p>
              <p className="mt-1">
                <strong>Chief Psychiatrist Consent:</strong>{" "}
                {chiefPsychiatristConsent ? "Obtained and documented in clinical record." : "Pending"}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Statutory Rules & Timeframes */}
      <section className="form-print-section mb-4" data-testid="statutory-rules-section">
        <h2 className="text-sm font-bold uppercase tracking-wider bg-[color:var(--surface-subtle)] p-1.5 border border-[color:var(--text-heading)] mb-2">
          3. Statutory Obligations & Timeframes
        </h2>
        <ul className="list-disc list-inside text-xs space-y-1 p-2 border border-[color:var(--text-heading)]">
          {meta.statutoryNotes.map((note, idx) => (
            <li key={idx}>{note}</li>
          ))}
          {expiryDateTime && (
            <li>
              <strong>Calculated Expiry Deadline:</strong> {expiryDateTime}
            </li>
          )}
        </ul>
      </section>

      {/* Making Practitioner Signature Block */}
      <section className="form-print-section mb-4" data-testid="signature-section">
        <h2 className="text-sm font-bold uppercase tracking-wider bg-[color:var(--surface-subtle)] p-1.5 border border-[color:var(--text-heading)] mb-2">
          4. Authorised Medical Practitioner / Psychiatrist
        </h2>
        <table className="form-print-table w-full text-xs border border-[color:var(--text-heading)]">
          <tbody>
            <tr>
              <td className="w-1/2 p-2 border border-[color:var(--text-heading)]">
                <span className="font-semibold">Practitioner Name:</span> {treatingPsychiatrist}
              </td>
              <td className="w-1/2 p-2 border border-[color:var(--text-heading)]">
                <span className="font-semibold">Signature:</span> ___________________________
              </td>
            </tr>
            <tr>
              <td className="p-2 border border-[color:var(--text-heading)]">
                <span className="font-semibold">Date & Time Order Made:</span> {orderDateTime}
              </td>
              <td className="p-2 border border-[color:var(--text-heading)]">
                <span className="font-semibold">Copies to:</span> Patient, Mental Health Tribunal, Chief Psychiatrist
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Footer Provenance */}
      <footer className="form-print-footer border-t border-[color:var(--text-heading)] pt-2 text-xs text-[color:var(--text-muted)] flex justify-between">
        <span>WA Mental Health Act 2014 Statutory Instrument</span>
        <span>PsychSift WA Statutory Print Service</span>
      </footer>
    </div>
  );
}
