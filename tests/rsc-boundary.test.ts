import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  hasUseClientDirective,
  parseModuleSource,
  relative,
  resolveModule,
  runtimeGraph,
} from "./helpers/module-graph";

// React Server Component boundary guard.
//
// Two ways of crossing the RSC boundary wrongly are invisible to every gate this
// repository already runs:
//
//   Class A - an event handler on the server side. A component that renders
//   `<button onClick={...}>` without a `"use client"` directive, mounted inside
//   a Server Component, makes React try to serialise the handler into the flight
//   stream and the route throws "Event handlers cannot be passed to Client
//   Component props" on every request. `tsc` does not model the boundary; jsdom
//   has no boundary at all (an `onClick` is perfectly legal in a client tree);
//   and `next build` compiles a Dynamic route without ever rendering it.
//
//   Class B - a Server Component reading *data* exported from a client module.
//   Next replaces such an export with a client-reference proxy rather than the
//   real value, so `someArray.flatMap(...)` fails with "flatMap is not a
//   function" and the build dies with "Failed to collect configuration for
//   /route". Importing a client *component* and rendering it is completely
//   legitimate; importing its data and operating on it is not.
//
// Both analysers below are pure source/graph functions, unit-tested against
// synthetic fixtures in both directions (the bug must be reported; the
// legitimate neighbour must not be), and then run across the real tree. The
// fixtures carry the proof: this branch is cut from `main`, where neither bug
// exists, so a green real-tree run alone would prove nothing.

type AnyNode = Record<string, unknown>;

// Keys that only ever hold TypeScript type positions or bookkeeping. A binding
// referenced from a type annotation vanishes at runtime and cannot fail, so
// descending into these would manufacture false positives in Check B.
const NON_RUNTIME_KEYS = new Set([
  "loc",
  "comments",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "typeAnnotation",
  "typeParameters",
  "returnType",
  "typeArguments",
  "superTypeArguments",
  "superTypeParameters",
  "implements",
]);

// TS nodes that still wrap a real runtime expression (`x as T`, `x satisfies T`,
// `x!`, `<T>x`, `f<T>`): descend into the expression only. Every other `TS*`
// node is a pure type position.
const TS_EXPRESSION_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);

// TS nodes that carry ordinary runtime code in their bodies.
const TS_RUNTIME_CONTAINERS = new Set([
  "TSModuleDeclaration",
  "TSModuleBlock",
  "TSEnumDeclaration",
  "TSEnumMember",
  "TSExportAssignment",
]);

function walkAst(root: unknown, visit: (node: AnyNode, parent: AnyNode | null) => void) {
  const step = (node: unknown, parent: AnyNode | null) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) step(child, parent);
      return;
    }
    const current = node as AnyNode;
    if (typeof current.type !== "string") return;

    visit(current, parent);

    if (current.type.startsWith("TS") && !TS_RUNTIME_CONTAINERS.has(current.type)) {
      if (TS_EXPRESSION_WRAPPERS.has(current.type)) step(current.expression, current);
      return;
    }

    for (const [key, value] of Object.entries(current)) {
      if (NON_RUNTIME_KEYS.has(key)) continue;
      step(value, current);
    }
  };
  step(root, null);
}

function lineOf(node: AnyNode) {
  const loc = node.loc as { start?: { line?: number } } | null | undefined;
  return loc?.start?.line ?? 0;
}

function readSource(filePath: string) {
  return fs.readFileSync(filePath, "utf8");
}

/* ------------------------------------------------------------------ *
 * Check A - event handlers on the server side of the boundary         *
 * ------------------------------------------------------------------ */

/** A JSX element name: `<Card />` is `{ root: "Card" }`, `<Tabs.List />` is `{ root: "Tabs", member: "List" }`. */
export type RenderedElement = { root: string; member: string | null };

/**
 * How an `on*` attribute's value was decided to be a function.
 *
 * `local` - an inline function literal, or an identifier bound to one somewhere
 * in this module. Decidable from this module's source alone.
 *
 * `imported` - an identifier that is an import binding here. Whether it is a
 * function can only be settled by resolving the specifier and looking at what
 * the other module exports, so the decision is deferred to the render walk,
 * which owns the resolver. This is not an exotic case: `ignoreUnavailableActivation`
 * is this repo's canonical placeholder handler, lives in
 * `src/components/ui-primitives.tsx`, and is imported by 13 modules. Treating an
 * imported identifier as undecidable is what made an earlier version of this
 * guard miss the exact defect it was written for.
 */
export type HandlerValueSource = { kind: "local" } | { kind: "imported"; binding: string };

/**
 * An `on*` JSX attribute whose value is a function, or is an import that may
 * resolve to one. `target` is the element it sits on: `null` for an intrinsic
 * host element (`<button>`), or the component's JSX name, which the render walk
 * resolves to decide whether the prop crosses the boundary.
 */
export type EventHandlerFinding = {
  attribute: string;
  line: number;
  target: RenderedElement | null;
  value: HandlerValueSource;
};

export type ComponentDeclaration = {
  handlers: EventHandlerFinding[];
  renders: RenderedElement[];
};

export type ModuleComponents = {
  isClient: boolean;
  /** Top-level declarations by exported/local name. `"default"` is the default export. */
  declarations: Map<string, ComponentDeclaration>;
  /**
   * Top-level names bound to a function literal, Server Actions excluded. This
   * is what an importing module asks about when it needs to know whether
   * `onClick={someImport}` is a real function.
   */
  functionExports: Set<string>;
  /** Local binding name -> the module it came from and the name it was exported under. */
  imports: Map<string, { specifier: string; imported: string }>;
  /** `export { local as exported } from "spec"`. */
  reExports: { specifier: string; exported: string; local: string }[];
  /** `export * from "spec"`. */
  starReExports: string[];
  /** `export default Foo` - the default export aliases a local declaration. */
  defaultAlias: string | null;
};

/**
 * Whether a particular export reaches a module that carries `"use client"`.
 *
 * A directive-free barrel does not erase the client boundary. The server still
 * receives a client reference when it imports a binding the barrel forwards
 * from a client module, so follow named, imported and star re-exports before
 * deciding that an import is server-side. `seen` makes re-export cycles
 * terminate rather than turn a malformed barrel into an unbounded walk.
 */
function exportedBindingIsClient(
  fromFile: string,
  specifier: string,
  exported: string,
  load: (file: string) => ModuleComponents,
  resolve: (fromFile: string, specifier: string) => string | null,
  seen = new Set<string>(),
): boolean {
  const target = resolve(fromFile, specifier);
  if (!target) return false;
  const key = `${target}::${exported}`;
  if (seen.has(key)) return false;
  seen.add(key);

  const moduleInfo = load(target);
  if (moduleInfo.isClient) return true;

  const local = exported === "default" ? (moduleInfo.defaultAlias ?? "default") : exported;
  const forwarded = moduleInfo.imports.get(local);
  if (forwarded && exportedBindingIsClient(target, forwarded.specifier, forwarded.imported, load, resolve, seen)) {
    return true;
  }
  for (const reExport of moduleInfo.reExports) {
    if (
      reExport.exported === exported &&
      exportedBindingIsClient(target, reExport.specifier, reExport.local, load, resolve, seen)
    ) {
      return true;
    }
  }
  return moduleInfo.starReExports.some((starSpecifier) =>
    exportedBindingIsClient(target, starSpecifier, exported, load, resolve, seen),
  );
}

/** Statements with no top-level name of their own are attributed here. */
const MODULE_SCOPE = "*module*";

function jsxRootName(nameNode: unknown): RenderedElement | null {
  if (!nameNode || typeof nameNode !== "object") return null;
  const current = nameNode as AnyNode;
  if (current.type === "JSXIdentifier" && typeof current.name === "string") {
    // Lowercase names are intrinsic host elements (`div`, `button`), never components.
    return /^[a-z]/.test(current.name) ? null : { root: current.name, member: null };
  }
  if (current.type === "JSXMemberExpression") {
    const object = current.object as AnyNode | undefined;
    const property = current.property as AnyNode | undefined;
    if (object?.type === "JSXIdentifier" && typeof object.name === "string") {
      return {
        root: object.name,
        member: typeof property?.name === "string" ? property.name : null,
      };
    }
    return jsxRootName(object);
  }
  return null;
}

function isHostElement(nameNode: unknown) {
  const current = nameNode as AnyNode | undefined;
  return current?.type === "JSXIdentifier" && typeof current.name === "string" && /^[a-z]/.test(current.name);
}

function carriesDirective(directives: unknown, value: string) {
  const list = directives as AnyNode[] | undefined;
  return Boolean(list?.some((directive) => (directive.value as AnyNode | undefined)?.value === value));
}

/**
 * A Server Action: a function whose own body opens with `"use server"`.
 *
 * `<ClientForm onSubmit={saveAction} />` where `saveAction` is a Server Action
 * is legal, idiomatic Next - React serialises it as an opaque *reference*, not
 * as a closure, so nothing throws. It is otherwise indistinguishable from the
 * defect this check hunts: a locally declared function handed to a client
 * component's `on*` prop. The repository has no `"use server"` code today, so
 * this is pre-emptive - but the day a guard fires on correct code is the day
 * somebody deletes it, and forms are exactly what this codebase will grow.
 *
 * An action imported from elsewhere needs no special handling: an imported
 * binding is never in `functionValuedNames`, so it is not "provably a function"
 * and is already skipped.
 */
function isServerAction(node: unknown) {
  const current = node as AnyNode | undefined;
  const body = current?.body as AnyNode | undefined;
  return carriesDirective(body?.directives, "use server");
}

function isFunctionLiteral(node: unknown) {
  const type = (node as AnyNode | undefined)?.type;
  return type === "ArrowFunctionExpression" || type === "FunctionExpression";
}

/** Names bound to a function literal anywhere in the module, Server Actions excluded. */
function functionValuedNames(root: unknown) {
  const names = new Set<string>();
  // A whole `"use server"` module exports Server Actions, never closures.
  const program = (root as AnyNode | undefined)?.program as AnyNode | undefined;
  if (carriesDirective(program?.directives, "use server")) return names;

  walkAst(root, (current) => {
    if (current.type === "FunctionDeclaration") {
      const id = current.id as AnyNode | undefined;
      if (isServerAction(current)) return;
      if (id?.type === "Identifier" && typeof id.name === "string") names.add(id.name);
      return;
    }
    if (current.type === "VariableDeclarator") {
      const id = current.id as AnyNode | undefined;
      const init = current.init as AnyNode | undefined;
      if (
        id?.type === "Identifier" &&
        typeof id.name === "string" &&
        isFunctionLiteral(init) &&
        !isServerAction(init)
      ) {
        names.add(id.name);
      }
    }
  });
  return names;
}

/**
 * Whether a JSX attribute value is *certainly* a function at render time.
 *
 * This is the difference between a defect and noise. `onClick={() => reset()}`
 * and `onClick={handleReset}` (a local function) always serialise and always
 * throw. `onClick={action.onClick}` inside a generic template does not: the
 * value comes from data, and `<ModeHomeTemplate actions={[]} />` never renders
 * that branch at all. Only the certain shapes are reported.
 */
function classifyHandlerValue(
  value: unknown,
  functionNames: Set<string>,
  imports: Map<string, { specifier: string; imported: string }>,
): HandlerValueSource | null {
  const current = value as AnyNode | undefined;
  if (!current || current.type !== "JSXExpressionContainer") return null;

  const unwrap = (node: unknown): AnyNode | undefined => {
    const expression = node as AnyNode | undefined;
    if (!expression) return undefined;
    if (TS_EXPRESSION_WRAPPERS.has(expression.type as string)) return unwrap(expression.expression);
    return expression;
  };

  const expression = unwrap(current.expression);
  if (!expression) return null;
  // An inline Server Action serialises as a reference, not a closure.
  if (isFunctionLiteral(expression)) return isServerAction(expression) ? null : { kind: "local" };
  if (expression.type === "Identifier" && typeof expression.name === "string") {
    // An import binding cannot be redeclared at module scope, so checking
    // imports first is unambiguous.
    if (imports.has(expression.name)) return { kind: "imported", binding: expression.name };
    return functionNames.has(expression.name) ? { kind: "local" } : null;
  }
  if (expression.type === "CallExpression") {
    const callee = expression.callee as AnyNode | undefined;
    const property = callee?.property as AnyNode | undefined;
    return callee?.type === "MemberExpression" && property?.name === "bind" ? { kind: "local" } : null;
  }
  return null;
}

function collectDeclaration(
  node: unknown,
  functionNames: Set<string>,
  imports: Map<string, { specifier: string; imported: string }>,
): ComponentDeclaration {
  const handlers: EventHandlerFinding[] = [];
  const renders: RenderedElement[] = [];
  walkAst(node, (current) => {
    if (current.type !== "JSXOpeningElement") return;
    const rendered = jsxRootName(current.name);
    if (rendered) renders.push(rendered);
    const host = isHostElement(current.name);
    if (!rendered && !host) return;

    for (const attribute of (current.attributes as AnyNode[] | undefined) ?? []) {
      if (attribute.type !== "JSXAttribute") continue;
      const name = attribute.name as AnyNode | undefined;
      if (!name || name.type !== "JSXIdentifier" || typeof name.name !== "string") continue;
      if (!/^on[A-Z]/.test(name.name)) continue;
      const value = classifyHandlerValue(attribute.value, functionNames, imports);
      if (!value) continue;
      handlers.push({ attribute: name.name, line: lineOf(attribute), target: rendered, value });
    }
  });
  return { handlers, renders };
}

/**
 * Decompose a module into the top-level declarations a render walk can step
 * through: what each one renders, and what event handlers it carries.
 */
export function moduleComponents(sourceText: string, filePath?: string): ModuleComponents {
  const source = parseModuleSource(sourceText, filePath);
  const isClient = hasUseClientDirective(source);

  const declarationNodes: { name: string; node: unknown }[] = [];
  const looseStatements: unknown[] = [];
  const imports = new Map<string, { specifier: string; imported: string }>();
  const reExports: { specifier: string; exported: string; local: string }[] = [];
  const starReExports: string[] = [];
  let defaultAlias: string | null = null;

  const addVariableDeclaration = (declaration: AnyNode) => {
    let matched = false;
    for (const declarator of (declaration.declarations as AnyNode[] | undefined) ?? []) {
      const id = declarator.id as AnyNode | undefined;
      if (id?.type === "Identifier" && typeof id.name === "string") {
        declarationNodes.push({ name: id.name, node: declarator });
        matched = true;
      }
    }
    return matched;
  };

  for (const statement of source.program.body as unknown as AnyNode[]) {
    switch (statement.type) {
      case "ImportDeclaration": {
        if (statement.importKind === "type") break;
        const specifier = (statement.source as AnyNode).value as string;
        for (const importSpecifier of (statement.specifiers as AnyNode[]) ?? []) {
          const local = (importSpecifier.local as AnyNode).name as string;
          if (importSpecifier.type === "ImportDefaultSpecifier") {
            imports.set(local, { specifier, imported: "default" });
          } else if (importSpecifier.type === "ImportNamespaceSpecifier") {
            imports.set(local, { specifier, imported: "*" });
          } else if (importSpecifier.type === "ImportSpecifier" && importSpecifier.importKind !== "type") {
            const imported = importSpecifier.imported as AnyNode;
            const name = (imported.name ?? imported.value) as string | undefined;
            if (name) imports.set(local, { specifier, imported: name });
          }
        }
        break;
      }
      case "ExportDefaultDeclaration": {
        const declaration = statement.declaration as AnyNode;
        if (declaration.type === "Identifier" && typeof declaration.name === "string") {
          defaultAlias = declaration.name;
        } else {
          declarationNodes.push({ name: "default", node: declaration });
          const id = declaration.id as AnyNode | undefined;
          if (id?.type === "Identifier" && typeof id.name === "string") {
            declarationNodes.push({ name: id.name, node: declaration });
          }
        }
        break;
      }
      case "ExportNamedDeclaration": {
        const sourceNode = statement.source as AnyNode | null | undefined;
        if (sourceNode) {
          const specifier = sourceNode.value as string;
          for (const exportSpecifier of (statement.specifiers as AnyNode[]) ?? []) {
            if (exportSpecifier.type !== "ExportSpecifier") continue;
            const local = (exportSpecifier.local as AnyNode).name as string;
            const exported = exportSpecifier.exported as AnyNode;
            reExports.push({
              specifier,
              exported: (exported.name ?? exported.value) as string,
              local,
            });
          }
          break;
        }
        const declaration = statement.declaration as AnyNode | null | undefined;
        if (!declaration) break;
        if (declaration.type === "VariableDeclaration") {
          if (!addVariableDeclaration(declaration)) looseStatements.push(statement);
          break;
        }
        const id = declaration.id as AnyNode | undefined;
        if (id?.type === "Identifier" && typeof id.name === "string") {
          declarationNodes.push({ name: id.name, node: declaration });
        } else {
          looseStatements.push(statement);
        }
        break;
      }
      case "ExportAllDeclaration": {
        starReExports.push((statement.source as AnyNode).value as string);
        break;
      }
      case "FunctionDeclaration":
      case "ClassDeclaration": {
        const id = statement.id as AnyNode | undefined;
        if (id?.type === "Identifier" && typeof id.name === "string") {
          declarationNodes.push({ name: id.name, node: statement });
        } else {
          looseStatements.push(statement);
        }
        break;
      }
      case "VariableDeclaration": {
        if (!addVariableDeclaration(statement)) looseStatements.push(statement);
        break;
      }
      default:
        looseStatements.push(statement);
        break;
    }
  }

  const functionNames = functionValuedNames(source);
  const declarations = new Map<string, ComponentDeclaration>();
  const functionExports = new Set<string>();
  const moduleIsServerActions = carriesDirective(source.program.directives, "use server");
  for (const { name, node } of declarationNodes) {
    declarations.set(name, collectDeclaration(node, functionNames, imports));
    if (moduleIsServerActions) continue;
    const current = node as AnyNode;
    if (current.type === "FunctionDeclaration" && !isServerAction(current)) {
      functionExports.add(name);
    } else if (
      current.type === "VariableDeclarator" &&
      isFunctionLiteral(current.init) &&
      !isServerAction(current.init)
    ) {
      functionExports.add(name);
    }
  }
  const loose = collectDeclaration(looseStatements, functionNames, imports);
  if (loose.handlers.length > 0 || loose.renders.length > 0) declarations.set(MODULE_SCOPE, loose);

  return { isClient, declarations, functionExports, imports, reExports, starReExports, defaultAlias };
}

export type HandlerViolation = {
  file: string;
  component: string;
  attribute: string;
  target: string;
  line: number;
  via: string[];
};

/**
 * Walk the *render* graph from every Server Component entry point and report
 * event handlers found on the server side of the boundary.
 *
 * Anchoring on rendering rather than on imports is deliberate, and it is what
 * makes this check safe to leave switched on. This repository has shared UI
 * modules with no `"use client"` directive that export both a server-safe helper
 * (`cn`, `eyebrowText`, `EmptyState`) and an interactive component (`IconButton`,
 * a toggle switch, a filter `<select>`). A server page importing the helper does
 * not render the interactive component, and Next compiles that component into
 * the client graph for whichever client module actually uses it. An
 * import-reachability version of this check reported six such modules on a clean
 * `main` - none of them a live defect. A guard that cries wolf gets disabled,
 * so the walk steps only where React would actually step: from a component into
 * the components it names in its own JSX.
 *
 * Stops at any module carrying `"use client"` - that is the boundary, and
 * everything below it is legitimately client code.
 *
 * Two further narrowings, each of which removed a false positive measured on a
 * clean `main`:
 *
 *   1. The attribute value must be *provably* a function (see
 *      `classifyHandlerValue` and `exportIsFunction`). `onClick={action.onClick}`
 *      in a generic template is data-dependent - `<ModeHomeTemplate actions={[]} />`
 *      never renders it - and is not reported. An inline literal, a local
 *      function, and an **imported** identifier that resolves to a function are
 *      all provable; the imported case costs one hop through the same resolver
 *      the render walk already uses.
 *   2. The attribute must sit on an intrinsic host element (`<button>`) or on a
 *      component imported from a `"use client"` module. Handing a function to
 *      *another Server Component's* prop is legal and stays unreported.
 *
 * Those two narrowings COMPOSE INTO A BLIND SPOT, which is worth stating outright
 * rather than leaving to be inferred from the two rules:
 *
 *     page.tsx     <Toolbar onReset={handleReset} />  // (2) skips it: Toolbar is a Server Component
 *     toolbar.tsx  <button onClick={onReset} />       // (1) skips it: `onReset` is a prop, not provably a function
 *
 * Both sites stay silent and the route throws on every request. Neither rule is
 * individually wrong; the miss is in the seam between them. There is no live
 * instance today, but `src/components/mode-home-template.tsx` is precisely that
 * shape, so this is a question of when rather than whether. Closing it needs
 * inter-component prop flow - tracking which function a caller binds to which
 * prop name, across modules - which is a different analysis, not a loosening of
 * this one. The test named "pins the composed prop-flow gap" holds the case so
 * the hole is visible in the suite and not only in this comment.
 *
 * Known fail-open gaps (misses, never false alarms):
 *
 *   - the composed prop-flow gap above;
 *   - a component handed over as a value rather than named in JSX
 *     (`<Shell render={Toolbar} />`);
 *   - a component reached through `next/dynamic`;
 *   - a default export wrapped in a higher-order call
 *     (`export default withThing(Page)`);
 *   - spread props (`{...handlers}`), which carry no statically visible
 *     attribute name;
 *   - anything on the far side of a bare package specifier, in both roles: an
 *     `on*` prop on a component imported from `next/link`, and a handler value
 *     imported from a package. Handlers imported from *this repository* are
 *     resolved and are no longer a gap - only `node_modules` is, because this
 *     resolver does not read it;
 *   - a Server Action, which is skipped deliberately (see `isServerAction`).
 */
export function serverRenderedHandlerViolations(
  entries: string[],
  load: (file: string) => ModuleComponents,
  resolve: (fromFile: string, specifier: string) => string | null,
): HandlerViolation[] {
  const violations: HandlerViolation[] = [];
  const visited = new Set<string>();
  const queue: { file: string; name: string; via: string[] }[] = [];

  for (const entry of entries) {
    if (load(entry).isClient) continue;
    queue.push({ file: entry, name: "default", via: [entry] });
    queue.push({ file: entry, name: MODULE_SCOPE, via: [entry] });
  }

  /**
   * Does `exported` from the module `specifier` names resolve to a function?
   *
   * This is what makes `onClick={ignoreUnavailableActivation}` decidable. The
   * resolver and the module loader are already here, so an imported handler is
   * no less knowable than a local one - it just costs one hop. Barrels are
   * followed through re-exports; `seen` bounds the walk and makes a re-export
   * cycle terminate.
   *
   * Stays conservative exactly where conservatism is earned:
   *   - an unresolvable specifier (`next/link`, any bare package) returns false,
   *     because this resolver does not read `node_modules` and will not guess;
   *   - a `"use client"` source module returns false, because what the server
   *     graph receives from it is a client reference, not the function;
   *   - a binding that resolves to something other than a function literal
   *     returns false.
   */
  const exportIsFunction = (fromFile: string, specifier: string, exported: string, seen: Set<string>): boolean => {
    const target = resolve(fromFile, specifier);
    if (!target) return false;
    const key = `${target}::${exported}`;
    if (seen.has(key)) return false;
    seen.add(key);

    const moduleInfo = load(target);
    if (moduleInfo.isClient) return false;

    const local = exported === "default" ? (moduleInfo.defaultAlias ?? "default") : exported;
    if (moduleInfo.functionExports.has(local)) return true;

    const forwarded = moduleInfo.imports.get(local);
    if (forwarded && exportIsFunction(target, forwarded.specifier, forwarded.imported, seen)) return true;
    for (const reExport of moduleInfo.reExports) {
      if (reExport.exported === exported && exportIsFunction(target, reExport.specifier, reExport.local, seen)) {
        return true;
      }
    }
    return moduleInfo.starReExports.some((starSpecifier) => exportIsFunction(target, starSpecifier, exported, seen));
  };

  const handlerValueIsFunction = (fromFile: string, moduleInfo: ModuleComponents, value: HandlerValueSource) => {
    if (value.kind === "local") return true;
    const imported = moduleInfo.imports.get(value.binding);
    if (!imported) return false;
    return exportIsFunction(fromFile, imported.specifier, imported.imported, new Set());
  };

  const enqueueExternal = (fromFile: string, specifier: string, exported: string, via: string[], label: string) => {
    const target = resolve(fromFile, specifier);
    if (!target) return;
    if (load(target).isClient) return;
    queue.push({ file: target, name: exported, via: [...via, label] });
  };

  while (queue.length > 0) {
    const { file, name, via } = queue.pop()!;
    const key = `${file}::${name}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const moduleInfo = load(file);
    let declaration = moduleInfo.declarations.get(name);
    if (!declaration && name === "default" && moduleInfo.defaultAlias) {
      declaration = moduleInfo.declarations.get(moduleInfo.defaultAlias);
    }

    if (!declaration) {
      // The name is not declared here: follow it through re-export barrels.
      const imported = moduleInfo.imports.get(name);
      if (imported) {
        enqueueExternal(file, imported.specifier, imported.imported, via, `${name} (re-export)`);
      }
      for (const reExport of moduleInfo.reExports) {
        if (reExport.exported === name) {
          enqueueExternal(file, reExport.specifier, reExport.local, via, `${name} (re-export)`);
        }
      }
      for (const specifier of moduleInfo.starReExports) {
        enqueueExternal(file, specifier, name, via, `${name} (star re-export)`);
      }
      continue;
    }

    for (const handler of declaration.handlers) {
      const report = (target: string) =>
        violations.push({ file, component: name, attribute: handler.attribute, target, line: handler.line, via });

      if (!handlerValueIsFunction(file, moduleInfo, handler.value)) continue;

      if (handler.target === null) {
        // An intrinsic host element rendered on the server: always a throw.
        report("host element");
        continue;
      }
      const imported = moduleInfo.imports.get(handler.target.root);
      // A locally declared component is another Server Component; a function
      // prop between two Server Components never crosses the boundary.
      if (!imported) continue;
      if (exportedBindingIsClient(file, imported.specifier, imported.imported, load, resolve)) {
        report(`<${handler.target.root}>`);
      }
    }

    for (const rendered of declaration.renders) {
      const imported = moduleInfo.imports.get(rendered.root);
      if (imported) {
        const exported = imported.imported === "*" ? (rendered.member ?? "default") : imported.imported;
        enqueueExternal(file, imported.specifier, exported, via, `<${rendered.root}>`);
        continue;
      }
      if (moduleInfo.declarations.has(rendered.root)) {
        queue.push({ file, name: rendered.root, via: [...via, `<${rendered.root}>`] });
      }
    }
  }

  return violations;
}

/* ------------------------------------------------------------------ *
 * Check B - a server module reading data out of a client module        *
 * ------------------------------------------------------------------ */

export type ClientDataFinding = {
  binding: string;
  specifier: string;
  usage: "member" | "call" | "spread" | "iterate";
  line: number;
};

// Spreading or iterating a client-reference proxy throws just as hard as reading
// a property off it: `[...MODE_ROWS]`, `{...MODE_ROWS}`, `save(...MODE_ROWS)` and
// `for (const row of MODE_ROWS)` are all real failure paths, and none of them is
// a member access or a call. (Babel has used `SpreadElement` for array, object
// and argument spread since v7; the older `SpreadProperty` name is kept for
// safety.)
const SPREAD_PARENTS = ["SpreadElement", "JSXSpreadAttribute", "SpreadProperty", "ObjectSpreadProperty"];

function patternNames(node: unknown, into: Set<string>) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) patternNames(child, into);
    return;
  }
  const current = node as AnyNode;
  if (typeof current.type !== "string") return;
  if (current.type === "Identifier" && typeof current.name === "string") {
    into.add(current.name);
    return;
  }
  if (current.type === "ObjectProperty") {
    patternNames(current.value, into);
    return;
  }
  for (const key of ["elements", "properties", "argument", "left", "id", "params"]) {
    if (key in current) patternNames(current[key], into);
  }
}

/**
 * Bindings imported from a `"use client"` module and then *read* - member
 * access (`binding.something`) or a call (`binding()`).
 *
 * Deliberately NOT flagged, because all of these are correct and common:
 *   - a client component used as a JSX element name (`<ClientCard />`), which
 *     Babel models as `JSXIdentifier`, never `Identifier`;
 *   - a compound client component (`<Tabs.List />`), likewise a JSX name;
 *   - a binding passed along as a value (`<Slot render={ClientCard} />`,
 *     `export { ClientCard }`, `register(ClientCard)`);
 *   - anything imported with `import type` or a `{ type X }` specifier, which
 *     does not exist at runtime;
 *   - a reference from a TypeScript type position.
 *
 * Fails open on shadowing: if the module declares its own binding anywhere with
 * the same name, that name is dropped entirely rather than risk attributing an
 * inner-scope variable's member access to the import.
 *
 * Reported usages: `member` (`rows.flatMap(...)`), `call` (`buildRows()`),
 * `spread` (`[...rows]`, `{...rows}`, `save(...rows)`) and `iterate`
 * (`for (const row of rows)`).
 *
 * Module granularity is deliberate here, unlike Check A. A server-side module
 * that imports client data holds a client-reference proxy no matter which
 * function reads it, and the read is a hard throw wherever it runs.
 */
export function clientDataUsages(
  sourceText: string,
  isClientSpecifier: (specifier: string, exported: string) => boolean,
): ClientDataFinding[] {
  const source = parseModuleSource(sourceText);
  if (hasUseClientDirective(source)) return [];

  const bindings = new Map<string, string>();
  for (const statement of source.program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    if (statement.importKind === "type") continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportSpecifier" && specifier.importKind === "type") continue;
      const exported =
        specifier.type === "ImportDefaultSpecifier"
          ? "default"
          : specifier.type === "ImportNamespaceSpecifier"
            ? "*"
            : specifier.imported.type === "Identifier"
              ? specifier.imported.name
              : specifier.imported.value;
      if (isClientSpecifier(statement.source.value, exported)) {
        bindings.set(specifier.local.name, statement.source.value);
      }
    }
  }
  if (bindings.size === 0) return [];

  const shadowed = new Set<string>();
  walkAst(source, (node) => {
    const collect = (value: unknown) => patternNames(value, shadowed);
    switch (node.type) {
      case "VariableDeclarator":
      case "ClassDeclaration":
      case "ClassExpression":
        collect(node.id);
        break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "ObjectMethod":
      case "ClassMethod":
        collect(node.id);
        collect(node.params);
        break;
      case "CatchClause":
        collect(node.param);
        break;
      default:
        break;
    }
  });
  for (const name of shadowed) bindings.delete(name);
  if (bindings.size === 0) return [];

  const findings: ClientDataFinding[] = [];
  walkAst(source, (node, parent) => {
    if (node.type !== "Identifier" || typeof node.name !== "string") return;
    const specifier = bindings.get(node.name);
    if (!specifier || !parent) return;
    const parentType = typeof parent.type === "string" ? parent.type : "";

    // The import declaration itself, and re-exports, are not reads.
    if (parentType.startsWith("Import") || parentType === "ExportSpecifier") return;
    // `something.name` - a property key that merely shares the binding's name.
    if (
      (parentType === "MemberExpression" || parentType === "OptionalMemberExpression") &&
      parent.property === node &&
      parent.computed !== true
    ) {
      return;
    }
    // `{ name: value }` - an object/class key sharing the binding's name.
    if (
      ["ObjectProperty", "ObjectMethod", "ClassProperty", "ClassMethod"].includes(parentType) &&
      parent.key === node &&
      parent.computed !== true
    ) {
      return;
    }

    if (SPREAD_PARENTS.includes(parentType) && parent.argument === node) {
      findings.push({ binding: node.name, specifier, usage: "spread", line: lineOf(node) });
      return;
    }
    if (parentType === "ForOfStatement" && parent.right === node) {
      findings.push({ binding: node.name, specifier, usage: "iterate", line: lineOf(node) });
      return;
    }
    if ((parentType === "MemberExpression" || parentType === "OptionalMemberExpression") && parent.object === node) {
      findings.push({ binding: node.name, specifier, usage: "member", line: lineOf(node) });
      return;
    }
    if (
      (parentType === "CallExpression" || parentType === "OptionalCallExpression" || parentType === "NewExpression") &&
      parent.callee === node
    ) {
      findings.push({ binding: node.name, specifier, usage: "call", line: lineOf(node) });
    }
  });
  return findings;
}

/* ------------------------------------------------------------------ *
 * Check B's boundary walk (import reachability)                       *
 * ------------------------------------------------------------------ */

/**
 * Every module reachable from a Server Component entry point *without crossing
 * a `"use client"` module*, mapped to the entry points that reach it. The
 * directive is the boundary: everything below it is legitimately client code.
 *
 * The reaching entry point is carried because "this file reads client data" is
 * not actionable on its own - the point is which server route drags it in.
 */
export function serverReachableModules(
  entries: string[],
  graph: Map<string, string[]>,
  isClient: (file: string) => boolean,
): Map<string, string[]> {
  const reachedBy = new Map<string, string[]>();
  const record = (file: string, entry: string) => {
    const existing = reachedBy.get(file);
    if (existing) {
      if (!existing.includes(entry)) existing.push(entry);
    } else {
      reachedBy.set(file, [entry]);
    }
  };

  for (const entry of entries) {
    if (isClient(entry)) continue;
    const seen = new Set<string>([entry]);
    const pending = [entry];
    while (pending.length > 0) {
      const file = pending.pop()!;
      record(file, entry);
      for (const dependency of graph.get(file) ?? []) {
        if (seen.has(dependency) || isClient(dependency)) continue;
        seen.add(dependency);
        pending.push(dependency);
      }
    }
  }
  return reachedBy;
}

/* ------------------------------------------------------------------ *
 * The real tree                                                       *
 * ------------------------------------------------------------------ */

// Every Next.js file convention that renders as a Server Component. `page.tsx`
// and `layout.tsx` alone left 20 `loading.tsx` files - all of them server
// components on real production routes - outside the walk entirely.
//
// `error.tsx` and `global-error.tsx` are deliberately absent and must stay that
// way: React requires an error boundary to be a Client Component, all 19 in this
// repository carry `"use client"`, and the `!isClient(file)` filter below would
// drop them even if the pattern matched. Adding them would be a no-op that reads
// like a fix.
const SERVER_ENTRY_PATTERN = /^src\/app\/(?:.*\/)?(?:page|layout|loading|not-found|template|default)\.tsx$/;

// Scope decision: mockups are IN. `src/app/mockups/**` is exempt from the
// button-wiring and route-reachability gates because those routes 404 in
// production. The developer-gated Owner panel copy that once lived there and
// rendered for real was retired on 2026-10-22. For the rest, the failure mode is a hard runtime throw that breaks the page for the design
// review audience the mockups exist to serve, so a static check that costs
// nothing is worth keeping on.
let boundaryStateCache: ReturnType<typeof computeBoundaryState> | undefined;

function computeBoundaryState() {
  const { files, fileSet, graph, parsed } = runtimeGraph();
  const clientFiles = new Set(files.filter((file) => hasUseClientDirective(parsed.get(file)!.source)));
  const isClient = (file: string) => clientFiles.has(file);
  const entries = files.filter((file) => SERVER_ENTRY_PATTERN.test(relative(file)) && !isClient(file));

  const componentCache = new Map<string, ModuleComponents>();
  const load = (file: string) => {
    let components = componentCache.get(file);
    if (!components) {
      components = moduleComponents(readSource(file), file);
      componentCache.set(file, components);
    }
    return components;
  };
  const resolve = (fromFile: string, specifier: string) => resolveModule(fromFile, specifier, fileSet);

  return {
    fileSet,
    isClient,
    entries,
    load,
    resolve,
    serverModules: serverReachableModules(entries, graph, isClient),
  };
}

function boundaryState() {
  boundaryStateCache ??= computeBoundaryState();
  return boundaryStateCache;
}

/* ------------------------------------------------------------------ *
 * Fixtures - the bug must be reported, the neighbour must not         *
 * ------------------------------------------------------------------ */

function fixtureProject(modules: Record<string, string>) {
  const parsedModules = new Map<string, ModuleComponents>();
  const load = (file: string) => {
    let components = parsedModules.get(file);
    if (!components) {
      const sourceText = modules[file];
      if (sourceText === undefined) throw new Error(`fixture module not found: ${file}`);
      components = moduleComponents(sourceText);
      parsedModules.set(file, components);
    }
    return components;
  };
  const resolve = (_fromFile: string, specifier: string) => (specifier in modules ? specifier : null);
  return { load, resolve };
}

const TOOLBAR_MODULE = `export function Toolbar() {
   function reset() {
     history.back();
   }
   return <button onClick={reset}>Reset</button>;
 }`;

const SHARED_UI_MODULE = `
import { cn } from "./cn";

export function EmptyState({ title }) {
  return <p className={cn("empty")}>{title}</p>;
}

export function IconButton({ onPress, label }) {
  return <button type="button" onClick={() => onPress()}>{label}</button>;
}
`;

describe("rsc boundary - check A: event handlers on the server side", () => {
  it("reports a handler rendered directly by a Server Component page", () => {
    const project = fixtureProject({
      "page.tsx": `export default function Page() {
         return <button onClick={() => revalidate()}>Refresh</button>;
       }`,
    });
    const violations = serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve);
    expect(
      violations.map(({ file, component, attribute, target }) => ({ file, component, attribute, target })),
    ).toEqual([{ file: "page.tsx", component: "default", attribute: "onClick", target: "host element" }]);
  });

  it("reports a handler in a module the server page renders through, and names the entry point", () => {
    const project = fixtureProject({
      "page.tsx": `import { Toolbar } from "./toolbar";
         export default function Page() {
           return <Toolbar />;
         }`,
      "./toolbar": TOOLBAR_MODULE,
    });
    const violations = serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.file).toBe("./toolbar");
    expect(violations[0]!.component).toBe("Toolbar");
    expect(violations[0]!.via).toEqual(["page.tsx", "<Toolbar>"]);
  });

  it("reports every handler-shaped attribute, not just onClick", () => {
    const project = fixtureProject({
      "page.tsx": `export default function Page() {
           return (
             <form onSubmit={() => submit()}>
               <input onChange={() => update()} onFocus={() => track()} />
             </form>
           );
         }`,
    });
    const violations = serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve);
    expect(violations.map((violation) => violation.attribute).sort()).toEqual(["onChange", "onFocus", "onSubmit"]);
  });

  it("reports a function handed to a client component's prop", () => {
    const project = fixtureProject({
      "page.tsx": `import { ClientCard } from "./client-card";
         export default function Page() {
           return <ClientCard onSelect={() => choose()} />;
         }`,
      "./client-card": `"use client";
         export function ClientCard({ onSelect }) {
           return <button onClick={onSelect}>Pick</button>;
         }`,
    });
    const violations = serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve);
    expect(violations.map(({ file, attribute, target }) => ({ file, attribute, target }))).toEqual([
      { file: "page.tsx", attribute: "onSelect", target: "<ClientCard>" },
    ]);
  });

  it("reports a function handed to a client component re-exported by a barrel", () => {
    const project = fixtureProject({
      "page.tsx": `import { ClientCard } from "./barrel";
         export default function Page() {
           return <ClientCard onSelect={() => choose()} />;
         }`,
      "./barrel": `export { ClientCard } from "./client-card";`,
      "./client-card": `"use client";
         export function ClientCard({ onSelect }) {
           return <button onClick={onSelect}>Pick</button>;
         }`,
    });
    expect(serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve)).toHaveLength(1);
  });

  it("does not report a function handed to another Server Component's prop", () => {
    const project = fixtureProject({
      "page.tsx": `import { ServerList } from "./server-list";
         export default function Page() {
           return <ServerList onRender={(row) => row.label} />;
         }`,
      "./server-list": `export function ServerList({ onRender, rows = [] }) {
           return <ul>{rows.map(onRender)}</ul>;
         }`,
    });
    expect(serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve)).toEqual([]);
  });

  it("resolves an imported handler through the module graph", () => {
    // The shape that broke the first version of this guard:
    // `src/components/developer-area/hub/panel-card.tsx` does exactly this with
    // `ignoreUnavailableActivation` from `@/components/ui-primitives`, and a
    // module-local notion of "provably a function" could not see it.
    const project = fixtureProject({
      "page.tsx": `import { ignoreUnavailableActivation } from "./ui";
         export default function Page() {
           return <button onClick={ignoreUnavailableActivation}>Soon</button>;
         }`,
      "./ui": `export function ignoreUnavailableActivation(event) {
           event.preventDefault();
         }`,
    });
    const violations = serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve);
    expect(violations.map(({ file, attribute, target }) => ({ file, attribute, target }))).toEqual([
      { file: "page.tsx", attribute: "onClick", target: "host element" },
    ]);
  });

  it("resolves an imported handler through a barrel re-export and a const arrow", () => {
    const project = fixtureProject({
      "page.tsx": `import { noop } from "./barrel";
         export default function Page() {
           return <button onClick={noop}>Soon</button>;
         }`,
      "./barrel": `export { noop } from "./handlers";`,
      "./handlers": `export const noop = (event) => event.preventDefault();`,
    });
    expect(serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve)).toHaveLength(1);
  });

  it("does not report an imported binding that is not a function", () => {
    const project = fixtureProject({
      "page.tsx": `import { HANDLERS } from "./ui";
         export default function Page() {
           return <button onClick={HANDLERS}>Soon</button>;
         }`,
      "./ui": `export const HANDLERS = { reset: 1 };`,
    });
    expect(serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve)).toEqual([]);
  });

  it("does not report a handler imported from a bare package specifier", () => {
    // `node_modules` is not resolvable here, so the guard declines to guess.
    const project = fixtureProject({
      "page.tsx": `import { noop } from "lodash-es";
         export default function Page() {
           return <button onClick={noop}>Soon</button>;
         }`,
    });
    expect(serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve)).toEqual([]);
  });

  it("does not report a handler imported from a client module", () => {
    // What the server graph receives is a client reference, not the function.
    const project = fixtureProject({
      "page.tsx": `import { onPick } from "./client-handlers";
         export default function Page() {
           return <button onClick={onPick}>Soon</button>;
         }`,
      "./client-handlers": `"use client";
         export function onPick(event) {
           event.preventDefault();
         }`,
    });
    expect(serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve)).toEqual([]);
  });

  it("does not report an imported Server Action", () => {
    const project = fixtureProject({
      "page.tsx": `import { ClientForm } from "./client-form";
         import { saveAction } from "./actions";
         export default function Page() {
           return <ClientForm onSubmit={saveAction} />;
         }`,
      "./actions": `"use server";
         export async function saveAction(data) {
           await save(data);
         }`,
      "./client-form": `"use client";
         export function ClientForm({ onSubmit }) {
           return <form action={onSubmit} />;
         }`,
    });
    expect(serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve)).toEqual([]);
  });

  it("pins the composed prop-flow gap: a handler threaded through a Server Component prop is missed", () => {
    // A DOCUMENTED GAP, not desired behaviour. This route throws on every
    // request, and the guard is silent at both sites: narrowing (2) skips the
    // call site because `Toolbar` is a Server Component, and narrowing (1) skips
    // the render site because `onReset` is a prop rather than a provable
    // function. Each rule is individually correct; the miss lives in the seam.
    //
    // The test exists so the hole is visible in the suite rather than only in a
    // comment. If a future change adds inter-component prop flow and closes it,
    // this expectation SHOULD go red - the fix then is to update this test, never
    // to re-widen a narrowing.
    const project = fixtureProject({
      "page.tsx": `import { Toolbar } from "./toolbar";
         export default function Page() {
           function handleReset() {
             purge();
           }
           return <Toolbar onReset={handleReset} />;
         }`,
      "./toolbar": `export function Toolbar({ onReset }) {
           return <button onClick={onReset}>Reset</button>;
         }`,
    });
    expect(serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve)).toEqual([]);
  });

  it("does not report a Server Action handed to a client component's prop", () => {
    // `"use server"` functions serialise as an opaque reference, not a closure,
    // so this is correct Next code. Without this carve-out the guard would fire
    // on the first form this codebase grows.
    const project = fixtureProject({
      "page.tsx": `import { ClientForm } from "./client-form";
         export default function Page() {
           async function saveAction(data) {
             "use server";
             await save(data);
           }
           const inlineAction = async () => {
             "use server";
             await save();
           };
           return (
             <ClientForm
               onSubmit={saveAction}
               onReset={inlineAction}
               onChange={async () => {
                 "use server";
                 await save();
               }}
             />
           );
         }`,
      "./client-form": `"use client";
         export function ClientForm({ onSubmit }) {
           return <form action={onSubmit} />;
         }`,
    });
    expect(serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve)).toEqual([]);
  });

  it('does not report an action exported from a "use server" module', () => {
    const project = fixtureProject({
      "page.tsx": `import { ClientForm } from "./client-form";
         export default function Page() {
           return <ClientForm onSubmit={saveAction} />;
         }
         export async function saveAction() {
           await save();
         }`,
      "./client-form": `"use client";
         export function ClientForm({ onSubmit }) {
           return <form action={onSubmit} />;
         }`,
    });
    // Control: no directive anywhere, so the guard reports it.
    expect(serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve)).toHaveLength(1);

    // The same shape with a module-level `"use server"`: every top-level function
    // in the file is an action, so nothing is reported.

    const actionsProject = fixtureProject({
      "page.tsx": `"use server";
         import { ClientForm } from "./client-form";
         export default function Page() {
           return <ClientForm onSubmit={saveAction} />;
         }
         export async function saveAction() {
           await save();
         }`,
      "./client-form": `"use client";
         export function ClientForm({ onSubmit }) {
           return <form action={onSubmit} />;
         }`,
    });
    expect(serverRenderedHandlerViolations(["page.tsx"], actionsProject.load, actionsProject.resolve)).toEqual([]);
  });

  it("still reports an ordinary local function handed to a client component's prop", () => {
    // The neighbour of the Server Action cases: identical shape, no directive.
    const project = fixtureProject({
      "page.tsx": `import { ClientForm } from "./client-form";
         export default function Page() {
           function handleSubmit(data) {
             record(data);
           }
           return <ClientForm onSubmit={handleSubmit} />;
         }`,
      "./client-form": `"use client";
         export function ClientForm({ onSubmit }) {
           return <form action={onSubmit} />;
         }`,
    });
    const violations = serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve);
    expect(violations.map(({ attribute, target }) => ({ attribute, target }))).toEqual([
      { attribute: "onSubmit", target: "<ClientForm>" },
    ]);
  });

  it("does not report a data-dependent handler in a generic template", () => {
    // The `ModeHomeTemplate` shape measured on main: the attribute is in the
    // source of a server-rendered component, but the value comes from data the
    // caller supplies as an empty array, so no function is ever serialised.
    const project = fixtureProject({
      "page.tsx": `import { ModeHome } from "./mode-home";
         export default function Page() {
           return <ModeHome actions={[]} />;
         }`,
      "./mode-home": `export function ModeHome({ actions }) {
           return (
             <div>
               {actions.map((action) =>
                 action.href ? (
                   <a key={action.title} href={action.href}>{action.title}</a>
                 ) : (
                   <button key={action.title} onClick={action.onClick}>{action.title}</button>
                 ),
               )}
             </div>
           );
         }`,
    });
    expect(serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve)).toEqual([]);
  });

  it('reports nothing when the page itself declares "use client"', () => {
    const project = fixtureProject({
      "page.tsx": `"use client";
         export default function Page() {
           return <button onClick={() => setOpen(true)}>Open</button>;
         }`,
    });
    expect(serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve)).toEqual([]);
  });

  it("stops at the boundary: a handler module reached only through a client module is not reported", () => {
    const project = fixtureProject({
      "page.tsx": `import { ClientCard } from "./client-card";
         export default function Page() {
           return <ClientCard />;
         }`,
      "./client-card": `"use client";
         import { Toolbar } from "./toolbar";
         export function ClientCard() {
           return <Toolbar />;
         }`,
      "./toolbar": TOOLBAR_MODULE,
    });
    expect(serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve)).toEqual([]);
  });

  it("does not report a sibling export the server page never renders", () => {
    const project = fixtureProject({
      "page.tsx": `import { EmptyState } from "./ui";
         export default function Page() {
           return <EmptyState title="None" />;
         }`,
      "./ui": SHARED_UI_MODULE,
      "./cn": `export const cn = (...parts) => parts.join(" ");`,
    });
    expect(serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve)).toEqual([]);
  });

  it("still reports that sibling export once a server page actually renders it", () => {
    const project = fixtureProject({
      "page.tsx": `import { IconButton } from "./ui";
         export default function Page() {
           return <IconButton label="Close" onPress={close} />;
         }`,
      "./ui": SHARED_UI_MODULE,
      "./cn": `export const cn = (...parts) => parts.join(" ");`,
    });
    const violations = serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve);
    // The page's own `onPress={close}` is not provably a function (`close` is
    // not declared here); the inline `onClick` inside the now-server-rendered
    // IconButton is the defect.
    expect(violations.map(({ file, component, attribute }) => ({ file, component, attribute }))).toEqual([
      { file: "./ui", component: "IconButton", attribute: "onClick" },
    ]);
  });

  it("does not mistake a lowercase or valueless attribute for a handler", () => {
    const project = fixtureProject({
      "page.tsx": `export default function Page() {
           return <div online ononsense="x" onClick />;
         }`,
    });
    expect(serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve)).toEqual([]);
  });

  it("follows a default export aliased to a local declaration, and a barrel re-export", () => {
    const project = fixtureProject({
      "page.tsx": `import { Toolbar } from "./barrel";
         function Page() {
           return <Toolbar />;
         }
         export default Page;`,
      "./barrel": `export { Toolbar } from "./toolbar";`,
      "./toolbar": TOOLBAR_MODULE,
    });
    const violations = serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve);
    expect(violations.map((violation) => violation.file)).toEqual(["./toolbar"]);
  });

  it("never walks out of a client entry point", () => {
    const project = fixtureProject({
      "page.tsx": `"use client";
         import { Toolbar } from "./toolbar";
         export default function Page() {
           return <Toolbar />;
         }`,
      "./toolbar": TOOLBAR_MODULE,
    });
    expect(serverRenderedHandlerViolations(["page.tsx"], project.load, project.resolve)).toEqual([]);
  });
});

const isClientFixtureSpecifier = (specifier: string) => specifier === "./client-catalog";

describe("rsc boundary - check B: server modules reading client data", () => {
  it("reports the exact class-2 bug: a server module operating on a client export", () => {
    const findings = clientDataUsages(
      `import { MODE_ROWS } from "./client-catalog";

       export default function Page() {
         return <ul>{MODE_ROWS.flatMap((row) => row.items)}</ul>;
       }`,
      isClientFixtureSpecifier,
    );
    expect(findings).toEqual([{ binding: "MODE_ROWS", specifier: "./client-catalog", usage: "member", line: 4 }]);
  });

  it("reports client data reached through a directive-free barrel", () => {
    const project = fixtureProject({
      "page.tsx": `import { MODE_ROWS } from "./barrel";
         export const count = MODE_ROWS.length;`,
      "./barrel": `export { MODE_ROWS } from "./client-catalog";`,
      "./client-catalog": `"use client";
         export const MODE_ROWS = [];`,
    });
    expect(
      clientDataUsages(
        `import { MODE_ROWS } from "./barrel";
         export const count = MODE_ROWS.length;`,
        (specifier, exported) =>
          exportedBindingIsClient("page.tsx", specifier, exported, project.load, project.resolve),
      ),
    ).toEqual([{ binding: "MODE_ROWS", specifier: "./barrel", usage: "member", line: 2 }]);
  });

  it("reports calling a value imported from a client module", () => {
    const findings = clientDataUsages(
      `import { buildRows } from "./client-catalog";
       export const rows = buildRows();`,
      isClientFixtureSpecifier,
    );
    expect(findings.map((finding) => finding.usage)).toEqual(["call"]);
  });

  it("reports spreading a client export into an array, an object, or a call", () => {
    const findings = clientDataUsages(
      `import { MODE_ROWS } from "./client-catalog";
       export const copy = [...MODE_ROWS];
       export const merged = { ...MODE_ROWS };
       export const saved = save(...MODE_ROWS);`,
      isClientFixtureSpecifier,
    );
    expect(findings.map((finding) => finding.usage)).toEqual(["spread", "spread", "spread"]);
  });

  it("reports iterating a client export", () => {
    const findings = clientDataUsages(
      `import { MODE_ROWS } from "./client-catalog";
       export function render() {
         for (const row of MODE_ROWS) {
           emit(row);
         }
       }`,
      isClientFixtureSpecifier,
    );
    expect(findings.map((finding) => finding.usage)).toEqual(["iterate"]);
  });

  it("reports nothing for spreading a module that is not a client module", () => {
    expect(
      clientDataUsages(
        `import { MODE_ROWS } from "./server-catalog";
         export const copy = [...MODE_ROWS];`,
        isClientFixtureSpecifier,
      ),
    ).toEqual([]);
  });

  it("reports namespace member access into a client module", () => {
    const findings = clientDataUsages(
      `import * as catalog from "./client-catalog";
       export const count = catalog.rows.length;`,
      isClientFixtureSpecifier,
    );
    expect(findings.map((finding) => finding.binding)).toEqual(["catalog"]);
  });

  it("reports nothing for a client component imported and rendered as JSX", () => {
    expect(
      clientDataUsages(
        `import { ClientCard } from "./client-catalog";
         export default function Page() {
           return <ClientCard title="Modes" />;
         }`,
        isClientFixtureSpecifier,
      ),
    ).toEqual([]);
  });

  it("reports nothing for a compound client component used as a JSX name", () => {
    expect(
      clientDataUsages(
        `import { Tabs } from "./client-catalog";
         export default function Page() {
           return (
             <Tabs>
               <Tabs.List />
             </Tabs>
           );
         }`,
        isClientFixtureSpecifier,
      ),
    ).toEqual([]);
  });

  it("reports nothing for a client component passed along as a value", () => {
    expect(
      clientDataUsages(
        `import { ClientCard } from "./client-catalog";
         export { ClientCard };
         export default function Page() {
           return <Slot render={ClientCard} fallback={[ClientCard]} />;
         }`,
        isClientFixtureSpecifier,
      ),
    ).toEqual([]);
  });

  it("reports nothing for a type-only import from a client module", () => {
    expect(
      clientDataUsages(
        `import type { CatalogRow } from "./client-catalog";
         import { type OtherRow, ClientCard } from "./client-catalog";
         const value: CatalogRow.Nested = load();
         export const rows: OtherRow[] = [];
         export default () => <ClientCard row={value} />;`,
        isClientFixtureSpecifier,
      ),
    ).toEqual([]);
  });

  it("reports nothing for member access on a module that is not a client module", () => {
    expect(
      clientDataUsages(
        `import { MODE_ROWS } from "./server-catalog";
         export const first = MODE_ROWS.at(0);`,
        isClientFixtureSpecifier,
      ),
    ).toEqual([]);
  });

  it("reports nothing for a same-named property key or a shadowing local", () => {
    expect(
      clientDataUsages(
        `import { ClientCard } from "./client-catalog";
         export const registry = { ClientCard, other: shape.ClientCard };
         export default () => <ClientCard />;`,
        isClientFixtureSpecifier,
      ),
    ).toEqual([]);
    expect(
      clientDataUsages(
        `import { rows } from "./client-catalog";
         export function render(rows: string[]) {
           return rows.length;
         }`,
        isClientFixtureSpecifier,
      ),
    ).toEqual([]);
  });

  it("reports nothing when the reading module is itself a client module", () => {
    expect(
      clientDataUsages(
        `"use client";
         import { MODE_ROWS } from "./client-catalog";
         export const count = MODE_ROWS.length;`,
        isClientFixtureSpecifier,
      ),
    ).toEqual([]);
  });
});

describe("rsc boundary - the repository", () => {
  // Collapse detectors, not targets. Both assertions below exist because the two
  // real-tree checks are only as strong as the surface they walk: an edit to
  // SERVER_ENTRY_PATTERN, to `relative()`, or to route-group handling could
  // quietly drop the walk to a handful of routes, and the suite would stay green
  // forever while covering almost nothing. That is exactly the check-that-cannot-
  // fail defect this guard was built to be the opposite of, so the floors sit
  // near the measurement rather than at a token value.
  //
  // Measured on this branch: 212 server entry points reaching 341 modules. Each
  // floor sits ~15% under its measurement - loose enough that ordinary route
  // churn cannot trip it, tight enough that losing a route convention or a whole
  // route group does. (The previous `> 20` was 9.6x below the real count: the
  // walk could have collapsed to 13% of the app and stayed green forever.)
  //
  // If a legitimate refactor genuinely moves the real number under a floor, lower
  // it deliberately in its own commit and put the fresh measurement in the message.
  // Never nudge a floor to clear a red run.
  const ENTRY_FLOOR = 180;
  const MODULE_FLOOR = 290;

  it("treats every server-rendered route convention as an entry point", () => {
    const matches = (route: string) => SERVER_ENTRY_PATTERN.test(route);
    expect(
      [
        "src/app/page.tsx",
        "src/app/(search-app)/calculators/loading.tsx",
        "src/app/(search-app)/dictionary/layout.tsx",
        "src/app/documents/[id]/not-found.tsx",
        "src/app/reference/template.tsx",
        "src/app/@modal/default.tsx",
      ].filter((route) => !matches(route)),
    ).toEqual([]);
    // Error boundaries must be Client Components, so they are intentionally not
    // entry points; `!isClient(file)` would drop them regardless.
    expect(["src/app/error.tsx", "src/app/global-error.tsx"].filter(matches)).toEqual([]);
    // Not a route file, and not under src/app.
    expect(["src/app/(search-app)/page-header.tsx", "src/components/page.tsx"].filter(matches)).toEqual([]);
  });

  it("walks a plausible share of the app's server routes", { timeout: 120_000 }, () => {
    const { entries, serverModules } = boundaryState();
    expect(entries.length).toBeGreaterThanOrEqual(ENTRY_FLOOR);
    expect(serverModules.size).toBeGreaterThanOrEqual(MODULE_FLOOR);
  });

  it("has no event handler on the server side of the boundary", { timeout: 120_000 }, () => {
    const { entries, load, resolve } = boundaryState();
    const violations = serverRenderedHandlerViolations(entries, load, resolve).map(
      (violation) =>
        `${relative(violation.file)}:${violation.line} ${violation.attribute} in <${violation.component}> - rendered via ${violation.via
          .map((step) => (step.startsWith("<") ? step : relative(step)))
          .join(" -> ")}`,
    );
    expect([...new Set(violations)].sort()).toEqual([]);
  });

  it("has no server module reading data out of a client module", { timeout: 120_000 }, () => {
    const { load, resolve, serverModules } = boundaryState();
    const violations: string[] = [];
    for (const [file, reachingEntries] of serverModules) {
      const findings = clientDataUsages(readSource(file), (specifier, exported) =>
        exportedBindingIsClient(file, specifier, exported, load, resolve),
      );
      for (const finding of findings) {
        violations.push(
          `${relative(file)}:${finding.line} ${finding.usage} on ${finding.binding} from ${finding.specifier} - reached by ${reachingEntries
            .slice(0, 3)
            .map(relative)
            .join(", ")}`,
        );
      }
    }
    expect(violations.sort()).toEqual([]);
  });
});
