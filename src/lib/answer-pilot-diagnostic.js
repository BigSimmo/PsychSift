import { createHash, randomUUID } from "node:crypto";

// Private finite licensed-pilot diagnostic only. Never log prompt/context, request
// metadata, errors, headers or the complete answer object. No client activation.
const OWNER = "3ea89594-b3a1-46b7-b570-33c198ce5524";
const DOCUMENT = "d69a6b9c-3e80-556a-b887-53d209238293";
const QUERY = "83ac78d0637271b2162b3bc45d884fb08f6b5471833e96f47bd844e36ba55591";
const LICENSED_CHUNKS = Object.freeze({
  "b58ce314-0deb-572a-b9f3-4dd1f854f808": "b87e0fff2cccc397eda991cb04a0ef0eb3140cad034cf6f8c21fa241478f7129",
  "d910494d-5850-558b-9c0f-1e0f7a5f8869": "f012e0656fc311fdd4a1c61285bc581c91dbef93070329b01b74f4e041000b69",
  "18dc8271-fa21-5f7f-bcf8-5bad7d59c652": "85db0b8bffcfa0edbb7c9247823acd2c73869470e2b5f74f6dbff4e43cfdc20d",
  "9f53153b-be1b-5247-9e5e-e9ca99da9cdc": "c7bbc2c72340f53f073b8416e6c5696db1f7bc7a5065ef4d6255a229ed748189",
  "2b86f224-148f-54ce-99bb-caba6489789f": "26be9b715bd1a419e6fb4d9fefe5f65a66358f750abcbc2a6bcd2b0447fe96b1",
  "b89bcb03-8d9a-5a79-a8c4-e6371b9c21a2": "f7b87e96c9f088fdab9a522a1156fdc446efb8b6a43605a3e81c6ffa6befbcbc",
});
const APPROVED_GENERATION = {
  title: "NHMRC Australian Alcohol Guidelines Approved Summary TXT",
  file_name: "source.txt",
  governance: {
    document_status: "current",
    clinical_validation_status: "unverified",
    extraction_quality: "good",
  },
  indexIssues: [],
  chunks: {
    "b58ce314-0deb-572a-b9f3-4dd1f854f808": {
      page_number: 1,
      chunk_index: 0,
      section_heading: null,
      section_path: [],
      parent_heading: null,
      anchor_id: null,
      retrieval_synopsis: null,
    },
    "d910494d-5850-558b-9c0f-1e0f7a5f8869": {
      page_number: 1,
      chunk_index: 1,
      section_heading: "Guideline 1: Adults",
      section_path: ["Guideline 1: Adults"],
      parent_heading: null,
      anchor_id: null,
      retrieval_synopsis: null,
    },
    "18dc8271-fa21-5f7f-bcf8-5bad7d59c652": {
      page_number: 1,
      chunk_index: 2,
      section_heading: null,
      section_path: [],
      parent_heading: null,
      anchor_id: null,
      retrieval_synopsis: null,
    },
    "9f53153b-be1b-5247-9e5e-e9ca99da9cdc": {
      page_number: 1,
      chunk_index: 3,
      section_heading: "Guideline 2: Children and people under \n18 years of age",
      section_path: ["Guideline 2: Children and people under \n18 years of age"],
      parent_heading: null,
      anchor_id: null,
      retrieval_synopsis: null,
    },
    "2b86f224-148f-54ce-99bb-caba6489789f": {
      page_number: 1,
      chunk_index: 4,
      section_heading: "Guideline 3: Women who are pregnant \nor breastfeeding",
      section_path: ["Guideline 3: Women who are pregnant \nor breastfeeding"],
      parent_heading: null,
      anchor_id: null,
      retrieval_synopsis: null,
    },
    "b89bcb03-8d9a-5a79-a8c4-e6371b9c21a2": {
      page_number: 1,
      chunk_index: 5,
      section_heading: null,
      section_path: [],
      parent_heading: null,
      anchor_id: null,
      retrieval_synopsis: null,
    },
  },
  cards: {
    "dd6900f9-efde-4de1-ae5f-5a11678e390e": {
      card_type: "section_summary",
      contentSha256: "f5d99f0749140a5ce8d28b07e72df50a70c81cc0759dafb719274764b69789b7",
      source_chunk_ids: ["d910494d-5850-558b-9c0f-1e0f7a5f8869"],
    },
    "7d7bd6a0-dbe0-4882-b598-ee381f52d435": {
      card_type: "section_summary",
      contentSha256: "3d500b8152978e31f352199dae2b60a54d6b3f0aada708c28bdb4ead9f65db81",
      source_chunk_ids: ["9f53153b-be1b-5247-9e5e-e9ca99da9cdc"],
    },
    "8bae4159-86ee-49b2-8816-b452ccca9680": {
      card_type: "section_summary",
      contentSha256: "30d8423cb3dcfca08b39b44e75ebea3d92bde4a0c82f5156d66f0beba0c6d523",
      source_chunk_ids: ["2b86f224-148f-54ce-99bb-caba6489789f"],
    },
  },
};
const TOTAL_BYTES = 262144;
const LINE_BYTES = 2000;
const PREFIX = "answer_pilot_diagnostic_v1 ";
const STAGES = new Set([
  "generation.return",
  "parse.before",
  "parse.after",
  "parse.error",
  "finalize.before",
  "finalize.after",
  "finalize.error",
]);
const hash = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const own = (value, key) => {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) throw new Error("accessor_refused");
  return descriptor.value;
};
const list = (value, cap = 128) => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > cap)
    throw new Error("array_refused");
  return Array.from({ length: value.length }, (_, i) => own(value, String(i)));
};
function plain(value) {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new Error("object_refused");
  for (const key of ["__proto__", "prototype", "constructor"]) {
    if (Object.hasOwn(value, key)) throw new Error("prototype_key_refused");
  }
}
function scalar(value) {
  if (value === undefined) return undefined;
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  throw new Error("scalar_refused");
}
function selected(value, keys) {
  plain(value);
  const result = Object.create(null);
  for (const key of keys) {
    const item = scalar(own(value, key));
    if (item !== undefined) result[key] = item;
  }
  return result;
}
function strings(value) {
  return list(value).map((entry) => {
    if (typeof entry !== "string") throw new Error("string_refused");
    return entry;
  });
}
function rows(value, keys, arrayKeys = []) {
  return list(value).map((entry) => {
    const row = selected(entry, keys);
    for (const key of arrayKeys) {
      const item = own(entry, key);
      if (item !== undefined) row[key] = strings(item);
    }
    return row;
  });
}

// Construct a fresh, selected snapshot using descriptors: getters and inherited
// fields cannot emit private values, and caller mutation cannot change log bytes.
export function answerPilotDiagnosticState(answer) {
  const result = selected(answer, [
    "answer",
    "grounded",
    "confidence",
    "routingMode",
    "routingReason",
    "responseMode",
    "sourceBackedReviewFallback",
    "preformatted",
    "truncated",
    "faithfulnessWarning",
    "rejectedCandidateText",
  ]);
  for (const [key, keys, arrayKeys] of [
    ["citations", ["chunk_id", "provenance"], []],
    ["answerSections", ["heading", "kind", "supportLevel", "body"], ["citation_chunk_ids"]],
    ["supportedClaims", ["claimId", "text", "riskClass", "supportStatus"], ["supportingChunkIds"]],
    ["conflictsOrGaps", ["type", "message"], ["source_chunk_ids"]],
  ]) {
    const item = own(answer, key);
    if (item !== undefined) result[key] = rows(item, keys, arrayKeys);
  }
  const numeric = own(answer, "unverifiedNumericTokens");
  if (numeric !== undefined) result.unverifiedNumericTokens = strings(numeric);
  const assessments = own(answer, "evidenceAssessments");
  if (assessments !== undefined) {
    plain(assessments);
    const keys = Object.keys(assessments);
    if (keys.length > 128) throw new Error("assessment_bound");
    result.evidenceAssessments = Object.create(null);
    for (const key of keys) {
      result.evidenceAssessments[key] = selected(own(assessments, key), [
        "relevance",
        "claimSupport",
        "authority",
        "currency",
        "extractionQuality",
      ]);
    }
  }
  return result;
}

// Only the same data properties the model source block can read are admitted.
// No source data is rewritten: mismatches disable this private diagnostic only.
function generationMetadataBinding(source, id) {
  const expected = APPROVED_GENERATION.chunks[id];
  if (own(source, "title") !== APPROVED_GENERATION.title || own(source, "file_name") !== APPROVED_GENERATION.file_name)
    throw new Error("identity_metadata_changed");
  for (const key of ["page_number", "chunk_index"])
    if (own(source, key) !== expected[key]) throw new Error("location_changed");
  for (const key of ["section_heading", "parent_heading", "anchor_id", "retrieval_synopsis"])
    if ((own(source, key) ?? null) !== expected[key]) throw new Error("source_metadata_changed");
  // Authenticated v2 RPC return shapes omit section_path. Accept only genuine
  // own-property absence for these fixed licensed chunks; never infer an empty
  // path or normalize a supplied one. Preserve the representation in the proof.
  const pathDescriptor = Object.getOwnPropertyDescriptor(source, "section_path");
  let sectionPath;
  if (!pathDescriptor) {
    if ("section_path" in source) throw new Error("section_changed");
    sectionPath = Object.freeze({ presence: "absent_v2", pathSha256: hash("absent_v2") });
  } else {
    const suppliedPathJson = JSON.stringify(strings(own(source, "section_path")));
    if (suppliedPathJson !== JSON.stringify(expected.section_path)) throw new Error("section_changed");
    sectionPath = Object.freeze({ presence: "present_raw", pathSha256: hash(suppliedPathJson) });
  }
  if (own(source, "adjacent_context")) throw new Error("adjacent_context_unapproved");
  // Similarity is a computed retrieval scalar, not an extra evidence channel.
  const similarity = own(source, "similarity");
  if (typeof similarity !== "number" || !Number.isFinite(similarity) || similarity < 0 || similarity > 1)
    throw new Error("similarity_refused");
  for (const key of ["images", "table_facts"])
    if (list(own(source, key) ?? []).length) throw new Error("unapproved_evidence_channel");
  const cards = list(own(source, "memory_cards") ?? [], 3).map((card) => {
    plain(card);
    const cardId = own(card, "id"),
      content = own(card, "content");
    if (typeof cardId !== "string" || !Object.hasOwn(APPROVED_GENERATION.cards, cardId) || typeof content !== "string")
      throw new Error("memory_card_refused");
    const approved = APPROVED_GENERATION.cards[cardId];
    if (
      own(card, "document_id") !== DOCUMENT ||
      !approved.source_chunk_ids.includes(id) ||
      own(card, "card_type") !== approved.card_type ||
      hash(content) !== approved.contentSha256 ||
      JSON.stringify(strings(own(card, "source_chunk_ids"))) !== JSON.stringify(approved.source_chunk_ids)
    )
      throw new Error("memory_card_changed");
    return { id: cardId, contentSha256: approved.contentSha256 };
  });
  if (new Set(cards.map((card) => card.id)).size !== cards.length) throw new Error("duplicate_card");
  const metadata = own(source, "source_metadata");
  if (metadata != null) {
    plain(metadata);
    for (const key of Object.keys(APPROVED_GENERATION.governance))
      if (own(metadata, key) !== APPROVED_GENERATION.governance[key]) throw new Error("governance_changed");
    const evidence = own(metadata, "clinical_validation_evidence");
    if (evidence != null) {
      plain(evidence);
      if (own(evidence, "basis") != null) throw new Error("endorsement_changed");
    }
  }
  const quality = own(source, "indexing_quality");
  if (quality != null) {
    plain(quality);
    if (JSON.stringify(strings(own(quality, "issues") ?? [])) !== JSON.stringify(APPROVED_GENERATION.indexIssues))
      throw new Error("quality_issues_changed");
  }
  // Fixed approved metadata hash plus approved optional channel presence is enough
  // to bind the capture without logging title, card prose or document metadata.
  return {
    sectionPath,
    metadataSha256: hash(
      JSON.stringify({
        expected,
        sectionPath,
        title: APPROVED_GENERATION.title,
        file_name: APPROVED_GENERATION.file_name,
        governance: metadata == null ? null : APPROVED_GENERATION.governance,
        indexIssues: quality == null ? null : APPROVED_GENERATION.indexIssues,
      }),
    ),
    memoryCards: cards,
  };
}

export function answerPilotDiagnosticSources(answer, numericVerificationSources) {
  if (numericVerificationSources !== undefined) return numericVerificationSources;
  plain(answer);
  return own(answer, "sources");
}

function binding(sources) {
  const seen = new Set();
  const result = list(sources, 6).map((source) => {
    plain(source);
    const id = own(source, "id"),
      documentId = own(source, "document_id"),
      content = own(source, "content");
    if (
      typeof id !== "string" ||
      documentId !== DOCUMENT ||
      typeof content !== "string" ||
      seen.has(id) ||
      !Object.hasOwn(LICENSED_CHUNKS, id)
    )
      throw new Error("source_refused");
    seen.add(id);
    const contentSha256 = hash(content);
    if (contentSha256 !== LICENSED_CHUNKS[id]) throw new Error("source_changed");
    // SearchResult need not carry content_hash, but an explicitly present hash must agree.
    const declared = own(source, "content_hash");
    if (declared !== undefined && declared !== contentSha256) throw new Error("source_hash_changed");
    return { id, documentId, contentSha256, generation: generationMetadataBinding(source, id) };
  });
  if (!result.length) throw new Error("source_empty");
  return result;
}
function schemaSnapshot(value, depth = 0, counter = { n: 0 }) {
  if (++counter.n > 8192 || depth > 24) throw new Error("schema_bound");
  if (value === null || typeof value !== "object") return scalar(value);
  if (Array.isArray(value)) return list(value, 256).map((entry) => schemaSnapshot(entry, depth + 1, counter));
  plain(value);
  const result = Object.create(null);
  const keys = Object.keys(value);
  if (keys.length > 256) throw new Error("schema_bound");
  for (const key of keys) result[key] = schemaSnapshot(own(value, key), depth + 1, counter);
  return result;
}

const preparedGenerationProofs = new WeakSet();
const generationWireAdmissions = new WeakMap();
function freezeSnapshot(value) {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) freezeSnapshot(value[key]);
    Object.freeze(value);
  }
  return value;
}

// Preclaim eligibility has no logging authority. The caller supplies the same
// schema function that the real observed generator will use for this context.
export function prepareAnswerPilotGenerationSeed(context, model, attemptOrdinal, schemaFor) {
  if (
    !["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol"].includes(model) ||
    !Number.isSafeInteger(attemptOrdinal) ||
    attemptOrdinal < 1 ||
    attemptOrdinal > 32
  )
    throw new Error("generation_identity_refused");
  const sourceBinding = freezeSnapshot(binding(context));
  const schema = freezeSnapshot(schemaSnapshot(schemaFor(context)));
  return Object.freeze({ context, model, attemptOrdinal, sourceBinding, schema, schemaJson: JSON.stringify(schema) });
}

export function prepareAnswerPilotGeneration(seed, input, schema, options) {
  if (!seed || typeof input !== "string") throw new Error("generation_proof_missing");
  plain(options);
  if (
    own(options, "model") !== seed.model ||
    own(options, "schemaName") !== "clinical_rag_answer" ||
    own(options, "operation") !== "answer" ||
    typeof own(options, "instructions") !== "string"
  )
    throw new Error("generation_options_changed");
  if (
    JSON.stringify(binding(seed.context)) !== JSON.stringify(seed.sourceBinding) ||
    JSON.stringify(schemaSnapshot(schema)) !== seed.schemaJson
  )
    throw new Error("generation_binding_changed");
  const proof = Object.freeze({
    model: seed.model,
    attemptOrdinal: seed.attemptOrdinal,
    input,
    instructions: own(options, "instructions"),
    schema: seed.schema,
    schemaJson: seed.schemaJson,
    sourceBinding: seed.sourceBinding,
  });
  preparedGenerationProofs.add(proof);
  return proof;
}

// The existing SDK receives a string input and serializes it unchanged. Other
// input envelopes are refused for this finite pilot, without transforming them.
export function answerPilotResponseMatches(proof, serializedBody) {
  try {
    if (!preparedGenerationProofs.has(proof) || typeof serializedBody !== "string") return false;
    const body = JSON.parse(serializedBody);
    const format = body.text?.format;
    const matches =
      body.model === proof.model &&
      body.input === proof.input &&
      body.instructions === proof.instructions &&
      body.metadata?.operation === "answer" &&
      Object.keys(body.metadata).length === 1 &&
      format?.type === "json_schema" &&
      format.name === "clinical_rag_answer" &&
      format.strict === true &&
      Object.keys(format).length === 4 &&
      JSON.stringify(schemaSnapshot(format.schema)) === proof.schemaJson;
    if (!matches) return false;
    const wireSha256 = hash(serializedBody);
    const admitted = generationWireAdmissions.get(proof);
    if (admitted && admitted.wireSha256 !== wireSha256) return false;
    generationWireAdmissions.set(proof, admitted ?? Object.freeze({ wireSha256 }));
    return true;
  } catch {
    return false;
  }
}

export function createAnswerPilotDiagnostic(ticket, guard) {
  // Only the exact reviewed query and licensed owner/document can activate this seam.
  if (
    ticket.ownerId !== OWNER ||
    ticket.documentId !== DOCUMENT ||
    ticket.querySha256 !== QUERY ||
    typeof ticket.diagnosticCurrent !== "function"
  )
    return null;
  const captureId = randomUUID();
  let used = 0,
    sequence = 0,
    closed = false;
  const active = () => !closed && ticket.diagnosticCurrent() === true && !guard.snapshot().denied;
  const emit = (line) => {
    if (!active()) return false;
    const wire = PREFIX + JSON.stringify(line);
    const bytes = Buffer.byteLength(wire + "\n", "utf8");
    if (bytes > LINE_BYTES || used + bytes > TOTAL_BYTES) return false;
    used += bytes;
    console.info(wire);
    return true;
  };
  const capture = (stage, sources, details, preparedProof) => {
    try {
      if (
        !active() ||
        !STAGES.has(stage) ||
        (stage === "generation.return" && !preparedGenerationProofs.has(preparedProof))
      )
        return;
      const sourceBinding = preparedProof
        ? preparedProof.sourceBinding
        : binding(typeof sources === "function" ? sources() : sources); // Refusal emits nothing and never evaluates details.
      if (!active()) return;
      const selectedDetails = details();
      const payload = { sourceBinding };
      if (stage === "parse.before" || stage === "generation.return") {
        const generated = stage === "generation.return" ? own(selectedDetails, "generated") : null;
        const raw = generated ? own(generated, "text") : own(selectedDetails, "raw");
        if (typeof raw !== "string") throw new Error("raw_refused");
        payload.raw = raw;
        payload.schema = schemaSnapshot(own(selectedDetails, "schema"));
        payload.schemaSha256 = hash(JSON.stringify(payload.schema));
        if (stage === "generation.return") {
          const model = own(selectedDetails, "model"),
            attemptOrdinal = own(selectedDetails, "attemptOrdinal");
          if (
            !["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol"].includes(model) ||
            !Number.isSafeInteger(attemptOrdinal) ||
            attemptOrdinal < 1 ||
            attemptOrdinal > 32
          )
            throw new Error("generation_identity_refused");
          payload.model = model;
          payload.attemptOrdinal = attemptOrdinal;
          payload.truncated = own(generated, "truncated") === true;
          const status = own(generated, "status"),
            reason = own(generated, "incompleteReason");
          if (["completed", "incomplete", "failed"].includes(status)) payload.status = status;
          if (["max_output_tokens", "content_filter"].includes(reason)) payload.incompleteReason = reason;
        }
      } else if (stage.endsWith(".after") || stage === "finalize.before") {
        const answer = own(selectedDetails, "answer");
        const answerSources = own(answer, "sources");
        if (answerSources !== undefined) payload.answerSourceBinding = binding(answerSources);
        payload.state = answerPilotDiagnosticState(answer);
      } else {
        payload.error = "stage_threw"; // No exception messages or stacks.
      }
      const text = JSON.stringify(payload),
        digest = hash(text);
      const encoded = Buffer.from(text, "utf8").toString("base64");
      const parts = Math.ceil(encoded.length / 1400);
      const event = ++sequence;
      const base = { captureId, event, stage, digest, parts };
      // Build every immutable wire string before writing. The final complete record
      // commits an event only after every segment; missing commit is incomplete.
      const lines = Array.from({ length: parts }, (_, index) => ({
        ...base,
        part: index + 1,
        status: "segment",
        payloadB64: encoded.slice(index * 1400, (index + 1) * 1400),
      }));
      const complete = { ...base, status: "complete", payloadBytes: Buffer.byteLength(text, "utf8") };
      const required = [...lines, complete].reduce(
        (sum, line) => sum + Buffer.byteLength(PREFIX + JSON.stringify(line) + "\n", "utf8"),
        0,
      );
      // Reserve room for one terminal refusal, never label omitted/truncated bytes complete.
      if (required + used > TOTAL_BYTES - 1000) {
        emit({
          ...base,
          parts: 0,
          status: required > TOTAL_BYTES - 1000 ? "oversize_refused" : "total_limit_refused",
          payloadBytes: Buffer.byteLength(text, "utf8"),
        });
        closed = true;
        return;
      }
      for (const line of lines) if (!emit(line)) return;
      emit(complete);
    } catch {
      // Capture has no authority over answer generation, visible result or markers.
      // Unsafe source bindings/accessors are suppressed without logging their values.
    }
  };
  return Object.freeze({
    capture: (stage, sources, details) => capture(stage, sources, details),
    capturePreparedGeneration: (proof, generated) => {
      if (!preparedGenerationProofs.has(proof)) return;
      if (!generationWireAdmissions.has(proof)) return;
      capture(
        "generation.return",
        null,
        () => ({ generated, model: proof.model, attemptOrdinal: proof.attemptOrdinal, schema: proof.schema }),
        proof,
      );
    },
  });
}
