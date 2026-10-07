"use client";

import { focusOnCallEntryFromHash } from "@/components/on-call/on-call-page-anchors";

import { Plus } from "lucide-react";
import dynamic from "next/dynamic";

import { useEffect, useMemo, useState } from "react";

import { useAccountData } from "@/components/account-data-provider";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { InformationPageShell } from "@/components/information-page-shell";
import { OnCallComplianceSection } from "@/components/on-call/on-call-compliance-section";
import { OnCallContactsSection, type OnCallContactsOrder } from "@/components/on-call/on-call-contacts-section";
import { OnCallEducationSection } from "@/components/on-call/on-call-education-section";
import { OnCallLogisticsSection } from "@/components/on-call/on-call-logistics-section";
import { OnCallOrientationSection } from "@/components/on-call/on-call-orientation-section";
import { HospitalLadders } from "@/components/on-call/hospital-ladders";
import { OnCallPlaybookSection } from "@/components/on-call/on-call-playbook-section";
import { OnCallReferralsSection } from "@/components/on-call/on-call-referrals-section";
import { OnCallWhoIsWhoSection } from "@/components/on-call/on-call-who-is-who-section";
import {
  ON_CALL_VIEW_ICONS,
  ON_CALL_VIEW_TITLES,
  type OnCallPageView,
} from "@/components/on-call/on-call-section-identity";
import { onCallViewStorageSection } from "@/components/on-call/on-call-entry-view";
import { OnCallLoadFailed } from "@/components/on-call/on-call-load-failed";
import { OnCallOfflineBanner } from "@/components/on-call/on-call-offline-banner";
import { OnCallPageMenu } from "@/components/on-call/on-call-page-menu";
import { OnCallSectionNavHeader } from "@/components/on-call/on-call-nav-header";
import { OnCallSignedOut } from "@/components/on-call/on-call-signed-out";
import { OnCallTeachingStrip } from "@/components/on-call/on-call-teaching-strip";
import { onCallPageSections } from "@/components/on-call/on-call-page-sections";
import { OnCallEmptyState } from "@/components/on-call/kit/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";
import { cacheOnCallEntries, useOnCallEntries } from "@/lib/on-call/entry-store";
import { useOnCallLinkedDocumentsState } from "@/lib/on-call/linked-documents";
import { onCallEntryFreshness, type OnCallEntry, onCallEntryIsEditable } from "@/lib/on-call/entry-model";
import { onCallLocalDateKey } from "@/lib/on-call/local-date";
import { recordOnCallRecent } from "@/lib/on-call/recent-storage";
import { selectUpcomingTeachingSessions } from "@/lib/on-call/teaching-schedule";
import { partitionLogisticsEntries } from "@/lib/on-call/compliance";
import { partitionContactsEntries } from "@/lib/on-call/who-is-who";
import { isAdminWorkforceExplainer } from "@/lib/admin/placement";

/**
 * The entry editor loads on the first Add or Edit tap and then stays mounted,
 * so a section's first paint does not carry it and its close animation still runs.
 */
const OnCallEntryEditor = dynamic(
  () => import("@/components/on-call/on-call-entry-editor").then((module) => module.OnCallEntryEditor),
  { ssr: false },
);

/**
 * Generic, non-owner-specific framing for each view. Shown to every reader,
 * signed in or not, above the entries.
 */
const ON_CALL_VIEW_DESCRIPTIONS: Record<OnCallPageView, string> = {
  contacts:
    "Filed by role first — an after-hours registrar, Ward 4B — so an entry survives a rotation rather than leaving with the person who held it.",
  playbook:
    "The escalation ladder as plain administrative fact. Clinical guidance appears only as a link to one of your own uploaded documents.",
  referrals:
    "Your own referral list: who a service accepts, exclusions, catchment, hours, how to refer, and the number to ring.",
  orientation:
    "Manuals held as documents in your corpus, filed into folders, each optionally carrying your own pinned summary above it.",
  education: "The teaching calendar — what, when, who is presenting, and a link to the recording once one exists.",
  // Leads with the work admin, because that is what this section now holds.
  // Facilities is kept and named last rather than dropped: the rooms-and-food
  // entries that were the whole of the old Logistics section are still here,
  // and a summary that stopped mentioning them would read as if they had gone.
  logistics:
    "The work admin you do for yourself — leave, rosters, pay, forms and access — and the facilities detail worth writing down.",
  "who-is-who":
    "What each role actually does, and when it is reasonable to call them. The ladder in words, and the acronyms this service uses.",
  // Says what the page is and what it is not, in one breath. Nothing here is
  // checked with an issuing body, so the summary may not imply it is — the
  // same rule the page body and `src/lib/on-call/compliance.ts` both carry.
  compliance:
    "What you keep current — registration, indemnity, credentialing, training — grouped by what happens if it lapses. Your own recorded dates, never a check with the issuing body.",
};

/**
 * The entries a view actually puts on screen.
 *
 * Four of the nine views are half a stored section, not a whole one. `section`
 * is a database CHECK constraint, so a new value costs a migration that reaches
 * the live clinical database within seconds; two pairs of views therefore share
 * one section and split it on `details.kind` instead — Contacts with Who's who
 * over `contacts`, and Admin with Compliance over `logistics`.
 *
 * A plain `entry.section === view` test is wrong for all four. On the counts it
 * merely inflates a number. On `staleEntries` it is worse than that: it would
 * let "mark all as still correct" on the Admin page stamp today onto compliance
 * requirements the reader cannot see from there — a bulk write over rows that
 * are not on the screen, and on precisely the rows where a date nobody has
 * looked at is the hazard the Compliance page exists to surface.
 *
 * The two partition helpers are the single place each split is made, so this
 * defers to them rather than re-deriving either rule.
 */
function onCallVisibleEntries(view: OnCallPageView, entries: readonly OnCallEntry[]): OnCallEntry[] {
  switch (view) {
    case "contacts":
      return partitionContactsEntries(entries).contacts;
    case "who-is-who":
      return partitionContactsEntries(entries).roleExplainers;
    case "logistics":
      return partitionLogisticsEntries(entries).admin;
    case "compliance":
      return partitionLogisticsEntries(entries).compliance;
    // Playbook, Referrals, Orientation and Teaching each own a whole section,
    // so for them the view id IS the section id.
    default:
      return entries.filter((entry) => entry.section === view);
  }
}

/** What one entry in each view is called, for the add control's label. */
const ON_CALL_ADD_NOUN: Record<OnCallPageView, string> = {
  contacts: "contact",
  playbook: "scenario",
  referrals: "service",
  orientation: "manual",
  education: "session",
  // "entry", not "note": this section stopped being a shelf of jotted site
  // detail when it became Admin. A leave application or a pay query is a thing
  // you file, and "Add note" invited the wrong kind of content into it.
  logistics: "entry",
  "who-is-who": "role",
  compliance: "requirement",
};

/**
 * The line under the add control, per view — and absent on the views that have
 * nothing of their own to say there.
 *
 * "Role first, name only if you must." used to render under EVERY add control
 * in the mode, because the menu hard-coded it. On Compliance the sheet
 * therefore read "Add requirement / Role first, name only if you must." —
 * advice about how to name other people, on the page holding your own
 * registration and indemnity. It was no better on Orientation or Teaching; it
 * was simply least obviously wrong there.
 *
 * So the hint is per view and the map is deliberately partial: a view earns a
 * line by having one worth reading, and a view with nothing to add renders no
 * second line rather than a padded one. `Partial` rather than a full record
 * with empty strings, so "no hint" is a missing key and cannot be mistaken for
 * a string somebody forgot to write.
 *
 * Compliance's line names the three fields that decide how its row reads and
 * where it sorts. It describes what the editor will ask for and nothing else:
 * "the expiry date you have" is the date the holder is about to type, never a
 * claim that the app knows it — the same rule
 * `src/lib/on-call/compliance.ts` states for every string on that page.
 */
const ON_CALL_ADD_HINT: Partial<Record<OnCallPageView, string>> = {
  contacts: "Role first, name only if you must.",
  compliance: "The expiry date you have, who issues it, and what lapsing would cost.",
};

/**
 * The one module every On Call view route renders, following
 * `src/components/sources/sources-pages.tsx`'s factoring: peer surfaces off one
 * shared shape, so seven pages cannot drift into seven divergent shells.
 *
 * Navigation is the shared `ModeNav` rail, mounted here by the page rather than
 * by the shell. That is deliberate and is the fix for the reason On Call's
 * destinations were deleted once: every route in this mode is an
 * `isInformationPage`, so `PageSecondaryNavigation` returns null before it ever
 * reaches the mode branch and the shell can never draw this mode's bar. A page
 * that owns its own header navigation mounts it itself —
 * `differential-presentation-workflow-page.tsx` does exactly this with the same
 * component — and `hasLocalInformationPageNavigation` then guarantees the shell
 * adds no second bar. Being an information page is also what keeps the search
 * composer off these routes, so the two facts are the same fact.
 *
 * Reading needs an account. The 2026-09-04 owner decision opened shared entries
 * to anonymous callers; the 2026-09-26 decision reverses that, so the server
 * answers a signed-out caller with no entries and this page shows
 * `OnCallSignedOut` in place of the list — unless the reader is looking at the
 * on-device example preview, which needs no account. A signed-in reader sees
 * every account's shared entries, minus what the shared read never returns:
 * another owner's personal entries, their Teaching entries, and the contact
 * names on their contacts. The add, edit and verify controls below are gated on
 * `isAuthenticated`, because their routes require one.
 */
export function OnCallSectionPage({ view }: { view: OnCallPageView }) {
  const { isAuthenticated } = useAccountData();
  const [editorState, setEditorState] = useState<{ open: boolean; entry: OnCallEntry | null }>({
    open: false,
    entry: null,
  });
  const [editorMounted, setEditorMounted] = useState(false);
  if (editorState.open && !editorMounted) setEditorMounted(true);
  // The page menu's order control lives in the header portal and the list it
  // orders lives in the body, so the state belongs to their common parent
  // rather than to either of them.
  const [contactsOrder, setContactsOrder] = useState<OnCallContactsOrder>("area");
  const [verifyAllState, setVerifyAllState] = useState<{ running: boolean; error: string | null }>({
    running: false,
    error: null,
  });
  const title = ON_CALL_VIEW_TITLES[view];
  const Icon = ON_CALL_VIEW_ICONS[view];
  const { entries, loading, isOffline, loadError, retry, cachedAt, signedOut, demoMode } = useOnCallEntries();
  // Example rows are never writable: the store already refuses to cache them,
  // and this keeps the server calls unreachable too.
  const canWrite = isAuthenticated && !demoMode;
  // Each list component filters `entries` itself — by section, and for the two
  // contacts-backed views by `details.kind` as well — so the page hands over the
  // whole set rather than seven near-identical slices. The one exception:
  // medical-workforce role explainers moved to Admin > Help > Contacts (Admin
  // update 1), so Who's who no longer lists them.
  const sectionEntries = useMemo(
    () => (view === "who-is-who" ? entries.filter((entry) => !isAdminWorkforceExplainer(entry)) : entries),
    [view, entries],
  );
  useEffect(() => {
    focusOnCallEntryFromHash();
    window.addEventListener("hashchange", focusOnCallEntryFromHash);
    return () => window.removeEventListener("hashchange", focusOnCallEntryFromHash);
  }, [view, entries]);
  const sourceIds =
    view === "playbook" || view === "orientation"
      ? entries.filter((entry) => entry.section === view).flatMap((entry) => entry.linkedDocumentIds)
      : [];
  const { documents: linkedDocuments, loading: linkedDocumentsLoading } = useOnCallLinkedDocumentsState(sourceIds);
  // The page's own groups, for the header's jump list. Declared from the same
  // entries the list below renders, then narrowed to whichever anchors actually
  // appear — so a flat page resolves to none and the header is just a title.
  const pageSections = useMemo(
    () =>
      onCallPageSections({ view, entries: sectionEntries, linkedDocumentIds: new Set(Object.keys(linkedDocuments)) }),
    [view, sectionEntries, linkedDocuments],
  );
  // What this page is actually showing — the menu's one-line summary counts
  // it, and "mark all as still correct" writes to it.
  const visibleEntries = onCallVisibleEntries(view, sectionEntries);
  const visibleCount = visibleEntries.length;
  // "Coming up", moved here from the mode home when Now dropped it (plan C25).
  // `selectUpcomingTeachingSessions` rolls a recurring session forward from its
  // anchor rather than letting it vanish the afternoon its date passes.
  const upcomingTeaching = useMemo(
    () => (view === "education" ? selectUpcomingTeachingSessions(entries, onCallLocalDateKey(new Date())) : []),
    [view, entries],
  );

  // Overdue entries in THIS view, which is what "mark all as still correct"
  // may stamp. Never the whole hub, and never the other half of a split
  // section: a bulk write is only defensible when the reader can see
  // everything it touches, which is exactly what `onCallVisibleEntries`
  // returns.
  // Only rows this reader owns: the verify route refuses anyone else's, and
  // the bulk loop used to stop at the first shared row it met.
  const staleEntries = visibleEntries.filter(
    (entry) => onCallEntryIsEditable(entry) && onCallEntryFreshness(entry).state === "stale",
  );

  /**
   * Whether this view offers the bulk "mark all as still correct" control at
   * all. Compliance does not, and that is a governance decision rather than a
   * layout one.
   *
   * Everywhere else in On Call the freshness stamp and the content are the
   * same thing: "is this ward number still right?" is a question the person
   * tapping can actually answer from where they are sitting, so stamping the
   * handful of overdue rows at once costs nothing but taps.
   *
   * On Compliance the two come apart. The stamp is about the RECORD — when a
   * human last looked at the row — while the question the reader actually has
   * is about the REQUIREMENT, and nothing on that page has been checked with
   * the body that issues it. One tap, with no confirmation, would clear the
   * "Never checked" warning off every unrecorded requirement on the page for
   * twelve months, without the reader having read any of them. That is a bulk
   * assertion about a doctor's registration, indemnity and clearances, and no
   * saved tap is worth it.
   *
   * The per-row control stays: it is the same act, made one row at a time,
   * with the row's own subject in front of the person doing it.
   *
   * Gated here rather than inside the menu because every other view-by-view
   * decision in this mode is made here too — `onCallVisibleEntries`, the add
   * noun, the add hint — and the menu stays a renderer of the rows it is
   * handed.
   */
  const offersBulkVerify = view !== "compliance";

  /**
   * Stamp today on every overdue entry in this view.
   *
   * One request per entry through the existing per-entry endpoint, in series,
   * rather than a new bulk route. `repository.ts` is in neither the owner-scope
   * API sweep nor the tenancy scan (a known blind spot, recorded for change B),
   * so adding a route that writes many rows at once would land the widest write
   * in the mode exactly where neither gate looks. The reviewed single-entry
   * route already owns the ownership check, and doing it a handful of times is
   * the cheap, safe version of the same action — the list is the OVERDUE
   * entries, which is a handful, not the whole section.
   *
   * The results accumulate in ONE list that is written to the cache once. The
   * obvious version — calling `upsertCachedEntry` per iteration — is wrong and
   * silently so: `entries` is the snapshot from the render that started the
   * run, and `cacheOnCallEntries` overwrites the whole cache rather than
   * merging, so every iteration would rebuild the list from that same stale
   * snapshot and discard the one before it. Three successful confirmations
   * would leave two rows still sitting under "Needs checking" until a reload,
   * which is the worst possible outcome for this particular action: the write
   * happened and the page says it did not.
   *
   * A failure stops the run and says so, keeping whatever was confirmed before
   * it. Half a stamp reported as a success is the other way to make a stale
   * number look checked.
   */
  async function verifyAllStale() {
    setVerifyAllState({ running: true, error: null });
    let working = [...entries];
    const commit = () => cacheOnCallEntries(working);

    for (const entry of staleEntries) {
      try {
        const response = await fetch(`/api/on-call/entries/${entry.id}/verify`, { method: "POST" });
        if (!response.ok) throw new Error(`Could not confirm ${entry.title}.`);
        const payload: unknown = await response.json();
        const updated = (payload as { entry?: OnCallEntry } | null)?.entry;
        if (updated) {
          working = working.some((existing) => existing.id === updated.id)
            ? working.map((existing) => (existing.id === updated.id ? updated : existing))
            : [...working, updated];
        }
      } catch (error) {
        commit();
        const isOfflineError =
          (typeof navigator !== "undefined" && !navigator.onLine) ||
          (error instanceof TypeError && error.message.includes("fetch"));
        setVerifyAllState({
          running: false,
          error: isOfflineError
            ? "You are offline. Connect to confirm entries."
            : error instanceof Error
              ? error.message
              : "Could not confirm these entries.",
        });
        return;
      }
    }

    commit();
    setVerifyAllState({ running: false, error: null });
  }

  function upsertCachedEntry(entry: OnCallEntry) {
    const next = entries.some((existing) => existing.id === entry.id)
      ? entries.map((existing) => (existing.id === entry.id ? entry : existing))
      : [...entries, entry];
    cacheOnCallEntries(next);
  }

  function removeCachedEntry(id: string) {
    cacheOnCallEntries(entries.filter((existing) => existing.id !== id));
  }

  // Writing needs an account, and so does reading anything but the preview. Each list component drops
  // its own edit and verify affordances when these are undefined, so a
  // signed-out reader is offered nothing the API would answer with a 401.
  const listProps = {
    entries: sectionEntries,
    onEditEntry: canWrite
      ? (entry: OnCallEntry) => {
          recordOnCallRecent({ id: entry.id, title: entry.title });
          setEditorState({ open: true, entry });
        }
      : undefined,
    onVerified: canWrite ? upsertCachedEntry : undefined,
  };

  /**
   * The one place a view id becomes a list component. The switch has no
   * `default`, so `OnCallPageView` gaining a member is a compile error here
   * rather than a page that silently renders nothing — which is exactly how five
   * of the six sections went unmounted in the first place.
   */
  function renderSectionList() {
    switch (view) {
      case "contacts":
        return (
          <OnCallContactsSection
            {...listProps}
            order={contactsOrder}
            onAddEntry={canWrite ? () => setEditorState({ open: true, entry: null }) : undefined}
          />
        );
      case "playbook":
        return (
          <>
            <OnCallPlaybookSection
              {...listProps}
              documents={linkedDocuments}
              documentsLoading={linkedDocumentsLoading}
            />
          </>
        );
      case "referrals":
        return <OnCallReferralsSection {...listProps} />;
      case "orientation":
        return (
          <OnCallOrientationSection
            {...listProps}
            documents={linkedDocuments}
            documentsLoading={linkedDocumentsLoading}
          />
        );
      case "education":
        return <OnCallEducationSection {...listProps} />;
      case "logistics":
        return <OnCallLogisticsSection {...listProps} />;
      case "who-is-who":
        return <OnCallWhoIsWhoSection {...listProps} />;
      case "compliance":
        return <OnCallComplianceSection {...listProps} />;
    }
  }

  return (
    <>
      {/* The section bar is only the page's own groups. Page tools (add, bulk
          verify, pocket card, order) live in-page beside the list, not in the
          universal header — that trailing slot is Search my work, and on the
          home a Needs you bell. */}
      <OnCallSectionNavHeader title={title} sections={pageSections} />
      <InformationPageShell testId={`on-call-${view}-main`}>
        {/* No hero above the list.
            ---------------------------------------------------------------
            This page used to open with an eyebrow reading "On Call", a
            display-size "Contacts", and three lines explaining how the section
            is filed — under a sticky header already saying "Contacts", under a
            mode pill already saying "On Call". On a 390px screen that was most
            of the first view spent on words the reader had just read twice.

            So the name is carried by the header alone and the explanation
            moved into the actions sheet, where a thing you read once belongs.
            The `<h1>` stays for the document outline and for a screen reader;
            it simply is not painted. */}
        <h1 className="sr-only">{title}</h1>
        {view === "playbook" ? <HospitalLadders /> : null}

        {upcomingTeaching.length > 0 ? (
          <section data-testid="on-call-home-upcoming" aria-label="Coming up">
            <OnCallTeachingStrip sessions={upcomingTeaching} />
          </section>
        ) : null}

        <section
          id={`on-call-${view}-entries`}
          className={cn(inPageAnchor, "grid grid-cols-[minmax(0,1fr)] gap-3")}
          aria-labelledby={`on-call-${view}-entries-heading`}
        >
          {/* Named for a screen reader, not painted a third time. The sticky
              header above says "Contacts" and the hero says it again with the
              eyebrow and the description; a third visible copy immediately below
              them was just noise on a 390px screen. The heading still exists and
              still labels this region, so the landmark and the heading outline
              are unchanged. */}
          <h2 id={`on-call-${view}-entries-heading`} className="sr-only">
            {title}
          </h2>
          <div className="flex flex-wrap items-center justify-end gap-2 empty:hidden">
            {/* Contacts carries its own add button inside its list component
                (it also appears in that section's empty state). The others get
                it here, because without one an owner can reach an empty
                Playbook or Logistics page with no way to put anything on it. */}
            {canWrite && view !== "contacts" ? (
              <Button
                variant="secondary"
                size="sm"
                icon={Plus}
                onClick={() => setEditorState({ open: true, entry: null })}
                testId={`on-call-${view}-add`}
              >
                {`Add ${ON_CALL_ADD_NOUN[view]}`}
              </Button>
            ) : null}
            <OnCallPageMenu
              view={view}
              entryCount={visibleCount}
              summary={`${visibleCount} ${visibleCount === 1 ? "entry" : "entries"}. ${ON_CALL_VIEW_DESCRIPTIONS[view]}`}
              order={view === "contacts" ? contactsOrder : undefined}
              onOrderChange={view === "contacts" ? setContactsOrder : undefined}
              onAdd={canWrite ? () => setEditorState({ open: true, entry: null }) : undefined}
              addLabel={`Add ${ON_CALL_ADD_NOUN[view]}`}
              addHint={ON_CALL_ADD_HINT[view]}
              onVerifyAll={offersBulkVerify && canWrite && !verifyAllState.running ? verifyAllStale : undefined}
              staleCount={offersBulkVerify ? staleEntries.length : 0}
            />
          </div>
          {isOffline && cachedAt ? <OnCallOfflineBanner savedAt={cachedAt} reason={loadError} /> : null}
          {verifyAllState.error ? (
            <p role="alert" className="text-sm font-semibold text-[color:var(--danger)]">
              {verifyAllState.error}
            </p>
          ) : null}
          {loading && entries.length === 0 ? (
            // Nothing cached and the first fetch still running. An empty state
            // here would assert the section holds nothing before anything has
            // been read.
            <OnCallEmptyState
              icon={Icon}
              title={`Loading ${title.toLowerCase()}`}
              body="Fetching the entries saved to this section."
              testId={`on-call-${view}-loading`}
            />
          ) : isOffline && entries.length === 0 ? (
            <OnCallLoadFailed reason={loadError} onRetry={retry} />
          ) : signedOut && entries.length === 0 ? (
            // Nothing is served to a signed-out reader, so an empty list here
            // is not an empty section. The example preview still fills it.
            <OnCallSignedOut icon={Icon} testId={`on-call-${view}-signed-out`} />
          ) : (
            renderSectionList()
          )}
        </section>
      </InformationPageShell>
      {/* One editor for every view: its field map is already keyed by section.
          Who's who writes `contacts` rows, so it hands over the storage section
          rather than the view. */}
      {editorMounted ? (
        <OnCallEntryEditor
          open={editorState.open}
          onClose={() => setEditorState({ open: false, entry: null })}
          section={onCallViewStorageSection(view)}
          entry={editorState.entry}
          onSaved={upsertCachedEntry}
          onDeleted={removeCachedEntry}
          createAsRoleExplainer={view === "who-is-who"}
          // The `logistics` mirror of the line above, and not optional polish:
          // both views that share a section save through that section, so
          // without this seed "Add requirement" on the Compliance page would
          // write an ordinary Admin row — one that disappears from the page it
          // was added on and reappears among the parking notes.
          createAsCompliance={view === "compliance"}
        />
      ) : null}
    </>
  );
}
