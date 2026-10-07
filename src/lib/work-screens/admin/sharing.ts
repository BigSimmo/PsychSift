import {
  COMPLIANCE_BUCKET_LABELS,
  COMPLIANCE_GROUP_LABELS,
  type ComplianceItem,
  type ComplianceOverview,
} from "@/lib/admin/compliance-overview";
import { formatRecordedDate } from "@/lib/admin/renewal-dates";
import { workforceRequirementLine } from "@/lib/admin/renewals";
import { perthDateOf } from "@/lib/roster/shifts/perth-time";
import {
  SHARE_GROUPS,
  type AdminSharing,
  type ShareGroup,
  type ShareLogEntry,
  type ShareMethod,
} from "@/lib/work-screens/admin/paperwork-model";

/**
 * Admin · Sharing, the doctor's side. Real sharing between a doctor and the
 * health service needs new database tables and Josh's approval, so it is not
 * live: nothing here sends anything. The doctor picks what they would share,
 * and PsychSift makes the pack they send themselves (a file to save, text to
 * copy, or an email draft that opens in their own mail app). Every send they
 * make is noted on this device so they can see what went to whom.
 *
 * Health items never go in the Medical Workforce pack. They make their own
 * Staff Health pack, the way the mockup keeps immunisation to Staff Health.
 */

export type ShareAudience = "workforce" | "staff-health";

export const SHARE_GROUP_TO: Record<ShareGroup, ShareAudience> = {
  registration: "workforce",
  checks: "workforce",
  training: "workforce",
  job: "workforce",
  health: "staff-health",
};

export const SHARE_GROUP_WHAT: Record<ShareGroup, string> = {
  registration: "Registration, CPD and provider numbers",
  checks: "Police and children checks",
  training: "Training certificates and courses",
  job: "Code of conduct and job items",
  health: "Immunisation and fit test",
};

export interface ShareGroupView {
  readonly group: ShareGroup;
  readonly label: string;
  readonly what: string;
  readonly audience: ShareAudience;
  readonly on: boolean;
  readonly items: readonly ComplianceItem[];
  readonly recorded: number;
}

export function shareGroupViews(overview: ComplianceOverview, sharing: AdminSharing): ShareGroupView[] {
  return SHARE_GROUPS.flatMap((group) => {
    const found = overview.groups.find((candidate) => candidate.group === group);
    if (!found) return [];
    return [
      {
        group,
        label: COMPLIANCE_GROUP_LABELS[group],
        what: SHARE_GROUP_WHAT[group],
        audience: SHARE_GROUP_TO[group],
        on: sharing.groups[group] === true,
        items: found.items,
        recorded: found.recorded,
      },
    ];
  });
}

/** How many items the doctor has switched on for one audience. */
export function sharedItemCount(views: readonly ShareGroupView[], audience: ShareAudience): number {
  return views
    .filter((view) => view.on && view.audience === audience)
    .reduce((total, view) => total + view.items.length, 0);
}

function itemLine(item: ComplianceItem): string {
  const line = workforceRequirementLine(item.row.item.title, item.row.entry);
  // The status word the doctor sees on Renewals, so both ends read the same.
  return `${line} · ${COMPLIANCE_BUCKET_LABELS[item.bucket]}`;
}

export interface SharePack {
  readonly audience: ShareAudience;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly groups: readonly ShareGroup[];
  readonly itemCount: number;
}

/**
 * The pack for one audience, built only from groups switched on. Returns null
 * when nothing is switched on for that audience, so no empty pack is offered.
 */
export function buildSharePack(input: {
  readonly views: readonly ShareGroupView[];
  readonly audience: ShareAudience;
  readonly recipient: string;
  readonly now: Date;
}): SharePack | null {
  const chosen = input.views.filter((view) => view.on && view.audience === input.audience);
  if (chosen.length === 0) return null;
  const to = input.audience === "staff-health" ? "Staff Health" : input.recipient.trim() || "Medical Workforce";
  const today = formatRecordedDate(perthDateOf(input.now));
  const lines: string[] = [`For ${to}`, `Dates as I recorded them, ${today}. Not checked with issuers.`, ""];
  for (const view of chosen) {
    lines.push(view.label);
    for (const item of view.items) lines.push(`- ${itemLine(item)}`);
    lines.push("");
  }
  if (input.audience === "workforce") {
    lines.push("Health items are not in this pack. They go to Staff Health only.");
  }
  lines.push("Prepared by me from my own records in PsychSift. Please tell me if anything is missing.");
  const itemCount = chosen.reduce((total, view) => total + view.items.length, 0);
  return {
    audience: input.audience,
    to,
    subject: input.audience === "staff-health" ? "My health records for Staff Health" : "My compliance records",
    text: lines.join("\n"),
    groups: chosen.map((view) => view.group),
    itemCount,
  };
}

/** Mail apps cut long links. The draft keeps the pack whole up to this length, then points to the file. */
export const MAILTO_BODY_LIMIT = 1800;

export function shareMailtoHref(pack: SharePack, email: string | undefined): string {
  const body =
    pack.text.length > MAILTO_BODY_LIMIT
      ? `${pack.text.slice(0, MAILTO_BODY_LIMIT)}\n\nThe full list is in the attached file.`
      : pack.text;
  const address = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? encodeURIComponent(email.trim()) : "";
  return `mailto:${address}?subject=${encodeURIComponent(pack.subject)}&body=${encodeURIComponent(body)}`;
}

export function sharePackFileName(pack: SharePack, now: Date): string {
  const who = pack.audience === "staff-health" ? "staff-health" : "workforce";
  return `psychsift-${who}-pack-${perthDateOf(now)}.txt`;
}

export const SHARE_METHOD_WORDS: Record<ShareMethod, string> = {
  download: "Saved the file",
  copy: "Copied the text",
  email: "Opened an email draft",
};

export function shareLogLine(entry: ShareLogEntry): string {
  const what = entry.groups.map((group) => COMPLIANCE_GROUP_LABELS[group]).join(", ");
  const count = entry.itemCount === 1 ? "1 item" : `${entry.itemCount} items`;
  return `${SHARE_METHOD_WORDS[entry.method]} · ${count}${what ? ` · ${what}` : ""}`;
}

/** Newest first, then the newest ten. */
export function recentShareLog(log: readonly ShareLogEntry[], limit = 10): ShareLogEntry[] {
  return [...log].sort((a, b) => (a.on === b.on ? 0 : a.on < b.on ? 1 : -1)).slice(0, limit);
}
