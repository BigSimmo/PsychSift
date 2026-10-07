import { checkReminderText, type ReminderTextProblem } from "@/lib/alerts/remind-me";
import { formatDateEcho, utcDay } from "@/lib/admin/renewal-dates";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";

/**
 * Every leave type in one wallet (junior feature #34, owner request 6 Oct 2026).
 *
 * Eight cards, each with how to apply and a ready message the doctor copies
 * and sends themselves. Entitlements are NOT shown: no WA leave figure has
 * been checked against the agreement and signed off, so every card says
 * "Check your agreement" and links the agreement PDF the repo already holds
 * (`FATIGUE_RULE_SET.source`, 2024 WAIRC 00992). Nothing on this page is
 * saved: the fields that fill a message live in memory only.
 *
 * Family and domestic violence leave is a discreet card. Its front reads
 * "Confidential leave", its message says "confidential leave", it asks for
 * no reason, and it is never offered to search (`leaveWalletSearchRecords`).
 */

export type LeaveTypeId =
  | "annual"
  | "personal"
  | "exam"
  | "conference"
  | "compassionate"
  | "confidential"
  | "long-service"
  | "parental";

export type LeaveIcon = "sun" | "pulse" | "book" | "board" | "heart" | "shield" | "history" | "users";

export type LeaveSlot = "firstDay" | "lastDay" | "day" | "detail";

export interface LeaveType {
  readonly id: LeaveTypeId;
  /** What the card front says. */
  readonly front: string;
  /** The full name, shown only inside the open card (differs for the discreet card). */
  readonly fullName: string;
  /** One short line on the card front. */
  readonly line: string;
  readonly icon: LeaveIcon;
  readonly steps: readonly { readonly text: string; readonly hint?: string }[];
  /** Which gaps the ready message has. */
  readonly slots: readonly LeaveSlot[];
  /** Label for the free `detail` slot, when the message has one. */
  readonly detailLabel?: string;
  readonly detailPlaceholder?: string;
  /** Who the message is for. */
  readonly to: string;
  /** Plan it in Roster first (annual and professional development leave only). */
  readonly rosterHref?: string;
  /** Discreet: front name only, never in search, alerts or recent pages. */
  readonly discreet?: boolean;
}

const APPLY_IN_HR = { text: "Apply the way your health service asks", hint: "Lead time: check your agreement" };

export const LEAVE_TYPES: readonly LeaveType[] = [
  {
    id: "annual",
    front: "Annual leave",
    fullName: "Annual leave",
    line: "Plan it in Roster, then apply",
    icon: "sun",
    steps: [
      { text: "Plan it in Roster", hint: "Shows clashes with your shifts" },
      APPLY_IN_HR,
      { text: "Mark it Applied in Roster" },
    ],
    slots: ["firstDay", "lastDay"],
    to: "Medical Workforce",
    rosterHref: "/roster/requests",
  },
  {
    id: "personal",
    front: "Personal leave",
    fullName: "Personal leave, for when you are sick or caring",
    line: "Ready message for a sick day",
    icon: "pulse",
    steps: [
      { text: "Tell your roster manager as early as you can" },
      { text: "Copy the message below and send it" },
      { text: "Ask what evidence your service needs", hint: "Check your agreement" },
    ],
    slots: ["day"],
    to: "your roster manager",
  },
  {
    id: "exam",
    front: "Exam leave",
    fullName: "Exam leave",
    line: "For a college exam",
    icon: "book",
    steps: [{ text: "Book the exam first", hint: "Keep the receipt" }, APPLY_IN_HR],
    slots: ["firstDay", "lastDay", "detail"],
    detailLabel: "Exam",
    detailPlaceholder: "For example, written exam",
    to: "Medical Workforce",
  },
  {
    id: "conference",
    front: "Conference leave",
    fullName: "Conference and professional development leave",
    line: "Plan it in Roster as PD leave",
    icon: "board",
    steps: [
      { text: "Plan it in Roster as professional development leave" },
      APPLY_IN_HR,
      { text: "Keep the receipts for your CPD record" },
    ],
    slots: ["firstDay", "lastDay", "detail"],
    detailLabel: "Conference or course",
    detailPlaceholder: "For example, college congress",
    to: "Medical Workforce",
    rosterHref: "/roster/requests",
  },
  {
    id: "compassionate",
    front: "Compassionate leave",
    fullName: "Compassionate and bereavement leave",
    line: "Ready message",
    icon: "heart",
    steps: [{ text: "Copy the message below and send it" }, { text: "Your service tells you if it needs anything else" }],
    slots: ["firstDay", "lastDay"],
    to: "Medical Workforce",
  },
  {
    id: "confidential",
    front: "Confidential leave",
    fullName: "Family and domestic violence leave",
    line: "Private. Details inside",
    icon: "shield",
    steps: [
      { text: "Copy the message below" },
      { text: "Send it from your own email" },
      { text: "Talk the rest through in private" },
    ],
    slots: ["firstDay", "lastDay"],
    to: "Medical Workforce",
    discreet: true,
  },
  {
    id: "long-service",
    front: "Long service leave",
    fullName: "Long service leave",
    line: "Ask when you qualify",
    icon: "history",
    steps: [{ text: "Ask Medical Workforce when you qualify" }, APPLY_IN_HR],
    slots: [],
    to: "Medical Workforce",
  },
  {
    id: "parental",
    front: "Parental leave",
    fullName: "Parental leave",
    line: "Linked to your contract end",
    icon: "users",
    steps: [
      { text: "Ask early, before your next contract is signed" },
      { text: "Check who qualifies in your agreement" },
      APPLY_IN_HR,
    ],
    slots: ["firstDay"],
    to: "Medical Workforce",
  },
];

export function leaveTypeById(id: string | null | undefined): LeaveType | null {
  return LEAVE_TYPES.find((type) => type.id === id) ?? null;
}

/** The agreement every card points to for figures, until they are signed off. */
export const LEAVE_AGREEMENT = {
  title: FATIGUE_RULE_SET.source.title,
  citation: FATIGUE_RULE_SET.source.citation,
  url: FATIGUE_RULE_SET.source.url,
} as const;

export const LEAVE_DETAIL_LIMIT = 60;

export interface LeaveMessageFields {
  readonly firstDay: string;
  readonly lastDay: string;
  readonly day: string;
  readonly detail: string;
}

export const EMPTY_LEAVE_FIELDS: LeaveMessageFields = { firstDay: "", lastDay: "", day: "", detail: "" };

/**
 * A date in a message: "Mon 15 Mar", with no year. A full date with a year
 * reads like a date of birth to the patient-detail check, and a leave
 * request is always about the coming months.
 */
export function messageDate(date: string): string {
  const echo = formatDateEcho(date);
  return echo ? echo.replace(/\s\d{4}$/, "") : "";
}

function slot(value: string, fallback: string): string {
  return value ? value : `[${fallback}]`;
}

/**
 * The ready message. Gaps not filled yet show in square brackets, so the
 * doctor can see what is missing before copying.
 */
export function leaveMessage(
  type: LeaveType,
  fields: LeaveMessageFields,
  context: { contractEndsOn?: string | null } = {},
): string {
  const first = slot(fields.firstDay ? messageDate(fields.firstDay) : "", "first day");
  const last = slot(fields.lastDay ? messageDate(fields.lastDay) : "", "last day");
  const range = fields.firstDay && fields.lastDay && fields.firstDay === fields.lastDay ? `on ${first}` : `from ${first} to ${last}`;
  const detail = fields.detail.trim();
  switch (type.id) {
    case "annual":
      return `Hi Medical Workforce,\n\nI would like to apply for annual leave ${range}. I have planned it with my roster team.\n\nThanks`;
    case "personal":
      return `Hi,\n\nI am unwell and cannot work my shift on ${slot(fields.day ? messageDate(fields.day) : "", "day")}. I will let you know about the next one as soon as I can.\n\nThanks`;
    case "exam":
      return `Hi Medical Workforce,\n\nI would like to apply for exam leave ${range} for ${slot(detail, "exam")}.\n\nThanks`;
    case "conference":
      return `Hi Medical Workforce,\n\nI would like to apply for professional development leave ${range} to attend ${slot(detail, "conference or course")}.\n\nThanks`;
    case "compassionate":
      return `Hi Medical Workforce,\n\nI need to take compassionate leave ${range}. I will let you know if that changes.\n\nThanks`;
    case "confidential":
      return `Hi Medical Workforce,\n\nI need to take confidential leave ${range}. Could we talk privately about it?\n\nThanks`;
    case "long-service":
      return "Hi Medical Workforce,\n\nCould you tell me when I qualify for long service leave, and how to apply?\n\nThanks";
    case "parental": {
      const contract = context.contractEndsOn ? `, which ends on ${messageDate(context.contractEndsOn)}` : "";
      return `Hi Medical Workforce,\n\nI am planning parental leave from about ${first}. Could you tell me what I can take and how it fits with my contract${contract}?\n\nThanks`;
    }
  }
}

export interface LeaveFieldErrors {
  firstDay?: string;
  lastDay?: string;
  day?: string;
  detail?: string;
  detailProblem?: ReminderTextProblem;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function realDate(value: string): boolean {
  return DATE_KEY.test(value) && utcDay(value) !== null;
}

export function validateLeaveFields(type: LeaveType, fields: LeaveMessageFields): LeaveFieldErrors {
  const errors: LeaveFieldErrors = {};
  for (const key of ["firstDay", "lastDay", "day"] as const) {
    if (type.slots.includes(key) && fields[key] && !realDate(fields[key])) {
      errors[key] = "Use the date picker, or type the date as YYYY-MM-DD.";
    }
  }
  if (
    type.slots.includes("firstDay") &&
    type.slots.includes("lastDay") &&
    !errors.firstDay &&
    !errors.lastDay &&
    fields.firstDay &&
    fields.lastDay &&
    fields.lastDay < fields.firstDay
  ) {
    errors.lastDay = "Last day is before the first day.";
  }
  const detail = fields.detail.trim();
  if (type.slots.includes("detail") && detail) {
    if (detail.length > LEAVE_DETAIL_LIMIT) errors.detail = `Keep this to ${LEAVE_DETAIL_LIMIT} characters.`;
    else {
      const problem = checkReminderText(detail);
      if (problem) errors.detailProblem = { ...problem, body: "Messages here cannot hold patient details." };
    }
  }
  return errors;
}

export function leaveFieldsHaveErrors(errors: LeaveFieldErrors): boolean {
  return Object.values(errors).some(Boolean);
}

/** Gaps still in square brackets: Copy says so rather than refusing. */
export function leaveMessageGaps(message: string): number {
  return (message.match(/\[[^\]]+\]/g) ?? []).length;
}

/**
 * The patient-detail check for an edited message. The message's own dates
 * carry no year (see `messageDate`), so a full date here was typed by hand.
 */
export function checkLeaveMessage(message: string): ReminderTextProblem | null {
  const problem = checkReminderText(message.replace(/\[[^\]]+\]/g, " "));
  return problem ? { ...problem, body: "Messages here cannot hold patient details. Hand over in the clinical system." } : null;
}

export interface LeaveSearchRecord {
  readonly id: string;
  readonly title: string;
  readonly area: "admin";
  readonly keywords: readonly string[];
  readonly href: string;
}

/** Work-search provider. The discreet card is never offered, by name or by keyword. */
export function leaveWalletSearchRecords(): LeaveSearchRecord[] {
  return [
    {
      id: "admin-leave",
      title: "Leave wallet",
      area: "admin",
      keywords: ["leave", "AL", "how to apply", "leave message"],
      href: "/admin/leave",
    },
    ...LEAVE_TYPES.filter((type) => !type.discreet).map((type) => ({
      id: `admin-leave-${type.id}`,
      title: type.front,
      area: "admin" as const,
      keywords: [type.fullName.toLowerCase(), "leave", "how to apply"],
      href: `/admin/leave?card=${type.id}`,
    })),
  ];
}
