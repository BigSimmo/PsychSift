import { describe, expect, it } from "vitest";

import { CI_EQUIVALENT, deriveCiCoverage, scopeFlagsInGuard } from "../scripts/ci-coverage.mjs";

const projectRoot = process.cwd();

describe("ci coverage — derived, not assumed", () => {
  it("resolves a gate CI runs under its own name, when its guard is satisfied", () => {
    expect(deriveCiCoverage(projectRoot, "lint", { scope: { static_heavy_changed: true } }).covered).toBe(true);
  });

  it("resolves a gate CI runs under its coverage-job name", () => {
    const coverage = deriveCiCoverage(projectRoot, "test", { scope: { coverage_changed: true } });
    expect(coverage.covered).toBe(true);
    expect(coverage.via).toBe(CI_EQUIVALENT.get("test"));
  });

  it("claims no coverage when the change scope is unknown", () => {
    // Without a scope the guards cannot be evaluated, so the conservative answer is
    // "not covered", which runs the gate. Fail open, never toward a skipped gate.
    expect(deriveCiCoverage(projectRoot, "lint").covered).toBe(false);
  });

  it("reports no coverage when CI cannot be read, so the gate runs", () => {
    const coverage = deriveCiCoverage(projectRoot, "test", {
      readFile: () => {
        throw new Error("unreadable");
      },
    });
    expect(coverage.covered).toBe(false);
  });

  it("surfaces an unverifiable precondition sitting alongside a satisfied scope flag", () => {
    // The `Unit coverage` job guard is
    // `coverage_changed == 'true' && github.event.pull_request.draft != true`.
    // Reporting `assumed` per whole guard would drop the draft half, so the one condition
    // the worktree genuinely cannot evaluate never reaches the operator.
    const coverage = deriveCiCoverage(projectRoot, "test", { scope: { coverage_changed: true } });
    expect(coverage.covered).toBe(true);
    expect(coverage.assumed.join("; ")).toMatch(/draft/);
    // A guard made only of satisfied scope flags assumes nothing.
    expect(deriveCiCoverage(projectRoot, "lint", { scope: { static_heavy_changed: true } }).assumed).toEqual([]);
  });
});

describe("ci coverage — evaluates step and job guards", () => {
  it.each([
    ["npm run test:coverage -- --merge-reports=.vitest-ci --reporter=default", true],
    ["npm run test:coverage -- --shard=1/2", false],
    ["npm run test:coverage -- --testNamePattern=one", false],
    ["echo npm run test:coverage", false],
    ["npm run test:coverage -- --merge-reports=.vitest-ci || true", false],
  ])("recognises complete report merging without treating subsets as full coverage: %s", (command, covered) => {
    const ci = `jobs:\n  coverage:\n    steps:\n      - run: ${command}\n`;
    const readFile = ((file: string) =>
      String(file).endsWith("package.json") ? JSON.stringify({ scripts: {} }) : ci) as never;
    expect(deriveCiCoverage(projectRoot, "test", { scope: {}, readFile }).covered).toBe(covered);
  });

  // `lint` and `typecheck` are step-conditional on static_heavy_changed, `test:coverage`
  // is job-conditional on coverage_changed. A docs-only change satisfies neither, so CI
  // skips all three — and a name-only scan would wrongly call them covered.
  const docsOnly = {
    docs_only: true,
    docs_changed: true,
    static_heavy_changed: false,
    coverage_changed: false,
    source_changed: false,
  };
  const sourceScope = { source_changed: true, static_heavy_changed: true, coverage_changed: true };

  it.each(["lint", "typecheck", "test"])("reports %s uncovered for docs-only scope", (gate) => {
    const coverage = deriveCiCoverage(projectRoot, gate, { scope: docsOnly });
    expect(coverage.covered).toBe(false);
    expect(coverage.reason).toMatch(/only when|no CI step/);
  });

  it.each(["lint", "typecheck", "test"])("reports %s covered for source scope", (gate) => {
    expect(deriveCiCoverage(projectRoot, gate, { scope: sourceScope }).covered).toBe(true);
  });

  it.each([docsOnly, sourceScope, { docs_changed: false, static_heavy_changed: false }])(
    "evaluates the real docs-link OR guard for %j",
    (scope) => {
      expect(deriveCiCoverage(projectRoot, "docs:check-links", { scope }).covered).toBe(
        scope.static_heavy_changed || ("docs_changed" in scope && scope.docs_changed),
      );
    },
  );

  const guarded = (guard: string, scope: Record<string, boolean> | null, jobGuard = "") => {
    const ci = [
      "jobs:",
      "  guarded:",
      ...(jobGuard ? [`    if: ${jobGuard}`] : []),
      "    steps:",
      "      - name: Guarded gate",
      `        if: ${guard}`,
      "        run: npm run fixture:gate",
    ].join("\n");
    const readFile = ((file: string) =>
      String(file).endsWith("package.json") ? JSON.stringify({ scripts: {} }) : ci) as never;
    return deriveCiCoverage(projectRoot, "fixture:gate", { scope, readFile });
  };
  const a = "needs.changes.outputs.a_changed";
  const b = "needs.changes.outputs.b_changed";
  const c = "needs.changes.outputs.c_changed";

  it("matches boolean truth tables with precedence, grouping, negation and equality", () => {
    for (const a_changed of [false, true]) {
      for (const b_changed of [false, true]) {
        for (const c_changed of [false, true]) {
          const scope = { a_changed, b_changed, c_changed };
          expect(guarded(`${a} == 'true' || ${b} == 'true' && ${c} == 'true'`, scope).covered).toBe(
            a_changed || (b_changed && c_changed),
          );
          expect(guarded(`(${a} == 'true' || ${b} == 'true') && ${c} == 'true'`, scope).covered).toBe(
            (a_changed || b_changed) && c_changed,
          );
          expect(guarded(`!(${a} == 'true' || ${b} == 'true')`, scope).covered).toBe(!(a_changed || b_changed));
          expect(guarded(`'true' == ${a} && ${b} != 'true'`, scope).covered).toBe(a_changed && !b_changed);
          expect(guarded(`${a} == 'false' || ${b} != 'false'`, scope).covered).toBe(!a_changed || b_changed);
        }
      }
    }
  });

  it("requires both step and folded job guards, including a folded step expression", () => {
    const step = `>\n          (${a} == 'true' ||\n           ${b} == 'true')`;
    const job = `>\n      ${c} == 'true'`;
    expect(guarded(step, { a_changed: true, c_changed: true }, job).covered).toBe(true);
    expect(guarded(step, { a_changed: true, c_changed: false }, job).covered).toBe(false);
    expect(guarded(step, { a_changed: false, b_changed: false, c_changed: true }, job).covered).toBe(false);
    expect(guarded(`\${{ ${a} == 'true' || ${b} == 'true' }}`, { b_changed: true }).covered).toBe(true);
  });

  it("keeps runtime assumptions explicit even inside OR branches and negations", () => {
    const conditional = guarded(
      `(${a} == 'true' || github.event_name == 'push') && !(github.event.pull_request.draft == true)`,
      { a_changed: false },
    );
    expect(conditional.covered).toBe(true);
    expect(conditional.assumed.join("; ")).toMatch(/github.event_name/);
    expect(conditional.assumed.join("; ")).toMatch(/!.*draft/);
    expect(guarded(`${a} == 'true' || github.event_name == 'push'`, { a_changed: true }).assumed).toEqual([]);
    expect(guarded(`${a} == 'true' && github.event_name == 'push'`, { a_changed: false }).covered).toBe(false);
    const call = guarded(
      `${a} == 'true' && !cancelled() && contains(github.event.pull_request.labels.*.name, 'browser')`,
      { a_changed: true },
    );
    expect(call.covered).toBe(true);
    expect(call.assumed.join("; ")).toMatch(/! cancelled/);
    expect(call.assumed.join("; ")).toMatch(/contains/);
  });

  it("does not negate unknown scope into proof or claim proof for unsupported syntax", () => {
    for (const guard of [`!(${a} == 'true')`, `${a} != 'true'`, `${a} == 'false'`]) {
      expect(guarded(guard, null).covered, guard).toBe(false);
    }
    for (const guard of [`${a} == 'true' ||`, `(${a} == 'true'`, `${a} == 'true' + true`, `contains(${a}, 'true')`]) {
      expect(guarded(guard, { a_changed: true }).covered, guard).toBe(false);
    }
    expect(guarded("false", {}).covered).toBe(false);
    expect(guarded("true", null).covered).toBe(true);
  });

  it("requires an own boolean scope value before equality or negation can establish coverage", () => {
    for (const scope of [
      {},
      { b_changed: true },
      { a_changed: undefined },
      { a_changed: "false" },
      { a_changed: 0 },
      Object.create({ a_changed: false }),
    ]) {
      for (const guard of [`${a} == 'false'`, `${a} != 'true'`, `!(${a} == 'true')`]) {
        expect(guarded(guard, scope as Record<string, boolean>).covered, guard).toBe(false);
      }
    }
    expect(guarded(`${a} == 'false'`, { a_changed: false }).covered).toBe(true);
    expect(guarded(`${a} == 'true' || ${b} == 'false'`, { a_changed: true }).covered).toBe(true);
    expect(guarded(`${a} == 'true' && ${b} == 'false'`, { a_changed: true }).covered).toBe(false);
  });

  it("extracts the change-scope flags a guard depends on", () => {
    expect(scopeFlagsInGuard("needs.changes.outputs.coverage_changed == 'true' && x")).toEqual(["coverage_changed"]);
    expect(scopeFlagsInGuard("github.event_name == 'push'")).toEqual([]);
  });

  it("treats an unreadable CI definition as no coverage", () => {
    const coverage = deriveCiCoverage(projectRoot, "test", {
      scope: sourceScope,
      readFile: () => {
        throw new Error("unreadable");
      },
    });
    expect(coverage.covered).toBe(false);
  });

  it("finds a gate invoked inside a multi-line run block, as CI runs the e2e shards", () => {
    const ci = [
      "jobs:",
      "  e2e:",
      "    if: needs.changes.outputs.ui_changed == 'true'",
      "    steps:",
      "      - name: Chromium production journeys",
      "        run: |",
      '          if [ "$EVENT" = "pull_request" ]; then',
      "            npm run test:e2e:pr:shard -- --shard 1 --exclude-critical",
      "          fi",
      "      - name: Unrelated",
      "        run: |",
      "          # npm run test:e2e:pr is only mentioned here",
      "          echo done",
    ].join("\n");
    const readFile = ((file: string) =>
      String(file).endsWith("package.json") ? JSON.stringify({ scripts: {} }) : ci) as never;
    const at = (gate: string, ui: boolean) =>
      deriveCiCoverage(projectRoot, gate, { scope: { ui_changed: ui }, readFile }).covered;
    expect(at("test:e2e:pr:shard", true)).toBe(true);
    expect(at("test:e2e:pr:shard", false)).toBe(false);
    expect(at("test:e2e:pr", true)).toBe(false);
  });
});
