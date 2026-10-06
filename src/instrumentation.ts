import { captureRequestError } from "@/lib/observability/error-tracking";

// Next.js calls register() once when a server instance starts, before it serves
// any requests. We use it to fail fast: a clinical production server must be fully
// and correctly configured rather than silently degrading — or, worse, serving
// unauthenticated demo content — on the first request. See production-readiness
// plan items 0.1 and 0.3.
export async function register() {
  // Single Sentry init path per runtime (sentry.*.config.ts). Do not also call
  // initializeErrorTracking() — a second Sentry.init() races privacy/sampling options.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }

  // Only the Node.js server runtime in production needs this gate. Development
  // keeps its local/demo fallbacks, and the Edge runtime doesn't use the Node-only
  // server configuration these checks validate.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.NODE_ENV !== "production") {
    // Development and staging keep their fallbacks, but one of them is silent: without
    // RAG_QUERY_HASH_SECRET answer feedback cannot work at all, and the UI's advice to
    // "run the question again" can never fix it. Say so once, here, rather than leaving
    // it to be discovered per rating (2026-09-02 audit, L44).
    const { warnAnswerFeedbackDisabled } = await import("@/lib/env");
    warnAnswerFeedbackDisabled();
    return;
  }

  // Playwright validates a real production build, but its runner must remain a
  // provider-free demo. Permit that otherwise-invalid combination only for the
  // runner's isolated output and inert loopback environment. A partial or
  // externally-addressed configuration still falls through to the production
  // guard below and fails closed.
  if (process.env.PLAYWRIGHT_OFFLINE_MODE === "true") {
    const isolatedOutput = /^\.next-playwright\/[a-z0-9-]+\/dist$/i.test(process.env.NEXT_DIST_DIR ?? "");
    const providerFree =
      process.env.NEXT_PUBLIC_DEMO_MODE === "true" &&
      process.env.RAG_PROVIDER_MODE === "offline" &&
      process.env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:1" &&
      !process.env.SUPABASE_SERVICE_ROLE_KEY &&
      !process.env.OPENAI_API_KEY;
    if (isolatedOutput && providerFree) return;
    throw new Error("Refusing to start: invalid isolated Playwright offline environment.");
  }

  // Defense in depth: no-auth must never be active in a production build (even
  // though isLocalNoAuthMode() already hard-guards on NODE_ENV).
  if (process.env.LOCAL_NO_AUTH === "true" || process.env.NEXT_PUBLIC_LOCAL_NO_AUTH === "true") {
    throw new Error("Refusing to start: local no-auth mode is enabled in a production build.");
  }

  const { env, isDemoMode, requireOpenAIEnv, requireQueryHashSecret, requireSentryEnv, requireServerEnv } =
    await import("@/lib/env");

  // A clinical production server must run against real, configured backends — never
  // in demo mode, which bypasses auth and serves canned content.
  if (isDemoMode()) {
    throw new Error(
      "Refusing to start: demo mode is enabled in a production build. Unset NEXT_PUBLIC_DEMO_MODE and configure Supabase.",
    );
  }

  // Throw actionable errors now if the configured backend is missing or points at
  // the wrong project, instead of failing per-request. Explicit offline deployments
  // intentionally have no OpenAI credential; auto/openai modes still fail closed.
  requireServerEnv();
  if (env.RAG_PROVIDER_MODE !== "offline") requireOpenAIEnv();

  // A keyed HMAC secret must be present so clinical-query hashes written to the log
  // tables are not reversible (PIA-2). Fail closed rather than degrade to weak SHA-256.
  requireQueryHashSecret();
  // Runtime DSN consistency only. Sourcemap upload credentials are build-time
  // and are gated in next.config.ts — not re-checked here.
  requireSentryEnv();

  // Warm rag_aliases so the first post-boot search skips the cold-cache DB RTT.
  // Non-blocking: failures are logged via the catch handler below.
  const { warmEnabledRagAliasCache } = await import("@/lib/rag/rag-retrieval-variants");
  warmEnabledRagAliasCache().catch((error) => {
    console.warn("rag_aliases cache warmup failed; first request will retry.", {
      message: error instanceof Error ? error.message : String(error),
    });
  });

  // Warm the three catalogue kinds universal-search Promise.all's, serially, so an idle
  // process's first federated search is not the cold connection that blows the 1200 ms
  // budget (monitor #2919 / ledger #WFSMMT). Non-blocking; failures swallowed inside.
  const { warmCanonicalCatalogueSearchCaches } = await import("@/lib/site-content/warm-catalogue-caches");
  void warmCanonicalCatalogueSearchCaches();

  // Build the setup status once at boot. Every page load asks for it, and the first build after a
  // restart took ~9.6 s in production (0.6 s warm). The route keeps its cache on globalThis, so
  // this fills the copy requests read. The host only needs to be non-loopback to pass the
  // local-origin guard; nothing is fetched from it. Non-blocking; failures are swallowed.
  const { GET: warmSetupStatus } = await import("@/app/api/setup-status/route");
  void warmSetupStatus(new Request("https://startup-warm.invalid/api/setup-status")).catch(() => undefined);

  // My Day › Alerts: once a minute, send due Remind me notes and morning briefs (owner yes, 6 Oct
  // 2026). Does nothing without phone-alert keys; every send is claimed in the database first, so
  // several server instances never double-send.
  const { startTimedAlertSender } = await import("@/lib/alerts/timed-sender");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  startTimedAlertSender(createAdminClient);
}

export { captureRequestError as onRequestError };
