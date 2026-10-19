import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import AboutPage from "@/app/about/page";
import TermsPage from "@/app/terms/page";
import {
  ABOUT_SECTIONS,
  FIRST_RUN_GUIDE_STEPS,
  FRONT_DOOR_DRAFT_DISCLAIMER,
  FRONT_DOOR_DRAFT_MARKER,
  TERMS_SECTIONS,
  TERMS_VERSION,
} from "@/lib/front-door-content";
import {
  buildTermsAcceptance,
  hasAcceptedTerms,
  readTermsAcceptance,
  TERMS_METADATA_KEY,
} from "@/lib/terms-acceptance";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const contentSource = readFileSync(new URL("../src/lib/front-door-content.ts", import.meta.url), "utf8");

describe("front-door draft copy", () => {
  it("carries an obvious DRAFT marker and the shared disclaimer", () => {
    expect(FRONT_DOOR_DRAFT_MARKER).toBe("DRAFT");
    expect(FRONT_DOOR_DRAFT_DISCLAIMER).toContain("draft wording awaiting the owner's sign-off");
    expect(contentSource).toContain("DRAFT. EVERY STRING IN THIS FILE IS DRAFT WORDING");
  });

  it("uses no em dashes anywhere in the copy", () => {
    expect(contentSource).not.toContain("—");
  });

  it("covers every required About topic", () => {
    const text = ABOUT_SECTIONS.map((section) => `${section.heading} ${section.body.join(" ")}`).join(" ");
    expect(text).toContain("What PsychSift is");
    expect(text).toContain("health professionals only");
    expect(text).toContain("not been validated as clinical decision support");
    expect(text).toContain("open the linked source");
    expect(text).toContain("Do not enter anything that could identify a patient");
    expect(text).toContain("Report a problem");
  });

  it("gives the first-run guide exactly the three agreed steps", () => {
    expect(FIRST_RUN_GUIDE_STEPS.map((step) => step.id)).toEqual([
      "what-this-is",
      "check-a-citation",
      "report-a-wrong-answer",
    ]);
  });
});

describe("About and Terms pages", () => {
  it("renders the About page with its draft marker and every section", () => {
    const markup = renderToStaticMarkup(createElement(AboutPage));
    expect(markup).toContain("<main");
    expect(markup).toContain("<h1");
    expect(markup).toContain('data-testid="front-door-draft-marker"');
    expect(markup).toContain(FRONT_DOOR_DRAFT_DISCLAIMER.replace("'", "&#x27;"));
    for (const section of ABOUT_SECTIONS) expect(markup).toContain(`id="${section.id}"`);
    expect(markup).toContain('href="/terms"');
    expect(markup).toContain('href="/privacy"');
  });

  it("renders the Terms page with the current version", () => {
    const markup = renderToStaticMarkup(createElement(TermsPage));
    expect(markup).toContain("Terms of Use");
    expect(markup).toContain(`Version ${TERMS_VERSION}`);
    for (const section of TERMS_SECTIONS) expect(markup).toContain(`id="${section.id}"`);
    expect(markup).toContain('href="/about"');
  });
});

describe("terms acceptance record", () => {
  it("reads a well-formed record and ignores anything else", () => {
    const record = buildTermsAcceptance(new Date("2026-10-18T00:00:00Z"));
    expect(readTermsAcceptance({ [TERMS_METADATA_KEY]: record })).toEqual({
      version: TERMS_VERSION,
      acceptedAt: "2026-10-18T00:00:00.000Z",
    });
    expect(readTermsAcceptance(null)).toBeNull();
    expect(readTermsAcceptance({ [TERMS_METADATA_KEY]: { version: 3 } })).toBeNull();
  });

  it("accepts only the exact current version, so a new version re-prompts", () => {
    const old = { [TERMS_METADATA_KEY]: { version: "2020-01-01", acceptedAt: "2020-01-01T00:00:00Z" } };
    expect(hasAcceptedTerms({ metadata: old, localVersion: null })).toBe(false);
    expect(hasAcceptedTerms({ metadata: old, localVersion: "2020-01-01" })).toBe(false);
    expect(hasAcceptedTerms({ metadata: old, localVersion: TERMS_VERSION })).toBe(true);
    const current = { [TERMS_METADATA_KEY]: buildTermsAcceptance() };
    expect(hasAcceptedTerms({ metadata: current, localVersion: null })).toBe(true);
    expect(hasAcceptedTerms({ metadata: current, localVersion: null, currentVersion: "2099-01-01" })).toBe(false);
  });
});
