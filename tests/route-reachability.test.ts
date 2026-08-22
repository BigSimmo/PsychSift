import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

import { appModeDefinitions, appModeHomeHref } from "@/lib/app-modes";
import { modeSecondaryNavigationRegistry } from "@/lib/mode-secondary-navigation";
import { tools } from "@/components/tools-page-mockups/tool-fixtures";
import { collectSiteMapData } from "../scripts/generate-site-map";

/**
 * Orphan-route guard. `site-map.test.ts` proves every route is *documented*;
 * this proves every static production page route is *reachable* — i.e. some
 * in-app navigation actually links to it. A page you can only reach by typing
 * its URL (the `/tools` class) is an orphan and must be either wired into nav
 * or added, with a reason, to REACHABILITY_ALLOWLIST below.
 *
 * Scope: static page routes only. Dynamic `[slug]` detail routes are reached
 * via href builders from live/seeded data (`universal-search.ts`, registry
 * loaders); their targets are covered by `site-map.test.ts`'s documented-href
 * assertions, and pattern-matching interpolated hrefs here would be brittle.
 * Mockups (`src/app/mockups/**`, `*-mockups/**`) are design-scratch and 404 in
 * production, so a link *from* a mockup does not count and mockup routes are
 * not required to be linked.
 */

const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, "src");

/** Intentionally-unlinked static page routes, each with the reason it is exempt. */
const REACHABILITY_ALLOWLIST = new Map<string, string>([
  [
    "/documents/source",
    "Legacy compatibility redirect target reached by external/legacy deep links, not in-app navigation (frontend-architecture.md).",
  ],
  [
    "/documents/source/evidence",
    "Legacy compatibility redirect target reached by external/legacy deep links, not in-app navigation (frontend-architecture.md).",
  ],
  [
    "/dictionary/browse",
    "Retired half of the merged Dictionary catalogue. It redirects to /dictionary/search (proxy fast path plus a page backstop), so in-app navigation deliberately links the surviving route directly rather than routing readers through a redirect.",
  ],
  [
    "/ward-management/constellation",
    "Retired Phase 1 constellation view. It redirects to /ward-management/network so live-main bookmarks keep working; in-app navigation uses the eight remaining rail modes and does not send readers through the redirect.",
  ],
]);

function isMockupPath(relPosix: string) {
  return relPosix.toLowerCase().includes("mockup");
}

function pathOnly(href: string) {
  return href.split(/[?#]/)[0] || "/";
}

const ROUTER_METHODS = new Set(["push", "replace"]);
const FUNCTION_NODE_TYPES = new Set([
  "ArrowFunctionExpression",
  "ClassMethod",
  "ClassPrivateMethod",
  "FunctionDeclaration",
  "FunctionExpression",
  "ObjectMethod",
]);

type AstNode = Record<string, unknown>;
type BindingKind =
  "mode-home-template" | "next-link" | "next-redirect" | "next-response" | "next-use-router" | "other" | "router";

type Scope = {
  bindings: Map<string, BindingKind>;
  parent: Scope | null;
};

function asNode(value: unknown): AstNode | null {
  return value && typeof value === "object" && typeof (value as AstNode).type === "string" ? (value as AstNode) : null;
}

function isFunctionNode(node: AstNode) {
  return FUNCTION_NODE_TYPES.has(String(node.type));
}

function identifierName(node: AstNode | null) {
  return node?.type === "Identifier" && typeof node.name === "string" ? node.name : null;
}

function jsxIdentifierName(node: AstNode | null) {
  return node?.type === "JSXIdentifier" && typeof node.name === "string" ? node.name : null;
}

function importedName(node: AstNode | null) {
  if (!node) return null;
  if (node.type === "Identifier" && typeof node.name === "string") return node.name;
  if (node.type === "StringLiteral" && typeof node.value === "string") return node.value;
  return null;
}

function declarePattern(pattern: AstNode | null, scope: Scope) {
  if (!pattern) return;
  const name = identifierName(pattern);
  if (name) {
    scope.bindings.set(name, "other");
    return;
  }
  if (pattern.type === "RestElement" || pattern.type === "AssignmentPattern") {
    declarePattern(asNode(pattern.argument ?? pattern.left), scope);
    return;
  }
  if (pattern.type === "ObjectProperty") {
    declarePattern(asNode(pattern.value), scope);
    return;
  }
  if (pattern.type === "TSParameterProperty") {
    declarePattern(asNode(pattern.parameter), scope);
    return;
  }
  if (pattern.type === "ObjectPattern") {
    const properties = Array.isArray(pattern.properties) ? pattern.properties : [];
    properties.forEach((property) => declarePattern(asNode(property), scope));
    return;
  }
  if (pattern.type === "ArrayPattern") {
    const elements = Array.isArray(pattern.elements) ? pattern.elements : [];
    elements.forEach((element) => declarePattern(asNode(element), scope));
  }
}

function resolveBinding(name: string, scope: Scope): BindingKind | null {
  for (let current: Scope | null = scope; current; current = current.parent) {
    const binding = current.bindings.get(name);
    if (binding) return binding;
  }
  return null;
}

function isImportedHookCall(node: AstNode | null, scope: Scope) {
  if (!node || (node.type !== "CallExpression" && node.type !== "OptionalCallExpression")) return false;
  const calleeName = identifierName(asNode(node.callee));
  return Boolean(calleeName && resolveBinding(calleeName, scope) === "next-use-router");
}

function predeclareVariable(node: AstNode, scope: Scope) {
  const declarations = Array.isArray(node.declarations) ? node.declarations : [];
  for (const declarationValue of declarations) {
    const declaration = asNode(declarationValue);
    if (declaration?.type !== "VariableDeclarator") continue;
    declarePattern(asNode(declaration.id), scope);
  }
}

function classifyRouterVariables(node: AstNode, scope: Scope) {
  const declarations = Array.isArray(node.declarations) ? node.declarations : [];
  for (const declarationValue of declarations) {
    const declaration = asNode(declarationValue);
    const name = identifierName(asNode(declaration?.id));
    if (name && isImportedHookCall(asNode(declaration?.init), scope)) {
      scope.bindings.set(name, "router");
    }
  }
}

function declareDirectBindings(statements: unknown[], scope: Scope, includeImports = false) {
  if (includeImports) {
    for (const statementValue of statements) {
      const statement = asNode(statementValue);
      if (statement?.type !== "ImportDeclaration") continue;
      const source = asNode(statement.source);
      if (source?.type !== "StringLiteral" || typeof source.value !== "string") continue;
      const specifiers = Array.isArray(statement.specifiers) ? statement.specifiers : [];
      for (const specifierValue of specifiers) {
        const specifier = asNode(specifierValue);
        const localName = identifierName(asNode(specifier?.local));
        if (!specifier || !localName) continue;
        let kind: BindingKind = "other";
        if (
          source.value === "next/link" &&
          (specifier.type === "ImportDefaultSpecifier" ||
            (specifier.type === "ImportSpecifier" && importedName(asNode(specifier.imported)) === "default"))
        ) {
          kind = "next-link";
        } else if (source.value === "next/navigation" && specifier.type === "ImportSpecifier") {
          const name = importedName(asNode(specifier.imported));
          if (name === "redirect" || name === "permanentRedirect") kind = "next-redirect";
          else if (name === "useRouter") kind = "next-use-router";
        } else if (
          source.value === "next/server" &&
          specifier.type === "ImportSpecifier" &&
          importedName(asNode(specifier.imported)) === "NextResponse"
        ) {
          kind = "next-response";
        } else if (
          source.value === "@/components/mode-home-template" &&
          specifier.type === "ImportSpecifier" &&
          importedName(asNode(specifier.imported)) === "ModeHomeTemplate"
        ) {
          kind = "mode-home-template";
        }
        scope.bindings.set(localName, kind);
      }
    }
  }

  // Predeclare every direct lexical binding before classifying router results.
  // This makes later declarations shadow imports throughout their real scope.
  for (const statementValue of statements) {
    const statement = asNode(statementValue);
    if (!statement) continue;
    if (statement.type === "VariableDeclaration") predeclareVariable(statement, scope);
    else if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
      declarePattern(asNode(statement.id), scope);
    }
  }
  for (const statementValue of statements) {
    const statement = asNode(statementValue);
    if (statement?.type === "VariableDeclaration") classifyRouterVariables(statement, scope);
  }
}

function declareFunctionVars(node: AstNode, scope: Scope) {
  const declarations: AstNode[] = [];
  const visit = (value: unknown) => {
    const child = asNode(value);
    if (!child) return;
    if (
      child !== node &&
      (isFunctionNode(child) || child.type === "ClassDeclaration" || child.type === "ClassExpression")
    ) {
      return;
    }
    if (child.type === "VariableDeclaration" && child.kind === "var") declarations.push(child);
    for (const nested of Object.values(child)) {
      if (Array.isArray(nested)) nested.forEach(visit);
      else visit(nested);
    }
  };
  visit(node.body);
  declarations.forEach((declaration) => predeclareVariable(declaration, scope));
  declarations.forEach((declaration) => classifyRouterVariables(declaration, scope));
}

function stringVariants(node: AstNode | null): string[] | null {
  if (!node) return null;
  if (node.type === "StringLiteral" && typeof node.value === "string") return [node.value];
  if (node.type === "TemplateLiteral") {
    const quasis = Array.isArray(node.quasis) ? node.quasis : [];
    const expressions = Array.isArray(node.expressions) ? node.expressions : [];
    if (quasis.length !== expressions.length + 1) return null;

    let variants = [""];
    for (let index = 0; index < quasis.length; index += 1) {
      const quasi = asNode(quasis[index]);
      const value = (quasi?.value as Record<string, unknown> | undefined)?.cooked;
      if (typeof value !== "string") return null;
      variants = variants.map((prefix) => prefix + value);
      if (index === expressions.length) continue;
      const expressionVariants = stringVariants(asNode(expressions[index]));
      if (!expressionVariants) return null;
      variants = variants.flatMap((prefix) => expressionVariants.map((expression) => prefix + expression));
    }
    return variants;
  }
  if (node.type === "ConditionalExpression") {
    const consequent = stringVariants(asNode(node.consequent));
    const alternate = stringVariants(asNode(node.alternate));
    return consequent && alternate ? [...consequent, ...alternate] : null;
  }
  if (node.type === "LogicalExpression") {
    const left = stringVariants(asNode(node.left));
    const right = stringVariants(asNode(node.right));
    if (!left || !right) return null;
    return left.flatMap((value) => {
      if (node.operator === "&&") return value ? right : [value];
      if (node.operator === "||") return value ? [value] : right;
      return [value];
    });
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = stringVariants(asNode(node.left));
    const right = stringVariants(asNode(node.right));
    return left && right ? left.flatMap((prefix) => right.map((suffix) => prefix + suffix)) : null;
  }
  if (node.type === "SequenceExpression") {
    const expressions = Array.isArray(node.expressions) ? node.expressions : [];
    return stringVariants(asNode(expressions.at(-1)));
  }
  if (
    node.type === "TSAsExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "TSTypeAssertion" ||
    node.type === "TSNonNullExpression" ||
    node.type === "ParenthesizedExpression"
  ) {
    return stringVariants(asNode(node.expression));
  }
  return null;
}

function addNavigationExpressionTargets(node: AstNode | null, targets: Set<string>) {
  if (!node) return;
  const variants = stringVariants(node);
  if (variants) {
    for (const href of variants) {
      if (href.startsWith("/")) targets.add(pathOnly(href));
    }
    return;
  }

  if (node.type === "ObjectExpression") {
    const properties = Array.isArray(node.properties) ? node.properties : [];
    for (const propertyValue of properties) {
      const property = asNode(propertyValue);
      if (property?.type !== "ObjectProperty") continue;
      const key = asNode(property.key);
      const isPathname =
        (key?.type === "Identifier" && !property.computed && key.name === "pathname") ||
        (key?.type === "StringLiteral" && key.value === "pathname");
      if (isPathname) addNavigationExpressionTargets(asNode(property.value), targets);
    }
    return;
  }

  if (node.type === "TemplateLiteral") {
    const firstQuasi = asNode(Array.isArray(node.quasis) ? node.quasis[0] : null);
    const prefix = (firstQuasi?.value as Record<string, unknown> | undefined)?.cooked;
    if (typeof prefix === "string" && prefix.startsWith("/") && /[?#]/.test(prefix)) {
      targets.add(pathOnly(prefix));
    }
    return;
  }

  if (node.type === "ConditionalExpression") {
    addNavigationExpressionTargets(asNode(node.consequent), targets);
    addNavigationExpressionTargets(asNode(node.alternate), targets);
  } else if (node.type === "LogicalExpression") {
    if (node.operator !== "&&") addNavigationExpressionTargets(asNode(node.left), targets);
    addNavigationExpressionTargets(asNode(node.right), targets);
  }
}

function memberName(node: AstNode | null) {
  if (!node || (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression")) return null;
  const property = asNode(node.property);
  if (!node.computed && property?.type === "Identifier" && typeof property.name === "string") return property.name;
  if (node.computed && property?.type === "StringLiteral" && typeof property.value === "string") return property.value;
  return null;
}

function isNavigationCall(node: AstNode, scope: Scope) {
  if (node.type !== "CallExpression" && node.type !== "OptionalCallExpression") return false;
  const callee = asNode(node.callee);
  const calleeName = identifierName(callee);
  if (calleeName) return resolveBinding(calleeName, scope) === "next-redirect";

  const method = memberName(callee);
  const objectName = identifierName(asNode(callee?.object));
  if (!method || !objectName) return false;
  const binding = resolveBinding(objectName, scope);
  return (ROUTER_METHODS.has(method) && binding === "router") || (method === "redirect" && binding === "next-response");
}

function jsxElementName(node: AstNode) {
  return jsxIdentifierName(asNode(node.name));
}

function addModeHomeActionTargets(value: unknown, targets: Set<string>) {
  const node = asNode(value);
  if (!node) return;
  if (node.type === "ObjectProperty") {
    const key = asNode(node.key);
    const isHref =
      (key?.type === "Identifier" && key.name === "href") || (key?.type === "StringLiteral" && key.value === "href");
    if (isHref) {
      addNavigationExpressionTargets(asNode(node.value), targets);
      return;
    }
  }
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) child.forEach((entry) => addModeHomeActionTargets(entry, targets));
    else addModeHomeActionTargets(child, targets);
  }
}

/** Parse executable syntax and return only destinations used by bound navigation APIs. */
function collectNavigationTargets(source: string, filename = "fixture.tsx") {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, { sourceType: "unambiguous", plugins: ["jsx", "typescript"] });
  } catch (error) {
    throw new Error(`route-reachability: could not parse ${filename}`, { cause: error });
  }

  const targets = new Set<string>();
  const visit = (value: unknown, scope: Scope) => {
    const node = asNode(value);
    if (!node) return;

    if (node.type === "Program") {
      const programScope: Scope = { bindings: new Map(), parent: null };
      const body = Array.isArray(node.body) ? node.body : [];
      declareDirectBindings(body, programScope, true);
      body.forEach((entry) => visit(entry, programScope));
      return;
    }

    let activeScope = scope;
    if (isFunctionNode(node)) {
      activeScope = { bindings: new Map(), parent: scope };
      const params = Array.isArray(node.params) ? node.params : [];
      params.forEach((param) => declarePattern(asNode(param), activeScope));
      declareFunctionVars(node, activeScope);
    } else if (node.type === "BlockStatement") {
      activeScope = { bindings: new Map(), parent: scope };
      declareDirectBindings(Array.isArray(node.body) ? node.body : [], activeScope);
    } else if (node.type === "CatchClause") {
      activeScope = { bindings: new Map(), parent: scope };
      declarePattern(asNode(node.param), activeScope);
    }

    if (node.type === "JSXOpeningElement") {
      const elementName = jsxElementName(node);
      const binding = elementName ? resolveBinding(elementName, activeScope) : null;
      const isLink = binding === "next-link";
      const isModeHomeTemplate = binding === "mode-home-template";
      const attributes = Array.isArray(node.attributes) ? node.attributes : [];
      for (const attributeValue of attributes) {
        const attribute = asNode(attributeValue);
        if (attribute?.type !== "JSXAttribute") continue;
        const name = jsxIdentifierName(asNode(attribute.name));
        const valueNode = asNode(attribute.value);
        const expression = valueNode?.type === "JSXExpressionContainer" ? asNode(valueNode.expression) : valueNode;
        if (isLink && name === "href") addNavigationExpressionTargets(expression, targets);
        else if (isModeHomeTemplate && name === "actions") addModeHomeActionTargets(expression, targets);
      }
    } else if (isNavigationCall(node, activeScope)) {
      const args = Array.isArray(node.arguments) ? node.arguments : [];
      addNavigationExpressionTargets(asNode(args[0]), targets);
    }

    for (const [key, child] of Object.entries(node)) {
      if (key === "body" && node.type === "Program") continue;
      if (Array.isArray(child)) child.forEach((entry) => visit(entry, activeScope));
      else visit(child, activeScope);
    }
  };

  visit(ast, { bindings: new Map(), parent: null });
  return targets;
}

function collectSourceFiles(dir: string): { rel: string; targets: Set<string> }[] {
  const out: { rel: string; targets: Set<string> }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(abs));
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
      const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
      if (!isMockupPath(rel)) out.push({ rel, targets: collectNavigationTargets(readFileSync(abs, "utf8"), rel) });
    }
  }
  return out;
}

const sourceFiles = collectSourceFiles(srcRoot);

/** Route targets produced by the canonical nav builders (never bare string literals). */
const builderTargets = new Set<string>();
for (const mode of appModeDefinitions) {
  // Record both the default home path and a query-bearing variant: appModeHomeHref
  // can emit a different path when given a query (e.g. document / namespaced-search
  // routes), and those are valid static targets that must not read as orphaned.
  const hrefs = [
    ("href" in mode ? mode.href : undefined) ?? appModeHomeHref(mode.id),
    appModeHomeHref(mode.id, { query: "__reachability__" }),
  ];
  for (const href of hrefs) builderTargets.add(pathOnly(href));
}
for (const tool of tools) builderTargets.add(pathOnly(tool.href));

// ModeNav destinations are data (registry href strings rendered as <Link>s), so
// a JSX/router scan never sees `/differentials/compare` and peers as literals.
// Treat the registry as a canonical nav builder, same as app-mode homes.
for (const entries of Object.values(modeSecondaryNavigationRegistry)) {
  for (const entry of entries) {
    if ("href" in entry && entry.href) builderTargets.add(pathOnly(entry.href));
  }
}

// Therapy Compass owns a self-contained route family whose fixed screens are
// navigated via the shared `therapyScreenHref(screen)` builder (`go*()` → router.push),
// so the sub-route paths never appear as literals a static scan could see. Read
// the family's reserved segments straight from the source of truth so new screens
// are picked up automatically. See src/lib/therapy-compass-navigation.ts.
const tcNavigationSrc = readFileSync(path.join(srcRoot, "lib/therapy-compass-navigation.ts"), "utf8");
const tcBaseMatch = tcNavigationSrc.match(/THERAPY_COMPASS_BASE = "([^"]+)"/);
const tcReservedMatch = tcNavigationSrc.match(/THERAPY_RESERVED_ROUTE_SEGMENTS = \[([^\]]*)]/);
// Fail loudly if the source shape changed: a silent `?? default` / empty fallback
// would drop every reserved Therapy Compass route from the guard without notice.
if (!tcBaseMatch || !tcReservedMatch) {
  throw new Error(
    "route-reachability: could not parse Therapy base / reserved routes from therapy-compass-navigation.ts — " +
      "update this parser to match the current source so reserved routes stay covered.",
  );
}
const tcBase = tcBaseMatch[1];
const tcReservedSegments = [...tcReservedMatch[1].matchAll(/"([^"]+)"/g)];
if (tcReservedSegments.length === 0) {
  throw new Error(
    "route-reachability: RESERVED_SEGMENTS parsed to an empty set — Therapy Compass routes would be unchecked.",
  );
}
for (const match of tcReservedSegments) {
  builderTargets.add(`${tcBase}/${match[1]}`);
}

/** A route is reachable if a builder emits it, or a non-mockup source file links to it. */
function isReachable(route: string, selfFile: string) {
  if (builderTargets.has(route)) return true;
  return sourceFiles.some((file) => file.rel !== selfFile && file.targets.has(route));
}

const staticPageRoutes = collectSiteMapData()
  .pageRoutes.map((route) => ({ route: route.route, file: route.file.split(path.sep).join("/") }))
  .filter(
    (entry) =>
      entry.route !== "/" && // app root, trivially the entry point
      !entry.route.includes("[") && // dynamic families reached via builders (see header)
      !entry.route.startsWith("/mockups"),
  );

describe("route reachability", () => {
  it("counts only navigation APIs resolved to their framework imports", () => {
    const targets = collectNavigationTargets(`
      import AppLink from "next/link";
      import { redirect as go, useRouter as useAppRouter } from "next/navigation";

      const linked = <AppLink href="/aliased-link" />;
      const unboundLink = <Link href="/unbound-link-name" />;
      const rawAnchor = <a href="/raw-anchor" />;
      go("/framework-redirect");

      function BoundRouter() {
        const router = useAppRouter();
        router.push("/bound-router");
        router.prefetch("/prefetch-only");
        return null;
      }

      function ShadowedRedirect(go: (href: string) => void) {
        go("/shadowed-redirect");
      }

      function ShadowedRouter({ router }: { router: { push(href: string): void } }) {
        router.push("/shadowed-router");
        return <AppLink href="/still-bound-link" />;
      }

      function ShadowedLink(AppLink: React.ComponentType<{ href: string }>) {
        return <AppLink href="/shadowed-link" />;
      }

      const router = { push: (href: string) => href };
      router.push("/unbound-router-name");
      redirect("/unbound-redirect-name");
    `);

    expect([...targets].sort()).toEqual(["/aliased-link", "/bound-router", "/framework-redirect", "/still-bound-link"]);
  });

  it("extracts conditional and template destinations from bound navigation nodes", () => {
    const targets = collectNavigationTargets(`
      import Link from "next/link";
      import { permanentRedirect, useRouter } from "next/navigation";

      const conditional = <Link href={enabled ? "/conditional-primary?tab=one" : "/conditional-fallback#part"} />;
      const template = <Link href={\`/template-target?query=\${query}\`} />;
      const objectForm = <Link href={{ pathname: enabled ? "/object-primary" : "/object-fallback" }} />;
      permanentRedirect(enabled ? "/redirect-primary" : "/redirect-fallback");

      function ClientNavigation() {
        const navigation = useRouter();
        navigation.replace(enabled ? "/replace-primary" : "/replace-fallback?from=test");
        navigation["push"]("/computed-push");
      }
    `);

    expect([...targets].sort()).toEqual([
      "/computed-push",
      "/conditional-fallback",
      "/conditional-primary",
      "/object-fallback",
      "/object-primary",
      "/redirect-fallback",
      "/redirect-primary",
      "/replace-fallback",
      "/replace-primary",
      "/template-target",
    ]);
  });

  it("allows inline href data only for ModeHomeTemplate.actions", () => {
    const targets = collectNavigationTargets(`
      import { ModeHomeTemplate as Home } from "@/components/mode-home-template";

      const arbitrary = <Card metadata={{ href: "/arbitrary-metadata" }} href="/arbitrary-href" />;
      const home = (
        <Home
          actions={[
            { label: "Primary", href: "/inline-action" },
            enabled ? { label: "A", href: "/inline-conditional-a" } : { label: "B", href: "/inline-conditional-b" },
          ]}
          metadata={{ href: "/unapproved-mode-home-prop" }}
        />
      );
    `);

    expect([...targets].sort()).toEqual(["/inline-action", "/inline-conditional-a", "/inline-conditional-b"]);
  });

  it("every static production page route is linked from in-app navigation", () => {
    const orphans = staticPageRoutes
      .filter((entry) => !REACHABILITY_ALLOWLIST.has(entry.route))
      .filter((entry) => !isReachable(entry.route, entry.file))
      .map((entry) => entry.route);

    expect(
      orphans,
      `Orphan page route(s) with no inbound <Link>/router.push/redirect. Wire them into nav ` +
        `(sidebar/launcher/mode home/search), or add to REACHABILITY_ALLOWLIST with a reason: ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("reachability allowlist has no stale entries", () => {
    const routes = new Set(staticPageRoutes.map((entry) => entry.route));
    for (const route of REACHABILITY_ALLOWLIST.keys()) {
      expect(routes.has(route), `${route} is allowlisted but is no longer a static page route`).toBe(true);
    }
  });
});
