import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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

  it("removes worker package managers and mount-helper privilege bits without changing its runtime base", () => {
    const dockerfile = read("Dockerfile.worker");
    const contract = read("scripts/check-image-content-contract.mjs");
    expect(dockerfile).toContain("FROM node-base AS runner");
    expect(dockerfile).toContain("chmod u-s,g-s /usr/bin/mount /usr/bin/umount");
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
      "gcr.io/distroless/cc-debian13:nonroot@sha256:e792ab3d241a468a4fd7519ddbbebe66b49b5f365771716ea688ad40b6c6f1c2",
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
    expect(workflow).toContain("RAG_QUERY_HASH_SECRET=smoke-test-hash-secret");
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
    expect(smoke).toContain('exitCode === "137"');
    expect(smoke).toContain("State.Running");
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
