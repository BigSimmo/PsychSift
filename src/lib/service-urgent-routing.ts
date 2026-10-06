import type { ServiceRecord, ServiceSearchMatch } from "@/lib/service-ranker";

export type ServiceUrgentIntent =
  | "emergency"
  | "camhs_crisis"
  | "regional_after_hours"
  | "regional_daytime"
  | "adult_metro_crisis"
  | "aboriginal_crisis"
  | "aod_urgent"
  | "family_violence"
  | "sexual_assault"
  | "suicide_aftercare"
  | "suicide_postvention";

// `self[- ]?harm\w*` so "self harming", "self-harmed" and "selfharm" are all crisis wording.
const CRISIS =
  /\b(?:suicid\w*|crisis|acute|unsafe|self[- ]?harm\w*|mental health emergency|kill (?:myself|oneself|themselves|himself|herself)|end (?:my|one['’]?s|their|his|her) life|take (?:my|one['’]?s|their|his|her) own life|hang (?:myself|oneself|themselves|himself|herself)|bottle of pills)\b/i;
const IMMEDIATE_DANGER =
  /\b(?:actively suicidal|immediate danger|life[- ]?threatening|severe injury|overdose|about to (?:kill|harm)|cannot keep (?:myself|them|him|her|the patient) safe|emergency (?:now|in progress)|strangl\w*|chok(?:ing|ed)?|can[’']?t breathe|cannot breathe)\b/i;
// Wording that says the person is under 18: CAMHS Crisis Connect alone.
const CHILD =
  /(?:\b(?:child(?:ren)?|kids?|teen(?:ager)?s?|adolescents?|minors?|under[- ]?18|(?:[0-9]|1[0-7])\s*[- ]?\s*(?:year|yr)s?[- ]?old)\b|<\s*18\b)/i;
// Owner decision 15 (Josh, 2026-09-25): plain youth wording does not say whether the person is
// under or over 18, so a youth crisis pins both CAMHS Crisis Connect and the adult MHERL line,
// CAMHS first. Explicit under-18 wording (CHILD) in the same query settles the age: CAMHS alone.
const YOUTH = /\b(?:youths?|young (?:person|people))\b/i;
const REGIONAL_WA =
  /\b(?:regional|rural|remote|bunbury|albany|geraldton|kalgoorlie|karratha|broome|port hedland|esperance|great southern|pilbara|kimberley|south west|wheatbelt|mid west|goldfields|kununurra|busselton|carnarvon|northam|derby|newman|katanning|merredin|exmouth)\b/i;
// Keyword-only signal. A stated clock time is judged separately, by
// `detectClockTimeUrgency` below — a bare "pm" match here previously misclassified
// genuine business-hours times such as "2pm" as after-hours.
const AFTER_HOURS_KEYWORDS = /\b(?:after[- ]?hours|tonight|overnight|weekend|public holiday)\b/i;
const AFTERCARE =
  /(?:\baftercare\b.*\bsuicid\w*\b|\bsuicid\w*\b.*\baftercare\b|\bdischarg\w*\b.*\b(?:suicide attempt|suicidal crisis)\b|\b(?:suicide attempt|suicidal crisis)\b.*\bdischarg\w*\b)/i;
const POSTVENTION =
  /(?:\bpostvention\b|\bbereav(?:ed|ement)\b.*\bsuicid\w*\b|\b(?:died|death|lost|loss)\b.*\bsuicid\w*\b|\bsuicid\w*\b.*\b(?:bereavement|death|died|loss)\b)/i;
const ABORIGINAL = /\b(?:aboriginal|torres strait islander|atsi|indigenous|first nations)\b/i;
const AOD_TERMS =
  /\b(?:alcohol|drink(?:ing)?|drunk|intoxicated|substance (?:use|abuse)|drugs?|ice|meth(?:amphetamine)?|opioid|overdose|detox(?:ification)?)\b/i;
// Requires a specific urgency signal, not just any help-seeking word — "alcohol
// counselling referral" is routine, not urgent, so a bare AOD term plus a generic
// word like "advice"/"support"/"counselling" is no longer enough on its own.
const AOD_URGENCY =
  /\b(?:crisis|urgent(?:ly)?|emergency|withdrawal|withdrawing|detox(?:ification)?|overdose|od|can[’']?t stop|seizure)\b/i;
const FAMILY_VIOLENCE_NAMED = /\b(?:domestic violence|family violence|intimate partner violence|dfv|fdv)\b/i;
const FAMILY_VIOLENCE_RELATION = "partner|husband|wife|boyfriend|girlfriend|ex[- ]?partner|ex";
const FAMILY_VIOLENCE_ACT =
  "hit(?:ting)?|hits|assault\\w*|abus\\w*|violent|violence|threat\\w*|control(?:ling)?|strangl\\w*|chok(?:ing|ed)";
// Symmetric: "partner hitting her" (relation, then act) and "abused by her partner"
// (act, then relation) must both match — a relation term can be named either before
// or after the description of what is happening.
const FAMILY_VIOLENCE_DESCRIBED = new RegExp(
  `\\b(?:${FAMILY_VIOLENCE_RELATION})\\b[\\s\\S]{0,40}\\b(?:${FAMILY_VIOLENCE_ACT})\\b|` +
    `\\b(?:${FAMILY_VIOLENCE_ACT})\\b[\\s\\S]{0,40}\\b(?:${FAMILY_VIOLENCE_RELATION})\\b`,
  "i",
);
const SEXUAL_ASSAULT = /\b(?:raped?|sexual(?:ly)?\s*assault(?:ed)?|molested|non[- ]?consensual)\b/i;

// WACHS regional clinics publish 8.30am-4.30pm weekday hours (see the SVC-REG-* records'
// own `hours.display`). A stated clock time counts as after-hours only outside that
// window — at or after 4.30pm, or before 8.30am — never from the bare presence of "pm".
const DAYTIME_START_MINUTE = 8 * 60 + 30; // 8:30am
const AFTER_HOURS_START_MINUTE = 16 * 60 + 30; // 4:30pm

const CLOCK_TIME_AMPM = /\b(1[0-2]|0?[1-9])(?::([0-5][0-9]))?\s*([ap])\.?\s*m\.?\b/i;
// "HH:MM" 24-hour time — unambiguous, the colon can't mean anything else.
const CLOCK_TIME_24H_COLON = /\b([01][0-9]|2[0-3]):([0-5][0-9])\b/;
// Four-digit military time ("2230") is NOT matched bare — a bare four-digit number
// is a year, a postcode fragment, or a date component far more often than it is a
// time ("referral dated 14/03/2026" must not read as 20:26 and lose the daytime
// route). It only counts as a clock time when explicitly marked with "h"/"hrs"/
// "hours" ("2230h", "2230hrs", "2230 hours").
const CLOCK_TIME_24H_MILITARY = /\b([01][0-9]|2[0-3])([0-5][0-9])\s?(?:hours?|hrs?|h)\b/i;

function minutesToUrgency(totalMinutes: number): "after_hours" | "daytime" {
  return totalMinutes >= DAYTIME_START_MINUTE && totalMinutes < AFTER_HOURS_START_MINUTE ? "daytime" : "after_hours";
}

/**
 * Classifies a stated clock time (12-hour "11pm"/"4:45pm"/"7am", 24-hour "07:30", explicitly
 * marked military "2230hrs", or the words "noon"/"midday"/"midnight") against WACHS regional
 * clinic hours (8.30am to 4.30pm weekdays). A bare four-digit number ("2026", "6000") is never
 * read as a time — it is far more often a year or postcode — so military time requires an
 * "h"/"hrs"/"hours" marker. Returns "unknown" when the query names no clock time at all —
 * callers must not treat "unknown" as either daytime or after-hours.
 */
export function detectClockTimeUrgency(query: string): "after_hours" | "daytime" | "unknown" {
  const text = query.toLowerCase();

  if (/\bmidnight\b/.test(text)) return "after_hours";
  if (/\b(?:noon|midday)\b/.test(text)) return "daytime";

  const ampm = text.match(CLOCK_TIME_AMPM);
  if (ampm) {
    let hour = Number.parseInt(ampm[1], 10);
    const minute = ampm[2] ? Number.parseInt(ampm[2], 10) : 0;
    const meridiem = ampm[3];
    if (meridiem === "a") {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
    return minutesToUrgency(hour * 60 + minute);
  }

  const colon = text.match(CLOCK_TIME_24H_COLON);
  if (colon) {
    const hour = Number.parseInt(colon[1], 10);
    const minute = Number.parseInt(colon[2], 10);
    return minutesToUrgency(hour * 60 + minute);
  }

  const military = text.match(CLOCK_TIME_24H_MILITARY);
  if (military) {
    const hour = Number.parseInt(military[1], 10);
    const minute = Number.parseInt(military[2], 10);
    return minutesToUrgency(hour * 60 + minute);
  }

  return "unknown";
}

/** True when the query's words or a stated clock time mark it as outside WACHS regional
 * clinic hours. A keyword ("weekend", "public holiday", ...) always wins outright, since
 * those describe the clinic being shut regardless of what time of day is also named. */
function queryIndicatesAfterHours(clean: string): boolean {
  if (AFTER_HOURS_KEYWORDS.test(clean)) return true;
  return detectClockTimeUrgency(clean) === "after_hours";
}

// WACHS regional adult mental health clinics only exist for these four regions
// (SVC-REG-001..004). Goldfields, Wheatbelt and Mid West (including the Gascoyne
// towns Carnarvon and Exmouth) have no matching canonical record, so a place name
// in one of those regions must fall back to existing behaviour rather than pin a
// clinic in the wrong part of the state.
const WA_REGIONAL_DAYTIME_PLACES: Record<string, string | undefined> = {
  bunbury: "South West",
  busselton: "South West",
  albany: "Great Southern",
  katanning: "Great Southern",
  karratha: "Pilbara",
  "port hedland": "Pilbara",
  newman: "Pilbara",
  broome: "Kimberley",
  kununurra: "Kimberley",
  derby: "Kimberley",
  geraldton: undefined,
  kalgoorlie: undefined,
  esperance: undefined,
  carnarvon: undefined,
  exmouth: undefined,
  northam: undefined,
  merredin: undefined,
};

/** The WACHS region name (matching a `SVC-REG-*` record's `catchments`) named by the
 * query, or undefined when no named place is recognised or its region has no
 * canonical regional record. */
function detectWaRegionForDaytime(clean: string): string | undefined {
  for (const [place, region] of Object.entries(WA_REGIONAL_DAYTIME_PLACES)) {
    if (!region) continue;
    if (new RegExp(`\\b${place}\\b`, "i").test(clean)) return region;
  }
  return undefined;
}

export function detectServiceUrgentIntents(query: string): ServiceUrgentIntent[] {
  const clean = query.trim();
  if (!clean) return [];

  const intents: ServiceUrgentIntent[] = [];
  const crisis = CRISIS.test(clean);
  const immediateDanger = IMMEDIATE_DANGER.test(clean);
  const postvention = POSTVENTION.test(clean);
  const child = CHILD.test(clean);
  const youthAnyAge = !child && YOUTH.test(clean);
  const acuteCrisis = crisis && !postvention && !AFTERCARE.test(clean);

  const isRegional = REGIONAL_WA.test(clean);
  const region = isRegional ? detectWaRegionForDaytime(clean) : undefined;
  const isAfterHours = queryIndicatesAfterHours(clean);
  const isDaytime = detectClockTimeUrgency(clean) === "daytime";

  // Regional routing:
  // After-hours pins Rurallink first while retaining emergency (000) below.
  // Daytime or unstated clinic hours for a recognized region pin the regional clinic first, then Rurallink.
  if (acuteCrisis && isRegional && isAfterHours && !immediateDanger) {
    intents.push("regional_after_hours");
  } else if (crisis && isRegional && region && !isAfterHours) {
    intents.push("regional_daytime");
    intents.push("regional_after_hours");
  }

  // Emergency (000): immediate danger, or acute crisis (adult/youth) where a local daytime clinic is not handling it
  if (immediateDanger || (acuteCrisis && !child && !youthAnyAge && !(isRegional && region && !isAfterHours))) {
    if (!intents.includes("emergency")) {
      intents.push("emergency");
    }
  }

  if (crisis && (child || youthAnyAge)) intents.push("camhs_crisis");
  if (ABORIGINAL.test(clean) && crisis) intents.push("aboriginal_crisis");
  if (FAMILY_VIOLENCE_NAMED.test(clean) || FAMILY_VIOLENCE_DESCRIBED.test(clean)) intents.push("family_violence");
  if (SEXUAL_ASSAULT.test(clean)) intents.push("sexual_assault");

  if (crisis && isRegional) {
    if (!intents.includes("regional_after_hours") && !isDaytime) {
      intents.push("regional_after_hours");
    }
  }

  // IMMEDIATE_DANGER phrases always pin adult_metro_crisis (MHERL / Lifeline WA) alongside emergency (000)
  if ((acuteCrisis && !child) || immediateDanger) {
    if (!intents.includes("adult_metro_crisis")) {
      intents.push("adult_metro_crisis");
    }
  }

  if (AOD_TERMS.test(clean) && AOD_URGENCY.test(clean)) intents.push("aod_urgent");
  if (!immediateDanger && !postvention && AFTERCARE.test(clean)) intents.push("suicide_aftercare");
  if (postvention) intents.push("suicide_postvention");

  return intents;
}

const TITLE_MATCHERS: Record<ServiceUrgentIntent, RegExp[]> = {
  emergency: [/^Emergency services$/i],
  camhs_crisis: [/^CAMHS Crisis Connect$/i],
  regional_after_hours: [/^Rurallink$/i],
  // regional_daytime is resolved directly by catchment in rankServiceUrgentRoutes
  // (a single title/tag matcher pair can't tell one WACHS region's clinic from
  // another), so it carries no title/tag matchers here.
  regional_daytime: [],
  adult_metro_crisis: [/Mental Health Emergency Response Line|\bMHERL\b/i],
  aboriginal_crisis: [/^13\s*YARN$/i],
  aod_urgent: [/^Alcohol and Drug Support Line$/i],
  family_violence: [/^1800RESPECT$/i],
  sexual_assault: [/Sexual Assault Resource Centre/i, /\bSARC\b/i],
  suicide_aftercare: [/Aftercare/i],
  suicide_postvention: [/postvention/i, /StandBy/i, /support after suicide/i, /suicide bereavement/i],
};

const TAG_MATCHERS: Record<ServiceUrgentIntent, RegExp[]> = {
  emergency: [/Immediate life-threatening danger/i, /severe medical emergency/i],
  camhs_crisis: [/child.*crisis/i, /youth.*crisis/i],
  regional_after_hours: [/regional WA after hours/i, /regional.*mental-health crisis/i],
  regional_daytime: [],
  adult_metro_crisis: [/Adult mental-health crisis - Perth metro/i, /Mental-health crisis - Peel/i],
  aboriginal_crisis: [/Aboriginal\/Torres Strait Islander crisis support/i],
  aod_urgent: [/AOD advice/i],
  family_violence: [/Family and domestic violence/i],
  sexual_assault: [/Recent sexual assault/i, /Sexual violence support/i],
  suicide_aftercare: [/aftercare/i, /post-discharge.*suicid/i],
  suicide_postvention: [/postvention/i, /bereavement.*suicid/i, /support after suicide/i],
};

// Intents that pin an ordered list of named records rather than a single first match. Each
// matcher resolves to its first usable record in catalogue order (skipping any record already
// pinned), and the pins keep this order. When none of them resolves, the intent falls back to
// the single title/tag match above.
//
// Owner decision (Josh, 2026-09-26): a family-violence search shows WA's own 24-hour Women's
// Domestic Violence Helpline first, with the national 1800RESPECT line straight after it.
// Both are named explicitly by title so catalogue order or tag overlap can never decide which
// one leads, or push 1800RESPECT out of the results.
const PINNED_TITLE_SEQUENCES: Partial<Record<ServiceUrgentIntent, readonly RegExp[]>> = {
  family_violence: [/^Women[’']?s Domestic Violence Helpline$/i, /^1800RESPECT$/i],
  adult_metro_crisis: [/Mental Health Emergency Response Line|\bMHERL\b/i, /^Lifeline WA$/i],
};

// Score step between successive pins of one intent. Every pin of an intent must stay above the
// next intent's first pin (a step of 1 below), so a sequence may hold at most ten titles.
const PIN_SEQUENCE_SCORE_STEP = 0.1;

function serviceIsCurrentlyUsable(service: ServiceRecord, intent: ServiceUrgentIntent): boolean {
  const status = service.verification?.availabilityStatus;
  if (status && status !== "active") {
    // "unknown" means the record has not yet been re-verified — it is not the same signal as
    // a confirmed non-active status (planned/closed/superseded/temporarily_unavailable). Don't
    // let that verification gap silently drop an urgent CAMHS-crisis match; every other urgent
    // intent still requires a fully active, confirmed status.
    const isUnverifiedCamhsCrisis = status === "unknown" && intent === "camhs_crisis";
    if (!isUnverifiedCamhsCrisis) return false;
  }

  const labels = (service.statusChips ?? []).map((chip) => chip.label?.toLowerCase() ?? "");
  return !labels.some((label) =>
    /\b(?:planned|closed|superseded|temporarily unavailable|legacy unverified)\b/.test(label),
  );
}

function findFirstUsable(records: readonly ServiceRecord[], intent: ServiceUrgentIntent): ServiceRecord | undefined {
  const titleMatchers = TITLE_MATCHERS[intent];
  const tagMatchers = TAG_MATCHERS[intent];
  return records.find((service) => {
    if (!serviceIsCurrentlyUsable(service, intent)) return false;
    if (titleMatchers.some((pattern) => pattern.test(service.title))) return true;
    return (service.tags ?? []).some((tag) => tagMatchers.some((pattern) => pattern.test(tag)));
  });
}

/** The usable records named by an intent's pinned title sequence, in sequence order, skipping
 * records already pinned. Empty when the intent has no sequence or none of it is usable. */
function findPinnedSequence(
  records: readonly ServiceRecord[],
  intent: ServiceUrgentIntent,
  seen: ReadonlySet<string>,
): ServiceRecord[] {
  const sequence = PINNED_TITLE_SEQUENCES[intent] ?? [];
  const picked: ServiceRecord[] = [];
  const pickedSlugs = new Set<string>();
  for (const pattern of sequence) {
    const service = records.find(
      (candidate) =>
        !seen.has(candidate.slug) &&
        !pickedSlugs.has(candidate.slug) &&
        serviceIsCurrentlyUsable(candidate, intent) &&
        pattern.test(candidate.title),
    );
    if (!service) continue;
    pickedSlugs.add(service.slug);
    picked.push(service);
  }
  return picked;
}

/** The active WACHS regional record whose `catchments` cover the given region name
 * (e.g. "Kimberley"), or undefined if none is active/usable. */
function findRegionalDaytimeUsable(records: readonly ServiceRecord[], region: string): ServiceRecord | undefined {
  return records.find(
    (service) =>
      serviceIsCurrentlyUsable(service, "regional_daytime") &&
      (service.catchments ?? []).some((catchment) => catchment.toLowerCase() === region.toLowerCase()),
  );
}

function normalizeForNameMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Usable records whose full title the query spells out ("13YARN crisis support" names 13YARN).
 * Titles shorter than five characters are ignored so a stray token cannot claim the lead. */
function findExplicitlyNamedServices(records: readonly ServiceRecord[], query: string): ServiceRecord[] {
  const normalizedQuery = ` ${normalizeForNameMatch(query)} `;
  return records.filter((service) => {
    const title = normalizeForNameMatch(service.title ?? "");
    if (title.replace(/ /g, "").length < 5) return false;
    if (!normalizedQuery.includes(` ${title} `)) return false;
    const status = service.verification?.availabilityStatus;
    return !status || status === "active";
  });
}

export function rankServiceUrgentRoutes(records: readonly ServiceRecord[], query: string): ServiceSearchMatch[] {
  const intents = detectServiceUrgentIntents(query);
  if (intents.length === 0) return [];

  const seen = new Set<string>();
  const matches: ServiceSearchMatch[] = [];

  // A query that names a service keeps that service first. Crisis wording in the same query
  // still pins every urgent route straight after it, so naming a service never removes help;
  // it only stops a generic word ("crisis", "acute") from demoting the service asked for.
  for (const service of findExplicitlyNamedServices(records, query)) {
    if (seen.has(service.slug)) continue;
    seen.add(service.slug);
    matches.push({ service, score: 1_000_001, reasons: ["urgent route", "named service"] });
  }

  intents.forEach((intent, index) => {
    const sequence = findPinnedSequence(records, intent, seen);
    const services =
      sequence.length > 0
        ? sequence
        : [
            intent === "regional_daytime"
              ? (() => {
                  const region = detectWaRegionForDaytime(query.trim());
                  return region ? findRegionalDaytimeUsable(records, region) : undefined;
                })()
              : findFirstUsable(records, intent),
          ];
    services.forEach((service, position) => {
      if (!service || seen.has(service.slug)) return;
      seen.add(service.slug);
      matches.push({
        service,
        // The first pin keeps the intent's score of 1_000_000 - index; later pins of the same
        // intent step down by a fraction so they stay above the next intent's pins.
        score: 1_000_000 - index - position * PIN_SEQUENCE_SCORE_STEP,
        reasons: ["urgent route", intent.replace(/_/g, " ")],
      });
    });
  });

  return matches;
}
