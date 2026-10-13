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

/**
 * Printable leaf component for WA Mental Health Act 2014 Form 6A and 6B (#C4CFFP).
 *
 * Designed to ensure form headers, titles, and statutory metadata print visibly
 * without rendering blank under browser print media rules.
 */
export function WaMhaFormPrint({
  formCode,
  patientName = "Smith, John",
  patientDob = "1985-04-12",
  patientId = "UMRN-984210",
  facilityName = "Perth Mental Health Service",
  treatingPsychiatrist = "Dr. C. Reynolds (Consultant Psychiatrist)",
  orderDateTime = new Date().toISOString().slice(0, 16).replace("T", " "),
  expiryDateTime,
  isChild = false,
  leastRestrictiveReasoning = "Voluntary options exhausted; severe risk of serious deterioration without inpatient compulsory treatment.",
  physicalHealthJustification = "Requires active intravenous therapy and cardiac monitoring requiring general medical ward detention.",
  chiefPsychiatristConsent = true,
  className = "",
}: WaMhaFormPrintProps) {
  const meta = FORM_METADATA[formCode];
  const maxDays = isChild ? 14 : 21;

  return (
    <div
      className={`wa-mha-form-print p-6 max-w-4xl mx-auto bg-white text-black font-sans ${className}`}
      data-wa-mha-form-print="true"
      data-testid="wa-mha-form-print-root"
    >
      {/* Printable Form Header - ensured visible via @media print in print.css */}
      <header
        className="wa-mha-print-header form-print-header border-b-2 border-black pb-4 mb-4"
        data-print-header="true"
        data-testid="form-print-header"
      >
        <div className="flex justify-between items-start mb-2">
          <div>
            <span
              className="inline-block px-2 py-0.5 text-sm font-bold bg-black text-white rounded mr-2"
              data-testid="form-code-badge"
            >
              {meta.code}
            </span>
            <span className="text-xs uppercase tracking-wider font-semibold text-gray-800">
              Government of Western Australia · Department of Health
            </span>
          </div>
          <span className="text-xs font-mono">{meta.act}</span>
        </div>

        <h1
          className="form-print-title text-xl font-bold tracking-tight text-black mt-1 mb-2"
          data-print-title="true"
          data-testid="form-print-title"
        >
          {meta.title}
        </h1>

        <div
          className="statutory-metadata text-xs space-y-1 text-gray-900 border-t border-gray-300 pt-2"
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
              <strong>Maximum Initial Period:</strong> {maxDays} days ({isChild ? "Child" : "Adult"})
            </span>
          </div>
          <p className="italic">{meta.purpose}</p>
        </div>
      </header>

      {/* Patient & Order Particulars */}
      <section className="form-print-section mb-4" data-testid="patient-details-section">
        <h2 className="text-sm font-bold uppercase tracking-wider bg-gray-100 p-1.5 border border-black mb-2">
          1. Person Details
        </h2>
        <table className="form-print-table w-full text-xs border border-black mb-2">
          <tbody>
            <tr>
              <td className="w-1/3 p-1.5 border border-black">
                <span className="font-semibold">Full Name:</span> {patientName}
              </td>
              <td className="w-1/3 p-1.5 border border-black">
                <span className="font-semibold">DOB:</span> {patientDob} ({isChild ? "Child" : "Adult"})
              </td>
              <td className="w-1/3 p-1.5 border border-black">
                <span className="font-semibold">Identifier:</span> {patientId}
              </td>
            </tr>
            <tr>
              <td colSpan={2} className="p-1.5 border border-black">
                <span className="font-semibold">Facility / Hospital:</span> {facilityName}
              </td>
              <td className="p-1.5 border border-black">
                <span className="font-semibold">Order Made:</span> {orderDateTime}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Statutory Criteria & Reasons */}
      <section className="form-print-section mb-4" data-testid="clinical-grounds-section">
        <h2 className="text-sm font-bold uppercase tracking-wider bg-gray-100 p-1.5 border border-black mb-2">
          2. Statutory Findings & Least Restrictive Reasoning
        </h2>
        <div className="border border-black p-2 text-xs space-y-2">
          <p>
            <strong>Statutory Threshold:</strong> {meta.threshold}
          </p>
          <div>
            <strong>Least Restrictive Treatment Justification:</strong>
            <p className="mt-1 pl-2 border-l-2 border-gray-400">{leastRestrictiveReasoning}</p>
          </div>
          {formCode === "6B" && (
            <div className="bg-amber-50 p-2 border border-amber-300 text-xs">
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
        <h2 className="text-sm font-bold uppercase tracking-wider bg-gray-100 p-1.5 border border-black mb-2">
          3. Statutory Obligations & Timeframes
        </h2>
        <ul className="list-disc list-inside text-xs space-y-1 p-2 border border-black">
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
        <h2 className="text-sm font-bold uppercase tracking-wider bg-gray-100 p-1.5 border border-black mb-2">
          4. Authorised Medical Practitioner / Psychiatrist
        </h2>
        <table className="form-print-table w-full text-xs border border-black">
          <tbody>
            <tr>
              <td className="w-1/2 p-2 border border-black">
                <span className="font-semibold">Practitioner Name:</span> {treatingPsychiatrist}
              </td>
              <td className="w-1/2 p-2 border border-black">
                <span className="font-semibold">Signature:</span> ___________________________
              </td>
            </tr>
            <tr>
              <td className="p-2 border border-black">
                <span className="font-semibold">Date & Time Order Made:</span> {orderDateTime}
              </td>
              <td className="p-2 border border-black">
                <span className="font-semibold">Copies to:</span> Patient, Mental Health Tribunal, Chief Psychiatrist
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Footer Provenance */}
      <footer className="form-print-footer border-t border-black pt-2 text-[10px] text-gray-600 flex justify-between">
        <span>WA Mental Health Act 2014 Statutory Instrument</span>
        <span>PsychSift WA Statutory Print Service</span>
      </footer>
    </div>
  );
}
