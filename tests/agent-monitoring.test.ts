import { createRequire } from "node:module";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

describe("Sentry agent monitoring gating", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@sentry/nextjs");
    vi.resetModules();
  });

  it("stays disabled without a DSN, with tracing off, or without an initialized Sentry client", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("SENTRY_TRACES_SAMPLE_RATE", "0.1");
    const noDsn = await import("@/lib/observability/agent-monitoring");
    expect(noDsn.isSentryAgentMonitoringEnabled()).toBe(false);

    vi.resetModules();
    vi.stubEnv("SENTRY_DSN", "https://public@o0.ingest.sentry.io/1");
    vi.stubEnv("SENTRY_TRACES_SAMPLE_RATE", "0");
    const rateZero = await import("@/lib/observability/agent-monitoring");
    expect(rateZero.isSentryAgentMonitoringEnabled()).toBe(false);

    vi.resetModules();
    vi.stubEnv("SENTRY_DSN", "https://public@o0.ingest.sentry.io/1");
    vi.stubEnv("SENTRY_TRACES_SAMPLE_RATE", "0.1");
    const noClient = await import("@/lib/observability/agent-monitoring");
    // Sentry.init never runs in Vitest (or in the ingestion worker), so the
    // client gate keeps agent monitoring off even with DSN + tracing set.
    expect(noClient.isSentryAgentMonitoringEnabled()).toBe(false);
  });

  it("returns the client unwrapped and keeps scope calls inert when disabled", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    const { instrumentOpenAIClientForAgentMonitoring, setAgentConversationId } =
      await import("@/lib/observability/agent-monitoring");

    const client = { responses: { create: async () => ({}) } };
    expect(instrumentOpenAIClientForAgentMonitoring(client)).toBe(client);
    expect(() => setAgentConversationId("11111111-2222-4333-8444-555555555555")).not.toThrow();
  });
});

// Load the installed package's actual conditional Edge entry: its export set
// differs from Node, so a whole-SDK mock could conceal this compatibility bug.
const require = createRequire(import.meta.url);
const sdkPackagePath = require.resolve("@sentry/nextjs/package.json");
const sdkPackage = require(sdkPackagePath) as { exports: { ".": { edge: { require: string } } } };
const edgeSdk = require(
  path.resolve(path.dirname(sdkPackagePath), sdkPackage.exports["."].edge.require),
) as typeof import("@sentry/nextjs");

describe("agent conversation binding against installed SDK exports", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@sentry/nextjs");
    vi.resetModules();
  });

  async function enabledEdgeModule() {
    vi.stubEnv("SENTRY_DSN", "https://synthetic@127.0.0.1/1");
    vi.stubEnv("SENTRY_TRACES_SAMPLE_RATE", "0.1");
    vi.doMock("@sentry/nextjs", () => edgeSdk);
    return import("@/lib/observability/agent-monitoring");
  }

  // getClient is only used as an initialized-runtime gate by our wrapper.
  // Bind an inert client object inside a temporary scope instead of Sentry.init:
  // no integrations, DSN parsing, transport creation or delivery can start.
  function withInertClient(callback: () => void) {
    const isolationScope = edgeSdk.getIsolationScope();
    const previousConversation = isolationScope.getScopeData().conversationId;
    isolationScope.setConversationId(undefined);
    try {
      edgeSdk.withScope((scope) => {
        scope.setClient({} as NonNullable<ReturnType<typeof edgeSdk.getClient>>);
        callback();
      });
    } finally {
      // Without init there is no runtime async-context isolation strategy.
      isolationScope.setConversationId(previousConversation);
    }
  }

  it("binds the UUID through the real isolation-scope API when the runtime omits the convenience export", async () => {
    const { isSentryAgentMonitoringEnabled, setAgentConversationId } = await enabledEdgeModule();
    const conversationId = "11111111-2222-4333-8444-555555555555";
    expect(edgeSdk.getClient()).toBeUndefined();
    expect(typeof edgeSdk.getIsolationScope().setConversationId).toBe("function");
    withInertClient(() => {
      expect(isSentryAgentMonitoringEnabled()).toBe(true);
      setAgentConversationId(conversationId);
      expect(edgeSdk.getIsolationScope().getScopeData().conversationId).toBe(conversationId);
    });
    expect(edgeSdk.getClient()).toBeUndefined();
    expect(edgeSdk.getIsolationScope().getScopeData().conversationId).toBeUndefined();
  });

  it("rejects free text and malformed identifiers before touching the actual SDK scope", async () => {
    const { setAgentConversationId } = await enabledEdgeModule();
    withInertClient(() => {
      const scope = edgeSdk.getIsolationScope();
      for (const invalid of [
        "Synthetic clinical query",
        "person@example.test",
        "x".repeat(36),
        "11111111-2222-4333-8444-555555555555 suffix",
      ]) {
        setAgentConversationId(invalid);
        expect(scope.getScopeData().conversationId).toBeUndefined();
      }
    });
  });
});
