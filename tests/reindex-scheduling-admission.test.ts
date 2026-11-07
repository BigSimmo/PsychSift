import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assertReindexPdfSchedulingPrerequisites } from "../scripts/reindex";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
function setup() {
  const authority = { publisher: "Synthetic" },
    source = sha("synthetic-original");
  const doc = {
    id: uuid(1),
    owner_id: uuid(2),
    file_type: "application/pdf",
    file_size: 50,
    file_name: "synthetic.pdf",
    storage_path: "legacy/synthetic.pdf",
    content_hash: source.slice(7),
    metadata: {
      admission_event_id: uuid(3),
      authority,
      reindex_readmission: {
        version: "administrator-current-reindex-readmission-v1",
        scope: "owner_private",
        administratorId: uuid(2),
        documentOwnerId: uuid(2),
        sourceSha256: source,
        origin: "historical_upload_origin_not_established",
        clinicalApproval: "not_granted",
        publicationApproval: "not_granted",
      },
    },
  };
  const event = {
    id: uuid(3),
    document_id: uuid(1),
    staging_owner_id: uuid(2),
    administrator_id: uuid(2),
    source_channel: "admin_api",
    actor_kind: "administrator",
    admission_policy_version: "trusted-document-admission-v1",
    content_sha256: source,
    byte_count: 50,
    file_name_sha256: sha(doc.file_name),
    storage_path_sha256: sha(doc.storage_path),
    authority,
    admission_digest: sha("actual-admission"),
  };
  const from = vi.fn(() => {
    const query = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn(async () => ({ data: [{ id: uuid(4), document_id: uuid(1), documents: doc }], error: null })),
      maybeSingle: vi.fn(async () => ({ data: event, error: null })),
    };
    return query;
  });
  return {
    doc,
    event,
    from,
    client: { from } as unknown as Parameters<typeof assertReindexPdfSchedulingPrerequisites>[0],
  };
}
describe("reindex scheduling prerequisite only", () => {
  it("requires matching actual admission/source identity without minting worker authority", async () => {
    const f = setup();
    await expect(assertReindexPdfSchedulingPrerequisites(f.client)).resolves.toBeUndefined();
    expect(f.from).toHaveBeenCalledWith("document_admission_events");
  });
  it("refuses a missing current-readmission marker before a pipeline can recover or spawn", async () => {
    const f = setup();
    Object.assign(f.doc.metadata, { reindex_readmission: null });
    await expect(assertReindexPdfSchedulingPrerequisites(f.client)).rejects.toThrow("readmission_required");
  });
  it("refuses metadata without a matching immutable admission record", async () => {
    const f = setup();
    f.event.content_sha256 = sha("different");
    await expect(assertReindexPdfSchedulingPrerequisites(f.client)).rejects.toThrow("readmission_required");
  });
  it("does not apply PDF scheduling prerequisites to existing text work", async () => {
    const f = setup();
    f.doc.file_type = "text/plain";
    Object.assign(f.doc.metadata, { reindex_readmission: null });
    await expect(assertReindexPdfSchedulingPrerequisites(f.client)).resolves.toBeUndefined();
    expect(f.from).not.toHaveBeenCalledWith("document_admission_events");
  });
});
