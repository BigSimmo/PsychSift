/**
 * WA and national public crisis contact lines — the only intentionally
 * non-fictional contact details this repository prints.
 *
 * Single source of truth: every surface that prints a real crisis number —
 * the Patient Safety Plan tool (`src/components/patient-safety-plan.tsx`) and
 * the Care Plan prototype mockups (`src/components/care-plan/mockups/fixtures.ts`,
 * which re-exports `WA_CRISIS_CONTACTS` as `publicCrisisContacts`) — reads
 * `WA_CRISIS_CONTACTS` from here, so a number can never drift between
 * surfaces. If a number or an availability window has changed since its
 * `verifiedOn` date, correct it here and nowhere else.
 *
 * VERIFICATION RECORD (first four entries): `docs/care-plan/crisis-lines-verification.md`.
 * Re-verify each number and its availability window against its own
 * `sourceUrl`, then move the `verifiedOn` date only for the entries actually
 * re-checked.
 */
export type PublicCrisisContact = {
  id: `SYN-${string}`;
  name: string;
  telephoneDisplay: string;
  telephoneUri: string;
  coverage: string;
  availability: string;
  isEmergencyService: boolean;
  /** Stated limitation shown wherever the number is shown, or null when none applies. */
  caveat: string | null;
  sourceUrl: string;
  verifiedOn: string;
};

// MHERL, Rurallink and 13YARN rechecked 2026-09-27; evidence:
// docs/superpowers/plans/2026-09-27-first-nations-mode-completion.md
export const WA_CRISIS_CONTACTS = [
  {
    id: "SYN-CRISIS-CONTACT-001",
    name: "Emergency services",
    telephoneDisplay: "000",
    telephoneUri: "000",
    coverage: "Australia-wide",
    availability: "24 hours, every day",
    isEmergencyService: true,
    caveat: null,
    sourceUrl: "https://www.triplezero.gov.au/",
    verifiedOn: "2026-08-20",
  },
  {
    id: "SYN-CRISIS-CONTACT-002",
    name: "Mental Health Emergency Response Line (MHERL) — Perth metropolitan",
    telephoneDisplay: "1300 555 788",
    telephoneUri: "1300555788",
    coverage: "Metropolitan Perth",
    availability: "24 hours, every day",
    isEmergencyService: false,
    caveat: "MHERL is a telephone triage and support line. It is not an emergency service. Call 000 in an emergency.",
    sourceUrl:
      "https://emhs.health.wa.gov.au/Hospitals-and-Services/Mental-Health-Alcohol-and-Other-Drugs/Inpatient-and-Other-Services/MHERL",
    verifiedOn: "2026-09-27",
  },
  {
    id: "SYN-CRISIS-CONTACT-003",
    name: "Mental Health Emergency Response Line (MHERL) — Peel",
    telephoneDisplay: "1800 676 822",
    telephoneUri: "1800676822",
    coverage: "Peel region",
    availability: "24 hours, every day",
    isEmergencyService: false,
    caveat: "MHERL is a telephone triage and support line. It is not an emergency service. Call 000 in an emergency.",
    sourceUrl:
      "https://emhs.health.wa.gov.au/Hospitals-and-Services/Mental-Health-Alcohol-and-Other-Drugs/Inpatient-and-Other-Services/MHERL",
    verifiedOn: "2026-09-27",
  },
  {
    id: "SYN-CRISIS-CONTACT-004",
    name: "Rurallink",
    telephoneDisplay: "1800 552 002",
    telephoneUri: "1800552002",
    coverage: "Regional and remote Western Australia",
    availability: "4:30 pm to 8:30 am on weeknights, and 24 hours on weekends and public holidays",
    isEmergencyService: false,
    caveat:
      "Rurallink is a telephone triage and support line. It is not an emergency service. Call 000 in an emergency.",
    sourceUrl:
      "https://emhs.health.wa.gov.au/Hospitals-and-Services/Mental-Health-Alcohol-and-Other-Drugs/Inpatient-and-Other-Services/Rurallink",
    verifiedOn: "2026-09-27",
  },
  {
    id: "SYN-CRISIS-CONTACT-005",
    name: "Lifeline",
    telephoneDisplay: "13 11 14",
    telephoneUri: "131114",
    coverage: "Australia-wide",
    availability: "24 hours, every day",
    isEmergencyService: false,
    caveat: null,
    sourceUrl: "https://www.lifeline.org.au/get-help/",
    verifiedOn: "2026-09-25",
  },
  {
    id: "SYN-CRISIS-CONTACT-006",
    name: "Suicide Call Back Service",
    telephoneDisplay: "1300 659 467",
    telephoneUri: "1300659467",
    coverage: "Australia-wide",
    availability: "24 hours, every day",
    isEmergencyService: false,
    caveat: null,
    sourceUrl: "https://www.suicidecallbackservice.org.au/",
    verifiedOn: "2026-09-25",
  },
  {
    id: "SYN-CRISIS-CONTACT-007",
    name: "13YARN (for Aboriginal and Torres Strait Islander people)",
    telephoneDisplay: "13 92 76",
    telephoneUri: "139276",
    coverage: "Australia-wide",
    availability: "24 hours, every day",
    isEmergencyService: false,
    caveat: null,
    sourceUrl: "https://www.13yarn.org.au/",
    verifiedOn: "2026-09-27",
  },
] satisfies readonly PublicCrisisContact[];
