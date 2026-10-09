/**
 * Preview role: a testing aid that lets a reviewer look at work mode as a junior
 * doctor, an assessment reviewer or supervisor, or an admin.
 *
 * It is a lens, never a permission. Nothing here is sent to a server, read by a
 * server, or checked by any access rule. It only chooses which screens the
 * `/mockups/work-roles` page offers, and adds the `as=supervisor` view switch the
 * Assessments screens already accept. Example records come from the one example
 * data switch (`src/lib/example-data/`), never from here. Real access
 * stays with the server (roster manager role, owner scope, row level security).
 *
 * Off in production. `/mockups/**` is already blocked there by `src/proxy.ts`,
 * and `previewToolsEnabled()` keeps the stored choice inert as a second guard.
 */

export const PREVIEW_ROLES = ["junior", "supervisor", "admin"] as const;
export type PreviewRole = (typeof PREVIEW_ROLES)[number];

export const PREVIEW_ROLE_STORAGE_KEY = "psychsift:preview-role";

export type PreviewRoleInfo = {
  readonly label: string;
  readonly sub: string;
  /** Where the screens' records come from, in plain words. */
  readonly data: string;
};

export const PREVIEW_ROLE_INFO: Record<PreviewRole, PreviewRoleInfo> = {
  junior: {
    label: "Junior doctor",
    sub: "Your own day, roster, teaching, CPD and admin",
    data: "Your own records, or example records while example data is on",
  },
  supervisor: {
    label: "Reviewer or supervisor",
    sub: "Assessments sent to you and the term overview",
    data: "Example doctors only. Nothing is sent",
  },
  admin: {
    label: "Admin",
    sub: "Medical Workforce and roster manager screens",
    data: "Example staff only. Nothing is sent",
  },
};

export type PreviewRoleScreen = {
  readonly label: string;
  readonly href: string;
  readonly sub: string;
  /** False while the route is still being built on another branch. It is shown, not linked. */
  readonly ready: boolean;
};

const SUPERVISOR_SCREENS: readonly PreviewRoleScreen[] = [
  {
    label: "Consultant inbox",
    href: "/teaching/assessments?view=inbox&as=supervisor",
    sub: "Assessments waiting for your sign off",
    ready: true,
  },
  {
    label: "Term overview",
    href: "/teaching/assessments?view=overview&as=supervisor",
    sub: "Every trainee's term at a glance",
    ready: true,
  },
  {
    label: "Times you are free",
    href: "/teaching/assessments?view=times&as=supervisor",
    sub: "Slots trainees can ask for",
    ready: true,
  },
  {
    label: "One trainee's record",
    href: "/teaching/assessments/trainee/sam",
    sub: "Requests, supervision and timeline for one doctor",
    ready: true,
  },
];

const ADMIN_SCREENS: readonly PreviewRoleScreen[] = [
  {
    label: "Manage team",
    href: "/roster/manage",
    sub: "Needs a real roster team where you are manager",
    ready: true,
  },
  {
    label: "Workforce",
    href: "/admin/workforce",
    sub: "New starters and what is missing",
    ready: true,
  },
  {
    label: "Sharing",
    href: "/admin/sharing",
    sub: "Who can see what",
    ready: true,
  },
];

const JUNIOR_SCREENS: readonly PreviewRoleScreen[] = [
  { label: "My Day", href: "/my-day", sub: "Today, week and hours", ready: true },
  { label: "Roster", href: "/roster", sub: "Month, team and swaps", ready: true },
  { label: "Teaching", href: "/teaching", sub: "Today, week and logbook", ready: true },
  // The bare address keeps whichever side was last shown, so the junior doctor's lens names its own side.
  {
    label: "Assessments",
    href: "/teaching/assessments?as=doctor",
    sub: "To do, progress and supervision",
    ready: true,
  },
  { label: "CPD", href: "/cme", sub: "Year, log and learning", ready: true },
  { label: "Admin", href: "/admin", sub: "Today, renewals and new job", ready: true },
  { label: "On Call", href: "/on-call", sub: "Now, call and refer", ready: true },
];

export const PREVIEW_ROLE_SCREENS: Record<PreviewRole, readonly PreviewRoleScreen[]> = {
  junior: JUNIOR_SCREENS,
  supervisor: SUPERVISOR_SCREENS,
  admin: ADMIN_SCREENS,
};

export function isPreviewRole(value: unknown): value is PreviewRole {
  return typeof value === "string" && (PREVIEW_ROLES as readonly string[]).includes(value);
}

/**
 * True in development and test builds, and in a production build only when mockups
 * were deliberately switched on for a preview deploy. Read at build time, so a
 * normal production bundle carries `false` here.
 */
export function previewToolsEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_MOCKUPS_ENABLED === "true";
}

/** The stored role, or junior when preview tools are off, nothing is stored, or storage is blocked. */
export function readPreviewRole(storage: Pick<Storage, "getItem"> | null | undefined): PreviewRole {
  if (!previewToolsEnabled() || !storage) return "junior";
  try {
    const stored = storage.getItem(PREVIEW_ROLE_STORAGE_KEY);
    return isPreviewRole(stored) ? stored : "junior";
  } catch {
    return "junior";
  }
}

/** Saves the role for this tab only. Returns false when storage is blocked or preview tools are off. */
export function writePreviewRole(storage: Pick<Storage, "setItem"> | null | undefined, role: PreviewRole): boolean {
  if (!previewToolsEnabled() || !storage) return false;
  try {
    storage.setItem(PREVIEW_ROLE_STORAGE_KEY, role);
    return true;
  } catch {
    return false;
  }
}
