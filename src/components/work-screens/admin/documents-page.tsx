"use client";

import {
  Download,
  ExternalLink,
  FilePlus2,
  FileText,
  FolderOpen,
  IdCard,
  Plus,
  Search,
  Share2,
  Trash2,
  History,
} from "lucide-react";
import { useMemo, useState } from "react";

import { AdminCredentialsWallet } from "@/components/admin/admin-credentials-wallet";
import { AdminLoadFailed } from "@/components/admin/admin-load-failed";
import { PageTitleUnderBand } from "@/components/mode-band/mode-band";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkChip,
  WorkChips,
  WorkDock,
  WorkEmpty,
  WorkIconRow,
  WorkSectionLabel,
  WorkTag,
} from "@/components/mode-kit/work";
import { Sheet } from "@/components/ui/sheet";
import { cn, fieldControlWithIcon, fieldIcon, fieldLabel } from "@/components/ui-primitives";
import {
  anyPatientProblem,
  PaperworkDemoNotice,
  PaperworkField,
  PaperworkFootNote,
  PaperworkOfflineNote,
  PaperworkSampleNotice,
  PaperworkStorageNote,
  PaperworkUnsavedNote,
  usePaperworkHeading,
  usePaperworkPage,
  usePaperworkSay,
} from "@/components/work-screens/admin/paperwork-shared";
import { downloadTextFile } from "@/lib/admin/download-file";
import { isOnCallHttpUrl } from "@/lib/on-call/entry-model";
import { ADMIN_PAGE_HREFS } from "@/lib/admin/page-hrefs";
import { perthDateOf } from "@/lib/roster/shifts/perth-time";
import {
  DOCUMENT_FOLDER_WORDS,
  DOCUMENT_STATE_WORDS,
  documentCounts,
  documentFolders,
  documentFromDraft,
  documentLine,
  documentsListText,
  documentState,
  renewalProofs,
  validateDocumentDraft,
  type DocumentDraft,
} from "@/lib/work-screens/admin/documents";
import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";
import { documentsSample, isExampleRecord, withoutExampleRecords } from "@/lib/work-screens/admin/sample";
import { firstAdminPatientProblem } from "@/lib/work-screens/admin/patient-check";
import {
  DOCUMENT_FOLDERS,
  dropRecord,
  newPaperworkId,
  putBack,
  type AdminDocument,
  type AdminPaperwork,
} from "@/lib/work-screens/admin/paperwork-model";

function blankDraft(document?: AdminDocument): DocumentDraft {
  return {
    title: document?.title ?? "",
    folder: document?.folder ?? "certificates",
    issuedOn: document?.issuedOn ?? "",
    expiresOn: document?.expiresOn ?? "",
    keptAt: document?.keptAt ?? "",
    url: document?.url ?? "",
    note: document?.note ?? "",
  };
}

/**
 * Admin · Documents (`/admin/documents`, mockup `admin_docs`, `admin_upload`):
 * the doctor's own work documents, as a list of where each one is kept. The
 * files themselves never come into PsychSift.
 */
export function AdminDocumentsPage({ now: pinned }: { now?: Date } = {}) {
  usePaperworkHeading("Documents", "Private until you share it");
  const page = usePaperworkPage(documentsSample);
  const { store, online } = page;
  const say = usePaperworkSay();
  const today = perthDateOf(pinned ?? new Date());
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ document: AdminDocument | null } | null>(null);
  const [failed, setFailed] = useState(false);

  const record = store.state;
  const documents = useMemo(() => record?.documents ?? [], [record]);
  const folders = documentFolders(documents, query);
  const counts = documentCounts(documents, today);
  const proofs = useMemo(() => renewalProofs(page.signedOut ? [] : page.own), [page.signedOut, page.own]);

  function change(next: (current: AdminPaperwork) => AdminPaperwork): boolean {
    const ok = store.update(next);
    setFailed(!ok);
    return ok;
  }
  function save(draft: DocumentDraft, existing: AdminDocument | null) {
    const saved = documentFromDraft(draft, existing?.id ?? newPaperworkId("doc"), existing?.addedOn ?? today);
    const ok = change((current) => ({
      ...current,
      documents: existing
        ? current.documents.map((item) => (item.id === saved.id ? saved : item))
        : [saved, ...current.documents],
    }));
    if (!ok) return;
    setEditing(null);
    // Undo touches this one document only, never a change made since.
    say(existing ? "Document saved" : `${saved.title} added`, () =>
      change((current) => ({
        ...current,
        documents: existing ? putBack(current.documents, existing) : dropRecord(current.documents, saved.id),
      })),
    );
  }
  function remove(document: AdminDocument) {
    const index = documents.findIndex((item) => item.id === document.id);
    if (!change((current) => ({ ...current, documents: dropRecord(current.documents, document.id) }))) return;
    setEditing(null);
    say(`${document.title} removed`, () =>
      change((current) => ({ ...current, documents: putBack(current.documents, document, index) })),
    );
  }
  function saveList() {
    const own = withoutExampleRecords(documents);
    const problem = firstAdminPatientProblem(
      own.flatMap((document) => [document.title, document.keptAt, document.note, document.url]),
      { allowCapitals: true },
    );
    if (problem) {
      say(`${problem.title} in your list. Nothing was saved. Edit that document first.`, undefined, "warning");
      return;
    }
    downloadTextFile(documentsListText(own, today), `psychsift-documents-${today}.txt`, "text/plain;charset=utf-8");
    say("List saved. It has no files in it, only where they are");
  }

  return (
    <WorkBody testId="admin-documents">
      <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
        Documents
      </PageTitleUnderBand>
      {page.signedOut ? <PaperworkSampleNotice what="document list" testId="admin-documents-signed-out" /> : null}
      {page.demo ? <PaperworkDemoNotice testId="admin-documents-demo" /> : null}
      {!online ? (
        <PaperworkOfflineNote testId="admin-documents-offline">
          You are offline. Your list is on this phone and still works. Links open when you have signal.
        </PaperworkOfflineNote>
      ) : null}
      {failed ? <PaperworkUnsavedNote testId="admin-documents-unsaved" /> : null}
      <PaperworkStorageNote store={store} testId="admin-documents-storage" />

      {record === null ? (
        <ModeModuleSkeleton rows={4} twoLine eyebrow testId="admin-documents-loading" />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2" data-testid="admin-documents-counts">
            <CountTile value={counts.total} label="Listed" />
            <CountTile value={counts.endsSoon} label="Ends soon" />
            <CountTile value={counts.datePassed} label="Date passed" />
          </div>

          {documents.length > 3 ? (
            <div className="relative">
              <label htmlFor="admin-documents-search" className="sr-only">
                Find a document
              </label>
              <Search aria-hidden="true" className={fieldIcon} />
              <input
                id="admin-documents-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a document"
                className={cn(fieldControlWithIcon, "min-h-12")}
                data-testid="admin-documents-search"
              />
            </div>
          ) : null}

          {documents.length === 0 ? (
            <WorkCard>
              <WorkEmpty
                icon={FolderOpen}
                title="No documents listed yet"
                body="Add your contract, registration and certificates, with where each one is kept."
                action={
                  <WorkButton
                    icon={Plus}
                    onClick={() => setEditing({ document: null })}
                    testId="admin-documents-empty-add"
                  >
                    Add a document
                  </WorkButton>
                }
                testId="admin-documents-empty"
              />
            </WorkCard>
          ) : folders.length === 0 ? (
            <WorkCard>
              <WorkEmpty
                icon={Search}
                title="Nothing matches"
                body={`No document matches “${query.trim()}”.`}
                action={
                  <WorkButton variant="secondary" onClick={() => setQuery("")}>
                    Clear
                  </WorkButton>
                }
                testId="admin-documents-no-match"
              />
            </WorkCard>
          ) : (
            folders.map((view) => (
              <section
                key={view.folder}
                aria-labelledby={`admin-documents-${view.folder}`}
                className="grid gap-[inherit]"
              >
                <WorkSectionLabel id={`admin-documents-${view.folder}`} count={view.documents.length}>
                  {view.label}
                </WorkSectionLabel>
                <WorkCard testId={`admin-documents-folder-${view.folder}`}>
                  {view.documents.map((document) => {
                    const state = documentState(document, today);
                    return (
                      <WorkIconRow
                        key={document.id}
                        icon={FileText}
                        title={document.title}
                        sub={`${isExampleRecord(document) ? "Example · " : ""}${documentLine(document)}`}
                        end={
                          state === "current" || state === "no-end-date" ? undefined : (
                            <WorkTag tone="neutral">{DOCUMENT_STATE_WORDS[state]}</WorkTag>
                          )
                        }
                        onClick={() => setEditing({ document })}
                        testId="admin-documents-row"
                      />
                    );
                  })}
                </WorkCard>
              </section>
            ))
          )}

          {withoutExampleRecords(documents).length > 0 ? (
            <WorkButton variant="secondary" icon={Download} onClick={saveList} testId="admin-documents-download">
              Save the list
            </WorkButton>
          ) : null}
        </>
      )}

      <WorkSectionLabel
        count={page.signedOut || page.entriesState !== "ready" ? undefined : `${proofs.missing} without proof`}
      >
        From Renewals
      </WorkSectionLabel>
      {page.signedOut ? (
        <WorkCard padded>
          <p className="text-sm">Signed in, the proof notes and links you saved in Renewals show here too.</p>
        </WorkCard>
      ) : page.entriesState === "loading" ? (
        <ModeModuleSkeleton rows={2} twoLine testId="admin-documents-renewals-loading" />
      ) : page.entriesState === "failed" ? (
        <AdminLoadFailed
          reason={page.entries.loadError}
          onRetry={page.entries.retry}
          testId="admin-documents-renewals-failed"
        />
      ) : proofs.withProof.length === 0 ? (
        <WorkCard>
          <WorkIconRow
            icon={History}
            title="No proof saved in Renewals yet"
            sub="Add a note or link to a renewal and it shows here"
            href={ADMIN_PAGE_HREFS.renewals}
          />
        </WorkCard>
      ) : (
        <WorkCard testId="admin-documents-renewals">
          {proofs.withProof.map((proof) =>
            proof.url ? (
              <a
                key={proof.id}
                href={proof.url}
                target="_blank"
                rel="noreferrer noopener"
                className="work-row"
                data-testid="admin-documents-proof-link"
              >
                <span className="work-row__text">
                  <span className="work-row__title">{proof.title}</span>
                  <span className="work-row__sub">{proof.line}</span>
                </span>
                <ExternalLink aria-hidden="true" className="work-row__chev" strokeWidth={2} />
                <span className="sr-only">, opens your link in a new tab</span>
              </a>
            ) : (
              <WorkIconRow key={proof.id} icon={History} title={proof.title} sub={proof.line} href={proof.href} />
            ),
          )}
        </WorkCard>
      )}

      {!page.signedOut && !page.demo && page.entriesState === "ready" ? (
        <>
          <WorkSectionLabel>Your numbers</WorkSectionLabel>
          <AdminCredentialsWallet testId="admin-documents-wallet" />
        </>
      ) : null}

      <WorkSectionLabel>Related</WorkSectionLabel>
      <WorkCard>
        <WorkIconRow
          icon={IdCard}
          title="Credential pack"
          sub="Your numbers and dates as one PDF"
          href="/admin/new-job/pack"
        />
        <WorkIconRow
          icon={Share2}
          title="Sharing"
          sub="What you would share, and the pack"
          href={ADMIN_WORK_SCREEN_HREFS.sharing}
        />
        <WorkIconRow icon={History} title="Renewals" sub="Dates and reminders" href={ADMIN_PAGE_HREFS.renewals} />
      </WorkCard>

      <PaperworkFootNote testId="admin-documents-footnote">
        PsychSift keeps this list on this phone, never the files. Keep each file in your own storage.
      </PaperworkFootNote>

      {record !== null ? (
        <WorkDock aria-label="Documents actions">
          <WorkButton icon={FilePlus2} onClick={() => setEditing({ document: null })} testId="admin-documents-add">
            Add a document
          </WorkButton>
        </WorkDock>
      ) : null}

      {editing ? (
        <DocumentSheet
          document={editing.document}
          onClose={() => setEditing(null)}
          onSave={(draft) => save(draft, editing.document)}
          onRemove={editing.document ? () => remove(editing.document!) : undefined}
        />
      ) : null}
    </WorkBody>
  );
}

function CountTile({ value, label }: { readonly value: number; readonly label: string }) {
  return (
    <div className="work-card work-card--pad grid min-w-0 gap-0.5 text-center">
      <b className="nums text-xl font-semibold text-[color:var(--text-heading)]">{value}</b>
      <small className="text-xs text-[color:var(--text-muted)]">{label}</small>
    </div>
  );
}

function DocumentSheet({
  document,
  onClose,
  onSave,
  onRemove,
}: {
  readonly document: AdminDocument | null;
  readonly onClose: () => void;
  readonly onSave: (draft: DocumentDraft) => void;
  readonly onRemove?: () => void;
}) {
  const [draft, setDraft] = useState<DocumentDraft>(() => blankDraft(document ?? undefined));
  const [tried, setTried] = useState(false);
  const errors = validateDocumentDraft(draft);
  const blocked = Object.values(errors).some(Boolean) || anyPatientProblem(draft.title, draft.keptAt, draft.note);
  const set = <K extends keyof DocumentDraft>(key: K, value: DocumentDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <Sheet
      open
      onClose={onClose}
      title={document ? "Edit document" : "Add a document"}
      description="Where it is kept. The file stays with you."
      testId="admin-documents-sheet"
      footer={
        <div className="grid gap-2">
          <WorkButton
            size="wide"
            onClick={() => {
              setTried(true);
              if (!blocked) onSave(draft);
            }}
            testId="admin-documents-save"
          >
            Save
          </WorkButton>
          {document?.url && isOnCallHttpUrl(document.url) ? (
            <a
              href={document.url}
              target="_blank"
              rel="noreferrer noopener"
              className="work-button"
              data-variant="secondary"
              data-size="wide"
              data-testid="admin-documents-open-link"
            >
              <ExternalLink aria-hidden="true" strokeWidth={2} />
              Open your copy
              <span className="sr-only">, opens in a new tab</span>
            </a>
          ) : null}
          {onRemove ? (
            <WorkButton size="wide" variant="quiet" icon={Trash2} onClick={onRemove} testId="admin-documents-remove">
              Remove from the list
            </WorkButton>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-4">
        <PaperworkField
          label="Document"
          value={draft.title}
          onChange={(value) => set("title", value)}
          maxLength={80}
          error={tried ? errors.title : null}
          checkPatient
          testId="admin-documents-title"
        />
        <div className="grid gap-1.5">
          <p className={fieldLabel}>Folder</p>
          <WorkChips label="Folder">
            {DOCUMENT_FOLDERS.map((folder) => (
              <WorkChip
                key={folder}
                selected={draft.folder === folder}
                onClick={() => set("folder", folder)}
                testId={`admin-documents-folder-chip-${folder}`}
              >
                {DOCUMENT_FOLDER_WORDS[folder]}
              </WorkChip>
            ))}
          </WorkChips>
        </div>
        <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
          <PaperworkField
            label="Issued · optional"
            type="date"
            value={draft.issuedOn}
            onChange={(value) => set("issuedOn", value)}
            testId="admin-documents-issued"
          />
          <PaperworkField
            label="Ends · optional"
            type="date"
            value={draft.expiresOn}
            onChange={(value) => set("expiresOn", value)}
            error={tried ? errors.expiresOn : null}
            testId="admin-documents-expires"
          />
        </div>
        <PaperworkField
          label="Kept in · optional"
          value={draft.keptAt}
          onChange={(value) => set("keptAt", value)}
          maxLength={80}
          hint="For example OneDrive, email or the Ahpra portal"
          checkPatient
          testId="admin-documents-kept"
        />
        <PaperworkField
          label="Link · optional"
          type="url"
          inputMode="url"
          value={draft.url}
          onChange={(value) => set("url", value)}
          maxLength={400}
          error={tried ? errors.url : null}
          hint="A link to your own copy. It opens only for you."
          testId="admin-documents-url"
        />
        <PaperworkField
          label="Note · optional"
          value={draft.note}
          onChange={(value) => set("note", value)}
          maxLength={120}
          checkPatient
          testId="admin-documents-note"
        />
      </div>
    </Sheet>
  );
}
