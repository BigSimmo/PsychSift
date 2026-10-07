import type { WorkHelpTopic } from "@/lib/work-help/types";

export const alertsTopic: WorkHelpTopic = {
  id: "alerts",
  kind: "guide",
  title: "Alerts and reminders",
  identity: "my-day",
  summary: "What can reach your phone, and when",
  questions: [
    {
      id: "phone-alerts",
      q: "How do I get alerts on my phone?",
      a: "Open Alerts and turn on phone alerts for this device, then send a test alert to check it works. On an iPhone, add PsychSift to your Home Screen first.",
      link: { label: "Alerts", href: "/my-day/alerts" },
    },
    {
      id: "the-bell",
      q: "What is the bell at the top?",
      a: "The bell on a work area's home opens Notifications, with everything that needs you grouped as Overdue, Today, This week and Later. Tap a row to open it, or snooze it.",
    },
    {
      id: "quiet-hours",
      q: "Can I stop alerts overnight?",
      a: "Yes. Set quiet hours on the Alerts page. Roster changes still come through, and swap and open shift requests never buzz during a night shift.",
      link: { label: "Alerts", href: "/my-day/alerts" },
    },
    {
      id: "morning-brief",
      q: "What is the morning brief?",
      a: "One phone alert instead of many. It comes at your workday time on a day with a shift, at your day off time otherwise, and waits until the afternoon after a night. It is off until you turn it on.",
      link: { label: "Alerts", href: "/my-day/alerts" },
    },
    {
      id: "my-own-reminder",
      q: "Can I set my own reminder?",
      a: "Yes, from Your reminders on the Alerts page. Reminders stay on this device and must not include names, record numbers or bed numbers. For now they are listed in the app and do not buzz.",
      link: { label: "Alerts", href: "/my-day/alerts" },
    },
    {
      id: "open-shift-alerts",
      q: "How do I hear about new open shifts?",
      a: "Open Shift alerts in Roster. New open shifts and decisions on your requests arrive as Roster alerts, using the same switches as Roster settings.",
      link: { label: "Shift alerts", href: "/open-shifts/alerts" },
    },
  ],
  setUp: [
    { label: "Alerts", href: "/my-day/alerts" },
    { label: "Shift alerts", href: "/open-shifts/alerts" },
  ],
  keywords:
    "notifications push buzz badge bell remind me calendar alarm quiet hours do not disturb morning brief snooze test alert",
};
