import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("container delivery contract", () => {
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

  it("forwards termination signals to the app process", () => {
    expect(read("Dockerfile")).toContain("exec node node_modules/next/dist/bin/next start");
  });

  it("lets CI Docker app builds opt out of the local low-RAM hard-fail", () => {
    // Hosted buildx runners often report ~7–8 GiB; local Docker Desktop keeps the hard-fail.
    expect(read("Dockerfile")).toMatch(/ARG ALLOW_LOW_RAM_BUILD=0/);
    expect(read(".github/workflows/docker-image.yml")).toMatch(/ALLOW_LOW_RAM_BUILD=1/);
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

  it("fails closed on missing Cmd, shell listing errors, and SIGKILL smoke exits", () => {
    const contract = read("scripts/check-image-content-contract.mjs");
    const smoke = read("scripts/app-container-smoke.mjs");
    expect(contract).toContain('cmd === "null"');
    expect(contract).toContain("assertShellListingClean");
    expect(contract).toContain("/app/worker/python/test_*.py");
    expect(smoke).toContain('exitCode === "137"');
    expect(smoke).toContain("State.Running");
  });

  it("keeps Trivy SBOM and vulnerability steps non-blocking in CI", () => {
    const workflow = read(".github/workflows/docker-image.yml");
    expect(workflow).toMatch(/Generate SBOMs[\s\S]*?continue-on-error:\s*true/);
    expect(workflow).toMatch(/Vulnerability scan \(HIGH,CRITICAL\)[\s\S]*?continue-on-error:\s*true/);
    expect(workflow).toContain("if-no-files-found: warn");
  });
});
