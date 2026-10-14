#!/usr/bin/env node
/**
 * build-worker — bundle the ingestion worker for the production image.
 *
 * The worker previously ran through tsx (a devDependency) inside the
 * container, which forced Dockerfile.worker to ship the full dev-inclusive
 * node_modules (2026-07-13 audit, finding 12). This bundles worker/index.ts
 * and every repo-local import into a single ESM file so the runtime stage
 * needs only production node_modules.
 *
 * - `packages: "external"`: npm packages are NOT bundled; they resolve from
 *   the image's production node_modules exactly as they do under tsx today,
 *   so native/binary packages and package-internal asset loading keep working.
 * - `server-only` alias: src/lib/env.ts starts with `import "server-only"`,
 *   which throws outside the Next bundler. run-tsx.mjs stubs it with a module
 *   hook at runtime; this bundle resolves it to the same stub at build time
 *   (guarded by tests/tsx-server-only-runner.test.ts).
 * - `.mjs` output: the repo's package.json has no `"type": "module"`, so the
 *   extension is what marks the bundle as ESM.
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

/**
 * Shared with tests/worker-bundle.test.ts, which resolve-checks externals.
 * @type {import("esbuild").BuildOptions}
 */
export const workerBuildOptions = {
  entryPoints: ["worker/index.ts"],
  outfile: "dist/worker/index.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
  sourcemap: true,
  logLevel: "info",
  alias: {
    "server-only": "./tests/stubs/server-only.ts",
    // This decoder is build-only in the locked tree. Bundle its pure JS rather
    // than leaving imports that production npm ci --omit=dev cannot resolve.
    entities: require.resolve("entities"),
    "entities/decode": require.resolve("entities/decode"),
    // next's package.json has no `exports` map, so Node's ESM resolver needs
    // the explicit file: `import "next/server"` boots under tsx/Turbopack but
    // throws ERR_MODULE_NOT_FOUND under plain `node`. src/lib/http.ts pulls
    // this in. tests/worker-bundle.test.ts resolve-checks every external.
    "next/server": "next/server.js",
  },
};

export const validateRuntimeBuildOptions = {
  ...workerBuildOptions,
  entryPoints: ["worker/validate-runtime.ts"],
  outfile: "dist/worker/validate-runtime.mjs",
};

function extractExternals(metafile) {
  const externals = new Set();
  for (const output of Object.values(metafile.outputs)) {
    for (const imported of output.imports ?? []) {
      if (imported.external) externals.add(imported.path);
    }
  }
  return [...externals].sort();
}

if (isDirectEntrypoint(import.meta.url)) {
  const indexResult = await build({ ...workerBuildOptions, metafile: true });
  const externals = extractExternals(indexResult.metafile ?? {});
  writeFileSync("dist/worker/externals.json", `${JSON.stringify(externals, null, 2)}\n`);
  await build(validateRuntimeBuildOptions);
}
