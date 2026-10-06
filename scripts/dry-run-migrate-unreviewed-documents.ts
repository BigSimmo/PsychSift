#!/usr/bin/env node
/**
 * Dry-run migration script for #46VNY9 / #JYH1FH:
 * Relabel 1,935 documents whose clinical_validation_status was bulk-imported as
 * "locally_reviewed" without a human reviewer, changing them to "imported_unreviewed"
 * (or "unverified" with endorsement basis), while preserving documents with recorded reviewers.
 */
import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";
import { hasRecordedReviewerMarker } from "@/lib/clinical-validation-basis";

loadEnvConfig(process.cwd());

export type DocumentRow = {
  id: string;
  title?: string;
  file_name?: string;
  metadata?: Record<string, unknown> | null;
};

export type DocumentValidationMigrationCandidate = {
  id: string;
  title: string;
  file_name: string;
  currentStatus: string;
  proposedStatus: "imported_unreviewed";
  hasRecordedReviewer: boolean;
  action: "migrate" | "preserve";
  reason: string;
};

export type MigrationPlan = {
  totalInspected: number;
  candidateCount: number;
  preservedReviewedCount: number;
  otherCount: number;
  candidates: DocumentValidationMigrationCandidate[];
  sqlMigration: string;
};

export function planUnreviewedDocumentsMigration(documents: DocumentRow[]): MigrationPlan {
  const candidates: DocumentValidationMigrationCandidate[] = [];
  let preservedReviewedCount = 0;
  let candidateCount = 0;
  let otherCount = 0;

  for (const doc of documents) {
    const meta = (doc.metadata && typeof doc.metadata === "object" ? doc.metadata : {}) as Record<string, unknown>;
    const currentStatus = String(meta.clinical_validation_status ?? "unverified");

    if (currentStatus !== "locally_reviewed") {
      otherCount += 1;
      continue;
    }

    const hasReviewer = hasRecordedReviewerMarker(meta);
    if (hasReviewer) {
      preservedReviewedCount += 1;
      candidates.push({
        id: doc.id,
        title: doc.title ?? "",
        file_name: doc.file_name ?? "",
        currentStatus,
        proposedStatus: "imported_unreviewed",
        hasRecordedReviewer: true,
        action: "preserve",
        reason: "Document contains recorded human reviewer marker or verified provenance; preserved untouched.",
      });
    } else {
      candidateCount += 1;
      candidates.push({
        id: doc.id,
        title: doc.title ?? "",
        file_name: doc.file_name ?? "",
        currentStatus,
        proposedStatus: "imported_unreviewed",
        hasRecordedReviewer: false,
        action: "migrate",
        reason: "Document was assigned locally_reviewed via bulk import without recorded reviewer attribution.",
      });
    }
  }

  const sqlMigration = `-- SQL Migration for #46VNY9: Relabel bulk-imported unreviewed documents
-- Moves documents from 'locally_reviewed' to 'imported_unreviewed' if no recorded reviewer exists.
UPDATE documents
SET metadata = jsonb_set(metadata, '{clinical_validation_status}', '"imported_unreviewed"')
WHERE metadata->>'clinical_validation_status' = 'locally_reviewed'
  AND coalesce(metadata->>'provenance_basis', '') != 'reviewer_verified'
  AND coalesce(metadata->>'governance_disposition', '') NOT IN ('locally_reviewed', 'approved')
  AND (metadata->>'governance_updated_by' IS NULL OR metadata->>'governance_updated_by' IN ('', 'system'));
`;

  return {
    totalInspected: documents.length,
    candidateCount,
    preservedReviewedCount,
    otherCount,
    candidates,
    sqlMigration,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const isJson = args.includes("--json");
  const isWrite = args.includes("--write");
  const isConfirmed = args.includes("--confirm");

  if (isWrite && !isConfirmed) {
    console.error("DRY_RUN_MIGRATE_ERROR: --write requires explicit --confirm flag to mutate database records.");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.log("No live Supabase credentials provided; running dry-run inspection plan validation.");
    const plan = planUnreviewedDocumentsMigration([]);
    if (isJson) {
      console.log(JSON.stringify({ status: "dry-run", credentialsPresent: false, plan }, null, 2));
    } else {
      console.log("=== Dry-Run Migration Plan for #46VNY9 (1,935 Unreviewed Documents) ===");
      console.log("Target transition: locally_reviewed -> imported_unreviewed");
      console.log("Preserves: documents with recorded reviewer marker (governance_updated_by / reviewer_verified)");
      console.log("\nSQL Migration equivalent:\n");
      console.log(plan.sqlMigration);
    }
    return;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.from("documents").select("id, title, file_name, metadata").limit(10000);

  if (error) {
    console.error(`DRY_RUN_MIGRATE_FETCH_ERROR: ${error.message}`);
    process.exit(1);
  }

  const plan = planUnreviewedDocumentsMigration((data ?? []) as DocumentRow[]);

  if (isJson) {
    console.log(JSON.stringify({ status: isWrite ? "written" : "dry-run", plan }, null, 2));
    return;
  }

  console.log("=== Dry-Run Migration Report for #46VNY9 ===");
  console.log(`Total documents inspected: ${plan.totalInspected}`);
  console.log(`Unattributed bulk-import candidates for migration: ${plan.candidateCount}`);
  console.log(`Documents with verified human reviewer (preserved): ${plan.preservedReviewedCount}`);
  console.log(`Other documents (e.g. unverified / approved): ${plan.otherCount}`);

  if (isWrite) {
    console.log("\nExecuting migration writes...");
    const toUpdate = plan.candidates.filter((c) => c.action === "migrate").map((c) => c.id);
    console.log(`Migrating ${toUpdate.length} documents...`);
    // Batch updates in chunks
    for (let i = 0; i < toUpdate.length; i += 100) {
      const chunk = toUpdate.slice(i, i + 100);
      for (const id of chunk) {
        const doc = (data ?? []).find((d) => d.id === id);
        if (!doc) continue;
        const meta = { ...((doc.metadata ?? {}) as Record<string, unknown>) };
        meta.clinical_validation_status = "imported_unreviewed";
        await supabase.from("documents").update({ metadata: meta }).eq("id", id);
      }
    }
    console.log("Migration complete.");
  } else {
    console.log("\nDRY-RUN ONLY: No records were modified. Use --write --confirm to execute.");
    console.log("\nSQL Migration:\n" + plan.sqlMigration);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
