import { afterEach, describe, expect, it, vi } from "vitest";
import { safeErrorLogDetails, safeIngestionJobLog, redactCaptionIdentifiers, redactLogValue } from "../src/lib/privacy";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("privacy-safe logging helpers", () => {
  it("P08C never persists resolved context even when ordinary raw query retention is enabled", async () => {
    vi.doMock("@/lib/env", () => ({ env: { RAG_PERSIST_RAW_QUERY_TEXT: true } }));
    const { queryTextForStorage, normalizedQueryTextForStorage, queryPrivacyMetadata } =
      await import("../src/lib/query-privacy");
    for (const query of [
      'Follow-up to "PRIVATE_CONTEXT_CANARY": explain this',
      'Follow-up context v1: {"subject":"PRIVATE_CONTEXT_CANARY"}',
      "Follow-up context v2: PRIVATE_CONTEXT_CANARY",
    ]) {
      expect(queryTextForStorage(query)).not.toContain("PRIVATE_CONTEXT_CANARY");
      expect(normalizedQueryTextForStorage(query)).not.toContain("private_context_canary");
      expect(queryPrivacyMetadata(query).raw_query_retained).toBe(false);
    }
    expect(queryTextForStorage("ordinary authorized query")).toBe("ordinary authorized query");
  });

  it("scrubs incidental Australian Medicare numbers, phone numbers, and MRNs from stored queries", async () => {
    vi.doMock("@/lib/env", () => ({ env: { RAG_PERSIST_RAW_QUERY_TEXT: true } }));
    const { queryTextForStorage, scrubPotentialPhi } = await import("../src/lib/query-privacy");

    const queryWithPhi = "Patient Medicare 2123 45678 1 mobile 0412 345 678 MRN: 1234567 lithium level";
    const scrubbed = queryTextForStorage(queryWithPhi);

    expect(scrubPotentialPhi(queryWithPhi)).toBe(scrubbed);
    expect(scrubbed).not.toContain("2123 45678 1");
    expect(scrubbed).not.toContain("0412 345 678");
    expect(scrubbed).not.toContain("1234567");
    expect(scrubbed).toContain("[REDACTED_MEDICARE]");
    expect(scrubbed).toContain("[REDACTED_PHONE]");
    expect(scrubbed).toContain("[REDACTED_MRN]");
    expect(scrubbed).toContain("lithium level");
  });

  it("scrubs labelled ISO birth dates, alphanumeric MRNs and parenthesized Australian phone numbers", async () => {
    vi.doMock("@/lib/env", () => ({ env: { RAG_PERSIST_RAW_QUERY_TEXT: true } }));
    const { queryTextForStorage, normalizedQueryTextForStorage } = await import("../src/lib/query-privacy");
    const query = "DOB: 1980-01-02 MRN: AB123456 phone (08) 1234 5678 review dose";
    for (const stored of [queryTextForStorage(query), normalizedQueryTextForStorage(query)]) {
      expect(stored).not.toMatch(/1980-01-02|AB123456|\(08\) 1234 5678/i);
      expect(stored).toMatch(/\[REDACTED_DOB\]/i);
      expect(stored).toMatch(/\[REDACTED_MRN\]/i);
      expect(stored).toMatch(/\[REDACTED_PHONE\]/i);
      expect(stored).toContain("review dose");
    }
  });

  it("does not classify ordinary words after an MRN label as an identifier", async () => {
    vi.doMock("@/lib/env", () => ({ env: { RAG_PERSIST_RAW_QUERY_TEXT: true } }));
    const { queryTextForStorage } = await import("../src/lib/query-privacy");
    expect(queryTextForStorage("MRN pending; monitor lithium")).toBe("MRN pending; monitor lithium");
  });

  it("logs ingestion jobs by job id without document filenames", () => {
    const message = safeIngestionJobLog("job-123");

    expect(message).toBe("Processing ingestion job job-123");
    expect(message).not.toMatch(/pdf|docx|patient|guideline/i);
  });

  it("logs sanitized error messages without filesystem paths", () => {
    const details = safeErrorLogDetails(new Error("secret storage path /users/patient/source.pdf"));

    expect(details).toMatchObject({ name: "Error", message: "secret storage path [path]" });
    expect(JSON.stringify(details)).not.toContain("source.pdf");
  });

  it("redacts clinical search URLs used in support diagnostics", () => {
    expect(redactLogValue("https://psychiatry.tools/dsm?q=clozapine%20ANC")).toBe("[url]");
  });

  it("redacts URLs with parentheses in query parameters without leaving suffix unredacted", () => {
    expect(redactLogValue("https://psychiatry.tools/dsm?q=clozapine%20(ANC)%20Jane")).toBe("[url]");
    expect(redactLogValue("error at https://example.com/path?param=(value)&data=test")).toBe("error at [url]");
  });

  // encodeURIComponent does not escape apostrophes, so a clinical query can carry
  // one verbatim. Excluding `'` from the URL class left the rest of the query in
  // the clipboard: [url]'s%20suicidal%20thoughts.
  it("redacts a clinical URL query containing an apostrophe", () => {
    expect(redactLogValue("https://psychiatry.tools/dsm?q=patient's%20suicidal%20thoughts")).toBe("[url]");
    expect(redactLogValue("https://psychiatry.tools/dsm?q=patient's%20suicidal%20thoughts")).not.toContain("suicidal");
  });

  // Non-string fields are JSON-stringified before redaction, and compact JSON has
  // no whitespace, so a \S+ URL pattern swallowed the closing quote and every
  // field after it — one URL redacted the whole diagnostic. Stopping at the double
  // quote keeps the remaining fields readable while still consuming parentheses.
  it("redacts a URL inside serialized JSON without consuming the fields after it", () => {
    const redacted = redactLogValue('{"url":"https://psychiatry.tools/dsm?q=clozapine%20(ANC)","code":"23505"}');
    expect(redacted).toBe('{"url":"[url]","code":"23505"}');
    expect(redacted).not.toContain("clozapine");
  });

  it("keeps neighbouring diagnostic fields when a URL is followed by a quoted value", () => {
    expect(redactLogValue('at https://example.com/a?b=(c) "hint":"check the index"')).toBe(
      'at [url] "hint":"check the index"',
    );
  });

  it("redacts modern supabase keys in error messages and details", () => {
    const e1 = new Error("found key sb_secret_abcdef1234567890 and sb_publishable_123abcDEF456");
    const d1 = safeErrorLogDetails(e1);

    expect(JSON.stringify(d1)).not.toContain("sb_secret_");
    expect(JSON.stringify(d1)).not.toContain("sb_publishable_");
    expect(JSON.stringify(d1)).toContain("[secret]");

    const e2 = { message: "connection error", details: `token=${"sb_secret_live_" + "ABCD1234efgh"}` };
    const d2 = safeErrorLogDetails(e2);

    expect(JSON.stringify(d2)).not.toContain("sb_secret_live_");
    expect(JSON.stringify(d2)).toContain("[secret]");
  });

  it("summarizes HTML error responses by title", () => {
    const error = {
      message: "<!DOCTYPE html><html><head><title>supabase.co | 522: Connection timed out</title></head></html>",
    };
    const details = safeErrorLogDetails(error);

    expect(details).toMatchObject({
      name: "object",
      message: "HTML response: supabase.co | 522: Connection timed out",
    });
    expect(JSON.stringify(details)).not.toContain("<!DOCTYPE html>");
  });

  it("does not repeat custom error messages as stack lines", () => {
    const error = new Error("<!DOCTYPE html>");
    error.name = "SupabaseRecoveryError";
    error.stack = "SupabaseRecoveryError: <!DOCTYPE html>\n<!--[if lt IE 7]> html marker\n    at safe.js:1:1";

    const details = safeErrorLogDetails(error);

    expect(details).toMatchObject({ name: "SupabaseRecoveryError", message: "<!DOCTYPE html>" });
    expect(details.stack).not.toContain("<!DOCTYPE html>");
    expect(details.stack).not.toContain("<!--[if");
  });

  it("redacts identifiers in captions while preserving clinical context", () => {
    const input = "Patient Jane Citizen MRN 123456 email jane@example.com phone 0400 123 456 has lithium level note.";
    const output = redactCaptionIdentifiers(input);

    expect(output).toContain("has lithium level note.");
    expect(output).not.toContain("jane@example.com");
    expect(output).not.toContain("123456");
    expect(output).not.toContain("0400 123 456");
  });

  it("preserves clinical numeric ranges while still redacting likely phone numbers", () => {
    const input = "Lithium therapeutic range 0.6 - 1.0 mmol/L. Ward contact: +61 400 123 456.";
    const output = redactCaptionIdentifiers(input);

    expect(output).toContain("0.6 - 1.0 mmol/L");
    expect(output).not.toContain("+61 400 123 456");
    expect(output).toContain("[phone]");
  });

  it("redacts spaced/grouped labeled MRN and NHS identifiers", () => {
    const cases = [
      "Patient MRN 12 3456 had an image.",
      "Patient MRN: 12-3456 had an image.",
      "Patient NHS 123 456 7890 had an image.",
    ];

    for (const input of cases) {
      const out = redactCaptionIdentifiers(input);
      expect(out).toContain("had an image.");
      expect(out).toContain("[id]");
      // Ensure raw labeled identifiers and grouped digits are removed
      expect(out).not.toMatch(/\bMRN\b|\bNHS\b/i);
      expect(out).not.toMatch(/\d{2,}/);
    }
  });
});

describe("query privacy storage helpers", () => {
  it("drops answer text by default", async () => {
    vi.doMock("@/lib/env", () => ({
      env: { RAG_PERSIST_RAW_QUERY_TEXT: false, RAG_PERSIST_ANSWER_TEXT: false },
    }));
    const { answerTextForStorage } = await import("../src/lib/query-privacy");

    expect(answerTextForStorage("Patient-specific generated answer")).toBeNull();
  });

  it("retains answer text only when explicitly enabled", async () => {
    vi.doMock("@/lib/env", () => ({
      env: { RAG_PERSIST_RAW_QUERY_TEXT: false, RAG_PERSIST_ANSWER_TEXT: true },
    }));
    const { answerTextForStorage } = await import("../src/lib/query-privacy");

    expect(answerTextForStorage("Generated answer")).toBe("Generated answer");
  });

  it("stores only hash-derived placeholders for PHI-capable query text by default", async () => {
    vi.doMock("@/lib/env", () => ({ env: { RAG_PERSIST_RAW_QUERY_TEXT: false } }));
    const {
      normalizedQueryTextForStorage,
      queryCacheKeyForStorage,
      queryDerivedTokensForStorage,
      queryPrivacyMetadata,
      queryTextForStorage,
    } = await import("../src/lib/query-privacy");
    const query = "Patient Jane Citizen MRN 123456 born 01/02/1970 needs clozapine monitoring";

    const storedQuery = queryTextForStorage(query);
    const storedNormalizedQuery = normalizedQueryTextForStorage(query);
    const storedCacheKey = queryCacheKeyForStorage(`query:${query}`);
    const metadata = queryPrivacyMetadata(query);

    expect(storedQuery).toMatch(/^redacted-query:[a-f0-9]{64}$/);
    expect(storedNormalizedQuery).toBe(storedQuery);
    expect(storedCacheKey).toMatch(/^redacted-cache:[a-f0-9]{64}$/);
    expect(queryDerivedTokensForStorage(["jane", "123456", "clozapine"])).toEqual([]);
    expect(metadata).toMatchObject({
      query_hash: storedQuery.replace("redacted-query:", ""),
      raw_query_retained: false,
    });
    for (const value of [storedQuery, storedNormalizedQuery, storedCacheKey, JSON.stringify(metadata)]) {
      expect(value).not.toContain("Jane");
      expect(value).not.toContain("123456");
      expect(value).not.toContain("01/02/1970");
      expect(value).not.toContain("clozapine");
    }
  });

  it("retains raw and normalized text only when raw retention is explicitly enabled", async () => {
    vi.doMock("@/lib/env", () => ({ env: { RAG_PERSIST_RAW_QUERY_TEXT: true } }));
    const {
      normalizedQueryTextForStorage,
      queryCacheKeyForStorage,
      queryDerivedTokensForStorage,
      queryTextForStorage,
    } = await import("../src/lib/query-privacy");

    expect(queryTextForStorage("  Clozapine Monitoring  ")).toBe("  Clozapine Monitoring  ");
    expect(normalizedQueryTextForStorage("  Clozapine Monitoring  ")).toBe("clozapine monitoring");
    expect(queryCacheKeyForStorage("query:clozapine monitoring")).toBe("query:clozapine monitoring");
    expect(queryDerivedTokensForStorage(["clozapine"])).toEqual(["clozapine"]);
  });
});

describe("answer persistence storage helper (PIA-3)", () => {
  it("drops the generated answer text at rest by default", async () => {
    vi.doMock("@/lib/env", () => ({ env: { RAG_PERSIST_ANSWER_TEXT: false } }));
    const { answerTextForStorage, answerPrivacyMetadata } = await import("../src/lib/query-privacy");

    // A generated answer can restate patient specifics echoed from the query.
    const phiAnswer = "Jane Citizen (MRN 123456) should have clozapine withheld below an ANC of 1.5.";
    expect(answerTextForStorage(phiAnswer)).toBeNull();
    expect(answerTextForStorage("")).toBeNull();
    expect(answerTextForStorage(null)).toBeNull();
    expect(answerTextForStorage(undefined)).toBeNull();
    expect(answerPrivacyMetadata()).toEqual({ answer_retained: false });
  });

  it("retains the answer text only when answer retention is explicitly enabled", async () => {
    vi.doMock("@/lib/env", () => ({ env: { RAG_PERSIST_ANSWER_TEXT: true } }));
    const { answerTextForStorage, answerPrivacyMetadata } = await import("../src/lib/query-privacy");

    expect(answerTextForStorage("Monitor FBC weekly for the first 18 weeks.")).toBe(
      "Monitor FBC weekly for the first 18 weeks.",
    );
    expect(answerTextForStorage(null)).toBeNull();
    expect(answerPrivacyMetadata()).toEqual({ answer_retained: true });
  });
});

describe("queryVocabularyAliasesForStorage (RET-H4-safe candidate aliases)", () => {
  it("returns only curated vocabulary canonicals matched by the query, never query text", async () => {
    vi.doMock("@/lib/env", () => ({ env: { RAG_PERSIST_RAW_QUERY_TEXT: false } }));
    const { queryVocabularyAliasesForStorage } = await import("../src/lib/query-privacy");
    const { clinicalVocabularyEntries } = await import("../src/lib/clinical-vocabulary");
    const canonicals = new Set(clinicalVocabularyEntries().map((entry) => entry.canonical));

    // A query mixing a patient-identifying name with clinical vocabulary must only ever emit
    // the curated canonical — the name cannot appear because output strings come from the
    // fixed vocabulary table, not from the query.
    const aliases = queryVocabularyAliasesForStorage("John Citizen ANC threshold for depot");
    expect(aliases.length).toBeGreaterThan(0);
    for (const alias of aliases) {
      expect(canonicals.has(alias)).toBe(true);
      expect(alias.toLowerCase()).not.toContain("john");
      expect(alias.toLowerCase()).not.toContain("citizen");
    }
    expect(aliases).toContain("absolute neutrophil count");
    expect(aliases).toContain("long acting injectable");
  });

  it("returns nothing for queries with no vocabulary match", async () => {
    vi.doMock("@/lib/env", () => ({ env: { RAG_PERSIST_RAW_QUERY_TEXT: false } }));
    const { queryVocabularyAliasesForStorage } = await import("../src/lib/query-privacy");
    expect(queryVocabularyAliasesForStorage("John Citizen follow up appointment")).toEqual([]);
  });
});
