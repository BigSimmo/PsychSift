export const dictionaryEntryKinds = [
  "clinical-concept",
  "clinical-finding",
  "assessment",
  "condition",
  "medication-class",
  "therapy",
  "service-model",
  "legal-ethical-concept",
] as const;

export type DictionaryEntryKind = (typeof dictionaryEntryKinds)[number];
export type DictionaryAliasKind = "abbreviation" | "synonym" | "alternate-spelling";
export type DictionarySupportedField = "definition" | "context" | "distinction" | "comparison";

export type DictionaryAlias = {
  value: string;
  kind: DictionaryAliasKind;
};

export type DictionarySource = {
  id: string;
  title: string;
  organisation: string;
  url: string;
  region: "Australia" | "International";
  accessedOn: string;
};

export type DictionarySourceRef = {
  sourceId: string;
  supports: readonly DictionarySupportedField[];
};

export type DictionaryDistinction = {
  slug: string;
  summary: string;
  sourceRefs: readonly DictionarySourceRef[];
};

export type DictionaryEntry = {
  slug: string;
  term: string;
  definition: string;
  meaning: string;
  kind: DictionaryEntryKind;
  topicSlug: string;
  aliases: readonly DictionaryAlias[];
  context: readonly string[];
  comparison: {
    purpose: string;
    scope: string;
    clinicalContext: string;
  };
  sourceRefs: readonly DictionarySourceRef[];
  distinctions: readonly DictionaryDistinction[];
  relatedSlugs: readonly string[];
  review: {
    status: "source-linked";
    checkedOn: string;
    dueOn: string;
    clinicalApproval: "pending";
  };
};

export type DictionaryTopic = {
  slug: string;
  title: string;
  description: string;
  entrySlugs: readonly string[];
  relatedTopicSlugs: readonly string[];
  curatedComparisons: readonly [string, string][];
};

export type DictionaryComparisonPair = {
  slugs: readonly [string, string];
  summary: string;
  sourceRefs: readonly DictionarySourceRef[];
};

type EntrySeed = readonly [
  term: string,
  definition: string,
  kind: DictionaryEntryKind,
  aliases?: readonly DictionaryAlias[],
];

type TopicSeed = {
  slug: string;
  title: string;
  description: string;
  sourceId: string;
  entries: readonly EntrySeed[];
  related: readonly string[];
  comparisons: readonly [string, string][];
};

const ACCESSED_ON = "2026-08-18";
const REPLACEMENT_ACCESSED_ON = "2026-09-26";
const AUDIT_ACCESSED_ON = "2026-10-20";
const REVIEW = {
  status: "source-linked",
  checkedOn: ACCESSED_ON,
  dueOn: "2027-08-18",
  clinicalApproval: "pending",
} as const;

export const dictionarySources = [
  // The eight assessment entries once cited WSLHD's "Getting Started in Psychiatry" handbook,
  // which is no longer hosted anywhere. Each now cites the pages below, read 2026-09-26.
  {
    id: "nsw-health-mh-documentation",
    title: "Mental Health Clinical Documentation Guidelines (GL2014_002)",
    organisation: "NSW Health",
    url: "https://www1.health.nsw.gov.au/pds/ActivePDSDocuments/GL2014_002.pdf",
    region: "Australia",
    accessedOn: REPLACEMENT_ACCESSED_ON,
  },
  {
    id: "rch-mental-state-examination",
    title: "Clinical Practice Guidelines: Mental state examination",
    organisation: "The Royal Children's Hospital Melbourne",
    url: "https://www.rch.org.au/clinicalguide/guideline_index/mental_state_examination/",
    region: "Australia",
    accessedOn: REPLACEMENT_ACCESSED_ON,
  },
  {
    id: "healthdirect-mmse",
    title: "Mini-Mental State Examination (MMSE)",
    organisation: "Healthdirect Australia",
    url: "https://www.healthdirect.gov.au/mini-mental-state-examination-mmse",
    region: "Australia",
    accessedOn: REPLACEMENT_ACCESSED_ON,
  },
  {
    id: "ranzcp-assessment",
    title: "Assessment",
    organisation: "Royal Australian and New Zealand College of Psychiatrists",
    url: "https://www.ranzcp.org/education-library/medical-expert/assessment",
    region: "Australia",
    accessedOn: REPLACEMENT_ACCESSED_ON,
  },
  {
    id: "aci-cognitive-screening",
    title: "Undertake cognitive screening",
    organisation: "NSW Agency for Clinical Innovation",
    url: "https://aci.health.nsw.gov.au/chops/chops-key-principles/undertake-cognitive-screening",
    region: "Australia",
    accessedOn: REPLACEMENT_ACCESSED_ON,
  },
  {
    id: "amhocn-nocc-measures",
    title: "NOCC Measures",
    organisation: "Australian Mental Health Outcomes and Classification Network",
    url: "https://www.amhocn.org/nocc-collection/nocc-measures",
    region: "Australia",
    accessedOn: REPLACEMENT_ACCESSED_ON,
  },
  {
    id: "columbia-scid",
    title: "Structured Clinical Interview for DSM Disorders (SCID)",
    organisation: "Columbia University Department of Psychiatry",
    url: "https://www.columbiapsychiatry.org/research/research-areas/services-policy-and-law/structured-clinical-interview-dsm-disorders-scid",
    region: "International",
    accessedOn: REPLACEMENT_ACCESSED_ON,
  },
  {
    id: "nsw-mental-assessment",
    title: "Mental health assessment",
    organisation: "NSW Agency for Clinical Innovation",
    url: "https://aci.health.nsw.gov.au/ecat/adult/assessment/mental",
    region: "Australia",
    accessedOn: ACCESSED_ON,
  },
  {
    id: "healthdirect-mental-health",
    title: "Mental health conditions",
    organisation: "Healthdirect Australia",
    url: "https://www.healthdirect.gov.au/mental-health-conditions",
    region: "Australia",
    accessedOn: ACCESSED_ON,
  },
  {
    id: "healthdirect-psychosis",
    title: "Psychosis",
    organisation: "Healthdirect Australia",
    url: "https://www.healthdirect.gov.au/psychosis",
    region: "Australia",
    accessedOn: ACCESSED_ON,
  },
  {
    id: "healthdirect-antipsychotics",
    title: "Antipsychotic medicines",
    organisation: "Healthdirect Australia",
    url: "https://www.healthdirect.gov.au/antipsychotic-medicines",
    region: "Australia",
    accessedOn: ACCESSED_ON,
  },
  {
    id: "australian-prescriber-movement",
    title: "Drug-induced movement disorders",
    organisation: "Australian Prescriber",
    url: "https://australianprescriber.tg.org.au/articles/drug-induced-movement-disorders.html",
    region: "Australia",
    accessedOn: ACCESSED_ON,
  },
  {
    id: "healthdirect-psychotherapy",
    title: "Psychotherapy",
    organisation: "Healthdirect Australia",
    url: "https://www.healthdirect.gov.au/psychotherapy",
    region: "Australia",
    accessedOn: ACCESSED_ON,
  },
  {
    id: "healthdirect-dbt",
    title: "Dialectical behaviour therapy",
    organisation: "Healthdirect Australia",
    url: "https://www.healthdirect.gov.au/dialectical-behaviour-therapy-dbt",
    region: "Australia",
    accessedOn: ACCESSED_ON,
  },
  {
    id: "aihw-aod-glossary",
    title: "Alcohol and other drug treatment services glossary",
    organisation: "Australian Institute of Health and Welfare",
    url: "https://www.aihw.gov.au/reports-data/health-welfare-services/alcohol-other-drug-treatment-services/glossary",
    region: "Australia",
    accessedOn: ACCESSED_ON,
  },
  {
    id: "health-recovery-framework",
    title: "A national framework for recovery-oriented mental health services",
    organisation: "Australian Government Department of Health, Disability and Ageing",
    url: "https://www.health.gov.au/resources/publications/a-national-framework-for-recovery-oriented-mental-health-services-guide-for-practitioners-and-providers?language=en",
    region: "Australia",
    accessedOn: ACCESSED_ON,
  },
  // Replaced the Commonwealth "Rights and responsibilities in mental health care" page, which no
  // longer exists (clinical content audit R7-F-11, 2026-10-20). Capacity is s 15, informed consent
  // s 16, involuntary treatment orders ss 21-22, and least restrictive care and involvement in
  // decision-making are Charter Principles 4, 5 and 12 in Schedule 1.
  {
    id: "wa-mental-health-act-2014",
    title: "Mental Health Act 2014 (WA), including Schedule 1: Charter of Mental Health Care Principles",
    organisation: "Parliamentary Counsel's Office, Western Australia",
    url: "https://www.legislation.wa.gov.au/legislation/prod/filestore.nsf/FileURL/mrdoc_48919.htm/$FILE/Mental%20Health%20Act%202014%20-%20%5B02-b0-02%5D.html?OpenElement",
    region: "Australia",
    accessedOn: AUDIT_ACCESSED_ON,
  },
  {
    id: "who-safety-planning",
    title: "Safety planning interventions",
    organisation: "World Health Organization",
    url: "https://www.who.int/teams/mental-health-and-substance-use/treatment-care/mental-health-gap-action-programme/evidence-centre/self-harm-and-suicide/safety-planning-interventions",
    region: "International",
    accessedOn: ACCESSED_ON,
  },
  {
    id: "nice-delirium",
    title: "Delirium: context",
    organisation: "National Institute for Health and Care Excellence",
    url: "https://www.nice.org.uk/guidance/CG103/chapter/context",
    region: "International",
    accessedOn: ACCESSED_ON,
  },
  // Per-entry sources that define the term itself, replacing topic pages that did not
  // (clinical content audit R7-F-11, read 2026-10-20).
  {
    id: "healthdirect-ocd",
    title: "Obsessive-compulsive disorder (OCD)",
    organisation: "Healthdirect Australia",
    url: "https://www.healthdirect.gov.au/obsessive-compulsive-disorder-ocd",
    region: "Australia",
    accessedOn: AUDIT_ACCESSED_ON,
  },
  {
    id: "mesh-anti-anxiety-agents",
    title: "Anti-Anxiety Agents (entry term: Anxiolytics) — Medical Subject Headings",
    organisation: "U.S. National Library of Medicine",
    url: "https://www.ncbi.nlm.nih.gov/mesh/68014151",
    region: "International",
    accessedOn: AUDIT_ACCESSED_ON,
  },
  {
    id: "mesh-attention",
    title: "Attention (entry term: Mental Concentration) — Medical Subject Headings",
    organisation: "U.S. National Library of Medicine",
    url: "https://www.ncbi.nlm.nih.gov/mesh/68001288",
    region: "International",
    accessedOn: AUDIT_ACCESSED_ON,
  },
  {
    id: "mesh-irritable-mood",
    title: "Irritable Mood — Medical Subject Headings",
    organisation: "U.S. National Library of Medicine",
    url: "https://www.ncbi.nlm.nih.gov/mesh/68007508",
    region: "International",
    accessedOn: AUDIT_ACCESSED_ON,
  },
  {
    id: "mesh-anhedonia",
    title: "Anhedonia — Medical Subject Headings",
    organisation: "U.S. National Library of Medicine",
    url: "https://www.ncbi.nlm.nih.gov/mesh/68059445",
    region: "International",
    accessedOn: AUDIT_ACCESSED_ON,
  },
  {
    id: "nice-depression-adults",
    title: "Depression in adults: treatment and management (NG222), recommendations",
    organisation: "National Institute for Health and Care Excellence",
    url: "https://www.nice.org.uk/guidance/ng222/chapter/Recommendations",
    region: "International",
    accessedOn: AUDIT_ACCESSED_ON,
  },
] as const satisfies readonly DictionarySource[];

const abbr = (value: string): readonly DictionaryAlias[] => [{ value, kind: "abbreviation" }];

const topicSeeds = [
  {
    slug: "assessment-and-measurement",
    title: "Assessment and measurement",
    description: "Assessment concepts, interviews, screening and rating tools used across mental health care.",
    sourceId: "nsw-health-mh-documentation",
    related: ["mental-state-examination-domains", "cognition-and-neuropsychiatry"],
    comparisons: [
      ["mental-state-examination", "mini-mental-state-examination"],
      ["screening-instrument", "clinical-assessment"],
    ],
    entries: [
      [
        "Clinical assessment",
        "A systematic process of gathering and integrating information to understand a person's current needs and clinical presentation.",
        "assessment",
      ],
      [
        "Mental state examination",
        "A structured description of a person's current mental presentation, based on interview and observation.",
        "assessment",
        abbr("MSE"),
      ],
      [
        "Mini-Mental State Examination",
        "A brief standardised instrument that samples selected areas of cognitive function.",
        "assessment",
        abbr("MMSE"),
      ],
      [
        "Psychiatric history",
        "A structured account of mental health experiences, treatments, context and relevant health history over time.",
        "assessment",
      ],
      [
        "Clinical interview",
        "A purposeful conversation used to gather information, understand concerns and establish a therapeutic working relationship.",
        "assessment",
      ],
      [
        "Structured clinical interview",
        "An interview that uses a defined sequence of questions and decision rules.",
        "assessment",
        abbr("SCI"),
      ],
      [
        "Screening instrument",
        "A brief tool used to identify whether more detailed assessment may be warranted.",
        "assessment",
      ],
      [
        "Rating scale",
        "A standardised set of items used to describe or monitor the severity or frequency of selected features.",
        "assessment",
      ],
    ],
  },
  {
    slug: "mental-state-examination-domains",
    title: "Mental state examination domains",
    description: "Observable and reported domains commonly organised within a mental state examination.",
    sourceId: "nsw-mental-assessment",
    related: ["assessment-and-measurement", "mood-and-affect", "psychosis-and-perception"],
    comparisons: [["mood", "affect"]],
    entries: [
      [
        "Appearance",
        "Observable aspects of presentation such as dress, grooming, posture and general physical presentation.",
        "clinical-finding",
      ],
      ["Behaviour", "Observable actions, engagement and manner during an interaction.", "clinical-finding"],
      [
        "Psychomotor activity",
        "The observed pace, amount and quality of movement associated with mental activity.",
        "clinical-finding",
      ],
      [
        "Speech",
        "Observable qualities of spoken communication, including rate, volume, rhythm and quantity.",
        "clinical-finding",
      ],
      ["Mood", "A person's sustained, subjectively reported emotional state.", "clinical-concept"],
      ["Affect", "The observable expression and responsiveness of emotion during an interaction.", "clinical-finding"],
      [
        "Thought form",
        "The organisation, flow and connection of ideas as expressed in speech or writing.",
        "clinical-finding",
      ],
      [
        "Insight",
        "A person's awareness and understanding of their experiences, difficulties and possible need for care.",
        "clinical-concept",
      ],
    ],
  },
  {
    slug: "mood-and-affect",
    title: "Mood and affect",
    description: "Terms describing reported mood and observed emotional expression.",
    sourceId: "nsw-mental-assessment",
    related: ["mental-state-examination-domains", "conditions-risk-and-safety"],
    comparisons: [["mood", "affect"]],
    entries: [
      [
        "Euthymia",
        "A term used for a stable mood that is neither markedly depressed nor elevated.",
        "clinical-concept",
      ],
      [
        "Low mood",
        "A subjectively reported state of sadness, reduced emotional wellbeing or lowered mood.",
        "clinical-finding",
      ],
      [
        "Elevated mood",
        "A subjectively reported mood that is unusually raised, expansive or euphoric for the context.",
        "clinical-finding",
      ],
      [
        "Anhedonia",
        "A marked reduction in interest in, or pleasure from, activities that were usually rewarding.",
        "clinical-finding",
      ],
      [
        "Irritability",
        "A state of increased sensitivity to frustration or readiness to respond with annoyance or anger.",
        "clinical-finding",
      ],
      [
        "Affective range",
        "The breadth and variety of emotional expression observed during an interaction.",
        "clinical-finding",
      ],
      [
        "Affective reactivity",
        "The degree to which observed emotional expression changes in response to topics or events.",
        "clinical-finding",
      ],
      [
        "Emotional lability",
        "Rapid or marked shifts in emotional expression that may be difficult to regulate.",
        "clinical-finding",
      ],
    ],
  },
  {
    slug: "psychosis-and-perception",
    title: "Psychosis and perception",
    description: "Psychotic experiences, perceptual phenomena and nearby terms that require careful distinction.",
    sourceId: "healthdirect-psychosis",
    related: ["mental-state-examination-domains", "conditions-risk-and-safety"],
    comparisons: [
      ["auditory-hallucination", "inner-speech"],
      ["delusion", "intrusive-thought"],
    ],
    entries: [
      [
        "Psychosis",
        "A syndrome in which a person's interpretation of reality is substantially altered, often involving hallucinations, delusions or disorganised thinking.",
        "clinical-concept",
      ],
      [
        "Delusion",
        "A fixed belief held with strong conviction despite evidence or shared cultural understanding to the contrary.",
        "clinical-finding",
      ],
      [
        "Hallucination",
        "A sensory-like experience occurring without a corresponding external stimulus.",
        "clinical-finding",
      ],
      [
        "Auditory hallucination",
        "The perception of sound, such as voices or other noises, without a corresponding external acoustic source.",
        "clinical-finding",
        [{ value: "hearing voices", kind: "synonym" }],
      ],
      [
        "Inner speech",
        "The internal experience of words or a voice recognised as one's own thinking.",
        "clinical-concept",
      ],
      [
        "Intrusive thought",
        "An unwanted thought, image or impulse that enters awareness and is experienced as difficult to dismiss.",
        "clinical-finding",
      ],
      ["Mishearing", "An incorrect interpretation of an external sound that is actually present.", "clinical-finding"],
      [
        "Thought broadcasting",
        "The experience or belief that one's thoughts are accessible to other people.",
        "clinical-finding",
      ],
    ],
  },
  {
    slug: "cognition-and-neuropsychiatry",
    title: "Cognition and neuropsychiatry",
    description: "Cognitive functions and syndromes commonly assessed in mental health and general clinical care.",
    sourceId: "nice-delirium",
    related: ["assessment-and-measurement", "conditions-risk-and-safety"],
    comparisons: [["delirium", "dementia"]],
    entries: [
      [
        "Cognition",
        "The set of mental processes used to take in, organise, retain and use information.",
        "clinical-concept",
      ],
      ["Orientation", "Awareness of relevant aspects of time, place, person and situation.", "clinical-finding"],
      ["Attention", "The capacity to select and direct mental focus toward relevant information.", "clinical-concept"],
      ["Concentration", "The capacity to sustain mental effort and focus over time.", "clinical-concept"],
      ["Memory", "The processes involved in registering, storing and retrieving information.", "clinical-concept"],
      [
        "Executive function",
        "Higher-order abilities used to plan, organise, shift approach and regulate goal-directed behaviour.",
        "clinical-concept",
      ],
      [
        "Delirium",
        "An acute, fluctuating syndrome involving disturbance of attention, awareness and other cognitive functions.",
        "condition",
      ],
      [
        "Dementia",
        "A syndrome involving acquired and persistent decline in cognitive function that interferes with everyday life.",
        "condition",
      ],
    ],
  },
  {
    slug: "conditions-risk-and-safety",
    title: "Conditions, risk and safety",
    description: "Common mental health conditions and terms used in safety-focused clinical work.",
    sourceId: "healthdirect-mental-health",
    related: ["mood-and-affect", "anxiety-trauma-and-dissociation"],
    comparisons: [["clinical-assessment", "risk-assessment"]],
    entries: [
      [
        "Depressive disorder",
        "A mental health condition characterised by persistent depressed mood, loss of interest or related changes that impair functioning.",
        "condition",
      ],
      [
        "Bipolar disorder",
        "A mental health condition involving episodes of marked mood elevation and episodes of depression or other mood disturbance.",
        "condition",
      ],
      [
        "Schizophrenia",
        "A mental health condition that may affect thinking, perception, emotion and functioning over time.",
        "condition",
      ],
      [
        "Anxiety disorder",
        "A group of conditions in which anxiety or fear is persistent, excessive and interferes with daily life.",
        "condition",
      ],
      [
        "Obsessive-compulsive disorder",
        "A condition involving obsessions, compulsions or both that cause distress or interfere with functioning.",
        "condition",
        abbr("OCD"),
      ],
      [
        "Suicide risk",
        "A clinical formulation of factors associated with possible suicidal thoughts, plans or behaviour at a particular time.",
        "clinical-concept",
      ],
      [
        "Self-harm",
        "Intentional self-injury or self-poisoning, regardless of the person's stated purpose or degree of suicidal intent.",
        "clinical-concept",
      ],
      [
        "Safety planning",
        "A collaborative, structured plan that identifies warning signs, coping strategies, support contacts and steps for urgent help.",
        "assessment",
      ],
    ],
  },
  {
    slug: "anxiety-trauma-and-dissociation",
    title: "Anxiety, trauma and dissociation",
    description: "Terms for anxiety, trauma-related experiences and disruptions in integration or sense of self.",
    sourceId: "healthdirect-mental-health",
    related: ["conditions-risk-and-safety", "psychological-therapies"],
    comparisons: [["obsession", "intrusive-thought"]],
    entries: [
      [
        "Anxiety",
        "An emotional and physiological response to perceived threat, uncertainty or anticipated harm.",
        "clinical-concept",
      ],
      [
        "Panic attack",
        "A sudden episode of intense fear or discomfort with rapidly developing physical and cognitive symptoms.",
        "clinical-finding",
      ],
      [
        "Phobia",
        "A marked and persistent fear linked to a particular object or situation, with avoidance or significant distress.",
        "clinical-concept",
      ],
      [
        "Obsession",
        "A recurrent and unwanted thought, image or urge experienced as intrusive and distressing.",
        "clinical-finding",
      ],
      [
        "Compulsion",
        "A repetitive behaviour or mental act performed in response to an urge, rule or obsession.",
        "clinical-finding",
      ],
      [
        "Trauma",
        "An event or set of circumstances experienced as harmful or threatening and capable of producing lasting effects.",
        "clinical-concept",
      ],
      [
        "Dissociation",
        "A disruption in the usual integration of awareness, memory, identity, emotion, perception or behaviour.",
        "clinical-concept",
      ],
      [
        "Depersonalisation",
        "An experience of detachment from one's own thoughts, feelings, body or actions.",
        "clinical-finding",
      ],
    ],
  },
  {
    slug: "substance-use",
    title: "Substance use",
    description: "Terms used to describe substance-related patterns, physiological adaptation and return to use.",
    sourceId: "aihw-aod-glossary",
    related: ["conditions-risk-and-safety", "community-and-models-of-care"],
    comparisons: [["dependence", "tolerance"]],
    entries: [
      [
        "Substance use disorder",
        "A condition involving a problematic pattern of substance use that causes significant impairment or distress.",
        "condition",
      ],
      [
        "Intoxication",
        "A temporary state following substance use that produces clinically relevant changes in cognition, perception, behaviour or physical function.",
        "clinical-concept",
      ],
      [
        "Withdrawal",
        "A group of symptoms that can occur when repeated substance use is reduced or stopped.",
        "clinical-concept",
      ],
      [
        "Dependence",
        "A pattern in which substance use becomes difficult to control and increasingly prioritised, often with physiological adaptation.",
        "clinical-concept",
      ],
      [
        "Tolerance",
        "A reduced response to a substance after repeated exposure, so a greater amount may be needed for a similar effect.",
        "clinical-concept",
      ],
      ["Craving", "A strong desire or urge to use a substance.", "clinical-finding"],
      [
        "Harmful use",
        "A pattern of substance use that has caused damage to physical or mental health.",
        "clinical-concept",
      ],
      [
        "Relapse",
        "A return to a previous pattern of substance use after a period of reduction, control or abstinence.",
        "clinical-concept",
      ],
    ],
  },
  {
    slug: "medicines-and-adverse-effects",
    title: "Medicines and adverse effects",
    description: "Psychiatric medicine classes and important movement-related adverse effects.",
    sourceId: "healthdirect-antipsychotics",
    related: ["conditions-risk-and-safety", "mental-state-examination-domains"],
    comparisons: [["akathisia", "psychomotor-activity"]],
    entries: [
      [
        "Antipsychotic",
        "A class of medicines used in the treatment of psychosis and selected other mental health conditions.",
        "medication-class",
      ],
      [
        "Antidepressant",
        "A class of medicines used in the treatment of depression and selected anxiety or related conditions.",
        "medication-class",
      ],
      [
        "Mood stabiliser",
        "A term for medicines used to treat or reduce recurrence of significant mood episodes.",
        "medication-class",
      ],
      [
        "Anxiolytic",
        "A medicine used to reduce anxiety symptoms in selected clinical circumstances.",
        "medication-class",
      ],
      [
        "Akathisia",
        "A medication-associated syndrome of inner restlessness and a compelling need to move.",
        "clinical-finding",
      ],
      [
        "Acute dystonia",
        "A sudden medication-associated sustained muscle contraction that produces abnormal posture or movement.",
        "clinical-finding",
      ],
      [
        "Drug-induced parkinsonism",
        "Parkinsonian movement features caused by a medicine, commonly including rigidity, slowing or tremor.",
        "clinical-finding",
      ],
      [
        "Tardive dyskinesia",
        "A persistent drug-associated movement disorder, often involving involuntary movements of the face, mouth or limbs.",
        "clinical-finding",
      ],
    ],
  },
  {
    slug: "psychological-therapies",
    title: "Psychological therapies",
    description: "Structured psychological approaches used across mental health care.",
    sourceId: "healthdirect-psychotherapy",
    related: ["anxiety-trauma-and-dissociation", "mood-and-affect"],
    comparisons: [["cognitive-behavioural-therapy", "acceptance-and-commitment-therapy"]],
    entries: [
      [
        "Cognitive behavioural therapy",
        "A structured therapy that examines links between thoughts, feelings and behaviour and develops practical skills for change.",
        "therapy",
        abbr("CBT"),
      ],
      [
        "Acceptance and commitment therapy",
        "A therapy that develops acceptance, present-moment awareness and action guided by personal values.",
        "therapy",
        abbr("ACT"),
      ],
      [
        "Dialectical behaviour therapy",
        "A structured therapy that combines acceptance and change strategies and teaches skills for emotion regulation and relationships.",
        "therapy",
        abbr("DBT"),
      ],
      [
        "Interpersonal therapy",
        "A time-limited therapy focused on relationships, roles, grief and interpersonal difficulties linked with symptoms.",
        "therapy",
        abbr("IPT"),
      ],
      [
        "Motivational interviewing",
        "A collaborative conversational approach that explores ambivalence and strengthens a person's own reasons for change.",
        "therapy",
        abbr("MI"),
      ],
      [
        "Exposure therapy",
        "A therapy that supports planned, gradual contact with feared cues while reducing avoidance and new learning develops.",
        "therapy",
      ],
      [
        "Behavioural activation",
        "A structured approach that increases engagement with meaningful and reinforcing activities.",
        "therapy",
      ],
      [
        "Psychoeducation",
        "Structured information and discussion that supports understanding of a condition, treatment or self-management strategy.",
        "therapy",
      ],
    ],
  },
  {
    slug: "community-and-models-of-care",
    title: "Community and models of care",
    description: "Service structures and practice approaches used to coordinate mental health care.",
    sourceId: "health-recovery-framework",
    related: ["documentation-law-and-ethics", "conditions-risk-and-safety"],
    comparisons: [["case-management", "collaborative-care"]],
    entries: [
      [
        "Assertive community treatment",
        "An intensive, team-based model that delivers coordinated mental health care in community settings.",
        "service-model",
        abbr("ACT"),
      ],
      [
        "Case management",
        "A coordinated process for assessing needs, planning care, linking services and reviewing progress.",
        "service-model",
      ],
      [
        "Community mental health team",
        "A multidisciplinary team providing mental health assessment, treatment and support in the community.",
        "service-model",
        abbr("CMHT"),
      ],
      [
        "Multidisciplinary team",
        "A group of practitioners from different disciplines who contribute complementary expertise to shared care.",
        "service-model",
        abbr("MDT"),
      ],
      [
        "Stepped care",
        "A model that matches the intensity of support to need and adjusts it as needs and response change.",
        "service-model",
      ],
      [
        "Collaborative care",
        "A model in which primary care and mental health practitioners share structured responsibility for coordinated care.",
        "service-model",
      ],
      [
        "Recovery-oriented practice",
        "Practice that supports autonomy, strengths, hope, participation and a person's own recovery goals.",
        "service-model",
      ],
      [
        "Trauma-informed care",
        "An approach that recognises the effects of trauma and seeks to promote safety, choice, collaboration and avoid re-traumatisation.",
        "service-model",
      ],
    ],
  },
  {
    slug: "documentation-law-and-ethics",
    title: "Documentation, law and ethics",
    description: "Terms used in decision-making, lawful care, formulation and clinical documentation.",
    sourceId: "wa-mental-health-act-2014",
    related: ["community-and-models-of-care", "assessment-and-measurement"],
    comparisons: [["clinical-formulation", "risk-assessment"]],
    entries: [
      [
        "Capacity",
        "A person's ability to understand, retain, use or weigh relevant information and communicate a decision for a particular matter.",
        "legal-ethical-concept",
      ],
      [
        "Consent",
        "A voluntary agreement to a proposed action made by a person with relevant decision-making capacity and adequate information.",
        "legal-ethical-concept",
      ],
      [
        "Least restrictive care",
        "Care delivered with the minimum necessary restriction of a person's rights, choice and movement.",
        "legal-ethical-concept",
      ],
      [
        "Involuntary treatment",
        "Treatment provided under mental health legislation when specified legal criteria and safeguards are met.",
        "legal-ethical-concept",
      ],
      [
        "Supported decision-making",
        "An approach that assists a person to understand, consider and communicate their own decisions.",
        "legal-ethical-concept",
      ],
      [
        "Advance statement",
        "A person's written preferences about future mental health treatment and care, made while they can express those preferences.",
        "legal-ethical-concept",
      ],
      [
        "Clinical formulation",
        "A structured, revisable explanation that integrates factors contributing to a person's current difficulties and care needs.",
        "assessment",
      ],
      [
        "Risk assessment",
        "A structured process for identifying and formulating possible harms, protective factors and immediate safety needs.",
        "assessment",
      ],
    ],
  },
] as const satisfies readonly TopicSeed[];

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const contextByKind: Record<DictionaryEntryKind, readonly string[]> = {
  "clinical-concept": [
    "Use the term descriptively and in the context in which it was assessed.",
    "Avoid treating a single concept as a diagnosis or complete clinical formulation.",
  ],
  "clinical-finding": [
    "Record what was reported and what was observed separately where that distinction matters.",
    "Describe change over time, relevant context and effect on daily functioning.",
  ],
  assessment: [
    "Use the assessment within a broader history, examination and clinical formulation.",
    "Document limitations, context and the source of information.",
  ],
  condition: [
    "The term describes a recognised condition, not a conclusion that can be made from one feature alone.",
    "Assessment should consider course, functional effect, physical health, medicines, substances and context.",
  ],
  "medication-class": [
    "Medicine choice, monitoring and changes require individual clinical assessment and current prescribing guidance.",
    "Class labels do not imply that every medicine has the same indications or adverse-effect profile.",
  ],
  therapy: [
    "Delivery, intensity and suitability vary by formulation, goals, setting and practitioner training.",
    "The term names an approach; it does not recommend that approach for a particular person.",
  ],
  "service-model": [
    "Local service names, eligibility and team composition vary across jurisdictions and organisations.",
    "Use the term to describe a model of care rather than a guaranteed service configuration.",
  ],
  "legal-ethical-concept": [
    "Apply current law, policy and local procedure for the relevant Australian jurisdiction.",
    "The meaning is decision- and context-specific and should not be inferred from diagnosis alone.",
  ],
};

function purposeFor(kind: DictionaryEntryKind) {
  return {
    "clinical-concept": "Describe and organise a clinical concept",
    "clinical-finding": "Describe an observed or reported clinical feature",
    assessment: "Gather or organise assessment information",
    condition: "Name a recognised pattern of health difficulty",
    "medication-class": "Identify a class of psychiatric medicine",
    therapy: "Name a structured psychological approach",
    "service-model": "Describe how care may be organised or delivered",
    "legal-ethical-concept": "Support lawful and ethical decision-making",
  }[kind];
}

/**
 * Entries whose own sources replace the topic's single source, because no one page supports
 * every definition in the topic. Each was matched to the page's wording on 2026-09-26.
 */
const entrySourceIds: Readonly<Record<string, readonly string[]>> = {
  "clinical-assessment": ["nsw-health-mh-documentation", "ranzcp-assessment"],
  "mental-state-examination": ["rch-mental-state-examination", "nsw-health-mh-documentation"],
  "mini-mental-state-examination": ["healthdirect-mmse"],
  "psychiatric-history": ["ranzcp-assessment", "nsw-health-mh-documentation"],
  "clinical-interview": ["ranzcp-assessment"],
  "structured-clinical-interview": ["columbia-scid"],
  "screening-instrument": ["aci-cognitive-screening", "healthdirect-mmse"],
  "rating-scale": ["amhocn-nocc-measures", "nsw-health-mh-documentation"],
  // Matched to each page's own definition on 2026-10-20 (clinical content audit R7-F-11).
  anxiolytic: ["mesh-anti-anxiety-agents"],
  compulsion: ["healthdirect-ocd"],
  concentration: ["mesh-attention"],
  irritability: ["mesh-irritable-mood"],
  anhedonia: ["mesh-anhedonia"],
  "behavioural-activation": ["nice-depression-adults"],
  "clinical-formulation": ["nsw-health-mh-documentation"],
  "risk-assessment": ["nsw-health-mh-documentation"],
};

const topicEntrySlugs = new Map(
  topicSeeds.map((topic) => [topic.slug, topic.entries.map(([term]) => slugify(term))] as const),
);

export const dictionaryEntries: readonly DictionaryEntry[] = topicSeeds.flatMap((topic) => {
  const slugs = topicEntrySlugs.get(topic.slug) ?? [];
  return topic.entries.map(([term, definition, kind, aliases = []], index) => {
    const slug = slugify(term);
    const relatedSlugs = [1, 2, 3, 4].map((offset) => slugs[(index + offset) % slugs.length]);
    const sourceIds = new Set<string>(entrySourceIds[slug] ?? [topic.sourceId]);
    if (["akathisia", "acute-dystonia", "drug-induced-parkinsonism", "tardive-dyskinesia"].includes(slug)) {
      sourceIds.add("australian-prescriber-movement");
    }
    if (slug === "safety-planning") sourceIds.add("who-safety-planning");
    if (slug === "dialectical-behaviour-therapy") sourceIds.add("healthdirect-dbt");
    const distinctions: DictionaryDistinction[] = [];
    if (slug === "auditory-hallucination") {
      distinctions.push(
        {
          slug: "inner-speech",
          summary: "Inner speech is recognised as one's own internal voice rather than perceived sound.",
          sourceRefs: [{ sourceId: topic.sourceId, supports: ["distinction"] }],
        },
        {
          slug: "intrusive-thought",
          summary: "An intrusive thought is an unwanted thought or image rather than a sensory-like experience.",
          sourceRefs: [{ sourceId: topic.sourceId, supports: ["distinction"] }],
        },
        {
          slug: "mishearing",
          summary: "Mishearing involves an external sound that is present but interpreted incorrectly.",
          sourceRefs: [{ sourceId: topic.sourceId, supports: ["distinction"] }],
        },
      );
    }
    return {
      slug,
      term,
      definition,
      meaning: `${definition} The term should be interpreted alongside the person's account, the observed context and other relevant clinical information.`,
      kind,
      topicSlug: topic.slug,
      aliases,
      context: contextByKind[kind],
      comparison: {
        purpose: purposeFor(kind),
        scope: topic.description,
        clinicalContext: `Commonly used within ${topic.title.toLowerCase()}.`,
      },
      sourceRefs: Array.from(sourceIds, (sourceId) => ({
        sourceId,
        supports: ["definition", "context"] as const,
      })),
      distinctions,
      relatedSlugs,
      review: REVIEW,
    } satisfies DictionaryEntry;
  });
});

export const dictionaryTopics: readonly DictionaryTopic[] = topicSeeds.map((topic) => ({
  slug: topic.slug,
  title: topic.title,
  description: topic.description,
  entrySlugs: topicEntrySlugs.get(topic.slug) ?? [],
  relatedTopicSlugs: topic.related,
  curatedComparisons: topic.comparisons,
}));

export const dictionaryComparisonPairs: readonly DictionaryComparisonPair[] = [
  {
    slugs: ["mental-state-examination", "mini-mental-state-examination"],
    summary: "MSE describes current mental presentation; MMSE is a structured cognitive screening instrument.",
    sourceRefs: [
      { sourceId: "rch-mental-state-examination", supports: ["comparison"] },
      { sourceId: "healthdirect-mmse", supports: ["comparison"] },
      { sourceId: "nsw-mental-assessment", supports: ["comparison"] },
    ],
  },
  {
    slugs: ["delirium", "dementia"],
    summary:
      "Delirium is typically acute and fluctuating; dementia usually describes a persistent acquired cognitive decline.",
    sourceRefs: [{ sourceId: "nice-delirium", supports: ["comparison"] }],
  },
  {
    slugs: ["mood", "affect"],
    summary:
      "Mood is primarily reported by the person; affect is the emotional expression observed during the interaction.",
    sourceRefs: [{ sourceId: "nsw-mental-assessment", supports: ["comparison"] }],
  },
];

export function dictionarySource(sourceId: string): DictionarySource | null {
  return dictionarySources.find((source) => source.id === sourceId) ?? null;
}
