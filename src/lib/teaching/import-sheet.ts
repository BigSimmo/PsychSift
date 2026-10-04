import {
  IMPORT_FORBIDDEN_HEADER_PATTERNS,
  IMPORT_MAX_ROWS,
  IMPORT_TEMPLATE_HEADERS,
  importSeriesSchema,
  type ImportPreview,
  type SheetRow,
} from "@/lib/teaching/depth-model";
import { plainTeachingIssue, type GroupRow, type SeriesInput } from "@/lib/teaching/model";

/*
 * Row validation for a term of sessions from the template (spec §9). Master plan R25: the browser
 * parses a CSV itself (`import-csv.ts`); an .xlsx goes to `/api/teaching/import/read`, which reads it
 * in memory with `readXlsxRows` (`import-sheet-reader.ts`, which carries the size/archive checks and
 * the lazy exceljs/jszip loads) and returns only the rows, so exceljs stays out of the client bundle.
 * This module runs `previewRows` against the organiser's groups, and the commit is one all-or-nothing
 * call. No file is stored. The template has no presenter or patient-related column.
 *
 * This module is imported by `depth-repository.ts` (server), so it must stay free of exceljs/jszip —
 * a prior version held the reader functions here too, and the bundler traced exceljs -> unzipper -> an
 * unresolved optional `@aws-sdk/client-s3` into the production server build (F1).
 */
export type { SheetRow };
type Header = (typeof IMPORT_TEMPLATE_HEADERS)[number];

function patientShapedHeaders(headers: readonly string[]): string[] {
  return headers.filter((header) => {
    const normalised = header.trim().toLowerCase().replace(/[-]+/g, "_");
    return IMPORT_FORBIDDEN_HEADER_PATTERNS.some((pattern) => pattern.test(normalised));
  });
}
const COLUMN: Record<string, Header> = {
  title: "title",
  kind: "kind",
  repeat: "repeat",
  firstDate: "first_date",
  endDate: "end_date",
  startTime: "start_time",
  minutes: "minutes",
  venue: "venue",
  joinUrl: "join_link",
  groupIds: "groups",
};

export function previewRows(table: readonly SheetRow[], groups: readonly GroupRow[]): ImportPreview {
  const [head, ...body] = table;
  const headers = (head?.cells ?? []).map((cell) => cell.trim().toLowerCase());
  const missing = IMPORT_TEMPLATE_HEADERS.filter((name) => !headers.includes(name));
  const refuse = (message: string): ImportPreview => ({
    rows: [{ line: head?.line ?? 1, title: "", errors: [message] }],
    ready: null,
  });
  if (!head || missing.length > 0) return refuse(`The first row must name these columns: ${missing.join(", ")}.`);
  const forbidden = patientShapedHeaders(headers);
  if (forbidden.length > 0)
    return refuse(
      `This file looks like it contains patient details (column${forbidden.length === 1 ? "" : "s"}: ${forbidden.join(", ")}). Teaching imports only accept session columns.`,
    );
  if (body.length === 0) return refuse("Add at least one session under the headings.");
  if (body.length > IMPORT_MAX_ROWS) return refuse(`Import at most ${IMPORT_MAX_ROWS} rows at a time.`);

  const groupIds = new Map(groups.map((group) => [group.name.trim().toLowerCase(), group.groupId]));
  const seen = new Map<string, number>();
  const ready: SeriesInput[] = [];
  const rows = body.map(({ line, cells }) => {
    const get = (name: Header) => (cells[headers.indexOf(name)] ?? "").trim();
    const errors: string[] = [];
    const ids = get("groups")
      .split(";")
      .map((name) => name.trim())
      .filter(Boolean)
      .flatMap((name) => {
        const found = groupIds.get(name.toLowerCase());
        if (!found) errors.push(`groups: No group called "${name}". Add it in Organise first.`);
        return found ? [found] : [];
      });
    const candidate = {
      title: get("title"),
      kind: get("kind"),
      repeat: get("repeat"),
      firstDate: get("first_date"),
      endDate: get("end_date") || get("first_date"),
      startTime: get("start_time"),
      minutes: Number(get("minutes")),
      venue: get("venue") || null,
      joinUrl: get("join_link") || null,
      groupIds: ids,
    };
    const parsed = importSeriesSchema.safeParse(candidate);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        errors.push(`${COLUMN[String(issue.path[0])] ?? "row"}: ${plainTeachingIssue([issue])}`);
    const key = `${candidate.title.toLowerCase()}|${candidate.firstDate}|${candidate.startTime}`;
    const earlier = seen.get(key);
    if (earlier) errors.push(`Same session as line ${earlier}.`);
    else seen.set(key, line);
    if (parsed.success && errors.length === 0) ready.push(parsed.data);
    return { line, title: candidate.title, errors };
  });
  return { rows, ready: rows.every((row) => row.errors.length === 0) ? ready : null };
}
