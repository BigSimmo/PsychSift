// Runs on the client after the HTML loads but before React hydration (see
// node_modules/next/dist/docs/.../instrumentation-client.md), so this preempts
// the first client-side Zod schema compile.
//
// Why: the production CSP (src/lib/security-headers.ts) has no 'unsafe-eval'.
// Zod 4's JIT compiler probes for eval with `new Function("")` inside a try/catch
// (node_modules/zod/src/v4/core/util.ts) — the throw is swallowed and validation
// still works, but the browser reports the caught eval as a
// `securitypolicyviolation` on every page. Disabling JIT skips the probe entirely
// (validation stays correct, just interpreted rather than compiled). The server
// has no CSP, so it keeps the faster JIT path — this is client-only by design.
//
// Zod's `config()` only merges into `globalThis.__zod_globalConfig`, which every
// later schema reads. Writing that object directly keeps Zod itself (about 15 KB
// gzip) out of every page's first load. tests/instrumentation-client-zod.test.ts
// proves `config()` sees the flag, so a Zod upgrade that moves it fails loudly.
const zodGlobal = globalThis as { __zod_globalConfig?: Record<string, unknown> };
zodGlobal.__zod_globalConfig ??= {};
zodGlobal.__zod_globalConfig.jitless = true;

export {};
