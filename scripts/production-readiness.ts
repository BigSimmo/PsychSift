import { ragAdaptiveAnswerProducerAvailable, ragAdaptiveAnswerRenderAvailable } from "@/lib/rag/rag-versioning";
import { access, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { constants } from "node:fs";
import path from "node:path";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import { loadEnvConfig } from "@next/env";

import { resolveDeveloperAccessKey } from "../src/lib/developer-area/link-access";
import { checkSupabaseProjectConfig } from "@/lib/supabase/project";
import { checkNodeRuntime as checkStrictNodeRuntime } from "./check-runtime";

loadEnvConfig(process.cwd());

const isCiMode = process.argv.includes("--ci");

export function isProviderFreeCodexCloud(environment: Record<string, string | undefined> = process.env) {
  return (
    environment.CODEX_CLOUD === "1" &&
    (environment.CODEX_CLOUD_ACCESS_PROFILE ?? "offline") === "offline" &&
    environment.RAG_PROVIDER_MODE === "offline" &&
    environment.NEXT_PUBLIC_DEMO_MODE === "true" &&
    environment.PLAYWRIGHT_OFFLINE_MODE === "true"
  );
}

const providerFreeCodexCloud = isProviderFreeCodexCloud();
let providerCapabilityGap = false;

type Result = {
  failures: string[];
  warnings: string[];
  passes: string[];
};

function isMissingEnvError(message: string) {
  return message.startsWith("Missing server environment variables") || message.startsWith("Missing OPENAI_API_KEY.");
}

function recordIssue(message: string, options: { downgradeToWarningInCi?: boolean } = {}) {
  if (isCiMode && options.downgradeToWarningInCi) {
    result.warnings.push(`${message} (CI)`);
    return;
  }
  result.failures.push(message);
}

function recordProviderGap(message: string) {
  providerCapabilityGap = true;
  result.warnings.push(`Provider capability gap: ${message}`);
}

const result: Result = {
  failures: [],
  warnings: [],
  passes: [],
};

function placeholderLooksLikeExample(value: string) {
  return /replace-with|your-|example|-example-|\{\w+\}|xxxx|todo|placeholder/i.test(value);
}

export function openAIReadinessPolicy(providerMode: "auto" | "openai" | "offline", apiKey?: string) {
  if (providerMode === "offline") return { required: false, ready: true } as const;
  return { required: true, ready: Boolean(apiKey) } as const;
}

/** Trusted current health/ownership projections supplied by an authorized operational caller.
 * The static CLI deliberately supplies none; configuration is never connected evidence. */
export type RagProgrammeReadinessEvidence = {
  rollbackOwnerBound?: boolean;
  siteContent?: {
    state: import("@/lib/types").SiteContentPartitionState;
    staticManifestDigest: string | null;
    releaseValid: boolean;
    administratorAttestationValid: boolean;
  };
  australian?: { sourcePolicyVersion: string | null; healthy: boolean };
};

/**
 * Deploy alerting has somewhere to go.
 *
 * A receiver with no destination is worse than no receiver at all: it authenticates, answers
 * `200 { "forwarded": false }`, and discards the alert, so from outside it is indistinguishable
 * from a healthy integration. Both Railway services were in exactly that state while 24
 * production deploys failed and rolled back across three days in September 2026, and the outage
 * was found by noticing a missing UI change rather than by being told.
 *
 * `postChatNotification` now logs a discarded alert at runtime, but that only fires once
 * something has already gone wrong. This check is the one that can say so beforehand, which is
 * why it lives in the readiness gate rather than only in the receiver.
 *
 * An armed `RAILWAY_WEBHOOK_SECRET` makes the warning sharper rather than softer: it means
 * deliveries are arriving and being thrown away, which is the misconfiguration that actually
 * occurred, as opposed to an integration nobody has wired up yet.
 */
export function alertDestinationReadiness(environment: {
  SLACK_WEBHOOK_URL?: string;
  DISCORD_WEBHOOK_URL?: string;
  RAILWAY_WEBHOOK_SECRET?: string;
}): { ok: boolean; message: string } {
  if (environment.SLACK_WEBHOOK_URL || environment.DISCORD_WEBHOOK_URL) {
    return { ok: true, message: "A chat destination is set; Railway deploy alerts have somewhere to go." };
  }
  return {
    ok: false,
    message: environment.RAILWAY_WEBHOOK_SECRET
      ? "RAILWAY_WEBHOOK_SECRET is set but neither SLACK_WEBHOOK_URL nor DISCORD_WEBHOOK_URL is; the deploy-alert receiver will authenticate and then discard every alert, including failed deploys. Set one on the Railway service (see docs/webhooks.md § 1)."
      : "Neither SLACK_WEBHOOK_URL nor DISCORD_WEBHOOK_URL is set; deploy and CI alerts have no destination (see docs/webhooks.md).",
  };
}

export function ragProgrammeReadinessPolicy(
  environment: Record<string, string | undefined>,
  evidence: RagProgrammeReadinessEvidence = {},
): string[] {
  const failures: string[] = [];
  const mode = environment.RAG_PROGRAMME_MODE ?? "legacy";
  if (!["legacy", "shadow", "canary"].includes(mode)) failures.push("programme_mode_invalid");
  const percentage = Number(environment.RAG_PROGRAMME_CANARY_BASIS_POINTS ?? "0");
  if (
    !Number.isInteger(percentage) ||
    percentage < 0 ||
    percentage > 10000 ||
    environment.RAG_PROGRAMME_CANARY_BASIS_POINTS?.trim() === ""
  )
    failures.push("canary_percentage_invalid");
  const flags = [
    "RAG_GOVERNED_RETRIEVAL_ENABLED",
    "RAG_SITE_CONTENT_ENABLED",
    "RAG_AUSTRALIAN_AUGMENTATION_ENABLED",
    "RAG_ADAPTIVE_ANSWER_ENABLED",
    "RAG_ADAPTIVE_ANSWER_RENDER_ENABLED",
  ];
  if (flags.some((flag) => ![undefined, "true", "false"].includes(environment[flag])))
    failures.push("component_flag_invalid");
  if (mode === "canary") {
    if (percentage !== 10000 && (environment.RAG_PROGRAMME_ROLLOUT_SALT?.trim().length ?? 0) < 32)
      failures.push("rollout_salt_missing_or_invalid");
    if (
      percentage === 10000 &&
      environment.RAG_PROGRAMME_ROLLOUT_SALT?.trim() &&
      environment.RAG_PROGRAMME_ROLLOUT_SALT.trim().length < 32
    )
      failures.push("rollout_salt_missing_or_invalid");
    if (!evidence.rollbackOwnerBound) failures.push("rollback_ownership_unavailable");
  }
  if (mode !== "legacy" && environment.RAG_TELEMETRY_EXTENDED !== "true") failures.push("programme_telemetry_disabled");
  if (environment.RAG_ADAPTIVE_ANSWER_RENDER_ENABLED === "true" && environment.RAG_ADAPTIVE_ANSWER_ENABLED !== "true")
    failures.push("adaptive_render_requires_answer");
  // Static implementation prerequisites are distinct from activation and connected health.
  if (environment.RAG_ADAPTIVE_ANSWER_ENABLED === "true" && !ragAdaptiveAnswerProducerAvailable)
    failures.push("adaptive_producer_contract_unavailable");
  if (environment.RAG_ADAPTIVE_ANSWER_RENDER_ENABLED === "true" && !ragAdaptiveAnswerRenderAvailable)
    failures.push("adaptive_render_contract_unavailable");
  if (mode !== "legacy" && environment.RAG_SITE_CONTENT_ENABLED === "true") {
    const expected = environment.SITE_CONTENT_EXPECTED_STATIC_MANIFEST_DIGEST;
    const site = evidence.siteContent;
    if (
      !expected ||
      !/^[0-9a-f]{64}$/.test(expected) ||
      !site ||
      site.state !== "current" ||
      site.staticManifestDigest !== expected ||
      !site.releaseValid ||
      !site.administratorAttestationValid
    )
      failures.push("site_release_or_administrator_proof_unavailable");
  }
  if (
    mode !== "legacy" &&
    environment.RAG_AUSTRALIAN_AUGMENTATION_ENABLED === "true" &&
    (!evidence.australian?.healthy || !evidence.australian.sourcePolicyVersion?.trim())
  )
    failures.push("australian_policy_or_health_unavailable");
  return failures;
}

export type ClinicalAskReadinessStatus = "config_present" | "evidence_supplied" | "blocked" | "not_verified";
export type ClinicalAskReadinessFinding = {
  area: string;
  status: ClinicalAskReadinessStatus;
  message: string;
};

const acceptedClinicalAskEvidenceStatuses = new Set(["accepted", "applied", "approved", "green", "passed", "verified"]);

function readClinicalAskEvidenceArtifact(filePath: string) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

export function validClinicalAskEvidenceArtifact(content: string | undefined, expectedArea: string) {
  if (!content?.trim()) return false;
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return false;
    const requiredText = (key: "issuer" | "target" | "scope") =>
      typeof parsed[key] === "string" && parsed[key].trim().length > 0;
    const date = typeof parsed.date === "string" ? parsed.date.trim() : "";
    const status = typeof parsed.status === "string" ? parsed.status.trim().toLowerCase() : "";
    return (
      parsed.area === expectedArea &&
      requiredText("issuer") &&
      requiredText("target") &&
      requiredText("scope") &&
      /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(date) &&
      Number.isFinite(Date.parse(date)) &&
      acceptedClinicalAskEvidenceStatuses.has(status)
    );
  } catch {
    return false;
  }
}

export function clinicalAskReadinessFindings(
  environment: Record<string, string | undefined>,
  fileExists: (filePath: string) => boolean = existsSync,
  readArtifact: (filePath: string) => string | undefined = readClinicalAskEvidenceArtifact,
): ClinicalAskReadinessFinding[] {
  const enabled = environment.CLINICAL_ASK_ENABLED;
  const external = environment.CLINICAL_ASK_EXTERNAL_SEARCH_ENABLED;
  const disabledModes = environment.CLINICAL_ASK_DISABLED_MODES;
  const transcriptionModel = environment.OPENAI_TRANSCRIPTION_MODEL?.trim();
  const launchRequested = enabled === "true";
  const configured = (area: string, condition: boolean, message: string): ClinicalAskReadinessFinding => ({
    area,
    status: condition ? "config_present" : "blocked",
    message,
  });
  const evidence = (area: string, artifact: string, message: string): ClinicalAskReadinessFinding => {
    const supplied = fileExists(artifact) && validClinicalAskEvidenceArtifact(readArtifact(artifact), area);
    return {
      area,
      status: supplied ? "evidence_supplied" : "not_verified",
      message: `${message} (${artifact})`,
    };
  };

  return [
    configured("master flag", enabled === "true" || enabled === "false", "CLINICAL_ASK_ENABLED must be explicit."),
    configured(
      "external flag",
      external === "true" || external === "false",
      "CLINICAL_ASK_EXTERNAL_SEARCH_ENABLED must be explicit.",
    ),
    configured(
      "emergency denylist",
      disabledModes !== undefined && (!launchRequested || disabledModes.trim() === ""),
      "CLINICAL_ASK_DISABLED_MODES must be explicit and empty for a seven-mode launch claim.",
    ),
    configured("transcription model", Boolean(transcriptionModel), "OPENAI_TRANSCRIPTION_MODEL must be explicit."),
    configured(
      "migration file",
      fileExists("supabase/migrations/20260822120000_expand_answer_feedback_for_clinical_ask.sql"),
      "The Clinical Ask feedback migration file must be present.",
    ),
    evidence(
      "hosted migration",
      ".local/clinical-ask-evidence/hosted-migration.json",
      "Hosted feedback-migration state is not verified by repository presence.",
    ),
    evidence(
      "authority approval",
      ".local/clinical-ask-evidence/authority-approval.json",
      "Authority-registry approval is not verified by code presence.",
    ),
    evidence(
      "synthetic evaluation",
      ".local/clinical-ask-evidence/synthetic-evaluation.json",
      "A synthetic seven-mode clinical evaluation artefact is required.",
    ),
    evidence(
      "protected staging canary",
      ".local/clinical-ask-evidence/protected-staging-canary.json",
      "A protected-staging live canary artefact is required.",
    ),
    evidence(
      "contractual retention and region",
      ".local/clinical-ask-evidence/contractual-basis.json",
      "Provider retention, region, and contractual basis are not verified by application configuration.",
    ),
    evidence(
      "physical iPhone acceptance",
      ".local/clinical-ask-evidence/physical-iphone-acceptance.json",
      "Physical iPhone Safari and installed-PWA microphone acceptance is required; Chromium emulation is insufficient.",
    ),
  ];
}

function recordClinicalAskReadiness() {
  const findings = clinicalAskReadinessFindings(process.env);
  const launchRequested = process.env.CLINICAL_ASK_ENABLED === "true";
  for (const finding of findings) {
    const line = `Clinical Ask ${finding.status.replace("_", " ")} — ${finding.area}: ${finding.message}`;
    if (finding.status === "config_present" || finding.status === "evidence_supplied") result.passes.push(line);
    else if (finding.status === "blocked" && !isCiMode && !providerFreeCodexCloud) result.failures.push(line);
    else if (launchRequested) result.failures.push(line);
    else result.warnings.push(line);
  }
}

async function checkRequiredFile(filePath: string, message: string) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    result.failures.push(message);
    return false;
  }
}

async function checkOptionalFile(filePath: string, message: string) {
  try {
    await access(filePath, constants.F_OK);
    result.passes.push(message);
    return true;
  } catch {
    result.warnings.push(`${message} (missing)`);
    return false;
  }
}

async function hasFile(filePath: string) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function checkNodeRuntime() {
  const runtime = checkStrictNodeRuntime(process.versions.node);
  if (runtime.ok) {
    result.passes.push(runtime.message);
    return;
  }
  if (runtime.message.includes("newer than the release target")) {
    result.warnings.push(`${runtime.message} Run npm run check:runtime before release.`);
    return;
  }
  result.failures.push(runtime.message);
}

function recordNoAuthProductionCheck() {
  if (
    (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") &&
    (process.env.NEXT_PUBLIC_LOCAL_NO_AUTH === "true" || process.env.LOCAL_NO_AUTH === "true")
  ) {
    result.failures.push("Local no-auth mode is enabled in production-like environment variables.");
  }
}

function recordDemoModeProductionCheck() {
  if (
    (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") &&
    process.env.NEXT_PUBLIC_DEMO_MODE === "true"
  ) {
    result.failures.push("Demo mode (NEXT_PUBLIC_DEMO_MODE=true) is enabled in a production-like environment.");
  }
}

function recordRawQueryPersistenceProductionCheck() {
  if (
    (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") &&
    process.env.RAG_PERSIST_RAW_QUERY_TEXT === "true"
  ) {
    result.failures.push("RAG_PERSIST_RAW_QUERY_TEXT=true is not allowed in a production-like environment.");
  }
}

function recordAnswerPersistenceProductionCheck() {
  if (
    (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") &&
    process.env.RAG_PERSIST_ANSWER_TEXT === "true"
  ) {
    result.failures.push("RAG_PERSIST_ANSWER_TEXT=true is not allowed in a production-like environment.");
  }
}

/**
 * #L30: a single public build-time flag (`NEXT_PUBLIC_MOCKUPS_ENABLED=true`),
 * set alone, used to disable the developer-area administrator gate
 * (`DeveloperAreaGate`) in production for `/mockups/development` and
 * `/mockups/care-plan/**` (and, before their retirement, two further developer-area
 * prototypes). The gate now bypasses in production only under the
 * exact same double-flag pairing `src/proxy.ts`'s `shouldBlockProductionMockups`
 * reserves for the isolated Playwright production build
 * (`developerGateBypassAllowed()` in `src/lib/developer-area/access.ts`). This
 * still deserves a release-time assertion so a Railway variable set alone in a
 * real deployment fails readiness instead of silently opening the gate again.
 */
export function mockupsGateProductionRisk(
  environment: Record<string, string | undefined> = process.env,
): "none" | "playwright-exception" | "unguarded" {
  const productionLike = environment.NODE_ENV === "production" || environment.VERCEL_ENV === "production";
  if (!productionLike || environment.NEXT_PUBLIC_MOCKUPS_ENABLED !== "true") return "none";
  return environment.PLAYWRIGHT_OFFLINE_MODE === "true" ? "playwright-exception" : "unguarded";
}

function recordMockupsGateProductionCheck() {
  const risk = mockupsGateProductionRisk();
  if (risk === "unguarded") {
    result.failures.push(
      "NEXT_PUBLIC_MOCKUPS_ENABLED=true is set in a production-like environment without PLAYWRIGHT_OFFLINE_MODE=true. " +
        "This pairing must stay reserved for the isolated Playwright production build (#L30) — set NEXT_PUBLIC_MOCKUPS_ENABLED=false on a real deployment.",
    );
  } else if (risk === "playwright-exception") {
    result.warnings.push(
      "NEXT_PUBLIC_MOCKUPS_ENABLED=true with PLAYWRIGHT_OFFLINE_MODE=true bypasses the developer-area administrator gate; confirm this is the isolated Playwright production build, not a real deployment.",
    );
  }
}

/**
 * The passwordless developer-area link (`DEVELOPER_AREA_ACCESS_KEY`, exchanged
 * for a signed cookie by `src/proxy.ts`) is a second credential for the same
 * subtrees the administrator claim gates. Two things about it are worth
 * catching at release time rather than in a browser.
 *
 * A `NEXT_PUBLIC_`-prefixed copy is a hard failure: Next.js inlines those into
 * the client bundle, so the secret would ship to every visitor and the
 * developer area would be open to anyone who reads the JavaScript. That is #L30
 * with a longer string, and there is no legitimate reason for the name to exist.
 *
 * A correctly-named key in production is not a failure — it is the feature
 * working — but it IS a fact a release should state out loud, because it means
 * the area is reachable without a sign-in by anyone holding the link.
 */
export function developerAccessKeyProductionRisk(
  environment: Record<string, string | undefined> = process.env,
): "none" | "enabled" | "public-name" {
  if (environment.NEXT_PUBLIC_DEVELOPER_AREA_ACCESS_KEY?.trim()) return "public-name";
  const productionLike = environment.NODE_ENV === "production" || environment.VERCEL_ENV === "production";
  if (!productionLike || !resolveDeveloperAccessKey(environment)) return "none";
  return "enabled";
}

function recordDeveloperAccessKeyCheck() {
  const risk = developerAccessKeyProductionRisk();
  if (risk === "public-name") {
    result.failures.push(
      "NEXT_PUBLIC_DEVELOPER_AREA_ACCESS_KEY is set. Next.js inlines NEXT_PUBLIC_ values into the client bundle, " +
        "so this would publish the developer-area secret to every visitor — rename it to DEVELOPER_AREA_ACCESS_KEY (server-only).",
    );
  } else if (risk === "enabled") {
    result.warnings.push(
      "DEVELOPER_AREA_ACCESS_KEY is set: the developer area also opens for anyone holding the ?devkey link, without signing in. " +
        "Rotate the value to revoke every device.",
    );
  }
}

async function checkFileForServiceRoleExposure() {
  const envFiles = [".env", ".env.production", ".env.development"];
  for (const fileName of envFiles) {
    const filePath = path.join(process.cwd(), fileName);
    try {
      const content = await readFile(filePath, "utf8");
      const hasPlainServiceRole = /NEXT_PUBLIC_SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY/.test(content);
      if (!hasPlainServiceRole) {
        continue;
      }
      result.warnings.push(
        `${fileName} contains a service-role key marker. Keep these files out of source control and verify only server-side usage.`,
      );
    } catch {
      // file is optional in this repo shape
    }
  }
}

// PIA-2: the query-hash HMAC guard only redacts logged clinical queries if it is
// actually invoked at boot. Assert the fail-closed call is still wired into the
// startup path (src/instrumentation.ts) so a refactor can't silently drop it and let
// production start writing unsalted, dictionary-reversible SHA-256 hashes. The
// behavioural proof lives in tests/instrumentation.test.ts; this is a check-time
// signal that the guard is active in every environment, including CI where the
// secret-presence check below is intentionally quiet. The regex matches the call
// form (`requireQueryHashSecret(`), not the bare import destructuring.
async function checkQueryHashGuardWiring() {
  const instrumentationPath = path.join(process.cwd(), "src", "instrumentation.ts");
  let source: string;
  try {
    source = await readFile(instrumentationPath, "utf8");
  } catch {
    result.failures.push(
      "Cannot read src/instrumentation.ts to verify the RAG_QUERY_HASH_SECRET boot guard is active.",
    );
    return;
  }
  if (/\brequireQueryHashSecret\s*\(/.test(source)) {
    result.passes.push(
      "Boot guard invokes requireQueryHashSecret(); the query-hash HMAC fails closed in production (PIA-2).",
    );
  } else {
    result.failures.push(
      "src/instrumentation.ts no longer invokes requireQueryHashSecret(); the query-hash HMAC boot guard (PIA-2) is not active.",
    );
  }
}

async function main() {
  checkNodeRuntime();
  const programmeFailures = ragProgrammeReadinessPolicy(process.env);
  for (const reason of programmeFailures) result.failures.push(`RAG programme readiness: ${reason}`);
  if (!programmeFailures.length)
    result.passes.push(
      "RAG programme static configuration is valid; connected operational readiness is not established.",
    );
  recordNoAuthProductionCheck();
  recordDemoModeProductionCheck();
  recordMockupsGateProductionCheck();
  recordDeveloperAccessKeyCheck();
  recordRawQueryPersistenceProductionCheck();
  recordAnswerPersistenceProductionCheck();
  await checkFileForServiceRoleExposure();
  await checkQueryHashGuardWiring();
  recordClinicalAskReadiness();

  if (!(await checkRequiredFile(path.join(process.cwd(), "package-lock.json"), "package-lock.json is required"))) {
    // keep going so we can show all diagnostics
  }
  await checkRequiredFile(
    path.join(process.cwd(), ".env.example"),
    ".env.example is required for documented environment contract.",
  );

  const hasEnvLocal = await hasFile(path.join(process.cwd(), ".env.local"));
  const hasEnv = await hasFile(path.join(process.cwd(), ".env"));
  await checkOptionalFile(path.join(process.cwd(), ".env.local"), "Local override file .env.local is present");
  if (!hasEnvLocal && !hasEnv) {
    result.warnings.push("Neither .env nor .env.local exists for local overrides.");
  } else if (hasEnv) {
    result.passes.push("Top-level .env exists");
  }

  let envModule: typeof import("@/lib/env") | null = null;
  try {
    envModule = await import("@/lib/env");
  } catch (error) {
    result.failures.push(
      `Environment schema validation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (envModule) {
    try {
      envModule.requireServerEnv();
      result.passes.push("Server env includes required Supabase project values.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isMissingEnvError(message)) {
        if (providerFreeCodexCloud) {
          recordProviderGap(
            `Supabase server credentials are intentionally unavailable in the offline Cloud agent profile (${message}).`,
          );
        } else {
          recordIssue(`Missing server env config: ${message}`, { downgradeToWarningInCi: true });
        }
      } else {
        result.failures.push(`Missing server env config: ${message}`);
      }
    }

    const openAIReadiness = openAIReadinessPolicy(envModule.env.RAG_PROVIDER_MODE, envModule.env.OPENAI_API_KEY);
    if (!openAIReadiness.required) {
      result.passes.push("OpenAI API key is not required because RAG_PROVIDER_MODE is explicitly offline.");
    } else {
      try {
        envModule.requireOpenAIEnv();
        result.passes.push("OpenAI API key is configured.");
        if (placeholderLooksLikeExample(envModule.env.OPENAI_API_KEY ?? "")) {
          result.failures.push("OPENAI_API_KEY still looks like a placeholder.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isMissingEnvError(message)) {
          recordIssue(`OpenAI configuration issue: ${message}`, { downgradeToWarningInCi: true });
        } else {
          result.failures.push(`OpenAI configuration issue: ${message}`);
        }
      }
    }

    if (envModule.env.OPENAI_API_KEY && !envModule.env.OPENAI_SAFETY_IDENTIFIER_SECRET) {
      result.warnings.push(
        "OPENAI_SAFETY_IDENTIFIER_SECRET is not set; authenticated Responses requests omit the privacy-preserving safety identifier. For local/dev, run npm run check:local-presence -- --fill.",
      );
    } else if (envModule.env.OPENAI_SAFETY_IDENTIFIER_SECRET) {
      result.passes.push("OpenAI safety identifiers use a deployment-secret HMAC; raw owner IDs are not sent.");
    } else if (!isCiMode) {
      result.warnings.push(
        "OPENAI_SAFETY_IDENTIFIER_SECRET is not set (optional until OpenAI is enabled). Local fill: npm run check:local-presence -- --fill.",
      );
    }

    // Exercise the real boot guard so this check tracks its behaviour instead of
    // re-encoding the env rule (mirrors requireServerEnv/requireOpenAIEnv above). A
    // present secret passes in any environment; a missing one fails closed only in a
    // production-like environment (dev/CI keep the legacy digest for stored-row joins).
    try {
      envModule.requireQueryHashSecret();
      result.passes.push(
        "RAG_QUERY_HASH_SECRET is set; logged clinical-query hashes are keyed HMAC pseudonyms (PIA-2).",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const productionLike = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
      if (productionLike) {
        result.failures.push(`Query-hash secret issue: ${message}`);
      } else if (!isCiMode) {
        result.warnings.push(
          `RAG_QUERY_HASH_SECRET is not set for local/dev (${message}). Fill a distinct local value with npm run check:local-presence -- --fill.`,
        );
      }
    }

    if (envModule.env.HEALTH_DEEP_PROBE_SECRET) {
      result.passes.push("HEALTH_DEEP_PROBE_SECRET is set for authorized deep health probes.");
    } else if (!isCiMode) {
      result.warnings.push(
        "HEALTH_DEEP_PROBE_SECRET is not set; /api/health?deep=1 stays shallow. Local fill: npm run check:local-presence -- --fill.",
      );
    }

    // Suppressed under --ci like the neighbouring env-presence checks, since CI carries none of
    // these values.
    const alertDestination = alertDestinationReadiness(envModule.env);
    if (alertDestination.ok) {
      result.passes.push(alertDestination.message);
    } else if (!isCiMode) {
      result.warnings.push(alertDestination.message);
    }

    if (placeholderLooksLikeExample(envModule.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "")) {
      result.warnings.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY looks like a placeholder.");
    }
    if (placeholderLooksLikeExample(envModule.env.SUPABASE_SERVICE_ROLE_KEY ?? "")) {
      result.failures.push("SUPABASE_SERVICE_ROLE_KEY looks like a placeholder.");
    }
  }

  const supabaseCheck = checkSupabaseProjectConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_PROJECT_REF: process.env.SUPABASE_PROJECT_REF,
    SUPABASE_PROJECT_NAME: process.env.SUPABASE_PROJECT_NAME,
    SUPABASE_STAGING_PROJECT_REF: process.env.SUPABASE_STAGING_PROJECT_REF,
    SUPABASE_STAGING_PROJECT_NAME: process.env.SUPABASE_STAGING_PROJECT_NAME,
  });
  if (supabaseCheck.status === "ready") {
    result.passes.push(`Supabase project config points to ${supabaseCheck.expected.name}.`);
  } else if (supabaseCheck.status === "warning") {
    if (supabaseCheck.warnings.length) {
      result.warnings.push(...supabaseCheck.warnings);
    }
    result.passes.push("Supabase URL is correct.");
  } else if (supabaseCheck.status === "missing" && providerFreeCodexCloud) {
    recordProviderGap(
      "Supabase project connectivity is unavailable because NEXT_PUBLIC_SUPABASE_URL and agent-phase credentials are intentionally absent. Run this provider check locally/operator-side or in an explicitly provisioned connected Cloud profile.",
    );
  } else if (supabaseCheck.status === "missing" && isCiMode) {
    result.warnings.push("NEXT_PUBLIC_SUPABASE_URL is not set in this environment (CI).");
  } else {
    result.failures.push(...supabaseCheck.problems);
  }

  console.log("[Production Readiness]");
  console.log(`Project: ${supabaseCheck.expected.name} (${supabaseCheck.expected.ref})`);
  if (supabaseCheck.observed.configuredName) {
    console.log(`Configured name: ${supabaseCheck.observed.configuredName}`);
  }
  console.log(`Configured ref: ${supabaseCheck.observed.configuredRef ?? "not set"}`);
  console.log("");

  if (result.passes.length > 0) {
    console.log(`PASS (${result.passes.length}):`);
    for (const item of result.passes) console.log(`  - ${item}`);
  }
  if (result.warnings.length > 0) {
    console.log(`WARN (${result.warnings.length}):`);
    for (const item of result.warnings) console.log(`  - ${item}`);
  }
  if (result.failures.length > 0) {
    console.log(`FAIL (${result.failures.length}):`);
    for (const item of result.failures) console.log(`  - ${item}`);
    process.exitCode = 1;
  } else if (providerFreeCodexCloud && providerCapabilityGap) {
    console.log(
      "CLOUD PROVIDER-FREE READY: local production safeguards passed; authenticated provider readiness is capability-blocked by the offline agent profile.",
    );
  } else {
    console.log("READY: no blocking production-readiness failures.");
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    result.failures.push(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
