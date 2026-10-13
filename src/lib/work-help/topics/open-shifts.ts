import type { WorkHelpTopic } from "@/lib/work-help/types";

export const openShiftsTopic: WorkHelpTopic = {
  id: "open-shifts",
  kind: "area",
  title: "Open shifts",
  identity: "open-shifts",
  summary: "Extra shifts your teams have posted",
  questions: [
    {
      id: "request-shift",
      q: "How do I pick up an extra shift?",
      a: "In Roster, open the Open shifts tab. Tap Request beside a shift that fits your roster, or tap any shift and choose Request this shift. You confirm before anything is sent. Your roster manager decides. If your team approves same-level requests automatically, a request at exactly the shift's level for a shift at least a week away can be approved straight away.",
      link: { label: "Shifts to pick up", href: "/open-shifts" },
    },
    {
      id: "clash-check",
      q: "Will it warn me about clashes?",
      a: "Each shift is checked against your PsychSift roster. An overlap is the only thing that stops a request. Other flags never stop it, and it can't see work outside PsychSift.",
      link: { label: "Shifts to pick up", href: "/open-shifts" },
    },
    {
      id: "my-requests",
      q: "Where do I see what I asked for?",
      a: "The Your requests strip sits at the top of Open shifts. Tap it to see the shifts you have requested, the ones booked for you and any that changed. A booked shift can go in your phone's calendar from its page.",
      link: { label: "My requests", href: "/open-shifts/mine" },
    },
    {
      id: "log-offered-shift",
      q: "How do I record a shift someone offered me by text?",
      a: "Use Log a shift. Paste the message and it fills in the date and times, then saves the shift to your own roster. Don't paste patient details. The message stays on this phone and isn't saved.",
      link: { label: "Log a shift", href: "/open-shifts/log" },
    },
    {
      id: "new-shift-alerts",
      q: "Can I be told when new shifts appear?",
      a: "Shift alerts turns on Roster alerts for new open shifts and for decisions on your requests. They are the same switches as in Roster settings.",
      link: { label: "Shift alerts", href: "/open-shifts/alerts" },
    },
    {
      id: "post-shift",
      q: "How do I post a shift that needs cover?",
      a: "Roster managers can post one from Post a shift in Roster's More, on one date or several. It goes live straight away for team members at the right level, and a roster manager approves whoever asks. If the team approves same-level requests automatically, that only covers a request at exactly the shift's level for a shift at least a week away. A posted shift shows who in the team could do it, and Post again copies it.",
      link: { label: "Post a shift", href: "/open-shifts/post" },
    },
  ],
  setUp: [
    { label: "Shift alerts", href: "/open-shifts/alerts" },
    { label: "Join a team", href: "/roster/join" },
  ],
  keywords: "extra shifts locum overtime cover pick up vacant unfilled request book open shift board post",
};
