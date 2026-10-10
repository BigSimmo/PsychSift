import type { SearchResult } from "@/lib/types";

export type ExpectedFileCoverage = {
  expectedFiles: string[];
  matchedFiles: string[];
  missingFiles: string[];
  anyHit: boolean;
  allHit: boolean;
};

export function normalizedDocumentName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// TIERING — deliberately WIDER than scripts/lib/clinical-aliases.ts, and kept separate on
// purpose. This table serves captured-case coverage (rag-eval-cases / eval-utils), where the
// goal is absorbing corpus renames and near-equivalents so auto-captured expectations keep
// matching. The scripts/lib module is the STRICT tier consumed by the zero-tolerance golden
// gates and the ranking-snapshot relevance grades — entries there need a per-entry evidence
// trail. Never bulk-merge this table into the strict tier: looser entries here (e.g.
// "Clozapine GP Shared Care") would let adjacent documents satisfy pinned golden expectations.
const clinicalDocumentAliases: Record<string, string[]> = {
  Acamprosate: ["Acamprosate"],
  ActiveCommunityPtED: [
    "Active Community Patients in the Emergency Department",
    "Active Community Patients Emergency Department",
  ],
  AdmissionCommunityPts: [
    "Admission of Community Patients",
    "Admission Community Patients",
    // #080: these two real NMHS policies replaced the synthetic AdmissionCommunityPts name
    // and contain admission requirements as well as discharge guidance. They intentionally
    // overlap the Discharge tier; expectedFileCoverage's document-identity dedupe + maximum
    // matching still requires a second physical source before a two-slot case can reach allHit.
    "Admission to Discharge for Mental Health Inpatients",
    "Admission to Discharge for Community Mental Health",
  ],
  AgitationArousalPharmaMgt: [
    "Agitation and Arousal Pharmacological Management",
    "Pharmacological Management of Acute Agitation and Arousal",
    "Medication for Agitation and Arousal",
    "Mental Health Pharmacological Management of Agitation and Arousal",
  ],
  AssessmentDocumentation: ["Assessment Documentation", "Clinical Assessment", "Mental Health Assessment"],
  ADHD: ["ADHD", "Attention Deficit Hyperactivity Disorder"],
  BestPracticePrescription: ["Best Practice Prescription", "Best Practice Prescribing", "Prescription"],
  ClozapinePresAdminMonitor: [
    "Clozapine Prescribing Administration Monitoring",
    "Clozapine Prescribing Administration and Monitoring",
    "Clozapine Prescribing Administering Monitoring",
    "Clozapine Prescribing Administering Monitoring and Capillary Sampling",
    "Clozapine Prescribing",
    "Clozapine Prescribing NMHS",
    "Clozapine GP Shared Care",
    "Clozapine Management by GP",
    "Clozapine Therapy",
  ],
  CommunityHomeVisit: ["Community Home Visit", "Home Visit", "Community Visits"],
  Discharge: [
    // These two titles also represent the AdmissionCommunityPts slot (#080). Maximum matching
    // below prevents one dual-listed document from satisfying both comparison sides (#030).
    "Admission to Discharge for Mental Health Inpatients",
    "Admission to Discharge for Community Mental Health",
    "Referral Admission and Discharge Mental Health Hospital in the Home",
    "Mental Health Hospital in the Home",
    "Mental Health Medically Cleared for Discharge",
    "Mental Health Inpatient Triage to Discharge",
    "ACMHS and OACMHS Triage to Discharge",
    // The synthetic MHSP.Discharge.pdf was superseded by real named discharge documents;
    // "Discharge Planning for Community Patients / Inpatients" is the discharge counterpart
    // that ranks for the admission-vs-discharge comparison, so recognize it as a real hit.
    "Discharge Planning",
  ],
  Duress: ["Duress", "Duress Procedure", "Duress Response"],
  ECTProcedure: ["ECT Procedure", "Electroconvulsive Therapy", "Electroconvulsive Therapy ECT"],
  IllegalSubstances: ["Illegal Substances", "Substances", "Contraband"],
  LongActingInjectable: [
    "Long Acting Injectable",
    "Long-Acting Injectable",
    "Depot",
    "Olanzapine LAI",
    "Long Acting Injectable Antipsychotic",
  ],
  Lithium: ["Lithium", "Lithium Clinical Guideline", "Lithium CAMHS"],
  Metformin: ["Metformin"],
  MetabolicScreening: ["Metabolic Screening", "Metabolic Monitoring", "Physical Health Monitoring"],
  MHATMHCTTreatmentTeamProcess: ["Mental Health Treatment Team Process", "Treatment Team Process", "MHAT", "MHCT"],
  NeurolepticSideEffect: ["Neuroleptic Side Effects", "Neuroleptic Side Effect", "Neuroleptic Effects"],
  NOCC: ["NOCC", "National Outcomes and Casemix Collection", "Outcome Measures Completion"],
  Naltrexone: ["Naltrexone"],
  PtSafetyPlan: ["Patient Safety Plan", "Safety Planning", "Safety Plan"],
  Sertraline: ["Sertraline"],
};

type ExpectedCoverageSource = Pick<SearchResult, "file_name" | "title"> & Partial<Pick<SearchResult, "document_id">>;

export function documentExpectationAlternatives(expectation: string) {
  const normalizedExpectation = normalizedDocumentName(expectation);
  const compactExpectation = normalizedExpectation.replace(/\s+/g, "");
  const aliasValues = Object.entries(clinicalDocumentAliases).flatMap(([key, values]) => {
    const normalizedKey = normalizedDocumentName(key);
    const compactKey = normalizedKey.replace(/\s+/g, "");
    if (!compactExpectation.includes(compactKey) && !normalizedExpectation.includes(normalizedKey)) return [];
    return values;
  });
  return Array.from(new Set([expectation, ...aliasValues].map(normalizedDocumentName).filter(Boolean)));
}

// High-risk answer checks must identify the named guidance itself, rather than the wider
// captured-case alias set used by expectedFileCoverage.
export function expectedFileNameMatch(expectedFiles: string[], sources: ExpectedCoverageSource[], limit = 3) {
  const expectedNames = expectedFiles.map((file) => normalizedDocumentName(file).replace(/\s+pdf$/, ""));
  return sources.slice(0, limit).some((source) =>
    [source.title, source.file_name].some((name) =>
      expectedNames.includes(normalizedDocumentName(name).replace(/\s+pdf$/, "")),
    ),
  );
}

function resultDocumentText(source: ExpectedCoverageSource) {
  return normalizedDocumentName(`${source.title} ${source.file_name}`);
}

function resultDocumentIdentity(source: ExpectedCoverageSource) {
  const documentId = source.document_id?.trim();
  if (documentId) return `document_id:${documentId}`;
  const stableName = normalizedDocumentName(source.file_name) || normalizedDocumentName(source.title);
  return `document_name:${stableName}`;
}

export function expectedFileCoverage(
  expectedFiles: string[],
  sources: ExpectedCoverageSource[],
  limit = 3,
): ExpectedFileCoverage {
  // Distinct source identities (#030): answer.citations contains one entry per chunk and the
  // title attached to those chunks may vary. Prefer the canonical document_id; older captured
  // evidence without one falls back to the stable filename (then title). Aggregate all text
  // variants for one identity while retaining its first-ranked position, so one physical
  // document can match either overlapping alias but can never fill both slots.
  const topFiles = Array.from(
    sources
      .slice(0, limit)
      .reduce((documents, source) => {
        const identity = resultDocumentIdentity(source);
        const existing = documents.get(identity);
        if (existing) {
          existing.texts.add(resultDocumentText(source));
        } else {
          documents.set(identity, { texts: new Set([resultDocumentText(source)]) });
        }
        return documents;
      }, new Map<string, { texts: Set<string> }>())
      .values(),
  );
  const candidateSourcesByExpectation = expectedFiles.map((expected) => {
    const alternatives = documentExpectationAlternatives(expected);
    return topFiles.reduce<number[]>((indexes, file, index) => {
      if ([...file.texts].some((text) => alternatives.some((alternative) => text.includes(alternative)))) {
        indexes.push(index);
      }
      return indexes;
    }, []);
  });

  // Maximum bipartite matching (Kuhn's augmenting path) rather than first-come assignment:
  // a combo-titled document that matches two expectations must not consume the only source a
  // narrower expectation could have used, which would make coverage depend on expectedFiles order.
  const expectationBySource = new Map<number, number>();
  const claimSource = (expectationIndex: number, visitedSources: Set<number>): boolean => {
    for (const sourceIndex of candidateSourcesByExpectation[expectationIndex]) {
      if (visitedSources.has(sourceIndex)) continue;
      visitedSources.add(sourceIndex);
      const holder = expectationBySource.get(sourceIndex);
      if (holder === undefined || claimSource(holder, visitedSources)) {
        expectationBySource.set(sourceIndex, expectationIndex);
        return true;
      }
    }
    return false;
  };
  expectedFiles.forEach((_, expectationIndex) => claimSource(expectationIndex, new Set()));

  const matchedExpectations = new Set(expectationBySource.values());
  const matchedFiles = expectedFiles.filter((_, index) => matchedExpectations.has(index));

  return {
    expectedFiles,
    matchedFiles,
    missingFiles: expectedFiles.filter((_, index) => !matchedExpectations.has(index)),
    anyHit: matchedFiles.length > 0,
    allHit: expectedFiles.length > 0 && matchedFiles.length === expectedFiles.length,
  };
}
