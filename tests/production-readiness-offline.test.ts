import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  clinicalAskReadinessFindings,
  clinicalAskReadinessProfile,
  clinicalAskFindingIsBlocking,
  isProviderFreeCodexCloud,
  developerAccessKeyProductionRisk,
  mockupsGateProductionRisk,
  openAIReadinessPolicy,
  validClinicalAskEvidenceArtifact,
  ragProgrammeReadinessPolicy,
  alertDestinationReadiness,
} from "../scripts/production-readiness";
import { providerEnvironmentKeys } from "../scripts/test-environment.mjs";

describe("programme static readiness", () => {
  it("recognizes the implemented producer and renderer while keeping both flags default-off", () => {
    expect(ragProgrammeReadinessPolicy({ RAG_ADAPTIVE_ANSWER_ENABLED: "true" })).toEqual([]);
    expect(
      ragProgrammeReadinessPolicy({ RAG_ADAPTIVE_ANSWER_ENABLED: "true", RAG_ADAPTIVE_ANSWER_RENDER_ENABLED: "true" }),
    ).toEqual([]);
  });
  const canary = {
    RAG_PROGRAMME_MODE: "canary",
    RAG_PROGRAMME_CANARY_BASIS_POINTS: "100",
    RAG_PROGRAMME_ROLLOUT_SALT: "s".repeat(32),
    RAG_TELEMETRY_EXTENDED: "true",
  };
  it("accepts legacy default-off without claiming connected proof", () =>
    expect(ragProgrammeReadinessPolicy({})).toEqual([]));
  it("does not require cohort identity for a full release but rejects a malformed supplied salt", () => {
    const full = { ...canary, RAG_PROGRAMME_CANARY_BASIS_POINTS: "10000", RAG_PROGRAMME_ROLLOUT_SALT: undefined };
    expect(ragProgrammeReadinessPolicy(full, { rollbackOwnerBound: true })).toEqual([]);
    expect(
      ragProgrammeReadinessPolicy({ ...full, RAG_PROGRAMME_ROLLOUT_SALT: "short" }, { rollbackOwnerBound: true }),
    ).toContain("rollout_salt_missing_or_invalid");
  });
  it("requires salt telemetry and trusted rollback ownership for canary", () => {
    expect(ragProgrammeReadinessPolicy({ RAG_PROGRAMME_MODE: "canary" })).toEqual(
      expect.arrayContaining([
        "rollout_salt_missing_or_invalid",
        "programme_telemetry_disabled",
        "rollback_ownership_unavailable",
      ]),
    );
    expect(ragProgrammeReadinessPolicy(canary)).toEqual(["rollback_ownership_unavailable"]);
    expect(ragProgrammeReadinessPolicy(canary, { rollbackOwnerBound: true })).toEqual([]);
  });
  it.each(["-1", "10001", "1.2", "garbage"])("rejects malformed percentage %s", (value) =>
    expect(ragProgrammeReadinessPolicy({ ...canary, RAG_PROGRAMME_CANARY_BASIS_POINTS: value })).toContain(
      "canary_percentage_invalid",
    ),
  );
  it("rejects malformed mode and flag controls", () => {
    expect(ragProgrammeReadinessPolicy({ RAG_PROGRAMME_MODE: "candidate" })).toContain("programme_mode_invalid");
    expect(ragProgrammeReadinessPolicy({ RAG_SITE_CONTENT_ENABLED: "yes" })).toContain("component_flag_invalid");
    expect(ragProgrammeReadinessPolicy({ RAG_GOVERNED_RETRIEVAL_ENABLED: "yes" })).toContain("component_flag_invalid");
  });
  it("requires the real adaptive producer and contract before enabled readiness", () => {
    expect(ragProgrammeReadinessPolicy({ ...canary, RAG_ADAPTIVE_ANSWER_RENDER_ENABLED: "true" })).toContain(
      "adaptive_render_requires_answer",
    );
    expect(ragProgrammeReadinessPolicy({ ...canary, RAG_ADAPTIVE_ANSWER_ENABLED: "true" })).not.toContain(
      "adaptive_producer_contract_unavailable",
    );
  });
  it("never substitutes configured versions for active site/admin and Australian health", () => {
    const config = {
      ...canary,
      RAG_SITE_CONTENT_ENABLED: "true",
      RAG_AUSTRALIAN_AUGMENTATION_ENABLED: "true",
      SITE_CONTENT_EXPECTED_STATIC_MANIFEST_DIGEST: "a".repeat(64),
    };
    expect(ragProgrammeReadinessPolicy(config, { rollbackOwnerBound: true })).toEqual(
      expect.arrayContaining([
        "site_release_or_administrator_proof_unavailable",
        "australian_policy_or_health_unavailable",
      ]),
    );
    expect(
      ragProgrammeReadinessPolicy(config, {
        rollbackOwnerBound: true,
        siteContent: {
          state: "current",
          staticManifestDigest: "a".repeat(64),
          releaseValid: true,
          administratorAttestationValid: true,
        },
        australian: { sourcePolicyVersion: "policy-v1", healthy: true },
      }),
    ).toEqual([]);
    expect(
      ragProgrammeReadinessPolicy(config, {
        rollbackOwnerBound: true,
        siteContent: {
          state: "current",
          staticManifestDigest: "b".repeat(64),
          releaseValid: true,
          administratorAttestationValid: true,
        },
      }),
    ).toContain("site_release_or_administrator_proof_unavailable");
  });
});

describe("production readiness provider policy", () => {
  it("validates the opt-in disabled profile using runtime disabled defaults without launch evidence", () => {
    const findings = clinicalAskReadinessFindings(
      {},
      () => false,
      () => undefined,
      "disabled",
    );
    expect(findings.filter(({ status }) => status === "blocked")).toEqual([]);
    expect(findings.filter(({ status }) => status === "config_present").map(({ area }) => area)).toEqual([
      "master flag",
      "external flag",
    ]);
    expect(findings.filter(({ status }) => status === "not_applicable")).toHaveLength(9);
    expect(findings.every((finding) => !clinicalAskFindingIsBlocking(finding, {}, "disabled"))).toBe(true);
  });

  it.each(["CLINICAL_ASK_ENABLED", "CLINICAL_ASK_EXTERNAL_SEARCH_ENABLED"])(
    "rejects enabled or malformed %s in the disabled profile even in CI or offline Cloud",
    (flag) => {
      for (const value of ["true", "", "FALSE", " false ", "invalid"]) {
        const environment = { [flag]: value };
        const findings = clinicalAskReadinessFindings(
          environment,
          () => false,
          () => undefined,
          "disabled",
        );
        expect(
          findings.some((finding) => clinicalAskFindingIsBlocking(finding, environment, "disabled", true, true)),
        ).toBe(true);
      }
    },
  );

  it("accepts explicit disabled flags without reading hosted launch artefacts", () => {
    const findings = clinicalAskReadinessFindings(
      { CLINICAL_ASK_ENABLED: "false", CLINICAL_ASK_EXTERNAL_SEARCH_ENABLED: "false" },
      () => {
        throw new Error("disabled profile must not probe launch files");
      },
      () => {
        throw new Error("disabled profile must not read launch evidence");
      },
      "disabled",
    );
    expect(findings.some(({ status }) => status === "blocked")).toBe(false);
  });

  it("keeps the default launch profile strict and treats all missing active-launch evidence as blocking", () => {
    const defaultFindings = clinicalAskReadinessFindings({}, () => false);
    expect(defaultFindings.filter(({ status }) => status === "blocked")).toHaveLength(5);
    const active = { CLINICAL_ASK_ENABLED: "true" };
    const findings = clinicalAskReadinessFindings(active, () => false);
    expect(
      findings
        .filter(({ status }) => status !== "config_present")
        .every((finding) => clinicalAskFindingIsBlocking(finding, active, "launch", true, true)),
    ).toBe(true);
  });

  it("defaults to launch validation and rejects unknown or ambiguous profile arguments", () => {
    expect(clinicalAskReadinessProfile([])).toBe("launch");
    expect(clinicalAskReadinessProfile(["--ci", "--clinical-ask-profile=disabled"])).toBe("disabled");
    expect(clinicalAskReadinessProfile(["--clinical-ask-profile=launch"])).toBe("launch");
    for (const args of [
      ["--clinical-ask-profile=invalid"],
      ["--clinical-ask-profile"],
      ["--clinical-ask-profile=disabled", "--clinical-ask-profile=launch"],
    ]) {
      expect(() => clinicalAskReadinessProfile(args)).toThrow("Clinical Ask profile");
    }
  });

  it("separates Clinical Ask code configuration from approval-gated live evidence", () => {
    const existing = new Set([
      "supabase/migrations/20260822120000_expand_answer_feedback_for_clinical_ask.sql",
      ".local/clinical-ask-evidence/synthetic-evaluation.json",
    ]);
    const findings = clinicalAskReadinessFindings(
      {
        CLINICAL_ASK_ENABLED: "false",
        CLINICAL_ASK_EXTERNAL_SEARCH_ENABLED: "false",
        CLINICAL_ASK_DISABLED_MODES: "",
        OPENAI_TRANSCRIPTION_MODEL: "gpt-4o-mini-transcribe",
      },
      (filePath) => existing.has(filePath),
      (filePath) =>
        filePath.endsWith("synthetic-evaluation.json")
          ? JSON.stringify({
              area: "synthetic evaluation",
              issuer: "Synthetic evaluator",
              target: "seven Clinical Ask modes",
              date: "2026-08-22",
              scope: "offline synthetic cases",
              status: "passed",
            })
          : undefined,
    );
    expect(findings.filter((finding) => finding.status === "config_present").map((finding) => finding.area)).toEqual([
      "master flag",
      "external flag",
      "emergency denylist",
      "transcription model",
      "migration file",
    ]);
    expect(findings.find((finding) => finding.area === "synthetic evaluation")?.status).toBe("evidence_supplied");
    expect(findings.find((finding) => finding.area === "hosted migration")?.status).toBe("not_verified");
    expect(findings.find((finding) => finding.area === "authority approval")?.status).toBe("not_verified");
    expect(findings.find((finding) => finding.area === "protected staging canary")?.status).toBe("not_verified");
    expect(findings.find((finding) => finding.area === "contractual retention and region")?.status).toBe(
      "not_verified",
    );
    expect(findings.find((finding) => finding.area === "physical iPhone acceptance")?.status).toBe("not_verified");
  });

  it("does not treat empty or unrelated evidence files as readiness passes", () => {
    expect(validClinicalAskEvidenceArtifact("", "synthetic evaluation")).toBe(false);
    expect(validClinicalAskEvidenceArtifact("{}", "synthetic evaluation")).toBe(false);
    expect(
      validClinicalAskEvidenceArtifact(
        JSON.stringify({
          area: "authority approval",
          issuer: "Reviewer",
          target: "authority registry",
          date: "2026-08-22",
          scope: "registered authorities",
          status: "approved",
        }),
        "synthetic evaluation",
      ),
    ).toBe(false);
    const findings = clinicalAskReadinessFindings(
      {
        CLINICAL_ASK_ENABLED: "false",
        CLINICAL_ASK_EXTERNAL_SEARCH_ENABLED: "false",
        CLINICAL_ASK_DISABLED_MODES: "",
        OPENAI_TRANSCRIPTION_MODEL: "gpt-4o-mini-transcribe",
      },
      () => true,
      () => "{}",
    );
    expect(findings.filter(({ status }) => status === "evidence_supplied")).toEqual([]);
  });

  it("blocks a seven-mode launch claim with a non-empty emergency denylist or missing explicit configuration", () => {
    const findings = clinicalAskReadinessFindings(
      { CLINICAL_ASK_ENABLED: "true", CLINICAL_ASK_DISABLED_MODES: "therapy-compass" },
      () => false,
    );
    expect(findings.find((finding) => finding.area === "external flag")?.status).toBe("blocked");
    expect(findings.find((finding) => finding.area === "emergency denylist")?.status).toBe("blocked");
    expect(findings.find((finding) => finding.area === "transcription model")?.status).toBe("blocked");
  });
  it("passes the explicit staging declaration to the shared project guard", () => {
    const source = readFileSync(new URL("../scripts/production-readiness.ts", import.meta.url), "utf8");
    expect(source).toContain("SUPABASE_STAGING_PROJECT_REF: process.env.SUPABASE_STAGING_PROJECT_REF");
    expect(source).toContain("SUPABASE_STAGING_PROJECT_NAME: process.env.SUPABASE_STAGING_PROJECT_NAME");
  });

  it("requires an OpenAI key for auto and openai modes", () => {
    expect(openAIReadinessPolicy("auto")).toEqual({ required: true, ready: false });
    expect(openAIReadinessPolicy("openai")).toEqual({ required: true, ready: false });
    expect(openAIReadinessPolicy("auto", "configured")).toEqual({ required: true, ready: true });
  });

  it("allows a missing OpenAI key only for explicit offline mode", () => {
    expect(openAIReadinessPolicy("offline")).toEqual({ required: false, ready: true });
  });

  it("distinguishes the provider-free Cloud contract from connected live verification", () => {
    expect(
      isProviderFreeCodexCloud({
        CODEX_CLOUD: "1",
        CODEX_CLOUD_ACCESS_PROFILE: "offline",
        RAG_PROVIDER_MODE: "offline",
        NEXT_PUBLIC_DEMO_MODE: "true",
        PLAYWRIGHT_OFFLINE_MODE: "true",
      }),
    ).toBe(true);
    expect(
      isProviderFreeCodexCloud({
        CODEX_CLOUD: "1",
        CODEX_CLOUD_ACCESS_PROFILE: "connected",
        RAG_PROVIDER_MODE: "auto",
        NEXT_PUBLIC_DEMO_MODE: "false",
        PLAYWRIGHT_OFFLINE_MODE: "false",
      }),
    ).toBe(false);
  });

  it("reports the provider capability gap before generic CI readiness", () => {
    const environment = { ...process.env };
    for (const name of providerEnvironmentKeys) delete environment[name];
    Object.assign(environment, {
      CODEX_CLOUD: "1",
      CODEX_CLOUD_ACCESS_PROFILE: "offline",
      RAG_PROVIDER_MODE: "offline",
      NEXT_PUBLIC_DEMO_MODE: "true",
      PLAYWRIGHT_OFFLINE_MODE: "true",
    });
    const result = spawnSync(process.execPath, ["scripts/run-tsx.mjs", "scripts/production-readiness.ts", "--ci"], {
      cwd: path.resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      env: environment,
      timeout: 30_000,
    });

    const spawnError = result.error;
    const timedOut = spawnError !== undefined && "code" in spawnError && spawnError.code === "ETIMEDOUT";
    expect(
      spawnError,
      timedOut
        ? "production-readiness --ci timed out after 30s"
        : `production-readiness --ci failed to start: ${spawnError?.message ?? "unknown"}\n${result.stdout}\n${result.stderr}`,
    ).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Provider capability gap:");
    expect(result.stdout).toContain("CLOUD PROVIDER-FREE READY:");
    // Local operator receipts are intentionally ignored by Git but may exist in a developer checkout.
    // The pure finding test above owns the deterministic missing-evidence assertions; this spawned
    // integration check only requires both readiness areas to be reported.
    expect(result.stdout).toMatch(/Clinical Ask (?:not verified|evidence supplied) — hosted migration/);
    expect(result.stdout).toMatch(/Clinical Ask (?:not verified|evidence supplied) — physical iPhone acceptance/);
  });

  it("flags NEXT_PUBLIC_MOCKUPS_ENABLED=true alone in production as unguarded (#L30)", () => {
    expect(
      mockupsGateProductionRisk({
        NODE_ENV: "production",
        NEXT_PUBLIC_MOCKUPS_ENABLED: "true",
      }),
    ).toBe("unguarded");
    expect(
      mockupsGateProductionRisk({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        NEXT_PUBLIC_MOCKUPS_ENABLED: "true",
      }),
    ).toBe("unguarded");
  });

  it("treats the exact Playwright double-flag pairing as a flagged exception, not a plain pass", () => {
    expect(
      mockupsGateProductionRisk({
        NODE_ENV: "production",
        NEXT_PUBLIC_MOCKUPS_ENABLED: "true",
        PLAYWRIGHT_OFFLINE_MODE: "true",
      }),
    ).toBe("playwright-exception");
  });

  it("fails a NEXT_PUBLIC_ copy of the developer-area key, which would ship the secret to every visitor", () => {
    // Next.js inlines NEXT_PUBLIC_ values into the client bundle. The name is
    // rejected everywhere, not only in production, because a build made with it
    // anywhere carries the secret into whatever it is deployed as.
    expect(developerAccessKeyProductionRisk({ NEXT_PUBLIC_DEVELOPER_AREA_ACCESS_KEY: "anything" })).toBe("public-name");
    expect(
      developerAccessKeyProductionRisk({
        NODE_ENV: "development",
        NEXT_PUBLIC_DEVELOPER_AREA_ACCESS_KEY: "anything",
      }),
    ).toBe("public-name");
  });

  it("states the passwordless developer link as an enabled production fact, not a failure", () => {
    expect(
      developerAccessKeyProductionRisk({ NODE_ENV: "production", DEVELOPER_AREA_ACCESS_KEY: "k".repeat(32) }),
    ).toBe("enabled");
    expect(
      developerAccessKeyProductionRisk({ VERCEL_ENV: "production", DEVELOPER_AREA_ACCESS_KEY: "k".repeat(32) }),
    ).toBe("enabled");
    expect(
      developerAccessKeyProductionRisk({ NODE_ENV: "development", DEVELOPER_AREA_ACCESS_KEY: "k".repeat(32) }),
    ).toBe("none");
    expect(developerAccessKeyProductionRisk({ NODE_ENV: "production" })).toBe("none");
    // Whitespace is not a configured key.
    expect(developerAccessKeyProductionRisk({ NODE_ENV: "production", DEVELOPER_AREA_ACCESS_KEY: "   " })).toBe("none");
    // The runtime resolver rejects under-strength values, so readiness must not
    // advertise the passwordless link as active for one.
    expect(developerAccessKeyProductionRisk({ NODE_ENV: "production", DEVELOPER_AREA_ACCESS_KEY: "short" })).toBe(
      "none",
    );
  });

  it("reports no risk outside production or with the flag unset", () => {
    expect(mockupsGateProductionRisk({ NODE_ENV: "development", NEXT_PUBLIC_MOCKUPS_ENABLED: "true" })).toBe("none");
    expect(mockupsGateProductionRisk({ NODE_ENV: "production" })).toBe("none");
    expect(mockupsGateProductionRisk({ NODE_ENV: "production", NEXT_PUBLIC_MOCKUPS_ENABLED: "false" })).toBe("none");
  });

  it("documents local presence fill guidance for safety/query-hash/deep-probe gaps", () => {
    const source = readFileSync(new URL("../scripts/production-readiness.ts", import.meta.url), "utf8");
    expect(source).toContain("check:local-presence");
    expect(source).toContain("HEALTH_DEEP_PROBE_SECRET is not set");
    expect(source).toContain("OPENAI_SAFETY_IDENTIFIER_SECRET is not set");
  });
});

/**
 * The gate that would have caught a three-day outage before it started.
 *
 * Deploy alerts with no destination are discarded by a receiver that still answers 2xx, so the
 * integration looks healthy from every angle except the one that matters. That was the live
 * configuration on both Railway services through 24 failed production deploys in September 2026.
 */
describe("deploy alert destination readiness", () => {
  it("passes on either destination alone", () => {
    expect(alertDestinationReadiness({ SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/x" }).ok).toBe(true);
    expect(alertDestinationReadiness({ DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/x" }).ok).toBe(true);
  });

  it("warns harder when the receiver is armed, because alerts are then actively discarded", () => {
    const armed = alertDestinationReadiness({ RAILWAY_WEBHOOK_SECRET: "railway-webhook-secret-value-123" });

    expect(armed.ok).toBe(false);
    expect(armed.message).toContain("RAILWAY_WEBHOOK_SECRET is set");
    expect(armed.message).toContain("discard");
  });

  it("still warns when nothing at all is wired up", () => {
    const bare = alertDestinationReadiness({});

    expect(bare.ok).toBe(false);
    expect(bare.message).toContain("no destination");
  });

  it("never echoes a configured webhook URL into the readiness output", () => {
    const secretish = "https://hooks.slack.com/services/T000/B000/xxxxxxxxxxxx";

    expect(alertDestinationReadiness({ SLACK_WEBHOOK_URL: secretish }).message).not.toContain(secretish);
  });
});
