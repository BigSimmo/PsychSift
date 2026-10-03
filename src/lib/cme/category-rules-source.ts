import { TODAY_RULE_SIGN_OFFS, type RuleSignOff } from "@/lib/admin/rule-sign-off";

/**
 * The Medical Board of Australia's CPD hour rules, each quoted verbatim. Checked 3 October 2026
 * against "Registration standard: Continuing professional development", effective from 1 January
 * 2023 (the PDF linked from the Board's registration standards page; SHA-256 below, so a signer
 * can confirm they read the same document).
 *
 * These are the Board's national minimums only. College or CPD-home requirements, such as the
 * RANZCP formal peer review hours in `presets.ts`, are not in this standard and are not checked here.
 *
 * `tests/cme-category-coaching.test.ts` proves each quote states its figure and that the starting
 * preset (`createAustralianRanzcpPreset`) carries exactly these numbers.
 *
 * Shipped unsigned and off. A named clinician compares every quote with the standard, then fills in
 * `CPD_CATEGORY_RULES_SIGN_OFF` (stored in `src/lib/admin/today-rule-sign-offs.json`, written by `npm run rules:sign`) with `ruleContentSha256(CPD_CATEGORY_RULE_SET)`.
 */

export const CPD_CATEGORY_RULE_SET = {
  /** Bump whenever `category-coaching.ts` changes how the figures are applied; it is inside the sign-off pin. */
  interpretation: "category-coaching v1",
  source: {
    title: "Medical Board of Australia — Registration standard: Continuing professional development",
    effectiveFrom: "2023-01-01",
    url: "https://www.ahpra.gov.au/documents/default.aspx?record=WD21%2f31046&dbid=AP&chksum=TqPI98CYQYllvPkGwiAz%2fw%3d%3d",
    listedOn: "https://www.medicalboard.gov.au/Registration-Standards",
    pdfSha256: "24dca2448ba634062a96f689118654cf49f359850b31b15283152cc469f2a2c7",
    checkedOn: "2026-10-03",
    section: "What CPD am I required to do?",
  },
  rules: {
    totalHours: {
      hours: 50,
      quote:
        "complete a minimum of 50 hours per year of CPD activities that are relevant to your scope of practice and individual professional development needs",
    },
    educationalHours: {
      hours: 12.5,
      quote: "at least 12.5 hours (25 per cent of the minimum) in educational activities",
    },
    reviewingAndMeasuringHours: {
      hours: 25,
      minimumEachHours: 5,
      quote:
        "at least 25 hours (50 per cent of the minimum) in activities focused on reviewing performance and measuring outcomes, with a minimum of five hours for each category, and",
    },
    remainingHours: {
      hours: 12.5,
      quote:
        "the remaining 12.5 hours (25 per cent of the minimum), and any CPD activities over the 50-hour minimum across any of these types of CPD activity.",
    },
    period: { quote: "To meet this registration standard, in each calendar year you must:" },
  },
} as const;

/** Shipped unsigned and off. Only the owner, with `npm run rules:sign`, fills this in; agents never do. */
export const CPD_CATEGORY_RULES_SIGN_OFF: RuleSignOff = TODAY_RULE_SIGN_OFFS.cpd;
