type SiteContentAuthoritySecretPurpose = "recovery" | "governance" | "must-pass";

type SiteContentAuthoritySecrets = Readonly<{
  recoveryValidationSecret: string | undefined;
  governanceOwnerSecret: string | undefined;
  ragProgrammeOwnerSecret: string | undefined;
}>;

type RotationMetadata = Readonly<{
  expectedCurrentDigest: string | null;
  rotationReason: string | null;
}>;

const purposeContract = {
  recovery: {
    key: "recoveryValidationSecret",
    rpc: "provision_site_content_validation_secret",
  },
  governance: {
    key: "governanceOwnerSecret",
    rpc: "provision_site_content_governance_gate_owner_secret",
  },
  "must-pass": {
    key: "ragProgrammeOwnerSecret",
    rpc: "provision_rag_programme_gate_owner_secret",
  },
} as const;

export function prepareSiteContentAuthoritySecretProvisioning(
  purpose: SiteContentAuthoritySecretPurpose,
  secrets: SiteContentAuthoritySecrets,
  rotation: RotationMetadata,
) {
  const configured = Object.values(secrets);
  if (configured.some((secret) => !secret || secret.length < 32)) {
    throw new Error("Every fixed-purpose site-content authority secret must be configured safely.");
  }
  if (new Set(configured).size !== configured.length) {
    throw new Error("Cross-purpose site-content authority secrets must be distinct.");
  }
  const expectedCurrentDigest = rotation.expectedCurrentDigest;
  const rotationReason = rotation.rotationReason?.trim() || null;
  if (expectedCurrentDigest !== null) {
    if (!/^sha256:[a-f0-9]{64}$/.test(expectedCurrentDigest) || !rotationReason) {
      throw new Error("Secret rotation requires an exact predecessor digest and rotation reason.");
    }
  } else if (rotationReason !== null) {
    throw new Error("Initial secret provisioning cannot include a rotation reason.");
  }
  const contract = purposeContract[purpose];
  return Object.freeze({
    rpc: contract.rpc,
    configuration: Object.freeze({
      secret: secrets[contract.key]!,
      expectedCurrentDigest,
      rotationReason,
    }),
  });
}

export type { SiteContentAuthoritySecretPurpose };
