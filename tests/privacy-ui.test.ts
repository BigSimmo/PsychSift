import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import PrivacyPage, { metadata } from "@/app/privacy/page";
import { PrivacyInputNotice } from "@/components/privacy-input-notice";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    back: vi.fn(),
    replace: vi.fn(),
  }),
}));

describe("privacy UI", () => {
  it("renders a persistent, keyboard-reachable privacy warning and product link", () => {
    const markup = renderToStaticMarkup(createElement(PrivacyInputNotice));
    const documentsMarkup = renderToStaticMarkup(createElement(PrivacyInputNotice, { returnMode: "documents" }));

    expect(markup).toContain("Do not enter patient-identifiable information.");
    expect(markup).toContain('href="/privacy"');
    expect(markup).toContain("Privacy and data processing");
    // Phone reclaim that --spacing-mode-home-composer-phone assumes (bottom-only).
    expect(markup).toContain("-mb-4");
    expect(documentsMarkup).toContain('href="/privacy?from=documents"');
  });

  it("publishes an accessible overview of configured data processing", () => {
    const markup = renderToStaticMarkup(createElement(PrivacyPage));

    expect(markup).toContain("<main");
    expect(markup).toContain("<h1");
    expect(markup).toContain("How PsychSift handles your data");
    expect(markup).toContain("Before you use PsychSift");
    expect(markup).not.toContain("Quiet");
    expect(markup).not.toContain("Draft");
    expect(markup).toContain("This is draft product information");
    for (const heading of [
      "What this tool is",
      "What is collected",
      "How questions are handled",
      "Where data is stored and processed",
      "External provider processing",
      "Retention",
      "Your responsibilities",
      "Who can access your data",
      "What stays in this browser",
      "Third parties involved",
    ]) {
      expect(markup).toContain(heading);
    }
    // JSX drops a newline adjacent to a tag, so the space after the bolded
    // phrase must be explicit or this renders as "systemand".
    expect(markup).toContain("not a patient-record system</strong> and its provider-backed features");
    expect(markup).toContain("deliberately omits a patient-identifier field");
    expect(markup).toContain("Safety-plan working content has no PsychSift retention");
    expect(markup).toContain("Clipboard, print, and PDF copies are outside the app");
    expect(markup).toContain("Generated answer text is also omitted from durable query logs by default");
    expect(markup).toContain("completed answer threads may also remain in this browser tab for up to 12 hours");
    expect(markup).toContain("is never sent to the application service");
    expect(markup).toContain("cleared by New chat, sign-out, or an account change");
    expect(markup).toContain("application service in Singapore");
    expect(markup).toContain("Railway in Singapore");
    expect(markup).toContain("retrieval embedding");
    expect(markup).toContain("even when the final response is source-only");
    expect(markup).toContain("bounded hourly purge of expired response-cache rows");
    expect(markup).not.toContain("approved privacy policy");

    // Added sections. Each of these is a claim about configured behaviour that a
    // reader can check against the repository, so the wording is pinned too.
    expect(markup).toContain("the server scopes every read to that owner");
    expect(markup).toContain("row-level security stands behind it");
    expect(markup).toContain("Uploading documents is an administrator action");
    expect(markup).toContain("publish the corpus as a whole rather than document by document");
    expect(markup).toContain("intended to hold guideline and reference material, not patient data");
    expect(markup).toContain("those links expire after ten minutes by default");
    expect(markup).toContain("append-only audit record");
    expect(markup).toContain("Recent searches use per-tab session storage");
    expect(markup).toContain("Safety-plan working content is stricter again");
    expect(markup).toContain("OpenAI, in the United States");
    expect(markup).toContain("browser session replay is not enabled");
    expect(markup).toContain("rather than validated clinical decision support");
    expect(markup).toContain("degrades to a deterministic source-only answer");
    expect(markup).toContain("Clinical Ask accepts a typed or dictated question and non-identifying Case Context");
    expect(markup).toContain("cannot guarantee that text is de-identified");
    expect(markup).toContain("ephemeral page memory for the current tab");
    expect(markup).toContain("not placed in the URL or browser history");
    expect(markup).toContain("not attached to feedback or content-free telemetry");
    expect(markup).toContain("Clinical Ask audio is held only long enough");
    expect(markup).toContain("disposed after transcription, cancellation, clear case, account change, or unmount");
    expect(markup).toContain("external authority search only for an evidence gap");
    expect(markup).toContain("retains attributable citations and retrieval dates");
    expect(markup).toContain("not a zero-retention promise");
    expect(markup).toContain("production readiness must each be verified");
    expect(markup).toContain("verified the four expected schedules on production and staging");
    expect(markup).not.toContain("staging evidence, clinical evaluation");

    // The provider section states only what the application itself does. A
    // zero-retention or no-training claim is an operator/contractual matter the
    // app cannot observe, and docs/openai-cross-border-basis.md still records it
    // as unresolved — so it must not appear here.
    expect(markup).toContain("a keyed pseudonym is used instead when the operator configures one");
    expect(markup).toContain("not that maximum or a deletion deadline");
    expect(markup).toContain("API data sharing and API call logging disabled");
    expect(markup).toContain("hosted MCP, web search, file search, image generation, code interpreter");
    expect(markup).toContain("has submitted a Zero Data Retention request");
    expect(markup).toContain("OpenAI has not yet approved it");
    expect(markup).toContain("abuse-monitoring logs for up to 30 days");
    expect(markup).toContain("prompt-cache data may remain on its local GPU machines for up to 24 hours");
    expect(markup).toContain("has not yet proved that the production key targets the inspected project");
    expect(markup).toContain("do not establish Zero Data Retention");
    expect(markup).toContain("hosted-search path is disabled in the inspected provider project");
    expect(markup).not.toContain("zero-retention arrangement is in place");
    expect(markup).not.toContain("not used for training");

    // Status line: describes how PsychSift is set up, never asserts a review. Plain words and a
    // plain Australian date (design audit 13 Oct 2026, D22).
    expect(markup).toContain("Describes how PsychSift is set up as of");
    expect(markup).toContain('<time dateTime="2026-09-01" data-testid="privacy-as-of">1 September 2026</time>');
    expect(markup).toContain("based on how PsychSift is set up.");
    expect(markup).not.toContain("repository&#x27;s configured behaviour");
    expect(markup).not.toContain("01/09/2026");
    expect(markup).not.toContain("Reviewed on");
    expect(metadata.description).toContain("current provider controls");
    expect(metadata.description).toContain("pending privacy approvals");
  });

  it("exposes every section as a stable anchor so /privacy#retention can be linked", () => {
    const markup = renderToStaticMarkup(createElement(PrivacyPage));

    for (const id of [
      "what-this-tool-is",
      "what-is-collected",
      "how-questions-are-handled",
      "where-data-is-stored",
      "external-providers",
      "who-can-access",
      "in-this-browser",
      "retention",
      "third-parties",
      "your-responsibilities",
    ]) {
      expect(markup).toContain(`id="${id}"`);
    }
  });

  it("summarises the load-bearing facts above the detail", () => {
    const markup = renderToStaticMarkup(createElement(PrivacyPage));

    expect(markup).toContain("At a glance");
    for (const fact of [
      "Documents and logs at rest",
      "Sydney, Australia",
      "AI provider",
      "OpenAI, United States",
      "Keyed hash · 30 days",
      "Up to 12 hours",
      "Never leaves this tab",
    ]) {
      expect(markup).toContain(fact);
    }
    expect(markup).toContain("Question text and selected excerpts can leave Australia.");
  });

  it("collapses detail with the hidden utility so nothing is dropped from print", () => {
    const markup = renderToStaticMarkup(createElement(PrivacyPage));

    // The HTML `hidden` attribute beats `print:block`, so a collapsed section
    // would print as though the page never mentioned it — invisibly, on paper.
    // See the same contract on the design system's Disclosure.
    expect(markup).not.toContain('hidden=""');
    expect(markup).toContain("print:block");
    expect(markup).toContain('data-testid="privacy-print"');
  });

  it("keeps the headings, summary and full width of the printed copy", () => {
    const markup = renderToStaticMarkup(createElement(PrivacyPage));
    const globals = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

    // globals.css drops `header`, `nav` and `button` from print. This page's
    // section headings ARE disclosure triggers and its summary tiles ARE
    // buttons, so without the scoped restore the printed copy loses its title,
    // its fact summary and all ten headings — silently, on paper.
    expect(markup).toContain("privacy-page");
    expect(markup).toContain("data-print-keep");
    expect(markup).toContain("data-print-stack");
    expect(globals).toContain(".privacy-page header");
    expect(globals).toContain(".privacy-page [data-print-keep]");
    expect(globals).toContain(".privacy-page [data-print-stack]");
  });

  it("exposes sticky-chrome state so oversized banners can drop sticky positioning", () => {
    const markup = renderToStaticMarkup(createElement(PrivacyPage));
    expect(markup).toContain('data-testid="privacy-sticky-chrome"');
    expect(markup).toContain('data-sticky="true"');
  });
});
