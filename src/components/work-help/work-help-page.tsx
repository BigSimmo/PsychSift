"use client";

import "@/components/work-help/work-help.css";

import { ChevronLeft, ChevronRight, Clock3, Compass, Search, SearchX, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { useModeBandHeading } from "@/components/mode-band/mode-band";
import { useModeBandShown } from "@/components/mode-band/mode-band-shown";
import { WorkButton, WorkCard, WorkEmpty, WorkIconRow, WorkSectionLabel } from "@/components/mode-kit/work";
import { questionDomId, WorkHelpTopicPage } from "@/components/work-help/work-help-topic";
import { setupZoneLabel, useSetupExampleData, useSetupTimeZone } from "@/components/work-setup/shared-settings";
import { useWorkSetupProgress } from "@/components/work-setup/use-work-setup-progress";
import { WORK_SETUP_HREF, workSetupStepHref } from "@/components/work-setup/work-setup-copy";
import { ExampleSwitch } from "@/components/work-setup/work-setup-steps";
import {
  helpSearchTerms,
  orderedAreaTopics,
  searchWorkHelp,
  WORK_HELP_GUIDE_TOPICS,
  WORK_HELP_HREF,
  workHelpTopic,
  workHelpTopicHref,
  type WorkHelpTopic,
} from "@/lib/work-help";
import { workSetupCount } from "@/lib/work-setup/progress";

const subscribeNothing = () => () => undefined;
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

function TopicRow({ topic }: { readonly topic: WorkHelpTopic }) {
  return (
    <li data-mode-identity={topic.identity}>
      <Link href={workHelpTopicHref(topic.id)} className="work-row" data-testid={`work-help-topic-row-${topic.id}`}>
        <span aria-hidden="true" className="work-help__dot" />
        <span className="work-row__text">
          <span className="work-row__title">{topic.title}</span>
          <span className="work-row__sub">{topic.summary}</span>
        </span>
        <ChevronRight aria-hidden="true" className="work-row__chev" strokeWidth={2} />
      </Link>
    </li>
  );
}

function TopicList({ label, topics }: { readonly label: string; readonly topics: readonly WorkHelpTopic[] }) {
  if (topics.length === 0) return null;
  return (
    <section className="grid gap-2" aria-label={label}>
      <WorkSectionLabel>{label}</WorkSectionLabel>
      <WorkCard as="ul" aria-label={label}>
        {topics.map((topic) => (
          <TopicRow key={topic.id} topic={topic} />
        ))}
      </WorkCard>
    </section>
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Bolds the start of each word that a search term matched. */
function Highlight({ text, terms }: { readonly text: string; readonly terms: readonly string[] }): ReactNode {
  if (terms.length === 0) return text;
  const pattern = new RegExp(`\\b(${terms.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(pattern);
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className="work-help__mark">
        {part}
      </mark>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

function SearchResults({ query, onClear }: { readonly query: string; readonly onClear: () => void }) {
  const matches = useMemo(() => searchWorkHelp(query), [query]);
  const terms = helpSearchTerms(query);
  const total = matches.reduce((sum, match) => sum + Math.max(1, match.questions.length), 0);
  return (
    <div className="grid gap-4" data-testid="work-help-results">
      <p className="sr-only" role="status">
        {matches.length === 0 ? "No help found" : `${total} ${total === 1 ? "result" : "results"}`}
      </p>
      {matches.length === 0 ? (
        <WorkEmpty
          icon={SearchX}
          title={`No help found for “${query.trim()}”`}
          body="Try a simpler word, like roster, leave or alerts."
          action={
            <WorkButton variant="secondary" onClick={onClear} testId="work-help-clear-empty">
              Clear search
            </WorkButton>
          }
          testId="work-help-no-results"
        />
      ) : (
        matches.map((match) => (
          <section key={match.topic.id} className="grid gap-2" aria-label={match.topic.title}>
            <WorkSectionLabel>{match.topic.title}</WorkSectionLabel>
            <WorkCard as="ul" aria-label={match.topic.title}>
              {match.questions.length === 0 ? (
                <TopicRow topic={match.topic} />
              ) : (
                match.questions.map((question) => (
                  <li key={question.id}>
                    <Link
                      href={`${workHelpTopicHref(match.topic.id)}#${questionDomId(question)}`}
                      className="work-row"
                      data-testid={`work-help-result-${match.topic.id}-${question.id}`}
                    >
                      <span className="work-row__text">
                        <span className="work-row__title">
                          <Highlight text={question.q} terms={terms} />
                        </span>
                        <span className="work-row__sub work-help__clamp">{question.a}</span>
                      </span>
                      <ChevronRight aria-hidden="true" className="work-row__chev" strokeWidth={2} />
                    </Link>
                  </li>
                ))
              )}
            </WorkCard>
          </section>
        ))
      )}
    </div>
  );
}

function GetStarted() {
  const hydrated = useHydrated();
  const { progress } = useWorkSetupProgress();
  const exampleData = useSetupExampleData();
  const timeZone = useSetupTimeZone();
  const { done, total } = workSetupCount(progress);
  const setupSub = !hydrated
    ? "Stage, areas, time zone, roster and alerts"
    : progress.status === "done"
      ? "Done. Open it again any time"
      : progress.status === "new"
        ? "Stage, areas, time zone, roster and alerts"
        : `${done} of ${total} done`;
  const setupEnd = !hydrated
    ? undefined
    : progress.status === "done"
      ? "Review"
      : progress.status === "new"
        ? "Start"
        : "Resume";
  const setupHref = hydrated && progress.status === "in-progress" ? workSetupStepHref(progress.step) : WORK_SETUP_HREF;
  return (
    <section className="grid gap-2" aria-label="Get started">
      <WorkSectionLabel>Get started</WorkSectionLabel>
      <WorkCard as="ul" aria-label="Get started">
        <li>
          <WorkIconRow
            icon={Compass}
            title="Set up Work"
            sub={setupSub}
            href={setupHref}
            end={setupEnd ? <span className="work-help__end">{setupEnd}</span> : undefined}
            testId="work-help-setup"
          />
        </li>
        {exampleData.available ? (
          <li>
            <WorkIconRow
              icon={Sparkles}
              title="Example data"
              sub="Show a filled-in example in every area"
              end={
                <ExampleSwitch
                  on={exampleData.on}
                  onChange={(next) => (next ? exampleData.turnOn() : exampleData.turnOff())}
                />
              }
              testId="work-help-example-data"
            />
          </li>
        ) : null}
        <li>
          <WorkIconRow
            icon={Clock3}
            title="Time zone"
            sub={setupZoneLabel(timeZone.zones, timeZone.zone)}
            href={workSetupStepHref("time-zone")}
            testId="work-help-time-zone"
          />
        </li>
      </WorkCard>
    </section>
  );
}

function HelpHome() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hydrated = useHydrated();
  const { progress } = useWorkSetupProgress();
  const [query, setQuery] = useState(() => searchParams?.get("q") ?? "");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searching = helpSearchTerms(query).length > 0;
  const areas = hydrated && progress.status !== "new" ? progress.areas : null;
  const { yours, others } = orderedAreaTopics(areas);

  const clear = () => {
    setQuery("");
    if (searchParams?.get("q")) router.replace(WORK_HELP_HREF, { scroll: false });
    inputRef.current?.focus();
  };

  return (
    <div className="grid gap-5" data-testid="work-help-home">
      <form role="search" className="work-help__search" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="work-help-search" className="sr-only">
          Search help
        </label>
        <Search aria-hidden="true" className="work-help__search-icon" strokeWidth={2} />
        <input
          ref={inputRef}
          id="work-help-search"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search help"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              clear();
            }
          }}
          className="work-help__search-input"
          data-testid="work-help-search"
        />
        {query ? (
          <button
            type="button"
            className="work-help__search-clear"
            aria-label="Clear search"
            onClick={clear}
            data-testid="work-help-search-clear"
          >
            <X aria-hidden="true" className="size-icon-sm" strokeWidth={2.2} />
          </button>
        ) : null}
      </form>

      {searching ? (
        <SearchResults query={query} onClear={clear} />
      ) : (
        <>
          <GetStarted />
          <TopicList label={others.length > 0 ? "Your areas" : "Areas"} topics={yours} />
          <TopicList label="Other areas" topics={others} />
          <TopicList label="Good to know" topics={WORK_HELP_GUIDE_TOPICS} />
          <p className="work-help__foot">Help covers Work mode. For clinical search, use the guide in Settings.</p>
        </>
      )}
    </div>
  );
}

/**
 * The help centre (`/my-day/help`): search, getting started, a topic for each
 * area and a few guides. `?topic=<id>` shows one topic, `#q-<id>` opens one
 * answer. All of it is static text in the app, so it reads the same signed in,
 * signed out and offline once loaded.
 */
export function WorkHelpPage() {
  const searchParams = useSearchParams();
  const topic = workHelpTopic(searchParams?.get("topic"));
  const bandShown = useModeBandShown();
  useModeBandHeading(topic ? { eyebrow: "Help", title: topic.title } : { title: "Help" });

  return (
    <div className="work-help" data-mode-identity="my-day" data-testid="work-help">
      {bandShown ? (
        <h1 className="sr-only">{topic ? `${topic.title} help` : "Help"}</h1>
      ) : (
        <h1 className="work-help__title">{topic ? `${topic.title} help` : "Help"}</h1>
      )}
      {topic ? (
        <div className="grid gap-4">
          <Link href={WORK_HELP_HREF} className="work-help__back" data-testid="work-help-back">
            <ChevronLeft aria-hidden="true" className="size-icon-sm" strokeWidth={2.2} />
            All help
          </Link>
          <WorkHelpTopicPage key={topic.id} topic={topic} />
        </div>
      ) : (
        <HelpHome />
      )}
    </div>
  );
}
