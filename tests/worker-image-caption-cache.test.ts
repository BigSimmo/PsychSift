// Audit ING-B-10: a retried or re-run ingestion of the same admitted source reuses its
// own earlier caption instead of paying for the vision call again. Synthetic data only.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(import("../src/lib/openai"), async (importOriginal) => ({
  ...(await importOriginal()),
  classifyAndCaptionImageFromBase64: vi.fn(),
}));
vi.mock(import("../src/lib/ingestion-provider-egress"), async (importOriginal) => ({
  ...(await importOriginal()),
  assertIngestionProviderEgress: vi.fn(async () => undefined),
  createIngestionProviderEgressOperation: vi.fn((context) => context),
}));

import { IngestionProviderEgressRefusal } from "../src/lib/ingestion-provider-egress";
import * as egress from "../src/lib/ingestion-provider-egress";
import { classifyAndCaptionImageFromBase64 } from "../src/lib/openai";
import {
  imageCaptionCacheIdentityVersion,
  imageCaptionCacheKey,
  parseCachedImageClassification,
  readCachedImageClassification,
  writeCachedImageClassification,
  type ImageCaptionCacheKey,
} from "../worker/image-caption-cache";
import { resolveCaptionTasks, type CaptionTask } from "../worker/image-captioning";
import type { ImageClassification } from "../worker/image-classification";
import type { IngestionStageContext } from "../worker/ingestion-stage-context";
import type { JobRow } from "../worker/types";

const classify = vi.mocked(classifyAndCaptionImageFromBase64);
const assertEgress = vi.mocked(egress.assertIngestionProviderEgress);

const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const ADMISSION_ID = "33333333-3333-4333-8333-333333333333";
const AUTHORITY = `sha256:${"a".repeat(64)}`;

function job(overrides: { attempt?: number; documentId?: string; authority?: string; admission?: string } = {}) {
  const attempt = overrides.attempt ?? 1;
  return {
    locked_by: "synthetic-worker",
    lease_token: `44444444-4444-4444-8444-44444444444${attempt}`,
    lease_expected_generation_id: null,
    lease_write_generation_id: `55555555-5555-4555-8555-55555555555${attempt}`,
    lease_authority_digest: overrides.authority ?? AUTHORITY,
    lease_expires_at: "2026-10-20T00:00:00.000Z",
    lease_duration_seconds: 600,
    id: "66666666-6666-4666-8666-666666666666",
    document_id: overrides.documentId ?? DOCUMENT_ID,
    batch_id: null,
    attempt_count: attempt,
    max_attempts: 3,
    documents: {
      id: overrides.documentId ?? DOCUMENT_ID,
      owner_id: OWNER_ID,
      title: "Synthetic lithium monitoring",
      file_name: "synthetic.pdf",
      file_type: "application/pdf",
      storage_path: "synthetic/synthetic.pdf",
      content_hash: "b".repeat(64),
      metadata: { admission_event_id: overrides.admission ?? ADMISSION_ID },
    },
  } satisfies JobRow;
}

function modelClassification(caption = "Lithium monitoring flowchart."): ImageClassification {
  return {
    image_type: "flowchart_algorithm",
    searchable: true,
    clinical_relevance_score: 0.8,
    labels: ["lithium", "monitoring"],
    caption,
    skip_reason: null,
    clinical_use_class: "clinical_evidence",
    clinical_use_reason: "Synthetic monitoring workflow.",
    clinical_signal_score: 3,
    admin_signal_score: 0,
    structured_visual_profile: { version: 1, visual_type: "flowchart_algorithm" },
    structured_extraction_confidence: 0.7,
  } as unknown as ImageClassification;
}

/** In-memory stand-in for the image_caption_cache table, keyed like its unique index. */
function fakeCacheTable() {
  const rows = new Map<string, Record<string, unknown>>();
  const keyOf = (row: Record<string, unknown>) => `${row.owner_id}|${row.image_hash}|${row.model}`;
  const client = {
    from(table: string) {
      expect(table).toBe("image_caption_cache");
      const filters: Record<string, unknown> = {};
      const select = {
        eq(column: string, value: unknown) {
          filters[column] = value;
          return select;
        },
        abortSignal() {
          return select;
        },
        async maybeSingle() {
          return { data: rows.get(keyOf(filters)) ?? null, error: null };
        },
      };
      return {
        select: () => select,
        upsert(row: Record<string, unknown>, options: { onConflict: string }) {
          expect(options.onConflict).toBe("owner_id,image_hash,model");
          rows.set(keyOf(row), structuredClone(row));
          return { abortSignal: async () => ({ error: null }) };
        },
      };
    },
  };
  return { rows, client: client as unknown as IngestionStageContext["supabase"] };
}

let root = "";
let imagePath = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "caption-cache-test-"));
  imagePath = path.join(root, "page-1-image-1.png");
  await writeFile(imagePath, Buffer.from("synthetic image bytes"));
  classify.mockReset();
  assertEgress.mockReset();
  assertEgress.mockResolvedValue(undefined);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function task(): CaptionTask {
  return {
    candidate: {},
    index: 0,
    image: { pageNumber: 1, path: imagePath, mimeType: "image/png", sourceKind: "embedded", metadata: {} },
    perceptualHash: "p".repeat(16),
    imageHash: "c".repeat(64),
    nearbyText: "Synthetic nearby text.",
    tableMetadata: { candidateType: null, tableLabel: null, tableTitle: null, tableRole: null, tableText: null },
    contextHash: "d".repeat(32),
    presetClassification: null,
  } as unknown as CaptionTask;
}

function context(supabase: IngestionStageContext["supabase"]) {
  const attempt = { check: () => undefined, cancel: () => undefined, signal: new AbortController().signal };
  return {
    supabase,
    attemptForJob: () => attempt,
    mutation: vi.fn(async () => ({})),
    providerContextForJob: () => ({}),
    updateJobProgress: vi.fn(async () => undefined),
  } as unknown as IngestionStageContext;
}

describe("image caption cache identity", () => {
  it("binds the key to the admitted source and refuses to key an unbound document", () => {
    const key = imageCaptionCacheKey({
      job: job(),
      imageHash: "c".repeat(64),
      contextHash: "d".repeat(32),
      mimeType: "image/png",
    });
    expect(key).toMatchObject({ ownerId: OWNER_ID, imageHash: "c".repeat(64) });
    expect(key?.identity).toMatch(/^sha256:[0-9a-f]{64}$/);

    const unowned = job();
    unowned.documents = { ...unowned.documents, owner_id: null as unknown as string };
    expect(imageCaptionCacheKey({ job: unowned, imageHash: "c", contextHash: "d", mimeType: "image/png" })).toBeNull();
    const unhashed = job();
    unhashed.documents = { ...unhashed.documents, content_hash: null as unknown as string };
    expect(imageCaptionCacheKey({ job: unhashed, imageHash: "c", contextHash: "d", mimeType: "image/png" })).toBeNull();
  });

  it("keeps the identity across retries but changes it with source, admission, authority, image or context", () => {
    const base = { imageHash: "c".repeat(64), contextHash: "d".repeat(32), mimeType: "image/png" };
    const identity = imageCaptionCacheKey({ job: job(), ...base })!.identity;
    expect(imageCaptionCacheKey({ job: job({ attempt: 2 }), ...base })!.identity).toBe(identity);
    for (const changed of [
      imageCaptionCacheKey({ job: job({ documentId: "77777777-7777-4777-8777-777777777777" }), ...base }),
      imageCaptionCacheKey({ job: job({ admission: "88888888-8888-4888-8888-888888888888" }), ...base }),
      imageCaptionCacheKey({ job: job({ authority: `sha256:${"e".repeat(64)}` }), ...base }),
      imageCaptionCacheKey({ job: job(), ...base, imageHash: "f".repeat(64) }),
      imageCaptionCacheKey({ job: job(), ...base, contextHash: "0".repeat(32) }),
      imageCaptionCacheKey({ job: job(), ...base, mimeType: "image/jpeg" }),
    ]) {
      expect(changed!.identity).not.toBe(identity);
    }
  });

  it("never reuses legacy, foreign or malformed rows", () => {
    const key = imageCaptionCacheKey({
      job: job(),
      imageHash: "c".repeat(64),
      contextHash: "d".repeat(32),
      mimeType: "image/png",
    })!;
    const classification = modelClassification();
    const row = (metadata: Record<string, unknown>) => ({ metadata });
    expect(
      parseCachedImageClassification(
        row({ cache_identity_version: imageCaptionCacheIdentityVersion, cache_identity: key.identity, classification }),
        key,
      ),
    ).toEqual(classification);
    // Legacy rows: a flat classification with no identity.
    expect(
      parseCachedImageClassification(row({ extractor: "local-worker", image_type: "flowchart_algorithm" }), key),
    ).toBeNull();
    // Another source's caption for identical image bytes.
    expect(
      parseCachedImageClassification(
        row({
          cache_identity_version: imageCaptionCacheIdentityVersion,
          cache_identity: `sha256:${"9".repeat(64)}`,
          classification,
        }),
        key,
      ),
    ).toBeNull();
    expect(
      parseCachedImageClassification(
        row({
          cache_identity_version: imageCaptionCacheIdentityVersion,
          cache_identity: key.identity,
          classification: { ...classification, image_type: "invented_type" },
        }),
        key,
      ),
    ).toBeNull();
  });

  it("stores a redacted caption and treats store failures as a miss", async () => {
    const key: ImageCaptionCacheKey = imageCaptionCacheKey({
      job: job(),
      imageHash: "c".repeat(64),
      contextHash: "d".repeat(32),
      mimeType: "image/png",
    })!;
    const table = fakeCacheTable();
    await writeCachedImageClassification(
      table.client,
      key,
      modelClassification("Flowchart. Contact jane.citizen@example.org for review."),
      "image/png",
      new AbortController().signal,
    );
    const stored = [...table.rows.values()][0];
    expect(String(stored.caption)).not.toContain("jane.citizen@example.org");
    expect(stored).toMatchObject({ owner_id: OWNER_ID, image_hash: "c".repeat(64), mime_type: "image/png" });

    const failing = {
      from: () => {
        throw new Error("synthetic outage");
      },
    } as unknown as IngestionStageContext["supabase"];
    await expect(readCachedImageClassification(failing, key, new AbortController().signal)).resolves.toBeNull();
    await expect(
      writeCachedImageClassification(failing, key, modelClassification(), "image/png", new AbortController().signal),
    ).resolves.toBeUndefined();
  });
});

describe("caption stage reuse across retries (ING-B-10)", () => {
  it("calls the vision model once for the same admitted source across two attempts", async () => {
    classify.mockResolvedValue(modelClassification());
    const table = fakeCacheTable();

    const first = await resolveCaptionTasks(context(table.client), job({ attempt: 1 }), [task()], new Map());
    const second = await resolveCaptionTasks(context(table.client), job({ attempt: 2 }), [task()], new Map());

    expect(classify).toHaveBeenCalledTimes(1);
    expect(first[0].classificationCacheHit).toBe(false);
    expect(second[0].classificationCacheHit).toBe(true);
    expect(second[0].classification.caption).toBe(first[0].classification.caption);
    // The reuse passed the same current egress gate a dispatch would.
    expect(assertEgress).toHaveBeenCalledTimes(1);
    expect(assertEgress.mock.calls[0][1]).toBe("caption");
  });

  it("does not reuse another document's caption of identical image bytes", async () => {
    classify.mockResolvedValue(modelClassification());
    const table = fakeCacheTable();
    await resolveCaptionTasks(context(table.client), job(), [task()], new Map());
    const other = await resolveCaptionTasks(
      context(table.client),
      job({ documentId: "77777777-7777-4777-8777-777777777777" }),
      [task()],
      new Map(),
    );
    expect(classify).toHaveBeenCalledTimes(2);
    expect(other[0].classificationCacheHit).toBe(false);
  });

  it("refuses a cached caption when the source no longer passes the egress gate", async () => {
    classify.mockResolvedValue(modelClassification());
    const table = fakeCacheTable();
    await resolveCaptionTasks(context(table.client), job({ attempt: 1 }), [task()], new Map());
    assertEgress.mockRejectedValueOnce(new IngestionProviderEgressRefusal("provider_egress_denied"));
    await expect(
      resolveCaptionTasks(context(table.client), job({ attempt: 2 }), [task()], new Map()),
    ).rejects.toBeInstanceOf(IngestionProviderEgressRefusal);
    expect(classify).toHaveBeenCalledTimes(1);
  });
});
