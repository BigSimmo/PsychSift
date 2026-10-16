const providerEnvironmentKeys = Object.freeze([
  "OPENAI_API_KEY",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT_ID",
  "OPENAI_BASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_URL",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_PROJECT_NAME",
  "SUPABASE_STAGING_PROJECT_REF",
  "SUPABASE_STAGING_PROJECT_NAME",
  "DATABASE_URL",
  "POSTGRES_PASSWORD",
  "E2E_AUTH_ENABLED",
  "E2E_USER_EMAIL",
  "E2E_USER_PASSWORD",
  "SENTRY_AUTH_TOKEN",
  // Public client DSN is still a live monitoring destination — scrub it too so
  // Playwright/Lighthouse production builds cannot bake a real browser DSN.
  "NEXT_PUBLIC_SENTRY_DSN",
  "SENTRY_DSN",
  "ALLOW_PROVIDER_TESTS",
  "RAILWAY_API_TOKEN",
  "RAILWAY_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "CODEX_CLOUD_GITHUB_PAT",
  "GITLAB_TOKEN",
  "GLAB_TOKEN",
  "CODEX_TRIGGER_TOKEN",
  "HEALTH_DEEP_PROBE_SECRET",
  "INDEXING_V3_AGENT_SECRET",
  "CROSS_TENANT_SERVICE_ROLE_KEY",
  "FIGMA_CLIENT_ID",
  "FIGMA_CLIENT_SECRET",
  "FIGMA_ACCESS_TOKEN",
  "FIGMA_PERSONAL_ACCESS_TOKEN",
  "FIGMA_TOKEN",
  "FIGMA_NPM_TOKEN",
]);

const offlineUrlValues = Object.freeze({
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
  SUPABASE_URL: "http://127.0.0.1:1",
  SUPABASE_DB_URL: "postgresql://offline:offline@127.0.0.1:1/offline",
  DATABASE_URL: "postgresql://offline:offline@127.0.0.1:1/offline",
});

// Feature flags / sampling, not credentials: force them off in offline wrappers
// without joining the credential inventory (which would also demand setup/raw-env
// scrubbing for names that never carry a secret). Applied to every consumer of
// offlineTestEnvironment (Vitest, Playwright, Lighthouse, CLS) by design — the
// offline contract is provider-free, so default-on Sentry log/trace behaviour
// must be opted into via an explicit test argument, not the ambient environment.
const offlineSentryControlFlags = Object.freeze({
  SENTRY_ENABLE_LOGS: "false",
  SENTRY_SEND_TEST_LOG: "false",
  // Belt-and-suspenders with blank DSNs: keep DB/perf tracing off even if a
  // future change leaves a truthy DSN in the offline environment.
  SENTRY_TRACES_SAMPLE_RATE: "0",
});

/**
 * @param {Record<string, string | undefined>} source
 * @param {Record<string, string | undefined>} overrides
 */
export function offlineTestEnvironment(source = process.env, overrides = {}) {
  const environment = { ...source };
  // Explicit values both scrub inherited secrets and prevent Next/Vite from
  // repopulating the same names from a repository-local env file. URL-shaped
  // settings use inert loopback values so the runtime env schema still parses.
  //
  // Sentry DSNs are blanked (not deleted or faked): an absent key lets Next
  // reload a live DSN from `.env.local` during Playwright/Lighthouse production
  // starts, and a truthy inert URL keeps app Sentry gates enabled. Empty string
  // stays falsy for `SENTRY_DSN?.trim()` and is coerced to unset by optionalUrlEnv
  // in `src/lib/env.ts`.
  for (const key of providerEnvironmentKeys) {
    environment[key] = offlineUrlValues[key] ?? "";
  }
  Object.assign(environment, offlineSentryControlFlags);

  return {
    ...environment,
    RAG_PROVIDER_MODE: "offline",
    NEXT_PUBLIC_DEMO_MODE: "true",
    ...overrides,
  };
}

/** @param {Record<string, string | undefined>} environment */
export function requireProviderTestPermission(environment = process.env) {
  if (environment.ALLOW_PROVIDER_TESTS !== "true") {
    throw new Error(
      "Live provider tests are disabled. Set ALLOW_PROVIDER_TESTS=true only after explicit provider-test approval.",
    );
  }
}

/** @param {Record<string, string | undefined>} environment */
export function providerFreeCloudLiveTestGap(environment = process.env) {
  const providerFree =
    environment.ALLOW_PROVIDER_TESTS === "true" &&
    environment.CODEX_CLOUD === "1" &&
    (environment.CODEX_CLOUD_ACCESS_PROFILE ?? "offline") === "offline";
  if (!providerFree) return null;
  return (
    "Live provider test capability gap: ALLOW_PROVIDER_TESTS is authorized, but agent-phase provider " +
    "credentials are intentionally unavailable in CODEX_CLOUD_ACCESS_PROFILE=offline. Run this check " +
    "locally/operator-side or in an explicitly provisioned connected Cloud profile."
  );
}

export { offlineUrlValues, offlineSentryControlFlags, providerEnvironmentKeys };
