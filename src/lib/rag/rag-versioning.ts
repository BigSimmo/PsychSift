export const ragAnswerPromptVersion = "clinical-rag-answer-v19";
// Query serialization changes invalidate answers independently of schema/render contracts.
export const ragAnswerInputVersion = "clinical-rag-answer-input-v2-user-query";
export const ragAnswerSchemaVersion = "clinical-rag-answer-schema-v4";
export const ragQueryClassifierPromptVersion = "clinical-rag-query-classifier-v1";
export const ragSummaryPromptVersion = "clinical-document-summary-v3";
export const ragIndexingPromptVersion = "clinical-indexing-prompts-v1";

export const ragAdaptiveAnswerPromptVersion = "clinical-rag-answer-v20";
export const ragAdaptiveAnswerSchemaVersion = "clinical-rag-answer-schema-v5";
export const ragAnswerQualityEvaluationVersion = "rag-eval-config-v3-adaptive-bounds";

/** Static code availability, never an activation flag or connected-readiness claim. */
export const ragAdaptiveAnswerProducerAvailable = true;
export const ragAdaptiveAnswerRenderAvailable = true;

export type RagAnswerGenerationContract =
  | { readonly promptVersion: typeof ragAnswerPromptVersion; readonly schemaVersion: typeof ragAnswerSchemaVersion }
  | {
      readonly promptVersion: typeof ragAdaptiveAnswerPromptVersion;
      readonly schemaVersion: typeof ragAdaptiveAnswerSchemaVersion;
    };

export const legacyAnswerGenerationContract = Object.freeze({
  promptVersion: ragAnswerPromptVersion,
  schemaVersion: ragAnswerSchemaVersion,
});
export const adaptiveAnswerGenerationContract = Object.freeze({
  promptVersion: ragAdaptiveAnswerPromptVersion,
  schemaVersion: ragAdaptiveAnswerSchemaVersion,
});

/** Runtime diagnostics may cross an untrusted boundary; only coherent actual pairs survive. */
export function isRagAnswerGenerationContract(value: unknown): value is RagAnswerGenerationContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prompt = Reflect.get(value, "promptVersion");
  const schema = Reflect.get(value, "schemaVersion");
  return (
    (prompt === ragAnswerPromptVersion && schema === ragAnswerSchemaVersion) ||
    (prompt === ragAdaptiveAnswerPromptVersion && schema === ragAdaptiveAnswerSchemaVersion)
  );
}
