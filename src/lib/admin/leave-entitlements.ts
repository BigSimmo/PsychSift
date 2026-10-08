import type { LeaveTypeId } from "@/lib/admin/leave-types";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";

/**
 * What each leave card says you can take, from the WA Health System – Medical
 * Practitioners – AMA Industrial Agreement 2024 (2024 WAIRC 00992).
 *
 * Every line comes from the draft at
 * /mnt/project-files/work-mode-build/wa-leave/wa-leave-entitlements-draft.md,
 * which quotes the clause for each figure. The owner checked that draft against
 * the agreement and signed it off on 8 Oct 2026. Add nothing here that is not in
 * a signed-off draft, and keep the clause on every line so the doctor can check it.
 *
 * Kept apart from `LEAVE_TYPES` on purpose: the card names, steps and messages
 * carry no figures, and search never reads this file.
 */

export interface LeaveEntitlementLine {
  readonly text: string;
  /** Clause in the agreement, as printed ("34(1)", "Schedule 3, clause 7"). */
  readonly clause: string;
}

export interface LeaveEntitlementGroup {
  /** Who the lines are for, when the agreement treats groups differently. */
  readonly heading?: string;
  readonly lines: readonly LeaveEntitlementLine[];
}

export const LEAVE_SIGN_OFF = {
  signedOn: "2026-10-08",
  agreementExpiresOn: FATIGUE_RULE_SET.source.expiresOn,
} as const;

export const LEAVE_ENTITLEMENTS: Readonly<Record<LeaveTypeId, readonly LeaveEntitlementGroup[]>> = {
  annual: [
    {
      lines: [
        {
          text: "160 hours a year full time, building up weekly. A week of leave counts as 40 hours",
          clause: "34(1), 34(2)(a)",
        },
        { text: "Extra 8 hours for each 120 hours rostered on call", clause: "34(3)(a)" },
        { text: "Extra 8 hours for each seven ordinary shifts on Sundays or public holidays", clause: "34(3)(b)" },
        { text: "Extra leave is capped at 40 hours a year, both kinds together", clause: "34(4)" },
        { text: "Leave loading is built into your salary, not paid separately", clause: "34(17)" },
        { text: "Leave above one year's worth can be cashed out by written agreement", clause: "34(15)" },
        {
          text: "North of 26 degrees South (WA Country Health Service): one extra week a year",
          clause: "Schedule 3, clause 7",
        },
      ],
    },
  ],
  personal: [
    {
      lines: [
        { text: "80 hours a year full time, building up weekly", clause: "36(4)" },
        { text: "Unused leave carries over from year to year", clause: "36(11)" },
        { text: "Also for caring for a sick family or household member", clause: "36(5)(b)" },
        {
          text: "More than two working days in a row needs a medical certificate or similar evidence",
          clause: "36(14)",
        },
        { text: "In your first 12 months you can take the year's leave before it builds up", clause: "36(10)" },
      ],
    },
  ],
  exam: [
    {
      heading: "Doctors in training",
      lines: [
        { text: "4 days paid leave to sit an approved exam", clause: "18(2)" },
        { text: "3 clear days off the roster just before the exam, on request", clause: "18(2)" },
        { text: "Exam leave comes out of your 3 weeks of study leave, not on top of it", clause: "18(3)" },
      ],
    },
    {
      heading: "Senior practitioners",
      lines: [{ text: "The agreement has no exam leave clause for senior practitioners", clause: "Part 3" }],
    },
  ],
  conference: [
    {
      heading: "Doctors in training",
      lines: [
        {
          text: "3 weeks paid study or professional development leave each calendar year, exam leave included",
          clause: "18(3)",
        },
        { text: "Unused leave carries over, up to 9 weeks", clause: "18(6)" },
        { text: "Apply at least two months before", clause: "18(10)" },
        {
          text: "Allowance a year from 3 Sep 2026: intern and RMO $6,698, registrar and trainee psychiatrist $11,721, senior registrar $16,747",
          clause: "12(7)(a)",
        },
      ],
    },
    {
      heading: "Senior practitioners",
      lines: [
        {
          text: "Up to 3 weeks paid leave each year of service, building up for no more than two years",
          clause: "30(1)(a), 30(1)(c)",
        },
        {
          text: "Extra 5 weeks after each five years for study overseas, at most 10 weeks in one go",
          clause: "30(2)(a), 30(2)(b)",
        },
        { text: "A written report or a presentation to your peers afterwards", clause: "30(3)" },
        { text: "Arrangement A allowance from 3 Sep 2026: $33,331 a year", clause: "30(6)(a)" },
        { text: "Arrangement A in WA Country Health Service: $35,737 a year", clause: "Schedule 2, clause 5" },
        { text: "Arrangement B allowance: 3% of a Consultant Year 6 base salary", clause: "30(9)" },
      ],
    },
  ],
  compassionate: [
    {
      lines: [
        {
          text: "Up to 3 days bereavement leave for a close relative or household member, not necessarily in a row",
          clause: "37(1), 37(2)",
        },
        { text: "More time for a death overseas comes from annual, long service or unpaid leave", clause: "37(5)" },
        {
          text: "Up to 3 days in a row paid for early pregnancy loss, up to 20 weeks before the due date, for either partner",
          clause: "42(1)",
        },
        { text: "Personal leave can also be used for an urgent compassionate matter", clause: "36(5)(c)" },
      ],
    },
  ],
  confidential: [
    {
      lines: [
        { text: "10 paid days a year, on top of your other leave. Unused days do not carry over", clause: "39(7)" },
        { text: "Then up to 2 unpaid days each time", clause: "39(8)" },
      ],
    },
  ],
  "long-service": [
    {
      lines: [
        { text: "13 weeks after 10 years, then 13 weeks after each further seven years", clause: "38(1)(b)" },
        { text: "Pro rata leave after seven years, by agreement", clause: "38(1)(c)" },
        { text: "Give three months' notice", clause: "38(1)(d)" },
        { text: "Can be taken at half pay for twice as long, with approval", clause: "38(5)" },
        { text: "A fixed term contract ending after five years is paid out pro rata", clause: "38(1)(e)" },
      ],
    },
  ],
  parental: [
    {
      lines: [
        { text: "52 weeks in total. Unpaid except the paid weeks below", clause: "43(2)(a), 43(2)(e)" },
        { text: "14 weeks paid for the primary care giver after 12 months' continuous service", clause: "43(18)(a)" },
        { text: "The paid weeks can be taken at half pay for twice as long", clause: "43(18)(c)" },
        { text: "Both parents can be off together for up to 8 weeks at the birth or adoption", clause: "43(2)(b)" },
        { text: "Superannuation is paid on up to 24 weeks of unpaid leave", clause: "44(1)" },
        {
          text: "The agreement has no separate paid leave for a partner who is not the primary care giver",
          clause: "43(18)(a)",
        },
      ],
    },
  ],
};

/**
 * Casual doctors get none of the paid leave above except these three. Quoted from
 * clause 11(4)(h)(i) after review on PR 3367; not in the 7 Oct draft, so it narrows
 * the figures rather than adding one.
 */
export const LEAVE_CASUAL_NOTE: LeaveEntitlementLine = {
  text: "Casual doctors: the only paid leave is bereavement leave when rostered, long service leave and family and domestic violence leave.",
  clause: "11(4)(h)",
};

/** The agreement's end date has passed. It stays in force until a new one is made (clause 6(3)). */
export function leaveAgreementPastEndDate(today: string): boolean {
  return today > LEAVE_SIGN_OFF.agreementExpiresOn;
}
