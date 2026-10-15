/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PrivacyQuietSignalPage } from "@/components/privacy-quiet-signal-page";
import { PRIVACY_SECTIONS } from "@/lib/privacy-page-content";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));

/**
 * Scoped to the accordion: the section index renders a button per section too,
 * and only the accordion trigger owns a panel.
 */
function panelFor(heading: string) {
  const trigger = screen
    .getAllByRole("button", { name: new RegExp(heading, "i") })
    .find((candidate) => candidate.getAttribute("aria-controls")?.includes("-panel-"));
  expect(trigger, `no accordion trigger for ${heading}`).toBeTruthy();
  const panelId = (trigger as HTMLElement).getAttribute("aria-controls");
  const panel = document.getElementById(panelId as string);
  expect(panel).not.toBeNull();
  return { trigger: trigger as HTMLElement, panel: panel as HTMLElement };
}

describe("privacy page interaction", () => {
  beforeEach(() => {
    window.location.hash = "";
    // jsdom has no layout, so scrollIntoView is not implemented on the prototype.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("keeps other sections open when one is toggled after Expand all", () => {
    render(<PrivacyQuietSignalPage />);

    fireEvent.click(screen.getByTestId("privacy-expand-all"));
    for (const section of PRIVACY_SECTIONS) {
      expect(panelFor(section.heading).panel.dataset.open).toBe("true");
    }

    // The old single-`openId` model collapsed every other section here.
    fireEvent.click(panelFor("Retention").trigger);
    expect(panelFor("Retention").panel.dataset.open).toBe("false");
    expect(panelFor("Your responsibilities").panel.dataset.open).toBe("true");
    expect(panelFor("Where data is stored and processed").panel.dataset.open).toBe("true");
  });

  it("exposes the full safety obligation through an accessible disclosure", () => {
    render(<PrivacyQuietSignalPage />);

    const openButton = screen.getByRole("button", { name: "Read more" });
    expect(openButton).toHaveAttribute("aria-expanded", "false");
    const panelId = openButton.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();

    fireEvent.click(openButton);

    const closeButton = screen.getByRole("button", { name: "Show less" });
    expect(closeButton).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(panelId as string);
    expect(panel).toHaveRole("region");
    expect(panel).not.toHaveClass("hidden");
    expect(panel).toHaveTextContent("Do not enter identifiable patient details such as names");
  });

  it("opens the section named by the URL hash on arrival", () => {
    window.location.hash = "#third-parties";
    render(<PrivacyQuietSignalPage />);

    expect(panelFor("Third parties involved").panel.dataset.open).toBe("true");
  });

  it("opens the explaining section when an at-a-glance fact is selected", () => {
    render(<PrivacyQuietSignalPage />);

    expect(panelFor("External provider processing").panel.dataset.open).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: /OpenAI, United States/i }));

    expect(panelFor("External provider processing").panel.dataset.open).toBe("true");
    expect(window.location.hash).toBe("#external-providers");
  });

  it("collapses panels with the hidden utility, never the attribute that beats print", () => {
    render(<PrivacyQuietSignalPage />);

    const { panel } = panelFor("Retention");
    expect(panel.dataset.open).toBe("false");
    expect(panel.hasAttribute("hidden")).toBe(false);
    expect(panel.className).toContain("hidden");
    expect(panel.className).toContain("print:block");
  });

  it("honours reduced motion when scrolling to a section", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    document.documentElement.setAttribute("data-motion", "reduced");

    render(<PrivacyQuietSignalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Never leaves this tab/i }));

    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
    document.documentElement.removeAttribute("data-motion");
  });

  it("describes each collapsed section instead of hiding the summary from assistive tech", () => {
    render(<PrivacyQuietSignalPage />);

    const { trigger } = panelFor("Retention");
    const describedBy = trigger.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const gist = document.getElementById(describedBy as string);
    expect(gist?.textContent).toContain("30-day queries");
    expect(gist?.getAttribute("aria-hidden")).toBeNull();
  });

  /**
   * M7: migrations promote indexed documents to the null-owner public corpus and
   * `/api/search` serves it to unauthenticated callers, so the notice must not
   * claim owner isolation is the only access tier.
   */
  it("describes the shared public corpus alongside owner-scoped uploads", () => {
    render(<PrivacyQuietSignalPage />);

    const { panel } = panelFor("Who can access your data");
    expect(panel.textContent).not.toContain("There is no shared corpus across accounts");
    expect(panel.textContent).toContain("shared public corpus");
    expect(panel.textContent).toContain("without signing in");
    expect(panel.textContent).toContain("row-level security");
  });

  /**
   * The controlled pilot checks bounded malware/identifier signals; it cannot
   * guarantee that reference material is suitable or contains no patient data.
   * Keep the stated intent, limited checks and operator responsibility visible.
   */
  it("states the guideline-only corpus as intent rather than an enforced fact", () => {
    render(<PrivacyQuietSignalPage />);

    const { panel } = panelFor("Who can access your data");
    expect(panel.textContent).toContain("intended to hold guideline and reference material, not patient data");
    expect(panel.textContent).not.toContain("the corpus is guideline and reference material rather than patient data");
    expect(panel.textContent).toContain(
      "bounded malware and identifier-shaped-content checks and source-specific validation",
    );
    expect(panel.textContent).toContain(
      "do not guarantee de-identification, completeness, suitability or detection of all hidden content",
    );
    expect(panel.textContent).toContain(
      "Operators remain responsible for checking the material and their authority to process and publish it",
    );
    expect(panel.textContent).not.toContain("Nothing in the application inspects what a document actually contains");
  });

  /**
   * `set_document_corpus_access_mode('public')`
   * (`supabase/migrations/20260825025032_reversible_document_corpus_access_mode.sql`)
   * disables `documents_require_publication_approval` and publishes every captured
   * document at once, so per-document approval is not the only publication path.
   */
  it("names the corpus-wide publication switch, not only the per-document path", () => {
    render(<PrivacyQuietSignalPage />);

    const { panel } = panelFor("Who can access your data");
    expect(panel.textContent).toContain("publish the corpus as a whole rather than document by document");
    expect(panel.textContent).toContain("suspends the per-document approval requirement");
  });

  /**
   * The app tier reads through the service-role admin client and enforces
   * ownership in application code (`withOwnerReadScope`); RLS is the layer
   * behind it, not the mechanism the page reads through. See
   * `docs/audit/tenancy-defense-in-depth-review.md` §2.
   */
  it("puts the application owner scope ahead of row-level security", () => {
    render(<PrivacyQuietSignalPage />);

    const { panel } = panelFor("Who can access your data");
    expect(panel.textContent).toContain("the server scopes every read to that owner");
    expect(panel.textContent).toContain("row-level security stands behind it");
    expect(panel.textContent).not.toContain("row-level security restricts reads to that owner");
  });

  /**
   * `POST /api/upload` requires `{ administrator: true }`, so an ordinary
   * signed-in reader must not be told the page is describing "your uploads".
   */
  it("describes uploading as an administrator action", () => {
    render(<PrivacyQuietSignalPage />);

    const { panel } = panelFor("Who can access your data");
    expect(panel.textContent).toContain("Uploading documents is an administrator action");
    expect(panel.textContent).toContain("stays with the administrator account that uploaded it");

    const responsibilities = panelFor("Your responsibilities").panel;
    expect(responsibilities.textContent).toContain("If your account has administrator upload access");
  });
});
