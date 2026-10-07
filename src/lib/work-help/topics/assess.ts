import type { WorkHelpTopic } from "@/lib/work-help/types";

export const assessTopic: WorkHelpTopic = {
  id: "assess",
  kind: "area",
  title: "Assessments",
  areaId: "assess",
  identity: "teaching",
  summary: "Term assessments, EPAs and supervision hours",
  tabs: [
    { label: "To do", body: "Forms to finish this term, shown on made-up records for now." },
    { label: "Progress", body: "Where you stand for the year, shown on made-up records for now." },
    { label: "Supervision", body: "Supervision hours to log and confirm." },
  ],
  questions: [
    {
      id: "keep-assessments",
      q: "Can I keep my assessments here?",
      a: "Not yet. Your term assessments and EPAs stay in Clinical Learning Australia (CLA) and with your Medical Education Unit (MEU). You can try the page on made-up records, and nothing is saved or sent.",
      link: { label: "Assessments", href: "/teaching/assessments" },
    },
    {
      id: "log-supervision",
      q: "How do I log supervision hours?",
      a: "Open Supervision, enter the date, minutes, type and topics, then send it for your supervisor to confirm. Log teaching topics only, never patient details.",
      link: { label: "Supervision", href: "/teaching/supervision" },
    },
    {
      id: "confirm-hours",
      q: "How do I confirm a registrar's hours?",
      a: "As their supervisor, open Supervision and tap Confirm on each entry. Confirming records your acknowledgement. It does not award CPD credit.",
      link: { label: "Supervision", href: "/teaching/supervision" },
    },
    {
      id: "no-pairing",
      q: "Why is there nothing to log in Supervision?",
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
      link: { label: "Supervision", href: "/teaching/supervision" },
    },
  ],
  setUp: [
    { label: "Term", href: "/teaching/term" },
    { label: "Supervision", href: "/teaching/supervision" },
    { label: "Help and words", href: "/teaching/assessments?view=words" },
  ],
  keywords:
    "EPA entrustable professional activity mid-term end of term report CLA ePortfolio MEU DCT supervisor supervision hours PGY1 PGY2 prevocational training forms",
};
