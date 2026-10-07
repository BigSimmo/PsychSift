"use client";

import { currentCover } from "@/lib/on-call/service-availability";
import { useHospitalClock } from "@/components/on-call/use-hospital-clock";
import { ListChecks, Phone, Plus, Printer, Shield, Users } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { useOptionalAccountData } from "@/components/account-data-provider";
import { focusRing } from "@/components/card-recipes";
import { useOnCallDidntConnectAt, useOnCallHospitalPhone } from "@/components/on-call/call/call-device-stores";
import {
  onCallCallGroups,
  onCallRowBadge,
  onCallSwitchboardItem,
  type OnCallCallGroup,
} from "@/components/on-call/call/call-groups";
import { OnCallDidntConnect } from "@/components/on-call/call/didnt-connect";
import { OnCallCrisisLines, OnCallExternalLineRows } from "@/components/on-call/call/external-line-rows";
import { onCallExternalLines, searchExternalLines } from "@/components/on-call/call/external-lines";
import { OnCallHospitalPhoneSwitch } from "@/components/on-call/call/hospital-phone-switch";
import { OnCallIsobarRow } from "@/components/on-call/call/isobar-card";
import {
  onCallActionLink,
  onCallBadge,
  onCallChipShape,
  onCallChipTap,
  onCallLeadingIcon,
} from "@/components/on-call/kit/calm";
import { OnCallDialRow, toHandbookDial } from "@/components/on-call/kit/dial-row";
import { OnCallGroupedList, OnCallRow } from "@/components/on-call/kit/grouped-list";
import { OnCallHandbookState } from "@/components/on-call/kit/handbook-state";
import { OnCallHospitalLine } from "@/components/on-call/kit/hospital-line";
import { OnCallHubPageFrame } from "@/components/on-call/kit/hub-page-frame";
import { modeInsetHairline, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeSecondaryText } from "@/components/mode-kit/type";
import { onCallGroupAnchorId } from "@/components/on-call/on-call-page-anchors";
import { useHospitalHandbook, type HospitalHandbookState } from "@/components/on-call/use-hospital-handbook";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SearchField } from "@/components/ui/text-field";
import { cn } from "@/components/ui-primitives";
import { RosterWhosOnEntryLink } from "@/components/on-call/roster-whos-on/roster-whos-on-entry-link";
import { NewWorkModeOnly } from "@/components/work-mode-launch/work-mode-launch-provider";
import { onCallDetailsSchemaFor, type OnCallEntry } from "@/lib/on-call/entry-model";
import { searchOnCallEntries } from "@/lib/on-call/entry-search";
import { cacheOnCallEntries, useOnCallEntries } from "@/lib/on-call/entry-store";
import { pinnedEmergencyEntries, type HandbookItem } from "@/lib/on-call/handbook-items";
import { searchHandbookItems } from "@/lib/on-call/handbook-search";
import { msUntilOnCallPeriodChange, resolveOnCallNumber, type HandbookDial } from "@/lib/on-call/number-resolver";
import { buildOnCallReviewQueue } from "@/lib/on-call/review-queue";
import { partitionContactsEntries } from "@/lib/on-call/who-is-who";
import { zonedTimeOf } from "@/lib/work-time/format";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";

/** The entry editor loads only when "Add your own number" is tapped, so People's first paint does not carry it. */
const OnCallEntryEditor = dynamic(
  () => import("@/components/on-call/on-call-entry-editor").then((module) => module.OnCallEntryEditor),
  { ssr: false },
);

/** About eight or nine rows fit a phone before "Show all" (standard §4). */
const ROWS_BEFORE_SHOW_ALL = 8;

/** The call log moved from this page to a "Log a call" sheet on Now; old links still carry this hash. */
export const ON_CALL_OLD_CALL_LOG_HASH = "#on-call-call-log-heading";
export const ON_CALL_LOG_A_CALL_PATH = "/on-call#log-a-call";
/** The handover builder moved to its own page; My Day's Handover link still carries this hash. */
export const ON_CALL_OLD_HANDOVER_HASH = "#on-call-handover-heading";

const noSubscription = () => () => {};

type PeopleTab = "hospital" | "outside" | "mine";

const PEOPLE_TABS: readonly { value: PeopleTab; label: string }[] = [
  { value: "hospital", label: "Hospital" },
  { value: "outside", label: "Outside lines" },
  { value: "mine", label: "Mine" },
];

function hospitalName(handbook: HospitalHandbookState): string | null {
  return handbook.siteName ?? handbook.serviceName;
}

/** The fallback a "Didn't connect" sheet offers, and whether this phone is a hospital phone. */
type Fallback = {
  readonly item: HandbookItem | null;
  readonly dial: HandbookDial | null;
  readonly hospitalPhone: boolean;
};

const phoneSwitchInSheet = (on: boolean) => <OnCallHospitalPhoneSwitch on={on} testId="on-call-hospital-phone-sheet" />;

/** A row's leading mark: its short badge when the label carries one, a shield on emergency rows, else a phone. */
function rowLeading(item: HandbookItem, emergencyGroup: boolean): ReactNode {
  if (emergencyGroup) return <Shield aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />;
  const badge = onCallRowBadge(item);
  if (badge) return <span className={onCallBadge}>{badge}</span>;
  return <Phone aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />;
}

function HandbookCallRow({
  item,
  handbook,
  pinned,
  emergencyGroup,
  hospitalPhone,
  fallback,
}: {
  readonly item: HandbookItem;
  readonly handbook: HospitalHandbookState;
  readonly pinned: boolean;
  readonly emergencyGroup: boolean;
  readonly hospitalPhone: boolean;
  readonly fallback: Fallback;
}) {
  const didntConnectAt = useOnCallDidntConnectAt(item.id);
  const name = hospitalName(handbook);
  return (
    <OnCallDidntConnect
      id={item.id}
      title={item.parsed.label}
      report={handbook}
      switchboard={fallback.item}
      switchboardDial={fallback.dial}
      hospitalPhone={fallback.hospitalPhone}
      hospitalName={name}
    >
      <OnCallDialRow
        id={item.id}
        source="handbook"
        title={item.parsed.label}
        dial={item.dial}
        leading={rowLeading(item, emergencyGroup)}
        hospitalPhone={hospitalPhone}
        hospitalPhoneSwitch={phoneSwitchInSheet(hospitalPhone)}
        mobileDial={item.mobileDial}
        state={didntConnectAt ? { kind: "didnt-connect", at: didntConnectAt } : null}
        updatedAt={item.updatedAt}
        lastConfirmedAt={item.lastConfirmedAt}
        sources={item.sources}
        tone={pinned ? "emergency" : "default"}
        hospitalName={name}
        testId={`on-call-call-row-${item.id}`}
      />
    </OnCallDidntConnect>
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
  const total = group.items.length;
  const limited = !searching && !showAll && total > ROWS_BEFORE_SHOW_ALL + 1;
  const visible = limited ? group.items.slice(0, ROWS_BEFORE_SHOW_ALL) : group.items;
  return (
    <OnCallGroupedList
      eyebrow={group.label}
      count={limited ? `${visible.length} of ${total}` : total}
      action={
        limited
          ? {
              label: "Show all",
              ariaLabel: `Show all ${total} in ${group.label}`,
              onClick: () => setShowAll(true),
              testId: `on-call-call-group-${group.slug}-show-all`,
            }
          : undefined
      }
      id={onCallGroupAnchorId(group.slug)}
      testId={`on-call-call-group-${group.slug}`}
    >
      {children(visible)}
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
    <OnCallDidntConnect
      id={entry.id}
      title={entry.title}
      report={null}
      switchboard={fallback.item}
      switchboardDial={fallback.dial}
      hospitalPhone={fallback.hospitalPhone}
      hospitalName={name}
    >
      <OnCallDialRow
        id={entry.id}
        source="entry"
        title={entry.title}
        subtitle={entry.subtitle ?? undefined}
        dial={dial}
        hospitalPhone={hospitalPhone}
        hospitalPhoneSwitch={phoneSwitchInSheet(hospitalPhone)}
        numberLabel={resolved?.label}
        state={didntConnectAt ? { kind: "didnt-connect", at: didntConnectAt } : dial ? null : { kind: "not-recorded" }}
        testId={`on-call-call-mine-${entry.id}`}
      />
    </OnCallDidntConnect>
  );
}

/**
 * People (mock-up v10 s-2): every number the reader may need tonight, in one
 * searchable list.
 *
 * Search comes first, then the Hospital / Outside lines / Mine switch and the
 * department jump chips, because on this page the reader already knows who
 * they want. There is no summary card.
 *
 * - **Hospital**: the hospital's published numbers, Emergency first, then the
 *   cover on now, then each team, then Wards and General.
 * - **Outside lines**: the app's own sourced public lines, each with its area,
 *   source and date.
 * - **Mine**: the reader's own numbers, and the way to their editor.
 *
 * One search box searches all three at once; the query never leaves the page
 * (Global Constraint 7). "Didn't connect" is marked from a number's own sheet,
 * and shows under the row as a state. The crisis lines show whenever the
 * hospital's numbers are not on screen. The call log and handover builder
 * live in Now's "Log a call" sheet; the old link to them is sent on there.
 */
export function OnCallCallPage() {
  const { zone } = useWorkTimeZone();
  const router = useRouter();
  const account = useOptionalAccountData();
  const handbook = useHospitalHandbook();
  const hospitalNow = useHospitalClock();
  const entries = useOnCallEntries();
  const hospitalPhone = useOnCallHospitalPhone();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<PeopleTab>("hospital");
  const [adding, setAdding] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  // The time in "Cover as of 21:40" is drawn after hydration only, so the server's minute never mismatches the phone's.
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

  // The call log moved to Now and the handover to its own page. A saved or My
  // Day link to either old heading here goes straight on, keeping its query string.
  useEffect(() => {
    if (window.location.hash === ON_CALL_OLD_HANDOVER_HASH) {
      router.replace(`/on-call/handover${window.location.search}`);
      return;
    }
    if (window.location.hash !== ON_CALL_OLD_CALL_LOG_HASH) return;
    const [path, hash] = ON_CALL_LOG_A_CALL_PATH.split("#");
    router.replace(`${path}${window.location.search}#${hash}`);
  }, [router]);

  // Re-read the clock when the in-hours period starts or ends (holidays count),
  // so a page left open shows your own numbers on the right daytime or after-hours line.
  useEffect(() => {
    const timer = window.setTimeout(() => setClock(new Date()), msUntilOnCallPeriodChange(clock, zone));
    return () => window.clearTimeout(timer);
  }, [clock, zone]);
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

  const signedOut = entries.signedOut || handbook.status === "signed-out";
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

  // "Numbers to check" counts exactly what the Check these page lists, and only
  // once the reader's entries have loaded: a failed load never reads as "none".
  const checkQueue = useMemo(() => buildOnCallReviewQueue(entries.entries, clock), [entries.entries, clock]);
  const checkCountKnown =
    !entries.loading && !signedOut && !entries.sample && entries.loadError === null && checkQueue.assessed > 0;

  const hospitalCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  const resultCount = cover.length + hospitalCount + external.length + (signedOut ? 0 : mine.length);

  const showHospital = searching || tab === "hospital";
  const showOutside = searching || tab === "outside";
  const showMine = searching ? !signedOut && mine.length > 0 : tab === "mine";
  // The crisis lines show whenever the hospital's numbers are not on screen,
  // unless the Outside lines list (which holds them) already is.
  const showCrisis = !showOutside && (!ready || tab === "mine" || hospitalCount + cover.length === 0);

  const canAdd = Boolean(account?.isAuthenticated) && !signedOut && !entries.demoMode;

  const coverGroup =
    cover.length > 0 ? (
      <OnCallGroupedList
        eyebrow="Cover"
        count={cover.length}
        note={hydrated ? `Cover as of ${zonedTimeOf(hospitalNow, zone)}` : undefined}
        testId="on-call-call-cover"
      >
        {cover.map((item) => (
          <OnCallDialRow
            key={item.id}
            id={item.id}
            source="handbook"
            title={item.parsed.label}
            subtitle={`${item.cover?.team ?? ""} · ${item.cover?.window.start}–${item.cover?.window.end}`}
            dial={item.dial}
            leading={rowLeading(item, false)}
            hospitalPhone={hospitalPhone}
            hospitalPhoneSwitch={phoneSwitchInSheet(hospitalPhone)}
            mobileDial={item.mobileDial}
            updatedAt={item.updatedAt}
            lastConfirmedAt={item.lastConfirmedAt}
            sources={item.sources}
            hospitalName={name}
            now={hospitalNow}
            testId={`on-call-call-cover-${item.id}`}
          />
        ))}
      </OnCallGroupedList>
    ) : null;

  return (
    <OnCallHubPageFrame page="call" lead={<OnCallHospitalLine handbook={handbook} />}>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
        <div data-testid="on-call-call-search">
          <SearchField
            label="Search People"
            placeholder="Search numbers, wards, roles"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery("")}
            clearLabel="Clear the People search"
            autoComplete="off"
          />
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {searching ? `${resultCount} ${resultCount === 1 ? "result" : "results"}` : ""}
        </p>
        {searching ? null : (
          <SegmentedControl
            label="Which numbers"
            layout="equal"
            value={tab}
            onChange={setTab}
            options={PEOPLE_TABS}
            ariaControls="on-call-people-list"
          />
        )}
        {!searching && tab === "hospital" && groups.length > 1 ? (
          <nav aria-label="Departments" data-testid="on-call-call-departments">
            <ul
              data-no-tab-swipe
              className="-mx-3 flex min-w-0 gap-2 overflow-x-auto px-3 [-webkit-overflow-scrolling:touch]"
            >
              {groups.map((group) => (
                <li key={group.slug} className="shrink-0">
                  <a
                    href={`#${onCallGroupAnchorId(group.slug)}`}
                    className={cn(onCallChipTap, focusRing, "rounded-md no-underline")}
                  >
                    <span className={onCallChipShape}>{group.chip}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>

      <OnCallHandbookState handbook={handbook} page="call" />
      {showCrisis ? <OnCallCrisisLines /> : null}

      <div id="on-call-people-list" className="grid min-w-0 gap-5">
        {searching && resultCount === 0 ? (
          <p className={cn(modeSecondaryText, "break-words px-3")} data-testid="on-call-call-nothing-found">
            {`Nothing matches "${query.trim()}".`}
            {ready ? "" : " The hospital's numbers have not loaded, so only outside lines and your own were searched."}
          </p>
        ) : null}

        {showHospital && ready && !searching ? <OnCallHospitalPhoneSwitch on={hospitalPhone} /> : null}

        {showHospital && ready && hospitalCount + cover.length > 0 ? (
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
                        emergencyGroup={group.kind === "emergency"}
                        hospitalPhone={hospitalPhone}
                        fallback={fallback}
                      />
                    ))
                  }
                </HospitalGroup>
                {/* Emergency stays first; the cover on now follows it, or leads when there is no Emergency group. */}
                {index === 0 && group.kind === "emergency" ? coverGroup : null}
              </div>
            ))}
            {groups[0]?.kind === "emergency" ? null : coverGroup}
          </div>
        ) : null}

        {showOutside && external.length > 0 ? (
          <OnCallGroupedList
            eyebrow="Outside lines"
            count={external.length}
            id={onCallGroupAnchorId("external")}
            testId="on-call-call-external"
          >
            <OnCallExternalLineRows
              lines={external}
              testIdPrefix="on-call-call-external"
              wrapRow={(line, row) => (
                <OnCallDidntConnect
                  key={line.id}
                  id={line.id}
                  title={line.title}
                  report={null}
                  switchboard={fallback.item}
                  switchboardDial={fallback.dial}
                  hospitalPhone={fallback.hospitalPhone}
                  hospitalName={name}
                >
                  {row}
                </OnCallDidntConnect>
              )}
            />
          </OnCallGroupedList>
        ) : null}

        {showMine ? (
          <OnCallGroupedList
            eyebrow="Mine"
            count={signedOut ? undefined : mine.length}
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
              <li className={cn(modeInsetHairline, modeRowHeight.single, "flex min-w-0 items-center px-3")}>
                <span className={cn(modeSecondaryText, "break-words")}>Sign in to keep your own numbers.</span>
              </li>
            ) : null}
            {/* A literal next/link href: route-reachability counts only those. */}
            <OnCallRow href="/on-call/contacts" title="Your own numbers" testId="on-call-call-mine-link" />
          </OnCallGroupedList>
        ) : null}
      </div>

      {searching ? null : (
        <div className="grid min-w-0 gap-4" data-testid="on-call-call-more">
          {/* Who is on from the team's published roster: a new work mode screen. */}
          <NewWorkModeOnly>
            <RosterWhosOnEntryLink />
          </NewWorkModeOnly>
          <ul role="list" className="work-card min-w-0">
            <OnCallIsobarRow />
            <OnCallRow
              href="/on-call/who-is-who"
              title="Who's who"
              subtitle="What the short role names mean"
              leading={<Users aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />}
              testId="on-call-call-whos-who"
            />
            <OnCallRow
              href="/on-call/card"
              title="Pocket card"
              subtitle="The numbers flagged for it, to print"
              leading={<Printer aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />}
              testId="on-call-call-pocket-card"
            />
            <OnCallRow
              href="/on-call/check"
              title="Numbers to check"
              subtitle={
                checkCountKnown
                  ? checkQueue.total > 0
                    ? `${checkQueue.total} due for a check`
                    : "None due for a check"
                  : undefined
              }
              leading={<ListChecks aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />}
              testId="on-call-call-check"
            />
          </ul>
          <div className="flex justify-center">
            {canAdd ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className={cn(onCallActionLink, focusRing, "gap-1.5 text-base-minus")}
                data-testid="on-call-call-add"
              >
                <Plus aria-hidden="true" className="size-icon-sm" />
                Add your own number
              </button>
            ) : (
              <Link
                href="/on-call/contacts"
                className={cn(onCallActionLink, focusRing, "gap-1.5 text-base-minus")}
                data-testid="on-call-call-add"
              >
                <Plus aria-hidden="true" className="size-icon-sm" />
                Add your own number
              </Link>
            )}
          </div>
          {canAdd ? (
            <p className={cn(modeSecondaryText, "px-3 text-center text-xs")} data-testid="on-call-call-saved-note">
              Your own numbers are saved to your account.
            </p>
          ) : null}
        </div>
      )}

      {canAdd && adding ? (
        <OnCallEntryEditor
          open
          onClose={() => setAdding(false)}
          section="contacts"
          entry={null}
          onSaved={(saved) =>
            cacheOnCallEntries(
              entries.entries.some((existing) => existing.id === saved.id)
                ? entries.entries.map((existing) => (existing.id === saved.id ? saved : existing))
                : [...entries.entries, saved],
            )
          }
        />
      ) : null}
    </OnCallHubPageFrame>
  );
}
