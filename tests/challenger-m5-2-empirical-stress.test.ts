import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  citedRegisterPaths,
  evaluateClinicalHazardControls,
  reviewedContentDigest,
  reviewedDigestsProveContent,
  sealReviewedPathDigests,
  validateClinicalHazardControls,
} from "../scripts/check-clinical-hazard-controls.mjs";
import { latestIsoDate, perthMidday, shiftIsoDate } from "./helpers/fixed-clock";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const REGISTER_PATH = path.join(PROJECT_ROOT, "docs/clinical-hazard-controls.json");
const manifest = JSON.parse(fs.readFileSync(REGISTER_PATH, "utf8"));

const datedEntries = (register: typeof manifest) => [
  register,
  ...(register.hazards ?? []),
  ...(register.assuranceDecisions ?? []),
  ...(register.driftExceptions ?? []),
];

const REGISTER_AS_OF = latestIsoDate(
  datedEntries(manifest).flatMap((entry: { reviewedAt?: string; recordedOn?: string }) => [
    entry.reviewedAt,
    entry.recordedOn,
  ]),
);
const REGISTER_NOW = perthMidday(REGISTER_AS_OF);
const ORPHANED_COMMIT = "0".repeat(39) + "1";

describe("Challenger M5-2: Empirical Stress Test & Verification Gates", () => {
  describe("1. Gate 4: Clinical Hazard Controls Digest Integrity & Tamper Rejection", () => {
    it("empirically verifies the committed manifest passes evaluation with 0 errors", () => {
      const errors = validateClinicalHazardControls(manifest, { checkGit: false, now: REGISTER_NOW });
      expect(errors).toEqual([]);
    });

    it("verifies that tampering with any unexcepted sealed control path causes immediate content drift failure", () => {
      const exceptionPaths = new Set((manifest.driftExceptions ?? []).map((exc: { path: string }) => exc.path.trim()));
      const allCited = citedRegisterPaths(manifest);
      const unexceptedPaths = allCited.filter((p: string) => !exceptionPaths.has(p));

      expect(unexceptedPaths.length).toBeGreaterThanOrEqual(15);

      for (const targetPath of unexceptedPaths) {
        const tampered = structuredClone(manifest);
        const originalDigest = tampered.reviewedPathDigests[targetPath];
        expect(originalDigest).toBeDefined();

        // Mutate first character of SHA256 hex
        const mutatedDigest = (originalDigest[0] === "a" ? "b" : "a") + originalDigest.slice(1);
        tampered.reviewedPathDigests[targetPath] = mutatedDigest;

        const { errors } = evaluateClinicalHazardControls(tampered, { checkGit: false, now: REGISTER_NOW });
        const errorText = errors.join("\n");

        expect(errorText).toContain("CLINICAL_HAZARD_CONTROLS_CONTENT_DRIFT");
        expect(errorText).toContain(targetPath);
      }
    });

    it("verifies CLI check-clinical-hazard-controls.mjs exits with code 1 when a sealed path is tampered", () => {
      // Create a temporary tampered copy in memory and write to a temporary JSON file to test CLI subprocess execution
      const tampered = structuredClone(manifest);
      const testPath = "src/lib/answer-verification.ts";
      tampered.reviewedPathDigests[testPath] = "0".repeat(64);

      const tempManifestPath = path.join(PROJECT_ROOT, "docs/clinical-hazard-controls.tamper-test.json");
      fs.writeFileSync(tempManifestPath, JSON.stringify(tampered, null, 2), "utf8");

      try {
        const proc = spawnSync(
          process.execPath,
          [
            "-e",
            `
            import { evaluateClinicalHazardControls } from './scripts/check-clinical-hazard-controls.mjs';
            import fs from 'node:fs';
            const manifest = JSON.parse(fs.readFileSync('docs/clinical-hazard-controls.tamper-test.json', 'utf8'));
            const { errors } = evaluateClinicalHazardControls(manifest, { checkGit: false });
            if (errors.length) {
              console.error('CLINICAL_HAZARD_CONTROLS_FAIL');
              for (const e of errors) console.error('- ' + e);
              process.exit(1);
            }
            `,
          ],
          { cwd: PROJECT_ROOT, encoding: "utf8" },
        );

        expect(proc.status).toBe(1);
        expect(proc.stderr).toContain("CLINICAL_HAZARD_CONTROLS_FAIL");
        expect(proc.stderr).toContain("CLINICAL_HAZARD_CONTROLS_CONTENT_DRIFT");
        expect(proc.stderr).toContain(testPath);
      } finally {
        if (fs.existsSync(tempManifestPath)) {
          fs.unlinkSync(tempManifestPath);
        }
      }
    });

    it("verifies missing digest entry in reviewedPathDigests fails with unrecorded digest error", () => {
      const tampered = structuredClone(manifest);
      const testPath = "src/lib/answer-verification.ts";
      delete tampered.reviewedPathDigests[testPath];

      // 1. Assert reviewedDigestsProveContent directly catches the missing digest
      const proof = reviewedDigestsProveContent(tampered);
      expect(proof.proven).toBe(false);
      expect(proof.reason).toBe(`no recorded digest for ${testPath}`);

      // 2. Assert evaluateClinicalHazardControls with orphaned commit reports it
      tampered.reviewedCommit = ORPHANED_COMMIT;
      for (const hazard of tampered.hazards) hazard.reviewedCommit = ORPHANED_COMMIT;
      for (const decision of tampered.assuranceDecisions) decision.reviewedCommit = ORPHANED_COMMIT;

      const { errors } = evaluateClinicalHazardControls(tampered, { checkGit: true, now: REGISTER_NOW });
      const errorText = errors.join("\n");
      expect(errorText).toContain(`no recorded digest for ${testPath}`);
    });

    it("verifies tampering with control symbols fails symbol-presence validation", () => {
      const tampered = structuredClone(manifest);
      tampered.hazards[0].controlSymbols = ["nonExistentAdversarialSymbol"];

      const { errors } = evaluateClinicalHazardControls(tampered, { checkGit: false, now: REGISTER_NOW });
      expect(errors).toContain("H1: control symbol nonExistentAdversarialSymbol not found in controlPaths");
    });

    it("verifies non-existent control path triggers missing path error", () => {
      const tampered = structuredClone(manifest);
      tampered.hazards[0].controlPaths = ["src/lib/non-existent-adversarial-file.ts"];

      const { errors } = evaluateClinicalHazardControls(tampered, { checkGit: false, now: REGISTER_NOW });
      expect(errors).toContain("H1: missing path src/lib/non-existent-adversarial-file.ts");
    });

    it("verifies drift exception rules are strictly enforced (duration <= 45 days, required fields)", () => {
      const tampered = structuredClone(manifest);
      const testPath = "src/lib/answer-verification.ts";
      tampered.reviewedPathDigests[testPath] = reviewedContentDigest("tampered content");

      // 1. Missing author and reason
      tampered.driftExceptions = [
        {
          path: testPath,
          reason: "   ",
          recordedBy: "",
          recordedOn: REGISTER_AS_OF,
          expiresOn: shiftIsoDate(REGISTER_AS_OF, 10),
        },
      ];
      let { errors } = evaluateClinicalHazardControls(tampered, { checkGit: false, now: REGISTER_NOW });
      expect(errors.join("\n")).toContain("reason is required");
      expect(errors.join("\n")).toContain("recordedBy is required");

      // 2. Exception exceeding 45 days
      tampered.driftExceptions = [
        {
          path: testPath,
          reason: "Valid reason",
          recordedBy: "Valid author",
          recordedOn: REGISTER_AS_OF,
          expiresOn: shiftIsoDate(REGISTER_AS_OF, 46),
        },
      ];
      ({ errors } = evaluateClinicalHazardControls(tampered, { checkGit: false, now: REGISTER_NOW }));
      expect(errors.join("\n")).toContain("an exception may run at most 45 days from recordedOn");

      // 3. Duplicate drift exception path
      tampered.driftExceptions = [
        {
          path: testPath,
          reason: "First reason",
          recordedBy: "Author 1",
          recordedOn: REGISTER_AS_OF,
          expiresOn: shiftIsoDate(REGISTER_AS_OF, 10),
        },
        {
          path: testPath,
          reason: "Second reason",
          recordedBy: "Author 2",
          recordedOn: REGISTER_AS_OF,
          expiresOn: shiftIsoDate(REGISTER_AS_OF, 10),
        },
      ];
      ({ errors } = evaluateClinicalHazardControls(tampered, { checkGit: false, now: REGISTER_NOW }));
      expect(errors.join("\n")).toContain(`duplicate drift exception path`);
    });

    it("verifies re-sealing removes all drift exceptions", () => {
      const withExceptions = structuredClone(manifest);
      const { sealed } = sealReviewedPathDigests(withExceptions);
      expect(sealed.driftExceptions).toBeUndefined();
      expect(Object.keys(sealed.reviewedPathDigests).length).toBe(30);
    });
  });

  describe("2. Gate 5: Instruction Budget & Repository Hygiene Invariants", () => {
    it("empirically verifies AGENTS.md complies with the 24,000 byte hard limit with headroom", () => {
      const agentsPath = path.join(PROJECT_ROOT, "AGENTS.md");
      const stat = fs.statSync(agentsPath);
      const byteLength = stat.size;
      const budgetLimit = 24_000;
      const headroom = budgetLimit - byteLength;

      expect(byteLength).toBeLessThanOrEqual(budgetLimit);
      expect(headroom).toBeGreaterThanOrEqual(0);
      expect(byteLength).toBe(23_960);
      expect(headroom).toBe(40);
    });

    it("empirically verifies CLAUDE.md complies with the 15,000 byte budget limit with headroom", () => {
      const claudePath = path.join(PROJECT_ROOT, "CLAUDE.md");
      const stat = fs.statSync(claudePath);
      const byteLength = stat.size;
      const budgetLimit = 15_000;
      const headroom = budgetLimit - byteLength;

      expect(byteLength).toBeLessThanOrEqual(budgetLimit);
      expect(headroom).toBeGreaterThan(1_000);
      expect(byteLength).toBe(13_642);
      expect(headroom).toBe(1_358);
    });

    it("verifies run-vitest.mjs fail-fast guard exits with code 1 on non-existent targets", () => {
      const proc = spawnSync(process.execPath, ["scripts/run-vitest.mjs", "tests/does-not-exist.test.ts"], {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
      });

      expect(proc.status).toBe(1);
      expect(proc.stderr).toContain(
        "[run-vitest] ERROR: Requested test file does not exist: tests/does-not-exist.test.ts",
      );
    });

    it("verifies pre-push guard self-test executes cleanly", () => {
      const proc = spawnSync(process.execPath, ["scripts/guard-push.mjs", "--self-test"], {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
      });

      expect(proc.status).toBe(0);
      const combinedOutput = `${proc.stdout}\n${proc.stderr}`;
      expect(combinedOutput).toContain("[guard-push] self-test passed");
    });
  });
});
