import { createHash } from "node:crypto";
import { types } from "node:util";
import { z } from "zod";
import { buildChunks } from "../src/lib/chunking";
import {
  buildDocumentIndexUnitInputs,
  buildVisualDocumentIndexUnitInputs,
  embeddingTextForDocumentIndexUnit,
  type DocumentIndexUnitInput,
} from "../src/lib/document-index-units";
import {
  generationEvidenceBytes,
  generationEvidenceDigest,
  generationEvidenceSlots,
  parseGenerationDeclarations,
  parseSourceExpectation,
  type GenerationUnitDeclaration,
  type IssuedAttemptControl,
} from "../src/lib/ingestion-generation-evidence";
import type { ExtractedDocument } from "../src/lib/types";
import {
  retainedCandidateImages,
  candidateChunkId,
  preparedRowSchema,
  serializeCandidateChunkRows,
  candidateImageRowSchema,
  candidateTableFactRowSchema,
} from "./candidate-chunks";
import type { buildGenerationRetentionPacket } from "./generation-evidence";
import { canDeferOptionalProducerDeclarations } from "./generation-evidence";
import { buildTableFactRows } from "./table-facts";
import { buildAdditionalEmbeddingFieldInputs } from "./embedding-fields";
import { prepareManagedLocalMemoryProducer } from "./managed-local-memory-producer";
import {
  assembleWholeOriginalProducerManifest,
  prepareWholeOriginalSupplier,
  stageWholeOriginalSupplier,
  readWholeOriginalSupplier,
  type WholeOriginalProducerAssemblyInput,
  type WholeOriginalRoleRequirements,
} from "./whole-original-supplier";
import type { JobRow } from "./types";

const FOUR_PAGE_SOURCE = "sha256:abbc8107a09582e18f36bf4905c75f1fc78af70cd516851b89bff8919ca5bece";
const FOUR_PAGE_EXPECTATION = "sha256:2a5c6ae064ef159f15042105c85edc9da4af6bd231ae1268e703baf0c447e0da";
const FOUR_PAGE_PAGES = [
  {
    pageNumber: 1,
    text: "Summary of the guidelines\n\nGuideline 1: Adults\n\nTo reduce the risk of harm from alcohol-related disease or injury, healthy\nmen and women should drink no more than 10 standard drinks a week and\nno more than 4 standard drinks on any one day.\nThe less you drink, the lower your risk of harm from alcohol.\n\nThis guideline applies to healthy men and women aged 18 years and over. The guideline\ndoes not represent a ‘safe’ or ‘no-risk’ drinking level, nor does it set an absolute upper\nlimit of intake. It identifies a level of drinking at which, based on the current scientific\nevidence, the risk of alcohol-related harm remains low over a lifetime, in terms of both\nrisk of death from alcohol-related disease and death from alcohol-related injury.\n\nKey messages\n•  This guideline provides recommendations to reduce the risk of harm from alcohol, but\n  these recommendations do not completely eliminate all risk from drinking alcohol.\n\n• For both men and women, the risk of dying from alcohol-related disease and injury\n  remains below 1 in 100 if no more than 10 standard drinks are consumed each week\n  and no more than 4 standard drinks are consumed on any one day.\n\n• Every drink above this level increases the lifetime risk of alcohol-related disease and\n   injury. This includes the risk of dying from alcohol-related disease or injury.\n\n• Drinking alcohol increases the risk of many cancers. The level of risk increases as more\n  alcohol is consumed.\n\n• Drinking less frequently, and drinking less on each day or drinking occasion, further\n  reduces the lifetime risk of harm from alcohol.\n\n• Not drinking at all is the best way to reduce the risk of harm from alcohol.\n\n•  This guideline applies to most healthy adults; however, there are some people who\n  are at greater risk of alcohol-related harm. Those at greater risk include young adults\n  aged 18–25 years, people aged over 60 years, people with mental or physical health\n   conditions, people with a family history of alcohol dependence, and people who use\n    illicit drugs or take medications that interact with alcohol.\n\n•  This guideline does not apply to children and young people under the age of 18 years\n  (who are covered in Guideline 2), or to women who are planning a pregnancy, or are\n  pregnant or breastfeeding (who are covered in Guideline 3).\n\n\n\n\n\n                                 Australian Guidelines to Reduce Health Risks from Drinking Alcohol      4",
  },
  {
    pageNumber: 2,
    text: "Guideline 2: Children and people under\n18 years of age\n\nTo reduce the risk of injury and other harms to health, children and people\nunder 18 years of age should not drink alcohol.\n\nKey messages\nThere is no clear ‘safe’ level of alcohol consumption for children and people under\n18 years of age. This is because of the increased risks of harm from alcohol for young\npeople, including from injury and potential adverse effects on brain development.\n\nBeginning alcohol use at an early age may also put young people at greater risk of longer\nterm alcohol-related harms, including alcohol use disorders that tend to appear in early\nadulthood.\n\nTo minimise these risks, children and people under 18 years of age should not drink alcohol.\n\nGuideline 3: Women who are pregnant\nor breastfeeding\n\nA. To prevent harm from alcohol to their unborn child, women who are\n   pregnant or planning a pregnancy should not drink alcohol.\n\nB. For women who are breastfeeding, not drinking alcohol is safest for\n    their baby.\n\nKey messages\nThis guideline is based on evidence of the harms for the developing fetus and for young\nbabies when mothers drink alcohol while pregnant or breastfeeding. It is relevant to\nwomen who are pregnant, breastfeeding or may become pregnant in the near future.\n\nThe evidence does not indicate a safe amount of alcohol that pregnant women and\nbreastfeeding mothers can drink.\n\n• As there is a risk of harm to the fetus, this guideline takes a precautionary approach\n  and recommends not drinking alcohol when pregnant.\n\n•  Similarly, as there is a risk of harm to the baby, this guideline takes a precautionary\n  approach and recommends not drinking alcohol when breastfeeding.\n\nDuring pregnancy\n• Alcohol is a teratogen — that is, a substance that can cause permanent harm to a\n  developing fetus. If a woman drinks alcohol during pregnancy, the alcohol passes\n   freely from the mother to the fetus via the placenta, so the blood alcohol levels of the\n  mother and fetus are similar.\n\n• The central nervous system starts developing very early in the pregnancy, and the\n   brain is sensitive to harms from alcohol throughout pregnancy.\n\n• No safe level of alcohol consumption during pregnancy has been identified.\n\n• The risk of harm to the fetus increases the more the mother drinks and the more\n   frequently she drinks.\n\n\n\n\n                                 Australian Guidelines to Reduce Health Risks from Drinking Alcohol      5",
  },
  {
    pageNumber: 3,
    text: "• Maternal and fetal factors affect the risks from drinking alcohol while pregnant\n   (e.g. genetic differences, metabolic rates, and biochemical and inflammatory responses\n  to alcohol). These factors make it difficult to predict the level of risk in each individual\n  pregnancy.\n\n• Not drinking alcohol during pregnancy, or when planning a pregnancy, prevents the\n   risk of alcohol-related harm to the developing fetus.\n\nWhen breastfeeding\n• For women who are breastfeeding, not drinking alcohol is safest for their baby.\n\n•  If a breastfeeding mother drinks alcohol, that alcohol crosses into the breastmilk.\n  Only time reduces the amount of alcohol in the milk.\n\n• Maternal alcohol consumption may adversely affect the feeding behaviour and sleep\n  patterns of the breastfed baby.\n\n• A baby’s brain keeps developing after it is born. A growing infant brain is more\n   sensitive to damage from alcohol than an adult brain.\n\n\n\n\n\n                                 Australian Guidelines to Reduce Health Risks from Drinking Alcohol      6",
  },
  {
    pageNumber: 4,
    text: "Appendix 2: Guideline 1 \nmodelling results\nThe lifetime risk threshold selected for this guideline was a 1 in 100 (1%) chance of dying from an \nalcohol-related condition (see the Rationale for Guideline 1). Table A2.1 presents consumption \nlevels corresponding to this risk threshold, and provides a comparison of consumption levels \nwith alternative risk thresholds of 0.1% (1 in 1000), 0.2% (1 in 500) and 2.0% (1 in 50). This table \nis not intended to be used for individual interpretation of risk levels given individual drinking \npatterns. Rather, the information is intended to support population-level advice, as explained \nbelow.\nConsidering that the average drinking frequency in Australia is 3 days per week (see Appendix 1), \nthe number of standard drinks corresponding to the 1% risk threshold is 12.5 standard drinks per \nweek for men and 10.5 standard drinks per week for women (Table A2.1).\nTable A2.1 Number of standard drinks per week associated with alternative lifetime mortality \nrisk thresholds, depending on number of days alcohol is consumed per week\n| Drinking frequency | Risk level |  |  |  |\n| --- | --- | --- | --- | --- |\n|  | 0.1% (1 in 1000) | 0.2% (1 in 500) | 1% (1 in 100) | 2% (1 in 50) |\n| Men | Standard drinks (per week) |  |  |  |\n| Daily | 18.5 | 18.7 | 20.2 | 21.9 |\n| 6 days/week | 17.1 | 17.2 | 18.6 | 20.2 |\n| 5 days/week | 15.5 | 15.7 | 16.9 | 18.5 |\n| 4 days/week | 13.6 | 13.7 | 14.9 | 16.4 |\n| 3 days/week | 11.3 | 11.4 | 12.5 | 13.8 |\n| 2 days/week | 8 | 8.1 | 9 | 10.1 |\n| 1 day/week | 3.4 | 3.4 | 4.1 | 4.9 |\n| Women | Standard drinks (per week) |  |  |  |\n| Daily | 14 | 14.1 | 15.3 | 16.7 |\n| 6 days/week | 13.3 | 13.4 | 14.5 | 15.8 |\n| 5 days/week | 12.3 | 12.5 | 13.5 | 14.8 |\n| 4 days/week | 11.1 | 11.2 | 12.1 | 13.3 |\n| 3 days/week | 9.5 | 9.6 | 10.5 | 11.6 |\n| 2 days/week | 7 | 7.1 | 7.8 | 8.8 |\n| 1 day/week | 4.1 | 4.1 | 4.7 | 5.4 |\nIn any public health guideline, it is important that advice is consistent, clear and cautious, \nerring on the side of protecting health. To check that the recommendations are robust \nwhen different types of evidence are considered, and to determine what might happen \nif that evidence varied, alternative scenarios were considered. The impact of the different \nconsiderations and scenarios on the weekly drinking amounts corresponding to risk levels are \noutlined in Tables A2.1 and A2.2.\nThis guideline and the previous (2009) alcohol guidelines [4] both applied a 1% lifetime risk \nthreshold; however, some international guidelines consider a 0.1% (1 in 1000) risk to be more \nappropriate. For a lifetime risk threshold of 0.1%, corresponding total weekly alcohol use \nis about 10% lower than that indicated for a 1% threshold; that is, 11.3 standard drinks per \nweek for men and 9.5 standard drinks per week for women for an average of 3 drinking days \nper week.\nAustralian Guidelines to Reduce Health Risks from Drinking Alcohol \n57",
  },
];
const FOUR_PAGE_DESCRIPTORS = [
  {
    bbox: [68, 315.77, 526.71, 599.3],
    height: 868,
    metadata: {
      accessible_table_markdown:
        "| Drinking frequency | Risk level |  |  |  |\n| --- | --- | --- | --- | --- |\n|  | 0.1% (1 in 1000) | 0.2% (1 in 500) | 1% (1 in 100) | 2% (1 in 50) |\n| Men | Standard drinks (per week) |  |  |  |\n| Daily | 18.5 | 18.7 | 20.2 | 21.9 |\n| 6 days/week | 17.1 | 17.2 | 18.6 | 20.2 |\n| 5 days/week | 15.5 | 15.7 | 16.9 | 18.5 |\n| 4 days/week | 13.6 | 13.7 | 14.9 | 16.4 |\n| 3 days/week | 11.3 | 11.4 | 12.5 | 13.8 |\n| 2 days/week | 8 | 8.1 | 9 | 10.1 |\n| 1 day/week | 3.4 | 3.4 | 4.1 | 4.9 |\n| Women | Standard drinks (per week) |  |  |  |\n| Daily | 14 | 14.1 | 15.3 | 16.7 |\n| 6 days/week | 13.3 | 13.4 | 14.5 | 15.8 |\n| 5 days/week | 12.3 | 12.5 | 13.5 | 14.8 |\n| 4 days/week | 11.1 | 11.2 | 12.1 | 13.3 |\n| 3 days/week | 9.5 | 9.6 | 10.5 | 11.6 |\n| 2 days/week | 7 | 7.1 | 7.8 | 8.8 |\n| 1 day/week | 4.1 | 4.1 | 4.7 | 5.4 |",
      bbox: [68, 315.77, 526.71, 599.3],
      candidate_type: "table",
      clip_bbox: [68, 315.77, 526.71, 599.3],
      column_count: 5,
      crop_completeness: 1,
      crop_touches_page_edge: false,
      extraction_method: "pymupdf_find_tables",
      heading_text:
        "Table A2.1 Number of standard drinks per week associated with alternative lifetime mortality risk thresholds, depending on number of days alcohol is consumed per week",
      pageNumber: 4,
      page_height: 841.89,
      page_rotation: 0,
      page_width: 595.28,
      render_dpi: 220,
      render_scale: 3.056,
      row_count: 18,
      rows_truncated: false,
      source_kind: "table_crop",
      source_regions: [{ bbox: [68, 315.77, 526.71, 599.3], page_number: 4, source_kind: "table_crop" }],
      table_columns: ["Drinking frequency", "Risk level", "", "", ""],
      table_confidence: 0.99,
      table_index: 1,
      table_label: "Table A2.1",
      table_role: "clinical",
      table_rows: [
        ["Drinking frequency", "Risk level", "", "", ""],
        ["", "0.1% (1 in 1000)", "0.2% (1 in 500)", "1% (1 in 100)", "2% (1 in 50)"],
        ["Men", "Standard drinks (per week)", "", "", ""],
        ["Daily", "18.5", "18.7", "20.2", "21.9"],
        ["6 days/week", "17.1", "17.2", "18.6", "20.2"],
        ["5 days/week", "15.5", "15.7", "16.9", "18.5"],
        ["4 days/week", "13.6", "13.7", "14.9", "16.4"],
        ["3 days/week", "11.3", "11.4", "12.5", "13.8"],
        ["2 days/week", "8", "8.1", "9", "10.1"],
        ["1 day/week", "3.4", "3.4", "4.1", "4.9"],
        ["Women", "Standard drinks (per week)", "", "", ""],
        ["Daily", "14", "14.1", "15.3", "16.7"],
        ["6 days/week", "13.3", "13.4", "14.5", "15.8"],
        ["5 days/week", "12.3", "12.5", "13.5", "14.8"],
        ["4 days/week", "11.1", "11.2", "12.1", "13.3"],
        ["3 days/week", "9.5", "9.6", "10.5", "11.6"],
        ["2 days/week", "7", "7.1", "7.8", "8.8"],
        ["1 day/week", "4.1", "4.1", "4.7", "5.4"],
      ],
      table_text:
        "| Drinking frequency | Risk level |  |  |  |\n| --- | --- | --- | --- | --- |\n|  | 0.1% (1 in 1000) | 0.2% (1 in 500) | 1% (1 in 100) | 2% (1 in 50) |\n| Men | Standard drinks (per week) |  |  |  |\n| Daily | 18.5 | 18.7 | 20.2 | 21.9 |\n| 6 days/week | 17.1 | 17.2 | 18.6 | 20.2 |\n| 5 days/week | 15.5 | 15.7 | 16.9 | 18.5 |\n| 4 days/week | 13.6 | 13.7 | 14.9 | 16.4 |\n| 3 days/week | 11.3 | 11.4 | 12.5 | 13.8 |\n| 2 days/week | 8 | 8.1 | 9 | 10.1 |\n| 1 day/week | 3.4 | 3.4 | 4.1 | 4.9 |\n| Women | Standard drinks (per week) |  |  |  |\n| Daily | 14 | 14.1 | 15.3 | 16.7 |\n| 6 days/week | 13.3 | 13.4 | 14.5 | 15.8 |\n| 5 days/week | 12.3 | 12.5 | 13.5 | 14.8 |\n| 4 days/week | 11.1 | 11.2 | 12.1 | 13.3 |\n| 3 days/week | 9.5 | 9.6 | 10.5 | 11.6 |\n| 2 days/week | 7 | 7.1 | 7.8 | 8.8 |\n| 1 day/week | 4.1 | 4.1 | 4.7 | 5.4 |",
      table_title:
        "Number of standard drinks per week associated with alternative lifetime mortality risk thresholds, depending on number of days alcohol is consumed per week",
    },
    mimeType: "image/png",
    pageNumber: 4,
    sourceKind: "table_crop",
    width: 1403,
  },
  {
    bbox: [0, 0, 595.28, 841.89],
    height: 679,
    metadata: {
      bbox: [0, 0, 595.28, 841.89],
      candidate_type: "document_cover",
      clinical_use_class: "decorative_or_empty",
      pageNumber: 1,
      page_height: 841.89,
      page_rotation: 0,
      page_width: 595.28,
      render_dpi: 58,
      render_scale: 0.806,
      source_kind: "cover_page",
      source_regions: [{ bbox: [0, 0, 595.28, 841.89], page_number: 1, source_kind: "cover_page" }],
    },
    mimeType: "image/png",
    pageNumber: 1,
    sourceKind: "cover_page",
    width: 480,
  },
];

type UnitId = GenerationUnitDeclaration["id"];
export type ManagedPreparedSupplierInput = {
  issued: IssuedAttemptControl;
  job: JobRow;
  extracted: ExtractedDocument;
  retentionPacket: ReturnType<typeof buildGenerationRetentionPacket>;
  originalBytes: Buffer;
  witnessBytes: Buffer;
  /** Actual current worker configuration; these labels do not imply provider work. */
  embeddingModel: string;
  indexingVersion: string;
  /** Independently authored declarations; never inferred from prepared output bodies. */
  independentSourceRoles?: WholeOriginalRoleRequirements;
  /** Explicit local, pre-vector deep-memory preparation; absent preserves the existing packet. */
  includeLocalMemory?: boolean;
};
const refuse = (reason: string): never => {
  throw new Error(`managed_prepared_supplier_${reason}`);
};
const cleanString = (value: string) =>
  value
    .replace(/\u0000/g, "")
    .replace(/\\u0000/g, "")
    .toWellFormed();
function sanitize(value: unknown): unknown {
  if (typeof value === "string") return cleanString(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v)]));
  return value;
}
const sanitizeJsonbRecord = (value: unknown) => sanitize(value) as Record<string, unknown>;
const unique = (refs: UnitId[]) => [...new Map(refs.map((ref) => [JSON.stringify(ref), ref])).values()];
function planningId(documentId: string, generationId: string, family: string, ordinal: number) {
  const bytes = createHash("sha256")
    .update(generationEvidenceBytes(["managed-private-preparation-v1", documentId, generationId, family, ordinal]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 0x50;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const neutralTableMetadataSchema = z
  .object({
    candidate_type: z.literal("table"),
    source_kind: z.literal("table_crop"),
    extraction_method: z.literal("pymupdf_find_tables"),
    pageNumber: z.number().int().positive(),
    table_index: z.number().int().positive(),
    table_rows: z
      .array(z.array(z.string().max(240)).max(24))
      .min(2)
      .max(400),
    table_columns: z.array(z.string().min(1).max(80)).min(1).max(24),
    row_count: z.number().int().positive(),
    column_count: z.number().int().positive(),
    rows_truncated: z.literal(false),
    table_role: z.literal("unclear").nullable(),
    table_title: z.null(),
    table_label: z.null(),
    table_text: z.string().max(24000),
    accessible_table_markdown: z.string().max(24000),
  })
  .passthrough();

/** Only invokes local body builders. The checked plan always retains the supplier's blocking evidence. */
export function prepareManagedPrivateSupplier(args: ManagedPreparedSupplierInput) {
  if (
    !args ||
    typeof args !== "object" ||
    types.isProxy(args) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(args))
  )
    refuse("plain_arguments_required");
  const properties = Object.getOwnPropertyDescriptors(args);
  const keys = [
    "issued",
    "job",
    "extracted",
    "retentionPacket",
    "originalBytes",
    "witnessBytes",
    "embeddingModel",
    "indexingVersion",
  ];
  if (
    keys.some((key) => !Object.hasOwn(properties, key)) ||
    Reflect.ownKeys(properties).some(
      (key) =>
        typeof key !== "string" ||
        (!keys.includes(key) && key !== "independentSourceRoles" && key !== "includeLocalMemory") ||
        !Object.hasOwn(properties[key], "value") ||
        !properties[key].enumerable,
    )
  )
    refuse("plain_arguments_required");
  // Data-only validation also prevents caller-owned accessors from acting as producers.
  const dataBytes = generationEvidenceBytes({
    issued: args.issued,
    job: args.job,
    extracted: args.extracted,
    retentionPacket: args.retentionPacket,
    embeddingModel: args.embeddingModel,
    indexingVersion: args.indexingVersion,
    ...(args.independentSourceRoles === undefined ? {} : { independentSourceRoles: args.independentSourceRoles }),
    ...(args.includeLocalMemory === undefined ? {} : { includeLocalMemory: args.includeLocalMemory }),
  });
  if (dataBytes.length > 32 * 1024 * 1024) refuse("input_budget_exceeded");
  const data = JSON.parse(dataBytes.toString("utf8")) as Omit<
    ManagedPreparedSupplierInput,
    "originalBytes" | "witnessBytes"
  >;
  const { issued, job, extracted, retentionPacket: packet } = data;
  if (data.includeLocalMemory !== undefined && typeof data.includeLocalMemory !== "boolean")
    refuse("local_memory_option_invalid");
  const expectation = parseSourceExpectation(packet.registration.sourceExpectation);
  const witness = expectation.witness;
  if (expectation.tag !== "known" || !witness || !Buffer.isBuffer(args.witnessBytes))
    return refuse("known_retained_witness_required");
  if (extracted.pages.length > 256 || extracted.images.length > 256 || !data.embeddingModel || !data.indexingVersion)
    refuse("input_budget_exceeded");
  if (extracted.pages.reduce((total, page) => total + Buffer.byteLength(page.text, "utf8"), 0) > 1024 * 1024)
    refuse("input_budget_exceeded");
  if (
    job.id !== issued.jobId ||
    job.document_id !== issued.documentId ||
    job.documents.id !== issued.documentId ||
    job.lease_write_generation_id !== issued.generationId ||
    job.lease_authority_digest !== issued.authorityDigest ||
    job.lease_token !== issued.firstLeaseToken ||
    job.locked_by !== issued.workerId ||
    job.attempt_count !== issued.attemptNumber ||
    job.batch_id !== issued.batchId ||
    job.lease_expected_generation_id !== issued.predecessorGenerationId ||
    !job.documents.owner_id
  )
    refuse("current_job_identity_mismatch");
  const roles: WholeOriginalRoleRequirements = {
    version: "whole-original-source-roles-v1",
    sourceSha256: expectation.sourceSha256,
    witnessSha256: witness.sha256,
    sourceExpectationDigest: packet.registration.sourceExpectationSha256,
    requirements: [],
    capabilities: { captureApplicability: "unknown", summary: "pending", model: "unavailable", deepMemory: "pending" },
  };
  // Validates genuine original/witness bytes, retained control and complete retained graph before any builders.
  const checked = prepareWholeOriginalSupplier({
    originalBytes: args.originalBytes,
    witnessBytes: args.witnessBytes,
    sourceExpectation: expectation,
    issued,
    retentionPacket: packet,
    roleRequirements: roles,
    producerManifests: [],
  });
  if (!checked.blockers.includes("source_roles_uncovered")) refuse("independent_source_roles_unavailable");
  const captured = retainedCandidateImages(packet);
  const fourPagePilot = packet.registration.sourceSha256 === FOUR_PAGE_SOURCE;
  if (
    fourPagePilot &&
    (args.originalBytes.length !== 2211561 ||
      `sha256:${createHash("sha256").update(args.originalBytes).digest("hex")}` !== FOUR_PAGE_SOURCE ||
      packet.registration.sourceExpectationSha256 !== FOUR_PAGE_EXPECTATION ||
      extracted.pages.length !== 4 ||
      extracted.pages.some(
        (page, index) =>
          page.pageNumber !== FOUR_PAGE_PAGES[index].pageNumber ||
          page.ocrUsed === true ||
          page.text !== FOUR_PAGE_PAGES[index].text,
      ) ||
      captured.length !== FOUR_PAGE_DESCRIPTORS.length ||
      captured.some(
        (capture, index) =>
          generationEvidenceDigest(capture.descriptor) !== generationEvidenceDigest(FOUR_PAGE_DESCRIPTORS[index]),
      ) ||
      captured[0].descriptor.sourceKind !== "table_crop" ||
      captured[0].binary.sha256 !== "sha256:fd7a4d16b41d1856e64759540ce37cf55bc90b247f50424643cdc3c01fc3a14f" ||
      captured[0].binary.byteLength !== 104496 ||
      captured[1].binary.sha256 !== "sha256:d87d4f2ee4298465e7c91416fa764bd4b34f960c8967fbfcf256f6117dd9530d" ||
      captured[1].binary.byteLength !== 62808)
  )
    refuse("four_page_native_profile_mismatch");
  if (
    captured.length !== extracted.images.length ||
    new Set(extracted.pages.map((p) => p.pageNumber)).size !== extracted.pages.length ||
    packet.artifacts.filter((a) => a.representation === "extracted_utf8").length !== extracted.pages.length
  )
    refuse("extraction_population_mismatch");
  for (const page of extracted.pages) {
    const retained = packet.artifacts.find(
      (a) => a.unitId.family === "private_objects" && a.unitId.key === `page:${page.pageNumber}:extracted`,
    );
    const provenance = packet.artifacts.find(
      (a) => a.unitId.family === "private_objects" && a.unitId.key === `page:${page.pageNumber}:original-provenance`,
    );
    const projection = packet.artifacts.find(
      (a) => a.unitId.family === "pages" && a.unitId.key === String(page.pageNumber),
    );
    if (
      !retained ||
      retained.bytesHex !== Buffer.from(page.text, "utf8").toString("hex") ||
      !provenance ||
      provenance.bytesHex !== generationEvidenceBytes(page.metadata ?? {}).toString("hex") ||
      !projection ||
      JSON.parse(Buffer.from(projection.bytesHex, "hex").toString("utf8")).ocr_used !== Boolean(page.ocrUsed)
    )
      refuse("extracted_page_bytes_mismatch");
  }
  const imageRows = captured.map((capture) => {
    const extractedImage = extracted.images[capture.ordinal - 1];
    if (
      !extractedImage ||
      capture.documentId !== issued.documentId ||
      capture.sourceEvidenceIds.length ||
      generationEvidenceDigest(capture.descriptor) !==
        generationEvidenceDigest(Object.fromEntries(Object.entries(extractedImage).filter(([key]) => key !== "path")))
    )
      refuse("image_capture_mismatch");
    if (capture.descriptor.pageNumber === null || capture.descriptor.sourceKind === undefined)
      refuse("image_placement_unavailable");
    return candidateImageRowSchema.parse({
      id: planningId(issued.documentId, issued.generationId, "images", capture.ordinal),
      document_id: issued.documentId,
      owner_id: job.documents.owner_id,
      index_generation_id: issued.generationId,
      page_number: capture.descriptor.pageNumber,
      capture_ordinal: capture.ordinal,
      caption: null,
      image_type: null,
      labels: null,
      clinical_relevance_score: null,
      source_kind: capture.descriptor.sourceKind,
      descriptor: capture.descriptor,
      metadata: capture.descriptor.metadata ?? {},
    });
  });
  // Covers remain retained private artifacts; they are not content derivation inputs for prose chunks.
  const imageInputs = imageRows
    .filter((row) => row.source_kind !== "cover_page")
    .map((row) => {
      const base = {
        id: row.id,
        pageNumber: row.page_number,
        sourceKind: row.source_kind,
        caption: "",
        metadata: row.metadata,
      };
      const metadata = row.metadata;
      const structural =
        metadata.candidate_type === "table" ||
        ["table_rows", "table_columns", "accessible_table_markdown"].some((key) => Object.hasOwn(metadata, key));
      // This exact admitted pilot preserves the native table in the captured image and full literal page.
      // No relational fact producer is claimed for its two-tier risk headers.
      if (fourPagePilot) return base;
      if (!structural) return base;
      const result = neutralTableMetadataSchema.safeParse(metadata);
      if (!result.success || row.source_kind !== "table_crop") return refuse("native_table_shape_unavailable");
      const table = result.data;
      if (
        table.pageNumber !== row.page_number ||
        table.row_count !== table.table_rows.length ||
        table.column_count !== table.table_columns.length ||
        table.table_rows.some((cells) => cells.length !== table.table_columns.length) ||
        generationEvidenceDigest(table.table_rows[0]) !== generationEvidenceDigest(table.table_columns) ||
        generationEvidenceDigest(table.table_columns) !==
          generationEvidenceDigest(["Scenario", "Concentration", "Amount", "Volume", "Interval"])
      )
        return refuse("native_table_shape_unavailable");
      return {
        ...base,
        tableRows: table.table_rows,
        tableColumns: table.table_columns,
        tableTitle: table.table_title,
        tableLabel: table.table_label,
        tableRole: table.table_role,
        tableTextSnippet: table.table_text.replace(/\s+/g, " ").trim(),
        accessibleTableMarkdown: table.accessible_table_markdown,
      };
    });
  if (imageInputs.reduce((total, image) => total + ("tableRows" in image ? image.tableRows.length : 0), 0) > 400)
    refuse("input_budget_exceeded");
  const chunks = buildChunks(
    extracted.pages.map((page) => ({
      documentId: issued.documentId,
      pageNumber: page.pageNumber,
      pageText: page.text,
      images: imageInputs.filter((image) => image.pageNumber === page.pageNumber),
      metadata: {
        source_path: job.documents.source_path ?? null,
        content_hash: job.documents.content_hash ?? null,
        index_generation_id: issued.generationId,
        embedding_model: data.embeddingModel,
        extractor: "local-worker",
        rag_indexing_version: data.indexingVersion,
        rag_memory_version: data.indexingVersion,
        ocr_used: Boolean(page.ocrUsed),
      },
    })),
  );
  const ordinaryChunkRows = serializeCandidateChunkRows(chunks, {
    documentId: issued.documentId,
    generationId: issued.generationId,
    cleanString,
    sanitizeJsonbRecord,
  });
  const chunkRows = fourPagePilot
    ? extracted.pages.map((page, index) =>
        preparedRowSchema.parse({
          id: candidateChunkId(issued.documentId, issued.generationId, index),
          document_id: issued.documentId,
          index_generation_id: issued.generationId,
          page_number: page.pageNumber,
          chunk_index: index,
          section_heading: null,
          section_path: [],
          heading_level: null,
          parent_heading: null,
          anchor_id: null,
          content: page.text,
          retrieval_synopsis: null,
          token_estimate: Math.ceil(Buffer.byteLength(page.text, "utf8") / 3),
          image_ids: imageRows
            .filter((image) => image.page_number === page.pageNumber && image.source_kind !== "cover_page")
            .map((image) => image.id),
          content_hash: createHash("sha256").update(page.text, "utf8").digest("hex"),
          metadata: {
            source_path: job.documents.source_path ?? null,
            content_hash: job.documents.content_hash ?? null,
            index_generation_id: issued.generationId,
            embedding_model: data.embeddingModel,
            extractor: "literal-four-page-native-pdf-v1",
            rag_indexing_version: data.indexingVersion,
            rag_memory_version: data.indexingVersion,
            ocr_used: false,
            parent_physical_page: [9, 10, 11, 62][index],
            parent_printed_page: ["4", "5", "6", "57"][index],
          },
        }),
      )
    : ordinaryChunkRows;
  // Empty optional output is intentional for this adapter, not evidence of original table absence.
  const tableFacts = fourPagePilot ? [] : buildTableFactRows({ job, chunkRows, insertedImages: imageInputs });
  const tableFactRows = tableFacts.map((fact, ordinal) => {
    if (
      !fact.source_chunk_id ||
      !chunkRows.some(
        (chunk) =>
          chunk.id === fact.source_chunk_id &&
          chunk.page_number === fact.page_number &&
          chunk.image_ids.includes(fact.source_image_id),
      ) ||
      fact.threshold_value !== null ||
      fact.action !== null
    )
      return refuse("native_table_parent_unavailable");
    return candidateTableFactRowSchema.parse({
      ...fact,
      id: planningId(issued.documentId, issued.generationId, "table_facts", ordinal),
      index_generation_id: issued.generationId,
      table_title: fact.table_title ?? null,
      clinical_parameter: fact.clinical_parameter ?? null,
      metadata: sanitizeJsonbRecord({ ...fact.metadata, index_generation_id: issued.generationId }),
    });
  });
  // The ordinary producer compacts/deduplicates cells. A supported neutral projection must remain exact,
  // rather than allowing those changes to select the visual builder's generic clinical fallback.
  for (const image of imageInputs) {
    if (!("tableRows" in image)) continue;
    const facts = tableFactRows.filter((fact) => fact.source_image_id === image.id);
    const expected = image.tableRows.slice(1);
    if (
      facts.length !== expected.length ||
      expected.some((cells, ordinal) => {
        const fact = facts[ordinal];
        return (
          fact.metadata.row_index !== ordinal + 1 ||
          generationEvidenceDigest(fact.metadata.columns) !== generationEvidenceDigest(image.tableColumns) ||
          generationEvidenceDigest(fact.metadata.cells) !== generationEvidenceDigest(cells) ||
          fact.row_label !== cells[0] ||
          fact.clinical_parameter !== cells[0] ||
          fact.page_number !== image.pageNumber ||
          fact.threshold_value !== null ||
          fact.action !== null
        );
      })
    )
      return refuse("native_table_population_changed");
  }
  const document = {
    id: issued.documentId,
    owner_id: job.documents.owner_id,
    title: job.documents.title,
    file_name: job.documents.file_name,
  };
  const visualUnits = fourPagePilot
    ? []
    : buildVisualDocumentIndexUnitInputs({
        document,
        chunks: chunkRows,
        images: imageInputs,
        tableFacts: tableFactRows,
      });
  const deterministicUnits = fourPagePilot ? [] : buildDocumentIndexUnitInputs({ document, chunks: chunkRows });
  const fingerprints = chunks.map((chunk) => createHash("sha256").update(chunk.content).digest("hex"));
  const qualityHint = {
    duplicateChunkRatio: Number((chunks.length ? 1 - new Set(fingerprints).size / chunks.length : 0).toFixed(3)),
    headingDensity: Number(
      (chunks.length ? chunks.filter((chunk) => chunk.section_heading).length / chunks.length : 0).toFixed(3),
    ),
  };
  const fields = fourPagePilot
    ? []
    : buildAdditionalEmbeddingFieldInputs({
        job,
        chunkRows,
        insertedImages: imageInputs,
        tableFacts: tableFactRows,
        qualityHint,
      });
  const links = (body: Record<string, unknown>): UnitId[] => {
    const refs: UnitId[] = [];
    const metadata = body.metadata as Record<string, unknown> | undefined;
    for (const record of [body, metadata ?? {}])
      for (const [property, family] of [
        ["source_chunk_id", "chunks"],
        ["source_image_id", "images"],
      ] as const)
        if (typeof record[property] === "string") refs.push({ family, key: record[property] as string });
    for (const [property, family] of [
      ["source_chunk_ids", "chunks"],
      ["source_image_ids", "images"],
      ["chunk_ids", "chunks"],
    ] as const)
      for (const key of (metadata?.[property] ?? []) as string[]) refs.push({ family, key });
    for (const key of (body.image_ids ?? []) as string[]) refs.push({ family: "images", key });
    return unique(refs);
  };
  const manifest = (
    family: "chunks" | "images" | "table_facts" | "index_units" | "embedding_fields",
    bodies: Record<string, unknown>[],
  ) => {
    const units: WholeOriginalProducerAssemblyInput["units"] = bodies.map((body, ordinal) => {
      const key =
        typeof body.id === "string" ? body.id : planningId(issued.documentId, issued.generationId, family, ordinal);
      let dependencies = links(body);
      if (
        family === "embedding_fields" &&
        (body.metadata as Record<string, unknown>).source === "document_table_facts"
      ) {
        const metadata = body.metadata as Record<string, unknown>;
        // Ordinary field metadata identifies a consumed table population, not a unique native row.
        // Retain every actual metadata-compatible input parent without manufacturing a row ordinal.
        const parents = tableFactRows.filter(
          (fact) =>
            fact.source_chunk_id === body.source_chunk_id &&
            fact.source_image_id === metadata.source_image_id &&
            fact.table_title === metadata.table_title &&
            fact.page_number === metadata.page_number,
        );
        if (!parents.length) return refuse("native_table_parent_unavailable");
        dependencies = unique([
          ...dependencies,
          ...parents.map((fact) => ({ family: "table_facts" as const, key: fact.id })),
        ]);
      }
      if (family === "index_units" && body.unit_type === "table_fact") {
        const metadata = body.metadata as Record<string, unknown>;
        const parents = tableFactRows.filter(
          (fact) =>
            fact.source_image_id === body.source_image_id &&
            fact.source_chunk_id === body.source_chunk_id &&
            fact.metadata.row_index === metadata.row_index &&
            generationEvidenceDigest(fact.metadata.columns) === generationEvidenceDigest(metadata.columns) &&
            generationEvidenceDigest(fact.metadata.cells) === generationEvidenceDigest(metadata.cells) &&
            generationEvidenceDigest(metadata.named_cells) ===
              generationEvidenceDigest(
                (fact.metadata.columns as string[]).map((column, index) => ({
                  column,
                  cell: (fact.metadata.cells as string[])[index],
                })),
              ) &&
            generationEvidenceDigest(fact.metadata) === generationEvidenceDigest(metadata.table_fact_metadata),
        );
        if (parents.length !== 1) return refuse("native_table_parent_unavailable");
        dependencies = unique([...dependencies, { family: "table_facts", key: parents[0].id }]);
      }
      if (family === "images")
        dependencies = [{ family: "private_objects", key: `image:${body.capture_ordinal}:binary` }];
      if (family === "chunks")
        dependencies = unique([
          ...dependencies,
          ...extracted.pages.flatMap((page) => [
            { family: "private_objects" as const, key: `page:${page.pageNumber}:extracted` },
            { family: "private_objects" as const, key: `page:${page.pageNumber}:original-provenance` },
          ]),
        ]);
      const auxiliary = family === "images" && body.source_kind === "cover_page";
      return {
        declaration: {
          id: { family, key },
          groupKey: "worker_core",
          required: family === "chunks",
          dependencies,
          sourceEvidenceIds: [],
          qualification: "derived_unverified",
          representation: "provenance_json",
        },
        body,
        artifactLocator: `prepared:${family}:${key}`,
        providerInputText:
          family === "chunks" || family === "embedding_fields"
            ? (body.content as string)
            : family === "index_units"
              ? embeddingTextForDocumentIndexUnit(body as DocumentIndexUnitInput)
              : null,
        inputReferences: dependencies,
        originalReferences: [],
        auxiliary,
      };
    });
    return assembleWholeOriginalProducerManifest({
      state: "prepared",
      group: {
        family,
        groupKey: "worker_core",
        declaration: {
          producer: { name: `managed-local-prepared-${family}`, version: "managed-private-preparation-v1" },
          artifactGenerationId: null,
          population: {
            tag: "known",
            expectedUnits: units.map((unit) => unit.declaration.id),
            basis: [
              {
                reference:
                  fourPagePilot && ["table_facts", "index_units", "embedding_fields"].includes(family)
                    ? "four-page native adapter emitted empty optional population; further enrichment not implemented"
                    : "actual invoked local prepared output population only",
                sha256: generationEvidenceDigest(bodies),
              },
            ],
            reason: units.length ? null : "no_units_expected",
          },
        },
      },
      units,
    });
  };
  const indexUnits = [...deterministicUnits, ...visualUnits].map((unit) => ({
    ...unit,
    metadata: sanitizeJsonbRecord({ ...unit.metadata, index_generation_id: issued.generationId }),
  }));
  const fieldRows = fields.map((field) => ({
    ...field,
    content: cleanString(field.content),
    metadata: sanitizeJsonbRecord({ ...field.metadata, index_generation_id: issued.generationId }),
  }));
  let manifests = [
    manifest("images", imageRows),
    manifest("chunks", chunkRows),
    manifest("table_facts", tableFactRows),
    manifest("index_units", indexUnits),
    manifest("embedding_fields", fieldRows),
  ];
  let finalRoles = roles;
  if (data.independentSourceRoles !== undefined) {
    // The core owns contract and identity validation. This preliminary check grants no source authority.
    finalRoles = prepareWholeOriginalSupplier({
      originalBytes: args.originalBytes,
      witnessBytes: args.witnessBytes,
      sourceExpectation: expectation,
      issued,
      retentionPacket: packet,
      roleRequirements: data.independentSourceRoles,
      producerManifests: manifests,
    }).roleRequirements;
    // Assemblies are frozen evidence. Project into a separate data-only copy, then reassemble.
    manifests = JSON.parse(generationEvidenceBytes(manifests).toString("utf8")) as typeof manifests;
    const sourceUnits = new Map((expectation.units ?? []).map((unit) => [unit.id, unit]));
    const referenceClosure = (ids: string[]) => {
      const seen = new Set<string>();
      const visit = (id: string) => {
        if (seen.has(id)) return;
        const source = sourceUnits.get(id);
        if (!source) return refuse("independent_source_reference_unavailable");
        seen.add(id);
        source.dependencies.forEach(visit);
      };
      ids.forEach(visit);
      return [...seen];
    };
    const units = manifests.flatMap((manifest) => manifest.units);
    const locate = (id: UnitId) => {
      const unit = units.find(
        (candidate) => generationEvidenceDigest(candidate.declaration.id) === generationEvidenceDigest(id),
      );
      if (!unit || unit.auxiliary) return refuse("independent_candidate_unavailable");
      return unit;
    };
    const associate = (id: UnitId, sourceIds: string[]) => {
      const unit = locate(id);
      unit.originalReferences = referenceClosure([...unit.originalReferences, ...sourceIds]);
      if (id.family === "chunks") {
        const page = (unit.body as Record<string, unknown>).page_number;
        const pageRef: UnitId = { family: "pages", key: String(page) };
        if (
          !packet.artifacts.some(
            (artifact) => generationEvidenceDigest(artifact.unitId) === generationEvidenceDigest(pageRef),
          )
        )
          return refuse("independent_page_unavailable");
        unit.declaration.dependencies = unique([...unit.declaration.dependencies, pageRef]);
        unit.inputReferences = unique([...unit.inputReferences, pageRef]);
      }
      return unit;
    };
    for (const role of finalRoles.requirements)
      for (const id of role.candidateUnits) {
        const unit = locate(id);
        const page = (unit.body as Record<string, unknown>).page_number;
        if (
          id.family === "chunks" &&
          !role.evidence.every(
            (evidence) =>
              evidence.unitId.family === "private_objects" &&
              [`page:${page}:extracted`, `page:${page}:persisted`].includes(evidence.unitId.key),
          )
        )
          return refuse("independent_same_page_chunk_required");
        associate(id, [role.sourceEvidenceId]);
      }
    for (const binding of finalRoles.tableRows ?? []) {
      const originalIds = [
        binding.sourceEvidenceId,
        ...binding.qualifications.map((qualification) => qualification.sourceEvidenceId),
      ];
      associate({ family: "chunks", key: binding.sourceChunkId }, [binding.sourceEvidenceId]);
      const qualifierRefs = binding.qualifications.map((qualification) => {
        const ref: UnitId = { family: "chunks", key: qualification.chunkId };
        associate(ref, [qualification.sourceEvidenceId]);
        return ref;
      });
      for (const ref of [binding.tableFactUnitId, binding.candidateUnitId]) {
        const unit = associate(ref, originalIds);
        unit.declaration.dependencies = unique([...unit.declaration.dependencies, ...qualifierRefs]);
        unit.inputReferences = unique([...unit.inputReferences, ...qualifierRefs]);
      }
    }
    // Field metadata names a consumed population, not a unique row. Propagate only through its real fact parents.
    for (const unit of units.filter((unit) => unit.declaration.id.family === "embedding_fields")) {
      const parentReferences = unit.inputReferences
        .filter((ref) => ref.family === "table_facts")
        .flatMap((ref) => locate(ref).originalReferences);
      if (parentReferences.length) associate(unit.declaration.id, parentReferences);
    }
    manifests = manifests.map((manifest) => {
      const { outputManifestDigest, ...producer } = manifest.group.declaration.producer;
      void outputManifestDigest;
      return assembleWholeOriginalProducerManifest({
        state: manifest.state,
        group: { ...manifest.group, declaration: { ...manifest.group.declaration, producer } },
        units: manifest.units.map((unit) => ({
          declaration: unit.declaration,
          body: unit.body,
          artifactLocator: unit.artifact.locator,
          providerInputText: unit.providerInputText,
          inputReferences: unit.inputReferences,
          originalReferences: unit.originalReferences,
          auxiliary: unit.auxiliary,
        })),
      });
    });
  }
  if (data.includeLocalMemory && !fourPagePilot) {
    const local = prepareManagedLocalMemoryProducer({
      document: {
        id: job.documents.id,
        owner_id: job.documents.owner_id,
        title: job.documents.title,
        file_name: job.documents.file_name,
        source_path: job.documents.source_path ?? null,
        metadata: job.documents.metadata,
      },
      issued,
      coreUnits: manifests.flatMap((manifest) => manifest.units),
    });
    for (const [family, rows] of [
      ["sections", local.sections],
      ["memory_cards", local.memoryCards],
      ["index_units", local.indexUnits],
    ] as const) {
      manifests.push(
        assembleWholeOriginalProducerManifest({
          state: "prepared",
          group: {
            family,
            groupKey: "deep_memory",
            declaration: {
              producer: { name: `managed-local-prepared-${family}`, version: "managed-local-memory-v1" },
              artifactGenerationId: null,
              population: {
                tag: "known",
                expectedUnits: rows.map((row) => row.planningId),
                basis: [
                  {
                    reference: "actual invoked pre-vector local builder outputs only; not whole-original applicability",
                    sha256: generationEvidenceDigest(rows.map((row) => row.body)),
                  },
                ],
                reason: rows.length ? null : "no_units_expected",
              },
            },
          },
          units: rows.map((row) => ({
            declaration: {
              id: row.planningId,
              groupKey: "deep_memory",
              required: false,
              dependencies: row.dependencies,
              sourceEvidenceIds: [],
              qualification: "derived_unverified",
              representation: "provenance_json",
            },
            body: row.body,
            artifactLocator: `prepared:${family}:${row.planningId.key}`,
            providerInputText: null,
            inputReferences: row.dependencies,
            originalReferences: [],
            auxiliary: false,
          })),
        }),
      );
    }
  }
  if (generationEvidenceBytes(manifests).length > 2 * 1024 * 1024) refuse("prepared_budget_exceeded");
  return prepareWholeOriginalSupplier({
    originalBytes: args.originalBytes,
    witnessBytes: args.witnessBytes,
    sourceExpectation: expectation,
    issued,
    retentionPacket: packet,
    roleRequirements: finalRoles,
    producerManifests: manifests,
  });
}

/** Injected fenced transport is owned by the current caller; this function creates no provider client. */
export async function runManagedPrivateSupplier(args: {
  input: ManagedPreparedSupplierInput;
  currentInventory: unknown;
  mutation: (name: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  check: () => void;
}) {
  args.check();
  const plan = prepareManagedPrivateSupplier(args.input);
  if (
    args.input.independentSourceRoles !== undefined &&
    (plan.blockers.includes("source_roles_uncovered") ||
      plan.retainedLiteralAvailability.some((literal) => literal.status === "missing_literal") ||
      plan.preparedCandidateCoverage.some((coverage) => coverage.status === "missing_literal") ||
      plan.declaredTableAssociations?.status === "incomplete_derived_association")
  )
    refuse("independent_association_incomplete");
  const ownerId = args.input.job.documents.owner_id!;
  generationEvidenceBytes(args.currentInventory);
  canDeferOptionalProducerDeclarations(args.currentInventory);
  const inventory = args.currentInventory as Record<string, unknown>;
  const identity = {
    version: 1,
    documentId: plan.issued.documentId,
    generationId: plan.issued.generationId,
    jobId: plan.issued.jobId,
    firstLeaseToken: plan.issued.firstLeaseToken,
    authorityDigest: plan.issued.authorityDigest,
    predecessorGenerationId: plan.issued.predecessorGenerationId,
    sourceSha256: plan.source.sha256,
    sourceByteLength: plan.source.byteLength,
    sourceExpectationDigest: plan.retentionPacket.registration.sourceExpectationSha256,
  };
  if (
    Object.entries(identity).some(([key, value]) => inventory[key] !== value) ||
    generationEvidenceDigest(inventory.registration) !== generationEvidenceDigest(plan.retentionPacket.registration)
  )
    refuse("current_inventory_identity_mismatch");
  const groups = inventory.groups as Array<{ family: string; groupKey: string; state: string; declaration: unknown }>;
  if (groups.length !== generationEvidenceSlots.length) refuse("current_inventory_population_mismatch");
  const declaredGroups = groups
    .filter((group) => group.state === "declared")
    .map(({ state, ...group }) => {
      void state;
      return group;
    });
  const current = parseGenerationDeclarations({ version: 1, groups: declaredGroups, units: inventory.units });
  for (const group of current.groups) {
    const planned = plan.declarations.groups.find((g) => g.family === group.family && g.groupKey === group.groupKey);
    if (!planned || generationEvidenceDigest(planned) !== generationEvidenceDigest(group))
      refuse("current_inventory_declaration_conflict");
  }
  for (const unit of current.units) {
    const planned = plan.declarations.units.find(
      (u) => generationEvidenceDigest(u.id) === generationEvidenceDigest(unit.id),
    );
    if (!planned || generationEvidenceDigest(planned) !== generationEvidenceDigest(unit))
      refuse("current_inventory_declaration_conflict");
  }
  args.check();
  const staged = await stageWholeOriginalSupplier({ plan, mutation: args.mutation, check: args.check });
  args.check();
  const readback = await readWholeOriginalSupplier({
    expected: plan,
    ownerId,
    mutation: args.mutation,
    check: args.check,
  });
  args.check();
  return { plan, staged, readback };
}
