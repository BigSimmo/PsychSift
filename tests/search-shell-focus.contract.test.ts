import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readPrimitiveRecipeSources } from "../scripts/design-system-contract-utils.mjs";
import { sourceSegment } from "./helpers/source-contract";

const globals = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const primitives = readPrimitiveRecipeSources();
const comparePicker = readFileSync(
  new URL("../src/components/compare/compare-catalog-picker.tsx", import.meta.url),
  "utf8",
);
const documentViewer = readFileSync(new URL("../src/components/DocumentViewer.tsx", import.meta.url), "utf8");
const documentSearchComposer = readFileSync(
  new URL("../src/components/document-viewer/document-viewer-search-composer.tsx", import.meta.url),
  "utf8",
);

describe("search / field focus is quiet and shell-owned", () => {
  it("does not paint a 2px inset --focus rectangle on text fields", () => {
    const body = sourceSegment(
      globals,
      "  /* Hairline on the field edge, not an inset accent rectangle. The previous",
      "}",
      { label: "shared text-field focus rule" },
    );
    expect(body).not.toMatch(/^\s*outline:\s*2px solid var\(--focus\)/m);
    expect(body).not.toMatch(/^\s*outline-offset:\s*-2px/m);
    expect(body).toMatch(/^\s*outline-offset:\s*0;/m);
    expect(body).toContain("color-mix(in srgb, var(--clinical-accent)");
  });

  it("keeps button / link focus as the sanctioned 2px outline", () => {
    const body = sourceSegment(globals, ':where(button, a, summary, input[type="checkbox"]', "}", {
      label: "shared control focus rule",
    });
    expect(body).toContain("outline: 2px solid var(--focus)");
    expect(body, "the shared button focus rule must not paint a box-shadow").not.toContain("box-shadow");
  });

  it("lets the rounded search shell own focus and suppresses the nested input", () => {
    const shell = sourceSegment(
      globals,
      "/* Nested search: the rounded shell owns focus.",
      ".search-shell-input:focus,",
      { label: "search-shell focus" },
    );
    expect(shell).toContain(".search-shell:focus-within");
    expect(shell).toContain("color-mix(in srgb, var(--clinical-accent)");
    expect(shell).not.toContain("outline: 2px solid var(--focus)");
    expect(shell, "search-shell focus must not replace resting elevation").not.toContain("box-shadow");

    const input = sourceSegment(globals, ".search-shell-input:focus,\n.search-shell-input:focus-visible {", "}", {
      label: "search-shell-input focus",
      allowRepeatedStart: true,
    });
    expect(input).toContain("outline: none");
    expect(input).toContain("box-shadow: none");
  });

  it("exports field-control and the search-shell pair from the primitive recipes", () => {
    const field = primitives.match(/export const fieldControl\s*=\s*"([^"]+)"/);
    expect(field, "fieldControl recipe missing").toBeTruthy();
    expect(field![1]).toMatch(/\bfield-control\b/);
    expect(field![1]).not.toContain("focus:border-[color:var(--focus)]");

    expect(primitives).toMatch(/export const searchShell\s*=\s*"search-shell /);
    expect(primitives).toMatch(/export const searchShellInput\s*=\s*"search-shell-input /);
    expect(primitives).toMatch(/export const chatComposerInput\s*=\s*"chat-composer-input"/);
  });

  it("uses the search-shell pair on the compare catalog picker", () => {
    expect(comparePicker).toContain("searchShell");
    expect(comparePicker).toContain("searchShellInput");
    expect(comparePicker).not.toMatch(/className="min-w-0 flex-1 bg-transparent text-base outline-none/);
  });

  it("gives document search a search-shell owner so the nested input is not ringless", () => {
    expect(documentViewer).toContain("<DocumentViewerSearchComposer");
    expect(documentSearchComposer).toContain("search-shell");
    expect(documentSearchComposer).toContain("searchShellInput");
  });

  it("does not put a second 2px --focus outline on the composer pill", () => {
    const body = sourceSegment(
      globals,
      "/* One focus owner. The retired `--shadow-focus` token painted a 3px accent",
      ".chat-composer-input {",
      { label: "composer shell focus" },
    );
    expect(body).toContain("outline: none");
    expect(body).not.toContain("outline: 2px solid var(--focus)");
  });

  it("restores a Highlight ring for quiet fields in forced-colors", () => {
    const forcedColorsOpeners = [...globals.matchAll(/@media \(forced-colors: active\)/g)];
    const lastOpener = forcedColorsOpeners.at(-1)?.index ?? -1;
    const forced = globals.slice(lastOpener);
    expect(forced).toContain(".chat-composer-shell-delta:focus-within");
    expect(forced).toContain("input.field-control:focus-visible");
    expect(forced).toMatch(/outline:\s*2px solid var\(--focus\)/);
    expect(forced).toContain(".search-shell-input:focus");
    const nested = sourceSegment(forced, ".search-shell-input:focus,", "}", {
      label: "forced-colors nested search-shell-input",
    });
    expect(nested).toContain("outline: none");
    expect(nested).not.toContain("input.field-control:focus-visible");
  });

  it("keeps production TSX free of focus:ring-4", () => {
    const srcRoot = fileURLToPath(new URL("../src", import.meta.url));
    const files: string[] = [];
    const visit = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "mockups" || name === "node_modules") continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) visit(full);
        else if (full.endsWith(".tsx") || full.endsWith(".ts")) files.push(full);
      }
    };
    visit(srcRoot);
    const hits = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return text.includes("focus:ring-4") ? [file.replace(/\\/g, "/")] : [];
    });
    expect(hits, "production TSX must not paint a Tailwind focus:ring-4 halo").toEqual([]);
  });
});
