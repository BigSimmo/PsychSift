import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  hasUseClientDirective,
  moduleSpecifiersFromSource,
  projectRoot,
  relative,
  resolveModule,
  runtimeGraph,
} from "./helpers/module-graph";

// The import-graph machinery this suite is built on lives in
// `tests/helpers/module-graph.ts` so `tests/rsc-boundary.test.ts` can walk the
// same graph with the same resolver.

function runtimeCycles(graph: Map<string, string[]>) {
  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];

  const visit = (file: string) => {
    indexes.set(file, nextIndex);
    lowLinks.set(file, nextIndex);
    nextIndex += 1;
    stack.push(file);
    onStack.add(file);

    for (const dependency of graph.get(file) ?? []) {
      if (!indexes.has(dependency)) {
        visit(dependency);
        lowLinks.set(file, Math.min(lowLinks.get(file)!, lowLinks.get(dependency)!));
      } else if (onStack.has(dependency)) {
        lowLinks.set(file, Math.min(lowLinks.get(file)!, indexes.get(dependency)!));
      }
    }

    if (lowLinks.get(file) !== indexes.get(file)) return;
    const component: string[] = [];
    let current: string;
    do {
      current = stack.pop()!;
      onStack.delete(current);
      component.push(current);
    } while (current !== file);
    const hasSelfCycle = (graph.get(file) ?? []).includes(file);
    if (component.length > 1 || hasSelfCycle) cycles.push(component);
  };

  for (const file of graph.keys()) {
    if (!indexes.has(file)) visit(file);
  }
  return cycles;
}

describe("architecture boundaries", () => {
  it("parses formatted TypeScript generic arrows while retaining their import edges", () => {
    for (const file of ["fixture.ts", "fixture.mts"]) {
      const parsed = moduleSpecifiersFromSource(
        file,
        'import { value } from "./runtime"; export const copy = <T>(input: T): T => input;',
      );
      expect([...parsed.staticImports]).toEqual(["./runtime"]);
    }
  });

  it("retains JSX parsing for TSX without accepting JSX in plain TypeScript", () => {
    const source = 'import { Widget } from "./widget"; export const render = () => <Widget />;';
    expect([...moduleSpecifiersFromSource("fixture.tsx", source).staticImports]).toEqual(["./widget"]);
    expect(() => moduleSpecifiersFromSource("fixture.ts", source)).toThrow();
  });

  it("tracks statically resolvable dynamic imports", () => {
    const parsed = moduleSpecifiersFromSource(
      "fixture.ts",
      'import(`./template`); import("./with-options", { with: { type: "json" } }); import(`./${name}`);',
    );

    expect([...parsed.dynamicImports]).toEqual(["./template", "./with-options"]);
  });

  it("counts a runtime self-import as a cycle", () => {
    const file = path.join(projectRoot, "src", "self.ts");
    expect(runtimeCycles(new Map([[file, [file]]]))).toEqual([[file]]);
  });

  it("has no runtime import cycles", { timeout: 60_000 }, () => {
    const { graph } = runtimeGraph();
    const cycles = runtimeCycles(graph).map((cycle) => cycle.map(relative).sort());
    expect(cycles).toEqual([]);
  });

  it("keeps server environment and provider modules out of the client graph", () => {
    const { files, graph, parsed } = runtimeGraph();
    const clientEntries = files.filter((file) => {
      const moduleInfo = parsed.get(file);
      return Boolean(moduleInfo && hasUseClientDirective(moduleInfo.source));
    });
    const clientGraph = new Set(clientEntries);
    const pending = [...clientEntries];
    while (pending.length) {
      const file = pending.pop()!;
      for (const dependency of graph.get(file) ?? []) {
        if (clientGraph.has(dependency)) continue;
        clientGraph.add(dependency);
        pending.push(dependency);
      }
    }

    const forbidden = new Set([
      "src/lib/env.ts",
      "src/lib/openai.ts",
      "src/lib/rag/rag.ts",
      "src/lib/supabase/admin.ts",
      "src/lib/supabase/server.ts",
    ]);
    expect([...clientGraph].map(relative).filter((file) => forbidden.has(file))).toEqual([]);
  });

  it("does not make runtime source modules depend on operational scripts", () => {
    const { files, parsed } = runtimeGraph();
    const scriptImports = files.flatMap((file) => {
      const modules = parsed.get(file)!;
      return [...modules.staticImports, ...modules.dynamicImports]
        .filter((specifier) =>
          path.resolve(path.dirname(file), specifier).startsWith(path.join(projectRoot, "scripts")),
        )
        .map((specifier) => `${relative(file)} -> ${specifier}`);
    });
    expect(scriptImports).toEqual([]);
  });

  it("does not defeat a dynamic boundary with a static import of the same module", () => {
    const { fileSet, parsed } = runtimeGraph();
    const collisions: string[] = [];
    for (const [file, modules] of parsed) {
      const staticTargets = new Set(
        [...modules.staticImports]
          .map((specifier) => resolveModule(file, specifier, fileSet))
          .filter((target): target is string => Boolean(target)),
      );
      for (const specifier of modules.dynamicImports) {
        const target = resolveModule(file, specifier, fileSet);
        if (target && staticTargets.has(target)) collisions.push(`${relative(file)} -> ${relative(target)}`);
      }
    }
    expect(collisions).toEqual([]);
  });
});
