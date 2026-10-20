import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", "/index.ts", "/index.tsx"];

/** Dependency-free because the CI changes job deliberately runs before npm ci.
 * Include every local import/re-export/dynamic import conservatively (including
 * type imports). False positives retain browser proof rather than losing it.
 */
export function browserInputClosure(root = process.cwd()) {
  const sources = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(file);
      else if (/\.[cm]?[jt]sx?$/.test(file)) sources.set(file, readFileSync(path.join(root, file), "utf8"));
    }
  };
  if (existsSync(path.join(root, "src"))) visit("src");
  const pending = [...sources]
    .filter(
      ([file, source]) =>
        /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/.test(source) || file.startsWith("src/hooks/"),
    )
    .map(([file]) => file);
  const inputs = new Set();
  let unresolvedDynamicImport = false;
  while (pending.length) {
    const file = pending.pop();
    if (inputs.has(file)) continue;
    const source = sources.get(file) ?? "";
    // A browser import of server-only is a build error, not a browser surface.
    if (/\bimport\s*["']server-only["']/.test(source)) continue;
    inputs.add(file);
    if ([...source.matchAll(/\b(?:import|require)\s*\(\s*([^\s])/g)].some((match) => !['"', "'"].includes(match[1])))
      unresolvedDynamicImport = true;
    const imports = source.matchAll(
      /(?:\b(?:import|export)\s+(?:[^;"'`]*?\s+from\s*)?|\b(?:import|require)\s*\(\s*)["']([^"']+)["']/g,
    );
    for (const [, specifier] of imports) {
      const candidate = specifier.startsWith("@/")
        ? `src/${specifier.slice(2)}`
        : specifier.startsWith(".")
          ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
          : null;
      if (!candidate || candidate.startsWith("../")) continue;
      const candidates = extensions.map((extension) => candidate + extension);
      // TypeScript bundler resolution permits a .js spelling for a .ts source.
      if (/\.[cm]?jsx?$/.test(candidate))
        candidates.push(
          candidate
            .replace(/\.js$/, ".ts")
            .replace(/\.jsx$/, ".tsx")
            .replace(/\.mjs$/, ".mts")
            .replace(/\.cjs$/, ".cts"),
        );
      const resolved = candidates.find(
        (name) => existsSync(path.join(root, name)) && statSync(path.join(root, name)).isFile(),
      );
      if (resolved) pending.push(resolved);
      else for (const extension of ["", ".ts", ".tsx"]) inputs.add(candidate + extension);
    }
  }
  // A computed import cannot be attributed statically. Keep unmarked source in
  // browser scope until it can be resolved; explicit server-only boundaries
  // remain excluded. Never silently certify an incomplete client graph.
  if (unresolvedDynamicImport) {
    for (const [file, source] of sources) {
      if (!/\bimport\s*["']server-only["']/.test(source)) inputs.add(file);
    }
  }
  return inputs;
}
