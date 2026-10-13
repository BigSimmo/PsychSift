import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { DeveloperHubNavHeader } from "@/components/developer-area/developer-hub-nav-header";
import { EnvironmentStrip } from "@/components/developer-area/hub/environment-strip";
import { OwnerTodaySection } from "@/components/developer-area/hub/owner-today-section";
import { PanelCard } from "@/components/developer-area/hub/panel-card";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { resolveClinicalAnswerFailures } from "@/lib/developer-area/clinical-answer-failures";
import { resolveHubEnvironmentFacts } from "@/lib/developer-area/environment-facts";
import { panelsInGroup, type HubPanelGroup } from "@/lib/developer-area/hub-panels";
import { loadLedgerSnapshot } from "@/lib/developer-area/ledger-snapshot";
import { resolveOwnerToday } from "@/lib/developer-area/owner-today";
import { resolveDeploymentCommitSha } from "@/lib/observability/sentry-release";

export const metadata: Metadata = {
  title: "Owner panel · PsychSift",
  description: "The owner's tools: what is waiting on you, settings, uploads, sign-offs and the task list.",
};

/**
 * A literal, and it must stay one. These four entries restate the ids and labels
 * that `developerHubNavSections` also holds, which normally would be a drift
 * hazard worth deriving away — but deriving is not available here:
 *
 * `developerHubNavSections` is exported from `developer-hub-nav-header.tsx`,
 * which carries `"use client"`. When this Server Component imports a value from
 * a Client Component module, Next hands back a **client-reference proxy**, not
 * the array — so `developerHubNavSections.flatMap(...)` at module scope throws
 * `flatMap is not a function` during `next build`. Importing the *component*
 * from that module is fine; importing and operating on its *data* is not.
 * Neither typecheck nor vitest can see this (the types describe the source, and
 * jsdom has no RSC boundary), so a real build is the only gate that catches it.
 *
 * Do not move the section table out of the nav-header sibling to make derivation
 * possible either: `docs/search-chrome-behaviour.md` pins it there.
 *
 * What keeps the two lists in step instead is a test —
 * `tests/developer-hub-page.dom.test.tsx`, "gives every nav section the exact
 * heading its nav entry declares" — which runs under jsdom, where both modules
 * are ordinary JavaScript. That assertion is load-bearing: it is the only thing
 * standing between this literal and the nav sheet, so do not weaken it.
 *
 * `developer-hub-environment` is deliberately absent: it is a navigable section
 * but not a panel group, so it must not produce a panel grid. Its anchor and
 * `sr-only` heading are rendered separately below.
 */
const GROUPS: { id: HubPanelGroup; anchor: string; label: string }[] = [
  { id: "work", anchor: "developer-hub-work", label: "Work and decisions" },
  { id: "clinical", anchor: "developer-hub-clinical", label: "Clinical trust" },
  { id: "system", anchor: "developer-hub-system", label: "System truth" },
  { id: "reference", anchor: "developer-hub-reference", label: "Reference" },
];

export default async function DeveloperHubPage() {
  const snapshot = loadLedgerSnapshot();
  const environment = await resolveHubEnvironmentFacts();
  const clinicalAnswerFailures = resolveClinicalAnswerFailures(snapshot);
  const today = resolveOwnerToday(snapshot);

  return (
    <>
      <DeveloperHubNavHeader />
      <main className="mx-auto grid w-full max-w-[64rem] gap-6 px-4 py-8 sm:px-6" data-testid="development-index">
        <h1 className="text-2xl font-semibold text-[color:var(--text-heading)]">Owner panel</h1>

        {/*
         * Carried over from the pre-hub index unchanged. This page links to
         * synthetic patient prototypes, so the caveat sits above the fold and is
         * not something a layout rewrite may quietly drop.
         */}
        <p className="flex items-start gap-2 rounded-xl border border-[color:var(--warning)]/30 bg-[color:var(--warning-soft)] px-4 py-3 text-sm leading-6 text-[color:var(--text)]">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--warning)]" />
          <span>
            <strong className="font-semibold text-[color:var(--text-heading)]">Synthetic data only.</strong> No patient,
            message, schedule or team record on these surfaces is real, and nothing here is validated clinical decision
            support.
          </span>
        </p>

        <section id="developer-hub-today" className={inPageAnchor}>
          <h2 className="mb-3 text-lg font-semibold text-[color:var(--text-heading)]">Today</h2>
          <OwnerTodaySection today={today} />
        </section>

        <section id="developer-hub-environment" className={inPageAnchor}>
          <h2 className="sr-only">Environment</h2>
          {/*
           * All four facts are read now. Each one either reports a value it read
           * or names its own gap; none of them may be invented.
           *
           * `demoMode` is the load-bearing one: it is the only entry that can be
           * actively *wrong* rather than merely absent, because claiming "Live
           * data" on a page that never looked states the opposite of the truth in
           * demo mode.
           *
           * `resolveDeploymentCommitSha` reads `RAILWAY_GIT_COMMIT_SHA`, which the
           * Dockerfile already declares, and returns `null` when it is absent — so
           * local dev keeps saying "build unknown" honestly rather than inventing
           * one.
           *
           * The document count and the signed-in email come from one Supabase
           * round trip in `resolveHubEnvironmentFacts`, which is what makes this
           * Server Component async. That count is owner-scoped by an explicit
           * `owner_id` filter on a server-only admin client — the service role
           * bypasses row-level security entirely, so that filter is the whole of
           * the scoping guarantee, not an addition to it (see
           * `resolveHubEnvironmentFacts` for why the user-client/RLS route this
           * comment used to describe cannot work: `documents` carries no table
           * privileges for `authenticated`). Every failure path returns `null`
           * rather than `0` — see that module for why the distinction is
           * load-bearing.
           */}
          <EnvironmentStrip
            demoMode={environment.demoMode}
            documentCount={environment.documentCount}
            buildSha={resolveDeploymentCommitSha()}
            email={environment.email}
          />
        </section>

        {snapshot.counts.p1 > 0 ? (
          <p
            data-testid="developer-hub-needs-you-now"
            className="rounded-xl border border-[color:var(--danger)]/40 bg-[color:var(--danger-soft)] px-4 py-3 text-sm text-[color:var(--text)]"
          >
            {snapshot.counts.p1} blocking {snapshot.counts.p1 === 1 ? "item" : "items"} in the task ledger.
          </p>
        ) : null}

        {/*
         * Warning, not danger: these are recorded problems against named
         * clinical questions, and today they are P2/P3 rather than blocking.
         * Painting them the same red as the blocking band would teach the reader
         * to discount both. The band exists at all because the same facts sit
         * unread inside an 81-item ledger, which is the whole reason this panel
         * was built.
         */}
        {clinicalAnswerFailures.length > 0 ? (
          <Link
            href="/mockups/development/clinical-answer-failures"
            data-testid="developer-hub-clinical-answer-failures-band"
            className="rounded-xl border border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)] px-4 py-3 text-sm text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            {clinicalAnswerFailures.length} recorded {clinicalAnswerFailures.length === 1 ? "problem" : "problems"}{" "}
            against a named clinical question.
          </Link>
        ) : null}

        {GROUPS.map((group) => {
          const panels = panelsInGroup(group.id);
          // An empty group must render no anchor at all. `useResolvedPageSections`
          // drops a declared section whose anchor is missing — that is what lets
          // phases 2-4 add panels without touching the navigation — and rendering
          // the section unconditionally would make that mechanism inert here,
          // offering a jump to a bare heading above an empty grid.
          if (panels.length === 0) return null;

          return (
            <section key={group.id} id={group.anchor} className={inPageAnchor}>
              <h2 className="mb-3 text-lg font-semibold text-[color:var(--text-heading)]">{group.label}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {panels.map((panel) => (
                  <PanelCard key={panel.id} panel={panel} />
                ))}
              </div>
            </section>
          );
        })}
      </main>
    </>
  );
}
