import type { AppModeId } from "@/lib/app-modes";
import type { WorkSetupAreaId, WorkSetupStepId } from "@/lib/work-setup/progress";

/**
 * Set up Work's words, kept in one place so the walkthrough, the done summary,
 * My Day's prompt card and the tests all say the same thing.
 */

export const WORK_SETUP_STEP_COPY: Record<
  WorkSetupStepId,
  { readonly title: string; readonly sub: string; readonly short: string }
> = {
  welcome: {
    title: "Set up Work",
    sub: "A few short steps so My Day, Roster and alerts fit how you work. Skip any step and come back later.",
    short: "Welcome",
  },
  stage: {
    title: "Your stage",
    sub: "Your own description of where you are. It is saved to your account and only you see it.",
    short: "Your stage",
  },
  areas: {
    title: "Areas you use",
    sub: "Setup asks only about these, and Help lists them first. Every area stays open to you.",
    short: "Areas you use",
  },
  "time-zone": {
    title: "Time zone",
    sub: "Roster and shift times show in this zone.",
    short: "Time zone",
  },
  roster: {
    title: "Your roster",
    sub: "Bring in your shifts so Today and Week show where you are working.",
    short: "Roster",
  },
  rotation: {
    title: "Your rotation",
    sub: "Starting somewhere new? Set your term and work through your new job checklist.",
    short: "Rotation",
  },
  "other-areas": {
    title: "Your other areas",
    sub: "Only the areas you chose. Each opens where it is set up.",
    short: "Other areas",
  },
  alerts: {
    title: "Alerts",
    sub: "Choose what reaches you and when it stays quiet.",
    short: "Alerts",
  },
  done: {
    title: "You’re set up",
    sub: "Change any of this later in Work profile, or reopen setup from My Day’s More.",
    short: "Done",
  },
};

/** The welcome step's list of what setup covers. */
export const WORK_SETUP_COVERS: readonly { readonly step: WorkSetupStepId; readonly label: string }[] = [
  { step: "stage", label: "Your stage" },
  { step: "areas", label: "Areas you use" },
  { step: "time-zone", label: "Time zone" },
  { step: "roster", label: "Roster and rotation" },
  { step: "alerts", label: "Alerts" },
];

export const WORK_SETUP_AREA_COPY: Record<
  WorkSetupAreaId,
  { readonly name: string; readonly sub: string; readonly identity: AppModeId }
> = {
  rost: { name: "Roster", sub: "Your shifts, team, swaps and leave", identity: "roster" },
  teach: { name: "Teaching", sub: "Sessions, logbook and term dates", identity: "teaching" },
  assess: { name: "Assessments", sub: "Forms, EPAs and supervision", identity: "teaching" },
  cpd: { name: "CPD", sub: "Your year, log and plan", identity: "cme" },
  admin: { name: "Admin", sub: "Renewals, compliance and new jobs", identity: "my-work" },
  call: { name: "On Call", sub: "Who to ring, handbook and handover", identity: "on-call" },
};

/** Where the walkthrough lives, and a deep link to one step. */
export const WORK_SETUP_HREF = "/my-day/setup";
export function workSetupStepHref(step: WorkSetupStepId): string {
  return step === "welcome" ? WORK_SETUP_HREF : `${WORK_SETUP_HREF}?step=${step}`;
}
