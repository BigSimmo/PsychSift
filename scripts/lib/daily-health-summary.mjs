/**
 * daily-health-summary — one rolling GitHub issue, refreshed at 7 am Perth time every day, with
 * one @mention, in place of separate phone alerts from every monitor (owner decision 2026-10-21,
 * docs/decisions/2026-10-21-one-daily-health-summary.md).
 *
 * The monitors keep running and keep their own labelled issue for detail. This module only reads
 * them: the latest run of each workflow and whether its labelled issue is open or recently
 * updated. It never reruns a check and never calls a provider.
 *
 * The repository is public, so the summary holds statuses, counts, dates and links only. It never
 * copies an issue title, an issue body or error text, apart from the ops digest's two status words,
 * which are read through an allow-list.
 */

export const SUMMARY_LABEL = "daily-health-summary";
export const SUMMARY_TITLE = "Daily health summary";
export const SUMMARY_MARKER = "<!-- daily-health-summary:v1 -->";
export const PERTH_TIME_ZONE = "Australia/Perth";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Every check the summary reports, in the order it prints them.
 *
 * `issue` says how the check's labelled issue signals trouble:
 * - `open`: the workflow closes its issue on the next green run, so an open issue is a live failure.
 * - `recent`: the issue is reused and never closed by the workflow, so the workflow's own
 *   activity inside `recentHours` is the signal: the bot opening the issue or commenting on it.
 *   Not the issue's `updated_at`, which any comment moves in this public repository.
 *   With `clearedBySuccess`, the workflow only posts when its run fails, so a later successful
 *   run clears the trouble rather than leaving it standing for the whole window. Only a run from
 *   one of the `clearedBy` triggers counts: those are the runs that would have posted had they
 *   failed, so a dry run or a manual run cannot hide a standing alert.
 * - `digest`: the ops digest's rolling issue, whose body carries the service status and alert state.
 *
 * `maxAgeHours` is how long the workflow may go without a completed run before the summary calls
 * it stale. A monitor that has stopped running must never read as healthy. `null` means the
 * workflow runs on events rather than a schedule, or ships switched off, so silence is normal.
 */
export const SUMMARY_SOURCES = [
  {
    key: "live-site",
    name: "Live site",
    workflow: "live-domain-monitor.yml",
    label: "live-monitor-failure",
    issue: "open",
    onTrouble: "red",
    trouble: "is failing its checks",
    maxAgeHours: 13,
  },
  {
    key: "answers",
    name: "Answer health",
    workflow: "ops-digest.yml",
    label: "ops-digest",
    issue: "digest",
    maxAgeHours: 13,
  },
  {
    key: "errors",
    name: "New errors (Sentry)",
    workflow: "sentry-alerts.yml",
    label: "sentry-production-alert",
    issue: "recent",
    recentHours: 24,
    onTrouble: "amber",
    trouble: "new error types in the last 24 hours",
    maxAgeHours: 2,
  },
  {
    key: "data-separation",
    name: "Staging data separation",
    workflow: "staging-tenancy.yml",
    label: "staging-tenancy-failure",
    issue: "open",
    onTrouble: "red",
    trouble: "the two-user separation test is failing",
    maxAgeHours: 26,
  },
  {
    key: "database",
    name: "Live database drift",
    workflow: "live-drift.yml",
    label: "live-drift-failure",
    issue: "open",
    onTrouble: "red",
    trouble: "the live database does not match the repository",
    maxAgeHours: 8 * 24 + 2,
  },
  {
    key: "uploads",
    name: "Upload queue",
    workflow: "ingestion-autopilot.yml",
    label: "ingestion-autopilot",
    issue: "recent",
    recentHours: 24,
    onTrouble: "amber",
    trouble: "stuck or recoverable uploads were found",
    maxAgeHours: 13,
  },
  {
    key: "ci-main",
    name: "CI on main",
    workflow: "ci.yml",
    label: "main-ci-failure",
    issue: "open",
    onTrouble: "red",
    trouble: "checks on main are failing",
    maxAgeHours: null,
  },
  {
    key: "canary",
    name: "Weekly answer canary",
    workflow: "eval-canary.yml",
    label: "eval-canary",
    issue: "recent",
    recentHours: 8 * 24,
    clearedBySuccess: true,
    clearedBy: ["schedule", "repository_dispatch"],
    onTrouble: "red",
    trouble: "the last weekly canary failed",
    maxAgeHours: 8 * 24 + 2,
  },
  {
    // Ships inert behind REINDEX_REAPER_ENABLED, so a missing run is not stale. Once armed, its
    // weekly scheduled probe posts here when it finds abandoned rows or cannot run.
    key: "reindex",
    name: "Reindex clean-up probe",
    workflow: "reindex-reaper.yml",
    label: "reindex-reaper",
    issue: "recent",
    recentHours: 8 * 24,
    clearedBySuccess: true,
    clearedBy: ["schedule"],
    onTrouble: "amber",
    trouble: "the weekly probe found abandoned reindex rows or could not run",
    maxAgeHours: null,
  },
];

/** Weekly reports linked on Mondays. Report-only: none of them changes the day's status. */
export const MONDAY_REPORTS = [
  { name: "Dependency report", label: "dependency-report" },
  { name: "Bundle size report", label: "bundle-budget-refresh" },
  { name: "Organisation report", label: "organisation-weekly" },
  { name: "Answer feedback counts", workflow: "answer-feedback-weekly.yml" },
];

const STATUS_RANK = { green: 0, amber: 1, red: 2 };
const STATUS_WORD = { green: "🟢 Green", amber: "🟠 Amber", red: "🔴 Red" };
const DIGEST_STATUS = new Set(["ok", "degraded", "unreachable", "unknown"]);
const DIGEST_SEVERITY = new Set(["none", "unknown", "warning", "page"]);

function time(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function issueLink(issue) {
  return Number.isInteger(issue?.number) && typeof issue?.html_url === "string"
    ? `[#${issue.number}](${issue.html_url})`
    : "";
}

function age(ms) {
  if (ms < HOUR) return "under an hour";
  if (ms < 2 * DAY) return `${Math.round(ms / HOUR)} hours`;
  return `${Math.round(ms / DAY)} days`;
}

/** Reads the two status words the ops digest writes into its rolling issue, through allow-lists. */
export function readDigestState(body) {
  const text = String(body ?? "");
  const statusMatch = text.match(/\*\*Service readiness:\*\*\s*\S+\s+([a-z]+)/);
  const severityMatch = text.match(/\*\*Alert state:\*\*\s*([a-z]+)\s*\((\d+)\)/);
  const status = DIGEST_STATUS.has(statusMatch?.[1]) ? statusMatch[1] : "unknown";
  const severity = DIGEST_SEVERITY.has(severityMatch?.[1]) ? severityMatch[1] : "unknown";
  const count = severityMatch ? Number(severityMatch[2]) : null;
  return { status, severity, count };
}

/**
 * @typedef {{ updated_at?: string, run_started_at?: string, created_at?: string, html_url?: string, conclusion?: string | null, event?: string }} WorkflowRun
 * @typedef {{ number?: number, html_url?: string, state?: string, updated_at?: string, created_at?: string, user?: { login?: string } | null, body?: string | null }} LabelledIssue
 * @typedef {{ key: string, name: string, status: "green" | "amber" | "red", detail: string, link: string }} Assessment
 */

/**
 * One line for one check. `latestRun` is the newest completed run of its workflow (or null),
 * `issue` the newest issue carrying its label (open first, or null), `recentMarkers` how many
 * report markers the workflow's bot posted inside the recent window (Sentry only), and
 * `botActivityAt` when the bot last opened or commented on the issue (`recent` checks only).
 *
 * @param {(typeof SUMMARY_SOURCES)[number]} source
 * @param {{ latestRun?: WorkflowRun | null, issue?: LabelledIssue | null, recentMarkers?: number | null, botActivityAt?: string | null, now: string }} inputs
 * @returns {Assessment}
 */
export function assessSource(
  source,
  { latestRun = null, issue = null, recentMarkers = null, botActivityAt = null, now },
) {
  const nowMs = time(now) ?? Date.now();
  const link = issueLink(issue);
  const runAt = time(latestRun?.updated_at ?? latestRun?.run_started_at ?? latestRun?.created_at);
  const stale = source.maxAgeHours !== null && (runAt === null || nowMs - runAt > source.maxAgeHours * HOUR);
  const staleText =
    runAt === null
      ? "has no completed run on record, so it cannot be called healthy"
      : `has not run for ${age(nowMs - runAt)}, so it cannot be called healthy`;

  let status = "green";
  let detail = "all clear";

  if (source.issue === "open" && issue?.state === "open") {
    status = source.onTrouble;
    detail = source.trouble;
  } else if (source.issue === "recent" && issue) {
    const active = time(botActivityAt);
    const cleared =
      source.clearedBySuccess === true &&
      latestRun?.conclusion === "success" &&
      (source.clearedBy ?? []).includes(latestRun?.event ?? "") &&
      active !== null &&
      runAt !== null &&
      runAt > active;
    const recent = !cleared && active !== null && nowMs - active <= source.recentHours * HOUR && issue.state === "open";
    if (recent) {
      status = source.onTrouble;
      detail =
        Number.isInteger(recentMarkers) && recentMarkers > 0 ? `${recentMarkers} ${source.trouble}` : source.trouble;
    }
  } else if (source.issue === "digest") {
    const digest = readDigestState(issue?.body);
    if (!issue) {
      status = "red";
      detail = "no digest has been published";
    } else if (digest.severity === "page") {
      status = "red";
      detail = `answers at page level (${digest.count ?? "?"} alerts), service ${digest.status}`;
    } else if (digest.status !== "ok" || digest.severity === "warning") {
      status = "amber";
      detail = `service ${digest.status}, alert state ${digest.severity}`;
    } else if (digest.severity === "unknown") {
      detail = "service ok, no answered queries to judge";
    } else {
      detail = "service ok, answers within limits";
    }
  }

  if (stale) {
    detail = status === "green" ? staleText : `${staleText}; last known: ${detail}`;
    status = "red";
  }
  return /** @type {Assessment} */ ({ key: source.key, name: source.name, status, detail, link });
}

/** Worst status across the checks. */
export function overallStatus(assessments) {
  return assessments.reduce(
    (worst, item) => (STATUS_RANK[item.status] > STATUS_RANK[worst] ? item.status : worst),
    "green",
  );
}

/** "Wednesday 22 October 2026" and the weekday, in Perth time. */
export function perthDate(now) {
  const date = new Date(time(now) ?? Date.now());
  const label = new Intl.DateTimeFormat("en-AU", {
    timeZone: PERTH_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const weekday = new Intl.DateTimeFormat("en-AU", { timeZone: PERTH_TIME_ZONE, weekday: "long" }).format(date);
  return { label: label.replace(",", ""), weekday };
}

function safeLine(value) {
  if (typeof value !== "string") return null;
  const line = value.replace(/[\r\n]+/g, " ").trim();
  return line ? line.slice(0, 300) : null;
}

/**
 * The summary as Markdown. `answerLines` are the answer quality and answer speed lines that the
 * answer quality work fills in (scripts/lib/daily-health-summary-answer-lines.mjs); a missing line
 * prints "Not measured yet". `mondayReports` are `{ name, link }` pairs, shown on Mondays only.
 *
 * @param {{
 *   now: string,
 *   assessments: Assessment[],
 *   answerLines?: { quality?: string | null, speed?: string | null },
 *   mondayReports?: Array<{ name: string, link: string }>,
 *   runUrl?: string,
 * }} inputs
 */
export function renderDailyHealthSummary({ now, assessments, answerLines = {}, mondayReports = [], runUrl = "" }) {
  const { label, weekday } = perthDate(now);
  const overall = overallStatus(assessments);
  const needsYou = assessments.filter((item) => item.status !== "green");
  const lines = [];
  lines.push(`## ${STATUS_WORD[overall]}: ${label}`, "");
  if (needsYou.length === 0) {
    lines.push("Nothing needs you today.");
  } else {
    lines.push(`${needsYou.length === 1 ? "One thing needs" : `${needsYou.length} things need`} a look today:`, "");
    for (const item of needsYou) lines.push(`- **${item.name}:** ${item.detail}${item.link ? ` (${item.link})` : ""}`);
  }
  lines.push("", "### Every check", "", "| Check | Status | Detail |", "| --- | --- | --- |");
  for (const item of assessments) {
    lines.push(`| ${item.name} | ${STATUS_WORD[item.status]} | ${item.detail}${item.link ? ` ${item.link}` : ""} |`);
  }
  lines.push(
    "",
    "### Answers",
    "",
    `- **Answer quality:** ${safeLine(answerLines.quality) ?? "Not measured yet"}`,
    `- **Answer speed:** ${safeLine(answerLines.speed) ?? "Not measured yet"}`,
  );
  if (weekday === "Monday" && mondayReports.length > 0) {
    lines.push("", "### Monday reports", "");
    for (const report of mondayReports) lines.push(`- ${report.name}: ${report.link || "no report found"}`);
  }
  lines.push(
    "",
    "Only two things still push to your phone straight away: the live site going down, and answers failing",
    "at page level. Everything else waits for this summary.",
  );
  if (runUrl) lines.push("", `Run: ${runUrl}`);
  lines.push(SUMMARY_MARKER);
  return { overall, body: lines.join("\n") };
}

async function newestCompletedRun(github, owner, repo, workflow) {
  try {
    const { data } = await github.rest.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id: workflow,
      status: "completed",
      per_page: 1,
    });
    return data.workflow_runs?.[0] ?? null;
  } catch {
    return null;
  }
}

async function newestIssue(github, owner, repo, label) {
  for (const state of ["open", "closed"]) {
    const { data } = await github.rest.issues.listForRepo({
      owner,
      repo,
      labels: label,
      state,
      sort: "updated",
      direction: "desc",
      per_page: 1,
    });
    if (data.length > 0) return data[0];
  }
  return null;
}

/** The account the monitor workflows post as. Only its activity counts, as in sentry-alerts.yml. */
const WORKFLOW_BOT = "github-actions[bot]";

/**
 * The workflow's own activity on an open `recent` issue inside the window: when it last opened or
 * commented on the issue, and how many Sentry report markers its comments carry. Anyone can
 * comment on these issues in a public repository, so other comments neither make a quiet check
 * amber nor add to the count.
 */
async function botActivitySince(github, owner, repo, issue, sinceMs) {
  if (!issue || issue.state !== "open") return { botActivityAt: null, markers: null };
  const { data } = await github.rest.issues.listComments({
    owner,
    repo,
    issue_number: issue.number,
    since: new Date(sinceMs).toISOString(),
    per_page: 100,
  });
  const ours = data.filter(
    (comment) => comment.user?.login === WORKFLOW_BOT && (time(comment.created_at) ?? -Infinity) >= sinceMs,
  );
  const times = ours.map((comment) => time(comment.created_at)).filter((value) => value !== null);
  if (issue.user?.login === WORKFLOW_BOT && time(issue.created_at) !== null) times.push(time(issue.created_at));
  let markers = 0;
  for (const comment of ours) markers += String(comment.body ?? "").match(/<!-- sentry-issue:\d+ -->/g)?.length ?? 0;
  const latest = times.length > 0 ? Math.max(...times) : null;
  return { botActivityAt: latest === null ? null : new Date(latest).toISOString(), markers };
}

/**
 * Reads every check through the GitHub REST client that actions/github-script provides.
 *
 * @param {{ github: any, owner: string, repo: string, now: string }} inputs
 * @returns {Promise<Assessment[]>}
 */
export async function collectAssessments({ github, owner, repo, now }) {
  const nowMs = time(now) ?? Date.now();
  /** @type {Assessment[]} */
  const assessments = [];
  for (const source of SUMMARY_SOURCES) {
    try {
      const [latestRun, issue] = await Promise.all([
        newestCompletedRun(github, owner, repo, source.workflow),
        newestIssue(github, owner, repo, source.label),
      ]);
      const activity =
        source.issue === "recent"
          ? await botActivitySince(github, owner, repo, issue, nowMs - source.recentHours * HOUR)
          : { botActivityAt: null, markers: null };
      const recentMarkers = source.key === "errors" ? activity.markers : null;
      assessments.push(
        assessSource(source, { latestRun, issue, recentMarkers, botActivityAt: activity.botActivityAt, now }),
      );
    } catch {
      assessments.push({ key: source.key, name: source.name, status: "red", detail: "could not be read", link: "" });
    }
  }
  return assessments;
}

/** Monday report links: the newest labelled issue, or the newest run for a workflow-only report. */
export async function collectMondayReports({ github, owner, repo }) {
  const reports = [];
  for (const report of MONDAY_REPORTS) {
    try {
      if (report.label) {
        const issue = await newestIssue(github, owner, repo, report.label);
        reports.push({ name: report.name, link: issueLink(issue) });
      } else {
        const run = await newestCompletedRun(github, owner, repo, report.workflow);
        reports.push({ name: report.name, link: run?.html_url ? `[latest run](${run.html_url})` : "" });
      }
    } catch {
      reports.push({ name: report.name, link: "" });
    }
  }
  return reports;
}
