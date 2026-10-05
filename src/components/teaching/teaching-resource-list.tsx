"use client";

import { Bookmark, BookmarkCheck, FileText, Link2, Play, X, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeNotice } from "@/components/mode-kit/notice";
import {
  ADD_KINDS,
  isHttpsLink,
  RESOURCE_KIND_WORDS,
  resourceHref,
  resourceWriteError,
  type AddKind,
} from "@/components/teaching/resources-model";
import { T5Icon, T5List, T5Row } from "@/components/teaching/t5-kit";
import type { SessionDetailRead } from "@/components/teaching/teaching-reads";
import { TeachingRow } from "@/components/teaching/teaching-row";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { cn, textMuted } from "@/components/ui-primitives";
import { teachingPost } from "@/lib/teaching/client";
import type { ResourceRow } from "@/lib/teaching/model";

const KIND_ICONS: Record<ResourceRow["kind"], LucideIcon> = {
  slides: FileText,
  reading: FileText,
  library: FileText,
  link: Link2,
  recording: Play,
};

const rowControl = cn(focusRing, "grid min-h-12 min-w-12 place-items-center rounded-lg");

/**
 * Rows of links, each with its type in words and a save toggle (or, while an organiser is removing items,
 * a remove button). A library document opens inside the app; every other link opens where it lives, in a
 * new tab. No icon on the row itself (standard §4).
 */
export function ResourceRows({
  items,
  label,
  id,
  meta,
  onRemove,
  sampleMode = false,
  look = "grouped",
}: {
  sampleMode?: boolean;
  /** "t5": plain ruled rows with a grey type icon, for the v5 Resources page, whose section label names the list. */
  look?: "grouped" | "t5";
  items: readonly ResourceRow[];
  label: string;
  id: string;
  meta?: (item: ResourceRow) => string | null;
  onRemove?: (item: ResourceRow) => void;
}) {
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  async function toggle(item: ResourceRow) {
    if (sampleMode) {
      setError("The sample doesn’t save changes.");
      return;
    }
    const next = !(saved[item.resourceId] ?? item.saved);
    setError(null);
    setSaved((current) => ({ ...current, [item.resourceId]: next }));
    try {
      const result = await teachingPost<{ saved: boolean }>("/api/teaching/whats-on", {
        action: next ? "resource_save.set" : "resource_save.unset",
        resourceId: item.resourceId,
      });
      setSaved((current) => ({ ...current, [item.resourceId]: result.saved }));
    } catch (cause) {
      setSaved((current) => ({ ...current, [item.resourceId]: !next }));
      setError(resourceWriteError(cause));
    }
  }

  if (look === "t5")
    return (
      <>
        <T5List ruled testId={id}>
          {items.map((item) => {
            const isSaved = saved[item.resourceId] ?? item.saved;
            const href = resourceHref(item);
            const subtitle = meta?.(item) ?? RESOURCE_KIND_WORDS[item.kind];
            const control = (
              <button
                type="button"
                aria-pressed={isSaved}
                aria-label={`${isSaved ? "Unsave" : "Save"} ${item.title}`}
                onClick={() => void toggle(item)}
                className={cn(
                  rowControl,
                  "-mr-3",
                  isSaved ? "text-[color:var(--mode-identity)]" : "text-[color:var(--text-soft)]",
                )}
              >
                {isSaved ? (
                  <BookmarkCheck aria-hidden="true" className="size-icon-md" />
                ) : (
                  <Bookmark aria-hidden="true" className="size-icon-md" />
                )}
              </button>
            );
            const title = href ? (
              <a
                href={href}
                {...(item.libraryDocumentId ? {} : { target: "_blank", rel: "noreferrer" })}
                className={cn(focusRing, "rounded-sm after:absolute after:inset-0 after:content-['']")}
              >
                {item.title}
              </a>
            ) : (
              item.title
            );
            return (
              <T5Row
                key={item.resourceId}
                title={title}
                meta={subtitle}
                lead={<T5Icon icon={KIND_ICONS[item.kind]} />}
                end={<span className="relative z-1">{control}</span>}
              />
            );
          })}
        </T5List>
        {error ? <ModeNotice tone="warning">{error}</ModeNotice> : null}
      </>
    );

  return (
    <>
      <ModeGroupedList mode="teaching" eyebrow={label} testId={id}>
        {items.map((item) => {
          const isSaved = saved[item.resourceId] ?? item.saved;
          const href = resourceHref(item);
          const subtitle = meta?.(item) ?? RESOURCE_KIND_WORDS[item.kind];
          const control = onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(item)}
              aria-label={`Remove ${item.title}`}
              className={cn(rowControl, textMuted)}
            >
              <X aria-hidden="true" className="size-icon-md" />
            </button>
          ) : (
            <button
              type="button"
              aria-pressed={isSaved}
              aria-label={`${isSaved ? "Unsave" : "Save"} ${item.title}`}
              onClick={() => void toggle(item)}
              className={cn(rowControl, isSaved ? "text-[color:var(--primary)]" : textMuted)}
            >
              {isSaved ? (
                <BookmarkCheck aria-hidden="true" className="size-icon-md" />
              ) : (
                <Bookmark aria-hidden="true" className="size-icon-md" />
              )}
            </button>
          );
          if (href && item.libraryDocumentId)
            return (
              <ModeRow key={item.resourceId} title={item.title} subtitle={subtitle} href={href} trailing={control} />
            );
          if (href)
            return (
              <TeachingRow
                key={item.resourceId}
                title={item.title}
                subtitle={subtitle}
                externalHref={href}
                trailing={control}
              />
            );
          return <ModeRow key={item.resourceId} title={item.title} subtitle={subtitle} trailing={control} />;
        })}
      </ModeGroupedList>
      {error ? <ModeNotice tone="warning">{error}</ModeNotice> : null}
    </>
  );
}

/** Still typing the start of "https://", so not yet wrong. */
function typingScheme(value: string): boolean {
  return "https://".startsWith(value.trim().toLowerCase());
}

/**
 * Links only: nothing is uploaded or copied (spec §5a). Add stays disabled until the "No patient details in
 * this file" box is ticked, and the tick is sent with the link so the server records who ticked it and when.
 * Slides belong to one session (master plan R27), so in a collection the sheet asks for the session when the
 * type is Slides and keeps Add disabled until one is chosen.
 */
export function AddResourceSheet({
  serviceId,
  target,
  sections = [],
  sessions = [],
  onClose,
  onAdded,
}: {
  serviceId: string;
  target: { collectionId?: string; occurrenceId?: string };
  sections?: readonly { sectionId: string; name: string }[];
  /** The service's sessions slides can be attached to, when adding into a collection. */
  sessions?: readonly { occurrenceId: string; label: string }[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<AddKind>(target.occurrenceId ? "slides" : "link");
  const [sectionId, setSectionId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkOk = isHttpsLink(url);
  const linkError = url.trim() && !linkOk && !typingScheme(url) ? "Use a link that starts with https://" : undefined;
  const asksSession = kind === "slides" && !target.occurrenceId;
  const occurrenceId = target.occurrenceId ?? (asksSession && sessionId ? sessionId : undefined);
  const ready =
    title.trim().length > 0 && title.trim().length <= 160 && linkOk && ticked && (!asksSession || Boolean(sessionId));

  async function add() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await teachingPost(`/api/teaching/resources/services/${encodeURIComponent(serviceId)}`, {
        action: "resource.add",
        title: title.trim(),
        kind,
        url: url.trim(),
        ...(target.collectionId ? { collectionId: target.collectionId } : {}),
        ...(target.collectionId && sectionId ? { sectionId } : {}),
        ...(occurrenceId ? { occurrenceId } : {}),
        noPatientDetails: true,
      });
      onAdded();
    } catch (cause) {
      setError(resourceWriteError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Add a resource"
      footer={
        <Button variant="primary" block disabled={!ready} busy={busy} busyLabel="Adding" onClick={() => void add()}>
          Add
        </Button>
      }
    >
      <div className="grid gap-3">
        <TextField
          label="Link"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://"
          value={url}
          error={linkError}
          onChange={(event) => setUrl(event.target.value)}
        />
        <TextField label="Title" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
        <Select
          label="Type"
          value={kind}
          onChange={(event) => setKind(event.target.value as AddKind)}
          options={ADD_KINDS.map((value) => ({ value, label: RESOURCE_KIND_WORDS[value] }))}
        />
        {target.collectionId && sections.length > 0 ? (
          <Select
            label="Section"
            value={sectionId}
            onChange={(event) => setSectionId(event.target.value)}
            options={[
              { value: "", label: "No section" },
              ...sections.map((section) => ({ value: section.sectionId, label: section.name })),
            ]}
          />
        ) : null}
        {asksSession ? (
          sessions.length > 0 ? (
            <Select
              label="Session"
              required
              hint="Slides belong to one session."
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
              options={[
                { value: "", label: "Choose a session" },
                ...sessions.map((session) => ({ value: session.occurrenceId, label: session.label })),
              ]}
            />
          ) : (
            <ModeNotice>
              Slides belong to one session, and this service has none this week. Add them from the session.
            </ModeNotice>
          )
        ) : null}
        <Checkbox
          label="No patient details in this file"
          checked={ticked}
          onChange={(event) => setTicked(event.target.checked)}
        />
        <p className={cn("text-sm", textMuted)}>
          Materials stay where they live. This adds a link, and records that you ticked the box.
        </p>
        {error ? <ModeNotice tone="warning">{error}</ModeNotice> : null}
      </div>
    </Sheet>
  );
}

/**
 * The session page's materials: the series' links and this session's resources, each with its type in words.
 * The read runs in demo mode too, where the server answers with made-up materials (master plan R8). Only the
 * session's presenter is offered Add material here (R19); organisers add into collections.
 */
export function SessionMaterials({ detail }: { detail: SessionDetailRead }) {
  const [adding, setAdding] = useState(false);
  const resources = useTeachingResource<{ items: ResourceRow[] }>(
    `/api/teaching/resources?${new URLSearchParams({ action: "resources.read", occurrenceId: detail.occurrenceId })}`,
  );
  const items = resources.data?.items ?? [];
  // A session the reader can no longer see answers 404; the page itself says so, so that is not a failure here.
  const failed =
    (resources.status === "error" || resources.status === "offline" || resources.status === "setup") &&
    resources.code !== "teaching_not_found";
  const canAdd = detail.isPresenter && !detail.visitor && detail.status !== "cancelled";
  if (detail.materials.length === 0 && items.length === 0 && !canAdd && !failed) return null;
  return (
    <>
      {detail.materials.length > 0 || items.length > 0 || canAdd ? (
        <ModeGroupedList
          mode="teaching"
          eyebrow="Materials · chosen by the presenter"
          testId="teaching-session-materials"
        >
          {detail.materials.map((material) =>
            isHttpsLink(material.url) ? (
              <TeachingRow key={material.url} title={material.label} subtitle="Link" externalHref={material.url} />
            ) : (
              <ModeRow key={material.url} title={material.label} subtitle="Link" />
            ),
          )}
          {items.map((item) => {
            const href = resourceHref(item);
            const subtitle = RESOURCE_KIND_WORDS[item.kind];
            if (href && item.libraryDocumentId)
              return <ModeRow key={item.resourceId} title={item.title} subtitle={subtitle} href={href} />;
            if (href)
              return <TeachingRow key={item.resourceId} title={item.title} subtitle={subtitle} externalHref={href} />;
            return <ModeRow key={item.resourceId} title={item.title} subtitle={subtitle} />;
          })}
          {canAdd ? <TeachingRow title="Add material" onClick={() => setAdding(true)} /> : null}
        </ModeGroupedList>
      ) : null}
      {failed ? <ModeNotice>{"This session's other materials couldn't load. Nothing changed."}</ModeNotice> : null}
      {adding ? (
        <AddResourceSheet
          serviceId={detail.serviceId}
          target={{ occurrenceId: detail.occurrenceId }}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            resources.retry();
          }}
        />
      ) : null}
    </>
  );
}
