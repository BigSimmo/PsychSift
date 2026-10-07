import type { WorkHelpTopic } from "@/lib/work-help/types";

export const adminTopic: WorkHelpTopic = {
  id: "admin",
  kind: "area",
  title: "Admin",
  areaId: "admin",
  identity: "my-work",
  summary: "Renewals, new job paperwork and useful numbers",
  tabs: [
    { label: "Today", body: "What needs doing now, what is coming up, and your pinned numbers." },
    { label: "Renewals", body: "Dates to renew, from a statewide checklist plus any personal items you add." },
    { label: "New job", body: "What to sort before you start a new job, and what to do when you leave." },
  ],
  questions: [
    {
      id: "record-a-renewal",
      q: "How do I record that I have renewed something?",
      a: "Open the item on Renewals and tap Renewed, then enter the new expiry date. You can undo it straight after saving.",
      link: { label: "Open Renewals", href: "/admin/renewals" },
    },
    {
      id: "get-ready-for-a-new-job",
      q: "How do I get ready for a new job?",
      a: "Set your start date on New job. It lists the logins and access to sort before you start, and you can print or copy a pack of your numbers and renewal dates.",
      link: { label: "Open New job", href: "/admin/new-job" },
    },
    {
      id: "checked-with-issuer",
      q: "Does PsychSift check my registration with the issuer?",
      a: "No. Every date is one you entered, and nothing is checked with the issuing body. If you are unsure, check the issuer's own record.",
    },
    {
      id: "send-to-workforce",
      q: "How do I send my compliance record to workforce?",
      a: "Open Export from More to save an Excel file of your record on this device. Nothing is uploaded. Renewals also has Copy for workforce for a text version.",
      link: { label: "Open Export", href: "/admin/compliance/export" },
    },
    {
      id: "registration-numbers",
      q: "Where do I keep my Ahpra and provider numbers?",
      a: "In the credentials card on Today. They are kept on this phone only, tapping one copies it, and they are cleared when you sign out.",
      link: { label: "Open Today", href: "/admin" },
    },
    {
      id: "useful-numbers",
      q: "Where are the crisis lines and other useful numbers?",
      a: "Open Help from More. Crisis lines are always at the top. Pin a number you use often and it also shows on Today.",
      link: { label: "Open Help", href: "/admin/help" },
    },
  ],
  setUp: [
    { label: "Renewals", href: "/admin/renewals" },
    { label: "New job", href: "/admin/new-job" },
  ],
  keywords:
    "registration ahpra indemnity mdo visa work rights wwcc working with children check prescriber provider number compliance credentialing onboarding paperwork expiry renew crisis lines pin",
};
