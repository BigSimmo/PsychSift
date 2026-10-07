import { formatRecordedDate } from "@/lib/admin/renewal-dates";
import { RULE_GATE_REASON_WORDS, type RuleGate } from "@/lib/admin/rule-sign-off";
import { checkReminderText, type ReminderTextProblem } from "@/lib/alerts/remind-me";
import { perthCalendarDate } from "@/lib/perth-time";
import { FATIGUE_RULE_SET, FATIGUE_RULES_SIGN_OFF, type FatigueRuleId } from "@/lib/roster/fatigue-rules-source";
import { looksLikePatientDetails } from "@/lib/work-search/signals";
import type { WorkSearchArea } from "@/lib/work-search/model";
import { restRulesGate } from "@/lib/work-profile/model";

/**
 * Ask the agreement, without AI.
 *
 * A question is matched by fixed word patterns to one of the hours and rest topics PsychSift has
 * quoted from the WA Health AMA Industrial Agreement 2024 (`FATIGUE_RULE_SET`, clause 15 only).
 * The answer is ONLY those verbatim quotes, each with its clause, and the PDF link. Nothing is
 * paraphrased, worked out or generated: a topic that is not one of the quoted clauses gets an
 * honest "Not in the clauses PsychSift has checked" and a pointer to the agreement itself.
 * Every answer ends with AMA (WA) by name. No phone number, because none is verified in the repo.
 *
 * While the rule set's sign-off gate is off (no approved signer, content changed since signing, or
 * the review date passed), every quoted answer carries "Not signed off yet": the words are the
 * agreement's, but no named clinician has compared them with the PDF. While it is on, the answer
 * names who signed it off and when.
 *
 * The question never leaves the device. A question that looks like patient details is not
 * matched at all (both the work-search and the reminder detectors run on it).
 */

export const AGREEMENT_PAGE_HREF = "/my-day/profile/agreement";
export const AGREEMENT_UNION_NAME = "AMA (WA)";
export const AGREEMENT_UNION_ROLE = "Your union. Industrial advice and representation, including unsafe hours and pay.";
export const AGREEMENT_QUESTION_LIMIT = 200;

export type AgreementTopicId =
  | "break-between-shifts"
  | "hours-in-a-week"
  | "shift-length"
  | "nights-in-a-row"
  | "rest-after-nights"
  | "days-before-two-off";

/** One verbatim line from the agreement. `text` is exactly the quoted words in `FATIGUE_RULE_SET`. */
export interface AgreementLine {
  readonly text: string;
  readonly clause: string;
  readonly ruleId: FatigueRuleId;
}

export interface AgreementTopic {
  readonly id: AgreementTopicId;
  /** A plain heading, never a claim: "Break between shifts". */
  readonly label: string;
  /** What a reader might type, for the work search and the as-you-type suggestions. */
  readonly keywords: readonly string[];
  readonly lines: readonly AgreementLine[];
}

const R = FATIGUE_RULE_SET.rules;

function line(ruleId: FatigueRuleId, clause: string, text: string): AgreementLine {
  return { ruleId, clause, text };
}

export const AGREEMENT_TOPICS: readonly AgreementTopic[] = [
  {
    id: "break-between-shifts",
    label: "Break between shifts",
    keywords: ["break between shifts", "rest between shifts", "turnaround", "quick return", "gap between shifts"],
    lines: [line("minBreakHours", R.minBreakHours.clause, R.minBreakHours.quote)],
  },
  {
    id: "hours-in-a-week",
    label: "Most hours in 7 and 14 days",
    keywords: ["hours a week", "weekly hours", "fortnight", "maximum hours", "7 days", "14 days"],
    lines: [
      line("maxHours7d", R.maxHours7d.clause, R.maxHours7d.quote),
      line("maxHours14d", R.maxHours14d.clause, R.maxHours14d.quote),
    ],
  },
  {
    id: "shift-length",
    label: "Longest shift",
    keywords: ["longest shift", "shift length", "consecutive hours", "after noon", "long shift"],
    lines: [
      line("maxShiftHours", R.maxShiftHours.clause, R.maxShiftHours.quote),
      line("maxShiftHoursAfterNoon", R.maxShiftHoursAfterNoon.clause, R.maxShiftHoursAfterNoon.quote),
      line(
        "maxShiftHoursAfterNoon",
        R.maxShiftHoursAfterNoon.exception.clause,
        R.maxShiftHoursAfterNoon.exception.quote,
      ),
    ],
  },
  {
    id: "nights-in-a-row",
    label: "Nights in a row",
    keywords: ["nights in a row", "consecutive nights", "how many nights", "run of nights"],
    lines: [
      line("maxNightsInRow", R.maxNightsInRow.clause, R.maxNightsInRow.quote),
      line("maxNightsInRow", R.maxNightsInRow.clause, R.maxNightsInRow.exception.quote),
    ],
  },
  {
    id: "rest-after-nights",
    label: "Time off after nights",
    keywords: ["after nights", "rest after nights", "days off after nights", "straight after nights"],
    lines: [
      line("restAfterNights", R.restAfterNights.clause, R.restAfterNights.leadIn),
      ...R.restAfterNights.bands.map((band) => line("restAfterNights", R.restAfterNights.clause, band.quote)),
      line("restAfterNights", R.restAfterNights.clause, R.restAfterNights.caveat),
    ],
  },
  {
    id: "days-before-two-off",
    label: `Days in a row before ${R.maxDaysBeforeTwoDaysOff.hoursOff} h off`,
    keywords: ["days in a row", "consecutive days", "two days off", "48 hours off", "days without a break"],
    lines: [line("maxDaysBeforeTwoDaysOff", R.maxDaysBeforeTwoDaysOff.clause, R.maxDaysBeforeTwoDaysOff.quote)],
  },
];

export function isAgreementTopicId(value: string | null | undefined): value is AgreementTopicId {
  return AGREEMENT_TOPICS.some((topic) => topic.id === value);
}

export function agreementTopic(id: AgreementTopicId): AgreementTopic {
  return AGREEMENT_TOPICS.find((topic) => topic.id === id)!;
}

/** One clause as the sheet shows it: every quoted line that carries that clause number, in order. */
export interface AgreementClause {
  readonly clause: string;
  /** The topic headings the clause's lines belong to, for the sheet's subtitle. */
  readonly labels: readonly string[];
  readonly lines: readonly AgreementLine[];
}

/** Every clause PsychSift has quoted, in clause order, each line once. */
export function agreementClauses(): readonly AgreementClause[] {
  const byClause = new Map<string, { labels: string[]; lines: AgreementLine[] }>();
  for (const topic of AGREEMENT_TOPICS) {
    for (const item of topic.lines) {
      const entry = byClause.get(item.clause) ?? { labels: [], lines: [] };
      if (!entry.labels.includes(topic.label)) entry.labels.push(topic.label);
      if (!entry.lines.some((existing) => existing.text === item.text)) entry.lines.push(item);
      byClause.set(item.clause, entry);
    }
  }
  return [...byClause.entries()]
    .map(([clause, entry]) => ({ clause, labels: entry.labels, lines: entry.lines }))
    .sort((a, b) => compareClauses(a.clause, b.clause));
}

/** "15(3)(c)" before "15(4)(a)" before "15(6)(b)": numbers compared as numbers, letters as letters. */
function compareClauses(a: string, b: string): number {
  const parts = (value: string) => value.match(/\d+|[a-z]+/gi) ?? [];
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const x = left[index];
    const y = right[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const order = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : x.localeCompare(y);
    if (order !== 0) return order;
  }
  return 0;
}

export function agreementClause(clause: string): AgreementClause | null {
  return agreementClauses().find((entry) => entry.clause === clause) ?? null;
}

/** Topics the agreement has, that PsychSift has NOT checked. Named so the answer can say which one. */
export interface UncheckedTopic {
  readonly id: string;
  /** Sentence start: "Overtime". */
  readonly label: string;
}

const UNCHECKED_TOPICS: ReadonlyArray<UncheckedTopic & { readonly pattern: RegExp }> = [
  {
    id: "overtime",
    label: "Overtime",
    pattern:
      /\bover ?time\b|\bstay(?:ing|ed)? (?:back|late|on)\b|\bwork(?:ing|ed)? (?:late|back)\b|\bextra hours\b|\bunpaid hours\b|\bfinish(?:ing|ed)? late\b/,
  },
  {
    id: "leave",
    label: "Leave",
    pattern:
      /\bleave\b|\bholidays?\b(?! pay)|\bsick\b|\bcarer'?s\b|\bparental\b|\bmaternity\b|\bpaternity\b|\bbereavement\b|\bcompassionate\b|\blong service\b|\bexam (?:leave|days?)\b|\bstudy (?:leave|days?)\b|\bconference\b|\bdomestic violence\b|\btime off for\b/,
  },
  {
    id: "pay",
    label: "Pay and allowances",
    pattern:
      /\bpay\b|\bpaid\b|\bsalary\b|\bwages?\b|\bpenalt(?:y|ies)\b|\ballowances?\b|\bloading\b|\bmoney\b|\bsuper(?:annuation)?\b|\brates? of pay\b|\bpay rates?\b/,
  },
  {
    id: "public-holidays",
    label: "Public holidays",
    pattern: /\bpublic holidays?\b|\bchristmas\b|\beaster\b|\banzac\b/,
  },
  { id: "on-call", label: "On-call and recall", pattern: /\bon[- ]?call\b|\brecall(?:ed)?\b|\bcalled (?:back|in)\b/ },
  {
    id: "roster-notice",
    label: "Roster notice and changes",
    pattern: /\bnotice\b|\broster changes?\b|\bchang(?:e|ed|ing) (?:my |the )?roster\b|\bswap(?:s|ping)?\b/,
  },
  { id: "meal-breaks", label: "Meal breaks", pattern: /\bmeal\b|\blunch\b|\bcrib\b|\btea break\b/ },
  {
    id: "contract",
    label: "Contracts and ending a job",
    pattern: /\bcontracts?\b|\bterminat(?:e|ion|ed)\b|\bresign(?:ing|ation)?\b|\bfixed[- ]term\b|\bredundan/,
  },
  {
    id: "disputes",
    label: "Disputes and complaints",
    pattern: /\bdisputes?\b|\bgrievances?\b|\bbull(?:y|ied|ying)\b|\bharass(?:ed|ment)?\b|\bcomplain(?:t|ts)?\b/,
  },
  {
    id: "training",
    label: "Training and professional development",
    pattern: /\btraining\b|\bprofessional development\b|\bcpd\b|\bcme\b|\bpdl\b|\bcourses?\b/,
  },
  { id: "private", label: "Private work", pattern: /\bprivate (?:work|practice|patients?|clinic)\b/ },
];

/** Strong patterns score 2, weak ones 1. A topic needs 2, or the best weak score when nothing is strong. */
const TOPIC_PATTERNS: Readonly<Record<AgreementTopicId, { strong: RegExp[]; weak: RegExp[] }>> = {
  "break-between-shifts": {
    strong: [
      /\bbreaks? between\b/,
      /\bbetween (?:my |two |the )?(?:shifts|duty|duties|periods of duty)\b/,
      /\bturn ?arounds?\b/,
      /\bquick (?:return|turnaround|changeover)s?\b/,
      /\b(?:gap|rest|time|hours?) (?:off )?between\b/,
      /\b(?:10|ten) ?(?:hours?|h) (?:break|rest|off)\b/,
      /\bminimum break\b/,
    ],
    weak: [/\bback (?:in|on) (?:the )?next\b/, /\b(?:break|rest) after (?:a |my )?(?:shift|day|evening|late)\b/],
  },
  "hours-in-a-week": {
    strong: [
      /\bhours? (?:a|per|each|in a|in one|every) (?:week|fortnight)\b/,
      /\b(?:weekly|fortnightly) hours\b/,
      /\b(?:7|seven) (?:consecutive )?days\b/,
      /\b(?:14|fourteen) (?:consecutive )?days\b/,
      /\b(?:75|140) hours?\b/,
      /\b(?:max(?:imum)?|most|limit (?:on|of)) (?:hours|rostered hours)\b/,
      /\bhow many hours (?:can|could|may|am|will|should)\b/,
      /\btoo many hours\b/,
    ],
    weak: [/\bfortnight\b/, /\bhours\b.*\bweek\b/],
  },
  "shift-length": {
    strong: [
      /\b(?:longest|long|length of (?:a |my )?|max(?:imum)?|most) shifts?\b/,
      /\bshifts? (?:length|be|last|go)\b/,
      /\bhow long (?:can|could|is|may|should) (?:a |my |the )?shifts?\b/,
      /\bconsecutive hours\b/,
      /\b(?:12|13|14|twelve|thirteen|fourteen) ?(?:hours?|h)(?: shifts?| straight| in a row)\b/,
      /\bdouble shifts?\b/,
      /\b(?:after|past) (?:12 )?noon\b/,
      /\bafternoon start\b/,
    ],
    weak: [/\bhours? straight\b/, /\bhours? in a row\b/],
  },
  "nights-in-a-row": {
    strong: [
      /\bnights? in a row\b/,
      /\bconsecutive nights?\b/,
      /\b(?:how many|max(?:imum)?|most|limit (?:on|of)) (?:consecutive )?nights?\b/,
      /\b(?:4|5|6|7|four|five|six|seven) nights\b(?! off)/,
      /\b(?:run|block|string|stretch|set) of nights\b/,
    ],
    weak: [],
  },
  "rest-after-nights": {
    strong: [
      /\b(?:after|following|post)[- ](?:(?:a|my|the|doing|working|finishing|single|consecutive|run of|block of|string of|set of|\d+|one|two|three|four|five)\s+)*nights?\b/,
      /\b(?:rest|recover(?:y)?|days? off|time off|hours? off|free) (?:after|following|from) (?:\w+ )*?nights?\b/,
      /\bstraight after\b/,
    ],
    weak: [],
  },
  "days-before-two-off": {
    strong: [
      /\bdays? in a row\b/,
      /\bconsecutive days\b/,
      /\b(?:12|twelve|13|thirteen|14|fourteen) days\b(?! off)/,
      /\bwithout (?:a |any )?(?:days? off|break|weekend|rest)\b/,
      /\b(?:two|2) days off\b/,
      /\b(?:48|forty eight) ?(?:hours?|h) (?:off|free)\b/,
      /\bstraight days\b/,
    ],
    weak: [/\bdays? off\b/, /\bweekends? off\b/],
  },
};

/** Lower case, plain spacing, and the shorthand people type turned into words the patterns know. */
export function normaliseAgreementQuestion(question: string): string {
  return ` ${question} `
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, " and ")
    .replace(/\bo\/t\b/g, "overtime")
    .replace(/\bot\b/g, "overtime")
    .replace(/(\d)\s*(?:hrs?|hours?)\b/g, "$1 hours")
    .replace(/\bhrs?\b/g, "hours")
    .replace(/\bwks?\b/g, "week")
    .replace(/\bconsec\b/g, "consecutive")
    .replace(/\bnites?\b/g, (word) => (word.endsWith("s") ? "nights" : "night"))
    .replace(/\bnight shifts\b/g, "nights")
    .replace(/\bnight shift\b/g, "night")
    .replace(/\bnight duty\b/g, "nights")
    .replace(/[^a-z0-9'/\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NIGHTS_IN_A_ROW_ASKED =
  /\bnights? in a row\b|\bconsecutive nights?\b|\b(?:how many|max(?:imum)?|most|limit (?:on|of)) (?:consecutive )?nights?\b|\b(?:run|block|string|stretch|set) of nights\b/;

function scoreTopics(text: string): AgreementTopicId[] {
  const scores = AGREEMENT_TOPICS.map((topic) => {
    const patterns = TOPIC_PATTERNS[topic.id];
    const strong = patterns.strong.some((pattern) => pattern.test(text)) ? 2 : 0;
    const weak = patterns.weak.some((pattern) => pattern.test(text)) ? 1 : 0;
    return { id: topic.id, score: strong + weak };
  });
  const strong = scores.filter((entry) => entry.score >= 2);
  let chosen = strong;
  if (!chosen.length) {
    const best = Math.max(0, ...scores.map((entry) => entry.score));
    chosen = best > 0 ? scores.filter((entry) => entry.score === best) : [];
  }
  let ids = chosen.sort((a, b) => b.score - a.score).map((entry) => entry.id);
  // "Days off after nights" is the rest-after-nights clause, not the 12 days rule.
  if (ids.includes("rest-after-nights")) {
    // A count of nights ("after 4 nights") is the rest question, not the nights-in-a-row one.
    if (!NIGHTS_IN_A_ROW_ASKED.test(text)) ids = ids.filter((id) => id !== "nights-in-a-row");
    if (!TOPIC_PATTERNS["days-before-two-off"].strong.some((p) => p.test(text))) {
      ids = ids.filter((id) => id !== "days-before-two-off");
    }
  }
  return ids.slice(0, 3);
}

function uncheckedTopicsIn(text: string): UncheckedTopic[] {
  return UNCHECKED_TOPICS.filter((topic) => topic.pattern.test(text)).map(({ id, label }) => ({ id, label }));
}

/** The agreement as PsychSift holds it: title, citation, link and dates, for every answer and sheet. */
export interface AgreementSource {
  readonly title: string;
  readonly citation: string;
  readonly url: string;
  /** "3 Oct 2026". */
  readonly checkedOn: string;
  /** "2 Sep 2027". */
  readonly expiresOn: string;
  /** True once the expiry date has passed: it stays in force until a new agreement is made. */
  readonly pastExpiry: boolean;
}

export function agreementSource(today: string = todayIso()): AgreementSource {
  const { source } = FATIGUE_RULE_SET;
  return {
    title: source.title,
    citation: source.citation,
    url: source.url,
    checkedOn: formatRecordedDate(source.checkedOn),
    expiresOn: formatRecordedDate(source.expiresOn),
    pastExpiry: today > source.expiresOn,
  };
}

function todayIso(now: number = Date.now()): string {
  // Perth is UTC+8 all year.
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Whether a named clinician has signed off the quotes, in plain words. */
export interface AgreementSignOffState {
  readonly signedOff: boolean;
  /** Null when signed off. Otherwise why not, in plain words. */
  readonly reason: string | null;
  /** "Signed off by Josh Simpson on 4 Oct 2026", only while the gate is on. */
  readonly signedLine: string | null;
}

export function agreementSignOffState(gate: RuleGate = restRulesGate()): AgreementSignOffState {
  if (!gate.on) return { signedOff: false, reason: RULE_GATE_REASON_WORDS[gate.reason], signedLine: null };
  const { signedBy, signedAt } = FATIGUE_RULES_SIGN_OFF;
  const on = signedAt && !Number.isNaN(Date.parse(signedAt)) ? formatRecordedDate(perthCalendarDate(signedAt)) : null;
  return {
    signedOff: true,
    reason: null,
    signedLine: signedBy ? `Signed off by ${signedBy}${on ? ` on ${on}` : ""}` : "Signed off",
  };
}

/** Drops a preposition left dangling where the patient detail was cut out: "late with after nights". */
function tidySafer(text: string): string | null {
  const tidy = text
    .replace(/\b(?:with|for|about|from|by|of|re)\s+(?=(?:after|before|with|for|about|on|in|at|from)\b)/gi, "")
    .replace(/\s+(?:with|for|about|from|by|of|re|and)\s*[?.!]?$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return tidy.split(" ").length >= 2 ? tidy : null;
}

export type AgreementQuestionCheck =
  | { readonly kind: "empty" }
  | { readonly kind: "too-short" }
  | { readonly kind: "patient"; readonly safer: string | null; readonly what: string }
  | { readonly kind: "ok" };

/**
 * The patient-detail catch, run as the doctor types. Both detectors run: the work search's
 * (record numbers, beds, dates of birth, titles and names) and the reminder check (initials,
 * ages, phone numbers). Leaning towards a false alarm is deliberate: it costs one tap.
 */
export function checkAgreementQuestion(question: string, thisYear = new Date().getFullYear()): AgreementQuestionCheck {
  const text = question.trim();
  if (!text) return { kind: "empty" };
  const problem: ReminderTextProblem | null = checkReminderText(text);
  if (looksLikePatientDetails(text, thisYear) || problem) {
    const safer = problem?.suggestion ? tidySafer(problem.suggestion) : null;
    const stillUnsafe = safer ? looksLikePatientDetails(safer, thisYear) || checkReminderText(safer) !== null : true;
    return {
      kind: "patient",
      safer: stillUnsafe ? null : safer,
      what: problem ? problem.title.replace(/^This looks like /, "") : "patient details",
    };
  }
  if (text.length < 3) return { kind: "too-short" };
  return { kind: "ok" };
}

/** A stretch of the typed question, by character position, end exclusive. */
export interface AgreementTextSpan {
  readonly start: number;
  readonly end: number;
}

function readsAsPatientDetail(text: string, thisYear: number): boolean {
  return looksLikePatientDetails(text, thisYear) || checkReminderText(text) !== null;
}

/**
 * Where the patient detail sits in what was typed, so the catch can mark it ("overtime, UR 4471823"
 * marks the number). Read with the same two detectors as `checkAgreementQuestion`, over windows of
 * one to three words: a window is marked when it reads as a patient detail and no shorter window
 * inside it does, so the mark covers the detail and not the words around it. Empty when the
 * detail cannot be pinned to three words or fewer; the catch still shows, unmarked.
 */
export function agreementPatientSpans(question: string, thisYear = new Date().getFullYear()): AgreementTextSpan[] {
  const tokens = [...question.matchAll(/\S+/g)].map((match) => {
    const word = match[0];
    const lead = word.match(/^[("'[]+/)?.[0].length ?? 0;
    const trail = word.match(/[)"'\].,;:!?]+$/)?.[0].length ?? 0;
    const start = (match.index ?? 0) + Math.min(lead, word.length - 1);
    return { start, end: Math.max(start + 1, (match.index ?? 0) + word.length - trail) };
  });
  const flaggedAt = (from: number, size: number) =>
    readsAsPatientDetail(question.slice(tokens[from]!.start, tokens[from + size - 1]!.end), thisYear);
  const marked = new Set<number>();
  for (let size = 1; size <= 3; size += 1) {
    for (let from = 0; from + size <= tokens.length; from += 1) {
      if (!flaggedAt(from, size)) continue;
      // Shorter windows inside this one already carry the detail: they were marked at their own size.
      if (size > 1 && (flaggedAt(from, size - 1) || flaggedAt(from + 1, size - 1))) continue;
      for (let index = from; index < from + size; index += 1) marked.add(index);
      // "UR 4471823": the label in front of a number is part of the detail too.
      const before = from > 0 ? question.slice(tokens[from - 1]!.start, tokens[from - 1]!.end) : "";
      if (/^(?:u\.?r\.?n?|umrn|mrn|nhi|medicare|dob)$/i.test(before)) marked.add(from - 1);
    }
  }
  const spans: AgreementTextSpan[] = [];
  for (const index of [...marked].sort((a, b) => a - b)) {
    const token = tokens[index]!;
    const last = spans[spans.length - 1];
    if (last && marked.has(index - 1)) spans[spans.length - 1] = { start: last.start, end: token.end };
    else spans.push({ start: token.start, end: token.end });
  }
  return spans;
}

export type AgreementAnswer =
  | {
      readonly kind: "quoted";
      readonly question: string;
      readonly topics: readonly AgreementTopic[];
      /** Topics also asked about that are not in the checked clauses, named honestly. */
      readonly unchecked: readonly UncheckedTopic[];
      readonly signOff: AgreementSignOffState;
      readonly source: AgreementSource;
    }
  | {
      readonly kind: "not-checked";
      readonly question: string;
      readonly unchecked: readonly UncheckedTopic[];
      readonly source: AgreementSource;
    }
  | { readonly kind: "patient"; readonly question: string; readonly safer: string | null; readonly what: string }
  | { readonly kind: "empty" };

export interface AgreementAnswerOptions {
  readonly gate?: RuleGate;
  readonly today?: string;
  readonly thisYear?: number;
}

/** The answer to a typed question: verbatim quotes, an honest "not checked", or the patient catch. */
export function answerAgreementQuestion(question: string, options: AgreementAnswerOptions = {}): AgreementAnswer {
  const trimmed = question.trim().slice(0, AGREEMENT_QUESTION_LIMIT);
  const check = checkAgreementQuestion(trimmed, options.thisYear);
  if (check.kind === "empty" || check.kind === "too-short") return { kind: "empty" };
  if (check.kind === "patient") return { kind: "patient", question: trimmed, safer: check.safer, what: check.what };
  const text = normaliseAgreementQuestion(trimmed);
  const source = agreementSource(options.today);
  const ids = scoreTopics(text);
  const unchecked = uncheckedTopicsIn(text);
  if (!ids.length) return { kind: "not-checked", question: trimmed, unchecked, source };
  return {
    kind: "quoted",
    question: trimmed,
    topics: ids.map(agreementTopic),
    unchecked,
    signOff: agreementSignOffState(options.gate),
    source,
  };
}

/** The answer for a topic opened directly (a suggestion, the work search or a deep link). */
export function answerAgreementTopic(id: AgreementTopicId, options: AgreementAnswerOptions = {}): AgreementAnswer {
  const topic = agreementTopic(id);
  return {
    kind: "quoted",
    question: topic.label,
    topics: [topic],
    unchecked: [],
    signOff: agreementSignOffState(options.gate),
    source: agreementSource(options.today),
  };
}

/** Plain sentence naming what was not checked: "PsychSift hasn't checked the clauses on overtime." */
export function uncheckedSentence(unchecked: readonly UncheckedTopic[]): string {
  if (!unchecked.length) return "This is not in the clauses PsychSift has checked.";
  const names = unchecked.map((topic) => topic.label.toLowerCase());
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  return `PsychSift hasn’t checked the clauses on ${list}.`;
}

export const AGREEMENT_CHECKED_SCOPE = "So far only the hours and rest parts of clause 15 (Hours of duty) are checked.";

/** Questions offered before typing. Each one matches a checked topic, so none leads to a dead end. */
export const AGREEMENT_SUGGESTED_QUESTIONS: readonly string[] = [
  "How long a break between shifts?",
  "Can I be rostered straight after nights?",
  "How many nights in a row can I work?",
  "What is the most hours in a week?",
  "How long can a shift be?",
  "How many days in a row before two days off?",
];

export interface AgreementSuggestion {
  readonly questions: readonly string[];
  readonly topics: readonly AgreementTopic[];
}

/** As-you-type: suggested questions and topics whose words start with what was typed. */
export function agreementSuggestions(partial: string): AgreementSuggestion {
  const words = normaliseAgreementQuestion(partial)
    .split(" ")
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
  if (!words.length) return { questions: [], topics: [] };
  const matches = (haystack: string) => {
    const tokens = normaliseAgreementQuestion(haystack).split(" ");
    return words.every((word) => tokens.some((token) => token.startsWith(word)));
  };
  const questions = AGREEMENT_SUGGESTED_QUESTIONS.filter(matches).slice(0, 3);
  const topics = AGREEMENT_TOPICS.filter((topic) => matches([topic.label, ...topic.keywords].join(" "))).slice(0, 4);
  return { questions, topics };
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "i",
  "am",
  "is",
  "be",
  "do",
  "can",
  "my",
  "me",
  "of",
  "to",
  "in",
  "on",
  "for",
  "how",
  "what",
  "when",
  "it",
  "if",
  "are",
  "get",
]);

/** Question words that say nothing about which clause is meant. */
const SEARCH_STOP_WORDS = new Set([
  ...STOP_WORDS,
  "any",
  "are",
  "could",
  "does",
  "got",
  "has",
  "have",
  "many",
  "much",
  "need",
  "should",
  "there",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

export interface AgreementClauseMatch {
  readonly clause: AgreementClause;
  /** The quoted lines that hold the words, in clause order. */
  readonly lines: readonly AgreementLine[];
  /** How many of the typed words were found, for ordering. */
  readonly found: number;
}

/**
 * Plain word search over the clause text PsychSift holds (the quotes and their headings), no AI.
 * A clause is listed when any typed word (three letters or more, question words left out) starts a
 * word in it; clauses holding more of the words come first, then clause order. Works offline,
 * because the text is built in.
 */
export function searchAgreementClauses(query: string): readonly AgreementClauseMatch[] {
  const words = [
    ...new Set(
      normaliseAgreementQuestion(query)
        .split(" ")
        .filter((word) => word.length >= 3 && !SEARCH_STOP_WORDS.has(word)),
    ),
  ];
  if (!words.length) return [];
  const has = (text: string, word: string) =>
    normaliseAgreementQuestion(text)
      .split(" ")
      .some((token) => token.startsWith(word));
  const matches: AgreementClauseMatch[] = [];
  for (const clause of agreementClauses()) {
    const found = words.filter(
      (word) => clause.labels.some((label) => has(label, word)) || clause.lines.some((line) => has(line.text, word)),
    );
    if (!found.length) continue;
    const lines = clause.lines.filter((line) => found.some((word) => has(line.text, word)));
    matches.push({ clause, lines, found: found.length });
  }
  return matches.sort((a, b) => b.found - a.found || compareClauses(a.clause.clause, b.clause.clause));
}

/** The words a highlight should mark in a suggestion, from what was typed. */
export function agreementHighlightWords(partial: string): string[] {
  return normaliseAgreementQuestion(partial)
    .split(" ")
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
}

/** Plain text for the clipboard: every quote with its clause, the source, and the sign-off state. */
export function agreementAnswerCopyText(answer: AgreementAnswer): string {
  if (answer.kind === "quoted") {
    const lines = answer.topics.flatMap((topic) => [
      topic.label,
      ...topic.lines.map((item) => `"${item.text}" (clause ${item.clause})`),
      "",
    ]);
    const notes = [
      answer.unchecked.length ? uncheckedSentence(answer.unchecked) : null,
      answer.signOff.signedOff
        ? `${answer.signOff.signedLine}.`
        : "Not signed off yet: no named clinician has compared these quotes with the agreement.",
      `${answer.source.title}, ${answer.source.citation}: ${answer.source.url}`,
      `Not sure, or disagree? ${AGREEMENT_UNION_NAME}, your union.`,
    ].filter((value): value is string => Boolean(value));
    return [...lines, ...notes].join("\n");
  }
  if (answer.kind === "not-checked") {
    return [
      uncheckedSentence(answer.unchecked),
      `Open the agreement: ${answer.source.title}, ${answer.source.citation}: ${answer.source.url}`,
      `Not sure, or disagree? ${AGREEMENT_UNION_NAME}, your union.`,
    ].join("\n");
  }
  return "";
}

export function agreementClauseCopyText(clause: AgreementClause, source: AgreementSource = agreementSource()): string {
  return [
    `Clause ${clause.clause}, ${source.title} (${source.citation})`,
    ...clause.lines.map((item) => `"${item.text}"`),
    source.url,
  ].join("\n");
}

/** Deep link to a topic. Only fixed ids go in the URL, never the typed question. */
export function agreementTopicHref(id: AgreementTopicId): string {
  return `${AGREEMENT_PAGE_HREF}?topic=${id}`;
}

export function agreementClauseHref(clause: string): string {
  return `${AGREEMENT_PAGE_HREF}?clause=${encodeURIComponent(clause)}`;
}

/* ------------------------------------------------------------------ */
/* For the main build to wire into Search my work (work search).       */
/* ------------------------------------------------------------------ */

/** A searchable record in the shape the work search providers use. */
export interface AgreementWorkSearchRecord {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  /** Roster, because the rest rules are the limits a roster is checked against. */
  readonly area: WorkSearchArea;
  readonly keywords: readonly string[];
  readonly href: string;
}

/** One record per checked topic, plus the page itself. */
export function agreementWorkSearchRecords(): readonly AgreementWorkSearchRecord[] {
  return [
    {
      id: "agreement:page",
      title: "Ask the agreement",
      detail: "Breaks, shift length, nights and weekly hours, quoted by clause",
      area: "roster",
      keywords: [
        "agreement",
        "award",
        "industrial agreement",
        "ama",
        "clause",
        "entitlement",
        "rights",
        "union",
        "rules",
      ],
      href: AGREEMENT_PAGE_HREF,
    },
    ...AGREEMENT_TOPICS.map((topic) => ({
      id: `agreement:${topic.id}`,
      title: topic.label,
      detail: `Agreement clause ${[...new Set(topic.lines.map((item) => item.clause))].join(", ")}`,
      area: "roster" as const,
      keywords: [...topic.keywords, "agreement", "clause"],
      href: agreementTopicHref(topic.id),
    })),
  ];
}

/** Words that make a question an entitlement question, so "overtime" alone stays an ordinary search. */
const ENTITLEMENT_CUE =
  /\b(?:agreement|award|entitled|entitlement|allowed|owed|rights?|can i be|can they|are they allowed|is it legal|clause|ama)\b/;

export interface AgreementWorkSearchAnswer {
  readonly kind: "quoted" | "not-checked";
  readonly title: string;
  /** The first verbatim quote, or the honest not-checked line. */
  readonly detail: string;
  readonly clauses: readonly string[];
  readonly signedOff: boolean;
  /** Fixed ids only, never the typed text. */
  readonly href: string;
  readonly union: string;
}

/**
 * A built-in answer for the work search. Null when the question is not about the agreement, or
 * looks like patient details (the work search shows its own catch then).
 */
export function agreementWorkSearchAnswer(
  query: string,
  options: AgreementAnswerOptions = {},
): AgreementWorkSearchAnswer | null {
  const answer = answerAgreementQuestion(query, options);
  if (answer.kind === "quoted") {
    const first = answer.topics[0]!;
    return {
      kind: "quoted",
      title: answer.topics.map((topic) => topic.label).join(" · "),
      detail: first.lines[0]!.text,
      clauses: [...new Set(answer.topics.flatMap((topic) => topic.lines.map((item) => item.clause)))],
      signedOff: answer.signOff.signedOff,
      href: agreementTopicHref(first.id),
      union: AGREEMENT_UNION_NAME,
    };
  }
  if (answer.kind === "not-checked" && ENTITLEMENT_CUE.test(normaliseAgreementQuestion(query))) {
    return {
      kind: "not-checked",
      title: "Ask the agreement",
      detail: `${uncheckedSentence(answer.unchecked)} Open the agreement.`,
      clauses: [],
      signedOff: false,
      href: AGREEMENT_PAGE_HREF,
      union: AGREEMENT_UNION_NAME,
    };
  }
  return null;
}
