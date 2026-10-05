"use client";

import { Award, CalendarDays, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import {
  examPrepRow,
  filterResources,
  RESOURCE_KIND_WORDS,
  resourceWriteError,
} from "@/components/teaching/resources-model";
import { T5Icon, T5Link, T5List, T5Meta, T5Page, T5Row, T5Section } from "@/components/teaching/t5-kit";
import { addDays, mondayOf, perthDateKey, shortDayLabel } from "@/components/teaching/teaching-dates";
import { TeachingCatchUp } from "@/components/teaching/teaching-catch-up";
import { TeachingContextBar } from "@/components/teaching/teaching-modules";
import { withUnit } from "@/components/teaching/teaching-number";
import { ResourceRows } from "@/components/teaching/teaching-resource-list";
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
import { cn } from "@/components/ui-primitives";
import { teachingPost } from "@/lib/teaching/client";
import type { CollectionRead, ResourcesForWeek, TeamSummary } from "@/lib/teaching/model";
import { sampleExamPrep } from "@/lib/teaching/term-tracker";
import { useExamPrepStore } from "@/lib/teaching/term-tracker-store";
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
  const today = now ? perthDateKey(now) : null;
  const examSample = useMemo(() => (demoMode && today ? sampleExamPrep(today) : null), [demoMode, today]);
  const examPrep = useExamPrepStore(examSample);
  const extras = useResourceExtras(signedOut, Boolean(monday));
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
    const collections = [
      ...data.collections
        .filter((collection) => inTeam(collection.serviceId))
        .map((collection) => ({
          key: collection.collectionId,
          href: `/teaching/resources/${collection.collectionId}`,
          name: collection.name,
          count: collection.count,
        })),
    ].filter((tile) => !needle || tile.name.toLowerCase().includes(needle));

    const catchUpWeek = week.week
      ? {
          sessions: week.week.sessions.filter((session) => inTeam(session.serviceId)),
          attendance: week.week.attendance,
        }
      : null;
    const recordings = filterResources(extras.recordings ?? [], "all", filter);
    const savedItems = filterResources(extras.saved ?? [], "all", filter);
    const exam = today ? examPrepRow(examPrep.state, today) : null;
    body = (
      <>
        <TeachingCatchUp status={week.status} week={catchUpWeek} resources={data.forThisWeek} now={now} />
        <label className="mt-1 flex h-11 items-center gap-2 rounded-md bg-[color:var(--surface-inset)] px-3 text-[color:var(--text-soft)] focus-within:ring-2 focus-within:ring-[color:var(--focus-ring)]">
          <Search aria-hidden="true" className="size-icon-md shrink-0" />
          <span className="sr-only">Filter resources</span>
          <input
            type="search"
            placeholder="Filter resources"
            autoComplete="off"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-[color:var(--text-heading)] outline-none placeholder:text-[color:var(--text-soft)]"
          />
        </label>
        <T5Section
          label={`For this week · ${thisWeek.length}`}
          right={<T5Meta>Chosen by presenters</T5Meta>}
          testId="teaching-resources-week-section"
        >
          {thisWeek.length > 0 ? (
            <ResourceRows
              look="t5"
              sampleMode={Boolean(sampleData)}
              items={thisWeek}
              label="For this week"
              id="teaching-resources-week"
              meta={(item) => `${RESOURCE_KIND_WORDS[item.kind]}${(item as WeekItem).catchUp ? " · catch-up" : ""}`}
            />
          ) : (
            <T5Meta className="border-t border-[color:var(--border)] py-2.5">
              {needle ? "Nothing this week matches." : "Nothing is linked to this week's sessions yet."}
            </T5Meta>
          )}
        </T5Section>
        {exam && !needle ? (
          <T5Section label="My exam prep">
            <T5List ruled>
              <T5Row
                title={exam.title}
                meta={exam.meta}
                lead={<T5Icon icon={CalendarDays} />}
                href="/teaching/exam-prep"
                testId="teaching-resources-exam-prep"
              />
            </T5List>
          </T5Section>
        ) : null}
        <T5Section
          label={`Recordings · ${data.recordingsCount}`}
          right={<T5Link href="/teaching/resources/recordings">All</T5Link>}
        >
          {extras.recordings === null ? (
            <T5Meta className="border-t border-[color:var(--border)] py-2.5">
              {extras.failed ? "Recordings did not load. Open All to try again." : "Loading recordings…"}
            </T5Meta>
          ) : recordings.length > 0 ? (
            <ResourceRows
              look="t5"
              sampleMode={Boolean(sampleData)}
              items={recordings.slice(0, 4)}
              label="Recordings"
              id="teaching-resources-recordings"
              meta={(item) => `Recording · added ${shortDayLabel(perthDateKey(item.addedAt))}`}
            />
          ) : (
            <T5Meta className="border-t border-[color:var(--border)] py-2.5">
              {needle ? "No recordings match." : "No recordings yet."}
            </T5Meta>
          )}
        </T5Section>
        {collections.length > 0 || organised.length > 0 ? (
          <T5Section
            label={`Collections · ${collections.length}`}
            right={organised.length > 0 ? <T5Link onClick={() => setCreating(true)}>New collection</T5Link> : null}
          >
            {collections.length > 0 ? (
              <ul
                role="list"
                data-testid="teaching-resources-collections"
                className="grid grid-cols-2 gap-x-4 border-t border-[color:var(--border)]"
              >
                {collections.map((tile) => (
                  <li key={tile.key} className="min-w-0 border-b border-[color:var(--border)]">
                    <Link
                      href={tile.href}
                      className={cn(focusRing, "grid min-h-12 content-center gap-px rounded-sm py-2.25 no-underline")}
                    >
                      <span className="text-sm font-medium break-words text-[color:var(--text-heading)]">
                        {tile.name}
                      </span>
                      <span className="text-xs text-[color:var(--text-muted)] tabular-nums">
                        {itemCount(tile.count)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <T5Meta className="border-t border-[color:var(--border)] py-2.5">No collections yet.</T5Meta>
            )}
          </T5Section>
        ) : null}
        <T5Section
          label={`Saved · ${data.savedCount}`}
          right={data.savedCount > 4 ? <T5Link href="/teaching/resources/saved">All</T5Link> : null}
        >
          {extras.saved === null ? (
            <T5Meta className="border-t border-[color:var(--border)] py-2.5">
              {extras.failed ? "Saved items did not load. Open Saved to try again." : "Loading saved items…"}
            </T5Meta>
          ) : savedItems.length > 0 ? (
            <ResourceRows
              look="t5"
              sampleMode={Boolean(sampleData)}
              items={savedItems.slice(0, 4)}
              label="Saved"
              id="teaching-resources-saved"
            />
          ) : (
            <T5Meta className="border-t border-[color:var(--border)] py-2.5">
              {needle ? "No saved items match." : "Nothing saved yet. Tap the bookmark on any resource."}
            </T5Meta>
          )}
        </T5Section>
        <T5List ruled className="mt-4.5">
          <T5Row
            title="WA courses and modules are in CPD"
            lead={<T5Icon icon={Award} />}
            href="/cme/learning"
            testId="teaching-resources-learning"
          />
        </T5List>
        {creating ? <NewCollectionSheet services={organised} onClose={() => setCreating(false)} /> : null}
      </>
    );
  }

  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-resources">
      <T5Page>
        <h1 className="sr-only">Resources</h1>
        <TeachingContextBar
          teams={teams}
          value={team}
          onChange={setTeam}
          demoTag={demoMode || teams.some((candidate) => candidate.isDemo)}
        />
        {body}
      </T5Page>
    </InformationPageShell>
  );
}

/**
 * The first few recordings and saved items, shown inline. Two small reads of the built-in collections the
 * page already links to; signed out, the same made-up collections are built here and nothing is requested.
 */
function useResourceExtras(signedOut: boolean, ready: boolean) {
  const built = useSignedOutSampleRead(signedOut && ready, "extras", async () => {
    const { demoTeachingResources } = await import("@/lib/teaching/demo-resources");
    const read = (builtIn: "recordings" | "saved") =>
      (demoTeachingResources({ action: "collection.read", builtIn }) as CollectionRead).items;
    return { recordings: read("recordings"), saved: read("saved") };
  });
  const live = ready && !signedOut;
  const recordings = useTeachingResource<CollectionRead>(
    live ? "/api/teaching/resources?action=collection.read&builtIn=recordings" : null,
  );
  const saved = useTeachingResource<CollectionRead>(
    live ? "/api/teaching/resources?action=collection.read&builtIn=saved" : null,
  );
  const failed = (status: string) => status !== "ready" && status !== "loading" && status !== "idle";
  return {
    recordings: built?.recordings ?? recordings.data?.items ?? null,
    saved: built?.saved ?? saved.data?.items ?? null,
    failed: !built && (failed(recordings.status) || failed(saved.status)),
  };
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
