"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { ServiceStructuredFields, emptyCover } from "@/components/on-call/service-structured-fields";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { TextField } from "@/components/ui/text-field";
import { modeDot } from "@/components/mode-kit/recipes";
import { InlineNotice, cn, fieldControlPlain, textMuted } from "@/components/ui-primitives";
import { handbookEditorWarnings, handbookPlacementLine } from "@/lib/on-call/handbook-editor-checks";
import {
  serviceActionSchema,
  serviceContentKinds,
  serviceOrientationPhases,
  serviceSections,
  type ServiceAction,
  type ServiceEntry,
  type ServiceSite,
} from "@/lib/on-call/service-model";

type EntrySaveAction = Extract<ServiceAction, { action: "entry.save" }>;

const sectionLabels: Record<(typeof serviceSections)[number], string> = {
  contacts: "Contacts",
  referrals: "Referrals",
  resources: "Resources",
  documentation: "Documentation",
  orientation: "Orientation",
  teaching: "Teaching",
  admin: "Administration",
  playbook: "Playbook ladder",
  cover: "Role cover",
};

const kindLabels: Record<(typeof serviceContentKinds)[number], string> = {
  operational: "Operational",
  clinical: "Clinical",
  legal: "Legal or policy",
};

const phaseLabels: Record<(typeof serviceOrientationPhases)[number], string> = {
  before_start: "Before starting",
  first_shift: "First shift",
  first_week: "First week",
  ongoing: "During the rotation",
  leaving: "Before leaving",
};

type SourceDraft = { label: string; url: string };

/** Warnings about the number get the kit's small amber dot; the rest are plain muted lines (standard Â§3). */
const DOTTED_WARNINGS = new Set(["number-length", "number-shared"]);

const TITLE_HINT =
  "Start with a team or place to group it: ICU: Registrar, Ward: 4B, Downtime: …, Emergency: …. Access, food, taxi and security belong in Admin.";
const BODY_HINT =
  "Add Also known as: HDU, high dependency on its own line so people can search everyday words. For a number that only works from a hospital phone, add From a mobile: 5550 0000, 55 so readers can call from their own phone. No patient details.";
const PHONE_HINT =
  "For switchboard then extension, type the full number, a comma, then the extension: 5550 0000, 4455.";

function initialSources(entry: ServiceEntry | null): SourceDraft[] {
  const sources = entry?.content.sources ?? [];
  return sources.length > 0 ? sources.map((source) => ({ ...source })) : [{ label: "", url: "" }];
}

function entryFingerprint(entry: ServiceEntry | null, defaultSiteId: string | null) {
  return JSON.stringify({
    section: entry?.content.section ?? "contacts",
    kind: entry?.content.kind ?? "operational",
    siteId: (entry ? entry.content.siteId : defaultSiteId) ?? "",
    title: entry?.content.title ?? "",
    body: entry?.content.body ?? "",
    phone: entry?.content.phone ?? "",
    orientationPhase: entry?.content.orientationPhase ?? "first_shift",
    sources: initialSources(entry),
    steps: entry?.content.steps ?? [],
    cover: entry?.content.cover ?? emptyCover,
  });
}

export function ServiceEntryEditor({
  entry,
  sites,
  defaultSiteId,
  entries = [],
  onSave,
  onCancel,
}: {
  readonly entry: ServiceEntry | null;
  readonly sites: readonly ServiceSite[];
  /** The service's entries, for the editor's warnings (a similar team, a shared number). */
  readonly entries?: readonly ServiceEntry[];
  readonly defaultSiteId: string | null;
  readonly onSave: (action: EntrySaveAction) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const [loadedEntry, setLoadedEntry] = useState(entry);
  const incomingKey = useRef(`${entry?.id ?? "new"}:${entry?.revision ?? 0}`);
  const [initialFingerprint, setInitialFingerprint] = useState(() => entryFingerprint(entry, defaultSiteId));
  const [section, setSection] = useState<EntrySaveAction["section"]>(entry?.content.section ?? "contacts");
  const [kind, setKind] = useState<EntrySaveAction["kind"]>(entry?.content.kind ?? "operational");
  const [siteId, setSiteId] = useState((entry ? entry.content.siteId : defaultSiteId) ?? "");
  const [title, setTitle] = useState(entry?.content.title ?? "");
  const [body, setBody] = useState(entry?.content.body ?? "");
  const [phone, setPhone] = useState(entry?.content.phone ?? "");
  const [orientationPhase, setOrientationPhase] = useState<EntrySaveAction["orientationPhase"]>(
    entry?.content.orientationPhase ?? "first_shift",
  );
  const [sources, setSources] = useState<SourceDraft[]>(() => initialSources(entry));
  const [steps, setSteps] = useState(entry?.content.steps ?? []);
  const [cover, setCover] = useState(entry?.content.cover ?? emptyCover);
  const [busy, setBusy] = useState<"draft" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const placementId = useId();
  const warningsId = useId();
  const placement = handbookPlacementLine({ title, section, kind, siteId: siteId || null, phone });
  const warnings = title.trim()
    ? handbookEditorWarnings(
        { title, section, kind, siteId: siteId || null, phone },
        {
          entries,
          editingId: loadedEntry?.id ?? null,
          siteName: sites.find((site) => site.id === siteId)?.name ?? null,
        },
      )
    : [];

  const dirty =
    JSON.stringify({ section, kind, siteId, title, body, phone, orientationPhase, sources, steps, cover }) !==
    initialFingerprint;

  useEffect(() => {
    const nextKey = `${entry?.id ?? "new"}:${entry?.revision ?? 0}`;
    if (nextKey === incomingKey.current) return;
    incomingKey.current = nextKey;
    if (dirty && !window.confirm("Discard this unsaved draft and open the selected entry?")) {
      queueMicrotask(() =>
        setError("Your unsaved draft remains open. Save or cancel it before editing another entry."),
      );
      return;
    }
    queueMicrotask(() => {
      setLoadedEntry(entry);
      setInitialFingerprint(entryFingerprint(entry, defaultSiteId));
      setSection(entry?.content.section ?? "contacts");
      setKind(entry?.content.kind ?? "operational");
      setSiteId((entry ? entry.content.siteId : defaultSiteId) ?? "");
      setTitle(entry?.content.title ?? "");
      setBody(entry?.content.body ?? "");
      setPhone(entry?.content.phone ?? "");
      setOrientationPhase(entry?.content.orientationPhase ?? "first_shift");
      setSources(initialSources(entry));
      setSteps(entry?.content.steps ?? []);
      setCover(entry?.content.cover ?? emptyCover);
      setError(null);
    });
  }, [entry, defaultSiteId, dirty]);

  // Switching entries already asks before discarding; closing the tab or
  // refreshing did not (ledger #4NSKNS). Hold the browser's own confirm while a
  // draft is unsaved, and drop it while a save is in flight.
  useEffect(() => {
    if (!dirty || busy !== null) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);

  async function submit(publish: boolean) {
    if (busy) return;
    const cleanSources = sources
      .map((source) => ({ label: source.label.trim(), url: source.url.trim() }))
      .filter((source) => source.label || source.url);
    if (!title.trim()) {
      setError("Give this handbook entry a title.");
      return;
    }
    if (cleanSources.some((source) => !source.label || !source.url)) {
      setError("Each source needs both a label and a public HTTPS link.");
      return;
    }
    if (kind !== "operational" && cleanSources.length === 0) {
      setError("Clinical and legal summaries need an official source link.");
      return;
    }
    setBusy(publish ? "publish" : "draft");
    setError(null);
    try {
      const parsed = serviceActionSchema.safeParse({
        action: "entry.save",
        ...(loadedEntry ? { entryId: loadedEntry.id, expectedRevision: loadedEntry.revision } : {}),
        siteId: siteId || null,
        section,
        kind,
        title: title.trim(),
        body: body.trim(),
        phone: phone.trim(),
        sources: cleanSources,
        orientationPhase,
        publish,
        ...(section === "playbook" ? { steps } : {}),
        ...(section === "cover" ? { cover } : {}),
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the entry fields.");
      await onSave(parsed.data as EntrySaveAction);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This entry could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="service-entry-editor-heading" className="grid gap-4" data-testid="service-entry-editor">
      <div>
        <h2 id="service-entry-editor-heading" className="text-lg font-semibold text-[color:var(--text-heading)]">
          {loadedEntry ? "Edit handbook entry" : "Add handbook entry"}
        </h2>
        <p className={cn(textMuted, "mt-1 text-sm leading-6")}>
          Store service guidance only. Do not enter patient names, identifiers, case notes or other patient information.
        </p>
      </div>
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(false);
        }}
        data-testid="service-entry-form"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Group" id="service-entry-section">
            {(field) => (
              <select
                id={field.id}
                aria-describedby={field.describedBy}
                value={section}
                onChange={(event) => {
                  const next = event.target.value as EntrySaveAction["section"];
                  setSection(next);
                  if (next === "playbook" || next === "cover") setKind("clinical");
                }}
                className={fieldControlPlain}
              >
                {serviceSections.map((value) => (
                  <option key={value} value={value}>
                    {sectionLabels[value]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label="Content type" id="service-entry-kind">
            {(field) => (
              <select
                id={field.id}
                aria-describedby={field.describedBy}
                value={kind}
                onChange={(event) => setKind(event.target.value as EntrySaveAction["kind"])}
                className={fieldControlPlain}
              >
                {serviceContentKinds
                  .filter((value) => value !== "operational" || (section !== "playbook" && section !== "cover"))
                  .map((value) => (
                    <option key={value} value={value}>
                      {kindLabels[value]}
                    </option>
                  ))}
              </select>
            )}
          </FormField>
          <FormField label="Site" id="service-entry-site" hint="Choose service-wide if it applies at every site.">
            {(field) => (
              <select
                id={field.id}
                aria-describedby={field.describedBy}
                value={siteId}
                onChange={(event) => setSiteId(event.target.value)}
                className={fieldControlPlain}
              >
                <option value="">Service-wide</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>

        {section === "orientation" ? (
          <FormField label="Orientation stage" id="service-entry-orientation-stage">
            {(field) => (
              <select
                id={field.id}
                aria-describedby={field.describedBy}
                value={orientationPhase}
                onChange={(event) => setOrientationPhase(event.target.value as EntrySaveAction["orientationPhase"])}
                className={fieldControlPlain}
              >
                {serviceOrientationPhases.map((phase) => (
                  <option key={phase} value={phase}>
                    {phaseLabels[phase]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        ) : null}

        <div className="grid gap-1">
          <TextField
            label="Title"
            id="service-entry-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            hint={TITLE_HINT}
            aria-describedby={warnings.length > 0 ? `${placementId} ${warningsId}` : placementId}
          />
          <p id={placementId} className={cn(textMuted, "text-sm")} data-testid="service-entry-placement">
            {placement}
          </p>
          {warnings.length > 0 ? (
            <ul id={warningsId} className={cn(textMuted, "grid gap-1 text-sm")} data-testid="service-entry-warnings">
              {warnings.map((warning) => (
                <li key={warning.id} className="flex items-baseline gap-2" data-warning={warning.id}>
                  {DOTTED_WARNINGS.has(warning.id) ? (
                    <span aria-hidden="true" data-warning-dot="" className={cn(modeDot, "bg-[color:var(--warning)]")} />
                  ) : null}
                  <span className="min-w-0 break-words">{warning.text}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <FormField label="Service guidance" id="service-entry-body" hint={BODY_HINT}>
          {(field) => (
            <textarea
              id={field.id}
              aria-describedby={field.describedBy}
              rows={5}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className={cn(fieldControlPlain, "h-auto min-h-28 resize-y py-3")}
            />
          )}
        </FormField>
        <TextField
          label="Phone or extension"
          id="service-entry-phone"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          hint={PHONE_HINT}
        />

        <ServiceStructuredFields section={section} steps={steps} cover={cover} onSteps={setSteps} onCover={setCover} />

        <fieldset className="grid gap-3">
          <legend className="text-sm font-semibold text-[color:var(--text)]">Official sources</legend>
          <p className={cn(textMuted, "text-xs leading-5")}>
            Links show where the information came from; they do not prove that a local workflow is current.
          </p>
          {sources.map((source, index) => (
            <div key={index} className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_3rem]">
              <TextField
                label={`Source ${index + 1} label`}
                hideLabel
                id={`service-entry-source-${index}-label`}
                placeholder="Publisher or document"
                value={source.label}
                onChange={(event) =>
                  setSources((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, label: event.target.value } : item,
                    ),
                  )
                }
              />
              <TextField
                label={`Source ${index + 1} URL`}
                hideLabel
                id={`service-entry-source-${index}-url`}
                type="url"
                placeholder="https://…"
                value={source.url}
                onChange={(event) =>
                  setSources((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, url: event.target.value } : item,
                    ),
                  )
                }
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove source ${index + 1}`}
                onClick={() => setSources((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                className="self-end px-0"
              >
                <Trash2 aria-hidden="true" className="size-icon-sm" />
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            icon={Plus}
            onClick={() => setSources((current) => [...current, { label: "", url: "" }])}
            className="justify-self-start"
          >
            Add source
          </Button>
        </fieldset>

        {kind === "operational" ? (
          <InlineNotice tone="neutral">
            Publishing makes this entry visible to service members immediately.
          </InlineNotice>
        ) : (
          <InlineNotice tone="neutral">
            Clinical and legal entries are sent to a different assigned reviewer before members can see them.
          </InlineNotice>
        )}

        <p className={cn(textMuted, "text-sm")} data-testid="service-entry-save-note">
          Draft saves do not change the published date. Publishing sets Updated; Still correct records a separate
          confirmation.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Button
            type="submit"
            variant="secondary"
            busy={busy === "draft"}
            busyLabel="Saving…"
            disabled={busy !== null}
          >
            Save draft
          </Button>
          <Button
            type="button"
            variant="primary"
            busy={busy === "publish"}
            busyLabel="Sending…"
            disabled={busy !== null}
            onClick={() => void submit(true)}
          >
            {kind === "operational" ? "Publish" : "Send for review"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy !== null}>
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
