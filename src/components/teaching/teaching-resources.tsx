"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { modeNumberText } from "@/components/mode-kit/type";
import { filterResources, RESOURCE_KIND_WORDS, resourceWriteError } from "@/components/teaching/resources-model";
import { addDays, mondayOf, perthDateKey } from "@/components/teaching/teaching-dates";
import { TeachingCatchUp } from "@/components/teaching/teaching-catch-up";
import { TeachingContextBar } from "@/components/teaching/teaching-modules";
import { withUnit } from "@/components/teaching/teaching-number";
import { ResourceRows } from "@/components/teaching/teaching-resource-list";
import { TeachingRow } from "@/components/teaching/teaching-row";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import { ALL_TEAMS } from "@/components/teaching/teaching-view-model";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { useTeachingWeek } from "@/components/teaching/use-teaching-week";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import { teachingPost } from "@/lib/teaching/client";
import type { ResourcesForWeek, TeamSummary } from "@/lib/teaching/model";
import {
  useSignedOutSampleRead,
  useTeachingDemoMode,
  useTeachingSignedOut,
} from "@/components/teaching/use-teaching-sample";

type WeekItem = ResourcesForWeek["forThisWeek"][number];

const itemCount = (n: number) => withUnit(n, n === 1 ? "item" : "items");

/**
 * Resources (spec §5a): this week's materials first, after the catch-up list of ended sessions with no check-in recorded, then
 * the collections as tiles (organiser-made, Recordings and Saved), then the way to CPD's learning
 * directory, which lives there and is never copied here. The filter box looks only through what is
 * already on screen: no request, no search, no AI, no mic (standard §13).
 */
export function TeachingResources({
  demoMode: serverDemoMode,
  sampleData: serverSample,
}: {
  demoMode: boolean;
  sampleData?: ResourcesForWeek;
}) {
  const demoMode = useTeachingDemoMode(serverDemoMode);
  const signedOut = useTeachingSignedOut();
  const now = useTeachingNow();
  const monday = now ? mondayOf(perthDateKey(now)) : null;
  // Signed out with no server sample: build the made-up resources here, and ask the API for nothing.
  const built = useSignedOutSampleRead<ResourcesForWeek>(signedOut && !serverSample, monday, async () => {
    const { demoTeachingResources } = await import("@/lib/teaching/demo-resources");
    return demoTeachingResources({ action: "resources.read", weekStart: monday! }, new Date()) as ResourcesForWeek;
  });
  const sampleData = serverSample ?? built;
  // Demo mode reads too: the server answers with the made-up collections (master plan R8).
  const read = useTeachingResource<ResourcesForWeek>(
    monday && !(signedOut && !sampleData) ? `/api/teaching/resources?action=resources.read&weekStart=${monday}` : null,
    sampleData,
  );
  const week = useTeachingWeek(monday ? { from: monday, to: addDays(monday, 6) } : null, { demoMode }, now);
  const teams = useMemo(() => week.week?.teams ?? [], [week.week]);
  const [team, setTeam] = useState<string>(ALL_TEAMS);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  // Master plan R19: organisers only. `collection.save` refuses an admin who does not organise.
  const organised = teams.filter((candidate) => !sampleData && candidate.role === "organiser");

  let body;
  if (read.status === "signed-out") body = <TeachingSignInNotice />;
  else if (read.status === "offline" || read.status === "error" || read.status === "setup")
    body = <TeachingStateNotice state={read.status} onRetry={read.retry} />;
  else if (!read.data) body = <ModeModuleSkeleton rows={4} twoLine eyebrow />;
  else {
    const data = read.data;
    const inTeam = (serviceId: string) => team === ALL_TEAMS || serviceId === team;
    const needle = filter.trim().toLowerCase();
    const thisWeek = filterResources(
      data.forThisWeek.filter((item) => inTeam(item.serviceId)),
      "all",
      filter,
    );
    const tiles = [
      ...data.collections
        .filter((collection) => inTeam(collection.serviceId))
        .map((collection) => ({
          key: collection.collectionId,
          href: `/teaching/resources/${collection.collectionId}`,
          name: collection.name,
          count: collection.count,
        })),
      { key: "recordings", href: "/teaching/resources/recordings", name: "Recordings", count: data.recordingsCount },
      { key: "saved", href: "/teaching/resources/saved", name: "Saved", count: data.savedCount },
    ].filter((tile) => !needle || tile.name.toLowerCase().includes(needle));

    const catchUpWeek = week.week
      ? {
          sessions: week.week.sessions.filter((session) => inTeam(session.serviceId)),
          attendance: week.week.attendance,
        }
      : null;
    body = (
      <>
        <TeachingCatchUp status={week.status} week={catchUpWeek} resources={data.forThisWeek} now={now} />
        <TextField
          label="Filter resources"
          hideLabel
          type="search"
          placeholder="Filter resources"
          autoComplete="off"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        {thisWeek.length > 0 ? (
          <ResourceRows
            sampleMode={Boolean(sampleData)}
            items={thisWeek}
            label="For this week"
            id="teaching-resources-week"
            meta={(item) => `${RESOURCE_KIND_WORDS[item.kind]}${(item as WeekItem).catchUp ? " · catch-up" : ""}`}
          />
        ) : (
          <ModeNotice>
            {needle ? "Nothing this week matches." : "Nothing is linked to this week's sessions yet."}
          </ModeNotice>
        )}
        {tiles.length > 0 ? (
          <section aria-labelledby="teaching-resources-collections" className="grid gap-2">
            <h2 id="teaching-resources-collections" className={cn(eyebrowText, "px-3")}>
              Collections
            </h2>
            <div className="grid grid-cols-2 gap-2" data-testid="teaching-resources-collections">
              {tiles.map((tile) => (
                <Link
                  key={tile.key}
                  href={tile.href}
                  className={cn(modeModuleSurface, focusRing, "grid min-h-20 content-between gap-1 p-3 no-underline")}
                >
                  <span className="text-base-minus font-medium break-words text-[color:var(--text-heading)]">
                    {tile.name}
                  </span>
                  <span className={cn(modeNumberText, "text-sm", textMuted)}>{itemCount(tile.count)}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
        <ModeGroupedList mode="teaching" testId="teaching-resources-more">
          {organised.length > 0 ? <TeachingRow title="New collection" onClick={() => setCreating(true)} /> : null}
          <ModeRow title="Learning directory" subtitle="WA courses and modules, in CPD" href="/cme/learning" />
        </ModeGroupedList>
        {creating ? <NewCollectionSheet services={organised} onClose={() => setCreating(false)} /> : null}
      </>
    );
  }

  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-resources">
      <div className="grid gap-3">
        <h1 className="sr-only">Resources</h1>
        <TeachingContextBar
          teams={teams}
          value={team}
          onChange={setTeam}
          demoTag={demoMode || teams.some((candidate) => candidate.isDemo)}
        />
        {body}
      </div>
    </InformationPageShell>
  );
}

function NewCollectionSheet({ services, onClose }: { services: readonly TeamSummary[]; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim().length > 0 && Boolean(serviceId);

  async function create() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await teachingPost<{ collectionId: string }>(
        `/api/teaching/resources/services/${encodeURIComponent(serviceId)}`,
        { action: "collection.save", name: name.trim() },
      );
      router.push(`/teaching/resources/${saved.collectionId}`);
    } catch (cause) {
      setError(resourceWriteError(cause));
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="New collection"
      footer={
        <Button
          variant="primary"
          block
          disabled={!ready}
          busy={busy}
          busyLabel="Creating"
          onClick={() => void create()}
        >
          Create collection
        </Button>
      }
    >
      <div className="grid gap-3">
        <TextField label="Name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        {services.length > 1 ? (
          <Select
            label="Service"
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
            options={services.map((service) => ({ value: service.id, label: service.name }))}
          />
        ) : null}
        {error ? <ModeNotice tone="warning">{error}</ModeNotice> : null}
      </div>
    </Sheet>
  );
}
