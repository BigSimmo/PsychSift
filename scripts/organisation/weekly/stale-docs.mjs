// Weekly report section (suggestion 11): key documents whose area changed after they were last
// read. Report only; it never blocks a PR and never edits a pin.
import { codeSpan, headCommit, isShallow } from "../map-placement.mjs";
import { PINS_FILE, pinStatus } from "../pins.mjs";

const SAMPLE_FILES = 5;

function whyUnchecked(row, shallow) {
  if (row.status === "no pin") return "it has no pin yet";
  if (row.status === "pin unreadable") return "its pin is not a commit id (re-pin it to a commit on main)";
  if (row.status === "doc missing")
    return "the document no longer exists; `npm run check:organisation -- --fix` drops its pin";
  return shallow
    ? "its pin is older than this shallow clone's history"
    : "its pin is not in main's history (probably a commit that only existed on a PR branch)";
}

export async function section({ root, now } = {}) {
  const title = "Key documents that may be out of date";
  const rows = pinStatus({ root, now });
  const head = headCommit(root);
  const stale = rows
    .filter((r) => r.stale)
    .sort((a, b) => b.commitsSinceLastRead - a.commitsSinceLastRead || a.doc.localeCompare(b.doc));
  const unchecked = rows.filter((r) => r.status !== "checked");
  const current = rows.length - stale.length - unchecked.length;

  const lines = [
    "A key document is flagged when files in its area changed after it was last read: after its pin in " +
      `\`${PINS_FILE}\`, or after the document's own latest edit when that is newer.`,
    "",
    `**${stale.length} of ${rows.length}** key documents may be out of date; ${current} ${current === 1 ? "is" : "are"} current` +
      (unchecked.length ? `; ${unchecked.length} could not be checked.` : "."),
  ];
  if (stale.length) {
    lines.push("");
    for (const row of stale) {
      const shown = row.changedFiles.slice(0, SAMPLE_FILES).map((f) => codeSpan(f));
      const more = row.changedFiles.length > SAMPLE_FILES ? ` and ${row.changedFiles.length - SAMPLE_FILES} more` : "";
      const commits = `${row.commitsSinceLastRead} commit${row.commitsSinceLastRead === 1 ? "" : "s"}`;
      lines.push(
        `- ${codeSpan(row.doc)} (${row.area}): ${commits} since last read, touching ${shown.join(", ")}${more}`,
      );
    }
  }
  if (unchecked.length) {
    const shallow = isShallow(root);
    lines.push("", "Could not be checked:", "");
    for (const row of unchecked)
      lines.push(`- ${codeSpan(row.doc)} (${row.area ?? "no area"}): ${whyUnchecked(row, shallow)}`);
  }
  if (stale.length || unchecked.length) {
    lines.push(
      "",
      "To clear one: re-read the document against the files listed and correct anything out of date, then set its " +
        `pin in \`${PINS_FILE}\` to the commit on main you read it against` +
        (head ? ` (this report was generated at \`${head}\`)` : "") +
        ". Never pin a commit that exists only on a PR branch: it is not on main until the PR merges, and PRs squash-merged before 2026-10-18 never brought their branch commits to main.",
    );
  }
  return { title, markdown: `${lines.join("\n")}\n` };
}
