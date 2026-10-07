import type { WorkHelpTopic } from "@/lib/work-help/types";

export const searchTopic: WorkHelpTopic = {
  id: "search",
  kind: "area",
  title: "AI Search",
  identity: "my-day",
  summary: "Search your own shifts, CPD, renewals and contacts",
  questions: [
    {
      id: "what-it-searches",
      q: "What does it search?",
      a: "Your own records in Roster, Teaching, CPD, Admin and On Call, such as shifts, leave, sessions, CPD activities, renewals and On Call contacts. It never searches clinical content or patient details.",
    },
    {
      id: "ask-a-question",
      q: "Can I ask it a question?",
      a: "Yes, for common ones such as When am I next on nights, What's due this month or How many CPD hours do I still need. Each answer says where it came from. Anything else shows matching records.",
    },
    {
      id: "uses-ai",
      q: "Does it send what I type anywhere?",
      a: "No. Answers are worked out on your device from records you can already see, and nothing you type is sent anywhere. Recent searches are kept only while this browser tab is open.",
    },
    {
      id: "patient-details",
      q: "What if I type a patient detail?",
      a: "If what you type looks like a patient detail, such as a hospital number, bed number or date of birth, it is not searched or saved, and you are asked to clear it.",
      link: { label: "Privacy", href: "/my-day/profile?tab=privacy" },
    },
    {
      id: "clinical-questions",
      q: "What about clinical questions?",
      a: "If it looks like a clinical question, you get a button to open it in clinical search, which answers from guidelines with citations.",
    },
    {
      id: "could-not-check",
      q: "Why does it say it could not check an area?",
      a: "When an area fails to load, the search says so instead of showing nothing, so a missing result means not checked rather than nothing there. Tap retry to load it again.",
    },
  ],
  keywords:
    "ai search find look up search my work magnifier sparkle query ask next shift nights leave due weekend roster renewals contacts",
};
