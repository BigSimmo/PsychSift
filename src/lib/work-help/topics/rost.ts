import type { WorkHelpTopic } from "@/lib/work-help/types";

export const rostTopic: WorkHelpTopic = {
  id: "rost",
  kind: "area",
  title: "Roster",
  areaId: "rost",
  identity: "roster",
  summary: "Your shifts, team, swaps and leave",
  tabs: [
    { label: "Month", body: "Your month of shifts, with anything that needs you first." },
    { label: "Team", body: "Who is on with you, and the whole team calendar." },
    { label: "Swaps", body: "Swaps to answer, swaps you sent, and open shifts." },
  ],
  questions: [
    {
      id: "add-roster",
      q: "How do I get my roster in?",
      a: "Tap Add on Month to import a roster file, add a calendar link or type in one shift at a time. Files can be PDF, Excel, CSV or a calendar file. Nothing is shared until you join a team.",
      link: { label: "Month", href: "/roster" },
    },
    {
      id: "swap-shift",
      q: "How do I swap a shift?",
      a: "Open the Team calendar and tap one of your shifts, then choose who to swap with or give it away. Your roster only changes once you both agree, and your manager approves when your team needs that.",
      link: { label: "Team", href: "/roster/team" },
    },
    {
      id: "plan-leave",
      q: "How do I plan leave?",
      a: "Open Leave and tap Plan leave. It checks for clashes with your team's shifts. PsychSift does not talk to HR, so lodge it in HR too and mark what HR has said.",
      link: { label: "Leave", href: "/roster/requests" },
    },
    {
      id: "hours-rest",
      q: "Can it check my hours and rest?",
      a: "Hours and rest shows your next 14 days against your agreement, extra time you record, and a payslip check. If the checks are switched off it says so, and no warning then does not mean you are within the limits.",
      link: { label: "Hours and rest", href: "/roster?view=hours" },
    },
    {
      id: "phone-calendar",
      q: "How do I put my shifts in my phone calendar?",
      a: "In Settings, turn on Calendar link. Your shifts for the next 60 days go on a private link as shift type and time only. Anyone with the link can see them, so keep it to yourself.",
      link: { label: "Settings", href: "/roster/settings" },
    },
    {
      id: "join-team",
      q: "How do I join my team?",
      a: "Open Join a team and paste the invite link or code your roster manager sent. Sign in with the email the invite was sent to.",
      link: { label: "Join a team", href: "/roster/join" },
    },
  ],
  setUp: [
    { label: "Join a team", href: "/roster/join" },
    { label: "Settings", href: "/roster/settings" },
    { label: "Manage team, for managers", href: "/roster/manage" },
  ],
  keywords:
    "rota roster schedule swap give away cover leave annual holiday shifts nights on call calendar sync ical import fatigue rest overtime extra time payslip team invite code",
};
