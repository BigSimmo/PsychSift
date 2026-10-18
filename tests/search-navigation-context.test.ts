import { describe, expect, it } from "vitest";

import {
  appendSearchNavigationContext,
  preserveServicesShortlist,
  privateScopeReadyForRoute,
  readSearchNavigationContext,
  routedSubmissionContextChanged,
  searchNavigationContextSignature,
  searchSubmissionSignature,
} from "@/lib/search-navigation-context";

describe("search navigation context", () => {
  it("retains a Services shortlist across a new query without reopening the previous workflow", () => {
    const current = new URLSearchParams("q=first&shortlist=service-a,service-b&workflow=compare");
    const destination = preserveServicesShortlist("/services/search?q=second&run=1&scope.locality=local", current);
    const next = new URL(destination, "https://example.org");
    expect(next.pathname).toBe("/services/search");
    expect(next.searchParams.get("q")).toBe("second");
    expect(next.searchParams.get("shortlist")).toBe("service-a,service-b");
    expect(next.searchParams.get("scope.locality")).toBe("local");
    expect(next.searchParams.has("workflow")).toBe(false);
    expect(current.get("workflow")).toBe("compare");
  });

  it("keeps an explicitly cleared shortlist empty and never carries it to another mode", () => {
    expect(preserveServicesShortlist("/services/search?q=second", new URLSearchParams())).toBe(
      "/services/search?q=second",
    );
    expect(preserveServicesShortlist("/forms/search?q=second", new URLSearchParams("shortlist=service-a"))).toBe(
      "/forms/search?q=second",
    );
  });

  it("round-trips query intent and active scope filters", () => {
    const params = new URLSearchParams();
    appendSearchNavigationContext(params, {
      queryMode: "monitoring_schedule",
      scopeFilters: {
        medications: ["lithium", "clozapine"],
        sourceStatuses: ["current", "review_due"],
        locality: "local",
        importBatchIds: ["f9b71e2a-9548-45df-ae21-e33b20c6f508"],
      },
    });

    expect(readSearchNavigationContext(params)).toEqual({
      queryMode: "monitoring_schedule",
      scopeFilters: {
        medications: ["lithium", "clozapine"],
        sourceStatuses: ["current", "review_due"],
        importBatchIds: ["f9b71e2a-9548-45df-ae21-e33b20c6f508"],
        locality: "local",
      },
    });
  });

  it("drops invalid or duplicate URL values and defaults to automatic intent", () => {
    const params = new URLSearchParams([
      ["queryMode", "not-a-mode"],
      ["scope.medications", " lithium "],
      ["scope.medications", "lithium"],
      ["scope.sourceStatuses", "current"],
      ["scope.sourceStatuses", "invalid"],
      ["scope.locality", "somewhere"],
      ["scope.importBatchIds", "not-a-uuid"],
    ]);

    expect(readSearchNavigationContext(params)).toEqual({
      queryMode: "auto",
      scopeFilters: {
        medications: ["lithium"],
        sourceStatuses: ["current"],
      },
    });
  });

  it("validates constrained values before applying their URL limits", () => {
    const params = new URLSearchParams([
      ["scope.sourceStatuses", "invalid-1"],
      ["scope.sourceStatuses", "invalid-2"],
      ["scope.sourceStatuses", "invalid-3"],
      ["scope.sourceStatuses", "invalid-4"],
      ["scope.sourceStatuses", "current"],
    ]);

    expect(readSearchNavigationContext(params).scopeFilters.sourceStatuses).toEqual(["current"]);
  });

  it("keeps default context out of otherwise clean URLs", () => {
    const params = new URLSearchParams("mode=answer");
    appendSearchNavigationContext(params, { queryMode: "auto", scopeFilters: {} });
    expect(params.toString()).toBe("mode=answer");
  });

  it("changes the submission signature when routed intent or scope changes", () => {
    const current = searchNavigationContextSignature({
      queryMode: "monitoring_schedule",
      scopeFilters: { sourceStatuses: ["current"], locality: "local" },
    });
    const outdated = searchNavigationContextSignature({
      queryMode: "monitoring_schedule",
      scopeFilters: { sourceStatuses: ["outdated"], locality: "local" },
    });

    expect(current).not.toBe(outdated);
    expect(current).toContain("queryMode=monitoring_schedule");
    expect(current).toContain("scope.sourceStatuses=current");
    expect(searchSubmissionSignature("answer", "lithium", { scopeFilters: { sourceStatuses: ["current"] } })).not.toBe(
      searchSubmissionSignature("answer", "lithium", { scopeFilters: { sourceStatuses: ["outdated"] } }),
    );
    expect(
      routedSubmissionContextChanged(
        searchSubmissionSignature("answer", "lithium", { scopeFilters: { sourceStatuses: ["current"] } }),
        "answer",
        "lithium",
        { scopeFilters: { sourceStatuses: ["outdated"] } },
      ),
    ).toBe(true);
    expect(
      routedSubmissionContextChanged(
        searchSubmissionSignature("answer", "lithium", { scopeFilters: { sourceStatuses: ["current"] } }),
        "answer",
        "clozapine",
        { scopeFilters: { sourceStatuses: ["outdated"] } },
      ),
    ).toBe(false);
    expect(
      routedSubmissionContextChanged("answer:lithium", "answer", "lithium", {
        scopeFilters: { sourceStatuses: ["outdated"] },
      }),
    ).toBe(true);
    expect(routedSubmissionContextChanged("answer:lithium", "answer", "lithium", {})).toBe(false);
  });

  it("round-trips only a validated opaque private scope reference", () => {
    const scopeRef = "22222222-2222-4222-8222-222222222222";
    const params = appendSearchNavigationContext(new URLSearchParams(), { scopeRef });
    expect(params.get("scopeRef")).toBe(scopeRef);
    expect(readSearchNavigationContext(params).scopeRef).toBe(scopeRef);
    expect(
      readSearchNavigationContext(new URLSearchParams("scopeRef=private-document-title")).scopeRef,
    ).toBeUndefined();
  });

  it("waits for the exact routed private scope on initial load and history changes", () => {
    const firstScope = "22222222-2222-4222-8222-222222222222";
    const secondScope = "33333333-3333-4333-8333-333333333333";

    expect(privateScopeReadyForRoute(firstScope, "restoring", null)).toBe(false);
    expect(privateScopeReadyForRoute(firstScope, "restored", firstScope)).toBe(true);
    expect(privateScopeReadyForRoute(secondScope, "restored", firstScope)).toBe(false);
    expect(privateScopeReadyForRoute(secondScope, "restored", secondScope)).toBe(true);
    expect(privateScopeReadyForRoute(undefined, "none", null)).toBe(true);
  });
});
