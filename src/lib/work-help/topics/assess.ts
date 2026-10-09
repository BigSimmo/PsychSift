import type { WorkHelpTopic } from "@/lib/work-help/types";

export const assessTopic: WorkHelpTopic = {
  id: "assess",
  kind: "area",
  title: "Assessments",
  areaId: "assess",
  identity: "teaching",
  summary: "Term assessments, EPAs and registrar supervision hours",
  tabs: [
    {
      label: "To do",
      body: "Signed in, how CLA works. Signed out, forms to finish, on made-up records, as the doctor, their supervisor or the DCT.",
    },
    { label: "Progress", body: "Signed in, how CLA works. Signed out, the year's targets, on made-up records." },
    // The tab is "Registrar supervision", shown as "Registrar" (owner decision 9 Oct 2026).
    { label: "Registrar supervision", body: "Registrar supervision hours to log and confirm." },
  ],
  questions: [
    {
      id: "keep-assessments",
      q: "Can I keep my assessments here?",
      a: "No. Your term assessments and EPAs stay in Clinical Learning Australia (CLA) and with your Medical Education Unit (MEU). Signed in, Assessments shows how CLA works. Signed out, you can try it on made-up records, and nothing is saved or sent.",
      link: { label: "Assessments", href: "/teaching/assessments" },
    },
    {
      id: "dct-side",
      q: "What is the DCT side?",
      a: "Signed out, the DCT tab shows a made-up Director of Clinical Training: end-of-term forms to sign off, improvement plans and who is behind. In CLA the DCT completes DCT sign-off.",
    },
    {
      id: "cant-assess",
      q: "What if an assessor can't do my EPA?",
      a: "CLA has no send back button, so they tell you. Delete the emailed form, or change who it goes to, from its three-dot menu in CLA, and ask someone else.",
    },
    {
      id: "log-supervision",
      q: "How do I log registrar supervision hours?",
      a: "Open Registrar supervision, enter the date, minutes, type and topics, then send it for your supervisor to confirm. Log teaching topics only, never patient details.",
      link: { label: "Registrar supervision", href: "/teaching/supervision" },
    },
    {
      id: "confirm-hours",
      q: "How do I confirm a registrar's hours?",
      a: "As their supervisor, open Registrar supervision and tap Confirm on each entry. Confirming records your acknowledgement. It does not award CPD credit.",
      link: { label: "Registrar supervision", href: "/teaching/supervision" },
    },
    {
      id: "no-pairing",
      q: "Why is there nothing to log in Registrar supervision?",
      a: "Your service organiser sets up each registrar and supervisor pairing. Until they do, there is nothing to log, so ask them to add yours.",
    },
    {
      id: "count-epas",
      q: "Can I keep count of my EPAs?",
      a: "Yes. On Teaching's Term page, log an EPA once it is done in CLA. It keeps counts only, with no case details.",
      link: { label: "Term", href: "/teaching/term" },
    },
    {
      id: "supervision-privacy",
      q: "Who can see my supervision topics?",
      a: "Organisers see totals and status only. Your supervision topics and personal targets are private.",
      link: { label: "Registrar supervision", href: "/teaching/supervision" },
    },
  ],
  setUp: [
    { label: "Term", href: "/teaching/term" },
    { label: "Registrar supervision", href: "/teaching/supervision" },
    { label: "Help and words", href: "/teaching/assessments?view=words" },
  ],
  keywords:
    "EPA entrustable professional activity mid-term end of term report CLA ePortfolio MEU DCT supervisor supervision hours PGY1 PGY2 prevocational training forms",
};
