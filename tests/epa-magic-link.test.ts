import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { GET, POST, PUT } from "@/app/api/teaching/assessments/respond/[token]/route";
import {
  createEpaMagicLinkRequest,
  getEpaMagicLinkByToken,
  hashEpaMagicToken,
  submitEpaMagicLinkResponse,
} from "@/lib/teaching/assessments/magic-link";

describe("External supervisor EPA magic-link (#MAAXAX)", () => {
  it("generates a high-entropy token, hashes it with SHA-256 at rest, and resolves valid lookups", async () => {
    const now = new Date("2026-10-16T00:00:00.000Z");
    const created = createEpaMagicLinkRequest({
      epaCode: "EPA 1",
      traineeName: "Dr Alex Example",
      supervisorName: "Dr Jordan Consultant",
      supervisorRole: "specialist",
      clinicalSetting: "Emergency Psychiatry",
      now,
    });

    expect(created.token.length).toBeGreaterThanOrEqual(32);
    expect(created.tokenHash).toBe(createHash("sha256").update(created.token).digest("hex"));
    expect(hashEpaMagicToken(created.token)).toBe(created.tokenHash);
    expect(created.urlPath).toBe(`/teaching/assessments/respond/${created.token}`);
    expect(JSON.stringify(created.request)).not.toContain(created.token);

    const lookup = getEpaMagicLinkByToken(created.token, now);
    expect(lookup.ok).toBe(true);
    if (lookup.ok) {
      expect(lookup.request.epaCode).toBe("EPA 1");
      expect(lookup.request.traineeName).toBe("Dr Alex Example");
      expect(lookup.request.supervisorRole).toBe("Specialist");
    }

    const getRes = await GET(new Request(`https://psychiatry.tools${created.urlPath}`), {
      params: Promise.resolve({ token: created.token }),
    });
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { request: { epaCode: string; traineeName: string } };
    expect(getBody.request).toMatchObject({
      epaCode: "EPA 1",
      traineeName: "Dr Alex Example",
    });
  });

  it("rejects unknown and expired magic-link tokens", async () => {
    const unknownRes = await GET(new Request("https://psychiatry.tools/api/teaching/assessments/respond/unknown"), {
      params: Promise.resolve({ token: "unknown-token-value-1234567890" }),
    });
    expect(unknownRes.status).toBe(404);
    expect(await unknownRes.json()).toMatchObject({ code: "magic_link_not_found" });

    const createdAt = new Date("2026-10-01T00:00:00.000Z");
    const created = createEpaMagicLinkRequest({
      epaCode: 2,
      traineeName: "Dr Alex Example",
      supervisorName: "Dr Taylor Registrar",
      now: createdAt,
    });

    const afterExpiry = new Date("2026-10-20T00:00:00.000Z");
    const lookup = getEpaMagicLinkByToken(created.token, afterExpiry);
    expect(lookup).toMatchObject({
      ok: false,
      status: "expired",
      code: "magic_link_expired",
    });

    const postExpired = submitEpaMagicLinkResponse(
      created.token,
      { level: "minimal", strengths: "Structured handover." },
      afterExpiry,
    );
    expect(postExpired).toMatchObject({
      ok: false,
      status: "expired",
      code: "magic_link_expired",
    });
  });

  it("rejects patient-identifiable details in request fields and feedback, and enforces single-use consumption", async () => {
    expect(() =>
      createEpaMagicLinkRequest({
        epaCode: 1,
        traineeName: "Dr Alex Example",
        supervisorName: "Dr Jordan Consultant",
        clinicalSetting: "Patient DOB 12/04/1985 UMRN D4678677",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "magic_link_patient_details",
      }),
    );

    const clientToken = "browser_generated_token_1234567890abcd";
    const putRes = await PUT(
      new Request(`https://psychiatry.tools/api/teaching/assessments/respond/${clientToken}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.10" },
        body: JSON.stringify({
          epaCode: 3,
          traineeName: "Dr Alex Example",
          supervisorName: "Sam Pharmacist",
          supervisorRole: "pharmacist",
        }),
      }),
      { params: Promise.resolve({ token: clientToken }) },
    );
    expect(putRes.status).toBe(200);

    const patientDetailResponse = await POST(
      new Request(`https://psychiatry.tools/api/teaching/assessments/respond/${clientToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.11" },
        body: JSON.stringify({
          level: "proximal",
          strengths: "Reviewed patient DOB 12/04/1985 UMNs 12345678 on Ward 4.",
        }),
      }),
      { params: Promise.resolve({ token: clientToken }) },
    );
    expect(patientDetailResponse.status).toBe(400);
    expect(await patientDetailResponse.json()).toMatchObject({
      code: "patient_detail_detected",
    });

    // Valid single-use submission succeeds
    const validResponse = await POST(
      new Request(`https://psychiatry.tools/api/teaching/assessments/respond/${clientToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.11" },
        body: JSON.stringify({
          level: "minimal",
          complexity: "medium",
          strengths: "Clear chart check and safe lithium monitoring plan.",
          improvements: "Document baseline renal function target timing.",
        }),
      }),
      { params: Promise.resolve({ token: clientToken }) },
    );
    expect(validResponse.status).toBe(200);
    const validBody = (await validResponse.json()) as {
      ok: boolean;
      request: { status: string; submission: { level: string; complexity: string } };
    };
    expect(validBody.ok).toBe(true);
    expect(validBody.request.status).toBe("completed");
    expect(validBody.request.submission).toMatchObject({
      level: "minimal",
      complexity: "medium",
    });

    // Second submission with the same token is rejected (single-use consumption)
    const replayResponse = await POST(
      new Request(`https://psychiatry.tools/api/teaching/assessments/respond/${clientToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.11" },
        body: JSON.stringify({
          level: "direct",
          strengths: "Replay attempt.",
        }),
      }),
      { params: Promise.resolve({ token: clientToken }) },
    );
    expect(replayResponse.status).toBe(409);
    expect(await replayResponse.json()).toMatchObject({
      code: "magic_link_already_used",
    });
  });
});
