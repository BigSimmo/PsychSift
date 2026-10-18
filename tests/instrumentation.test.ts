import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercise the installed Next webpack parser/DefinePlugin, rather than only
// calling register() with Vitest's runtime import mocks. A negative early return
// can be safe at execution time while webpack still resolves later Node imports
// into its Edge graph. Externalizing dependencies records that resolution without
// executing boot work, starting timers or reaching any provider.
async function compiledRuntimeImports(runtime: "nodejs" | "edge") {
  type Stats = { toJson: (options: { all: boolean; errors: boolean }) => { errors?: unknown[] } };
  type Compiler = { close: (callback: (error?: Error | null) => void) => void };
  type ExternalCallback = (error?: Error | null, external?: string) => void;
  const { webpack } = createRequire(import.meta.url)("next/dist/compiled/webpack/webpack") as {
    webpack: ((config: unknown, callback: (error: Error | null, stats?: Stats) => void) => Compiler) & {
      DefinePlugin: new (definitions: Record<string, string>) => unknown;
    };
  };
  const directory = await mkdtemp(join(tmpdir(), "instrumentation-runtime-"));
  const imports = new Set<string>();
  try {
    await new Promise<void>((resolve, reject) => {
      const compiler = webpack(
        {
          mode: "none",
          target: "webworker",
          entry: join(process.cwd(), "src/instrumentation.ts"),
          output: { path: directory, filename: "instrumentation.js" },
          plugins: [new webpack.DefinePlugin({ "process.env.NEXT_RUNTIME": JSON.stringify(runtime) })],
          externals: [
            ({ request }: { request?: string }, callback: ExternalCallback) => {
              if (request?.startsWith("@/") || request?.startsWith("./sentry.")) {
                imports.add(request);
                callback(null, `commonjs ${request}`);
              } else callback();
            },
          ],
        },
        (error, stats) => {
          compiler.close((closeError) => {
            if (error || closeError) return reject(error ?? closeError);
            const errors = stats?.toJson({ all: false, errors: true }).errors ?? [];
            if (errors.length) return reject(new Error(JSON.stringify(errors)));
            resolve();
          });
        },
      );
    });
    return imports;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// The boot guard (src/instrumentation.ts) must refuse to start a production server
// that is misconfigured (missing/mismatched Supabase or required OpenAI config),
// running in demo mode, or running with local no-auth enabled. Explicit offline
// mode is the only production profile that may omit OpenAI. It must be a no-op
// outside the Node.js production runtime so dev and Edge keep working. env is
// parsed at import time, so each case re-imports the module with fresh stubs.

const MATCHING_URL = "https://sjrfecxgysukkwxsowpy.supabase.co";

const ENV_KEYS = [
  "NEXT_RUNTIME",
  "NODE_ENV",
  "NEXT_PUBLIC_DEMO_MODE",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_PROJECT_NAME",
  "OPENAI_API_KEY",
  "RAG_PROVIDER_MODE",
  "RAG_QUERY_HASH_SECRET",
  "NEXT_PUBLIC_LOCAL_NO_AUTH",
  "LOCAL_NO_AUTH",
  "PLAYWRIGHT_OFFLINE_MODE",
  "NEXT_DIST_DIR",
] as const;

async function loadInstrumentation(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  vi.resetModules();
  for (const key of ENV_KEYS) {
    vi.stubEnv(key, overrides[key]);
  }
  return import("../src/instrumentation");
}

async function loadRegister(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  const mod = await loadInstrumentation(overrides);
  return mod.register;
}

const PRODUCTION_NODE = { NEXT_RUNTIME: "nodejs", NODE_ENV: "production" } as const;

const FULLY_CONFIGURED = {
  ...PRODUCTION_NODE,
  NEXT_PUBLIC_SUPABASE_URL: MATCHING_URL,
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  OPENAI_API_KEY: "openai-key",
  RAG_QUERY_HASH_SECRET: "test-secret-at-least-16-chars",
} as const;

// The boot warm of /api/setup-status would otherwise make real Supabase calls from every case.
const warmSetupStatus = vi.hoisted(() =>
  vi.fn<(request: Request) => Promise<Response>>(async () => new Response(null)),
);
vi.mock("@/app/api/setup-status/route", () => ({ GET: warmSetupStatus }));
// The timed alert sender would otherwise start a once-a-minute timer in every production case.
const startTimedAlertSender = vi.hoisted(() => vi.fn<(createClient: () => unknown) => boolean>(() => true));
vi.mock("@/lib/alerts/timed-sender", () => ({ startTimedAlertSender }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("instrumentation boot guard", () => {
  it("excludes Node-only startup dependencies from the actual Edge webpack graph", async () => {
    const imports = await compiledRuntimeImports("edge");
    expect(imports).toContain("./sentry.edge.config");
    for (const nodeOnly of [
      "./sentry.server.config",
      "@/lib/env",
      "@/lib/rag/rag-retrieval-variants",
      "@/lib/site-content/warm-catalogue-caches",
      "@/app/api/setup-status/route",
      "@/lib/alerts/timed-sender",
      "@/lib/supabase/admin",
    ])
      expect(imports, `${nodeOnly} must not resolve in the Edge compilation`).not.toContain(nodeOnly);
  });

  it("retains Node boot dependencies in the actual Node webpack graph", async () => {
    const imports = await compiledRuntimeImports("nodejs");
    expect(imports).toContain("./sentry.server.config");
    expect(imports).toContain("@/lib/alerts/timed-sender");
    expect(imports).toContain("@/lib/supabase/admin");
    expect(imports).not.toContain("./sentry.edge.config");
  });

  it("refuses to start a production server with missing Supabase config", async () => {
    const register = await loadRegister({ ...PRODUCTION_NODE });
    await expect(register()).rejects.toThrow(/Missing server environment variables/);
  });

  it("refuses to start a production server in demo mode", async () => {
    const register = await loadRegister({ ...PRODUCTION_NODE, NEXT_PUBLIC_DEMO_MODE: "true" });
    await expect(register()).rejects.toThrow(/demo mode is enabled/);
  });

  it("allows only the isolated provider-free Playwright production profile", async () => {
    const valid = await loadRegister({
      ...PRODUCTION_NODE,
      PLAYWRIGHT_OFFLINE_MODE: "true",
      NEXT_DIST_DIR: ".next-playwright/123-456/dist",
      NEXT_PUBLIC_DEMO_MODE: "true",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
      RAG_PROVIDER_MODE: "offline",
    });
    await expect(valid()).resolves.toBeUndefined();

    const external = await loadRegister({
      ...PRODUCTION_NODE,
      PLAYWRIGHT_OFFLINE_MODE: "true",
      NEXT_DIST_DIR: ".next-playwright/123-456/dist",
      NEXT_PUBLIC_DEMO_MODE: "true",
      NEXT_PUBLIC_SUPABASE_URL: MATCHING_URL,
      RAG_PROVIDER_MODE: "offline",
    });
    await expect(external()).rejects.toThrow(/invalid isolated Playwright offline environment/);
  });

  it("refuses to start a production server with local no-auth enabled", async () => {
    const register = await loadRegister({ ...PRODUCTION_NODE, LOCAL_NO_AUTH: "true" });
    await expect(register()).rejects.toThrow(/no-auth mode is enabled/);
  });

  it.each(["auto", "openai"] as const)(
    "refuses to start a %s production server without an OpenAI key",
    async (mode) => {
      const register = await loadRegister({
        ...PRODUCTION_NODE,
        NEXT_PUBLIC_SUPABASE_URL: MATCHING_URL,
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        RAG_PROVIDER_MODE: mode,
      });
      await expect(register()).rejects.toThrow(/OPENAI_API_KEY/);
    },
  );

  it("starts an explicit offline production server without an OpenAI key", async () => {
    const register = await loadRegister({
      ...PRODUCTION_NODE,
      NEXT_PUBLIC_SUPABASE_URL: MATCHING_URL,
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      RAG_PROVIDER_MODE: "offline",
      RAG_QUERY_HASH_SECRET: "test-secret-at-least-16-chars",
    });
    await expect(register()).resolves.toBeUndefined();
  });

  it("refuses to start a production server without a query-hash secret", async () => {
    const register = await loadRegister({
      ...PRODUCTION_NODE,
      NEXT_PUBLIC_SUPABASE_URL: MATCHING_URL,
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      OPENAI_API_KEY: "openai-key",
    });
    await expect(register()).rejects.toThrow(/RAG_QUERY_HASH_SECRET/);
  });

  it("starts a fully configured production server", async () => {
    const register = await loadRegister(FULLY_CONFIGURED);
    await expect(register()).resolves.toBeUndefined();
  });

  it("warms the setup status once at boot through a non-loopback request", async () => {
    const register = await loadRegister(FULLY_CONFIGURED);
    await register();
    expect(warmSetupStatus).toHaveBeenCalledTimes(1);
    const [request] = warmSetupStatus.mock.calls[0]!;
    // A loopback host on an unmanaged port would be refused by the local-origin guard.
    expect(new URL(request.url).hostname).toBe("startup-warm.invalid");
  });

  it("starts the timed alert sender once at boot with the service client", async () => {
    const register = await loadRegister(FULLY_CONFIGURED);
    await register();
    expect(startTimedAlertSender).toHaveBeenCalledTimes(1);
    const { createAdminClient } = await import("@/lib/supabase/admin");
    expect(startTimedAlertSender).toHaveBeenCalledWith(createAdminClient);
  });

  it("does not start the timed alert sender outside production", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const register = await loadRegister({ NEXT_RUNTIME: "nodejs", NODE_ENV: "development" });
    await register();
    expect(startTimedAlertSender).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("is a no-op outside production, apart from the answer-feedback warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const register = await loadRegister({ NEXT_RUNTIME: "nodejs", NODE_ENV: "development" });
    await expect(register()).resolves.toBeUndefined();
    // No throw and no provider work — but boot does say once why answer feedback cannot
    // work without RAG_QUERY_HASH_SECRET, which is optional here (2026-09-02 audit, L44).
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("Answer feedback is disabled");
    warn.mockRestore();
  });

  it("says nothing at boot outside production when the feedback secret is configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const register = await loadRegister({
      NEXT_RUNTIME: "nodejs",
      NODE_ENV: "development",
      RAG_QUERY_HASH_SECRET: "test-query-hash-secret-at-least-16-chars",
    });
    await expect(register()).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("is a no-op on the Edge runtime", async () => {
    const register = await loadRegister({ NEXT_RUNTIME: "edge", NODE_ENV: "production" });
    await expect(register()).resolves.toBeUndefined();
  });
});
