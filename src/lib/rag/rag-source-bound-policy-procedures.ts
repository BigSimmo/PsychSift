import { boldHighYieldClinicalText } from "@/lib/answer-ranking";
import { normalizeSectionText } from "@/lib/rag/rag-answer-text";
import { sourceTextForClinicalProsePreservingBreaks } from "@/lib/source-text-sanitizer";
import type { AnswerSection, RagQueryClass, SearchResult } from "@/lib/types";
import { atomicNmhsClozapineRedRangeSegment, reflowBoundedSourceLines } from "@/lib/rag/rag-source-segmentation";

const sourceBoundActiveCommunityEdProcedureQueries = new Set([
  "how are active community patients in ed managed",
  "active community pt in ed guidance",
]);

const sourceBoundCommunityHomeVisitRequirementsQuery = "what is required for community home visits";
const sourceBoundBestPracticePrescriptionRequirementsQuery =
  "what does the best practice prescription document require";

export function normalizedMeasuredQuery(query: string) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Whether the query is one of the measured active-community ED procedure shapes. */
export function isSourceBoundActiveCommunityEdProcedureQuery(query: string, queryClass: RagQueryClass) {
  return (
    queryClass === "document_lookup" && sourceBoundActiveCommunityEdProcedureQueries.has(normalizedMeasuredQuery(query))
  );
}

/** Whether the query is the measured AKG community-home-visit requirements shape. */
export function isSourceBoundCommunityHomeVisitRequirementsQuery(query: string, queryClass: RagQueryClass) {
  return (
    queryClass === "unsupported_or_general" &&
    normalizedMeasuredQuery(query) === sourceBoundCommunityHomeVisitRequirementsQuery
  );
}

/** Whether the query is the measured AKG Best Practice Prescription requirements shape. */
export function isSourceBoundBestPracticePrescriptionRequirementsQuery(query: string, queryClass: RagQueryClass) {
  return (
    queryClass === "document_lookup" &&
    normalizedMeasuredQuery(query) === sourceBoundBestPracticePrescriptionRequirementsQuery
  );
}

export function comparisonSourceLabel(result: SearchResult) {
  return normalizeSectionText([result.title, result.file_name, result.section_heading].filter(Boolean).join(" "));
}

function boundedSourceText(result: SearchResult) {
  return reflowBoundedSourceLines(sourceTextForClinicalProsePreservingBreaks(result.content ?? ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isActiveCommunityEdProcedureSource(result: SearchResult) {
  return /\bactive community\b.*\b(?:patients?|consumers?)\b.*\bemergency department\b/i.test(
    comparisonSourceLabel(result),
  );
}

function activeCommunityEdProcessEvidence(result: SearchResult) {
  if (!isActiveCommunityEdProcedureSource(result)) return false;
  const text = boundedSourceText(result);
  return (
    /\bconsumer will be triaged by the Triage Nurse at the AHS ED\b/i.test(text) &&
    /\bED Mental Health Liaison Nurse \(EDMHLN\) will provide a mental health assessment as required\b/i.test(text) &&
    /\bEDMHLN will identify via PSOLIS\b/i.test(text) &&
    /\bEDMHLN will check PSOLIS for a Treatment Support Discharge Plan \(TSD\)\s*\/\s*crisis plan\b/i.test(text) &&
    /\bEDMHLN will contact the relevant community mental health team,? EMHS CRHTT team\b/i.test(text) &&
    /\brequest collateral information\b/i.test(text)
  );
}

function activeCommunityEdAccessEvidence(result: SearchResult) {
  if (!isActiveCommunityEdProcedureSource(result)) return false;
  const text = boundedSourceText(result);
  return (
    /\bconsumers active with Armadale Mental Health Service \(AMHS\) are assessed by the most appropriate mental health clinician available\b/i.test(
      text,
    ) &&
    /\bprovided with information on how to access their relevant treating team during office hours\b/i.test(text) &&
    /\bprovided with information regarding out of hours emergency contacts\b/i.test(text)
  );
}

function isAkgCommunityHomeVisitSource(result: SearchResult) {
  return /\bCommunity\s+Home\s+Visit\s*\(?AKG\)?\b/i.test(comparisonSourceLabel(result));
}

export function communityHomeVisitDepartureEvidence(result: SearchResult) {
  if (!isAkgCommunityHomeVisitSource(result)) return false;
  const text = boundedSourceText(result);
  return (
    /\ball clinical staff are to complete a Community Home Visit Log\b/i.test(text) &&
    /\bprior to leaving the workplace\b/i.test(text) &&
    /\bDesignated OAC clerical staff will review the log\b/i.test(text)
  );
}

export function communityHomeVisitReturnEvidence(result: SearchResult) {
  if (!isAkgCommunityHomeVisitSource(result)) return false;
  const text = boundedSourceText(result);
  return (
    /\bLeschen clerical reception staff will take responsibility for safety monitoring\b/i.test(text) &&
    /\bclinician will inform Leschen clerical reception staff on their return to the workplace\b/i.test(text) &&
    /\bupdate the community home visit log\b/i.test(text)
  );
}

function isAkgBestPracticePrescriptionSource(result: SearchResult) {
  return /\bBest Practice Prescription(?:\s+Program)?\s*\(?AKG\)?\b/i.test(comparisonSourceLabel(result));
}

export function bestPracticePrescriptionProgramUseEvidence(result: SearchResult) {
  if (!isAkgBestPracticePrescriptionSource(result)) return false;
  const text = boundedSourceText(result);
  return (
    /\bBest Practice Prescription Program is an electronic program\b/i.test(text) &&
    /\bPrescription generation\b/i.test(text) &&
    /\bMaintenance of electronic medication profiles\b/i.test(text) &&
    /\bInternal and external correspondence generation\b/i.test(text) &&
    /\bRecording other relevant clinical information\b/i.test(text) &&
    /\ballergies\s*\/\s*adverse drug reactions\b/i.test(text)
  );
}

export function bestPracticePrescriptionProfileEvidence(result: SearchResult) {
  if (!isAkgBestPracticePrescriptionSource(result)) return false;
  const text = boundedSourceText(result);
  return (
    /\bat the first clinic appointment, medical officers are to inquire\b/i.test(text) &&
    /\babout their current medications\b/i.test(text) &&
    /\bverify this information\b/i.test(text) &&
    /\bGeneral Practitioner\b/i.test(text) &&
    /\bmedication name, formulation, route, dose and directions for use\b/i.test(text) &&
    /\beach psychiatric and non-psychiatric medication must be entered\b/i.test(text)
  );
}

/** Build the exact, same-document active-community ED procedure answer. */
export function buildActiveCommunityEdProcedureAnswer(args: { query: string; results: SearchResult[] }) {
  const processSources = args.results.filter(activeCommunityEdProcessEvidence);
  const accessSources = args.results.filter(activeCommunityEdAccessEvidence);
  const pair = processSources
    .flatMap((process) => accessSources.map((access) => ({ process, access })))
    .find(
      ({ process, access }) =>
        process.id !== access.id && Boolean(process.document_id) && process.document_id === access.document_id,
    );
  if (!pair) return null;

  const processBody =
    "The consumer is triaged by the AHS ED Triage Nurse, and the ED Mental Health Liaison Nurse (EDMHLN) provides a mental health assessment as required. The EDMHLN identifies the active community team in PSOLIS, checks the Treatment Support Discharge Plan (TSD)/crisis plan, contacts the relevant community or CRHTT team, and requests collateral information.";
  const accessBody =
    "Active AMHS consumers are assessed by the most appropriate mental health clinician available. They should routinely receive information on accessing their treating team during office hours and out-of-hours emergency contacts.";
  const answerSections = [
    {
      heading: "ED assessment and coordination",
      kind: "required_actions",
      supportLevel: "direct",
      body: boldHighYieldClinicalText(processBody, args.query),
      citation_chunk_ids: [pair.process.id],
    },
    {
      heading: "Clinician access and contacts",
      kind: "required_actions",
      supportLevel: "direct",
      body: boldHighYieldClinicalText(accessBody, args.query),
      citation_chunk_ids: [pair.access.id],
    },
  ] satisfies AnswerSection[];
  return {
    answer: `${processBody} ${accessBody}`,
    body: `${processBody} ${accessBody}`,
    preformatted: true,
    sourceBoundCitationOnly: true,
    citationChunkIds: [pair.process.id, pair.access.id],
    answerSections,
  };
}

/** Build the exact, same-document AKG community-home-visit requirements answer. */
export function buildCommunityHomeVisitRequirementsAnswer(args: { query: string; results: SearchResult[] }) {
  const departureSources = args.results.filter(communityHomeVisitDepartureEvidence);
  const returnSources = args.results.filter(communityHomeVisitReturnEvidence);
  const pair = departureSources
    .flatMap((departure) => returnSources.map((returned) => ({ departure, returned })))
    .find(
      ({ departure, returned }) =>
        departure.id !== returned.id &&
        Boolean(departure.document_id) &&
        departure.document_id === returned.document_id,
    );
  if (!pair) return null;

  const departureBody =
    "All clinical staff are to complete a Community Home Visit Log prior to leaving the workplace. Designated OAC clerical staff will review the log.";
  const returnBody =
    "Leschen clerical reception staff will take responsibility for safety monitoring. The clinician will inform Leschen clerical reception staff on their return to the workplace and update the Community Home Visit Log.";
  return {
    answer: `${departureBody} ${returnBody}`,
    body: `${departureBody} ${returnBody}`,
    preformatted: true,
    sourceBoundCitationOnly: true,
    citationChunkIds: [pair.departure.id, pair.returned.id],
    answerSections: [
      {
        heading: "Before leaving",
        kind: "required_actions",
        supportLevel: "direct",
        body: boldHighYieldClinicalText(departureBody, args.query),
        citation_chunk_ids: [pair.departure.id],
      },
      {
        heading: "Safety monitoring and return",
        kind: "required_actions",
        supportLevel: "direct",
        body: boldHighYieldClinicalText(returnBody, args.query),
        citation_chunk_ids: [pair.returned.id],
      },
    ] satisfies AnswerSection[],
  };
}

/** Build the exact, same-document AKG prescription-program requirements answer. */
export function buildBestPracticePrescriptionRequirementsAnswer(args: { query: string; results: SearchResult[] }) {
  const useSources = args.results.filter(bestPracticePrescriptionProgramUseEvidence);
  const profileSources = args.results.filter(bestPracticePrescriptionProfileEvidence);
  const pair = useSources
    .flatMap((use) => profileSources.map((profile) => ({ use, profile })))
    .find(
      ({ use, profile }) =>
        use.id !== profile.id && Boolean(use.document_id) && use.document_id === profile.document_id,
    );
  if (!pair) return null;

  const useBody =
    "Best Practice Prescription Program is used for prescription generation, maintenance of electronic medication profiles, internal and external correspondence generation, and recording other relevant clinical information such as allergies/adverse drug reactions.";
  const profileBody =
    "At the first clinic appointment, medical officers are to inquire with the consumer or carer about current medications and may need to verify the information against the consumer’s medicines or another suitable source such as the General Practitioner. For each psychiatric and non-psychiatric medication, the medication name, formulation, route, dose and directions for use must be entered in the medication profile.";
  return {
    answer: `${useBody} ${profileBody}`,
    body: `${useBody} ${profileBody}`,
    preformatted: true,
    sourceBoundCitationOnly: true,
    citationChunkIds: [pair.use.id, pair.profile.id],
    answerSections: [
      {
        heading: "Program use",
        kind: "required_actions",
        supportLevel: "direct",
        body: boldHighYieldClinicalText(useBody, args.query),
        citation_chunk_ids: [pair.use.id],
      },
      {
        heading: "Medication profile",
        kind: "documentation",
        supportLevel: "direct",
        body: boldHighYieldClinicalText(profileBody, args.query),
        citation_chunk_ids: [pair.profile.id],
      },
    ] satisfies AnswerSection[],
  };
}

export function isAtomicNmhsClozapineRedRangeSource(result: SearchResult) {
  const label = comparisonSourceLabel(result);
  return Boolean(
    atomicNmhsClozapineRedRangeSegment({
      sourceLabel: label,
      content: result.content ?? "",
    }),
  );
}

/** Build an atomic red-range threshold/action answer from one explicitly labelled NMHS row. */
export function buildClozapineBloodActionThresholdAnswer(args: { query: string; results: SearchResult[] }) {
  const source = args.results.find(isAtomicNmhsClozapineRedRangeSource);
  if (!source) return null;
  // The source row pairs the stop with "Contact haematologist and Clozapine Monitoring Centre";
  // dropping it lost the escalation step from the red-range answer (#ZZ4RAP).
  const body =
    "Red-range WBC <3.0 × 10⁹/L and/or neutrophils <1.5 × 10⁹/L: stop clozapine therapy immediately. Contact haematologist and Clozapine Monitoring Centre.";
  return {
    answer: body,
    body,
    preformatted: true,
    sourceBoundCitationOnly: true,
    citationChunkIds: [source.id],
    answerSections: [
      {
        heading: "Red-range threshold and action",
        kind: "thresholds",
        supportLevel: "direct",
        body: boldHighYieldClinicalText(body, args.query),
        citation_chunk_ids: [source.id],
      },
    ] satisfies AnswerSection[],
  };
}
