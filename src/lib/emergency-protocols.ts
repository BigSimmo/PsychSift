/**
 * Immediate, deterministic acute psychiatric emergency protocol aide-mémoire.
 *
 * Provides instant (0ms latency, zero provider/LLM dependency) first-line clinical
 * action steps, urgent diagnostics, and toxicological escalation details when a
 * clinician searches for life-threatening acute psychiatric emergencies or
 * toxicities (e.g. NMS, Serotonin Syndrome, Lithium Toxicity, Acute Dystonic Reaction,
 * Clozapine Myocarditis, Malignant Catatonia).
 *
 * Single source of truth for acute psychiatric emergency fast-path guidance.
 */

export interface EmergencyActionStep {
  readonly title: string;
  readonly detail: string;
  readonly isHighPriority?: boolean;
}

export interface EmergencyClinicalProtocol {
  readonly id: string;
  readonly name: string;
  readonly acronym?: string;
  readonly triggerPatterns: readonly RegExp[];
  readonly category: "toxicity" | "reaction" | "cardiac" | "syndrome";
  readonly firstLineAction: string;
  readonly warningNotice: string;
  readonly diagnosticFeatures: readonly string[];
  readonly urgentInvestigations: readonly string[];
  readonly immediateManagement: readonly EmergencyActionStep[];
  readonly specialistContacts: readonly string[];
  readonly caveat: string;
  readonly evidenceSource: string;
}

export const EMERGENCY_CLINICAL_PROTOCOLS: readonly EmergencyClinicalProtocol[] = [
  {
    id: "EMERG-NMS",
    name: "Neuroleptic Malignant Syndrome (NMS)",
    acronym: "NMS",
    category: "syndrome",
    triggerPatterns: [
      /\b(?:nms|neuroleptic\s+malignant\s+syndrome|lead[\s-]?pipe\s+rigidity)\b/i,
      /\bhyperthermia\s+(?:and|with)\s+(?:rigidity|antipsychotic)\b/i,
    ],
    firstLineAction: "Cease all dopamine antagonists and antipsychotics immediately.",
    warningNotice:
      "Life-threatening medical emergency. High risk of rhabdomyolysis, acute kidney injury, cardiovascular collapse, and mortality. Activate hospital emergency response (MET / Code Blue / ICU).",
    diagnosticFeatures: [
      "Severe 'lead-pipe' muscular rigidity (generalized, sustained resistance to passive movement)",
      "Hyperthermia (degree per local protocol)",
      "Autonomic instability: labile blood pressure, marked tachycardia, tachypnea, profuse diaphoresis",
      "Altered mental status: confusion, delirium, stupor, mutism, fluctuating consciousness",
    ],
    urgentInvestigations: [
      "Serum Creatine Kinase (CK): assess for rhabdomyolysis; interpretation per local protocol",
      "EUC & Creatinine: assess for acute kidney injury secondary to myoglobinuria",
      "Full Blood Count (FBC): look for leukocytosis",
      "Electrolytes, Troponin, 12-lead ECG, Liver function tests, Blood gas, Coagulation profile (DIC check)",
    ],
    immediateManagement: [
      {
        title: "Immediate Antipsychotic Cessation",
        detail:
          "Stop all dopamine antagonists immediately. Do not abruptly cease dopamine agonists if Parkinson's disease is present.",
        isHighPriority: true,
      },
      {
        title: "Aggressive IV Hydration & Renal Protection",
        detail:
          "Give IV fluids to prevent myoglobin-induced renal tubular necrosis. Fluid rate and urine-output targets per local protocol.",
        isHighPriority: true,
      },
      {
        title: "Active Physical Cooling",
        detail:
          "Remove excess clothing, apply cooling blankets, ice packs to axillae/groin, and maintain room cooling. Antipyretics are generally ineffective (central set-point intact).",
      },
      {
        title: "Specific Pharmacotherapy (under ICU / Specialist Guidance)",
        detail:
          "Bromocriptine (dopamine agonist) or dantrolene (skeletal muscle relaxant) in refractory hyperthermia. Doses per local protocol.",
      },
    ],
    specialistContacts: [
      "Poisons Information Centre: 13 11 26 (24 hours Australia-wide)",
      "Hospital Medical Emergency Team (MET) / Intensive Care Unit",
      "On-call Consultation-Liaison Psychiatrist",
    ],
    caveat:
      "Aide-mémoire for emergency clinical orientation only. Management must follow local hospital resuscitation and intensive care protocols.",
    evidenceSource:
      "Maudsley Prescribing Guidelines in Psychiatry (14th ed); Therapeutic Guidelines: Psychotropic (Version 8); Australian Prescriber.",
  },
  {
    id: "EMERG-SEROTONIN-SYNDROME",
    name: "Serotonin Syndrome (Serotonin Toxicity)",
    acronym: "SS",
    category: "toxicity",
    triggerPatterns: [
      /\b(?:serotonin\s+syndrome|serotonin\s+toxicity|hunter\s+criteria)\b/i,
      /\b(?:ssri|snri|maoi)\s+(?:toxicity|overdose|clonus)\b/i,
    ],
    firstLineAction: "Cease all serotonergic agents immediately.",
    warningNotice:
      "Rapidly evolving neuromuscular and autonomic toxidrome. Can escalate within hours to severe hyperthermia, seizures, metabolic acidosis, rhabdomyolysis, and death.",
    diagnosticFeatures: [
      "Apply the Hunter Serotonin Toxicity Criteria and record which limb of them is met",
      "Neuromuscular excitation: spontaneous/ocular clonus, hyperreflexia (prominent in lower limbs), tremors, shivering",
      "Autonomic hyperactivity: diaphoresis, tachycardia, pyrexia, flushing, mydriasis, loose stools / diarrhea",
      "Altered mental state: agitation, restlessness, pressured speech, delirium, confusion",
    ],
    urgentInvestigations: [
      "Serum CK and EUC: evaluate for rhabdomyolysis and acute kidney injury",
      "12-lead ECG: monitor for tachycardia and conduction abnormalities",
      "Full blood count, arterial/venous blood gas, blood glucose level (exclude hypoglycemia)",
    ],
    immediateManagement: [
      {
        title: "Withhold All Serotonergic Medications",
        detail:
          "Stop SSRIs, SNRIs, MAOIs, TCAs, lithium, tramadol, fentanyl, dextromethorphan, triptans, and illicit serotonergic drugs (MDMA, amphetamines).",
        isHighPriority: true,
      },
      {
        title: "Symptom Control with Benzodiazepines",
        detail:
          "Administer diazepam titrated to control neuromuscular agitation, muscle hyperactivity, and tremor. Dose and route per local protocol.",
        isHighPriority: true,
      },
      {
        title: "Cooling & Avoid Physical Restraint",
        detail:
          "Active cooling when the temperature is raised (threshold per local protocol). Avoid physical restraints because isometric muscle struggle dramatically worsens hyperthermia, lactic acidosis, and rhabdomyolysis.",
      },
      {
        title: "Antidote for Moderate–Severe Cases (Specialist Directed)",
        detail: "Cyproheptadine (5-HT2A antagonist). Dose, interval and maximum per local protocol.",
      },
    ],
    specialistContacts: [
      "Poisons Information Centre: 13 11 26 (24 hours Australia-wide)",
      "Clinical Toxicology Service / Intensive Care Unit",
    ],
    caveat:
      "Aide-mémoire for acute management. Confirm diagnostic criteria and titrate interventions under specialist medical/toxicological direction.",
    evidenceSource:
      "Hunter Serotonin Toxicity Criteria (Dunkley et al., QJM 2003); Therapeutic Guidelines: Toxicology & Psychotropic; Australian Prescriber.",
  },
  {
    id: "EMERG-ACUTE-DYSTONIA",
    name: "Acute Dystonic Reaction (including Laryngeal & Oculogyric Crisis)",
    acronym: "ADR",
    category: "reaction",
    triggerPatterns: [
      /\b(?:acute\s+dystoni\w*|oculogyric\s+crisis|torticollis\s+antipsychotic|dystonic\s+reaction)\b/i,
      /\blaryngeal\s+dystoni\w*\b/i,
    ],
    firstLineAction: "Administer anticholinergic medication (Benztropine) promptly.",
    warningNotice:
      "Extremely distressing and painful muscular spasm. Laryngeal dystonia presents with stridor and dyspnoea and constitutes a life-threatening airway emergency.",
    diagnosticFeatures: [
      "Oculogyric crisis: sustained, involuntary upward or lateral gaze fixation",
      "Torticollis / retrocollis: severe, painful spasmodic rotation or hyperextension of neck",
      "Trismus (involuntary jaw clenching), facial grimacing, forced tongue protrusion, dysarthria",
      "Laryngeal dystonia: stridor, difficulty breathing, cyanosis (immediate airway risk)",
      "Opisthotonos: severe spasm of the back and neck muscles with backward arching",
    ],
    urgentInvestigations: [
      "Immediate clinical airway and respiratory assessment (oxygen saturation, respiratory effort, stridor)",
      "If stridor or respiratory distress present: prepare for emergency airway intervention / call MET",
    ],
    immediateManagement: [
      {
        title: "Anticholinergic Administration (Benztropine)",
        detail: "Administer benztropine IM or slow IV. Dose and timing per local protocol.",
        isHighPriority: true,
      },
      {
        title: "Repeat Dose if Incomplete Response",
        detail: "If response is incomplete, repeat benztropine. Dose, interval and maximum per local protocol.",
      },
      {
        title: "Alternative Agent (if Benztropine Unavailable)",
        detail: "Promethazine or diazepam. Dose and route per local protocol.",
      },
      {
        title: "Preventing Recurrence",
        detail:
          "Prescribe oral benztropine following acute reversal, as the causative antipsychotic may outlast the anticholinergic. Dose and duration per local protocol.",
      },
    ],
    specialistContacts: [
      "Hospital Medical Emergency Team / Anaesthetics if stridor or airway compromise",
      "Poisons Information Centre: 13 11 26",
    ],
    caveat:
      "Rapidly reversible with anticholinergics. Ensure patient reassurance during distressing spasm. Review antipsychotic dose and regimen prior to next dose.",
    evidenceSource:
      "Therapeutic Guidelines: Psychotropic; Maudsley Prescribing Guidelines (14th ed); British National Formulary.",
  },
  {
    id: "EMERG-LITHIUM-TOXICITY",
    name: "Acute / Chronic Lithium Toxicity",
    acronym: "Li Tox",
    category: "toxicity",
    triggerPatterns: [
      /\b(?:lithium\s+toxic\w*|lithium\s+overdose|high\s+lithium\s+level|lithium\s+poisoning)\b/i,
      /\b(?:coarse\s+tremor|ataxia)\s+(?:and|with|from)\s+lithium\b/i,
    ],
    firstLineAction: "Withhold lithium immediately.",
    warningNotice:
      "Narrow therapeutic index. Severe toxicity (level per local protocol) carries high risk of permanent cerebellar dysfunction (SILENT syndrome), seizures, arrhythmias, and acute renal failure.",
    diagnosticFeatures: [
      "Mild to moderate (level per local protocol): Coarse tremor, ataxia, nausea, vomiting, diarrhoea, muscle weakness, drowsiness, hyperreflexia",
      "Severe (level per local protocol): Marked confusion, dysarthria, gross ataxia, myoclonus, fasciculations, seizures, hypotension, acute kidney injury",
      "Critical (level per local protocol): Coma, status epilepticus, cardiovascular collapse, irreversible neurotoxicity",
    ],
    urgentInvestigations: [
      "Stat serum lithium level, then repeat levels to monitor trajectory until clearly declining (interval per local protocol)",
      "EUC & eGFR: assess renal function and baseline clearance capacity",
      "Serum electrolytes: especially sodium (hyponatremia impairs renal lithium excretion)",
      "12-lead ECG: evaluate for T-wave inversion/flattening, sinus node dysfunction, QT prolongation, arrhythmias",
    ],
    immediateManagement: [
      {
        title: "Withhold Lithium & Nephrotoxic Offending Agents",
        detail:
          "Cease lithium immediately. Withhold ACE inhibitors, ARBs, NSAIDs, and thiazide/loop diuretics which impair renal lithium clearance.",
        isHighPriority: true,
      },
      {
        title: "Intravenous Normal Saline Resuscitation",
        detail:
          "Administer IV normal saline to correct volume depletion, maintain GFR, and promote urinary lithium excretion. Rate per local protocol, adjusted for cardiovascular status.",
        isHighPriority: true,
      },
      {
        title: "Haemodialysis Evaluation (Nephrology / ICU)",
        detail: "Indications for urgent haemodialysis (serum level and clinical criteria) per local protocol.",
      },
    ],
    specialistContacts: [
      "Poisons Information Centre: 13 11 26 (24 hours Australia-wide)",
      "On-call Nephrology / Dialysis Unit",
      "Intensive Care Unit (ICU)",
    ],
    caveat:
      "Chronic toxicity carries greater tissue saturation and neurotoxicity than acute single overdose at equivalent serum levels. Manage in high-dependency or intensive care.",
    evidenceSource:
      "Extracorporeal Treatments in Poisoning (EXTRIP) Workgroup guidelines for lithium poisoning; Therapeutic Guidelines: Toxicology; Australian Prescriber.",
  },
  {
    id: "EMERG-CLOZAPINE-MYOCARDITIS",
    name: "Clozapine-Induced Myocarditis & Cardiomyopathy",
    acronym: "Clozapine Myocarditis",
    category: "cardiac",
    triggerPatterns: [
      /\b(?:clozapine\s+myocarditis|clozapine\s+troponin|clozapine\s+cardiac)\b/i,
      /\b(?:tachycardia|chest\s+pain|fever)\s+(?:and|with|on)\s+clozapine\b/i,
    ],
    firstLineAction: "Cease clozapine immediately if myocarditis is confirmed or strongly suspected.",
    warningNotice:
      "Potentially fatal IgE-mediated hypersensitivity myocarditis. Onset timing and the monitoring schedule are per local protocol. Any re-challenge requires specialist review (cardiology).",
    diagnosticFeatures: [
      "Persistent unexplained resting tachycardia (rate per local protocol) or orthostatic hypotension",
      "Unexplained fever or flu-like symptoms during early clozapine titration",
      "Shortness of breath, orthopnoea, chest tightness/pain, peripheral oedema",
      "Palpitations, marked fatigue, syncope, or elevated jugular venous pressure",
    ],
    urgentInvestigations: [
      "Urgent Serum Troponin I or T (compare with baseline)",
      "High-sensitivity C-reactive Protein (hs-CRP): sensitive early inflammatory marker",
      "12-lead ECG: assess for ST/T wave changes, sinus tachycardia, PR depression, arrhythmias",
      "Echocardiogram: evaluate for left ventricular systolic dysfunction, wall motion abnormalities, or pericardial effusion",
      "Full blood count: assess for eosinophilia",
    ],
    immediateManagement: [
      {
        title: "Clozapine Cessation Criteria",
        detail:
          "Cease clozapine if myocarditis is confirmed or strongly suspected. Troponin and hs-CRP thresholds per local protocol.",
        isHighPriority: true,
      },
      {
        title: "Urgent Cardiology Referral",
        detail:
          "Consult cardiology immediately for echocardiography, cardiac monitoring, and heart failure management (ACE inhibitors, beta-blockers as indicated).",
        isHighPriority: true,
      },
      {
        title: "Re-challenge Requires Specialist Review",
        detail:
          "Re-challenge after confirmed clozapine-induced myocarditis requires specialist review (cardiology). Record adverse drug reaction prominently in medical records.",
      },
    ],
    specialistContacts: [
      "On-call Cardiology / Cardiac Care Unit",
      "Treating Consultant Psychiatrist / Hospital Clozapine Coordinator",
    ],
    caveat:
      "Tachycardia alone is common and often benign with clozapine, but persistent tachycardia with fever, dyspnoea, or elevated biomarkers mandates immediate cessation and investigation.",
    evidenceSource:
      "WA Department of Health, Guidelines for the Safe and Quality Use of Clozapine Therapy in the WA health system (Version 2, June 2024; cardiologist advice on rechallenge after myocarditis); Ronaldson et al., Australian & New Zealand Journal of Psychiatry (Clozapine myocarditis monitoring protocol); Therapeutic Guidelines: Psychotropic; RANZCP Guidelines.",
  },
  {
    id: "EMERG-MALIGNANT-CATATONIA",
    name: "Malignant (Lethal) Catatonia",
    acronym: "Malignant Catatonia",
    category: "syndrome",
    triggerPatterns: [
      /\b(?:malignant\s+catatoni\w*|lethal\s+catatoni\w*|catatonic\s+excitement)\b/i,
      /\bcatatonia\s+(?:and|with)\s+(?:fever|hyperthermia|autonomic)\b/i,
    ],
    firstLineAction: "High-dose Benzodiazepine challenge (Lorazepam) & Urgent ECT Consultation.",
    warningNotice:
      "Life-threatening psychiatric emergency characterized by severe catatonic symptoms, hyperthermia, and autonomic collapse. High mortality without prompt treatment.",
    diagnosticFeatures: [
      "Catatonic motor signs: stupor, mutism, waxy flexibility, posturing, negativism, catalepsy",
      "Autonomic instability: pyrexia, fluctuating blood pressure, tachycardia, tachypnea, profuse sweating",
      "Course: often preceded by intense psychotic agitation or delirium ('catatonic excitement') culminating in stupor",
      "Distinction from NMS: NMS typically follows initiation/escalation of dopamine antagonists, whereas catatonia frequently has motor features prior to medications.",
    ],
    urgentInvestigations: [
      "Serum CK (Creatine Kinase): assess muscle breakdown and rhabdomyolysis",
      "EUC, FBC, Electrolytes, Coagulation profile, Blood gas",
      // Owner decision (PR #3230 follow-up): the lines below say only what the BAP catatonia
      // guideline supports (Rogers et al., J Psychopharmacol 2023, PMC10101189). No Australian
      // equivalent found, rung 5 (international). Not in the source register: the publisher (BAP) is
      // unregistered and registering it moves retrieval tiering, which needs an owner decision.
      // Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC10101189/
      "Investigations, such as blood tests, urine drug screen, lumbar puncture, EEG and neuroimaging, should be considered based on history and examination findings",
      "First episode of catatonia, or underlying diagnosis unclear: consider a CT or MRI scan of the brain",
      "Consider assessing for NMDA receptor antibodies and other relevant autoantibodies in serum and CSF",
      "Risk factors for seizures, possible evidence of a seizure or possible encephalitis: consider an EEG",
    ],
    immediateManagement: [
      {
        title: "Lorazepam Challenge Test",
        detail:
          "Administer lorazepam sublingually, IV, or IM. Dose per local protocol. Monitor for objective reduction in rigidity, mutism, or stupor (timing per local protocol).",
        isHighPriority: true,
      },
      {
        title: "Urgent Electroconvulsive Therapy (ECT)",
        detail:
          "ECT is the definitive, life-saving first-line intervention for malignant catatonia, particularly when benzodiazepine response is incomplete or delayed.",
        isHighPriority: true,
      },
      {
        title: "Supportive Medical & Intensive Care",
        detail:
          "Hydration, nutritional support, venous thromboembolism (VTE) prophylaxis, pressure injury prevention, aspiration precautions.",
      },
    ],
    specialistContacts: [
      "On-call ECT Coordinator / Consultant Psychiatrist",
      "Hospital Medical Emergency Team (MET) / Intensive Care Unit",
    ],
    caveat:
      "Dopamine antagonists (antipsychotics) must be avoided in acute catatonia as they can precipitate or aggravate neuroleptic malignant syndrome.",
    evidenceSource:
      "Rogers et al., British Association for Psychopharmacology evidence-based consensus guidelines for the management of catatonia, J Psychopharmacol 2023 (investigations; no Australian equivalent found); Bush-Francis Catatonia Rating Scale guidelines; Maudsley Prescribing Guidelines (14th ed); Fink & Taylor, Catatonia: A Clinician's Guide to Diagnosis and Treatment.",
  },
] as const;

/**
 * Returns every distinct acute emergency protocol whose trigger matches the query, in
 * catalogue order. A comparison query (for example two syndromes named together) must show
 * every matched card so an ambiguous differential never looks resolved by one card alone.
 */
export function matchEmergencyClinicalProtocols(text: string | null | undefined): readonly EmergencyClinicalProtocol[] {
  if (!text) return [];
  const normalized = text.normalize("NFKC").trim();
  if (normalized.length < 2) return [];
  return EMERGENCY_CLINICAL_PROTOCOLS.filter((protocol) =>
    protocol.triggerPatterns.some((pattern) => pattern.test(normalized)),
  );
}

/**
 * First matching protocol or null. Prefer `matchEmergencyClinicalProtocols` for display: this
 * returns only the first match and so hides any other protocol the query also names.
 */
export function matchEmergencyClinicalProtocol(text: string | null | undefined): EmergencyClinicalProtocol | null {
  return matchEmergencyClinicalProtocols(text)[0] ?? null;
}

export interface EmergencySurfaceInput {
  /** True when the active mode renders an answer surface. */
  readonly isAnswerSurface: boolean;
  /** True when an answer is loading or present, so the surface shows a submitted result. */
  readonly hasResultSurface: boolean;
  /** Query behind the loading or displayed answer. */
  readonly resultQuery: string | null | undefined;
  /** Submitted answer query that never reached the backend because setup was not ready. */
  readonly setupBlockedQuery: string | null | undefined;
}

/**
 * Cards to show on the answer surface. The cards are local and provider-independent, so a
 * submitted query still gets them when answer setup is not ready (degraded backend). A query
 * that was never submitted never matches.
 */
export function selectEmergencyProtocolsForSurface(input: EmergencySurfaceInput): readonly EmergencyClinicalProtocol[] {
  if (!input.isAnswerSurface) return [];
  return matchEmergencyClinicalProtocols(input.hasResultSurface ? input.resultQuery : input.setupBlockedQuery);
}
