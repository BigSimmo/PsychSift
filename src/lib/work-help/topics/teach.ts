import type { WorkHelpTopic } from "@/lib/work-help/types";

export const teachTopic: WorkHelpTopic = {
  id: "teach",
  kind: "area",
  title: "Teaching",
  areaId: "teach",
  identity: "teaching",
  summary: "Sessions, check in, feedback and your record",
  tabs: [
    { label: "Today", body: "The session on now, with check in, and the rest of this week." },
    { label: "Week", body: "Every session this week, day by day." },
    { label: "Logbook", body: "Your check-ins, feedback you owe and sessions to log to CPD." },
  ],
  questions: [
    {
      id: "check-in",
      q: "How do I check in to a session?",
      a: "When the session starts, open it and tap Check in with code, then scan the QR code or type the six digits. If you missed it, Check in without code works for 7 days after the session.",
      link: { label: "Today", href: "/teaching" },
    },
    {
      id: "log-to-cpd",
      q: "How do I log teaching to my CPD?",
      a: "Logbook lists this week's sessions you attended that are not in CPD yet, ready to log in one go. They are saved to your private CPD log and show in CPD under Log.",
      link: { label: "Logbook", href: "/teaching/logbook" },
    },
    {
      id: "give-feedback",
      q: "How do I give feedback on a session?",
      a: "Open Feedback and rate how useful the session was and its pace. Feedback is open for 7 days after the session. The presenter sees answers, never names.",
      link: { label: "Feedback", href: "/teaching/feedback" },
    },
    {
      id: "next-talk",
      q: "Where do I see the talk I am giving?",
      a: "Presenting shows your next talk, whether it is ready, and its check-in code. Prepare your aims and reading list outside PsychSift. Do not upload slides, patient details or Teams passcodes.",
      link: { label: "Presenting", href: "/teaching/teach" },
    },
    {
      id: "add-to-calendar",
      q: "How do I add teaching to my calendar?",
      a: "On Week, tap Add to calendar above the list of sessions.",
      link: { label: "Week", href: "/teaching/week" },
    },
    {
      id: "other-services",
      q: "Can I go to teaching at another service?",
      a: "What's on lists sessions other services have opened to you. Tap the plus on one to add it to your own week.",
      link: { label: "What's on", href: "/teaching/whats-on" },
    },
  ],
  setUp: [
    { label: "Term", href: "/teaching/term" },
    { label: "Organise, for organisers", href: "/teaching/organise" },
    { label: "Import a timetable, for organisers", href: "/teaching/import" },
  ],
  keywords:
    "education seminar journal club grand rounds tutorial lecture attendance register QR code presenting talk exam prep study resources slides recordings logbook",
};
