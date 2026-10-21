import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { appHealthProbe, isCleanContainerExit } from "../scripts/app-container-smoke.mjs";
import {
  imageListingProbe,
  imagePathAbsenceProbe,
  imagePrivilegeBitsProbe,
  isExpectedAppCommand,
} from "../scripts/check-image-content-contract.mjs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("container delivery contract", () => {
  it("parses Compose without duplicate keys and keeps the worker health port aligned", () => {
    // Reuse the existing transitive parser as other CI contracts do. json:false
    // rejects duplicate mapping keys instead of silently accepting the last port.
    const compose = createRequire(import.meta.url)("js-yaml").load(read("docker-compose.yml"), { json: false }) as {
      services: {
        worker: {
          environment: Record<string, string>;
          healthcheck: { test: string[] };
        };
      };
    };
    const worker = compose.services.worker;
    expect(worker.environment.WORKER_HEALTH_PORT).toBe("3901");
    expect(worker.healthcheck.test.slice(0, 3)).toEqual(["CMD", "node", "-e"]);
    const healthUrl = new URL(worker.healthcheck.test[3].match(/fetch\(['"]([^'"]+)['"]\)/)?.[1] ?? "");
    expect(healthUrl.hostname).toBe("127.0.0.1");
    expect(healthUrl.port).toBe(worker.environment.WORKER_HEALTH_PORT);
    expect(healthUrl.pathname).toBe("/health");
  });

  it.each([
    "eval/docling/requirements.txt",
    "eval/docling/verify-model-artifacts.mjs",
    "eval/docling/model-artifacts.json",
  ])("builds the worker for its copied Docling input %s", (input) => {
    expect(read("Dockerfile.worker")).toContain(input);
    expect(execFileSync("node", ["scripts/ci-change-scope.mjs", "--files", input], { encoding: "utf8" })).toContain(
      "container_changed=true",
    );
    expect(read(".github/workflows/docker-image.yml")).toContain(`      - "${input}"`);
  });

  it("does not rebuild containers for Docling lab documentation alone", () => {
    expect(
      execFileSync("node", ["scripts/ci-change-scope.mjs", "--files", "eval/docling/README.md"], { encoding: "utf8" }),
    ).toContain("container_changed=false");
  });

  it("routes container-affecting pull requests through the required CI aggregate", () => {
    const ci = read(".github/workflows/ci.yml");
    const imageWorkflow = read(".github/workflows/docker-image.yml");

    expect(imageWorkflow).toMatch(/^\s*workflow_call:\s*$/m);
    expect(imageWorkflow).not.toMatch(/^\s*pull_request:\s*$/m);
    expect(imageWorkflow).toContain("group: docker-image-${{ github.ref }}");
    expect(imageWorkflow).not.toContain("group: ${{ github.workflow }}-${{ github.ref }}");
    expect(ci).toContain("container-images:");
    expect(ci).toContain("uses: ./.github/workflows/docker-image.yml");
    expect(ci).toMatch(/needs:\s*\[[^\]]*container-images[^\]]*\]/);
    expect(ci).toContain("CONTAINER_CHANGED: ${{ needs.changes.outputs.container_changed }}");
    expect(ci).toContain("CONTAINER_RESULT: ${{ needs.container-images.result }}");
  });

  it("validates Python syntax and unit behavior while building the worker image", () => {
    const dockerfile = read("Dockerfile.worker");

    expect(dockerfile).toContain("python -m compileall -q worker/python");
    expect(dockerfile).toContain('python -m unittest discover -s worker/python -p "test_*.py"');
  });

  it("keeps the worker's locked Python minor and non-root contract on its pinned runtime", () => {
    const dockerfile = read("Dockerfile.worker");
    const contract = read("scripts/check-image-content-contract.mjs");
    expect(dockerfile).toMatch(/^FROM python:3\.11-slim-trixie@sha256:[a-f0-9]{64} AS python-runtime-base$/m);
    expect(dockerfile).toContain("FROM python-runtime-base AS runner");
    expect(dockerfile).toContain("COPY --from=node-base /usr/local/bin/node /usr/local/bin/node");
    const runner = dockerfile.split("FROM python-runtime-base AS runner")[1];
    expect(runner).not.toMatch(/apt-get install[^\n]*\bpython3(?:-venv)?\b/);
    expect(runner).toContain("sys.version_info[:2] == (3, 11)");
    expect(runner).toContain("groupadd --gid 1000 node");
    expect(runner).toContain("useradd --uid 1000 --gid node");
    expect(runner).toContain("USER node");
    expect(runner).toContain("python3 -m pip uninstall -y setuptools");
    expect(runner).toContain("ge 5.40.1-6+deb13u1");
    expect(runner).toContain("for helper in /usr/bin/mount /usr/bin/umount");
    expect(runner).toContain('if [ -e "$helper" ]; then chmod u-s,g-s "$helper"; fi');
    expect(dockerfile).toContain("/usr/local/lib/node_modules/npm /opt/yarn-*");
    for (const executable of ["npm", "npx", "yarn", "yarnpkg"]) {
      expect(dockerfile).toContain(`/usr/local/bin/${executable}`);
      expect(contract).toContain(`"/usr/local/bin/${executable}"`);
    }
    expect(contract).toContain("assertPathUnprivileged(WORKER_IMAGE, path)");
    expect(contract).toContain('assertListingClean(WORKER_IMAGE, "/opt", "^yarn-"');
    expect(dockerfile).toContain("COPY worker/python/ocr-model-LICENSE.txt /opt/psychsift-ocr-models/LICENSE");
    expect(dockerfile).toContain('model = model_dir / "Latin.traineddata"');
  });

  it("limits worker backports to the repaired curl and HTTP/3 library set", () => {
    const worker = read("Dockerfile.worker");
    expect(worker).toContain("signed-by=/usr/share/keyrings/debian-archive-keyring.gpg");
    expect(worker).toContain("Package: libcurl4t64 libnghttp3-9 libngtcp2-16 libngtcp2-crypto-ossl0");
    expect(worker).toMatch(/'Package: \*'\s*\\\n\s*'Pin: release n=trixie-backports'\s*\\\n\s*'Pin-Priority: -1'/);
    expect(worker).not.toContain("-t trixie-backports");
    for (const pin of [
      "libcurl4t64=8.21.0-2~bpo13+1",
      "libnghttp3-9=1.15.0-1~bpo13+1",
      "libngtcp2-16=1.22.1-1~bpo13+1",
      "libngtcp2-crypto-ossl0=1.22.1-1~bpo13+1",
    ]) {
      expect(worker).toContain(pin);
    }
    expect(worker).toContain("ge 8.21.0-2~bpo13+1");
    expect(worker).toContain("ge 1.22.1-1~bpo13+1");
  });

  it("builds pinned native security repairs with normal package provenance and runtime acceptance", () => {
    const worker = read("Dockerfile.worker");
    for (const component of ["util-linux", "tesseract", "ncurses", "libxml2"]) {
      expect(worker).toContain(`AS native-${component}`);
      expect(worker).toContain(`build_security_debs.py ${component}`);
      expect(worker).toContain(`COPY --from=native-${component} /out/ /tmp/worker-native-debs/`);
    }
    expect(worker).toContain("test_build_security_debs.py");
    expect(worker).toContain("--no-remove");
    expect(worker).toContain("/tmp/worker-native-debs/*.deb");
    expect(worker).toContain("--verify-installed /usr/share/psychsift/native-security");
    expect(worker).toContain("timeout 180 /opt/docling-venv/bin/python /tmp/check-native-docling.py");
    expect(worker.indexOf("USER node")).toBeLessThan(worker.indexOf("RUN timeout 180"));
  });

  it.skipIf(process.platform === "win32")(
    "rejects either mount privilege bit and accepts stripped or absent helpers",
    () => {
      const directory = mkdtempSync(join(tmpdir(), "image-privilege-contract-"));
      try {
        const helper = join(directory, "mount");
        writeFileSync(helper, "synthetic");
        for (const mode of [0o4755, 0o2755, 0o6755, 0o755]) {
          chmodSync(helper, mode);
          const result = spawnSync(process.execPath, ["-e", imagePrivilegeBitsProbe(helper)], {
            encoding: "utf8",
            timeout: 2000,
          });
          expect(result.error).toBeUndefined();
          expect(result.signal).toBeNull();
          expect(result.status).toBe(mode & 0o6000 ? 1 : 0);
        }
        const missing = spawnSync(process.execPath, ["-e", imagePrivilegeBitsProbe(join(directory, "absent"))]);
        expect(missing.status).toBe(0);
        const unreadable = spawnSync(process.execPath, ["-e", imagePrivilegeBitsProbe(join(helper, "invalid"))]);
        expect(unreadable.status).not.toBe(0);
        expect(unreadable.stderr.toString()).toContain("ENOTDIR");
      } finally {
        rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
  );

  it("forwards termination signals to the app process", () => {
    const command = JSON.parse(/^CMD (\[.+\])$/m.exec(read("Dockerfile"))?.[1] ?? "null");
    expect(isExpectedAppCommand(command)).toBe(true);
    expect(isExpectedAppCommand(["sh", "-c", "echo next start"])).toBe(false);
    expect(isExpectedAppCommand(["node", "node_modules/next/dist/bin/next", "dev"])).toBe(false);
  });

  it("keeps the minimal app runtime and pre-deploy shell pinned and inventoried", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain(
      "gcr.io/distroless/cc-debian13:nonroot@sha256:b7e81cb1af38d9345680e68bcf564d388f96304e25222030fc8c051faf8565b3",
    );
    expect(dockerfile).toContain(
      "node:24-trixie-slim@sha256:7f486cabe892bff8fef04c0f7da8dba84a560be3e4e2740b7a86afc57ebec315",
    );
    expect(dockerfile).toContain("COPY --from=app-node-runtime-base /usr/local/bin/node /usr/local/bin/node");
    expect(dockerfile).toContain("COPY --from=app-node-runtime-base /usr/bin/dash /bin/sh");
    expect(dockerfile).toContain("dpkg-query --status dash > /tmp/app-runtime-dash.status");
    expect(dockerfile).toContain("/var/lib/dpkg/status.d/dash");
    expect(dockerfile).toContain("--chown=1000:1000 /tmp/app-runtime-home/ /home/node/");
    expect(dockerfile).toContain("ENV HOME=/home/node");
    const health = JSON.parse(/HEALTHCHECK[^\n]*\\\n\s+CMD (\[.+\])/.exec(dockerfile)?.[1] ?? "null");
    expect(health?.slice(0, 2)).toEqual(["node", "-e"]);
    expect(health?.[2]).toContain("process.env.PORT||3000");
  });

  it("runs absence probes without shell tools and rejects present paths", () => {
    const directory = mkdtempSync(join(tmpdir(), "image-content-contract-"));
    try {
      const present = join(directory, "secret.pem");
      writeFileSync(present, "synthetic");
      for (const [path, expected] of [
        [present, 1],
        [join(directory, "absent"), 0],
      ] as const) {
        const result = spawnSync(process.execPath, ["-e", imagePathAbsenceProbe(path)], {
          encoding: "utf8",
          timeout: 2000,
        });
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status).toBe(expected);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it.skipIf(process.platform === "win32")("rejects a dangling symlink as a present path", () => {
    const directory = mkdtempSync(join(tmpdir(), "image-content-symlink-"));
    try {
      const link = join(directory, "secret.pem");
      symlinkSync(join(directory, "missing-target"), link);
      const result = spawnSync(process.execPath, ["-e", imagePathAbsenceProbe(link)], {
        encoding: "utf8",
        timeout: 2000,
      });
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(1);
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("reports secret filenames and fails closed on an unreadable listing", () => {
    const directory = mkdtempSync(join(tmpdir(), "image-content-listing-"));
    try {
      const file = join(directory, ".private.pem");
      writeFileSync(file, "synthetic");
      writeFileSync(join(directory, "safe.txt"), "synthetic");
      const listed = spawnSync(process.execPath, ["-e", imageListingProbe(directory, "\\.pem$")], {
        encoding: "utf8",
        timeout: 2000,
      });
      expect(listed.error).toBeUndefined();
      expect(listed.status).toBe(0);
      expect(listed.stdout.trim()).toBe(".private.pem");
      const invalid = spawnSync(process.execPath, ["-e", imageListingProbe(file, "\\.pem$")], {
        encoding: "utf8",
        timeout: 2000,
      });
      expect(invalid.error).toBeUndefined();
      expect(invalid.signal).toBeNull();
      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toContain("ENOTDIR");
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("lets CI Docker app builds opt out of the local low-RAM hard-fail", () => {
    // Hosted buildx runners often report ~7–8 GiB; local Docker Desktop keeps the hard-fail.
    expect(read("Dockerfile")).toMatch(/ARG ALLOW_LOW_RAM_BUILD=0/);
    expect(read(".github/workflows/docker-image.yml")).toMatch(/ALLOW_LOW_RAM_BUILD=1/);
  });

  it("requires NEXT_PUBLIC_SUPABASE_URL as an explicit app build arg instead of defaulting to production", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toMatch(/^ARG NEXT_PUBLIC_SUPABASE_URL\s*$/m);
    expect(dockerfile).not.toMatch(/^ARG NEXT_PUBLIC_SUPABASE_URL=/m);
    expect(dockerfile).toMatch(/if \[ -z "\$\{NEXT_PUBLIC_SUPABASE_URL\}" \]; then[\s\S]*?exit 1/);
    expect(read(".github/workflows/docker-image.yml")).toMatch(
      /^\s*NEXT_PUBLIC_SUPABASE_URL=https:\/\/\S+\.supabase\.co\s*$/m,
    );
    expect(read("scripts/build-multiplatform.sh")).toContain('--build-arg "NEXT_PUBLIC_SUPABASE_URL=');
  });

  it("keeps sensitive and machine-local files out of Docker build contexts", () => {
    const dockerignore = read(".dockerignore").split(/\r?\n/);

    for (const entry of [
      "*.pem",
      "*.key",
      ".local",
      ".codex",
      ".mcp.json",
      "supabase/.temp",
      "tmp",
      "artifacts",
      ".next-playwright",
    ]) {
      expect(dockerignore, `missing Docker exclusion: ${entry}`).toContain(entry);
    }
  });

  it("pins the Node base image to a multi-platform digest", () => {
    const dockerfile = read("Dockerfile");
    const worker = read("Dockerfile.worker");
    const digest = /sha256:[a-f0-9]{64}/;

    expect(dockerfile).toMatch(digest);
    expect(dockerfile).toContain("FROM node-base");
    expect(worker).toMatch(digest);
    expect(worker).toContain("FROM node-base");
  });

  it("requires both images to stop on SIGTERM", () => {
    expect(read("Dockerfile")).toContain("STOPSIGNAL SIGTERM");
    expect(read("Dockerfile.worker")).toContain("STOPSIGNAL SIGTERM");
  });

  it("bakes the deploy pre-deploy migration gate's manifest and scripts into both runner stages", () => {
    // supabase/migrations is only in the build context, so the manifest is
    // written during the build stage and both gate scripts are copied into
    // the runner — see docs/worker-deploy-runbook.md §0 and
    // tests/deploy-migration-gate.test.ts for the gate's own behaviour.
    for (const dockerfile of [read("Dockerfile"), read("Dockerfile.worker")]) {
      expect(dockerfile).toContain("node scripts/deploy/write-migration-manifest.mjs");
      expect(dockerfile).toContain(
        "COPY --from=build /app/deploy/expected-migrations.json ./deploy/expected-migrations.json",
      );
      expect(dockerfile).toContain(
        "COPY --from=build /app/scripts/deploy/await-migrations.mjs ./scripts/deploy/await-migrations.mjs",
      );
      expect(dockerfile).toContain(
        "COPY --from=build /app/scripts/deploy/migration-versions.mjs ./scripts/deploy/migration-versions.mjs",
      );
    }
  });

  it("keeps Railway Dockerfiles portable across service IDs", () => {
    expect(read("Dockerfile")).not.toContain("--mount=type=cache");
    expect(read("Dockerfile.worker")).not.toContain("--mount=type=cache");
  });

  it("does not fail image verification when the optional GitHub cache export is unavailable", () => {
    const workflow = read(".github/workflows/docker-image.yml");
    expect(workflow.match(/cache-to:.*ignore-error=true/g)).toHaveLength(2);
    // Layer export is main-only, so PR builds cannot fill the repository's Actions cache.
    for (const line of workflow.match(/^\s*cache-to:.*$/gm) ?? []) {
      expect(line).toContain("github.ref == 'refs/heads/main' && github.event_name != 'pull_request' && 'type=gha,");
      expect(line).toContain("|| ''");
    }
    expect(workflow.match(/cache-(?:from|to):.*timeout=2m/g)).toHaveLength(4);
  });

  it("does not bake pip's download cache into the final worker image", () => {
    expect(read("Dockerfile.worker")).toContain("pip install --no-cache-dir");
  });

  it("runs a provider-free runtime validator inside the worker image", () => {
    expect(read("Dockerfile.worker")).toContain("dist/worker/validate-runtime.mjs");
  });

  it("self-tests the deploy migration gate inside both images, offline, in CI", () => {
    const workflow = read(".github/workflows/docker-image.yml");
    expect(workflow).toContain(
      "--network=none --entrypoint node clinical-kb-app:ci scripts/deploy/await-migrations.mjs --self-test",
    );
    expect(workflow).toContain(
      "--network=none --entrypoint node clinical-kb-worker:ci scripts/deploy/await-migrations.mjs --self-test",
    );
  });

  it("includes the new Docker hardening scripts", () => {
    expect(read(".github/workflows/docker-image.yml")).toContain("check-image-content-contract");
    expect(read(".github/workflows/docker-image.yml")).toContain("app-container-smoke");
  });

  it("supplies RAG_QUERY_HASH_SECRET so production instrumentation can boot in smoke", () => {
    const smoke = read("scripts/app-container-smoke.mjs");
    const workflow = read(".github/workflows/docker-image.yml");
    expect(smoke).toContain("RAG_QUERY_HASH_SECRET=smoke-test-hash-secret");
    expect(workflow).toContain("run: node scripts/app-container-smoke.mjs");
  });

  it.each([
    [200, '{"status":"ok","checks":{"openaiConfig":"skipped","supabaseConfig":"ok"},"demoMode":false}', 0],
    [503, '{"status":"ok","checks":{"openaiConfig":"skipped","supabaseConfig":"ok"},"demoMode":false}', 1],
    [201, '{"status":"ok"}', 1],
    [200, "not JSON", 1],
    [200, "", 1],
    [200, "null", 1],
    [200, "[]", 1],
  ])("requires HTTP 200 and object JSON in the real health probe (HTTP %i, %s)", (status, body, exitCode) => {
    const script = `global.fetch = async () => ({ status: ${status}, json: async () => JSON.parse(${JSON.stringify(body)}) });\n${appHealthProbe("http://127.0.0.1:3000/api/health")}`;
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(exitCode);
    if (exitCode === 0) expect(JSON.parse(result.stdout).status).toBe("ok");
  });

  it.skipIf(process.platform === "win32").each([false, true])(
    "starts the actual image CMD read-only and checks health, PID 1 and graceful stop (compatibility flag=%s)",
    (explicitReadOnlyFlag) => {
      const dir = mkdtempSync(join(tmpdir(), "app-container-command-"));
      try {
        const invocations = join(dir, "docker.jsonl");
        const docker = join(dir, "docker");
        writeFileSync(
          docker,
          `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SMOKE_TEST_INVOCATIONS, JSON.stringify(args) + '\\n');
if (args[0] === 'run' && process.env.SMOKE_TEST_START_FAILURE === '1') { console.error('synthetic startup failure'); process.exit(125); }
if (args[0] === 'exec') console.log(args.at(-1).includes('/proc/1/cmdline') ? 'next-server (v16.0.0)' : (process.env.SMOKE_TEST_HEALTH_BODY || JSON.stringify({status:'ok', checks:{openaiConfig:'skipped',supabaseConfig:'ok'},demoMode:false})));
if (args[0] === 'inspect') {
  if (process.env.SMOKE_TEST_INSPECT_SIGNAL === '1') process.kill(process.pid, 'SIGTERM');
  console.log(process.env.SMOKE_TEST_INSPECT_OUTPUT ?? 'false false 0');
  process.exit(Number(process.env.SMOKE_TEST_INSPECT_STATUS ?? '0'));
}
`,
          { mode: 0o755 },
        );
        const env = {
          ...process.env,
          PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`,
          SMOKE_TEST_INVOCATIONS: invocations,
        };
        const helper = fileURLToPath(new URL("../scripts/app-container-smoke.mjs", import.meta.url));
        const args = [helper, ...(explicitReadOnlyFlag ? ["--read-only"] : [])];
        const result = spawnSync(process.execPath, args, { encoding: "utf8", env });
        expect(result.status, result.stderr).toBe(0);
        const calls = readFileSync(invocations, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as string[]);
        const start = calls.find((call) => call[0] === "run")!;
        expect(start).toContain("--network=none");
        expect(start).toContain("--cap-drop=ALL");
        expect(start).toContain("no-new-privileges:true");
        expect(start).toContain("--read-only");
        expect(start.at(-1)).toBe("clinical-kb-app:ci");
        expect(calls.some((call) => call[0] === "exec" && call.at(-1)?.includes("fetch("))).toBe(true);
        expect(calls.some((call) => call[0] === "exec" && call.at(-1)?.includes("/proc/1/cmdline"))).toBe(true);
        expect(calls.some((call) => call[0] === "stop" && call.includes("30"))).toBe(true);
        expect(calls.some((call) => call[0] === "inspect")).toBe(true);
        const failed = spawnSync(process.execPath, args, {
          encoding: "utf8",
          env: { ...env, SMOKE_TEST_START_FAILURE: "1" },
        });
        expect(failed.status).toBe(1);
        expect(failed.stderr).toContain("synthetic startup failure");
        const unhealthy = spawnSync(process.execPath, args, {
          encoding: "utf8",
          env: { ...env, SMOKE_TEST_HEALTH_BODY: "{}" },
        });
        expect(unhealthy.status).toBe(1);
        expect(unhealthy.stderr).toContain("App health status not ok");
        for (const exitCode of [143]) {
          const stopped = spawnSync(process.execPath, args, {
            encoding: "utf8",
            env: { ...env, SMOKE_TEST_INSPECT_OUTPUT: `false false ${exitCode}` },
          });
          expect(stopped.status, stopped.stderr).toBe(0);
          expect(stopped.stdout).toContain("App smoke passed");
        }
        for (const inspection of [
          { SMOKE_TEST_INSPECT_STATUS: "1", SMOKE_TEST_INSPECT_OUTPUT: "false false 0" },
          { SMOKE_TEST_INSPECT_SIGNAL: "1" },
          { SMOKE_TEST_INSPECT_OUTPUT: "" },
          { SMOKE_TEST_INSPECT_OUTPUT: "malformed" },
          { SMOKE_TEST_INSPECT_OUTPUT: "false false -1" },
          { SMOKE_TEST_INSPECT_OUTPUT: "false false 256" },
          { SMOKE_TEST_INSPECT_OUTPUT: "false false 0 extra" },
          { SMOKE_TEST_INSPECT_OUTPUT: "False false 0" },
          { SMOKE_TEST_INSPECT_OUTPUT: "false false 137" },
          { SMOKE_TEST_INSPECT_OUTPUT: "false false 1" },
          { SMOKE_TEST_INSPECT_OUTPUT: "false false 139" },
          { SMOKE_TEST_INSPECT_OUTPUT: "false false 255" },
          { SMOKE_TEST_INSPECT_OUTPUT: "true false 0" },
          { SMOKE_TEST_INSPECT_OUTPUT: "false true 0" },
        ]) {
          const rejected = spawnSync(process.execPath, args, {
            encoding: "utf8",
            env: { ...env, ...inspection },
          });
          expect(rejected.status, JSON.stringify(inspection)).toBe(1);
          expect(rejected.stdout).not.toContain("App smoke passed");
          expect(rejected.stderr).toContain("Container shutdown inspection failed");
        }
      } finally {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
  );

  it("requires a real read-only app startup rather than a fetch-only replacement command", () => {
    const smoke = read("scripts/app-container-smoke.mjs");
    const workflow = read(".github/workflows/docker-image.yml");
    const step = workflow.match(/- name: Run app container smoke[\s\S]*?(?=\n      - name:)/)?.[0];
    expect(step).toContain("run: node scripts/app-container-smoke.mjs");
    expect(step).not.toMatch(/continue-on-error|\|\| true/);
    expect(workflow).not.toContain("Read-only runtime check (advisory)");
    for (const flag of ["--read-only", "--network=none", "--cap-drop=ALL", "no-new-privileges:true"]) {
      expect(smoke).toContain(JSON.stringify(flag));
    }
    expect(smoke).toContain('"-d"');
    expect(smoke).toContain("const health = await waitForHealth()");
  });

  it("accepts Next 16 next-server PID 1 in app container smoke", () => {
    const smoke = read("scripts/app-container-smoke.mjs");
    expect(smoke).toContain("next start");
    expect(smoke).toContain("next-server");
    expect(smoke).toContain("pid1LooksLikeNextServer");
  });

  it("avoids Docker-socket mounts and creates tmp/ before lock-diff diagnostics", () => {
    const trivy = read("scripts/trivy-image-scan.mjs");
    const pythonLock = read("scripts/check-worker-python-lock.mjs");
    const runtime = read("worker/validate-runtime.ts");
    const sleep = read("worker/runtime-control.ts");

    expect(trivy).not.toContain("/var/run/docker.sock");
    expect(trivy).toContain("docker save");
    expect(trivy).toContain("optionValue");
    expect(pythonLock).toContain('mkdirSync("tmp", { recursive: true })');
    expect(runtime).toContain("pathToFileURL(options.externalsPath)");
    expect(runtime).not.toContain("file://${options.externalsPath}");
    expect(runtime).toContain("builtinModules");
    // Single settle path — no stray Promise.race timer that outlives stop().
    expect(sleep).not.toMatch(/Promise\.race\(\[\s*new Promise/);
  });

  it("fails closed on missing Cmd, filesystem probe errors, and SIGKILL smoke exits", () => {
    const contract = read("scripts/check-image-content-contract.mjs");
    const smoke = read("scripts/app-container-smoke.mjs");
    expect(contract).toContain('cmd === "null"');
    expect(contract).toContain("assertListingClean");
    expect(contract).toContain('"/app/worker/python"');
    expect(contract).not.toContain('"--entrypoint", "sh"');
    expect(contract).not.toContain('"--entrypoint", "test"');
    expect(smoke).toContain("isCleanContainerExit(inspectResult)");
    expect(smoke).toContain("State.Running");
  });

  it.each([
    [{ status: 0, stdout: "false false 0\n" }, true],
    [{ status: 0, stdout: "false false 143\n" }, true],
    [{ status: 1, stdout: "false false 0\n" }, false],
    [{ status: 0, stdout: "" }, false],
    [{ status: 0, stdout: "false false" }, false],
    [{ status: 0, stdout: "false false 0 extra" }, false],
    [{ status: 0, stdout: "false false 1\n" }, false],
    [{ status: 0, stdout: "false false 137\n" }, false],
    [{ status: 0, stdout: "true false 0\n" }, false],
    [{ status: 0, stdout: "false true 0\n" }, false],
    [{ status: null, signal: "SIGTERM", stdout: "false false 0\n" }, false],
  ])("validates complete shutdown evidence %j", (result, expected) => {
    expect(isCleanContainerExit(result)).toBe(expected);
  });

  it("keeps Trivy SBOM and vulnerability steps non-blocking in CI", () => {
    const workflow = read(".github/workflows/docker-image.yml");
    expect(workflow).toMatch(/Generate SBOMs[\s\S]*?continue-on-error:\s*true/);
    expect(workflow).toMatch(/Vulnerability scan \(HIGH,CRITICAL\)[\s\S]*?continue-on-error:\s*true/);
    expect(workflow).toContain("if-no-files-found: warn");
  });

  it("builds the image on main/release pushes whenever a container input changes, and only then", () => {
    const workflow = read(".github/workflows/docker-image.yml");
    const pushBlock = /^  push:\n((?:    .*\n)+)/m.exec(workflow)?.[1] ?? "";
    expect(pushBlock).toContain('branches: [main, "release/**"]');
    const globs = [...pushBlock.matchAll(/^      - "([^"]+)"$/gm)].map((match) => match[1]);
    expect(globs.length).toBeGreaterThan(10);
    const globToRegExp = (glob: string) =>
      new RegExp(
        `^${glob
          .split(/(\*\*|\*)/)
          .map((part) => (part === "**" ? ".*" : part === "*" ? "[^/]*" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")))
          .join("")}$`,
      );
    const matchers = globs.map(globToRegExp);
    const triggersBuild = (file: string) => matchers.some((matcher) => matcher.test(file));

    // Every path that sends a PR through the container job (containerPatterns in
    // ci-change-scope.mjs) must also rebuild on main, or main could stop proving
    // an input the PR side treats as container-relevant.
    const scope = read("scripts/ci-change-scope.mjs");
    const patternBlock = /const containerPatterns = \[([\s\S]*?)\n\];/.exec(scope)?.[1] ?? "";
    const literals = [...patternBlock.matchAll(/^\s*"([^"]+)",/gm)].map((match) => match[1]);
    const regexes = [...patternBlock.matchAll(/^\s*\/(.+)\/,\s*$/gm)].map((match) => new RegExp(match[1]));
    expect(literals.length).toBeGreaterThan(10);
    expect(regexes.length).toBeGreaterThanOrEqual(3);
    const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
    for (const literal of literals) {
      const covered = tracked.filter((file) => file === literal || file.startsWith(`${literal}/`));
      for (const file of covered.length ? covered : [literal]) {
        expect(triggersBuild(file), `${file} (containerPatterns "${literal}") must rebuild the image on main`).toBe(
          true,
        );
      }
    }
    for (const regex of regexes) {
      for (const file of tracked.filter((candidate) => regex.test(candidate))) {
        expect(triggersBuild(file), `${file} (containerPatterns ${regex}) must rebuild the image on main`).toBe(true);
      }
    }

    // Files the Dockerfiles COPY by name are build inputs even where the PR
    // classifier does not list them.
    for (const dockerfile of ["Dockerfile", "Dockerfile.worker"]) {
      for (const match of read(dockerfile).matchAll(/^COPY (?!--from)(.+) \S+$/gm)) {
        for (const source of match[1].split(/\s+/)) {
          if (source === ".") continue;
          expect(triggersBuild(source), `${dockerfile} copies ${source}; it must rebuild the image on main`).toBe(true);
        }
      }
    }

    // Source-only and docs-only merges no longer rebuild (Railway builds them itself).
    for (const file of ["src/app/page.tsx", "docs/deployment-architecture.md", "tests/ui-smoke.spec.ts"]) {
      expect(triggersBuild(file), `${file} should not rebuild the image on main`).toBe(false);
    }
    // A daily schedule still builds, smokes and scans main.
    expect(workflow).toMatch(/^\s*- cron: "0 18 \* \* \*"$/m);
  });
});
