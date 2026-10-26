import type { DifferentialSafetyFact } from "@/lib/differential-detail";

/**
 * Locally authored clinical content that sits on top of the generated
 * differentials snapshot.
 *
 * WHY THIS EXISTS. The exported catalogue is thin and, in places, wrong: of the
 * 201 records, 150 carry no investigations, 110 carry no immediate actions, and
 * 194 have at least one section whose summary came out empty. A handful also
 * carry text belonging to a different diagnosis entirely (see `contentNote`).
 * The page cannot invent its way out of that, so the fix is a small, explicit,
 * reviewable overlay rather than a generator change.
 *
 * WHAT MAY GO IN HERE. Assessment, discrimination and escalation content only.
 * `docs/clinical-governance.md` ("Clinical Use Rules") forbids adding dose
 * calculators, diagnostic scores or automated treatment recommendations to this
 * product without dedicated clinical validation, so `doNow` steps name the
 * action and the escalation point and deliberately stop short of drug doses.
 *
 * HOW IT DEGRADES. A record that is not listed here renders derived content
 * only. Nothing in this module ever supplies a clinical attribute the record
 * does not otherwise have — same rule the delirium safety facts already
 * followed before they moved here.
 *
 * HOW IT IS SHOWN. Every surface that renders a curated block also renders the
 * "Locally authored" provenance line, and the Source tab reports whether the
 * open record has authored content. Curated text is never presented as though
 * it came from the indexed sources.
 */

/** One "how do I tell these two apart" row for the map's comparison table. */
export type DifferentialDiscriminator = {
  /** Must match an id in the focus record's `related` list; asserted by tests. */
  relatedSlug: string;
  /** What pushes you toward the related diagnosis. */
  favoursRelated: string;
  /** What pushes you back toward the record you are reading. */
  favoursFocus: string;
};

export type DifferentialCuratedEntry = {
  /** Qualitative course facts for the safety snapshot, in place of counts. */
  atAGlance?: DifferentialSafetyFact[];
  /** Ordered first moves. Assessment and escalation, never dosing. */
  doNow?: string[];
  discriminators?: DifferentialDiscriminator[];
  /**
   * Shown as a warning when the generated record's own sections are known to be
   * unreliable, so a reader is not quietly misled by the body of the page.
   */
  contentNote?: string;
  /**
   * Withhold the generated sections entirely rather than printing them under a
   * warning.
   *
   * Owner ruling, 2026-09-16. A note asking the reader to distrust the body of
   * the page is weaker than not publishing the wrong body, and these records are
   * publicly readable with no login wall. Showing nothing degrades
   * conservatively. Showing another diagnosis's management does not.
   *
   * Only set this with a `contentNote` saying why, which a test enforces.
   */
  generatedBodyUnreliable?: true;
  /**
   * The clinician sign-off, attached server-side from
   * `data/differential-curated-review.json` by `getDifferentialDetailContext`.
   * Never written into an entry below: the sign-off pins these entries, so an entry
   * cannot carry its own attestation.
   */
  review?: { reviewedBy: string; reviewedAt: string };
};

export const curatedDifferentials: Record<string, DifferentialCuratedEntry> = {
  delirium: {
    // Moved here verbatim from differential-detail.ts so there is one curated
    // surface rather than two that can disagree.
    atAGlance: [
      { id: "high-risk", label: "High risk", value: "Yes" },
      { id: "onset", label: "Onset", value: "Acute" },
      { id: "course", label: "Course", value: "Fluctuating" },
      { id: "treatable", label: "Treatable", value: "Often" },
    ],
    doNow: [
      "Screen with 4AT and record the baseline cognitive state from a collateral history",
      "Look for the precipitant: infection, urinary retention, constipation, pain, hypoxia, electrolytes, alcohol or benzodiazepine withdrawal",
      "Review every anticholinergic and sedating agent on the chart and stop what is not essential",
      "Correct the reversible cause first and reserve antipsychotics for distress or risk that non-drug measures have not settled",
    ],
    discriminators: [
      {
        relatedSlug: "akathisia",
        favoursRelated:
          "Subjective inner restlessness with preserved attention, worse after a recent dose increase or depot",
        favoursFocus:
          "Inattention and fluctuating conscious state, worse overnight, with an identifiable medical precipitant",
      },
      {
        relatedSlug: "acute-psychosis",
        favoursRelated: "Clear sensorium, systematised delusions, an established psychotic illness",
        favoursFocus: "Acute onset over hours to days, inattention, disorganised thinking that waxes and wanes",
      },
      {
        relatedSlug: "bipolar-mania-mixed-state",
        favoursRelated:
          "Elevated or irritable mood with goal-directed overactivity and reduced sleep need, attention intact",
        favoursFocus:
          "Disorientation, perceptual disturbance and a fluctuating course rather than sustained mood elevation",
      },
      {
        relatedSlug: "stimulant-intoxication-withdrawal",
        favoursRelated: "Sympathetic arousal, mydriasis, recent use on history or urine drug screen",
        favoursFocus: "Global cognitive change out of proportion to the substance history, with a medical precipitant",
      },
    ],
  },

  "hypoactive-delirium": {
    atAGlance: [
      { id: "high-risk", label: "High risk", value: "Yes" },
      { id: "onset", label: "Onset", value: "Acute" },
      { id: "course", label: "Course", value: "Fluctuating" },
      { id: "treatable", label: "Treatable", value: "Often" },
    ],
    doNow: [
      "Test attention directly rather than accepting a quiet patient as settled",
      "Take a collateral history for the timeline, because withdrawn presentations are routinely missed on the ward",
      "Screen for infection, hypoxia, electrolyte disturbance, urinary retention, constipation and drug effect",
      "Review sedating and anticholinergic load, and escalate to the medical team if the conscious state is dropping",
    ],
    discriminators: [
      {
        relatedSlug: "catatonia",
        favoursRelated:
          "Posturing, waxy flexibility, negativism, mutism or stupor, with a response to a lorazepam challenge",
        favoursFocus: "Fluctuating inattention with a medical precipitant and no catatonic motor signs",
      },
      {
        relatedSlug: "psychotic-depression-severe-melancholic-depression",
        favoursRelated: "Weeks of pervasive low mood with mood-congruent delusions and preserved orientation",
        favoursFocus: "Days rather than weeks, disorientation, and a course that varies through the day",
      },
      {
        relatedSlug: "medication-over-sedation-drug-effect",
        favoursRelated: "Clear temporal link to a dose change, with drowsiness that lifts as the drug is withheld",
        favoursFocus: "Cognitive disturbance that persists once the sedating agent is withheld",
      },
      {
        relatedSlug: "dementia-apathy-neurocognitive-disorder",
        favoursRelated: "Stable months-long decline with attention relatively preserved for the stage",
        favoursFocus: "Acute change from the patient's own baseline, which is why the collateral history decides it",
      },
    ],
  },

  "neuroleptic-malignant-syndrome": {
    atAGlance: [
      { id: "high-risk", label: "High risk", value: "Yes" },
      { id: "onset", label: "Onset", value: "Days" },
      { id: "course", label: "Course", value: "Progressive" },
      { id: "treatable", label: "Treatable", value: "Yes" },
    ],
    doNow: [
      "Immediate cessation of all dopamine receptor antagonists, including all antipsychotics and antiemetics (e.g., metoclopramide, prochlorperazine)",
      "Initiate intensive medical care with aggressive IV hydration targeting urine output to prevent acute tubular necrosis from rhabdomyolysis, combined with active cooling",
      "Initiate specific pharmacotherapy: bromocriptine (dopamine agonist) and/or dantrolene (skeletal muscle relaxant) under intensivist or toxicology guidance",
      "Escalate immediately to intensive care for continuous cardiac monitoring for arrhythmias, respiratory support, and serial monitoring of CK and renal function",
      "Document the implicated dopamine antagonist clearly and ensure it is flagged as an adverse drug reaction across all clinical records",
    ],
    discriminators: [
      {
        relatedSlug: "catatonia-in-mood-disorder",
        favoursRelated: "Catatonic signs without fever or a rising CK, and a response to a lorazepam challenge",
        favoursFocus:
          "Lead-pipe rigidity with hyperthermia, autonomic instability and a climbing CK after a dopamine antagonist",
      },
      {
        relatedSlug: "catatonia-in-psychotic-disorder",
        favoursRelated: "Motor signs that predate the antipsychotic, no autonomic instability",
        favoursFocus: "Onset within days to two weeks of starting, increasing or switching a dopamine antagonist",
      },
      {
        relatedSlug: "ssri-snri-adverse-effects",
        favoursRelated: "Hyperreflexia, inducible clonus and diarrhoea after a serotonergic change, onset within hours",
        favoursFocus: "Rigidity with hyporeflexia, onset over days, and bradykinesia rather than clonus",
      },
      {
        relatedSlug: "anticholinergic-burden-toxicity",
        favoursRelated: "Dry skin and mucosae, urinary retention, mydriasis, with normal tone",
        favoursFocus: "Profuse sweating and rigidity, with a raised CK",
      },
      {
        relatedSlug: "lithium-adverse-effects-toxicity",
        favoursRelated: "Coarse tremor, ataxia, vomiting and diarrhoea with a raised lithium level",
        favoursFocus: "Fever and rigidity following a dopamine antagonist, with the lithium level in range",
      },
    ],
  },

  "serotonin-toxicity": {
    atAGlance: [
      { id: "high-risk", label: "High risk", value: "Yes" },
      { id: "onset", label: "Onset", value: "Hours" },
      { id: "course", label: "Course", value: "Rapid" },
      { id: "treatable", label: "Treatable", value: "Yes" },
    ],
    doNow: [
      "Cease all serotonergic agents immediately (including tramadol, fentanyl, linezolid, triptans, and St John's wort); strictly avoid electroconvulsive therapy (ECT under anaesthesia with succinylcholine is potentially lethal)",
      "Assess Hunter Criteria: spontaneous clonus, inducible clonus with agitation or diaphoresis, ocular clonus with agitation or diaphoresis, tremor plus hyperreflexia, or hypertonia with marked pyrexia and ocular or inducible clonus",
      "Provide aggressive supportive care: IV fluids, active external cooling, and IV diazepam for neuromuscular agitation and rigidity",
      "Administer cyproheptadine as specific serotonin antagonist antidote under clinical toxicology guidance",
      "Escalate to intensive care immediately for hyperthermia or severe autonomic instability; intubation requires non-depolarizing neuromuscular blockade (strictly avoid succinylcholine and suxamethonium due to lethal hyperkalemic cardiac arrest risk)",
    ],
    discriminators: [
      {
        relatedSlug: "neuroleptic-malignant-syndrome",
        favoursRelated:
          "Onset over days after a dopamine antagonist, lead-pipe rigidity, hyporeflexia, markedly raised CK",
        favoursFocus: "Onset within hours of a serotonergic change, clonus, hyperreflexia, diarrhoea and agitation",
      },
      {
        relatedSlug: "catatonia-in-mood-disorder",
        favoursRelated: "Posturing, negativism and mutism without autonomic instability",
        favoursFocus: "Neuromuscular hyperactivity that is worse in the legs, with a clear serotonergic exposure",
      },
      {
        relatedSlug: "hypoactive-delirium",
        favoursRelated: "Reduced arousal without clonus or hyperreflexia",
        favoursFocus: "Agitation and neuromuscular excitability rather than obtundation",
      },
      {
        relatedSlug: "autoimmune-encephalitis-anti-nmda-syndrome",
        favoursRelated:
          "Subacute psychiatric change with seizures, orofacial dyskinesia and a preceding prodrome over weeks",
        favoursFocus: "A drug exposure that fits the timeline, with symptoms settling once the agent is withdrawn",
      },
    ],
  },

  "catatonia-in-mood-disorder": {
    atAGlance: [
      { id: "high-risk", label: "High risk", value: "Yes" },
      { id: "onset", label: "Onset", value: "Days" },
      { id: "course", label: "Course", value: "Persistent" },
      { id: "treatable", label: "Treatable", value: "Yes" },
    ],
    doNow: [
      "Score the Bush-Francis Catatonia Rating Scale and record which signs are present, so response can be measured later",
      "Check temperature, pulse, blood pressure, hydration and CK, because malignant catatonia and NMS sit on the same spectrum",
      "Review the chart for dopamine antagonists and for abrupt benzodiazepine cessation",
      "Discuss a lorazepam challenge with the treating consultant, and record the response",
      "Escalate urgently if there is fever, autonomic instability or a rising CK, and consider ECT referral early in malignant or non-responsive presentations",
    ],
    discriminators: [
      {
        relatedSlug: "hypoactive-delirium",
        favoursRelated: "Fluctuating inattention with a medical precipitant and no catatonic motor signs",
        favoursFocus: "Posturing, waxy flexibility, negativism, echophenomena, and a response to a lorazepam challenge",
      },
      {
        relatedSlug: "neuroleptic-malignant-syndrome",
        favoursRelated: "Fever, autonomic instability and a raised CK following a dopamine antagonist",
        favoursFocus: "Motor signs without fever or autonomic instability, often predating any antipsychotic",
      },
      {
        relatedSlug: "serotonin-toxicity",
        favoursRelated: "Clonus and hyperreflexia within hours of a serotonergic change",
        favoursFocus: "Immobility and negativism rather than neuromuscular hyperactivity",
      },
      {
        relatedSlug: "catatonia-in-psychotic-disorder",
        favoursRelated: "Catatonia arising on a background of an established psychotic illness",
        favoursFocus: "A clear mood episode framing the catatonia, most often severe depression or a mixed state",
      },
    ],
  },

  "acute-dystonia": {
    atAGlance: [
      { id: "high-risk", label: "High risk", value: "Yes" },
      { id: "onset", label: "Onset", value: "Hours" },
      { id: "course", label: "Course", value: "Abrupt" },
      { id: "treatable", label: "Treatable", value: "Rapidly" },
    ],
    doNow: [
      "Recognise acute dystonia as sustained involuntary muscle contractions and spasms (e.g., oculogyric crisis, torticollis, trismus, or laryngeal spasm) following dopamine receptor blockade",
      "Perform immediate airway assessment to rule out life-threatening laryngeal dystonia and stridor, keeping emergency airway equipment accessible",
      "Administer emergency anticholinergic therapy immediately using parenteral benzatropine (IM or IV). Parenteral diphenhydramine is not registered in Australia",
      "Reassess symptoms after parenteral anticholinergic administration; prepare to repeat therapy or secure the airway if laryngeal spasm does not rapidly resolve",
      "Review the causative dopamine antagonist and prescribe short-term oral anticholinergic coverage to prevent rebound dystonia",
    ],
    discriminators: [
      {
        relatedSlug: "akathisia",
        favoursRelated: "Subjective inner motor restlessness and urge to move, relieved by pacing or movement",
        favoursFocus: "Sustained involuntary muscle contractions and fixed abnormal posturing without an urge to move",
      },
      {
        relatedSlug: "drug-induced-parkinsonism",
        favoursRelated: "Bradykinesia, generalized cogwheel rigidity, masked facies, and resting pill-rolling tremor",
        favoursFocus:
          "Acute onset of episodic focal muscle spasms (e.g. oculogyric crisis, torticollis) within hours of a dose",
      },
      {
        relatedSlug: "tardive-dyskinesia-tardive-syndromes",
        favoursRelated:
          "Choreiform, stereotypic or athetoid involuntary movements developing after months to years of antipsychotic exposure",
        favoursFocus:
          "Rapid onset of painful sustained tonic spasm hours to days after dopamine antagonist exposure, rapidly responsive to anticholinergics",
      },
    ],
  },

  akathisia: {
    atAGlance: [
      { id: "high-risk", label: "High risk", value: "Yes" },
      { id: "onset", label: "Onset", value: "Days" },
      { id: "course", label: "Course", value: "Dose-linked" },
      { id: "treatable", label: "Treatable", value: "Yes" },
    ],
    doNow: [
      "Ask directly about inner restlessness, because the subjective complaint is the diagnosis and observable movement may be absent",
      "Chart the timeline against every dose increase, switch and depot, including antiemetics",
      "Ask about suicidal thinking: akathisia is a recognised and under-recorded contributor to acute risk",
      "Discuss dose reduction or a switch with the treating team rather than adding a further antipsychotic",
    ],
    discriminators: [
      {
        relatedSlug: "drug-induced-parkinsonism",
        favoursRelated: "Bradykinesia, cogwheel rigidity and reduced arm swing, with no subjective urge to move",
        favoursFocus: "Distressing inner restlessness that is relieved by moving",
      },
      {
        relatedSlug: "acute-dystonia",
        favoursRelated:
          "Sustained painful muscle contraction, often oculogyric or cervical, within hours to days of a dose",
        favoursFocus: "Continuous restlessness rather than a sustained fixed posture",
      },
      {
        relatedSlug: "delirium",
        favoursRelated: "Inattention and a fluctuating conscious state with a medical precipitant",
        favoursFocus: "Clear sensorium with a specific, articulated urge to move",
      },
      {
        relatedSlug: "bipolar-mania-mixed-state",
        favoursRelated: "Elevated or irritable mood, reduced sleep need, goal-directed overactivity",
        favoursFocus:
          "Restlessness that the patient experiences as unpleasant and drug-related, without mood elevation",
      },
      {
        relatedSlug: "panic-trauma-hyperarousal-dissociation",
        favoursRelated: "Episodic autonomic surges with a psychological trigger and a clear offset",
        favoursFocus: "Continuous restlessness tracking the medication timeline rather than the situation",
      },
    ],
  },

  "alcohol-withdrawal": {
    atAGlance: [
      { id: "high-risk", label: "High risk", value: "Yes" },
      { id: "onset", label: "Onset", value: "6 to 24 h" },
      { id: "course", label: "Course", value: "Escalating" },
      { id: "treatable", label: "Treatable", value: "Yes" },
    ],
    doNow: [
      "Establish the time of the last drink and the usual daily intake, and ask about any previous withdrawal seizure or delirium tremens",
      "Start structured withdrawal scoring and observations on the local protocol rather than assessing ad hoc",
      "Give parenteral thiamine before any carbohydrate load, and continue it for the admission",
      "Send U&E, magnesium, LFT, FBC, glucose and a venous gas, and correct magnesium and potassium",
      "Escalate for a seizure, a rising score despite treatment, or any feature of delirium tremens or Wernicke encephalopathy",
    ],
    discriminators: [
      {
        relatedSlug: "benzodiazepine-withdrawal",
        favoursRelated:
          "A longer and later course, driven by the half-life of the agent, with perceptual disturbance persisting for weeks",
        favoursFocus: "Onset within 6 to 24 hours of the last drink, peaking at 24 to 72 hours",
      },
      {
        relatedSlug: "opioid-withdrawal",
        favoursRelated: "Lacrimation, rhinorrhoea, yawning, piloerection, cramps and diarrhoea, with a clear sensorium",
        favoursFocus: "Tremor, sweating and autonomic arousal with a genuine risk of seizure and delirium",
      },
      {
        relatedSlug: "stimulant-withdrawal-crash",
        favoursRelated: "Hypersomnia, increased appetite and low mood rather than autonomic overactivity",
        favoursFocus: "Sympathetic overdrive with tremor and hypertension",
      },
      {
        relatedSlug: "ghb-withdrawal",
        favoursRelated:
          "Very rapid onset with severe agitation and delirium, often within hours and benzodiazepine resistant",
        favoursFocus: "A more predictable timeline that responds to standard symptom-triggered treatment",
      },
    ],
  },

  "clozapine-specific-adverse-effects-toxicity": {
    atAGlance: [
      { id: "high-risk", label: "High risk", value: "Yes" },
      { id: "onset", label: "Onset", value: "Variable" },
      { id: "course", label: "Course", value: "Dose-linked" },
      { id: "treatable", label: "Treatable", value: "Yes" },
    ],
    doNow: [
      "Establish whether any dose has been missed and for how long, because a sustained break means retitrating from the start rather than resuming the previous dose. The exact cut-off sits in the local clozapine protocol",
      "Take temperature and pulse, and send FBC with differential, CRP, troponin and an ECG in the first weeks of treatment, because myocarditis presents as a flu-like illness",
      "Ask about constipation at every review and treat it actively, because clozapine-induced gastrointestinal hypomotility is a recognised cause of death and is easier to miss than the haematological monitoring already in place",
      "Check for smoking cessation, intercurrent infection or an interacting medicine before attributing a rise in effect to the dose alone",
      "Discuss with the clozapine coordinator and the treating consultant before any change, and follow the local monitoring protocol",
    ],
    discriminators: [
      {
        relatedSlug: "antipsychotic-adverse-effects",
        favoursRelated: "Extrapyramidal features and hyperprolactinaemia, which are relatively uncommon on clozapine",
        favoursFocus:
          "Hypersalivation, sedation, tachycardia, constipation and the haematological and cardiac risks specific to clozapine",
      },
      {
        relatedSlug: "anticholinergic-burden-toxicity",
        favoursRelated: "Dry mouth with urinary retention and confusion across several anticholinergic agents",
        favoursFocus: "Hypersalivation rather than a dry mouth, which is the counter-intuitive clozapine signature",
      },
      {
        relatedSlug: "serotonin-syndrome",
        favoursRelated: "Clonus and hyperreflexia after a serotonergic change",
        favoursFocus:
          "Fever with a flu-like illness in the first two months, which is myocarditis until proven otherwise",
      },
      {
        relatedSlug: "lithium-adverse-effects-toxicity",
        favoursRelated: "Coarse tremor, ataxia and gastrointestinal upset with a raised lithium level",
        favoursFocus: "Sedation and hypersalivation tracking the clozapine dose, with a normal lithium level",
      },
    ],
  },

  "postpartum-psychosis": {
    atAGlance: [
      { id: "high-risk", label: "High risk", value: "Yes" },
      { id: "onset", label: "Onset", value: "Days to weeks" },
      { id: "course", label: "Course", value: "Rapid" },
      { id: "treatable", label: "Treatable", value: "Yes" },
    ],
    doNow: [
      "Treat this as a psychiatric emergency: onset is typically within the first two weeks and deterioration can be measured in hours",
      "Ask explicitly about thoughts of harm to the infant and about delusional beliefs involving the baby, and record the answers",
      "Exclude a medical cause: infection, eclampsia, thyroiditis, anaemia and retained products, with bloods and observations",
      "Arrange urgent psychiatric admission and do not leave mother and infant unsupervised while the assessment is in progress",
      "Involve the perinatal mental health service and consider a mother and baby unit where local capacity allows",
    ],
    discriminators: [
      {
        relatedSlug: "postnatal-depression",
        favoursRelated: "Gradual onset over weeks with low mood and guilt, and no loss of reality testing",
        favoursFocus: "Rapid onset with confusion, a fluctuating picture, and delusions or hallucinations",
      },
      {
        relatedSlug: "perinatal-ocd-intrusive-infant-harm-thoughts",
        favoursRelated:
          "Intrusive thoughts the mother finds abhorrent and resists, with avoidance and checking, and intact insight",
        favoursFocus: "Beliefs about the infant that are held with conviction and may drive action",
      },
      {
        relatedSlug: "delirium",
        favoursRelated: "An identified obstetric or medical precipitant with prominent inattention",
        favoursFocus: "Affective and psychotic features dominating, though the two overlap and both must be excluded",
      },
      {
        relatedSlug: "bipolar-relapse-postpartum-mania",
        favoursRelated:
          "A known bipolar diagnosis with a presentation that mirrors the patient's previous manic episodes",
        favoursFocus: "A more confused and shifting picture than the patient's usual mania, often a first episode",
      },
    ],
  },

  "lithium-physiological-withdrawal-tremor": {
    // The generated record for this slug is contaminated: its clinical hinge is
    // the definition of akathisia, its "immediate actions" are four statements
    // about akathisia, parkinsonism and tardive syndromes, and its related nodes
    // are the extrapyramidal family rather than causes of tremor. The first two
    // are withheld by the flag below. The related list is kept, because those
    // nodes describe real conditions accurately and dropping them would take the
    // Compare, Map and Related tabs with them, so the note names it instead.
    generatedBodyUnreliable: true,
    contentNote:
      "The generated review for this record carried material from akathisia, drug-induced parkinsonism and tardive syndromes, so it is withheld rather than shown. The related diagnoses listed are the extrapyramidal family rather than causes of tremor. The assessment steps are locally authored. The safety snapshot and investigations are retained from the same export and were not part of the contaminated text. There is no linked original for this record, so check its source and review status and treat it as unreviewed reference before acting on it.",
    doNow: [
      "Characterise the tremor: a fine postural tremor fits lithium at therapeutic level, while a coarse tremor with ataxia suggests toxicity",
      "Take a lithium level with U&E, eGFR, calcium and thyroid function, and note the time since the last dose",
      "Ask about dehydration, vomiting, diarrhoea, a new NSAID, ACE inhibitor or diuretic, and any recent dose change",
      "Ask about alcohol intake and the time of the last drink, since withdrawal tremor is coarse and carries its own risks",
      "Escalate for neurological signs with any raised level, taking the threshold from the local lithium protocol, since toxicity can progress despite a stopped dose",
    ],
    discriminators: [
      {
        relatedSlug: "akathisia",
        favoursRelated: "Subjective inner restlessness relieved by movement, following a dopamine antagonist",
        favoursFocus: "A visible postural tremor with no urge to move, tracking lithium exposure",
      },
      {
        relatedSlug: "drug-induced-parkinsonism",
        favoursRelated: "Bradykinesia, cogwheel rigidity and a rest tremor after a dopamine antagonist",
        favoursFocus: "A symmetrical postural and action tremor with normal tone",
      },
      {
        relatedSlug: "acute-dystonia",
        favoursRelated: "Sustained painful posturing within hours of a dose, often oculogyric or cervical",
        favoursFocus: "A rhythmic oscillating tremor rather than a fixed posture",
      },
      {
        relatedSlug: "tardive-dyskinesia-tardive-syndromes",
        favoursRelated: "Choreiform orofacial movements after months to years of dopamine blockade",
        favoursFocus: "A regular postural tremor that appears early and moves with the lithium level",
      },
      {
        relatedSlug: "sedation-hypoarousal",
        favoursRelated: "Drowsiness dominating, with the tremor incidental",
        favoursFocus: "Tremor as the presenting problem, with the conscious state preserved",
      },
    ],
  },
};

export function curatedEntryFor(slug: string): DifferentialCuratedEntry | null {
  return curatedDifferentials[slug] ?? null;
}
