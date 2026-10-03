import privacyRegisterJson from "../../../docs/governance/privacy-readiness.v1.json";

import { loadHazardSnapshot, unmitigatedHazards } from "./hazard-register";
import type { LedgerOpenItem, LedgerSnapshot } from "./ledger-snapshot";
import { loadSignOffQueue } from "./sign-off-queue";
import { pickSignOffToday, type SignOffToday } from "./sign-off-today";

/**
 * The owner panel's "Today" facts: what is waiting on the owner, read only from
 * files this repository already commits. Nothing here is fetched at runtime.
 *
 * The privacy register is imported as JSON rather than read from disk because
 * `docs/` is not copied into the runtime image; the bundler inlines it at build
 * time, so the list is as current as the deployed build.
 */

/**
 * Ledger wording that marks an item as needing the owner. The ledger has no
 * owner field and no tag convention, so this matches the phrasings rows
 * actually use. It is a reading aid, not a completeness claim, and the section
 * that renders it says so.
 */
const OWNER_WORDING =
  /^(clinical )?owner (design )?(decisions?|sign-?off)\b|owner to (confirm|decide|approve)|awaits? owner|fresh owner review|needs? (an? )?owner (decisions?|review|sign-?off)\b/i;

export function ownerDecisionItems(open: readonly LedgerOpenItem[]): LedgerOpenItem[] {
  return (
    open
      // Summary only: details mention the owner in passing far too often to be a signal.
      .filter((item) => OWNER_WORDING.test(item.summary))
      .sort((a, b) => a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id))
  );
}

type PrivacyRequirement = {
  id: string;
  status: string;
  accountableRole?: string;
  reviewExpiresAt?: string;
};

type PrivacyRegister = { reviewExpiresAt?: string; requirements: PrivacyRequirement[] };

/** Plain names for the register's ids. An id missing here falls back to the id itself. */
const PRIVACY_LABELS: Record<string, string> = {
  "PRIV-PROVIDER-OPENAI-ZDR": "OpenAI zero data retention",
  "PRIV-LEGAL-OPENAI-DPA": "OpenAI data processing agreement",
  "PRIV-LEGAL-RAILWAY-DPA": "Railway data processing agreement",
  "PRIV-LEGAL-APP8-CROSS-BORDER-BASIS": "Legal basis for sending data overseas (APP 8)",
  "PRIV-LEGAL-APP1-APP5-NOTICE": "Privacy policy and collection notice (APP 1 and 5)",
  "PRIV-CLINICAL-PHI-MINIMISATION": "Keeping patient details out of questions",
};

export type OpenPrivacyItem = { id: string; label: string; status: string; reviewBy: string | null };

/**
 * Statuses that need no further work: `verified`, and `accepted_decision`, the
 * terminal state for a requirement the owner formally accepted as it stands
 * (see scripts/check-privacy-readiness.mjs).
 */
const SETTLED_PRIVACY_STATUSES = new Set(["verified", "accepted_decision"]);

export function openPrivacyItems(
  register: PrivacyRegister = privacyRegisterJson as PrivacyRegister,
): OpenPrivacyItem[] {
  return register.requirements
    .filter((requirement) => !SETTLED_PRIVACY_STATUSES.has(requirement.status))
    .map((requirement) => ({
      id: requirement.id,
      label: PRIVACY_LABELS[requirement.id] ?? requirement.id,
      status: requirement.status,
      reviewBy: requirement.reviewExpiresAt ?? register.reviewExpiresAt ?? null,
    }));
}

export type OwnerToday = {
  decisions: LedgerOpenItem[];
  privacy: OpenPrivacyItem[];
  uncontrolledHazards: number;
  signOff: SignOffToday;
};

export function resolveOwnerToday(ledger: LedgerSnapshot): OwnerToday {
  return {
    decisions: ownerDecisionItems(ledger.open),
    privacy: openPrivacyItems(),
    uncontrolledHazards: unmitigatedHazards(loadHazardSnapshot()).length,
    signOff: pickSignOffToday(loadSignOffQueue()),
  };
}
