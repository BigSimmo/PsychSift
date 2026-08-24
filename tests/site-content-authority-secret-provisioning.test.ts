import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { prepareSiteContentAuthoritySecretProvisioning } from "../src/lib/site-content/site-content-authority-secrets";

const root = resolve(import.meta.dirname, "..");
const secrets = {
  recoveryValidationSecret: "recovery-validation-secret-00000001",
  governanceOwnerSecret: "governance-owner-secret-0000000002",
  ragProgrammeOwnerSecret: "rag-programme-owner-secret-00000003",
};

describe("site-content fixed-purpose secret provisioning", () => {
  it("selects only fixed owner RPCs and rejects absent or cross-purpose duplicate configuration", () => {
    expect(
      prepareSiteContentAuthoritySecretProvisioning("governance", secrets, {
        expectedCurrentDigest: null,
        rotationReason: null,
      }),
    ).toEqual({
      rpc: "provision_site_content_governance_gate_owner_secret",
      configuration: {
        secret: secrets.governanceOwnerSecret,
        expectedCurrentDigest: null,
        rotationReason: null,
      },
    });
    expect(
      prepareSiteContentAuthoritySecretProvisioning("must-pass", secrets, {
        expectedCurrentDigest: "sha256:" + "a".repeat(64),
        rotationReason: "scheduled rotation",
      }).rpc,
    ).toBe("provision_rag_programme_gate_owner_secret");
    expect(() =>
      prepareSiteContentAuthoritySecretProvisioning(
        "governance",
        { ...secrets, governanceOwnerSecret: secrets.recoveryValidationSecret },
        { expectedCurrentDigest: null, rotationReason: null },
      ),
    ).toThrow(/distinct/i);
    expect(() =>
      prepareSiteContentAuthoritySecretProvisioning(
        "must-pass",
        { ...secrets, ragProgrammeOwnerSecret: "" },
        { expectedCurrentDigest: null, rotationReason: null },
      ),
    ).toThrow(/configured/i);
    expect(() =>
      prepareSiteContentAuthoritySecretProvisioning("recovery", secrets, {
        expectedCurrentDigest: "sha256:" + "b".repeat(64),
        rotationReason: null,
      }),
    ).toThrow(/rotation reason/i);
  });

  it("uses three least-privilege write-once Vault authorities with cross-purpose digest rejection", () => {
    const sql = readFileSync(
      resolve(root, "supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql"),
      "utf8",
    );
    for (const name of [
      "provision_site_content_validation_secret",
      "provision_site_content_governance_gate_owner_secret",
      "provision_rag_programme_gate_owner_secret",
    ]) {
      expect(sql).toMatch(new RegExp(`create or replace function public\\.${name}\\(p_configuration jsonb\\)`, "i"));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\(jsonb\\) to service_role`, "i"));
      expect(sql).not.toMatch(new RegExp(`grant execute on function public\\.${name}[^;]*to authenticated`, "i"));
    }
    expect(sql).toMatch(/site_content_governance_gate_owner_secret[\s\S]*rag_programme_gate_owner_secret/i);
    expect(sql).toMatch(/cross-purpose site-content authority secrets must be distinct/i);
    expect(sql.match(/hashtextextended\('site_content_authority_secrets',0\)/g)).toHaveLength(3);
    expect(sql).toMatch(/initial secret provisioning cannot claim a predecessor/i);
    expect(sql).toMatch(/exact predecessor digest and reason/i);
    expect(sql).not.toMatch(/create or replace function public\.provision_site_content_secret\([^)]*secret_name/i);
  });
});
