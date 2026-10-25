export type DocumentNamePlan = {
  title: string;
  baseTitle: string;
  originalTitle: string | null;
  originalFileName: string;
  duplicateIndex: number;
  duplicateGroupKey: string;
  duplicateReason: "none" | "same_title_or_filename";
};

export type ExistingDocumentName = {
  id?: string;
  title?: string | null;
  file_name?: string | null;
  content_hash?: string | null;
  metadata?: unknown;
};

export type DocumentNameSupabase = {
  from: (table: "documents") => {
    select: (columns: string) => {
      eq: (
        column: "owner_id",
        value: string,
      ) => {
        order: (column: "id") => {
          range: (
            from: number,
            to: number,
          ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
        };
      };
    };
  };
};

const titleAbbreviations = new Map<string, string>([
  ["admin", "Administering"],
  ["assoc", "Associated"],
  ["clin", "Clinical"],
  ["coord", "Coordination"],
  ["doc", "Document"],
  ["docs", "Documents"],
  ["guid", "Guideline"],
  ["gui", "Guideline"],
  ["imi", "IMI"],
  ["kb", "KB"],
  ["mh", "Mental Health"],
  ["mhsp", "MHSP"],
  ["mgt", "Management"],
  ["mgmt", "Management"],
  ["mon", "Monitoring"],
  ["monitor", "Monitoring"],
  ["nocc", "NOCC"],
  ["pharma", "Pharmacological"],
  ["pharm", "Pharmacological"],
  ["pres", "Prescribing"],
  ["proc", "Procedure"],
  ["pt", "Patient"],
  ["pts", "Patients"],
  ["tx", "Treatment"],
]);

function stripExtension(fileName: string) {
  return fileName.replace(/\.[A-Za-z0-9]{1,12}$/, "");
}

function splitCamelCase(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

function cleanTitleInput(value: string) {
  return splitCamelCase(value)
    .replace(/%20/g, " ")
    .replace(/_/g, " ")
    .replace(/(\d)\.(\d)/g, "$1__DOT__$2")
    .replace(/\.+/g, " - ")
    .replace(/__DOT__/g, ".")
    .replace(/[/\\]+/g, " ")
    .replace(/[^\w\s()[\]&+,.:-]+/g, " ")
    .replace(/\b[0-9a-f]{8,}\b/gi, " ")
    .replace(/\b(?:copy|final|new|scan|scanned)\s*\(?\d*\)?$/i, " ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

function smartenWord(word: string) {
  const normalized = word.toLowerCase();
  const mapped = titleAbbreviations.get(normalized);
  if (mapped) return mapped;
  if (/^[A-Z0-9]{2,}$/.test(word)) return word;
  if (/^v?\d+(?:\.\d+)*$/i.test(word)) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function smartDocumentTitle(input: string) {
  const source = stripExtension(input).trim();
  const cleaned = cleanTitleInput(source);
  if (!cleaned) return "Untitled document";

  const title = cleaned
    .split(/(\s+-\s+|[()[\]&+,.:-])/)
    .map((part) => {
      if (!part.trim() || /^[()[\]&+,.:-]$/.test(part) || /^\s+-\s+$/.test(part)) return part;
      return part.split(/\s+/).map(smartenWord).join(" ");
    })
    .join("")
    .replace(/\s+/g, " ")
    .replace(/\s+([()[\]&+,.:])/g, "$1")
    .replace(/([([])\s+/g, "$1")
    .trim();

  return title.length <= 140 ? title : `${title.slice(0, 137).trim()}...`;
}

export function documentTitleKey(value: string) {
  return smartDocumentTitle(value)
    .toLowerCase()
    .replace(/\([^)]*\bcopy\s+\d+[^)]*\)$/i, "")
    .replace(/\([^)]*\bduplicate\s+\d+[^)]*\)$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function exactTitleKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function duplicateSuffixFromFileName(fileName: string) {
  const stem = stripExtension(fileName);
  const version = stem.match(/(?:^|[\s._-])(?:v|version)[\s._-]*(\d+(?:\.\d+){0,3})\b/i)?.[1];
  if (version) return `v${version}`;

  const isoDate = stem.match(/\b(20\d{2})[-_. ]?([01]\d)[-_. ]?([0-3]\d)\b/)?.slice(1, 4);
  if (isoDate?.length === 3) return isoDate.join("-");

  const auDate = stem.match(/\b([0-3]\d)[-_. ]([01]\d)[-_. ](20\d{2})\b/)?.slice(1, 4);
  if (auDate?.length === 3) return `${auDate[2]}-${auDate[1]}-${auDate[0]}`;

  return null;
}

function uniqueTitle(
  baseTitle: string,
  existingTitles: Set<string>,
  preferredSuffix: string | null,
  duplicateIndex: number,
) {
  const preferred = preferredSuffix ? `${baseTitle} (${preferredSuffix})` : `${baseTitle} (Copy ${duplicateIndex})`;
  if (!existingTitles.has(exactTitleKey(preferred))) return preferred;

  for (let index = Math.max(duplicateIndex, 2); index < 500; index += 1) {
    const candidate = `${baseTitle} (Copy ${index})`;
    if (!existingTitles.has(exactTitleKey(candidate))) return candidate;
  }

  return `${baseTitle} (${Date.now()})`;
}

const DOCUMENT_NAME_PAGE_SIZE = 1000;
// Bound on the read, far above the corpus (about 2,000 documents today).
const DOCUMENT_NAME_MAX_PAGES = 50;

export async function planDocumentName(args: {
  supabase?: DocumentNameSupabase;
  ownerId: string;
  fileName: string;
  requestedTitle?: string | null;
  contentHash?: string | null;
  existingDocs?: ExistingDocumentName[];
}): Promise<DocumentNamePlan> {
  const originalTitle = args.requestedTitle?.trim() || null;
  const baseTitle = smartDocumentTitle(originalTitle || args.fileName);
  const duplicateGroupKey = documentTitleKey(baseTitle);

  let documents: ExistingDocumentName[] = [];
  if (args.existingDocs) {
    documents = args.existingDocs;
  } else {
    if (!args.supabase) throw new Error("supabase client or existingDocs is required");
    const supabase = args.supabase as DocumentNameSupabase;
    // Every owner document, page by page in a stable order: matching is done
    // in memory on normalised title keys, so a single capped page missed a
    // same-title document beyond it and gave the upload a duplicate title.
    for (let page = 0; page < DOCUMENT_NAME_MAX_PAGES; page += 1) {
      const from = page * DOCUMENT_NAME_PAGE_SIZE;
      const { data, error } = await supabase
        .from("documents")
        .select("id,title,file_name,content_hash,metadata")
        .eq("owner_id", args.ownerId)
        .order("id")
        .range(from, from + DOCUMENT_NAME_PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      const rows = Array.isArray(data) ? (data as ExistingDocumentName[]) : [];
      documents.push(...rows);
      if (rows.length < DOCUMENT_NAME_PAGE_SIZE) break;
    }
  }
  const matching = documents.filter((document) => {
    if (args.contentHash && document.content_hash === args.contentHash) return false;
    const metadata = metadataRecord(document.metadata);
    // Match on both the stored group key and the current title: renames update the
    // title while preserving metadata, so the stored key alone can be stale.
    const storedGroupKey =
      typeof metadata.smart_title_group_key === "string" && metadata.smart_title_group_key.trim()
        ? metadata.smart_title_group_key
        : "";
    const titleGroupKey = document.title ? documentTitleKey(document.title) : "";
    return (
      storedGroupKey === duplicateGroupKey ||
      titleGroupKey === duplicateGroupKey ||
      documentTitleKey(document.file_name ?? "") === duplicateGroupKey
    );
  });

  if (matching.length === 0) {
    return {
      title: baseTitle,
      baseTitle,
      originalTitle,
      originalFileName: args.fileName,
      duplicateIndex: 1,
      duplicateGroupKey,
      duplicateReason: "none",
    };
  }

  const existingTitles = new Set(documents.map((document) => exactTitleKey(document.title ?? "")).filter(Boolean));
  const duplicateIndex = matching.length + 1;
  return {
    title: uniqueTitle(baseTitle, existingTitles, duplicateSuffixFromFileName(args.fileName), duplicateIndex),
    baseTitle,
    originalTitle,
    originalFileName: args.fileName,
    duplicateIndex,
    duplicateGroupKey,
    duplicateReason: "same_title_or_filename",
  };
}
