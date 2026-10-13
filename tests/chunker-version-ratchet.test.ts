import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CHUNKER_VERSION, DOCUMENT_CHUNKER_VERSION, chunkTextWithOverlap } from "../src/lib/chunking";

/**
 * Owner ruling, 13 Oct 2026: chunk boundaries must not change silently. This pins
 * the chunker's output on a fixed corpus to the chunker version. If chunk output
 * changes, this fails until CHUNKER_VERSION / DOCUMENT_CHUNKER_VERSION are bumped
 * (which invalidates stale chunks on re-index) and the new fingerprint is recorded
 * here, and the change is flagged for an answer quality re-check.
 */
const corpus = [
  // Long single paragraph (sentence path, overlap look-ahead).
  Array.from(
    { length: 60 },
    (_, i) =>
      `Sentence ${i} describes lithium monitoring${i % 7 === 0 ? "; do not restart the usual dose after a missed 48 hours" : ""}.`,
  ).join(" "),
  // Many paragraphs (paragraph path, successor overlap ceiling).
  Array.from(
    { length: 30 },
    (_, i) => `Paragraph ${i}. Clozapine is contraindicated with X ${i}. Monitor ANC weekly.`,
  ).join("\n\n"),
  // Text with no sentence boundaries.
  "word ".repeat(900).trim(),
];

const recorded: Record<string, string> = {
  "1.1.0-page|1.1.0-document": "4af6b997fc7ead3f8678b027a396b8ee3352bec8d155a4cbc7e751da5a6f43d5",
};

function fingerprint() {
  const hash = createHash("sha256");
  for (const text of corpus) {
    for (const [size, overlap] of [
      [400, 80],
      [1200, 200],
    ] as const) {
      hash.update(JSON.stringify(chunkTextWithOverlap(text, size, overlap)));
    }
  }
  return hash.digest("hex");
}

describe("chunker version ratchet", () => {
  it("records a fingerprint for the current chunker version", () => {
    const key = `${CHUNKER_VERSION}|${DOCUMENT_CHUNKER_VERSION}`;
    expect(recorded[key], `bump the chunker version and record a fingerprint for ${key}`).toBeDefined();
    expect(fingerprint(), "chunk output changed: bump the chunker version and flag an answer re-check").toBe(
      recorded[key],
    );
  });
});
