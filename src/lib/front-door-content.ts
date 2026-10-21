/**
 * Front-door copy: the About and intended-use page, the Terms of Use page, the
 * once-after-sign-in terms acceptance prompt, and the three-step first-run guide
 * on the Answer home.
 *
 * DRAFT. EVERY STRING IN THIS FILE IS DRAFT WORDING AWAITING THE OWNER'S
 * SIGN-OFF. It is not legal advice and has not been reviewed by a lawyer or a
 * clinical governance body. Change the wording here and nowhere else: the pages,
 * the prompt and the guide all read from this module, and
 * `tests/front-door-content.test.ts` pins the safety statements.
 *
 * Follows the `PRIVACY_DRAFT_DISCLAIMER` pattern in
 * `src/lib/privacy-page-content.tsx`: one plain disclaimer string, rendered on
 * every surface that shows this copy.
 *
 * Style: plain Australian English, no em dashes.
 */

/** Shown as a badge on every surface that renders this copy, until the owner signs it off. */
export const FRONT_DOOR_DRAFT_MARKER = "DRAFT";

export const FRONT_DOOR_DRAFT_DISCLAIMER =
  "This is draft wording awaiting the owner's sign-off. It is not legal advice, final terms, or an assertion of governance approval.";

export type FrontDoorSection = {
  /** Stable slug, used as the section anchor. */
  id: string;
  heading: string;
  /** One entry per paragraph. */
  body: string[];
};

/* ------------------------------------------------------------------ About */

export const ABOUT_PAGE_TITLE = "About PsychSift";
export const ABOUT_PAGE_DESCRIPTION =
  "What PsychSift is, who it is for, and how to use it safely. A clinical reference prototype for health professionals.";

export const ABOUT_SECTIONS: FrontDoorSection[] = [
  {
    id: "what-it-is",
    heading: "What PsychSift is",
    body: [
      "PsychSift is a clinical reference tool for psychiatry, for health professionals. It searches a library of clinical guidelines and reference documents and answers questions with citations that link back to the original source.",
      "It is a prototype. It is still being built and tested.",
    ],
  },
  {
    id: "intended-use",
    heading: "Intended use",
    body: [
      "PsychSift helps health professionals find and check what clinical guidelines say. It does not diagnose, decide treatment for a patient, or replace your clinical judgement.",
    ],
  },
  {
    id: "who-it-is-for",
    heading: "Who it is for",
    body: [
      "PsychSift is for health professionals only. It is not designed for patients, carers or the public, and it is not a substitute for advice from a treating clinician.",
    ],
  },
  {
    id: "not-decision-support",
    heading: "It is not validated clinical decision support",
    body: [
      "PsychSift has not been validated as clinical decision support and is not a registered medical device. Its answers can be incomplete, out of date or wrong.",
      "Your clinical judgement, your local policies and the current primary guidance always come first.",
    ],
  },
  {
    id: "verify-sources",
    heading: "Always check the linked source",
    body: [
      "Every answer cites the documents it draws on. Before you act on anything clinical, open the linked source and check the wording, the date and the context yourself.",
      "If an answer has no source, or the source does not say what the answer says, do not rely on it.",
    ],
  },
  {
    id: "no-patient-details",
    heading: "No patient-identifying details",
    body: [
      "Do not enter anything that could identify a patient, such as a name, date of birth, address, Medicare number or record number. Ask general clinical questions instead.",
    ],
  },
  {
    id: "report-a-problem",
    heading: "How to report a problem",
    body: [
      "If an answer looks wrong, unsafe or poorly sourced, tap the thumbs-down button under the answer and choose Report a problem. Say what was wrong and, if you can, which source shows it.",
      "For a suspected privacy or access problem, or anything urgent, use your organisation's approved process as well.",
    ],
  },
];

/* ------------------------------------------------------------------ Terms */

/**
 * Bump this when the terms change in substance. Anyone who accepted an earlier
 * version is asked again on their next visit after signing in.
 */
export const TERMS_VERSION = "2026-10-18-draft";

/** ISO date the current terms version was written. */
export const TERMS_VERSION_DATE = "2026-10-18";

export const TERMS_PAGE_TITLE = "Terms of Use";
export const TERMS_PAGE_DESCRIPTION =
  "The draft terms for using PsychSift, a clinical reference prototype for health professionals.";

export const TERMS_SECTIONS: FrontDoorSection[] = [
  {
    id: "who-may-use",
    heading: "Who may use PsychSift",
    body: [
      "You may use PsychSift only if you are a health professional, or a student or trainee working under the supervision of one, and you use it for professional reference.",
    ],
  },
  {
    id: "reference-only",
    heading: "Reference only",
    body: [
      "PsychSift is a clinical reference prototype. It is not validated clinical decision support, it is not a registered medical device, and it does not give medical advice.",
      "You remain responsible for every clinical decision you make. Check each answer against the linked source and current primary guidance before you act on it.",
    ],
  },
  {
    id: "patient-information",
    heading: "Patient information",
    body: [
      "You must not enter information that identifies, or could reasonably identify, a patient. This includes names, dates of birth, addresses, Medicare numbers and record numbers.",
    ],
  },
  {
    id: "acceptable-use",
    heading: "Acceptable use",
    body: [
      "Do not share your account, try to get around access controls, copy the library in bulk, or use PsychSift in a way that breaks the law or your professional obligations.",
      "Source documents remain the property of their publishers. Use them in line with their own terms.",
    ],
  },
  {
    id: "reporting",
    heading: "Reporting problems",
    body: [
      "Please report answers that look wrong, unsafe or poorly sourced. Use Report a problem under the answer, and your organisation's approved process for privacy or access concerns.",
    ],
  },
  {
    id: "availability",
    heading: "Availability and changes",
    body: [
      "PsychSift is provided as it is, while it is being developed. It may change, be unavailable or be withdrawn at any time.",
      "These terms may change. When they change in substance you will be asked to read and accept the new version.",
    ],
  },
  {
    id: "privacy",
    heading: "Privacy",
    body: ["How PsychSift handles data is described on the Privacy and data processing page."],
  },
];

export const TERMS_PROMPT_TITLE = "Before you continue";
export const TERMS_PROMPT_LEAD = "Please read and accept the Terms of Use. In short:";
export const TERMS_PROMPT_POINTS = [
  "PsychSift is for health professionals only.",
  "It is a reference prototype, not validated clinical decision support.",
  "Always check an answer against its linked source before acting on it.",
  "Never enter patient-identifying details.",
];
export const TERMS_PROMPT_ACCEPT_LABEL = "I accept the Terms of Use";
export const TERMS_PROMPT_LATER_LABEL = "Not now";
export const TERMS_PROMPT_LATER_NOTE = "If you choose Not now, we will ask again next time you open PsychSift.";
export const TERMS_PROMPT_SAVE_ERROR =
  "Your acceptance could not be saved to your account, so it is remembered on this device only.";

/*
 * The Terms step at the first Ask (audit F-13). Shown before the first AI answer,
 * to signed-out visitors once per device and to signed-in users who have not
 * accepted the current version. It reuses the prompt's lead and points above;
 * only the title, the accept label and the closing note are its own.
 *
 * The owner signed off the Terms step wording below on 2026-10-20: the title, the
 * accept label, the two closing notes and the Not now notice. The reused prompt
 * lead and points, and the rest of this file, are still draft, so the step keeps
 * the DRAFT badge.
 */
export const ASK_TERMS_STEP_TITLE = "Before your first answer";
export const ASK_TERMS_STEP_ACCEPT_LABEL = "I'm a health professional and I accept the Terms";
export const ASK_TERMS_STEP_NOTE_DEVICE =
  "Students and trainees under supervision count. We'll remember this on this device.";
export const ASK_TERMS_STEP_NOTE_ACCOUNT =
  "Students and trainees under supervision count. We'll remember this on your account.";
/** Shown over the matching documents after Not now. */
export const ASK_TERMS_DECLINED_NOTICE = "No AI answer yet. To get one, accept the Terms.";
export const ASK_TERMS_REVIEW_LABEL = "Review";

/**
 * The signed-out cards for the clinical decision tools, which need sign-in from
 * 1 November 2026 (docs/decisions/2026-10-20-clinical-decision-tools-need-sign-in.md).
 * Wording approved by the owner on the 20 October 2026 mockup.
 */
export type ClinicalSignInCopy = { title: string; body: string; stillOpen?: string };
export const CLINICAL_SIGN_IN_COPY = {
  answer: {
    title: "Sign in to get an answer",
    body: "Answer is for health professionals. Sign in with your PsychSift account to ask.",
    stillOpen: "Matching documents from the library still show below.",
  },
  patientDetails: {
    title: "Sign in to add patient details",
    body: "Tailored considerations and interaction checks are for health professionals.",
    stillOpen: "The full medicine record stays open to read.",
  },
  therapyRanking: {
    title: "Sign in to rank therapies",
    body: "Matching therapies to a clinical situation is for health professionals.",
    stillOpen: "You can still browse and compare therapies.",
  },
  scoring: {
    title: "Sign in to score",
    body: "Entering answers and getting a score is for health professionals.",
    stillOpen: "The questions, scoring rules, bands and source stay open to read.",
  },
  original: {
    title: "Sign in to open the original",
    body: "Original documents belong to their publishers and open only for signed-in users.",
  },
} as const satisfies Record<string, ClinicalSignInCopy>;
export const CLINICAL_SIGN_IN_INVITE_NOTE = "No account? You can create one from Sign in. PsychSift is for health professionals only.";

/** Shown under the sign-in and create-account forms. */
export const TERMS_SIGN_IN_NOTE = "By signing in or creating an account, you agree to the";

/* ------------------------------------------------------- First-run guide */

export type FirstRunGuideStep = {
  id: "what-this-is" | "check-a-citation" | "report-a-wrong-answer";
  title: string;
  body: string;
};

export const FIRST_RUN_GUIDE_TITLE = "Getting started";
export const FIRST_RUN_GUIDE_DISMISS_LABEL = "Dismiss the getting started guide";

export const FIRST_RUN_GUIDE_STEPS: FirstRunGuideStep[] = [
  {
    id: "what-this-is",
    title: "What this is",
    body: "A clinical reference prototype for health professionals. It answers from a library of guidelines, with citations. It is not validated clinical decision support.",
  },
  {
    id: "check-a-citation",
    title: "How to check a citation",
    body: "Tap a numbered citation in an answer to see the passage it came from, then open the original document and check the wording, date and context before you act.",
  },
  {
    id: "report-a-wrong-answer",
    title: "How to report a wrong answer",
    body: "Tap the thumbs-down button under the answer and choose Report a problem. Say what was wrong and, if you can, which source shows it.",
  },
];
