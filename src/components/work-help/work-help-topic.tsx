"use client";

import { ChevronRight, Settings2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { WorkCard, WorkIconRow, WorkSectionLabel } from "@/components/mode-kit/work";
import { workHelpTopicHref, type WorkHelpQuestion, type WorkHelpTopic } from "@/lib/work-help";

/**
 * One help topic: its tabs, its questions and where it is set up. The help
 * centre shows every question as an answer you open in place. The help sheet
 * shows the first few, each opening its answer in the help centre.
 */

export function questionDomId(question: WorkHelpQuestion): string {
  return `q-${question.id}`;
}

function TabsCard({ topic }: { readonly topic: WorkHelpTopic }) {
  if (!topic.tabs?.length) return null;
  return (
    <section className="grid gap-2" aria-labelledby={`help-${topic.id}-tabs`}>
      <WorkSectionLabel id={`help-${topic.id}-tabs`}>Tabs</WorkSectionLabel>
      <WorkCard as="ul" aria-label={`${topic.title} tabs`}>
        {topic.tabs.map((tab) => (
          <li key={tab.label} className="work-help__tab">
            <span className="work-help__tab-name">{tab.label}</span>
            <span className="work-help__tab-body">{tab.body}</span>
          </li>
        ))}
      </WorkCard>
    </section>
  );
}

function Answer({
  question,
  open,
  onToggle,
}: {
  readonly question: WorkHelpQuestion;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const panelId = `${questionDomId(question)}-answer`;
  return (
    <li id={questionDomId(question)} className="work-help__q" data-open={open ? "" : undefined}>
      <h3 className="work-help__q-heading">
        <button
          type="button"
          className="work-help__q-button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          data-testid={`work-help-q-${question.id}`}
        >
          <span>{question.q}</span>
          <ChevronRight aria-hidden="true" className="work-help__q-chev" strokeWidth={2} />
        </button>
      </h3>
      <div id={panelId} className="work-help__a" hidden={!open}>
        <p>{question.a}</p>
        {question.link ? (
          <Link href={question.link.href} className="work-help__a-link" data-testid={`work-help-link-${question.id}`}>
            Open {question.link.label}
            <ChevronRight aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
          </Link>
        ) : null}
      </div>
    </li>
  );
}

/** Reads `#q-<id>` so a link from the help sheet or a search result opens that answer. */
function useHashQuestion(topic: WorkHelpTopic): string | null {
  const [hash, setHash] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const id = window.location.hash.replace(/^#q-/, "");
      setHash(topic.questions.some((question) => question.id === id) ? id : null);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [topic]);
  return hash;
}

/** The full topic, as the help centre shows it. */
export function WorkHelpTopicPage({ topic }: { readonly topic: WorkHelpTopic }) {
  const fromHash = useHashQuestion(topic);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!fromHash) return;
    setOpen((current) => new Set([...current, fromHash]));
    document.getElementById(`q-${fromHash}`)?.scrollIntoView({ block: "start" });
  }, [fromHash]);
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="grid gap-5" data-testid={`work-help-topic-${topic.id}`} data-mode-identity={topic.identity}>
      <p className="work-help__summary">{topic.summary}.</p>
      <TabsCard topic={topic} />
      <section className="grid gap-2" aria-labelledby={`help-${topic.id}-questions`}>
        <WorkSectionLabel id={`help-${topic.id}-questions`}>Common questions</WorkSectionLabel>
        <WorkCard as="ul" aria-label="Common questions">
          {topic.questions.map((question) => (
            <Answer
              key={question.id}
              question={question}
              open={open.has(question.id)}
              onToggle={() => toggle(question.id)}
            />
          ))}
        </WorkCard>
      </section>
      {topic.setUp?.length ? (
        <section className="grid gap-2" aria-labelledby={`help-${topic.id}-setup`}>
          <WorkSectionLabel id={`help-${topic.id}-setup`}>Set up</WorkSectionLabel>
          <WorkCard as="ul" aria-label="Set up">
            {topic.setUp.map((link) => (
              <li key={link.href}>
                <WorkIconRow icon={Settings2} title={link.label} href={link.href} leadsTo={topic.identity} />
              </li>
            ))}
          </WorkCard>
        </section>
      ) : null}
    </div>
  );
}

/** The short form, for the help sheet: tabs, the first questions, and a way into the rest. */
export function WorkHelpTopicBrief({
  topic,
  onNavigate,
  questions = 3,
}: {
  readonly topic: WorkHelpTopic;
  readonly onNavigate: () => void;
  readonly questions?: number;
}) {
  return (
    <div className="grid gap-4" data-testid={`work-help-brief-${topic.id}`} data-mode-identity={topic.identity}>
      <p className="work-help__summary">{topic.summary}.</p>
      <TabsCard topic={topic} />
      <section className="grid gap-2" aria-labelledby={`help-brief-${topic.id}-questions`}>
        <WorkSectionLabel
          id={`help-brief-${topic.id}-questions`}
          action={{ label: `All ${topic.questions.length}`, href: workHelpTopicHref(topic.id) }}
        >
          Common questions
        </WorkSectionLabel>
        <WorkCard as="ul" aria-label="Common questions">
          {topic.questions.slice(0, questions).map((question) => (
            <li key={question.id}>
              <Link
                href={`${workHelpTopicHref(topic.id)}#${questionDomId(question)}`}
                className="work-row"
                onClick={onNavigate}
                data-testid={`work-help-brief-q-${question.id}`}
              >
                <span className="work-row__text">
                  <span className="work-row__title">{question.q}</span>
                </span>
                <ChevronRight aria-hidden="true" className="work-row__chev" strokeWidth={2} />
              </Link>
            </li>
          ))}
        </WorkCard>
      </section>
    </div>
  );
}
