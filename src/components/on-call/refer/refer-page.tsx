"use client";

import { ClipboardList, Feather, LayoutList } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { useOnCallHospitalPhone } from "@/components/on-call/call/call-device-stores";
import { OnCallHospitalPhoneSwitch } from "@/components/on-call/call/hospital-phone-switch";
import { OnCallCrisisLines } from "@/components/on-call/call/external-line-rows";
import { handbookFirstLine, OnCallHandbookItemRow } from "@/components/on-call/find/handbook-item-row";
import { onCallActionLink, onCallLeadingIcon } from "@/components/on-call/kit/calm";
import { OnCallGroupedList, OnCallRow } from "@/components/on-call/kit/grouped-list";
import { OnCallHandbookState } from "@/components/on-call/kit/handbook-state";
import { OnCallHospitalLine } from "@/components/on-call/kit/hospital-line";
import { OnCallHubPageFrame } from "@/components/on-call/kit/hub-page-frame";
import { modeSecondaryText } from "@/components/mode-kit/type";
import { OnCallFilterChips } from "@/components/on-call/on-call-filter-chips";
import { onCallEntryAnchorId, onCallGroupAnchorId } from "@/components/on-call/on-call-page-anchors";
import { OnCallRouteFreshnessLine } from "@/components/on-call/refer/route-freshness";
import { useHospitalHandbook } from "@/components/on-call/use-hospital-handbook";
import { SearchField } from "@/components/ui/text-field";
import { cn } from "@/components/ui-primitives";
import { onCallEntryIsEditable } from "@/lib/on-call/entry-model";
import { useOnCallEntries } from "@/lib/on-call/entry-store";
import type { HandbookItem } from "@/lib/on-call/handbook-items";
import { searchHandbookItems } from "@/lib/on-call/handbook-search";
import { compareOnCallTeams, onCallTeamBarLabel } from "@/lib/on-call/handbook-title";

const ALL_TEAMS = "All teams";

function matchesNote(entry: { title: string; subtitle?: string | null }, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${entry.title} ${entry.subtitle ?? ""}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/**
 * Refer: where to send someone (mock-up v10 s-3). The hospital's own referral
 * routes first, then a link to the Services directory, then the reader's own
 * referral notes.
 *
 * - One search box filters the routes and the notes on this device, and the
 *   directory link carries the words across to the Services mode, which owns
 *   its own data (best use, eligibility, hours, shortlist and compare). That
 *   data is not copied here.
 * - Each route is one row with its freshness line: "Updated 3 weeks ago", or,
 *   when neither published nor confirmed for three months, amber words
 *   "Not checked for 4 months · confirm before use". The detail, the number and
 *   its call link open in a sheet.
 * - "All teams" at the group's right opens the team filter when the hospital
 *   files its routes under two or more teams.
 * - Own notes are every referral entry the reader wrote, private or shared
 *   (Add opens the editor, which saves shared unless "private" is ticked), so
 *   the line says which are only theirs rather than claiming all of them are.
 */
export function OnCallReferPage() {
  const handbook = useHospitalHandbook();
  const entries = useOnCallEntries();
  const hospitalPhone = useOnCallHospitalPhone();
  const [team, setTeam] = useState(ALL_TEAMS);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const ready = handbook.status === "ready";
  const hospitalName = handbook.siteName ?? handbook.serviceName;

  const referrals = useMemo(
    () => (ready ? handbook.items.filter((item) => item.section === "referrals") : []),
    [handbook.items, ready],
  );
  const teams = useMemo(
    () =>
      [...new Set(referrals.map((item) => item.parsed.team).filter((name): name is string => Boolean(name)))].sort(
        compareOnCallTeams,
      ),
    [referrals],
  );
  const chosen = teams.includes(team) ? team : ALL_TEAMS;
  const byTeam = chosen === ALL_TEAMS ? referrals : referrals.filter((item) => item.parsed.team === chosen);
  const shown = searching ? searchHandbookItems(byTeam, query) : byTeam;
  const hasDeskOnly = referrals.some((item) => item.dial.kind === "extension");

  const signedOut = entries.signedOut || handbook.status === "signed-out";
  const mine = useMemo(
    () => entries.entries.filter((entry) => entry.section === "referrals" && onCallEntryIsEditable(entry)),
    [entries.entries],
  );
  const mineShown = searching ? mine.filter((entry) => matchesNote(entry, query)) : mine;

  const secondary = (item: HandbookItem) =>
    item.parsed.team ? onCallTeamBarLabel(item.parsed.team) : handbookFirstLine(item.body);
  const servicesHref = `/services/search?q=${encodeURIComponent(query.trim())}`;
  const resultCount = shown.length + (signedOut ? 0 : mineShown.length);

  return (
    <OnCallHubPageFrame
      page="refer"
      // The group eyebrow names the hospital; the line stays only to offer "Change".
      lead={handbook.hospitals.length > 1 ? <OnCallHospitalLine handbook={handbook} /> : null}
    >
      <OnCallHandbookState handbook={handbook} page="refer" />
      {ready ? null : <OnCallCrisisLines />}

      {ready || !signedOut ? (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)]" data-testid="on-call-refer-search">
          <SearchField
            label="Search referrals and services"
            placeholder="Search referrals and services"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery("")}
            clearLabel="Clear the referral search"
            autoComplete="off"
          />
          <p role="status" aria-live="polite" className="sr-only">
            {searching ? `${resultCount} ${resultCount === 1 ? "result" : "results"} here` : ""}
          </p>
        </div>
      ) : null}

      {ready && (shown.length > 0 || !searching) && referrals.length > 0 ? (
        <OnCallGroupedList
          eyebrow={hospitalName ? `At ${hospitalName}` : "At this hospital"}
          action={
            teams.length >= 2
              ? {
                  label: chosen,
                  onClick: () => setTeamsOpen((open) => !open),
                  ariaLabel: `Filter by team, now ${chosen}`,
                  testId: "on-call-refer-team-toggle",
                }
              : undefined
          }
          id={onCallGroupAnchorId("hospital")}
          testId="on-call-refer-hospital"
        >
          {teams.length >= 2 && (teamsOpen || chosen !== ALL_TEAMS) ? (
            <li className="min-w-0 px-1 pb-1">
              <OnCallFilterChips
                options={[ALL_TEAMS, ...teams]}
                active={chosen}
                onChange={setTeam}
                label="Team"
                testId="on-call-refer-team"
              />
            </li>
          ) : null}
          {shown.map((item) => (
            <OnCallHandbookItemRow
              key={item.id}
              item={item}
              listOnly
              leading={<ClipboardList aria-hidden="true" strokeWidth={1.5} className={onCallLeadingIcon} />}
              secondary={secondary(item)}
              meta={
                <OnCallRouteFreshnessLine
                  updatedAt={item.updatedAt}
                  lastConfirmedAt={item.lastConfirmedAt}
                  testId={`on-call-refer-freshness-${item.id}`}
                />
              }
              hospitalName={hospitalName}
              hospitalPhone={hospitalPhone}
              detailTestId="on-call-refer-detail"
              testId={`on-call-refer-row-${item.id}`}
            />
          ))}
        </OnCallGroupedList>
      ) : null}
      {ready && (hasDeskOnly || hospitalPhone) ? <OnCallHospitalPhoneSwitch on={hospitalPhone} /> : null}

      <OnCallGroupedList eyebrow="Services directory" testId="on-call-refer-services">
        {searching ? (
          <OnCallRow
            href={servicesHref}
            testId="on-call-refer-services-link"
            leading={<LayoutList aria-hidden="true" strokeWidth={1.5} className={onCallLeadingIcon} />}
            title={`Search services for “${query.trim()}”`}
            subtitle="Opens the Services mode"
          />
        ) : (
          // A literal next/link href: route-reachability counts only those.
          <OnCallRow
            href="/services/search"
            testId="on-call-refer-services-link"
            leading={<LayoutList aria-hidden="true" strokeWidth={1.5} className={onCallLeadingIcon} />}
            title="Search and compare services"
            subtitle="Best use, eligibility and hours, in the Services mode"
          />
        )}
      </OnCallGroupedList>

      <OnCallGroupedList
        eyebrow="Your own referral notes"
        actionNode={
          // A literal href: the route-reachability guard reads literal hrefs only.
          <Link
            href="/on-call/referrals"
            data-testid="on-call-refer-mine-link"
            className={cn(onCallActionLink, focusRing)}
          >
            Add
          </Link>
        }
        id={onCallGroupAnchorId("mine")}
        testId="on-call-refer-mine"
      >
        {signedOut ? (
          <li className="flex min-h-12 min-w-0 items-center px-3">
            <span className={cn(modeSecondaryText, "break-words")}>Sign in to keep your own referrals.</span>
          </li>
        ) : (
          <>
            {/* Shared notes are readable by the service, so only the private ones are "only you". */}
            {entries.demoMode ? null : (
              <li className="min-w-0 px-3 pb-2">
                <p className={cn(modeSecondaryText, "break-words")}>
                  Saved to your account. Notes marked private are only yours.
                </p>
              </li>
            )}
            {mineShown.length === 0 && entries.loading ? (
              <li className="flex min-h-12 min-w-0 items-center px-3" role="status">
                <span className={cn(modeSecondaryText, "break-words")}>Reading your referral notes…</span>
              </li>
            ) : mineShown.length === 0 && entries.loadError ? (
              <li
                className="flex min-h-12 min-w-0 flex-wrap items-center gap-x-3 px-3"
                data-testid="on-call-refer-mine-error"
              >
                <span className={cn(modeSecondaryText, "break-words")}>Your referral notes could not be read.</span>
                <button type="button" onClick={entries.retry} className={cn(onCallActionLink, focusRing)}>
                  Try again
                </button>
              </li>
            ) : mineShown.length === 0 ? (
              <li className="flex min-h-12 min-w-0 items-center px-3">
                <span className={cn(modeSecondaryText, "break-words")}>
                  {searching ? "No notes match." : "No referral notes yet."}
                </span>
              </li>
            ) : null}
            {mineShown.map((entry) => (
              <OnCallRow
                key={entry.id}
                href={`/on-call/referrals#${onCallEntryAnchorId(entry.id)}`}
                leading={<Feather aria-hidden="true" strokeWidth={1.5} className={onCallLeadingIcon} />}
                title={entry.title}
                subtitle={[entry.subtitle, entry.isPersonal ? "Private" : "Shared with your service"]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </>
        )}
      </OnCallGroupedList>
    </OnCallHubPageFrame>
  );
}
