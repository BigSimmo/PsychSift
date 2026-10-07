import type { WorkAreaId, WorkFrameIconName } from "@/lib/work-frame/areas";

/**
 * What each work area says the first time it has no data yet (setup mockup,
 * frames 11 to 15): what the area is for, and one clear next step. Every
 * address is a real route under `src/app/(search-app)`, so a first-use screen
 * never leads to a dead end.
 *
 * The icon is a name from the frame's icon map (`work-frame-icons.ts`), which
 * resolves it to a lucide icon, so this file stays free of React.
 */

export type FirstUseLink = { readonly label: string; readonly href: string };

export type FirstUseCopy = {
  readonly icon: WorkFrameIconName;
  readonly title: string;
  readonly body: string;
  readonly primary: FirstUseLink;
  readonly secondary: FirstUseLink;
};

export const FIRST_USE: Readonly<Record<WorkAreaId, FirstUseCopy>> = {
  day: {
    icon: "sun",
    title: "Nothing for today",
    body: "Add your roster and your day fills itself in.",
    primary: { label: "Add your roster", href: "/roster" },
    secondary: { label: "Open settings", href: "/my-day/profile" },
  },
  rost: {
    icon: "calendar",
    title: "No roster yet",
    body: "Join your team's roster or add your own shifts.",
    primary: { label: "Join a team", href: "/roster/join" },
    secondary: { label: "Add shifts", href: "/roster/shifts" },
  },
  teach: {
    icon: "board",
    title: "No teaching yet",
    body: "Join your service's teaching programme with its code.",
    // Teaching has no join page of its own: a service invitation code is
    // entered under "Join with invitation" on the service page, which is where
    // Teaching's own "How to join a service" sheet sends people.
    primary: { label: "Join with a code", href: "/on-call/service" },
    secondary: { label: "Browse what's on", href: "/teaching/whats-on" },
  },
  assess: {
    icon: "pen",
    title: "No assessments yet",
    body: "Start a workplace-based assessment when you're ready.",
    primary: { label: "Start an assessment", href: "/teaching/assessments" },
    // `?view=words` is not a view the page knows (it would fall back to the
    // home screen), so this opens the assessments help screen instead.
    secondary: { label: "How they work", href: "/teaching/assessments?view=help" },
  },
  cpd: {
    icon: "award",
    title: "Start your CPD year",
    body: "Pick your college and year, then log as you go.",
    primary: { label: "Set up CPD", href: "/cme/setup" },
    secondary: { label: "Log an activity", href: "/cme/new" },
  },
  admin: {
    icon: "shield",
    title: "Nothing to track yet",
    body: "Add your registration and renewals.",
    // `?record=missing` opens Renewals' "Record missing dates" sheet, which
    // steps through every requirement with no date yet, registration included.
    primary: { label: "Add registration", href: "/admin/renewals?record=missing" },
    secondary: { label: "Add a renewal", href: "/admin/renewals" },
  },
  call: {
    icon: "phone",
    title: "No hospital info yet",
    body: "Add your hospital's contacts and handbook.",
    primary: { label: "Add a contact", href: "/on-call/contacts" },
    // The service page is where a hospital (service and first site) is created.
    secondary: { label: "Set up your hospital", href: "/on-call/service" },
  },
};
