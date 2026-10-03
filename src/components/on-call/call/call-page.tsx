"use client";

import { currentCover } from "@/lib/on-call/service-availability";
import { useHospitalClock } from "@/components/on-call/use-hospital-clock";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { useOnCallDidntConnectAt, useOnCallHospitalPhone } from "@/components/on-call/call/call-device-stores";
import { onCallCallGroups, onCallSwitchboardItem, type OnCallCallGroup } from "@/components/on-call/call/call-groups";
import { OnCallDidntConnect } from "@/components/on-call/call/didnt-connect";
import { OnCallCrisisLines, OnCallExternalLineRows } from "@/components/on-call/call/external-line-rows";
import { onCallExternalLines, searchExternalLines } from "@/components/on-call/call/external-lines";
import { OnCallHospitalPhoneSwitch } from "@/components/on-call/call/hospital-phone-switch";
import { OnCallIsobarCard } from "@/components/on-call/call/isobar-card";
import { OnCallCallLogCard, OnCallHandoverBuilder } from "@/components/on-call/handover/call-log";
import { OnCallDialRow, toHandbookDial } from "@/components/on-call/kit/dial-row";
import { OnCallGroupedList } from "@/components/on-call/kit/grouped-list";
import { OnCallHandbookState } from "@/components/on-call/kit/handbook-state";
import { OnCallHospitalLine } from "@/components/on-call/kit/hospital-line";
import { OnCallHubPageFrame } from "@/components/on-call/kit/hub-page-frame";
import { onCallInsetHairline, onCallPressable, onCallRowHeight } from "@/components/on-call/kit/recipes";
import { onCallNameText, onCallNumberText, onCallSecondaryText } from "@/components/on-call/kit/type";
import { onCallGroupAnchorId } from "@/components/on-call/on-call-page-anchors";
import { ON_CALL_HUB_GROUPS, onCallHubPageSections } from "@/components/on-call/on-call-page-sections";
import { useHospitalHandbook, type HospitalHandbookState } from "@/components/on-call/use-hospital-handbook";
import { SearchField } from "@/components/ui/text-field";
import { cn } from "@/components/ui-primitives";
import { onCallDetailsSchemaFor, type OnCallEntry } from "@/lib/on-call/entry-model";
import { searchOnCallEntries } from "@/lib/on-call/entry-search";
import { useOnCallEntries } from "@/lib/on-call/entry-store";
import { pinnedEmergencyEntries, type HandbookItem } from "@/lib/on-call/handbook-items";
import { searchHandbookItems } from "@/lib/on-call/handbook-search";
import { msUntilOnCallPeriodChange, resolveOnCallNumber, type HandbookDial } from "@/lib/on-call/number-resolver";
import { partitionContactsEntries } from "@/lib/on-call/who-is-who";

/** About eight or nine rows fit a phone before "Show all" (standard §4). */
const ROWS_BEFORE_SHOW_ALL = 8;

const groupIcon = (slug: string) => ON_CALL_HUB_GROUPS.call.find((group) => group.slug === slug)?.icon;

function hospitalName(handbook: HospitalHandbookState): string | null {
  return handbook.siteName ?? handbook.serviceName;
}

/** The fallback a "Didn't connect" sheet offers, and whether this phone is a hospital phone. */
type Fallback = {
  readonly item: HandbookItem | null;
  readonly dial: HandbookDial | null;
  readonly hospitalPhone: boolean;
};

function HandbookCallRow({
  item,
  handbook,
  pinned,
  hospitalPhone,
  fallback,
}: {
  readonly item: HandbookItem;
  readonly handbook: HospitalHandbookState;
  readonly pinned: boolean;
  readonly hospitalPhone: boolean;
  readonly fallback: Fallback;
}) {
  const didntConnectAt = useOnCallDidntConnectAt(item.id);
  const name = hospitalName(handbook);
  return (
    <OnCallDialRow
      id={item.id}
      source="handbook"
      title={item.parsed.label}
      dial={item.dial}
      hospitalPhone={hospitalPhone}
      hospitalPhoneSwitch={<OnCallHospitalPhoneSwitch on={hospitalPhone} testId="on-call-hospital-phone-sheet" />}
      mobileDial={item.mobileDial}
      state={didntConnectAt ? { kind: "didnt-connect", at: didntConnectAt } : null}
      updatedAt={item.updatedAt}
      lastConfirmedAt={item.lastConfirmedAt}
      sources={item.sources}
      tone={pinned ? "emergency" : "default"}
      hospitalName={name}
      trailingAction={
        <OnCallDidntConnect
          id={item.id}
          title={item.parsed.label}
          report={handbook}
          switchboard={fallback.item}
          switchboardDial={fallback.dial}
          hospitalPhone={fallback.hospitalPhone}
          hospitalName={name}
        />
      }
      testId={`on-call-call-row-${item.id}`}
    />
  );
}

function ShowAllRow({
  count,
  onShow,
  label,
}: {
  readonly count: number;
  readonly onShow: () => void;
  readonly label: string;
}) {
  return (
    <li className={cn(onCallInsetHairline, "min-w-0")}>
      <button
        type="button"
        onClick={onShow}
        aria-label={`Show all ${count} in ${label}`}
        className={cn(
          onCallRowHeight.single,
          onCallPressable,
          focusRing,
          "flex w-full min-w-0 items-center gap-3 px-3 text-left text-[color:var(--text-heading)]",
        )}
      >
        <span className={cn(onCallNameText, "min-w-0 flex-1 text-base-minus")}>
          Show all <span className={onCallNumberText}>{count}</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      </button>
    </li>
  );
}

function HospitalGroup({
  group,
  searching,
  children,
}: {
  readonly group: OnCallCallGroup;
  readonly searching: boolean;
  readonly children: (items: readonly HandbookItem[]) => ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const limited = !searching && !showAll && group.items.length > ROWS_BEFORE_SHOW_ALL + 1;
  const visible = limited ? group.items.slice(0, ROWS_BEFORE_SHOW_ALL) : group.items;
  return (
    <OnCallGroupedList
      eyebrow={group.label}
      id={onCallGroupAnchorId(group.slug)}
      testId={`on-call-call-group-${group.slug}`}
    >
      {children(visible)}
      {limited ? <ShowAllRow count={group.items.length} label={group.label} onShow={() => setShowAll(true)} /> : null}
    </OnCallGroupedList>
  );
}

function contactNumber(entry: OnCallEntry, now: Date) {
  const details = onCallDetailsSchemaFor("contacts").safeParse(entry.details);
  if (!details.success) return null;
  return resolveOnCallNumber(details.data as Parameters<typeof resolveOnCallNumber>[0], now);
}

function MineCallRow({
  entry,
  hospitalPhone,
  fallback,
  name,
  now,
}: {
  readonly entry: OnCallEntry;
  readonly hospitalPhone: boolean;
  readonly fallback: Fallback;
  readonly name: string | null;
  /** The page's clock, so a row swaps to its after-hours number at the boundary. */
  readonly now: Date;
}) {
  const didntConnectAt = useOnCallDidntConnectAt(entry.id);
  const resolved = contactNumber(entry, now);
  const dial = toHandbookDial(resolved);
  return (
    <OnCallDialRow
      id={entry.id}
      source="entry"
      title={entry.title}
      subtitle={entry.subtitle ?? undefined}
      dial={dial}
      hospitalPhone={hospitalPhone}
      hospitalPhoneSwitch={<OnCallHospitalPhoneSwitch on={hospitalPhone} testId="on-call-hospital-phone-sheet" />}
      numberLabel={resolved?.label}
      state={didntConnectAt ? { kind: "didnt-connect", at: didntConnectAt } : dial ? null : { kind: "not-recorded" }}
      trailingAction={
        <OnCallDidntConnect
          id={entry.id}
          title={entry.title}
          report={null}
          switchboard={fallback.item}
          switchboardDial={fallback.dial}
          hospitalPhone={fallback.hospitalPhone}
          hospitalName={name}
        />
      }
      testId={`on-call-call-mine-${entry.id}`}
    />
  );
}

/**
 * Call: every number the reader may need tonight, in one place.
 *
 * - **Hospital** (v6 figure 05): the hospital's published numbers by
 *   department, with Emergency first, then each team, then Wards and General.
 *   Quick-jump chips under the search box move between departments.
 * - **External**: the app's own sourced public lines, each with its area,
 *   source and date, in the outside form "(08) 9000 0012".
 * - **Mine**: the reader's own numbers, and the way to their editor.
 *
 * The page's two tabs (Hospital, External) sit in the header's bar. One
 * in-flow search box filters every group on the device; the query never
 * leaves the page (Global Constraint 7). Every row ends in "Didn't connect",
 * and a handbook row can be reported with one of two fixed reasons.
 */
export function OnCallCallPage() {
  const handbook = useHospitalHandbook();
  const hospitalNow = useHospitalClock();
  const entries = useOnCallEntries();
  const hospitalPhone = useOnCallHospitalPhone();
  const [query, setQuery] = useState("");
  const [clock, setClock] = useState(() => new Date());

  // Re-read the clock when the in-hours period starts or ends (holidays count),
  // so a page left open shows your own numbers on the right daytime or after-hours line.
  useEffect(() => {
    const timer = window.setTimeout(() => setClock(new Date()), msUntilOnCallPeriodChange(clock));
    return () => window.clearTimeout(timer);
  }, [clock]);
  const searching = query.trim().length > 0;
  const ready = handbook.status === "ready";
  const name = hospitalName(handbook);

  const contacts = useMemo(() => handbook.items.filter((item) => item.section === "contacts"), [handbook.items]);
  const pinnedIds = useMemo(
    () => new Set(pinnedEmergencyEntries(handbook.items, handbook.siteId).map((item) => item.id)),
    [handbook.items, handbook.siteId],
  );
  const switchboard = useMemo(() => onCallSwitchboardItem(handbook.items), [handbook.items]);
  const fallback: Fallback = {
    item: switchboard,
    dial: switchboard?.dial ?? null,
    hospitalPhone,
  };

  const groups = useMemo(() => {
    if (!ready) return [];
    const shown = searching ? searchHandbookItems(contacts, query) : contacts;
    return onCallCallGroups(shown);
  }, [contacts, query, ready, searching]);

  const allExternal = useMemo(() => onCallExternalLines(), []);
  const external = searching ? searchExternalLines(allExternal, query) : allExternal;

  const personal = useMemo(
    () => partitionContactsEntries(entries.entries.filter((entry) => entry.isPersonal)).contacts,
    [entries.entries],
  );
  const mine = useMemo(() => {
    if (!searching) return personal;
    const matched = new Set(searchOnCallEntries(personal, query).map((result) => result.entry.id));
    return personal.filter((entry) => matched.has(entry.id));
  }, [personal, query, searching]);

  const cover = useMemo(() => {
    if (!ready) return [];
    const active = currentCover(handbook.items, hospitalNow);
    return searching ? searchHandbookItems(active, query) : active;
  }, [handbook.items, hospitalNow, query, ready, searching]);

  const hospitalCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  const externalCount = ready ? external.length : 0;
  const sections = onCallHubPageSections(
    "call",
    new Map([
      ["hospital", hospitalCount],
      ["external", externalCount],
    ]),
  );
  const resultCount = cover.length + hospitalCount + externalCount + mine.length;
  const hasDeskOnly = contacts.some((item) => item.dial.kind === "extension");
  const signedOut = entries.signedOut || handbook.status === "signed-out";

  return (
    <OnCallHubPageFrame page="call" sections={sections} lead={<OnCallHospitalLine handbook={handbook} />}>
      <OnCallHandbookState handbook={handbook} page="call" />
      {ready ? null : <OnCallCrisisLines />}
      {cover.length > 0 ? (
        <OnCallGroupedList eyebrow="Cover at this time" testId="on-call-call-cover">
          {cover.map((item) => (
            <OnCallDialRow
              key={item.id}
              id={item.id}
              source="handbook"
              title={item.parsed.label}
              subtitle={`${item.cover?.team ?? ""} · ${item.cover?.window.start}–${item.cover?.window.end}`}
              dial={item.dial}
              hospitalPhone={hospitalPhone}
              hospitalPhoneSwitch={
                <OnCallHospitalPhoneSwitch on={hospitalPhone} testId="on-call-hospital-phone-sheet" />
              }
              mobileDial={item.mobileDial}
              updatedAt={item.updatedAt}
              lastConfirmedAt={item.lastConfirmedAt}
              sources={item.sources}
              now={hospitalNow}
              testId={`on-call-call-cover-${item.id}`}
            />
          ))}
        </OnCallGroupedList>
      ) : null}

      {ready ? (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
          <div data-testid="on-call-call-search">
            <SearchField
              label="Search Call"
              placeholder="Search numbers, wards, roles"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery("")}
              clearLabel="Clear the Call search"
              autoComplete="off"
            />
          </div>
          <p role="status" aria-live="polite" className="sr-only">
            {searching ? `${resultCount} ${resultCount === 1 ? "result" : "results"}` : ""}
          </p>
          {!searching && groups.length > 1 ? (
            <nav aria-label="Departments" data-testid="on-call-call-departments">
              <ul className="-mx-3 flex min-w-0 gap-2 overflow-x-auto px-3 [-webkit-overflow-scrolling:touch]">
                {groups.map((group) => (
                  <li key={group.slug} className="shrink-0">
                    <a
                      href={`#${onCallGroupAnchorId(group.slug)}`}
                      className={cn(
                        focusRing,
                        onCallPressable,
                        "inline-flex min-h-12 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 text-sm text-[color:var(--text)] no-underline",
                      )}
                    >
                      {group.chip}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
      ) : null}

      {ready && hospitalCount > 0 ? (
        <div id={onCallGroupAnchorId("hospital")} className="grid min-w-0 scroll-mt-32 gap-5">
          {groups.map((group, index) => (
            <div key={group.slug} className="grid min-w-0 gap-5">
              <HospitalGroup group={group} searching={searching}>
                {(visible) =>
                  visible.map((item) => (
                    <HandbookCallRow
                      key={item.id}
                      item={item}
                      handbook={handbook}
                      pinned={pinnedIds.has(item.id)}
                      hospitalPhone={hospitalPhone}
                      fallback={fallback}
                    />
                  ))
                }
              </HospitalGroup>
              {/* "Calling a consultant" sits after the first hospital group. */}
              {index === 0 && !searching ? <OnCallIsobarCard /> : null}
            </div>
          ))}
          {!searching && (hasDeskOnly || hospitalPhone) ? <OnCallHospitalPhoneSwitch on={hospitalPhone} /> : null}
        </div>
      ) : null}

      {ready && externalCount > 0 ? (
        <OnCallGroupedList
          eyebrow="External"
          headerIcon={groupIcon("external")}
          id={onCallGroupAnchorId("external")}
          testId="on-call-call-external"
        >
          <OnCallExternalLineRows
            lines={external}
            testIdPrefix="on-call-call-external"
            trailingAction={(line) => (
              <OnCallDidntConnect
                id={line.id}
                title={line.title}
                report={null}
                switchboard={fallback.item}
                switchboardDial={fallback.dial}
                hospitalPhone={fallback.hospitalPhone}
                hospitalName={name}
              />
            )}
          />
        </OnCallGroupedList>
      ) : null}

      {searching && mine.length === 0 ? null : (
        <OnCallGroupedList
          eyebrow="Mine"
          headerIcon={groupIcon("mine")}
          id={onCallGroupAnchorId("mine")}
          testId="on-call-call-mine"
        >
          {signedOut
            ? null
            : mine.map((entry) => (
                <MineCallRow
                  key={entry.id}
                  entry={entry}
                  hospitalPhone={hospitalPhone}
                  fallback={fallback}
                  name={name}
                  now={clock}
                />
              ))}
          {signedOut ? (
            <li className={cn(onCallInsetHairline, onCallRowHeight.single, "flex min-w-0 items-center px-3")}>
              <span className={cn(onCallSecondaryText, "break-words")}>Sign in to keep your own numbers.</span>
            </li>
          ) : null}
          <li className={cn(onCallInsetHairline, "min-w-0")}>
            {/* A literal next/link href: route-reachability counts only those. */}
            <Link
              href="/on-call/contacts"
              data-testid="on-call-call-mine-link"
              className={cn(
                onCallRowHeight.single,
                onCallPressable,
                focusRing,
                "flex min-w-0 items-center gap-3 px-3 text-[color:var(--text-heading)] no-underline",
              )}
            >
              <span className={cn(onCallNameText, "min-w-0 flex-1 break-words text-base-minus")}>Your own numbers</span>
              <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
            </Link>
          </li>
        </OnCallGroupedList>
      )}

      {/* Hidden, not unmounted, while searching, so a half-typed call note survives a quick search. */}
      <div className={cn("grid min-w-0 gap-5", searching && "hidden")} data-testid="on-call-call-handover">
        <OnCallCallLogCard />
        <OnCallHandoverBuilder />
      </div>
    </OnCallHubPageFrame>
  );
}
