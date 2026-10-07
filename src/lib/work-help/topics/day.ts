import type { WorkHelpTopic } from "@/lib/work-help/types";

export const dayTopic: WorkHelpTopic = {
  id: "day",
  kind: "area",
  title: "My Day",
  areaId: "day",
  identity: "my-day",
  summary: "Your shifts, tasks and dates in one place",
  tabs: [
    { label: "Today", body: "Your next shift, what is up next and what needs you." },
    { label: "Week", body: "Today and the next six days of shifts, teaching and dated items." },
    { label: "Hours", body: "Your rostered hours this week and this fortnight, not pay." },
  ],
  questions: [
    {
      id: "what-needs-me",
      q: "What does Needs you show?",
      a: "Items from your other work areas that need you, overdue first. Tap one to open the page it came from. Tap Later to hide a row until tomorrow on this device, with Undo if you change your mind.",
      link: { label: "Needs you", href: "/my-day?view=all" },
    },
    {
      id: "hours-not-pay",
      q: "Why don't my hours match my pay?",
      a: "Hours counts worked shifts from your roster only. On call from home and leave are not counted, and it is not pay. Roster's Hours and rest has a payslip check to compare against.",
      link: { label: "Hours and rest", href: "/roster?view=hours" },
    },
    {
      id: "phone-alerts",
      q: "How do I get alerts on my phone?",
      a: "Open Alerts, turn on phone alerts for this device, then send a test alert. On an iPhone, add PsychSift to your Home Screen first. Everything still shows in My Day if alerts are off.",
      link: { label: "Alerts", href: "/my-day/alerts" },
    },
    {
      id: "set-reminder",
      q: "How do I set a reminder for myself?",
      a: "Add one under Your reminders on the Alerts page. It stays on this device and, for now, it won't buzz. No names, record numbers or bed numbers.",
      link: { label: "Alerts", href: "/my-day/alerts" },
    },
    {
      id: "quick-note",
      q: "Can I keep a quick note?",
      a: "Yes. The Quick note card on My records keeps a short note on this device only. Never write patient names or details there. It is deleted when you sign out.",
      link: { label: "My records", href: "/my-day?page=me" },
    },
    {
      id: "hide-cards",
      q: "How do I hide cards I don't use?",
      a: "Tap Customise My Day at the bottom of the page, then the cross on any card. Hidden cards wait there so you can bring them back. The choice stays on this device.",
    },
  ],
  setUp: [
    { label: "Work profile", href: "/my-day/profile" },
    { label: "Alerts", href: "/my-day/alerts" },
    { label: "Privacy", href: "/my-day/profile#privacy" },
  ],
  keywords:
    "dashboard home today agenda tasks to do overdue snooze later reminder notifications notify morning brief hours worked week planner note",
};
