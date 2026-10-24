import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { workerPythonLockTargets } from "../scripts/worker-python-lock-config.mjs";

describe("worker Python lockfile", () => {
  it("includes production setuptools in the lock while retaining the split Cloud input", () => {
    expect(workerPythonLockTargets.production.includeUnsafe).toBe(true);
    expect(workerPythonLockTargets.production.inputFile).toBe("worker/python/requirements.in");
    expect(workerPythonLockTargets.cloud.inputFile).toBe("worker/python/requirements-cloud.in");
    expect(readFileSync(workerPythonLockTargets.production.inputFile, "utf8")).toMatch(/^setuptools>=84\.1\.0$/m);
    expect(readFileSync(workerPythonLockTargets.production.outputFile, "utf8")).toContain(
      "--hash=sha256:23657205b63d4d31395ab917815247f694aafad28cd21316bf5fd45a51048ea0",
    );
    expect(readFileSync(workerPythonLockTargets.production.outputFile, "utf8")).toContain(
      "--hash=sha256:5231689c6ac8156cd155cfb98c3fd6fb252c3e7e9bd3d78b64d3c55f132624c9",
    );
  });

  it("keeps the Cloud Cython pin compatible with quicksectx 0.4.1", () => {
    const contents = readFileSync("worker/python/requirements-cloud.txt", "utf8");
    expect(contents).toMatch(/^quicksectx==0\.4\.1\s/m);
    const cython = contents.match(/^cython==(\d+)\.(\d+)\.(\d+)\s/m);
    expect(cython, "Cloud lock must pin Cython").not.toBeNull();
    // quicksectx 0.4.1 declares Cython>=0.25,<3.2.0 in its package metadata.
    const [, major, minor] = cython!;
    expect(Number(major) > 0 || Number(minor) >= 25).toBe(true);
    expect(Number(major) < 3 || (Number(major) === 3 && Number(minor) < 2)).toBe(true);
  });

  it("keeps the Cloud Thinc pin compatible with spaCy 3.8.16", () => {
    const contents = readFileSync("worker/python/requirements-cloud.txt", "utf8");
    expect(contents).toMatch(/^spacy==3\.8\.16\s/m);
    const thinc = contents.match(/^thinc==(\d+)\.(\d+)\.(\d+)\s/m);
    expect(thinc, "Cloud lock must pin Thinc").not.toBeNull();
    // spaCy 3.8.16 declares thinc>=8.3.12,<8.4.0 in its package metadata.
    const [, major, minor, patch] = thinc!;
    expect([Number(major), Number(minor)]).toEqual([8, 3]);
    expect(Number(patch)).toBeGreaterThanOrEqual(12);
  });

  it("has hashed, pinned locks for production Python 3.11 and Cloud Python 3.12", () => {
    expect(existsSync("worker/python/requirements.in"), "requirements.in missing").toBe(true);
    for (const [file, version] of [
      ["worker/python/requirements.txt", "3.11"],
      ["worker/python/requirements-cloud.txt", "3.12"],
    ]) {
      expect(existsSync(file), `${file} missing`).toBe(true);
      const contents = readFileSync(file, "utf8");
      const lines = contents.split(/\r?\n/);
      expect(contents).toContain(`pip-compile with Python ${version}`);
      expect(
        lines.some((line) => line.includes("==")),
        `${file} has no pinned versions`,
      ).toBe(true);
      expect(
        lines.some((line) => line.includes("--hash=sha256:")),
        `${file} has no hashes`,
      ).toBe(true);
      expect(contents.includes("medspacy"), `medspacy not present in ${file}`).toBe(true);
      expect(contents).toMatch(/^setuptools==84\.1\.0/m);
    }
  });
});
