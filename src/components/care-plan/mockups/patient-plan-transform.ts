import type {
  ManagementPlanContent,
  ManagementPlanVersion,
  Patient,
  PatientPlanSection,
  PatientPlanSectionKey,
  PatientResource,
  SyntheticId,
} from "./types";
import { PATIENT_PLAN_SECTION_KEYS } from "./types";

/**
 * Care Plan — the deterministic, offline Patient Plan transformation.
 *
 * `buildPatientPlanDraft` turns one approved Management Plan Version into a
 * draft of the same content in the person's own voice. It is a pure function of
 * its three arguments: no network, storage, timer, randomness, wall clock, or
 * model call, and nothing imported from outside this namespace. The same inputs
 * always produce the same output, byte for byte.
 *
 * **No language model is reachable from any part of this.** That is a product
 * boundary rather than an implementation convenience, and it is the reason the
 * transformation is shaped the way it is. A model asked to "rewrite this for a
 * patient" produces fluent, confident, wrong sentences about somebody's care and
 * leaves a reader no way to tell which ones. This does the opposite: it converts
 * only what it can convert by rule, and everything else becomes a visible gap
 * with a stated reason, for a clinician to write.
 *
 * The seam is the function boundary. A later model-backed implementation can
 * replace this function without touching the version model, the approval step,
 * or any screen — provided it keeps the same contract: a gap rather than a
 * guess.
 *
 * ## Why free rewriting is not attempted
 *
 * Swapping words inside arbitrary sentences produces confident nonsense. This
 * works only because a Management Plan is already eleven fields with known
 * meanings, so the transformation never has to work out what a sentence is
 * *for*: the field it came from already says. Each field maps to a known
 * patient-voice heading, a curated dictionary replaces clinical vocabulary with
 * everyday words, and the shift to second person is a bounded substitution of
 * the person's own name and pronouns — with verb agreement read from a table,
 * never inferred.
 *
 * ## Everything not confidently convertible is a gap
 *
 * A section gaps whole. It never carries part of its content, because three of
 * five points with two silently dropped looks finished and is not.
 *
 * The result is an incomplete draft by design, and often a mostly incomplete
 * one. That is the intended outcome, not a shortfall: the machine does the part
 * it can do safely, a clinician writes the rest with the person, and approval is
 * refused until they have.
 */

/** The eight headings, in `PATIENT_PLAN_SECTION_KEYS` order, in the person's
 *  own voice. Written as somebody would say them, never as a field name. */
export const PATIENT_PLAN_SECTION_HEADING: Record<PatientPlanSectionKey, string> = {
  whyWeWroteThis: "Why we wrote this together",
  whatMattersToYou: "What matters to you",
  whatHelpsYou: "What helps you",
  whatMakesThingsHarder: "What makes things harder",
  whatWeAgreedWillHappen: "What we agreed will happen when you come to the emergency department",
  ifSomethingNewIsHappening: "If something new is happening",
  whoIsInvolved: "Who's involved in your care",
  thingsThatMightHelp: "Things that might help",
};

/**
 * A fixed sentence under each heading, addressed to the person. This is where
 * the framing shift actually lives: the heading and this line set the voice, so
 * the content underneath needs only its own words changed rather than being
 * rewritten into a second person it was never written in.
 *
 * None of them tells the person what to do, thanks them for cooperating, or
 * describes them. They say what the section is.
 */
export const PATIENT_PLAN_SECTION_LEAD_IN: Record<PatientPlanSectionKey, string> = {
  whyWeWroteThis: "This is what we wrote down about why this plan exists.",
  whatMattersToYou: "These are the things you have said matter to you.",
  whatHelpsYou: "These are the things that have helped before.",
  whatMakesThingsHarder: "These are the things that have made a visit harder, so we can try to avoid them.",
  whatWeAgreedWillHappen: "This is the approach you and your team agreed for when you come in.",
  ifSomethingNewIsHappening:
    "This plan is about what usually happens. If something is different this time, say so — you will be looked at afresh.",
  whoIsInvolved: "These are the people and teams who know you.",
  thingsThatMightHelp: "These are practical things that can be arranged for you.",
};

/**
 * Which clinical fields each patient-voice heading is built from. Two fields are
 * deliberately absent, and there is no ninth section.
 */
export const PATIENT_PLAN_SECTION_SOURCES: Record<PatientPlanSectionKey, readonly (keyof ManagementPlanContent)[]> = {
  whyWeWroteThis: ["whyThisPlanExists"],
  whatMattersToYou: ["whatThePersonWants"],
  whatHelpsYou: ["whatHelps"],
  whatMakesThingsHarder: ["whatMakesItWorse"],
  whatWeAgreedWillHappen: ["agreedEdApproach"],
  ifSomethingNewIsHappening: ["whatWouldMakeThisDifferent", "reviewTriggers"],
  whoIsInvolved: ["whoElseIsInvolved"],
  thingsThatMightHelp: ["practicalNeeds"],
};

/**
 * The content fields no heading is built from. Stated here rather than left as
 * an absence, so a missing mapping reads as a decision instead of an oversight,
 * and a test proves every field is either mapped above or named here.
 *
 * `physicalHealthAndMedication` — the person has their own record of their
 * medicines, and copying medication detail onto a sheet that leaves the building
 * is a privacy cost with nothing bought by it.
 *
 * `howToApproach` — written in the imperative, to staff. Converted onto the
 * person's own copy it becomes a set of instructions to *them*, which was the
 * worst thing the first run of this transformation produced: "You asked not to
 * take part in writing this plan. Say so plainly when you use it, and offer
 * again to write it together", printed on the plan of the person it describes.
 * What this field holds that the person needs is already in `whatHelps`, said
 * from their side; the rest is how a stranger should open a conversation, which
 * is not theirs to be handed.
 */
export const PATIENT_PLAN_OMITTED_CONTENT_KEYS = [
  "physicalHealthAndMedication",
  "howToApproach",
] as const satisfies readonly (keyof ManagementPlanContent)[];

/**
 * The one section that is never converted, whatever it contains.
 *
 * It carries the agreed emergency-department approach and any position on
 * admission. It is where a wording slip does the most harm, and it is the
 * section a person is most likely to read as a judgement about them rather than
 * as an agreement they were part of. So it is written by a clinician every time,
 * and no content, however plain, makes it eligible for conversion.
 */
export const NEVER_CONVERTED_SECTION_KEYS = [
  "whatWeAgreedWillHappen",
] as const satisfies readonly PatientPlanSectionKey[];

// --- The curated dictionary ------------------------------------------------------

/**
 * Clinical vocabulary with a confident everyday equivalent.
 *
 * An entry is only allowed here when the replacement is safe wherever the term
 * appears — noun for noun, verb for verb, adjective for adjective — because the
 * substitution is not grammar-aware, and a swap that fits one sentence and
 * breaks the next is exactly the confident nonsense this design exists to avoid.
 * A term whose replacement would depend on the sentence around it belongs in
 * `UNCONVERTIBLE_CLINICAL_TERMS` instead, where it gaps the section.
 *
 * Some entries map a term to itself. They are not redundant: an entry here also
 * marks a term as clinical, which is what makes a negation beside it a *clinical*
 * negation. "Emergency department" needs no plainer wording and still must not
 * be negated by a machine.
 *
 * Longest key first, so "community mental health team" is not part-converted by
 * "mental health team".
 */
export const PLAIN_LANGUAGE_TERMS: Record<string, string> = {
  "community mental health team": "mental health team",
  "mental health team": "mental health team",
  "general practitioner": "family doctor",
  "care coordinator": "main contact",
  "emergency department": "emergency department",
  "peer support": "peer support",
  "pain relief": "pain relief",
  "low-stimulus": "calm",
  "low stimulus": "calm",
  "short-stay": "short-stay",
  cmht: "mental health team",
  gp: "family doctor",
  clinician: "staff member",
  clinicians: "staff members",
  analgesia: "pain relief",
  escalated: "built up",
  escalates: "builds up",
  escalate: "build up",
  attends: "comes to",
  attended: "came to",
  attend: "come to",
  interpreter: "interpreter",
  ambulance: "ambulance",
};

/**
 * Clinical vocabulary with no everyday equivalent this transformation is willing
 * to commit to. A sentence containing one of these gaps.
 *
 * Several are ordinary English. They are here because each carries a clinical
 * meaning an everyday synonym would quietly change. "Distress" is not "upset". A
 * "presentation" is not "a visit" when the sentence is about a pattern over a
 * year. "Disposition" is not "where you go next". Getting any of them slightly
 * wrong on a document handed to the person it is about is worse than leaving a
 * clinician to write the sentence.
 *
 * The last group is different in kind: words that pass judgement on a person —
 * declined, refused, failed, resistant. Those never appear on somebody's own
 * copy by machine, whatever else the sentence says.
 */
export const UNCONVERTIBLE_CLINICAL_TERMS: readonly string[] = [
  "distress",
  "distressed",
  "triage",
  "disposition",
  "presentation",
  "presentations",
  "presenting",
  "mental-state",
  "safeguarding",
  "delirium",
  "overdose",
  "means",
  "preparation",
  "risk",
  "assessment",
  "assessments",
  "assessed",
  "assess",
  "admission",
  "admitted",
  "discharge",
  "discharged",
  "compliance",
  "compliant",
  "engagement",
  "prognosis",
  "diagnosis",
  "psychosis",
  "delusion",
  "hallucination",
  "sedation",
  "restraint",
  "seclusion",
  "detained",
  "capacity",
  "acuity",
  "severity",
  "chronic",
  "comorbid",
  "prescribing",
  "medication",
  "medicines",
  "dose",
  "doses",
  "allergy",
  "asthma",
  "seizure",
  "breathlessness",
  "drowsiness",
  "confusion",
  "disorientation",
  "conscious",
  "droop",
  "slurred",
  "infection",
  "obligations",
  "clinical",
  "continuity",
  "renegotiate",
  "attributing",
  "attributed",
  "deteriorate",
  "deterioration",
  "sensory",
  "conflict",
  "escalation",
  "accusation",
  // Physical red flags. These belong to the section about what makes a
  // presentation different, which is a clinical escalation list. Converted onto
  // a person's own sheet they read as a warning about their body written by
  // somebody who has not examined them.
  "physical",
  "medical",
  "medicine",
  "symptom",
  "symptoms",
  "chest",
  "fever",
  "injury",
  "limb",
  "weakness",
  "facial",
  "pregnancy",
  "substance",
  "attempt",
  "self-harm",
  "suicide",
  "suicidal",
  "harm",
  // Judgements about a person.
  "declined",
  "decline",
  "declines",
  "refused",
  "refuse",
  "failed",
  "fails",
  "resistant",
  "uncooperative",
  "unmotivated",
  "manipulative",
  "attention-seeking",
];

/**
 * Negation words. A negation gaps its section only when it sits in the same
 * sentence as a clinical term, whether or not that term has a replacement.
 *
 * The distinction does real work. "To have Jess contacted only with your
 * agreement on the day, not automatically" is a plain sentence about a
 * preference and converts safely. "Pain relief was not offered before the
 * mental-health assessment" substitutes cleanly word by word and still must not
 * be converted: a negated clinical statement that half-converts reverses its own
 * meaning, and a person reading a negated sentence about their own care is
 * exactly where blame lands.
 *
 * Contrastive words — "rather", "instead" — are deliberately absent. They
 * express a preference, not a negation, and treating them as one would gap
 * almost every sentence in this vocabulary while protecting nothing.
 */
export const CLINICAL_NEGATIONS: readonly string[] = [
  "not",
  "never",
  "no",
  "nor",
  "none",
  "nothing",
  "nobody",
  "neither",
  "without",
  "cannot",
  "unable",
];

/**
 * Third-person-singular present verbs and the second-person form each becomes
 * once the subject is "you". Substituting a subject without this produces "you
 * settles", which tells a reader the page was generated rather than written for
 * them.
 *
 * A verb absent from this table gaps its section rather than being guessed at by
 * a rule such as "drop the trailing s", which is wrong for every plural noun.
 */
export const THIRD_PERSON_VERBS: Record<string, string> = {
  is: "are",
  was: "were",
  has: "have",
  does: "do",
  goes: "go",
  says: "say",
  settles: "settle",
  finds: "find",
  prefers: "prefer",
  takes: "take",
  needs: "need",
  asks: "ask",
  wants: "want",
  likes: "like",
  feels: "feel",
  gets: "get",
  comes: "come",
  uses: "use",
  knows: "know",
  seems: "seem",
  tends: "tend",
  copes: "cope",
  sleeps: "sleep",
  eats: "eat",
  drinks: "drink",
  rings: "ring",
  calls: "call",
  waits: "wait",
  leaves: "leave",
  arrives: "arrive",
  agrees: "agree",
  chooses: "choose",
  reads: "read",
  writes: "write",
  hears: "hear",
  sees: "see",
  sits: "sit",
  stands: "stand",
  walks: "walk",
  lives: "live",
  works: "work",
  helps: "help",
  tells: "tell",
  brings: "bring",
  keeps: "keep",
  holds: "hold",
  carries: "carry",
  manages: "manage",
  remembers: "remember",
  forgets: "forget",
  understands: "understand",
  explains: "explain",
  notices: "notice",
  worries: "worry",
  wakes: "wake",
  rests: "rest",
  builds: "build",
  starts: "start",
  stops: "stop",
  stays: "stay",
  becomes: "become",
  makes: "make",
  gives: "give",
  puts: "put",
  looks: "look",
  thinks: "think",
  travels: "travel",
  visits: "visit",
};

/**
 * Words ending in `s` that are not third-person-singular verbs, so a subject
 * substitution in front of them changes nothing.
 *
 * This list exists so the agreement check can fail closed. Every `s`-ending word
 * in the everyday vocabulary must be classified here or in `THIRD_PERSON_VERBS`,
 * and a test proves it — so a word added to the vocabulary later cannot quietly
 * become an unchecked verb.
 */
export const AGREEMENT_SAFE_S_WORDS: readonly string[] = [
  "across",
  // A noun here, and already the second-person form when it is a verb.
  "address",
  "afterwards",
  "always",
  "appointments",
  "arrangements",
  "as",
  "bills",
  "bus",
  "clothes",
  "days",
  "guess",
  "details",
  "doors",
  "evenings",
  "families",
  "friends",
  "glasses",
  "groups",
  "his",
  "hours",
  "its",
  "less",
  "lights",
  "lists",
  "meals",
  "meetings",
  "members",
  "minutes",
  "months",
  "mornings",
  "names",
  "news",
  "nights",
  "noises",
  "notes",
  "numbers",
  "nurses",
  "options",
  "otherwise",
  "papers",
  "people's",
  "perhaps",
  "places",
  "plans",
  "plus",
  "pronouns",
  "questions",
  "reasons",
  "rooms",
  "seats",
  "services",
  "sessions",
  "signs",
  "sometimes",
  "sounds",
  "staff's",
  "steps",
  "teams",
  "themselves",
  "things",
  "this",
  "times",
  "towards",
  "unless",
  "upstairs",
  "us",
  "ways",
  "weeks",
  "words",
  "years",
  "yes",
];

/**
 * The everyday words this transformation is permitted to leave in place.
 *
 * This is the dictionary the gap rule refers to: a sentence containing any word
 * that is not here, not a clinical term the dictionary converted, and not a name
 * already on this person's own record becomes a gap. It fails closed by
 * construction — an unfamiliar word is never passed through on the assumption it
 * is harmless.
 *
 * It is general plain English rather than a list assembled by reading the
 * fixtures. Extending it until one particular synthetic sentence converts would
 * make it a description of the fixtures instead of a description of the
 * language, and the next real plan would gap everywhere.
 */
const EVERYDAY_VOCABULARY = `
a about above across after afterwards again against agreement all along already also although always am among
an and another answer any anyone anything appointment appointments are area argument around arrangements arrive
arrived as ask asked asking at automatically away back bad bag be because become bed been before begin behind
being below beside best better between big bill bills bit blanket both bring brought bus busy but by calm call
called came can cannot car card care careful carry chair change changed check checked child children choice
choose clear clearly close closed clothes cold come coming comfortable contact contacted conversation cost could
count cup daughter day days decide decided decision department details different difficult do does doing done
door doors down drink drive during each early easier easily easy eat eight either else emergency end enough
evening evenings every everyone everything exactly explain explained face families family far father feel feeling
felt few find finish first fit five follow following food for form found four free friend friends from front
full get getting give given glad glasses go going gone good got great ground group groups grow had half hand
handle happen happened happening happy hard have having he head health hear heard hearing help helped helpful
her here herself high him himself his hold home hope hospital hour hours house how however husband i if important
in information inside interpreter into is it its itself join journey just keep kept key kind know known landlord
large last late later leave leaving left less let letter light lights like liked list lists listen little live
living long look looked looking lot loud low lunch made main make making man many may maybe me meal meals mean
meant meet meeting meetings member members mental might mind minute minutes money month months more morning
mornings most mother move much must my myself name names near need needed never new next night nights nine no
noise noises none nor not note notes nothing now number numbers nurse nurses of off offer offered often on once
one only open options or order other otherwise our out over own page pain paper papers part partner peer people
perhaps person phone pick place places plan plans please plus point possible prefer prepare private problem
pronouns put question questions quick quickly quiet quieter rather reach read ready real really reason reasons
relief remember rent rest right ring room rooms roughly run safe said same say saying seat seats second see seen
sensible sentence service services session sessions set settle seven several she short show shown side sign
signs simple since sister sit sitting six sleep slow slowly small so some someone something sometimes son soon
sore sort sound sounds space speak spoken staff stand start started stay step steps still stop straight street
such support sure take taken talk talked talking team teams tell ten than that the their them themselves then
there these they thing things think third this those though thought three through time times to today together
told tomorrow tonight too took towards town travel trip try trying turn twelve two under understand unless until
up upstairs us use used useful usual usually very visit visits wait waited waiting wake walk want wanted ward
warm was watch water way ways we wear week weekend weeks well went were what when where whether which while who
whole whom whose why wife will window wish with within without woman work worked worker working world worried
worry would write written wrong year years yes yesterday yet you your yourself
agree agreed aid arm approach available bay bright complete concern concentrate confirm consistent conversation
cover current describe differ directly draft effect entirely expect familiar fresh guess harder history
household include instruction introduce judgement legal life longer nearby news nowhere occasion older overhead
page pattern pause plainly poor practice preference privacy print reason referral repeat replace role safety
sentence severe share sight silent similar state statement stretch tolerable traffic treat update version
address asleep awake bathroom bedroom breakfast corridor dinner doctor lunch tea
`;

/**
 * Split once at module load. Deterministic: a constant string, no I/O.
 *
 * The verbs in `THIRD_PERSON_VERBS` are folded in rather than typed out again.
 * Leaving them out was a real defect on first run: "has" was in the agreement
 * table and absent from the vocabulary, so every sentence containing it gapped,
 * and twenty-two of the fixtures' sentences gapped on the commonest verb in
 * English while the reason said the wording had no everyday equivalent.
 *
 * Exported so the guard tests can classify it rather than restate it.
 */
export const EVERYDAY_WORDS: ReadonlySet<string> = new Set([
  ...EVERYDAY_VOCABULARY.trim().split(/\s+/),
  ...Object.keys(THIRD_PERSON_VERBS),
  ...Object.values(THIRD_PERSON_VERBS),
]);

/**
 * The base forms an inflected word could have come from — plural, past,
 * progressive, adverb, comparative, superlative.
 *
 * This is deliberately a *widening* rule and it is safe to be one, because it
 * only ever admits an inflection of a word already judged everyday: if "wait" is
 * plain enough to print, so are "waits", "waited", and "waiting". It cannot
 * admit a clinical term, because the unconvertible list is checked first, on the
 * words as written, and a test proves no unconvertible term or its plural
 * survives this rule.
 */
function inflectionBases(word: string): string[] {
  const bases: string[] = [];
  if (word.endsWith("ies")) bases.push(`${word.slice(0, -3)}y`);
  if (word.endsWith("es")) bases.push(word.slice(0, -2));
  if (word.endsWith("s")) bases.push(word.slice(0, -1));
  if (word.endsWith("ied")) bases.push(`${word.slice(0, -3)}y`);
  if (word.endsWith("ed")) bases.push(word.slice(0, -2), word.slice(0, -1));
  if (/([bdfglmnprt])\1ed$/.test(word)) bases.push(word.slice(0, -3));
  if (word.endsWith("ing")) bases.push(word.slice(0, -3), `${word.slice(0, -3)}e`);
  if (/([bdfglmnprt])\1ing$/.test(word)) bases.push(word.slice(0, -4));
  if (word.endsWith("ly")) bases.push(word.slice(0, -2));
  if (word.endsWith("er")) bases.push(word.slice(0, -2), word.slice(0, -1));
  if (word.endsWith("est")) bases.push(word.slice(0, -3), word.slice(0, -2));
  return bases;
}

/**
 * Whether one word may be left on a person's own copy.
 *
 * A clinical term is refused outright before anything else is considered.
 * Without that, the widening rules let one through by the back door:
 * "mental-state" is two everyday words joined by a hyphen, and the hyphen rule
 * would have admitted it as ordinary English. The refusal checks run first on
 * the sentence as written, so nothing was actually reaching a page — but a guard
 * that can be walked around is not a guard, and the hyphen is not the only way
 * in.
 */
export function isEverydayWord(word: string): boolean {
  const bare = word.replace(/['’]s$/, "");
  for (const candidate of [word, bare]) {
    if (isClinicalTerm(candidate)) return false;
    if (EVERYDAY_WORDS.has(candidate)) return true;
    if (inflectionBases(candidate).some((base) => EVERYDAY_WORDS.has(base))) return true;
    if (candidate.includes("-") && candidate.split("-").every((part) => part !== "" && isEverydaySegment(part))) {
      return true;
    }
  }
  return false;
}

function isEverydaySegment(part: string): boolean {
  if (isClinicalTerm(part)) return false;
  return EVERYDAY_WORDS.has(part) || inflectionBases(part).some((base) => EVERYDAY_WORDS.has(base));
}

function isClinicalTerm(word: string): boolean {
  if (UNCONVERTIBLE_TERM_SET.has(word)) return true;
  return inflectionBases(word).some((base) => UNCONVERTIBLE_TERM_SET.has(base));
}

const AGREEMENT_SAFE_S_WORD_SET: ReadonlySet<string> = new Set(AGREEMENT_SAFE_S_WORDS);
const CLINICAL_NEGATION_SET: ReadonlySet<string> = new Set(CLINICAL_NEGATIONS);
const UNCONVERTIBLE_TERM_SET: ReadonlySet<string> = new Set(UNCONVERTIBLE_CLINICAL_TERMS);

/**
 * Third-person pronouns. Substituting one is only safe when the sentence
 * mentions nobody but the person themselves — see `mentionsAnotherPerson`.
 */
const THIRD_PERSON_PRONOUNS: readonly string[] = [
  "he",
  "him",
  "his",
  "she",
  "her",
  "hers",
  "they",
  "them",
  "their",
  "theirs",
];

const THIRD_PERSON_PRONOUN_SET: ReadonlySet<string> = new Set(THIRD_PERSON_PRONOUNS);

/**
 * Words that mean a sentence is about somebody besides the person whose copy
 * this is. A pronoun in such a sentence cannot be bound to the reader without
 * guessing which of the two people it meant, and guessing wrong turns "their
 * presence reads as an accusation" into a sentence accusing the reader.
 */
const OTHER_PERSON_WORDS: readonly string[] = [
  "sister",
  "brother",
  "son",
  "daughter",
  "mother",
  "father",
  "husband",
  "wife",
  "partner",
  "friend",
  "friends",
  "family",
  "families",
  "carer",
  "carers",
  "staff",
  "clinician",
  "clinicians",
  "nurse",
  "nurses",
  "doctor",
  "doctors",
  "worker",
  "workers",
  "member",
  "members",
  "coordinator",
  "team",
  "teams",
  "security",
  "someone",
  "anyone",
  "everyone",
  "people",
  "person",
  "child",
  "children",
  "adult",
  "household",
];

const OTHER_PERSON_WORD_SET: ReadonlySet<string> = new Set(OTHER_PERSON_WORDS);

/**
 * Verbs a Management Plan sentence opens with when it is an instruction to
 * staff. A sentence in the imperative is addressed to whoever is reading it, and
 * on this copy that is the person the plan is about.
 *
 * This rule caught the worst line the first run produced. "Say so plainly when
 * you use it, and offer again to write it together" is sound advice to a
 * clinician and, printed on somebody's own plan, an instruction to them to
 * announce that they had refused. Nothing about the words was wrong; the reader
 * was.
 */
const CLINICIAN_IMPERATIVE_OPENERS: readonly string[] = [
  "introduce",
  "ask",
  "tell",
  "offer",
  "say",
  "keep",
  "check",
  "sit",
  "speak",
  "use",
  "treat",
  "record",
  "confirm",
  "give",
  "take",
  "ensure",
  "consider",
  "arrange",
  "contact",
  "call",
  "ring",
  "write",
  "explain",
  "read",
  "leave",
  "allow",
  "let",
  "start",
  "stop",
  "avoid",
  "deferring",
  "repeating",
  "waiting",
  "being",
];

const CLINICIAN_IMPERATIVE_OPENER_SET: ReadonlySet<string> = new Set(CLINICIAN_IMPERATIVE_OPENERS);

/**
 * Words that mean a sentence is talking *about* the person's name rather than
 * using it to refer to them. Substituting the name in one of these produces "To
 * be called you" — which is what the first run printed on Evie's copy, under a
 * heading saying it was what mattered to her.
 */
const NAMING_CONTEXT_WORDS: readonly string[] = [
  "called",
  "call",
  "calls",
  "name",
  "names",
  "named",
  "address",
  "addressed",
  "refer",
  "referred",
  "referring",
  "pronounce",
  "pronounced",
  "pronoun",
  "pronouns",
  "spelt",
  "spelled",
];

const NAMING_CONTEXT_WORD_SET: ReadonlySet<string> = new Set(NAMING_CONTEXT_WORDS);

/** Every clinical term the transformation recognises, convertible or not. Used
 *  to decide whether a negation in a sentence is a clinical one. */
const CLINICAL_TERM_SET: ReadonlySet<string> = new Set([
  ...UNCONVERTIBLE_CLINICAL_TERMS,
  ...Object.keys(PLAIN_LANGUAGE_TERMS).flatMap((term) => term.split(/[\s-]+/)),
]);

/** Dictionary keys, longest first, so a longer phrase is matched before any
 *  shorter phrase inside it. */
const PLAIN_LANGUAGE_KEYS = Object.keys(PLAIN_LANGUAGE_TERMS).sort((left, right) => right.length - left.length);

// --- Gap reasons -----------------------------------------------------------------

/**
 * Every reason ends by saying who writes the section instead. A gap is a job for
 * a person, not an error state, and the sentence a clinician reads should say
 * what to do about it.
 */
export const PATIENT_PLAN_GAP_REASON = {
  agreedApproach:
    "What happens when this person comes to the emergency department is never converted automatically, whatever the plan says. It is the part most easily read as a judgement about them, so it is always written by a clinician, with them.",
  nothingRecorded:
    "The Management Plan records nothing under this heading, so there is nothing to convert. It needs to be written by a clinician, with this person.",
  unknownTerm:
    "This section uses wording the plain-language conversion has no confident everyday equivalent for, so converting it would be a guess. It needs to be written by a clinician, with this person.",
  clinicalNegation:
    "This section says what does not happen. A negation that converts only in part reverses its own meaning, so it needs to be written by a clinician, with this person.",
  personAsSubject:
    "This section describes this person in the third person, and the conversion cannot put it into their own voice without rewriting it. It needs to be written by a clinician, with them.",
  ambiguousPronoun:
    "This section mentions somebody besides this person, so a pronoun here cannot be attached to the reader without guessing which of them it meant. It needs to be written by a clinician, with them.",
  clinicianInstruction:
    "This section is written as an instruction to staff. On the person's own copy an instruction is addressed to them, so converting it would hand them a direction that was never meant for them. It needs to be written by a clinician, with them.",
  namingContext:
    "This section is about what this person is called, so replacing their name with “you” would take the sentence's whole meaning with it. It needs to be written by a clinician, with them.",
} as const;

export type PatientPlanGapReasonKey = keyof typeof PATIENT_PLAN_GAP_REASON;

// --- Conversion ------------------------------------------------------------------

export type PatientPlanDraft = {
  derivedFromManagementVersionId: SyntheticId;
  sections: readonly PatientPlanSection[];
  resources: readonly PatientResource[];
};

/** Tokens the checks look at: words only. Punctuation, numbers, and spacing are
 *  left exactly as written. */
function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'’-]*/g) ?? []).map((word) => word.replace(/^[-'’]+|[-'’]+$/g, ""));
}

/** Proper nouns: a capitalised word inside a piece of prose already on this
 *  person's record. Lowercased, because the vocabulary check is case-blind. */
function properNounsOf(text: string): string[] {
  return (text.match(/\b[A-Z][A-Za-z'’-]*/g) ?? []).map((word) => word.toLowerCase());
}

/** Sentences, split on terminal punctuation followed by whitespace. Deliberately
 *  simple: this is written prose from a form, not free input. */
function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The names this person's record already carries: their own names, their home
 * health service, the support people they have consented to, and the services
 * named on the resources chosen for them. A capitalised word outside this set is
 * a name the transformation has never been told about, and it gaps rather than
 * being printed on somebody's copy unchecked.
 */
function permittedNamesFor(
  version: ManagementPlanVersion,
  patient: Patient,
  resources: readonly PatientResource[],
): ReadonlySet<string> {
  const sources = [
    patient.fullName,
    patient.preferredName,
    ...patient.aliases,
    patient.homeHealthService,
    ...version.consentedSupportPeople,
    ...resources.map((resource) => resource.name),
  ];
  return new Set(sources.flatMap((source) => properNounsOf(source)));
}

/**
 * How the person is referred to in the third person, longest name first so a
 * full name is replaced before the preferred name inside it.
 *
 * `ambiguousPronoun` is the word — if any — that is both this person's
 * possessive and their object pronoun, and so cannot be classified without
 * guessing. For `she/her` that word is "her": "ring her son" wants "your son",
 * and "hard for her to follow" wants "you". Substituting one rule everywhere
 * printed "hard for your to follow" on Mira's copy on the first run. There is no
 * grammar here to decide between them, so a sentence containing it is refused
 * rather than mangled.
 */
function personReferences(patient: Patient): {
  possessive: string[];
  subject: string[];
  object: string[];
  ambiguousPronoun: string | null;
} {
  const [subjectPronoun = "", objectPronoun = ""] = patient.pronouns.split("/");
  const possessivePronoun =
    subjectPronoun === "they" ? "their" : subjectPronoun === "she" ? "her" : subjectPronoun === "he" ? "his" : "";
  const ambiguous = possessivePronoun !== "" && possessivePronoun === objectPronoun ? possessivePronoun : null;
  const names = [patient.fullName, ...patient.aliases, patient.preferredName]
    .filter((name) => name.length > 0)
    .sort((left, right) => right.length - left.length);
  return {
    possessive: [
      ...names.flatMap((name) => [`${name}'s`, `${name}’s`]),
      ...(possessivePronoun === "" || ambiguous !== null ? [] : [possessivePronoun]),
    ],
    subject: [...names, ...(subjectPronoun === "" ? [] : [subjectPronoun])],
    object: objectPronoun === "" || ambiguous !== null ? [] : [objectPronoun],
    ambiguousPronoun: ambiguous,
  };
}

/** Whether a sentence names anybody besides the person whose copy this is. */
function mentionsAnotherPerson(words: readonly string[], ownNames: ReadonlySet<string>): boolean {
  return words.some((word) => OTHER_PERSON_WORD_SET.has(word) && !ownNames.has(word));
}

export type ConversionOutcome = { converted: string } | { gapReasonKey: PatientPlanGapReasonKey };

/**
 * One line of clinical content, converted or refused.
 *
 * The order matters. The refusal checks run first, on the text as written, so a
 * substitution can never hide the thing that should have stopped it. Then the
 * dictionary decides what the clinical words mean; then the person's own name
 * and pronouns become "you" and "your", with verb agreement taken from a table;
 * then every remaining word must be in the dictionary. A failure at any step
 * refuses the whole line — there is no partial result to be mistaken for a
 * finished one.
 */
function convertLine(
  line: string,
  patient: Patient,
  permittedNames: ReadonlySet<string>,
  ownNames: ReadonlySet<string>,
): ConversionOutcome {
  for (const sentence of sentencesOf(line)) {
    const words = wordsOf(sentence);
    const first = words[0];

    if (first !== undefined && CLINICIAN_IMPERATIVE_OPENER_SET.has(first)) {
      return { gapReasonKey: "clinicianInstruction" };
    }
    if (words.some((word) => UNCONVERTIBLE_TERM_SET.has(word))) {
      return { gapReasonKey: "unknownTerm" };
    }

    const refersToThisPerson =
      words.some((word) => ownNames.has(word)) || words.some((word) => THIRD_PERSON_PRONOUN_SET.has(word));

    // "known as" is a naming construction; a bare "known" is not, and treating
    // it as one refused "Mira is known to the Coastal Plains team" as though it
    // were a sentence about her name.
    const namesTheName = words.some((word) => NAMING_CONTEXT_WORD_SET.has(word)) || /\bknown\s+as\b/i.test(sentence);
    if (refersToThisPerson && namesTheName) {
      return { gapReasonKey: "namingContext" };
    }
    // A negation is refused beside a clinical term, and beside the person
    // themselves. The second half matters as much as the first: a negated
    // sentence about somebody, printed on their own copy, is where blame lands.
    if (
      (words.some((word) => CLINICAL_TERM_SET.has(word)) || refersToThisPerson) &&
      words.some((word) => CLINICAL_NEGATION_SET.has(word))
    ) {
      return { gapReasonKey: "clinicalNegation" };
    }
    if (words.some((word) => THIRD_PERSON_PRONOUN_SET.has(word)) && mentionsAnotherPerson(words, ownNames)) {
      return { gapReasonKey: "ambiguousPronoun" };
    }
    const ambiguous = personReferences(patient).ambiguousPronoun;
    if (ambiguous !== null && words.includes(ambiguous)) {
      return { gapReasonKey: "ambiguousPronoun" };
    }
  }

  let text = line;
  for (const term of PLAIN_LANGUAGE_KEYS) {
    const replacement = PLAIN_LANGUAGE_TERMS[term];
    if (replacement === undefined) continue;
    text = text.replace(new RegExp(`\\b${escapeForRegExp(term)}\\b`, "gi"), replacement);
  }

  const references = personReferences(patient);
  for (const possessive of references.possessive) {
    text = text.replace(new RegExp(`\\b${escapeForRegExp(possessive)}\\b`, "gi"), "your");
  }
  for (const object of references.object) {
    text = text.replace(new RegExp(`\\b${escapeForRegExp(object)}\\b`, "gi"), "you");
  }

  // The subject substitution is the only place agreement can break, so it is the
  // only place that looks at the word after itself.
  for (const subject of references.subject) {
    let refused = false;
    text = text.replace(
      new RegExp(`\\b${escapeForRegExp(subject)}\\b(\\s+)([A-Za-z][A-Za-z'’-]*)`, "gi"),
      (whole, spacing: string, nextWord: string) => {
        const lowered = nextWord.toLowerCase();
        const agreed = THIRD_PERSON_VERBS[lowered];
        if (agreed !== undefined) return `you${spacing}${agreed}`;
        if (lowered.endsWith("s") && !AGREEMENT_SAFE_S_WORD_SET.has(lowered)) {
          refused = true;
          return whole;
        }
        return `you${spacing}${nextWord}`;
      },
    );
    if (refused) return { gapReasonKey: "personAsSubject" };
    text = text.replace(new RegExp(`\\b${escapeForRegExp(subject)}\\b`, "gi"), "you");
  }

  for (const word of wordsOf(text)) {
    if (isEverydayWord(word)) continue;
    if (permittedNames.has(word) || permittedNames.has(word.replace(/['’]s$/, ""))) continue;
    return { gapReasonKey: "unknownTerm" };
  }

  return { converted: capitaliseSentences(text) };
}

/** A substitution can leave a lower-case word at the start of a sentence — "CMHT
 *  is the durable contact" becomes "mental health team is …". Restoring the
 *  capital is the difference between a page written for somebody and a page
 *  obviously produced by a machine. */
function capitaliseSentences(text: string): string {
  return text.replace(
    /(^|[.!?]\s+)([a-z])/g,
    (_whole, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`,
  );
}

/** The lines one heading is built from, in source-field order. `whyThisPlanExists`
 *  is a paragraph rather than a list, so it contributes one line. */
function sourceLines(content: ManagementPlanContent, key: PatientPlanSectionKey): string[] {
  return PATIENT_PLAN_SECTION_SOURCES[key].flatMap((field) => {
    const value = content[field];
    if (typeof value === "string") return value.trim().length === 0 ? [] : [value];
    return value.filter((line) => line.trim().length > 0);
  });
}

function gapSection(key: PatientPlanSectionKey, reasonKey: PatientPlanGapReasonKey): PatientPlanSection {
  return {
    key,
    heading: PATIENT_PLAN_SECTION_HEADING[key],
    body: [],
    gap: true,
    gapReason: PATIENT_PLAN_GAP_REASON[reasonKey],
  };
}

/**
 * One approved Management Plan Version as a draft patient edition.
 *
 * Pure, offline, and deterministic: it reads nothing but its three arguments and
 * the constants above.
 */
/**
 * A converter bound to one person and one version.
 *
 * Exported because each refusal rule deserves to be proved on the sentence that
 * triggers it rather than through a whole section, where one rule firing hides
 * every other. It is the same function the draft builder uses — not a second
 * copy that could drift from it.
 */
export function createLineConverter(
  version: ManagementPlanVersion,
  patient: Patient,
  resources: readonly PatientResource[],
): (line: string) => ConversionOutcome {
  const forThisPatient = resources.filter((resource) => resource.patientId === patient.id);
  const permittedNames = permittedNamesFor(version, patient, forThisPatient);
  const ownNames = new Set(
    [patient.fullName, patient.preferredName, ...patient.aliases].flatMap((name) => wordsOf(name)),
  );
  return (line: string) => convertLine(line, patient, permittedNames, ownNames);
}

export function buildPatientPlanDraft(
  version: ManagementPlanVersion,
  patient: Patient,
  resources: readonly PatientResource[],
): PatientPlanDraft {
  const forThisPatient = resources.filter((resource) => resource.patientId === patient.id);
  const convert = createLineConverter(version, patient, resources);

  const sections = PATIENT_PLAN_SECTION_KEYS.map((key): PatientPlanSection => {
    if ((NEVER_CONVERTED_SECTION_KEYS as readonly PatientPlanSectionKey[]).includes(key)) {
      return gapSection(key, "agreedApproach");
    }

    const lines = sourceLines(version.content, key);
    if (lines.length === 0) return gapSection(key, "nothingRecorded");

    const body: string[] = [];
    for (const line of lines) {
      const outcome = convert(line);
      if ("gapReasonKey" in outcome) return gapSection(key, outcome.gapReasonKey);
      body.push(outcome.converted);
    }

    return { key, heading: PATIENT_PLAN_SECTION_HEADING[key], body, gap: false, gapReason: null };
  });

  return { derivedFromManagementVersionId: version.id, sections, resources: forThisPatient };
}

/** The gaps still to be filled. Approval is refused while any remains: an
 *  unfilled gap prints as a heading with nothing under it. */
export function unfilledGapSections(sections: readonly PatientPlanSection[]): readonly PatientPlanSection[] {
  return sections.filter((section) => section.gap);
}
