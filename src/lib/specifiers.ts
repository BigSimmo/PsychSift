export type SpecifierFamily = "episode-features" | "course-onset" | "severity-remission";

export type SpecifierBuilderDiagnosis =
  | "mdd-recurrent"
  | "mdd-single"
  | "bipolar-i-depressed"
  | "bipolar-i-manic"
  | "bipolar-i-hypomanic"
  | "bipolar-ii-depressed"
  | "bipolar-ii-hypomanic";

export type SpecifierApplicability =
  | "Depressive disorders"
  | "Bipolar disorders"
  | "Major depressive episodes"
  | "Bipolar depressive episodes"
  | "Mood disorders"
  | "Psychotic disorders"
  | "Medical conditions"
  | "Recurrent depressive disorder"
  | "Bipolar I disorder"
  | "Bipolar II disorder"
  | "Other specified diagnoses";

export type SpecifierRecord = {
  slug: string;
  name: string;
  shortName: string;
  family: SpecifierFamily;
  familyLabel: string;
  appliesTo: SpecifierApplicability[];
  summary: string;
  clinicalSignal: string;
  decisionQuestion: string;
  patientLanguage: string[];
  fit: string[];
  notFit: string[];
  checks: string[];
  treatmentLens: string;
  wording: string;
  comparison: {
    focus: string;
    timeCourse: string;
    lookFor: string;
    caution: string;
  };
  keywords: string[];
  relatedSlugs: string[];
};

export const specifierFamilies: Array<{ id: "all" | SpecifierFamily; label: string; shortLabel: string }> = [
  { id: "all", label: "All specifiers", shortLabel: "All" },
  { id: "episode-features", label: "Episode features", shortLabel: "Features" },
  { id: "course-onset", label: "Course and onset", shortLabel: "Course" },
  { id: "severity-remission", label: "Severity and remission", shortLabel: "Severity" },
];

export const specifierRecords: SpecifierRecord[] = [
  {
    slug: "with-anxious-distress",
    name: "With anxious distress",
    shortName: "Anxious distress",
    family: "episode-features",
    familyLabel: "Episode features",
    appliesTo: ["Depressive disorders", "Bipolar disorders"],
    summary: "Prominent tension, restlessness, worry, or fear accompanies the current mood episode.",
    clinicalSignal: "Anxiety is woven into the mood episode and changes its risk and management profile.",
    decisionQuestion:
      "Is anxious arousal a meaningful part of this mood episode rather than a separate background condition?",
    patientLanguage: ["I feel keyed up all day", "Something awful is about to happen", "I cannot settle inside"],
    fit: [
      "Anxious tension or restlessness rises and falls with the mood episode.",
      "Worry, loss-of-control fears, or dread meaningfully increase distress or impairment.",
      "The pattern is present often enough to influence formulation and care planning.",
    ],
    notFit: [
      "Anxiety is better explained by a separate anxiety disorder with an independent course.",
      "Restlessness is more consistent with akathisia, intoxication, withdrawal, delirium, or another medical cause.",
    ],
    checks: [
      "Clarify timing against the mood episode",
      "Separate worry from psychotic threat beliefs",
      "Review agitation and suicide risk",
    ],
    treatmentLens:
      "Name the anxiety burden explicitly; it may affect monitoring, tolerability, risk, and pacing of treatment.",
    wording: "Major depressive disorder, current episode, with anxious distress",
    comparison: {
      focus: "Anxious arousal occurring within a mood episode",
      timeCourse: "Tracks the current depressive or manic-spectrum episode",
      lookFor: "Tension, restlessness, worry, dread, fear of losing control",
      caution: "Do not infer it from insomnia or agitation alone",
    },
    keywords: ["anxiety", "worry", "tense", "restless", "dread", "agitated depression", "fear", "keyed up"],
    relatedSlugs: ["with-mixed-features", "with-melancholic-features"],
  },
  {
    slug: "with-mixed-features",
    name: "With mixed features",
    shortName: "Mixed features",
    family: "episode-features",
    familyLabel: "Episode features",
    appliesTo: ["Depressive disorders", "Bipolar disorders"],
    summary: "Clinically meaningful symptoms of the opposite mood pole occur during the predominant mood episode.",
    clinicalSignal:
      "The presentation crosses mood poles rather than being explained by anxiety, irritability, or agitation alone.",
    decisionQuestion:
      "Are there distinct opposite-pole symptoms during this episode that change diagnostic and treatment reasoning?",
    patientLanguage: [
      "I am depressed but my thoughts are racing",
      "I barely sleep and still feel driven",
      "I feel sped up and hopeless",
    ],
    fit: [
      "Opposite-pole symptoms are observable, recurrent, and tied to the current episode.",
      "Activation includes features such as elevated drive, reduced need for sleep, or accelerated thought and speech.",
      "The pattern changes the assessment of bipolarity and antidepressant-related risk.",
    ],
    notFit: [
      "The only cross-over features are irritability, distractibility, insomnia, or nonspecific agitation.",
      "Activation is better explained by substances, medication, trauma arousal, ADHD, or another condition.",
    ],
    checks: [
      "Map symptoms to the predominant episode",
      "Ask about reduced need for sleep, not insomnia alone",
      "Review medication and substance timing",
    ],
    treatmentLens:
      "Treat as a cross-polar signal: reassess medication strategy, activation risk, and longitudinal bipolar history.",
    wording: "Major depressive disorder, current episode, with mixed features",
    comparison: {
      focus: "Opposite-pole mood symptoms",
      timeCourse: "Co-occur during the predominant mood episode",
      lookFor: "Distinct activation or depressive features from the opposite pole",
      caution: "Irritability and agitation are not sufficient by themselves",
    },
    keywords: ["mixed", "racing thoughts", "sped up", "less sleep", "activated", "agitated", "depressed and energised"],
    relatedSlugs: ["with-anxious-distress", "with-psychotic-features"],
  },
  {
    slug: "with-melancholic-features",
    name: "With melancholic features",
    shortName: "Melancholic features",
    family: "episode-features",
    familyLabel: "Episode features",
    appliesTo: ["Major depressive episodes"],
    summary:
      "Profound loss of pleasure or mood reactivity occurs with a characteristic biological and psychomotor pattern.",
    clinicalSignal: "Pleasure and emotional reactivity are markedly reduced, not merely overshadowed by stress.",
    decisionQuestion:
      "Is there a pervasive non-reactive depressive pattern with characteristic biological or psychomotor change?",
    patientLanguage: ["Nothing reaches me", "Even good news changes nothing", "Mornings are unbearable"],
    fit: [
      "There is marked anhedonia or very limited mood reactivity.",
      "The episode includes a coherent pattern such as early waking, diurnal change, psychomotor change, or excessive guilt.",
      "The presentation is qualitatively different from ordinary sadness or understandable distress.",
    ],
    notFit: [
      "Mood reliably brightens with positive events or interpersonal connection.",
      "Reduced enjoyment is better explained by sedation, negative symptoms, cognitive disorder, or environmental deprivation.",
    ],
    checks: [
      "Test mood reactivity with concrete examples",
      "Observe psychomotor change",
      "Clarify diurnal and sleep pattern",
    ],
    treatmentLens:
      "Document the biological and psychomotor pattern because it may influence treatment intensity and monitoring.",
    wording: "Major depressive disorder, current episode, with melancholic features",
    comparison: {
      focus: "Non-reactive, biologically patterned depression",
      timeCourse: "Persists across the depressive episode",
      lookFor: "Anhedonia, non-reactivity, diurnal change, psychomotor change, guilt",
      caution: "Severity alone does not establish melancholic features",
    },
    keywords: ["melancholic", "anhedonia", "non reactive", "early waking", "morning worse", "psychomotor", "guilt"],
    relatedSlugs: ["with-atypical-features", "with-psychotic-features"],
  },
  {
    slug: "with-atypical-features",
    name: "With atypical features",
    shortName: "Atypical features",
    family: "episode-features",
    familyLabel: "Episode features",
    appliesTo: ["Depressive disorders", "Bipolar depressive episodes"],
    summary: "Mood reactivity occurs with a characteristic reversed-vegetative or interpersonal sensitivity pattern.",
    clinicalSignal:
      "Mood can brighten in response to positive events despite a clinically significant depressive episode.",
    decisionQuestion:
      "Does mood reactivity sit alongside a coherent atypical depressive pattern rather than an isolated symptom?",
    patientLanguage: ["Good news can lift me for a while", "I sleep and eat much more", "Rejection knocks me flat"],
    fit: [
      "Mood shows genuine reactivity to positive events.",
      "The episode includes a compatible pattern such as increased sleep, increased appetite, leaden heaviness, or rejection sensitivity.",
      "The pattern is clinically meaningful and not simply a preference or coping style.",
    ],
    notFit: [
      "There is no meaningful mood reactivity.",
      "Sleep or appetite change is better explained by medication, shift work, endocrine illness, or another condition.",
    ],
    checks: [
      "Ask for a recent positive-event example",
      "Map sleep and appetite change from baseline",
      "Clarify longstanding rejection sensitivity",
    ],
    treatmentLens:
      "Capture the reactive and reversed-vegetative pattern without using “atypical” to mean unusual or mild.",
    wording: "Major depressive disorder, current episode, with atypical features",
    comparison: {
      focus: "Reactive mood with a characteristic symptom pattern",
      timeCourse: "Present through much of the depressive episode",
      lookFor: "Mood reactivity, hypersomnia, increased appetite, leaden feeling, rejection sensitivity",
      caution: "The label does not simply mean an unusual presentation",
    },
    keywords: ["atypical", "mood reactive", "hypersomnia", "sleeping more", "eating more", "leaden", "rejection"],
    relatedSlugs: ["with-melancholic-features", "with-anxious-distress"],
  },
  {
    slug: "with-psychotic-features",
    name: "With psychotic features",
    shortName: "Psychotic features",
    family: "episode-features",
    familyLabel: "Episode features",
    appliesTo: ["Depressive disorders", "Bipolar disorders"],
    summary:
      "Delusions or hallucinations occur during a severe mood episode and require explicit risk and diagnostic review.",
    clinicalSignal: "Psychosis is present, and its relationship to the mood episode determines the diagnostic wording.",
    decisionQuestion:
      "Do psychotic symptoms occur within the mood episode, and are they mood-congruent, mood-incongruent, or independent?",
    patientLanguage: ["I know I have ruined everyone", "A voice says I deserve punishment", "I have a special mission"],
    fit: [
      "Delusions or hallucinations are clearly present during the mood episode.",
      "The content, conviction, and behavioural impact have been assessed rather than inferred from severe worry or guilt.",
      "The longitudinal relationship between mood and psychosis is documented.",
    ],
    notFit: [
      "Unusual thoughts retain insight and do not reach delusional intensity.",
      "Psychosis persists outside mood episodes in a way that suggests a different primary diagnosis.",
    ],
    checks: [
      "Assess command content and immediate risk",
      "Map psychosis against mood chronology",
      "Describe congruence without forcing it",
    ],
    treatmentLens:
      "Escalate assessment and treatment intensity; document safety, capacity, and the mood–psychosis timeline.",
    wording: "Major depressive disorder, current episode, severe with psychotic features",
    comparison: {
      focus: "Delusions or hallucinations within a mood episode",
      timeCourse: "Mapped directly against mood-episode onset and remission",
      lookFor: "Conviction, perceptual disturbance, behavioural impact, congruence",
      caution: "Severe guilt, rumination, or intrusive thoughts are not automatically psychotic",
    },
    keywords: ["psychotic", "delusion", "hallucination", "voices", "paranoia", "mood congruent", "mood incongruent"],
    relatedSlugs: ["with-mixed-features", "with-catatonia"],
  },
  {
    slug: "with-catatonia",
    name: "With catatonia",
    shortName: "Catatonia",
    family: "episode-features",
    familyLabel: "Episode features",
    appliesTo: ["Mood disorders", "Psychotic disorders", "Medical conditions"],
    summary: "A marked psychomotor syndrome is present and needs structured, time-sensitive assessment.",
    clinicalSignal: "A cluster of psychomotor signs is more informative than immobility or reduced speech alone.",
    decisionQuestion:
      "Is there a coherent catatonic syndrome after urgent medical, neurological, toxic, and medication causes are considered?",
    patientLanguage: [
      "They have stopped moving and speaking",
      "They hold the same posture",
      "Their movements copy mine",
    ],
    fit: [
      "Multiple characteristic psychomotor signs are directly observed or reliably described.",
      "The change is substantial from baseline and not explained by ordinary withdrawal or fatigue.",
      "A structured examination and urgent physical assessment are underway.",
    ],
    notFit: [
      "Reduced movement is better explained by sedation, delirium, neurological disease, severe parkinsonism, or negative symptoms.",
      "Only one nonspecific sign is present without a broader syndrome.",
    ],
    checks: [
      "Record observed psychomotor signs",
      "Check hydration, intake, observations, and complications",
      "Review medicines and medical causes urgently",
    ],
    treatmentLens:
      "Treat catatonia as time-sensitive; coordinate urgent medical assessment and syndrome-specific management.",
    wording: "Bipolar I disorder, current episode depressed, with catatonia",
    comparison: {
      focus: "A clustered psychomotor syndrome",
      timeCourse: "Acute or subacute change requiring close observation",
      lookFor: "Immobility, posturing, negativism, echophenomena, stereotypy, agitation without purpose",
      caution: "Do not equate quietness, mutism, or immobility alone with catatonia",
    },
    keywords: [
      "catatonia",
      "mute",
      "mutism",
      "stupor",
      "posturing",
      "negativism",
      "echolalia",
      "echopraxia",
      "immobile",
    ],
    relatedSlugs: ["with-psychotic-features", "with-melancholic-features"],
  },
  {
    slug: "with-seasonal-pattern",
    name: "With seasonal pattern",
    shortName: "Seasonal pattern",
    family: "course-onset",
    familyLabel: "Course and onset",
    appliesTo: ["Recurrent depressive disorder", "Bipolar disorders"],
    summary:
      "Episodes show a repeated temporal relationship with a particular season and a contrasting pattern at another time of year.",
    clinicalSignal: "The recurring calendar-linked course matters more than the season in which one episode happens.",
    decisionQuestion:
      "Across years, is there a consistent seasonal onset-and-remission pattern that is not explained by seasonal stressors?",
    patientLanguage: ["Every winter I shut down", "It lifts each spring", "The same pattern returns each year"],
    fit: [
      "Episode onset repeatedly aligns with a particular season.",
      "Remission or a switch in mood polarity also follows a recurring seasonal relationship.",
      "Nonseasonal episodes do not dominate the longitudinal history.",
    ],
    notFit: [
      "Only the current episode occurred in winter or another season.",
      "The pattern is better explained by recurring work, anniversary, social, or environmental stressors.",
    ],
    checks: [
      "Build a multi-year month-by-month timeline",
      "Mark remissions as well as onsets",
      "Separate latitude and lifestyle effects from episode recurrence",
    ],
    treatmentLens:
      "Use the longitudinal pattern to support anticipatory monitoring and relapse planning before the usual onset period.",
    wording: "Major depressive disorder, recurrent, with seasonal pattern",
    comparison: {
      focus: "Recurring season-linked episode timing",
      timeCourse: "Demonstrated over repeated annual cycles",
      lookFor: "Consistent onset, remission, or polarity change in relation to season",
      caution: "One winter episode is not a seasonal pattern",
    },
    keywords: ["seasonal", "winter depression", "summer", "spring", "every year", "annual", "season"],
    relatedSlugs: ["with-peripartum-onset", "with-rapid-cycling"],
  },
  {
    slug: "with-peripartum-onset",
    name: "With peripartum onset",
    shortName: "Peripartum onset",
    family: "course-onset",
    familyLabel: "Course and onset",
    appliesTo: ["Depressive disorders", "Bipolar disorders"],
    summary: "A mood episode begins during pregnancy or in the period soon after birth.",
    clinicalSignal:
      "Timing around pregnancy and birth changes safety assessment, treatment context, and family support needs.",
    decisionQuestion:
      "Did the mood episode begin in the peripartum window, and are bipolarity, psychosis, and immediate safety actively assessed?",
    patientLanguage: [
      "This began during the pregnancy",
      "I have not felt like myself since the birth",
      "I am frightened by what my mind is doing",
    ],
    fit: [
      "Episode onset is clearly linked to pregnancy or the early post-birth period.",
      "The assessment distinguishes depressive, manic-spectrum, psychotic, anxiety, trauma, and adjustment presentations.",
      "Parent, infant, sleep, feeding, support, and safeguarding needs are considered together.",
    ],
    notFit: [
      "The episode clearly pre-dated pregnancy without a meaningful peripartum onset or recurrence.",
      "Symptoms are better explained by transient adjustment alone, while still recognising that distress may require care.",
    ],
    checks: [
      "Screen urgently for psychosis and mania",
      "Assess parent and infant safety",
      "Review sleep loss, supports, medicines, and feeding context",
    ],
    treatmentLens:
      "Coordinate timely perinatal mental health care; new psychosis, mania, or severe deterioration requires urgent escalation.",
    wording: "Major depressive disorder, single episode, with peripartum onset",
    comparison: {
      focus: "Mood-episode onset around pregnancy or birth",
      timeCourse: "Defined by episode onset, not simply current parenting status",
      lookFor: "Onset timing, bipolar indicators, psychosis, sleep loss, safety and support",
      caution: "Do not treat all post-birth distress as unipolar depression",
    },
    keywords: ["peripartum", "postpartum", "postnatal", "pregnancy", "after birth", "new mother", "new parent"],
    relatedSlugs: ["with-psychotic-features", "with-mixed-features"],
  },
  {
    slug: "with-rapid-cycling",
    name: "With rapid cycling",
    shortName: "Rapid cycling",
    family: "course-onset",
    familyLabel: "Course and onset",
    appliesTo: ["Bipolar I disorder", "Bipolar II disorder"],
    summary: "Multiple distinct mood episodes occur within a year, separated by remission or a switch in polarity.",
    clinicalSignal: "Count syndromal episodes across time; do not substitute moment-to-moment emotional lability.",
    decisionQuestion:
      "Does the longitudinal timeline show repeated distinct episodes rather than rapid shifts within one episode?",
    patientLanguage: [
      "I have had several separate episodes this year",
      "I recover and then switch again",
      "My mood episodes keep returning",
    ],
    fit: [
      "Distinct depressive, manic, or hypomanic episodes can be identified on a timeline.",
      "Episodes are separated by remission or a clear switch in mood polarity.",
      "Medication, thyroid, substance, sleep, and reproductive factors have been reviewed.",
    ],
    notFit: [
      "Mood shifts occur within hours in response to events without distinct syndromal episodes.",
      "A single prolonged mixed, unstable, or substance-related episode is being counted as several episodes.",
    ],
    checks: [
      "Build a 12-month episode timeline",
      "Mark recovery and polarity switches",
      "Review treatment and biological contributors",
    ],
    treatmentLens: "Use the episode timeline to guide maintenance strategy and reduce destabilising contributors.",
    wording: "Bipolar I disorder, current episode depressed, with rapid cycling",
    comparison: {
      focus: "Frequency of distinct bipolar mood episodes",
      timeCourse: "Counted across a defined 12-month interval",
      lookFor: "Syndromal episodes, remission intervals, polarity switches",
      caution: "Emotional lability is not the same as rapid cycling",
    },
    keywords: [
      "rapid cycling",
      "several episodes",
      "many episodes",
      "four episodes",
      "mood switches",
      "bipolar course",
      "lability",
    ],
    relatedSlugs: ["with-mixed-features", "with-seasonal-pattern"],
  },
  {
    slug: "mild-severity",
    name: "Mild severity",
    shortName: "Mild",
    family: "severity-remission",
    familyLabel: "Severity and remission",
    appliesTo: ["Mood disorders", "Other specified diagnoses"],
    summary: "Symptoms meet the disorder threshold with limited excess symptoms, distress, and functional impairment.",
    clinicalSignal: "Severity describes the whole episode: symptom burden, intensity, risk, and functional impact.",
    decisionQuestion:
      "Is the current episode genuinely lower in burden and impairment while still meeting the diagnostic threshold?",
    patientLanguage: ["I can still function, but it takes much more effort", "Symptoms are present but contained"],
    fit: [
      "The diagnostic threshold is met.",
      "Symptoms beyond the minimum are limited and their intensity is manageable.",
      "Functional impairment is present but relatively contained.",
    ],
    notFit: [
      "Risk, psychosis, catatonia, marked impairment, or severe biological disturbance indicates a higher severity level.",
      "The person is below diagnostic threshold, in which case remission or another formulation may be more accurate.",
    ],
    checks: [
      "Separate symptom count from intensity",
      "Document functional impact",
      "Check risk and protective factors",
    ],
    treatmentLens: "Match treatment intensity to need while avoiding minimisation of meaningful distress or risk.",
    wording: "Major depressive disorder, single episode, mild",
    comparison: {
      focus: "Current episode burden and impairment",
      timeCourse: "Rated for the present episode",
      lookFor: "Symptom load, intensity, risk, and function",
      caution: "Functioning at work does not automatically mean mild illness",
    },
    keywords: ["mild", "severity", "still functioning", "limited impairment", "low severity"],
    relatedSlugs: ["in-partial-remission", "in-full-remission"],
  },
  {
    slug: "in-partial-remission",
    name: "In partial remission",
    shortName: "Partial remission",
    family: "severity-remission",
    familyLabel: "Severity and remission",
    appliesTo: ["Mood disorders", "Psychotic disorders"],
    summary:
      "The full syndrome has improved, but meaningful symptoms remain or a sustained symptom-free interval has not yet been established.",
    clinicalSignal: "The person is better but not symptom-free, or recovery is too recent to call full remission.",
    decisionQuestion:
      "Has the episode clearly receded while residual symptoms or insufficient duration prevent full-remission wording?",
    patientLanguage: [
      "I am much better, but not back to myself",
      "Some symptoms are still there",
      "The worst has passed",
    ],
    fit: [
      "Full criteria are no longer met or there has been substantial improvement.",
      "Residual symptoms remain clinically meaningful, or the improved interval is not yet sustained.",
      "Function and risk have improved but still require active follow-up.",
    ],
    notFit: [
      "The person still meets full current-episode criteria.",
      "No significant symptoms remain and the recovery interval supports full-remission wording.",
    ],
    checks: [
      "List residual symptoms explicitly",
      "Document change in function and risk",
      "Confirm the recovery timeline",
    ],
    treatmentLens:
      "Target residual symptoms and relapse prevention; partial recovery can still carry substantial recurrence risk.",
    wording: "Major depressive disorder, recurrent, in partial remission",
    comparison: {
      focus: "Incomplete recovery from the most recent episode",
      timeCourse: "After improvement, before sustained full remission",
      lookFor: "Residual symptoms, recent recovery, persistent functional impact",
      caution: "Improvement alone does not mean the current episode has ended",
    },
    keywords: [
      "partial remission",
      "improving",
      "better but",
      "residual symptoms",
      "not fully recovered",
      "recovering",
    ],
    relatedSlugs: ["in-full-remission", "mild-severity"],
  },
  {
    slug: "in-full-remission",
    name: "In full remission",
    shortName: "Full remission",
    family: "severity-remission",
    familyLabel: "Severity and remission",
    appliesTo: ["Mood disorders", "Psychotic disorders"],
    summary: "No significant signs or symptoms of the recent episode remain across a sustained interval.",
    clinicalSignal: "Full remission is a longitudinal conclusion, not a single good day or improvement from baseline.",
    decisionQuestion:
      "Are clinically significant episode symptoms absent, with recovery sustained long enough to support full-remission wording?",
    patientLanguage: ["I feel back to my usual self", "The episode symptoms have gone", "I have been well and stable"],
    fit: [
      "Significant signs and symptoms of the recent episode are no longer present.",
      "Recovery is sustained rather than a brief fluctuation.",
      "Current functioning and risk are consistent with remission, while relapse prevention continues.",
    ],
    notFit: [
      "Residual symptoms remain clinically meaningful.",
      "The person has only recently improved or still meets current-episode criteria.",
    ],
    checks: [
      "Confirm symptom absence across settings",
      "Review duration and function",
      "Maintain relapse and early-warning planning",
    ],
    treatmentLens:
      "Continue maintenance and relapse-prevention planning; remission does not imply treatment or monitoring is unnecessary.",
    wording: "Major depressive disorder, recurrent, in full remission",
    comparison: {
      focus: "Sustained absence of significant episode symptoms",
      timeCourse: "Established after a durable recovery interval",
      lookFor: "Symptom resolution, stable function, sustained recovery",
      caution: "Do not infer full remission from partial improvement",
    },
    keywords: ["full remission", "recovered", "well now", "symptom free", "stable", "back to normal"],
    relatedSlugs: ["in-partial-remission", "mild-severity"],
  },
];

export function findSpecifier(slug: string) {
  return specifierRecords.find((record) => record.slug === slug);
}

export function normalizeSpecifierSelection(slugs: string[]) {
  const selected: string[] = [];
  // The builder words psychotic features as "severe with psychotic features", a current-severity
  // descriptor, so it conflicts with every other severity or remission descriptor. The latest pick wins.
  const conflictsBySlug: Record<string, readonly string[]> = {
    "mild-severity": ["with-psychotic-features"],
    "in-partial-remission": ["with-psychotic-features"],
    "in-full-remission": ["with-psychotic-features"],
    "with-psychotic-features": ["mild-severity", "in-partial-remission", "in-full-remission"],
  };

  for (const slug of slugs) {
    const record = findSpecifier(slug);
    if (!record || selected.includes(slug)) continue;

    if (record.family === "severity-remission") {
      const retained = selected.filter((selectedSlug) => findSpecifier(selectedSlug)?.family !== "severity-remission");
      selected.splice(0, selected.length, ...retained);
    }

    const conflicts = new Set(conflictsBySlug[slug] ?? []);
    if (conflicts.size) {
      const retained = selected.filter((selectedSlug) => !conflicts.has(selectedSlug));
      selected.splice(0, selected.length, ...retained);
    }

    selected.push(slug);
  }

  return selected;
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ignoredSearchWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "i",
  "in",
  "is",
  "it",
  "of",
  "or",
  "the",
  "to",
  "with",
]);

function searchTokens(query: string) {
  return normalizeSearchText(query)
    .split(" ")
    .filter((token) => token.length > 1 && !ignoredSearchWords.has(token));
}

function recordSearchText(record: SpecifierRecord) {
  return normalizeSearchText(
    [
      record.name,
      record.shortName,
      record.familyLabel,
      ...record.appliesTo,
      record.summary,
      record.clinicalSignal,
      record.decisionQuestion,
      ...record.patientLanguage,
      ...record.keywords,
    ].join(" "),
  );
}

const diagnosisFiltersByApplicability: Record<SpecifierApplicability, readonly string[]> = {
  "Depressive disorders": ["depressive", "mood"],
  "Bipolar disorders": ["bipolar", "mood"],
  "Major depressive episodes": ["depressive", "bipolar", "mood"],
  "Bipolar depressive episodes": ["bipolar", "mood"],
  "Mood disorders": ["depressive", "bipolar", "mood"],
  "Psychotic disorders": ["psychotic"],
  "Medical conditions": [],
  "Recurrent depressive disorder": ["depressive", "mood"],
  "Bipolar I disorder": ["bipolar", "mood"],
  "Bipolar II disorder": ["bipolar", "mood"],
  "Other specified diagnoses": [],
};

const builderDiagnosesByApplicability: Record<SpecifierApplicability, readonly SpecifierBuilderDiagnosis[]> = {
  "Depressive disorders": ["mdd-recurrent", "mdd-single"],
  "Bipolar disorders": [
    "bipolar-i-depressed",
    "bipolar-i-manic",
    "bipolar-i-hypomanic",
    "bipolar-ii-depressed",
    "bipolar-ii-hypomanic",
  ],
  "Major depressive episodes": ["mdd-recurrent", "mdd-single", "bipolar-i-depressed", "bipolar-ii-depressed"],
  "Bipolar depressive episodes": ["bipolar-i-depressed", "bipolar-ii-depressed"],
  "Mood disorders": [
    "mdd-recurrent",
    "mdd-single",
    "bipolar-i-depressed",
    "bipolar-i-manic",
    "bipolar-i-hypomanic",
    "bipolar-ii-depressed",
    "bipolar-ii-hypomanic",
  ],
  "Psychotic disorders": [],
  "Medical conditions": [],
  "Recurrent depressive disorder": ["mdd-recurrent"],
  "Bipolar I disorder": ["bipolar-i-depressed", "bipolar-i-manic", "bipolar-i-hypomanic"],
  "Bipolar II disorder": ["bipolar-ii-depressed", "bipolar-ii-hypomanic"],
  "Other specified diagnoses": [],
};

export function specifierAppliesToBuilderDiagnosis(record: SpecifierRecord, diagnosis: SpecifierBuilderDiagnosis) {
  return record.appliesTo.some((applicability) => builderDiagnosesByApplicability[applicability]?.includes(diagnosis));
}

const knownDiagnosisFilters = new Set(["depressive", "bipolar", "psychotic", "mood"]);

function matchesDiagnosisFilter(record: SpecifierRecord, diagnosis: string) {
  if (!diagnosis) return true;
  if (!knownDiagnosisFilters.has(diagnosis)) {
    return normalizeSearchText(record.appliesTo.join(" ")).includes(diagnosis);
  }

  return record.appliesTo.some((applicability) => diagnosisFiltersByApplicability[applicability]?.includes(diagnosis));
}

export function searchSpecifiers(
  query: string,
  options: { family?: "all" | SpecifierFamily; diagnosis?: string; expansions?: readonly string[] } = {},
) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = searchTokens(query);
  const expansionTokens = Array.from(
    new Set((options.expansions ?? []).flatMap((expansion) => searchTokens(expansion))),
  );
  const diagnosis = normalizeSearchText(options.diagnosis ?? "");

  return specifierRecords
    .filter((record) => !options.family || options.family === "all" || record.family === options.family)
    .filter((record) => matchesDiagnosisFilter(record, diagnosis))
    .map((record, index) => {
      const title = normalizeSearchText(`${record.name} ${record.shortName}`);
      const keywords = normalizeSearchText(record.keywords.join(" "));
      const haystack = recordSearchText(record);
      let score = normalizedQuery ? 0 : specifierRecords.length - index;

      if (normalizedQuery && title.includes(normalizedQuery)) score += 80;
      if (normalizedQuery && keywords.includes(normalizedQuery)) score += 55;
      for (const token of tokens) {
        if (title.includes(token)) score += 18;
        if (keywords.includes(token)) score += 10;
        if (haystack.includes(token)) score += 3;
      }
      for (const token of expansionTokens) {
        if (title.includes(token)) score += 6;
        if (keywords.includes(token)) score += 4;
        if (haystack.includes(token)) score += 1;
      }

      return { record, score };
    })
    .filter((result) => !normalizedQuery || result.score > 0)
    .sort((left, right) => right.score - left.score || left.record.name.localeCompare(right.record.name));
}

export function relatedSpecifiers(record: SpecifierRecord) {
  return record.relatedSlugs.map(findSpecifier).filter((item): item is SpecifierRecord => Boolean(item));
}
