"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeTapArea } from "@/components/mode-kit/recipes";
import { modeHeadingText } from "@/components/mode-kit/type";
import {
  filterResources,
  resourceSections,
  resourceWriteError,
  type ResourceType,
} from "@/components/teaching/resources-model";
import { addDays, mondayOf, perthDateKey, shortDayLabel, timeRange } from "@/components/teaching/teaching-dates";
import { TeachingSwitch } from "@/components/teaching/teaching-modules";
import { withUnit } from "@/components/teaching/teaching-number";
import { AddResourceSheet, ResourceRows } from "@/components/teaching/teaching-resource-list";
import { TeachingUndoBar } from "@/components/teaching/teaching-row";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import { useDelayedPost } from "@/components/teaching/use-delayed-post";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { useTeachingWeek } from "@/components/teaching/use-teaching-week";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { cn, textMuted } from "@/components/ui-primitives";
import type { CollectionRead, ResourceRow } from "@/lib/teaching/model";
import {
  useSignedOutSampleRead,
  useTeachingDemoMode,
  useTeachingSignedOut,
} from "@/components/teaching/use-teaching-sample";

const TYPES = [
  { value: "all", label: "All" },
  { value: "recordings", label: "Recordings" },
  { value: "reading", label: "Reading" },
] as const;
const BUILT_IN_NAMES: Record<string, string> = { recordings: "Recordings", saved: "Saved" };

const itemCount = (n: number) => withUnit(n, n === 1 ? "item" : "items");

/**
 * One collection: its items grouped by section, a type switch (the type is always in words) and a filter
 * box that looks only through the list already loaded here. It sends nothing, calls no search and no AI,
 * and has no mic (standard §13).
 *
 * Adding and removing are for the organisers of the collection's own service (master plan R19): read per
 * service from the reader's teams, never from a role held elsewhere, and never for an admin who does not
 * organise, because the server refuses them. Recordings and Saved are built in and take no additions.
 */
export function TeachingCollection({
  collection,
  demoMode: serverDemoMode,
  sampleData: serverSample,
}: {
  collection: string;
  demoMode: boolean;
  sampleData?: CollectionRead;
}) {
  const demoMode = useTeachingDemoMode(serverDemoMode);
  const signedOut = useTeachingSignedOut();
  const now = useTeachingNow();
  const monday = now ? mondayOf(perthDateKey(now)) : null;
  const builtIn = collection in BUILT_IN_NAMES;
  const query = builtIn ? `builtIn=${collection}` : `collectionId=${collection}`;
  // Signed out with no server sample: build the made-up collection here, and ask the API for nothing.
  const built = useSignedOutSampleRead<CollectionRead | null>(signedOut && !serverSample, collection, async () => {
    const { demoTeachingResources } = await import("@/lib/teaching/demo-resources");
    try {
      return demoTeachingResources({
        action: "collection.read",
        ...(builtIn ? { builtIn: collection as "saved" | "recordings" } : { collectionId: collection }),
      }) as CollectionRead;
    } catch {
      return null;
    }
  });
  const sampleData = serverSample ?? built ?? undefined;
  // Demo mode reads too: the server answers with the made-up collections (master plan R8).
  const read = useTeachingResource<CollectionRead>(
    signedOut && !sampleData ? null : `/api/teaching/resources?action=collection.read&${query}`,
    sampleData,
  );
  const week = useTeachingWeek(monday ? { from: monday, to: addDays(monday, 6) } : null, { demoMode }, now);
  const [type, setType] = useState<ResourceType>("all");
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string | null>(null);
  const delayed = useDelayedPost();
  const shown = useMemo(
    () => filterResources(read.data?.items ?? [], type, filter).filter((item) => item.resourceId !== hidden),
    [read.data, type, filter, hidden],
  );

  const owner = read.data?.collection?.serviceId ?? null;
  const ownerTeam = (week.week?.teams ?? []).find((team) => team.id === owner) ?? null;
  const canEdit = !sampleData && ownerTeam?.role === "organiser";
  // Slides belong to one session (master plan R27): the owner's sessions this week are the ones offered.
  const sessions = useMemo(
    () =>
      (week.week?.sessions ?? [])
        .filter(
          (session) => session.serviceId === owner && session.source === "teaching" && session.status !== "cancelled",
        )
        .map((session) => ({
          occurrenceId: session.occurrenceId,
          label: `${shortDayLabel(perthDateKey(session.startsAt))} ${timeRange(session.startsAt, session.endsAt)} · ${session.title}`,
        })),
    [week.week, owner],
  );

  // A removal waits 10 seconds under Undo (the same bar as Organise), hidden from the list meanwhile.
  // The demo refuses every write, so it says so at once instead of holding a change it cannot send.
  function remove(item: ResourceRow) {
    setError(null);
    if (demoMode) {
      setError("The demo doesn't save changes.");
      return;
    }
    if (delayed.pending) return;
    setHidden(item.resourceId);
    delayed.schedule({
      label: `Removing ${item.title}`,
      url: `/api/teaching/resources/services/${encodeURIComponent(item.serviceId)}`,
      body: { action: "resource.remove", resourceId: item.resourceId },
      onPosted: read.retry,
      onFailed: (cause) => {
        setHidden(null);
        setError(resourceWriteError(cause));
      },
    });
  }
  const undoRemove = () => {
    delayed.undo();
    setHidden(null);
  };

  const name = read.data?.collection?.name ?? BUILT_IN_NAMES[collection] ?? "Collection";
  let body;
  if (read.code === "teaching_not_found" || (signedOut && !serverSample && built === null))
    body = <ModeNotice>{"This collection isn't available."}</ModeNotice>;
  else if (read.status === "signed-out") body = <TeachingSignInNotice />;
  else if (read.status === "offline" || read.status === "error" || read.status === "setup")
    body = <TeachingStateNotice state={read.status} onRetry={read.retry} />;
  else if (!read.data) body = <ModeModuleSkeleton rows={4} twoLine eyebrow />;
  else {
    const data = read.data;
    body = (
      <>
        <TeachingSwitch value={type} onChange={setType} options={TYPES} label="Type" />
        <TextField
          label="Filter this collection"
          hideLabel
          type="search"
          placeholder="Filter this collection"
          autoComplete="off"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        {error ? <ModeNotice tone="warning">{error}</ModeNotice> : null}
        {shown.length === 0 ? (
          <ModeNotice>
            {filter.trim() || type !== "all" ? "Nothing here matches." : "Nothing in this collection yet."}
          </ModeNotice>
        ) : (
          resourceSections(data.sections, shown).map((section) => (
            <ResourceRows
              key={section.id}
              sampleMode={Boolean(sampleData)}
              items={section.items}
              label={section.label}
              id={`teaching-collection-${section.id}`}
              onRemove={removing && !delayed.pending ? remove : undefined}
            />
          ))
        )}
        {canEdit && data.collection ? (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="primary" block onClick={() => setAdding(true)}>
              Add a resource
            </Button>
            <Button variant="secondary" block aria-pressed={removing} onClick={() => setRemoving((on) => !on)}>
              {removing ? "Done" : "Remove items"}
            </Button>
          </div>
        ) : null}
        {adding && owner && data.collection ? (
          <AddResourceSheet
            serviceId={owner}
            target={{ collectionId: data.collection.collectionId }}
            sections={data.sections}
            sessions={sessions}
            onClose={() => setAdding(false)}
            onAdded={() => {
              setAdding(false);
              read.retry();
            }}
          />
        ) : null}
      </>
    );
  }

  const context = read.data ? [ownerTeam?.name, itemCount(read.data.items.length)].filter(Boolean).join(" · ") : null;
  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-collection">
      <div className="grid gap-3">
        {/* In flow, not a second header: the page has no claimed header slot, so this is the way back. */}
        <Link
          href="/teaching/resources"
          className={cn(
            modeTapArea,
            focusRing,
            "justify-self-start gap-1 pr-2 text-sm font-medium text-[color:var(--primary)] no-underline",
          )}
        >
          <ChevronLeft aria-hidden="true" className="size-icon-md" />
          Resources
        </Link>
        <div className="grid gap-0.5 px-3">
          <h1 className={cn(modeHeadingText, "text-base-minus text-[color:var(--text-heading)]")}>{name}</h1>
          {context ? <p className={cn("nums text-sm font-normal", textMuted)}>{context}</p> : null}
        </div>
        {body}
      </div>
      {delayed.pending ? (
        <TeachingUndoBar testId="teaching-collection-pending" onUndo={undoRemove}>
          {delayed.pending}. Leaving this page cancels it.
        </TeachingUndoBar>
      ) : null}
    </InformationPageShell>
  );
}
