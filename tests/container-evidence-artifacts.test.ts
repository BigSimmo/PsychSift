import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const helper = fileURLToPath(new URL("../scripts/ci/archive-container-evidence.mjs", import.meta.url));
const roots: string[] = [];
const names = [
  "sbom-app.cdx.json",
  "sbom-worker.cdx.json",
  "container-builds.dockerbuild",
  "trivy-app.report.json",
  "trivy-worker.report.json",
  "trivy-scan-summary.txt",
];
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "container-evidence-"));
  roots.push(root);
  const input = path.join(root, "input");
  mkdirSync(input);
  const bytes = names.map((name, i) => Buffer.from(`${name}\0complete evidence ${i}\n`));
  names.forEach((name, i) => writeFileSync(path.join(input, name), bytes[i]));
  return { root, input, bytes, output: path.join(root, "evidence.tar") };
}
function archive(input: string, output: string, cap = 64 * 1024 * 1024) {
  return spawnSync(process.execPath, [helper, "--input", input, "--output", output, "--max-bytes", String(cap)], {
    encoding: "utf8",
  });
}
function unpack(output: string, name: string) {
  const result = spawnSync("tar", ["-xOf", output, name]);
  expect(result.status, result.stderr.toString()).toBe(0);
  return result.stdout;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("complete bounded container evidence", () => {
  it("routes artifact helper changes through container validation", () => {
    const selected = spawnSync(
      process.execPath,
      ["scripts/ci-change-scope.mjs", "--files", "scripts/ci/archive-container-evidence.mjs", "--json"],
      { encoding: "utf8" },
    );
    expect(selected.status, selected.stderr).toBe(0);
    expect(JSON.parse(selected.stdout).container_changed).toBe(true);
    const workflow = readFileSync(new URL("../.github/workflows/docker-image.yml", import.meta.url), "utf8");
    expect(workflow.split("  workflow_dispatch:", 1)[0]).toContain(
      '      - "scripts/ci/archive-container-evidence.mjs"',
    );
  });
  it("replays every available SBOM, Trivy report, summary and complete build record byte for byte, with a manifest", () => {
    const f = fixture();
    const result = archive(f.input, f.output);
    expect(result.status, result.stderr).toBe(0);
    names.forEach((name, i) => expect(unpack(f.output, name)).toEqual(f.bytes[i]));
    const manifest = JSON.parse(unpack(f.output, "manifest.json").toString());
    expect(manifest.missing).toEqual([]);
    expect(manifest.files.map((file: { name: string }) => file.name)).toEqual(names);
    expect(manifest.files.map((file: { bytes: number }) => file.bytes)).toEqual(f.bytes.map((bytes) => bytes.length));
    expect(statSync(f.output).size).toBeLessThanOrEqual(64 * 1024 * 1024);
  });
  it("admits an exact-cap archive and refuses the same complete payload one byte below its archive size", () => {
    const f = fixture();
    expect(archive(f.input, f.output).status).toBe(0);
    const bytes = statSync(f.output).size;
    const exact = path.join(f.root, "exact.tar");
    expect(archive(f.input, exact, bytes).status).toBe(0);
    const refused = path.join(f.root, "refused.tar");
    const result = archive(f.input, refused, bytes - 1);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exceeds");
    expect(existsSync(refused)).toBe(false);
  });
  it("records missing optional SBOMs and scanner evidence explicitly while retaining complete build records", () => {
    const f = fixture();
    const optional = names.filter((name) => name !== "container-builds.dockerbuild");
    optional.forEach((name) => rmSync(path.join(f.input, name)));
    expect(archive(f.input, f.output).status).toBe(0);
    expect(unpack(f.output, names[2])).toEqual(f.bytes[2]);
    expect(JSON.parse(unpack(f.output, "manifest.json").toString()).missing).toEqual(optional);
  });
  it("refuses missing mandatory build records without producing a partial upload", () => {
    const f = fixture();
    rmSync(path.join(f.input, names[2]));
    const result = archive(f.input, f.output);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("build records are missing");
    expect(existsSync(f.output)).toBe(false);
  });
  it("refuses unsafe input entries and a cap above the fixed 64 MiB ceiling", () => {
    const f = fixture();
    rmSync(path.join(f.input, names[0]));
    mkdirSync(path.join(f.input, names[0]));
    const unsafe = archive(f.input, f.output);
    expect(unsafe.status).not.toBe(0);
    expect(unsafe.stderr).toContain("Unsupported evidence input");
    expect(existsSync(f.output)).toBe(false);
    const excessive = archive(f.input, f.output, 64 * 1024 * 1024 + 1);
    expect(excessive.status).not.toBe(0);
    expect(excessive.stderr).toContain("Invalid archive byte cap");
  });
  it("disables only implicit uploads, exports all finalized build records before pruning and gates the single bounded upload", () => {
    const workflow = readFileSync(new URL("../.github/workflows/docker-image.yml", import.meta.url), "utf8");
    expect(workflow).toContain('DOCKER_BUILD_RECORD_UPLOAD: "false"');
    expect(workflow).not.toContain("DOCKER_BUILD_SUMMARY:");
    expect(workflow).toContain("id: buildx");
    expect(workflow).toContain("if: always() && steps.buildx.outcome == 'success'");
    const command = "docker buildx history export --all --finalize --output container-builds.dockerbuild";
    expect(workflow).toContain(command);
    expect(workflow.indexOf(command)).toBeGreaterThan(workflow.indexOf("name: Build worker image"));
    expect(workflow.indexOf(command)).toBeLessThan(workflow.indexOf("docker builder prune"));
    expect(workflow).toContain(
      "node scripts/ci/archive-container-evidence.mjs --input . --output sboms --max-bytes 67108864",
    );
    expect(workflow).toContain("if: always() && steps.container-evidence.outcome == 'success'");
    expect(workflow).toContain("name: sboms");
    expect(workflow).toContain("path: sboms");
    expect(workflow).toContain("archive: false");
    const exportStep = workflow.slice(
      workflow.indexOf("      - name: Export complete build records"),
      workflow.indexOf("      - name: Verify image content contract"),
    );
    const bundleStep = workflow.slice(
      workflow.indexOf("      - name: Admit complete bounded container evidence"),
      workflow.indexOf("      - name: Upload SBOMs and complete build records"),
    );
    expect(exportStep).toContain("continue-on-error: true");
    expect(bundleStep).not.toContain("continue-on-error:");
    expect(workflow.indexOf("      - name: Admit complete bounded container evidence")).toBeGreaterThan(
      workflow.indexOf("      - name: Fail on HIGH/CRITICAL image findings outside pull requests"),
    );
    expect(bundleStep).toContain("if: always() && steps.buildx.outcome == 'success'");
    expect(bundleStep).toContain('if [ "${{ steps.build-records.outcome }}" != "success" ]; then');
    const runScript = bundleStep.split("        run: |\n")[1];
    expect(runScript).toBeDefined();
    const f = fixture();
    const shell = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
    const replay = (outcome: string) => {
      const script = runScript
        .split("\n")
        .map((line) => line.slice(10))
        .join("\n")
        .replaceAll("${{ steps.build-records.outcome }}", outcome)
        .replace(
          "node scripts/ci/archive-container-evidence.mjs --input . --output sboms --max-bytes 67108864",
          "printf admitted > sboms",
        );
      return spawnSync(shell, ["-c", script], { cwd: f.input, encoding: "utf8" });
    };
    const failedExport = replay("failure");
    expect(failedExport.status).not.toBe(0);
    expect(failedExport.stdout).toContain("Complete build-record export failed");
    expect(existsSync(path.join(f.input, "sboms"))).toBe(false);
    const successfulExport = replay("success");
    expect(successfulExport.status, successfulExport.stderr).toBe(0);
    expect(existsSync(path.join(f.input, "sboms"))).toBe(true);

    expect(workflow).toContain("retention-days: 7");
    expect(workflow).toContain("compression-level: 0");
    expect(workflow.match(/uses: actions\/upload-artifact@/g)).toHaveLength(1);
    expect(workflow).toContain("clinical-kb-app:ci --report trivy-app.report.json");
    expect(workflow).toContain("clinical-kb-worker:ci --report trivy-worker.report.json");
    expect(workflow.match(/uses: docker\/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc/g)).toHaveLength(2);
    expect(workflow.match(/push: false/g)).toHaveLength(2);
    expect(workflow).toContain("name: Verify image content contract");
    expect(workflow).toContain("name: Run app container smoke (provider-free, cap-drop)");
    expect(workflow).toContain("name: Fail on HIGH/CRITICAL image findings outside pull requests");
    expect(workflow).toContain("STATUS=unassessed");
  });
});
