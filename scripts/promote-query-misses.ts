import { loadAdminClient } from "./eval-utils";

const OWNER_LOOKUP_BATCH_SIZE = 100;

type MissRow = {
  id: string;
  query: string;
  normalized_query: string;
  query_class: string | null;
  top_files: string[] | null;
  candidate_aliases: string[] | null;
  candidate_labels: Array<{
    label?: string;
    label_type?: string;
    document_id?: string;
    confidence?: number;
  }> | null;
  created_at: string;
};

function argValue(name: string) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function unique(values: Array<string | null | undefined>, limit = 12) {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
  ).slice(0, limit);
}

async function main() {
  const supabase = await loadAdminClient();
  const minCount = Number(argValue("min-count") ?? 2);
  const limit = Number(argValue("limit") ?? 200);
  const applyLabels = process.argv.includes("--apply-labels");

  const { data, error } = await supabase
    .from("rag_query_misses")
    .select("id,query,normalized_query,query_class,top_files,candidate_aliases,candidate_labels,created_at")
    .is("promoted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const groups = new Map<string, MissRow[]>();
  for (const row of (data ?? []) as MissRow[]) {
    groups.set(row.normalized_query, [...(groups.get(row.normalized_query) ?? []), row]);
  }

  const promotable = Array.from(groups.entries())
    .map(([query, rows]) => ({
      query,
      rows,
      aliases: unique(rows.flatMap((row) => row.candidate_aliases ?? [])),
      files: unique(rows.flatMap((row) => row.top_files ?? [])),
      labels: rows.flatMap((row) => row.candidate_labels ?? []),
    }))
    .filter((group) => group.rows.length >= minCount)
    .sort((a, b) => b.rows.length - a.rows.length || a.query.localeCompare(b.query));

  if (promotable.length === 0) {
    console.log(`No repeated unpromoted query misses found with min-count=${minCount}.`);
    return;
  }

  for (const group of promotable) {
    console.log(`MISS x${group.rows.length}: ${group.query}`);
    console.log(`  top_files=${group.files.join(", ") || "none"}`);
    console.log(`  candidate_aliases=${group.aliases.join(", ") || "none"}`);
    const labelPreview = unique(group.labels.map((label) => label.label)).join(", ");
    console.log(`  candidate_labels=${labelPreview || "none"}`);
  }

  if (!applyLabels) {
    console.log("Review only. Re-run with --apply-labels to insert candidate labels as manual labels.");
    return;
  }

  const promotableLabels = (group: (typeof promotable)[number]) =>
    group.labels.filter((label): label is typeof label & { document_id: string; label: string; label_type: string } =>
      Boolean(label.document_id && label.label && label.label_type),
    );
  // A label carries its document's owner, so a label promoted onto a private document stays private.
  const documentIds = unique(
    promotable.flatMap((group) => promotableLabels(group).map((label) => label.document_id)),
    Number.MAX_SAFE_INTEGER,
  );
  // In batches: the API caps a response without reporting the cut, and a document missing from a
  // truncated lookup would have its labels skipped while its misses were still marked promoted.
  const ownerByDocument = new Map<string, string | null>();
  for (let start = 0; start < documentIds.length; start += OWNER_LOOKUP_BATCH_SIZE) {
    const { data: documents, error: documentsError } = await supabase
      .from("documents")
      .select("id,owner_id")
      .in("id", documentIds.slice(start, start + OWNER_LOOKUP_BATCH_SIZE));
    if (documentsError) throw new Error(documentsError.message);
    for (const document of documents ?? []) ownerByDocument.set(document.id, document.owner_id);
  }

  let inserted = 0;
  for (const group of promotable) {
    for (const label of promotableLabels(group)) {
      if (!ownerByDocument.has(label.document_id)) {
        console.warn(`  skipped label for missing document ${label.document_id}`);
        continue;
      }
      const { error: labelError } = await supabase.from("document_labels").upsert(
        {
          document_id: label.document_id,
          owner_id: ownerByDocument.get(label.document_id) ?? null,
          label: label.label,
          label_type: label.label_type,
          source: "manual",
          confidence: Math.max(0.55, Math.min(0.9, Number(label.confidence ?? 0.6))),
          metadata: {
            // Identifiers only: the miss's query text stays in rag_query_misses, not on the label.
            promoted_from_query_miss_ids: group.rows.map((row) => row.id),
            promoted_at: new Date().toISOString(),
          },
        },
        { onConflict: "document_id,label_type,label,source" },
      );
      if (labelError) throw new Error(labelError.message);
      inserted += 1;
    }
    const { error: promotedError } = await supabase
      .from("rag_query_misses")
      .update({ promoted_at: new Date().toISOString() })
      .in(
        "id",
        group.rows.map((row) => row.id),
      );
    // Unchecked, a failed update leaves the misses unpromoted and the next run promotes them again.
    if (promotedError) throw new Error(promotedError.message);
  }

  console.log(`Promoted ${inserted} label candidate(s) from ${promotable.length} repeated miss group(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
