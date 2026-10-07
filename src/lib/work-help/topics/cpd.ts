import type { WorkHelpTopic } from "@/lib/work-help/types";

export const cpdTopic: WorkHelpTopic = {
  id: "cpd",
  kind: "area",
  title: "CPD",
  areaId: "cpd",
  identity: "cme",
  summary: "Log CPD activities and see your year at a glance",
  tabs: [
    { label: "Summary", body: "Your year at a glance, with hours against your targets and what is still left." },
    { label: "Log", body: "Every activity you have recorded, by year, with search and filters." },
    { label: "Learning", body: "Upcoming WA courses and events, checked about once a month." },
  ],
  questions: [
    {
      id: "log-an-activity",
      q: "How do I log an activity?",
      a: "Tap Log an activity on Summary or Log. Add what it was, the date and the hours, then save. You can add a reflection, and attach evidence from the activity's own page.",
      link: { label: "Log", href: "/cme/log" },
    },
    {
      id: "where-targets-come-from",
      q: "Where do my CPD targets come from?",
      a: "From the requirements you confirm in Set up. You can load the starting preset, then record the guide or source you checked. Every progress figure in CPD comes from that saved list.",
      link: { label: "Targets", href: "/cme/setup" },
    },
    {
      id: "send-to-mycpd",
      q: "Does PsychSift send my activities to MyCPD?",
      a: "No. PsychSift cannot see MyCPD or any other CPD home. On Log, copy each activity across one at a time, then mark it copied so you know where you are up to.",
      link: { label: "Log", href: "/cme/log" },
    },
    {
      id: "regular-activities",
      q: "Can I log things I do every week or month?",
      a: "Yes. Add a routine for regular activities such as supervision or a journal club. When one is due, it shows on Summary with its own Log button.",
      link: { label: "Routines", href: "/cme/routines" },
    },
    {
      id: "check-my-year",
      q: "How do I check my year is ready to report?",
      a: "Open Report from More. It reads your year as an audit would, target by target, with your evidence, reflections and what you have marked copied.",
      link: { label: "Report", href: "/cme/check" },
    },
    {
      id: "close-a-year",
      q: "What happens when I close a CPD year?",
      a: "It saves a permanent snapshot of the year, and the year cannot be reopened. You can still correct an activity afterwards, and each change is kept as a dated amendment with your reason.",
      link: { label: "Plan", href: "/cme/plan" },
    },
  ],
  setUp: [
    { label: "Targets and CPD home", href: "/cme/setup?edit=1" },
    { label: "Development plan", href: "/cme/plan" },
    { label: "Routines", href: "/cme/routines" },
  ],
  keywords:
    "cme continuing professional development hours points mycpd ranzcp reflection evidence certificate audit portfolio courses conference goals journal club supervision peer review",
};
