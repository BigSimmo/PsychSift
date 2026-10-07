import { onCallDigitsOf, onCallSearchTerms } from "@/lib/on-call/entry-search";

/**
 * How "Search my work" reads the words typed, so the forms people actually use
 * still find a record: plurals ("sessions"), shorthand ("ns", "pdl", "cme"),
 * spelled-out months and weekdays ("october" finds "12 Oct"), and hyphens
 * ("on-call" finds "On call"). Each typed word becomes a few alternatives;
 * a record matches the word when any alternative appears in it.
 */

export interface TermAlternative {
  readonly text: string;
  readonly digits: string;
  /** Also accept a word one letter out ("rostr", "sesion"): only for the typed word itself, five letters or more. */
  readonly fuzzy: boolean;
}

const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  ns: ["night"],
  nite: ["night"],
  nites: ["night"],
  overnight: ["night"],
  overnights: ["night"],
  nightshift: ["night"],
  nightshifts: ["night"],
  late: ["evening"],
  lates: ["evening"],
  pm: ["evening"],
  oncall: ["on call"],
  callback: ["on call"],
  cme: ["cpd"],
  cpd: ["cme"],
  points: ["cpd"],
  mandatory: ["compliance", "mandatory"],
  ppe: ["mask fit"],
  respirator: ["mask fit"],
  fit: ["fit test"],
  pdl: ["study leave", "professional development leave"],
  holiday: ["leave"],
  holidays: ["leave"],
  vacation: ["annual"],
  al: ["annual leave"],
  "a/l": ["annual leave"],
  annual: ["annual leave"],
  sick: ["personal leave", "sick leave"],
  personal: ["personal leave"],
  study: ["study leave"],
  exam: ["exam leave", "study leave"],
  timeoff: ["leave"],
  trade: ["swap"],
  locum: ["open shift"],
  extra: ["open shift"],
  talk: ["presenting"],
  talks: ["presenting"],
  presentation: ["presenting"],
  presentations: ["presenting"],
  lecture: ["teaching"],
  tutorial: ["teaching"],
  renewal: ["renew"],
  renewals: ["renew"],
  expiring: ["expiry"],
  expires: ["expiry"],
  rego: ["registration"],
  ahpra: ["registration"],
  bls: ["basic life support"],
  als: ["advanced life support"],
  mha: ["mental health act"],
  ect: ["electroconvulsive"],
  ranzcp: ["college"],
  pd: ["professional development"],
  wwc: ["working with children"],
};

const MONTHS: Readonly<Record<string, string>> = {
  january: "jan",
  february: "feb",
  march: "mar",
  april: "apr",
  june: "jun",
  july: "jul",
  august: "aug",
  september: "sep",
  sept: "sep",
  october: "oct",
  november: "nov",
  december: "dec",
};

const WEEKDAYS: Readonly<Record<string, string>> = {
  monday: "mon",
  tuesday: "tue",
  tues: "tue",
  wednesday: "wed",
  thursday: "thu",
  thurs: "thu",
  friday: "fri",
  saturday: "sat",
  sunday: "sun",
};

/** Words that shape a question but name nothing to find: "when am I next on nights" searches "nights". */
const QUESTION_WORDS = new Set([
  "when",
  "what",
  "whats",
  "what's",
  "where",
  "which",
  "who",
  "how",
  "many",
  "much",
  "next",
  "is",
  "am",
  "are",
  "do",
  "does",
  "the",
  "my",
  "me",
  "any",
  "have",
  "find",
  "show",
  "for",
  "and",
  "with",
  "about",
]);

/** "sessions" → "session", "renewals" → "renewal", "activities" → "activity". Leaves short words alone. */
export function singularOf(word: string): string | null {
  if (word.length <= 3 || word.endsWith("ss")) return null;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(?:ch|sh|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return null;
}

function alternativesOf(term: string): TermAlternative[] {
  const plain = term.replace(/[.,;:!?'"()]+/g, "");
  const words = new Set<string>([term]);
  if (plain) words.add(plain);
  if (plain.includes("-")) words.add(plain.replace(/-/g, " "));
  const singular = singularOf(plain);
  if (singular) words.add(singular);
  for (const synonym of SYNONYMS[plain] ?? []) words.add(synonym);
  const month = MONTHS[plain];
  if (month) words.add(month);
  const weekday = WEEKDAYS[plain];
  if (weekday) words.add(weekday);
  return [...words]
    .filter((word) => word.length > 0)
    .map((text) => ({
      text,
      digits: onCallDigitsOf(text),
      fuzzy: text === plain && text.length >= 5 && !/\d/.test(text),
    }));
}

/**
 * The query as a list of words, each with its alternatives. One- and two-letter
 * words are dropped when longer words are present ("a", "on", "my" add nothing
 * but noise). Every word matches at the start of a word, so "form" finds
 * "Leave form" but not "informed".
 */
export function workSearchTerms(query: string): TermAlternative[][] {
  const terms = onCallSearchTerms(query.replace(/[?!,]+/g, " "));
  const meaningful = terms.filter(
    (term) => !QUESTION_WORDS.has(term) && (term.length >= 3 || onCallDigitsOf(term).length >= 2 || SYNONYMS[term]),
  );
  const kept = meaningful.length > 0 ? meaningful : terms;
  return kept.map((term) => alternativesOf(term));
}

/** True when `a` and `b` differ by at most one letter added, removed, changed or swapped. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const startCache = new Map<string, RegExp>();

function wordStartPattern(text: string): RegExp {
  let pattern = startCache.get(text);
  if (!pattern) {
    pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(text)}`, "u");
    if (startCache.size > 500) startCache.clear();
    startCache.set(text, pattern);
  }
  return pattern;
}

/** Whether one alternative appears, at the start of a word, in a field already lower-cased. */
export function alternativeMatches(field: string, alternative: TermAlternative): boolean {
  if (field.includes(alternative.text) && wordStartPattern(alternative.text).test(field)) return true;
  if (alternative.digits.length >= 2 && onCallDigitsOf(field).includes(alternative.digits)) return true;
  if (alternative.fuzzy) {
    return field.split(/[^\p{L}\p{N}]+/u).some((word) => word.length >= 4 && withinOneEdit(word, alternative.text));
  }
  return false;
}

/** Every word to underline in a title: the typed words plus their alternatives. */
export function highlightWords(query: string): string[] {
  return [
    ...new Set(
      workSearchTerms(query)
        .flat()
        .map((alternative) => alternative.text)
        .filter((text) => text.length >= 2),
    ),
  ];
}
