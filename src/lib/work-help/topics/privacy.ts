import type { WorkHelpTopic } from "@/lib/work-help/types";

export const privacyTopic: WorkHelpTopic = {
  id: "privacy",
  kind: "guide",
  title: "Privacy and patient details",
  identity: "my-day",
  summary: "What is kept where, and keeping patients out",
  questions: [
    {
      id: "patient-details",
      q: "Can I put patient details into PsychSift?",
      a: "Keep names, dates of birth and record numbers out. AI Search will not search anything that looks like a patient detail, and CPD reflections and evidence ask you to remove them. The On Call handover takes only a bed number or initials.",
    },
    {
      id: "kept-where",
      q: "What is kept on my account and what stays on this phone?",
      a: "Your account holds your stage, roster, CPD, teaching, reminders and renewal dates. Credential numbers, On Call checklist ticks, your My Day note, pins and recent pages stay on this phone only.",
      link: { label: "Privacy", href: "/my-day/profile?tab=privacy" },
    },
    {
      id: "patient-labels",
      q: "How long do patient labels stay on my phone?",
      a: "Bed numbers and initials you enter, such as in the On Call handover, stay on this phone only. They are cleared 12 hours after the first label of the shift, when you sign out or your session ends, and before anyone else signs in here.",
    },
    {
      id: "signing-out",
      q: "What happens when I sign out?",
      a: "Signing out clears everything kept on this phone for your account, including patient labels. Display settings stay.",
      link: { label: "Privacy", href: "/my-day/profile?tab=privacy" },
    },
    {
      id: "shared-computer",
      q: "I'm using a shared computer. What should I change?",
      a: "On the Alerts page, turn on This is a shared computer. That device then takes no phone alerts and keeps no reminders. Sign out when you finish.",
      link: { label: "Alerts", href: "/my-day/alerts" },
    },
    {
      id: "recent-searches",
      q: "Can I stop it remembering my searches?",
      a: "Yes. In Privacy, turn off Save recent searches, or tap Clear recent searches. Recent searches are kept only in this browser tab, never on your account.",
      link: { label: "Privacy", href: "/my-day/profile?tab=privacy" },
    },
  ],
  setUp: [{ label: "Privacy", href: "/my-day/profile?tab=privacy" }],
  keywords:
    "confidential confidentiality patient identifiers urn mrn medicare data security shared device ward computer sign out log out delete storage",
};
