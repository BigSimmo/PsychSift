// tests/caring-contacts-domain-isolation.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const DOMAIN_ROOT = path.join(process.cwd(), "src", "lib", "caring-contacts");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

/**
 * Every module specifier in a file, however it is written.
 *
 * The earlier form required WHITESPACE after the keyword, so `await import("@supabase/supabase-js")`
 * and `require("openai")` -- the two shapes a provider is most likely to arrive through once
 * someone wants it loaded lazily -- were invisible to both assertions below. `\s*\(?\s*` covers the
 * call forms without loosening the quoted-specifier capture that follows.
 */
function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/\b(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]);
}

describe("caring-contacts domain isolation", () => {
  it("imports nothing from outside its own directory", () => {
    // An ALLOWLIST, not a denylist, and the difference is the whole property. The claim being made
    // is that this domain is self-contained and provider-free -- and a denylist can only ever say
    // that the six things somebody thought of are absent. It named `@supabase` and `openai`, so
    // `twilio`, `redis` and `stripe` all passed, and a messaging provider is exactly what a
    // caring-contact domain would reach for first.
    //
    // Inverting it is free here rather than aspirational: there is currently not one non-relative
    // specifier anywhere under this tree, not even a `node:` builtin. `tests/caring-contacts-
    // message-policy.test.ts` already holds one file to this shape; this holds the whole tree to it.
    const offences: string[] = [];
    for (const file of walk(DOMAIN_ROOT)) {
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        if (specifier.startsWith("node:")) continue;
        if (specifier.startsWith(".")) continue;
        offences.push(`${path.relative(process.cwd(), file)} -> ${specifier}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it("sees a provider arriving through require or a dynamic import, not only a static one", () => {
    // The extractor, tested directly. Every specifier form below was invisible to the previous
    // whitespace-requiring pattern, so a sealed module could have loaded a provider lazily and
    // both assertions in this file would have reported green.
    const source = [
      'import Twilio from "twilio";',
      'const { createClient } = require("redis");',
      'await import("@supabase/supabase-js");',
      'export { send } from "./dispatch";',
      'import "node:crypto";',
    ].join("\n");

    expect(importSpecifiers(source)).toEqual(["twilio", "redis", "@supabase/supabase-js", "./dispatch", "node:crypto"]);
  });

  it("never escapes its directory with a relative import", () => {
    const offences: string[] = [];
    for (const file of walk(DOMAIN_ROOT)) {
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        if (!specifier.startsWith(".")) continue;
        const resolved = path.resolve(path.dirname(file), specifier);
        // A bare `startsWith(DOMAIN_ROOT)` is a string-prefix test, not a path-containment test:
        // `.../src/lib/caring-contacts-server/config` satisfies it too, because that sibling
        // directory's name extends this one's as a prefix. Require the separator (or an exact
        // match on the root itself) so a relative import escaping into caring-contacts-server --
        // the reverse-direction dependency the plan forbids absolutely -- cannot pass silently.
        if (resolved !== DOMAIN_ROOT && !resolved.startsWith(DOMAIN_ROOT + path.sep)) {
          offences.push(`${path.relative(process.cwd(), file)} -> ${specifier}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it("keeps caring-contact migrations out of the Clinical KB migration directory", () => {
    const clinicalKbMigrations = path.join(process.cwd(), "supabase", "migrations");
    const strays = readdirSync(clinicalKbMigrations).filter((name) => /caring[-_]?contact/i.test(name));
    expect(strays).toEqual([]);
  });
});
