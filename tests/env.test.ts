import { afterEach, describe, expect, it, vi } from "vitest";

describe("Sol answer defaults and workload isolation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps control answer defaults until explicit candidate activation", async () => {
    for (const key of [
      "OPENAI_ANSWER_MODEL",
      "OPENAI_FAST_ANSWER_MODEL",
      "OPENAI_STRONG_ANSWER_MODEL",
      "OPENAI_QUERY_CLASSIFIER_MODEL",
      "OPENAI_SUMMARY_MODEL",
      "OPENAI_INDEXING_MODEL",
    ])
      vi.stubEnv(key, undefined);
    const { env } = await import("@/lib/env");
    expect(env).toMatchObject({
      OPENAI_ANSWER_MODEL: "gpt-5.6-terra",
      OPENAI_FAST_ANSWER_MODEL: "gpt-5.6-terra",
      OPENAI_STRONG_ANSWER_MODEL: "gpt-5.6-sol",
      OPENAI_QUERY_CLASSIFIER_MODEL: "gpt-5.6-terra",
      OPENAI_SUMMARY_MODEL: "gpt-5.6-terra",
      OPENAI_INDEXING_MODEL: "gpt-5.6-sol",
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
      EMBEDDING_DIMENSIONS: 1536,
    });
  });

  it("activates all-Sol answers explicitly without changing other workload fallbacks", async () => {
    for (const key of ["OPENAI_ANSWER_MODEL", "OPENAI_FAST_ANSWER_MODEL", "OPENAI_STRONG_ANSWER_MODEL"])
      vi.stubEnv(key, "gpt-6.1-sol");
    for (const key of ["OPENAI_QUERY_CLASSIFIER_MODEL", "OPENAI_SUMMARY_MODEL", "OPENAI_INDEXING_MODEL"])
      vi.stubEnv(key, undefined);
    const { env } = await import("@/lib/env");
    expect(env).toMatchObject({
      OPENAI_ANSWER_MODEL: "gpt-6.1-sol",
      OPENAI_FAST_ANSWER_MODEL: "gpt-6.1-sol",
      OPENAI_STRONG_ANSWER_MODEL: "gpt-6.1-sol",
      OPENAI_QUERY_CLASSIFIER_MODEL: "gpt-5.6-terra",
      OPENAI_SUMMARY_MODEL: "gpt-5.6-terra",
      OPENAI_INDEXING_MODEL: "gpt-5.6-sol",
    });
  });

  it("preserves explicit workload overrides independently of the answer models", async () => {
    vi.stubEnv("OPENAI_FAST_ANSWER_MODEL", "gpt-6.1-sol");
    vi.stubEnv("OPENAI_QUERY_CLASSIFIER_MODEL", "gpt-5.6-luna");
    vi.stubEnv("OPENAI_SUMMARY_MODEL", "gpt-5.6-terra");
    vi.stubEnv("OPENAI_INDEXING_MODEL", "gpt-5.6-terra");
    const { env } = await import("@/lib/env");
    expect(env).toMatchObject({
      OPENAI_QUERY_CLASSIFIER_MODEL: "gpt-5.6-luna",
      OPENAI_SUMMARY_MODEL: "gpt-5.6-terra",
      OPENAI_INDEXING_MODEL: "gpt-5.6-terra",
    });
  });
});

describe("developer-area access-key environment parsing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("treats blank and under-strength access keys as unconfigured at module load", async () => {
    // Replacing the schema preprocessor with a direct min(32) validation should
    // make this import reject. The actual app imports this module before proxy
    // authorization can fall back to the administrator gate.
    for (const accessKey of ["", "short", "x".repeat(31)]) {
      vi.resetModules();
      vi.stubEnv("DEVELOPER_AREA_ACCESS_KEY", accessKey);

      await expect(import("@/lib/env")).resolves.toMatchObject({
        env: { DEVELOPER_AREA_ACCESS_KEY: undefined },
      });
    }
  });
});

describe("deep-probe secret environment parsing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("treats a blank secret as unset, as the offline test wrapper leaves it", async () => {
    vi.stubEnv("HEALTH_DEEP_PROBE_SECRET", "");

    await expect(import("@/lib/env")).resolves.toMatchObject({
      env: { HEALTH_DEEP_PROBE_SECRET: undefined },
    });
  });

  it("still rejects a non-blank secret shorter than 16 characters", async () => {
    vi.stubEnv("HEALTH_DEEP_PROBE_SECRET", "too-short");

    await expect(import("@/lib/env")).rejects.toThrow();
  });
});

describe("original-document link lifetime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("clamps a configured lifetime above one hour instead of refusing to start (SEC-N7)", async () => {
    vi.stubEnv("DOCUMENT_SIGNED_URL_TTL_SECONDS", "604800");
    await expect(import("@/lib/env")).resolves.toMatchObject({ env: { DOCUMENT_SIGNED_URL_TTL_SECONDS: 3600 } });
  });

  it("keeps a lifetime under the cap as configured", async () => {
    vi.stubEnv("DOCUMENT_SIGNED_URL_TTL_SECONDS", "300");
    await expect(import("@/lib/env")).resolves.toMatchObject({ env: { DOCUMENT_SIGNED_URL_TTL_SECONDS: 300 } });
  });
});
