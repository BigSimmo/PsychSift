"use client";

import { BedDouble, BookOpen, ChevronRight, CircleHelp, Landmark, MonitorOff, Package } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { useOnCallHospitalPhone } from "@/components/on-call/call/call-device-stores";
import { OnCallHospitalPhoneSwitch } from "@/components/on-call/call/hospital-phone-switch";
import { OnCallCrisisLines } from "@/components/on-call/call/external-line-rows";
import { handbookFirstLine, OnCallHandbookItemRow } from "@/components/on-call/find/handbook-item-row";
import { OnCallFirstNightPanel } from "@/components/on-call/find/first-night-panel";
import { FirstWeekEntryLink } from "@/components/on-call/first-week/first-week-entry-link";
import { onCallChipShape, onCallChipTap, onCallLeadingIcon } from "@/components/on-call/kit/calm";
import { OnCallGroupedList } from "@/components/on-call/kit/grouped-list";
import { OnCallHandbookState } from "@/components/on-call/kit/handbook-state";
import { OnCallHospitalLine } from "@/components/on-call/kit/hospital-line";
import { OnCallHubPageFrame } from "@/components/on-call/kit/hub-page-frame";
import { modeInsetHairline, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { onCallGroupAnchorId } from "@/components/on-call/on-call-page-anchors";
import { ON_CALL_HUB_GROUPS } from "@/components/on-call/on-call-page-sections";
import { ON_CALL_ON_SITE_HREF } from "@/components/on-call/on-call-section-identity";
import { useHospitalHandbook } from "@/components/on-call/use-hospital-handbook";
import { SearchField } from "@/components/ui/text-field";
import { cn } from "@/components/ui-primitives";
import { NewWorkModeOnly } from "@/components/work-mode-launch/work-mode-launch-provider";
import type { HandbookItem } from "@/lib/on-call/handbook-items";
import { searchHandbookItems } from "@/lib/on-call/handbook-search";

type FindSlug = (typeof ON_CALL_HUB_GROUPS.find)[number]["slug"];

/**
 * Which Find group an item belongs to, or null when Find does not list it.
 * `Access:` items (building access, parking, food, taxi) belong to Admin, so
 * Find leaves them out and links there instead (owner 16:06Z).
 */
function findGroup(item: HandbookItem): FindSlug | null {
  if (item.section === "documentation") return "manuals";
  if (item.section !== "resources") return null;
  switch (item.parsed.prefix) {
    case "Downtime":
      return "downtime";
    case "Ward":
      return "wards";
    case "Equipment":
      return "equipment";
    case null:
      return "other";
    default:
      return null;
  }
}

function secondaryLine(item: HandbookItem): string | null {
  return item.aliases[0] ?? handbookFirstLine(item.body);
}

/** The muted glyph before each row, by group (mock-up v10 s-4). */
const GROUP_GLYPH: Record<FindSlug, typeof MonitorOff> = {
  downtime: MonitorOff,
  wards: BedDouble,
  equipment: Package,
  manuals: BookOpen,
  other: CircleHelp,
};

/** Rows a group shows before its "All N" action. */
const GROUP_PREVIEW = 3;

const FIRST_NIGHT_ANCHOR = "on-call-first-night-panel";

/**
 * Handbook (route `/on-call/find`): everything you look up rather than ring
 * (mock-up v10 s-4). Systems down, the First night panel, Wards, Equipment,
 * Manuals, then anything else, and one row to Admin for parking, food and
 * access.
 *
 * Systems down comes first, because Now's "Systems down" row lands on it
 * (`/on-call/find#on-call-group-downtime`). Each item is one row whose detail
 * opens in a sheet. One in-flow search box filters on the device only, and
 * finds a ward by its everyday name ("HDU" finds "Ward: 4B"). A row of jump
 * chips under it reaches each group, Orientation and First night.
 *
 * The mock-up's "Your job orientation" card is left out: the app has no job
 * model to show orientation progress against, and a made-up stage bar would
 * claim readiness nobody recorded. The Orientation chip opens the shelf.
 */
export function OnCallFindPage() {
  const handbook = useHospitalHandbook();
  const hospitalPhone = useOnCallHospitalPhone();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<FindSlug>>(() => new Set());
  const searching = query.trim().length > 0;
  const ready = handbook.status === "ready";
  const hospitalName = handbook.siteName ?? handbook.serviceName;

  const listed = useMemo(() => handbook.items.filter((item) => findGroup(item) !== null), [handbook.items]);
  const groups = useMemo(() => {
    const shown = searching ? searchHandbookItems(listed, query) : listed;
    return ON_CALL_HUB_GROUPS.find.map((group) => ({
      ...group,
      items: shown.filter((item) => findGroup(item) === group.slug),
    }));
  }, [listed, query, searching]);

  const resultCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  const hasDeskOnly = listed.some((item) => item.dial.kind === "extension");
  const present = (slug: FindSlug) => groups.some((group) => group.slug === slug && group.items.length > 0);

  const jumps: { label: string; href: string }[] = ready
    ? [
        ...(present("downtime") ? [{ label: "Systems down", href: `#${onCallGroupAnchorId("downtime")}` }] : []),
        { label: "Orientation", href: "/on-call/orientation" },
        { label: "First night", href: `#${FIRST_NIGHT_ANCHOR}` },
        ...(present("wards") ? [{ label: "Wards", href: `#${onCallGroupAnchorId("wards")}` }] : []),
        ...(present("equipment") ? [{ label: "Equipment", href: `#${onCallGroupAnchorId("equipment")}` }] : []),
        { label: "Manuals", href: `#${onCallGroupAnchorId("manuals")}` },
      ]
    : [];

  const renderGroup = (group: (typeof groups)[number]) => {
    // Manuals keeps its link to the reader's own shelf even with no hospital manuals.
    const keep = group.items.length > 0 || (group.slug === "manuals" && !searching);
    if (!keep) return null;
    const open = searching || expanded.has(group.slug) || group.slug === "downtime";
    const rows = open ? group.items : group.items.slice(0, GROUP_PREVIEW);
    const canExpand = !open && group.items.length > GROUP_PREVIEW;
    const Glyph = GROUP_GLYPH[group.slug];
    return (
      <OnCallGroupedList
        key={group.slug}
        eyebrow={group.label}
        action={
          canExpand
            ? {
                label: `All ${group.items.length}`,
                onClick: () => setExpanded((current) => new Set(current).add(group.slug)),
                ariaLabel: `Show all ${group.items.length} ${group.label.toLowerCase()}`,
                testId: `on-call-find-group-${group.slug}-all`,
              }
            : undefined
        }
        id={onCallGroupAnchorId(group.slug)}
        testId={`on-call-find-group-${group.slug}`}
      >
        {rows.map((item) => (
          <OnCallHandbookItemRow
            key={item.id}
            item={item}
            leading={<Glyph aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />}
            secondary={secondaryLine(item)}
            hospitalName={hospitalName}
            hospitalPhone={hospitalPhone}
            detailTestId="on-call-find-detail"
            testId={`on-call-find-row-${item.id}`}
          />
        ))}
        {group.slug === "manuals" ? (
          <li className={cn(modeInsetHairline, "min-w-0")}>
            {/* A literal next/link href: route-reachability counts only those. */}
            <Link
              href="/on-call/orientation"
              data-testid="on-call-find-manuals-link"
              className={cn(
                modeRowHeight.single,
                modePressable,
                focusRing,
                "flex min-w-0 items-center gap-3 pl-3 pr-2 text-[color:var(--text-heading)] no-underline",
              )}
            >
              <span aria-hidden="true" className="flex w-9 shrink-0 items-center justify-center">
                <BookOpen aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />
              </span>
              <span className={cn(modeNameText, "min-w-0 flex-1 break-words text-base-minus")}>Your manuals</span>
              <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
            </Link>
          </li>
        ) : null}
      </OnCallGroupedList>
    );
  };

  const [downtime, ...rest] = groups;

  return (
    <OnCallHubPageFrame page="find" lead={<OnCallHospitalLine handbook={handbook} />}>
      <OnCallHandbookState handbook={handbook} page="find" />
      {ready ? null : <OnCallCrisisLines />}

      {ready ? (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
          <div data-testid="on-call-find-search">
            <SearchField
              label="Search the handbook"
              placeholder="Ward, room or equipment"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery("")}
              clearLabel="Clear the handbook search"
              autoComplete="off"
            />
          </div>
          <p role="status" aria-live="polite" className="sr-only">
            {searching ? `${resultCount} ${resultCount === 1 ? "result" : "results"}` : ""}
          </p>
          {searching ? null : (
            <nav
              aria-label="Jump to"
              data-no-tab-swipe
              className="-mx-1 min-w-0 overflow-x-auto"
              data-testid="on-call-find-jumps"
            >
              <ul role="list" className="flex w-max gap-2 px-1">
                {jumps.map((jump) => (
                  <li key={jump.label}>
                    <Link href={jump.href} className={cn(onCallChipTap, focusRing, "rounded-md")}>
                      <span className={onCallChipShape}>{jump.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      ) : null}

      {ready ? renderGroup(downtime) : null}
      {ready && !searching ? <OnCallFirstNightPanel id={FIRST_NIGHT_ANCHOR} testId="on-call-find-first-night" /> : null}
      {/* Your first week (round 2 feature 20): the department's pack for a new job, next to First night. */}
      {!searching ? (
        <NewWorkModeOnly>
          <FirstWeekEntryLink />
        </NewWorkModeOnly>
      ) : null}
      {ready ? rest.map(renderGroup) : null}
      {ready && !searching && (hasDeskOnly || hospitalPhone) ? <OnCallHospitalPhoneSwitch on={hospitalPhone} /> : null}

      <div className={cn(modeInsetHairline, "min-w-0")} data-testid="on-call-find-on-site">
        <Link
          href={ON_CALL_ON_SITE_HREF}
          aria-label="Parking, food and access are in Admin. Go to Admin"
          className={cn(
            modeRowHeight.single,
            modePressable,
            focusRing,
            "flex min-w-0 items-center gap-3 pl-3 pr-1 no-underline",
          )}
        >
          <span aria-hidden="true" className="flex w-9 shrink-0 items-center justify-center">
            <Landmark aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />
          </span>
          <span className={cn(modeSecondaryText, "min-w-0 flex-1 break-words py-1.5")}>
            Parking, food and access are in Admin
          </span>
          <span className="shrink-0 px-1 text-sm font-semibold text-[color:var(--mode-identity)]">Go</span>
        </Link>
      </div>
    </OnCallHubPageFrame>
  );
}
