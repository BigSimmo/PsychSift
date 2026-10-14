import type { Metadata } from "next";
import { connection } from "next/server";

import { PanelPageShell } from "@/components/developer-area/hub/panel-page-shell";
import { CARD_CLASS, META_CLASS, PanelSection } from "@/components/developer-area/hub/panel-primitives";
import { resolveLiveFreshness } from "@/lib/developer-area/freshness";
import {
  resolveSettingsCheck,
  SETTING_GROUPS,
  summariseSettings,
  type SettingExpectation,
  type SettingRow,
  type SettingState,
} from "@/lib/developer-area/settings-check";

export const metadata: Metadata = {
  title: "Settings check · Owner panel · PsychSift",
  description: "Whether each production switch is on and each secret is in place — never the values.",
};

const STATE_WORD: Record<SettingState, string> = {
  set: "Set",
  missing: "Missing",
  "not set": "Not set",
  on: "On",
  off: "Off",
  matches: "Matches",
  "does not match": "Does not match",
  legacy: "Legacy",
  shadow: "Shadow",
  canary: "Canary",
  auto: "Auto",
  openai: "OpenAI",
  offline: "Offline",
};

const EXPECTED_WORD: Record<Exclude<SettingExpectation, null>, string> = {
  set: "Set",
  off: "Off",
  matches: "Matches",
  "either-alert-channel": "Slack or Discord set",
};

const SECTION_HEADING = "text-lg font-semibold text-[color:var(--text-heading)]";
const MODULE_CLASS = "rounded-xl border border-[color:var(--border)] p-3";
const LINK_CLASS =
  "inline-flex min-h-12 items-center text-sm font-medium text-[color:var(--text-heading)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

function expectationLine(row: SettingRow): string {
  if (row.expected === null) return "No fixed expectation";
  if (row.attention) return `Expected: ${EXPECTED_WORD[row.expected]}`;
  if (row.expected === "either-alert-channel") return "As expected: Slack or Discord is set";
  return "As expected";
}

/**
 * Status is a word first (mode design standard §3). The dot is 6 px and only
 * repeats what the word already says: amber for a row that needs attention,
 * neutral grey otherwise. No red — nothing here is destructive or overdue — and
 * no green tick, which would read as a verdict.
 */
function StateWord({ row }: { row: SettingRow }) {
  return (
    <p
      data-testid={`developer-settings-state-${row.key}`}
      className="flex shrink-0 items-center gap-1.5 text-sm text-[color:var(--text-heading)]"
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${row.attention ? "bg-[color:var(--warning-text)]" : "bg-[color:var(--text-muted)]"}`}
      />
      {STATE_WORD[row.state]}
    </p>
  );
}

function SettingItem({ row }: { row: SettingRow }) {
  return (
    <li
      id={`setting-${row.key}`}
      data-testid={`developer-settings-row-${row.key}`}
      data-attention={row.attention ? "true" : "false"}
      className="grid scroll-mt-4 gap-1 border-t border-[color:var(--border)] py-3 first:border-t-0 first:pt-0 last:pb-0"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <p className="text-sm font-medium text-[color:var(--text-heading)]">{row.label}</p>
          <p className="break-all font-mono text-xs text-[color:var(--text-muted)]">{row.key}</p>
        </div>
        <StateWord row={row} />
      </div>
      <p className="text-sm leading-6 text-[color:var(--text)]">{row.description}</p>
      <p
        className={`text-xs ${row.attention ? "font-medium text-[color:var(--warning-text)]" : "text-[color:var(--text-muted)]"}`}
      >
        {expectationLine(row)}
      </p>
      {row.builtIn ? (
        <p data-testid={`developer-settings-as-built-${row.key}`} className={META_CLASS}>
          As built: the browser&rsquo;s copy is fixed when the site is built, so a change needs a new build.
        </p>
      ) : null}
    </li>
  );
}

function Unauthorized() {
  return (
    <div data-testid="developer-settings-unauthorized" className={CARD_CLASS}>
      <p className="text-sm font-medium text-[color:var(--text-heading)]">
        Sign in as an administrator to see settings.
      </p>
      <p className={META_CLASS}>
        The owner panel link opens these pages but does not show settings. Nothing was checked.
      </p>
    </div>
  );
}

export default async function DeveloperSettingsCheckPage() {
  // Opt this page into request-time rendering before any setting is read, so
  // it reports the running server's settings rather than the ones present when
  // the site was built. Nothing here is cached.
  await connection();
  const result = await resolveSettingsCheck();

  return (
    <PanelPageShell
      testId="developer-settings"
      title="Settings check"
      freshness={resolveLiveFreshness(null, new Date())}
      freshnessLabel="This server's settings"
    >
      <p className="text-sm leading-6 text-[color:var(--text-muted)]">
        Whether each production switch is on and each secret is in place. Secrets only ever show Set or Missing. Their
        values never leave the server, and this page changes nothing.
      </p>

      {result.kind === "unauthorized" ? <Unauthorized /> : <SettingsBody rows={result.rows} />}
    </PanelPageShell>
  );
}

function SettingsBody({ rows }: { rows: SettingRow[] }) {
  const summary = summariseSettings(rows);

  return (
    <>
      <PanelSection
        testId="developer-settings-summary"
        headingId="developer-settings-summary-heading"
        heading="Summary"
        headingClassName={SECTION_HEADING}
        className={`grid gap-3 ${MODULE_CLASS}`}
      >
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <p className="grid">
            <span
              data-testid="developer-settings-count-attention"
              className="text-2xl font-normal tabular-nums text-[color:var(--text-heading)]"
            >
              {summary.attention.length}
            </span>
            <span className={META_CLASS}>need attention</span>
          </p>
          <p className="grid">
            <span
              data-testid="developer-settings-count-expected"
              className="text-2xl font-normal tabular-nums text-[color:var(--text-heading)]"
            >
              {summary.asExpected}
            </span>
            <span className={META_CLASS}>as expected</span>
          </p>
          <p className="grid">
            <span
              data-testid="developer-settings-count-reported"
              className="text-2xl font-normal tabular-nums text-[color:var(--text-heading)]"
            >
              {summary.reportedOnly}
            </span>
            <span className={META_CLASS}>reported only</span>
          </p>
        </div>
        {summary.attention.length > 0 ? (
          <ul
            data-testid="developer-settings-attention-list"
            className="grid"
            aria-label="Settings that need attention"
          >
            {summary.attention.map((row) => (
              <li key={row.key} className="flex flex-wrap items-center gap-x-2">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[color:var(--warning-text)]" />
                <a href={`#setting-${row.key}`} className={LINK_CLASS}>
                  {row.label}
                </a>
                <span className={META_CLASS}>
                  {STATE_WORD[row.state]}, expected {row.expected ? EXPECTED_WORD[row.expected] : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p data-testid="developer-settings-attention-none" className="text-sm text-[color:var(--text)]">
            Nothing needs attention.
          </p>
        )}
      </PanelSection>

      {SETTING_GROUPS.map((group) => {
        const groupRows = rows.filter((row) => row.group === group.id);
        if (groupRows.length === 0) return null;
        return (
          <PanelSection
            key={group.id}
            testId={`developer-settings-group-${group.id}`}
            headingId={`developer-settings-group-${group.id}-heading`}
            heading={group.name}
            headingClassName={SECTION_HEADING}
            className="grid gap-2"
          >
            <p className={META_CLASS}>{group.blurb}</p>
            <ul className={`grid ${MODULE_CLASS}`}>
              {groupRows.map((row) => (
                <SettingItem key={row.key} row={row} />
              ))}
            </ul>
          </PanelSection>
        );
      })}
    </>
  );
}
