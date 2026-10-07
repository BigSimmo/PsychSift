"use client";

import {
  ClipboardList,
  Copy,
  Download,
  Eye,
  FileText,
  Inbox,
  Mail,
  Receipt,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { AdminLoadFailed } from "@/components/admin/admin-load-failed";
import { PageTitleUnderBand } from "@/components/mode-band/mode-band";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { WorkBody, WorkButton, WorkCard, WorkEmpty, WorkIconRow, WorkSectionLabel } from "@/components/mode-kit/work";
import { Sheet } from "@/components/ui/sheet";
import {
  RECIPIENT_CHECK,
  recipientProblem,
  PaperworkDemoNotice,
  PaperworkField,
  PaperworkFootNote,
  PaperworkOfflineNote,
  PaperworkSampleNotice,
  PaperworkSwitch,
  PaperworkUnsavedNote,
  usePaperworkHeading,
  usePaperworkPage,
  usePaperworkSay,
} from "@/components/work-screens/admin/paperwork-shared";
import { buildComplianceOverview } from "@/lib/admin/compliance-overview";
import { downloadTextFile } from "@/lib/admin/download-file";
import { ADMIN_PAGE_HREFS } from "@/lib/admin/page-hrefs";
import { formatRecordedDate } from "@/lib/admin/renewal-dates";
import { ADMIN_REQUIREMENTS_CATALOGUE } from "@/lib/admin/requirements";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { perthDateOf } from "@/lib/roster/shifts/perth-time";
import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";
import { sharingSample } from "@/lib/work-screens/admin/sample";
import {
  emptyPaperwork,
  newPaperworkId,
  SHARE_GROUPS,
  type AdminPaperwork,
  type ShareGroup,
  type ShareMethod,
} from "@/lib/work-screens/admin/paperwork-model";
import {
  buildSharePack,
  recentShareLog,
  shareGroupViews,
  shareLogLine,
  shareMailtoHref,
  sharePackFileName,
  type ShareAudience,
  type SharePack,
} from "@/lib/work-screens/admin/sharing";

/**
 * Admin · Sharing (`/admin/sharing`, mockup `admin_send`, `admin_seen`,
 * `admin_connect`): what the doctor has chosen to share and with whom, and the
 * pack they send themselves. Sharing straight from PsychSift to a health
 * service is not live, and the page says so first.
 */
export function AdminSharingPage({ now: pinned }: { now?: Date } = {}) {
  usePaperworkHeading("Sharing", "Not live yet · you send it yourself");
  const page = usePaperworkPage(sharingSample);
  const { store, entriesState, own, online } = page;
  const say = usePaperworkSay();
  const now = useMemo(() => pinned ?? new Date(), [pinned]);
  const [preview, setPreview] = useState<SharePack | null>(null);
  const [recipientOpen, setRecipientOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  const record = store.state;
  const sharing = record?.sharing ?? emptyPaperwork().sharing;
  // Signed out, the sample shows the statewide list with nothing recorded, never invented dates.
  const signedOut = page.signedOut;
  const overview = useMemo(
    () => buildComplianceOverview(ADMIN_REQUIREMENTS_CATALOGUE, signedOut ? [] : own, now, null),
    [signedOut, own, now],
  );
  const views = useMemo(() => shareGroupViews(overview, sharing), [overview, sharing]);
  const recordsReady = page.signedOut || entriesState === "ready";
  const workforcePack = recordsReady
    ? buildSharePack({ views, audience: "workforce", recipient: sharing.recipient, now })
    : null;
  const healthPack = recordsReady
    ? buildSharePack({ views, audience: "staff-health", recipient: sharing.recipient, now })
    : null;
  const onCount = views.filter((view) => view.on).length;

  const change = useCallback(
    (next: (current: AdminPaperwork) => AdminPaperwork) => {
      const ok = store.update(next);
      setFailed(!ok);
      return ok;
    },
    [store],
  );

  function toggle(group: ShareGroup) {
    const before = sharing.groups[group] === true;
    if (
      !change((current) => ({
        ...current,
        sharing: { ...current.sharing, groups: { ...current.sharing.groups, [group]: !before } },
      }))
    )
      return;
    const label = views.find((view) => view.group === group)?.label ?? "Item";
    say(`${label} ${before ? "off" : "on"}`, () =>
      change((current) => ({
        ...current,
        sharing: { ...current.sharing, groups: { ...current.sharing.groups, [group]: before } },
      })),
    );
  }

  function allOff() {
    const before = sharing.groups;
    if (!change((current) => ({ ...current, sharing: { ...current.sharing, groups: {} } }))) return;
    say("Everything switched off", () =>
      change((current) => ({ ...current, sharing: { ...current.sharing, groups: before } })),
    );
  }

  function logShare(pack: SharePack, method: ShareMethod) {
    change((current) => ({
      ...current,
      sharing: {
        ...current.sharing,
        log: [
          {
            id: newPaperworkId("share"),
            on: perthDateOf(new Date()),
            to: pack.to,
            method,
            groups: [...pack.groups],
            itemCount: pack.itemCount,
          },
          ...current.sharing.log,
        ].slice(0, 50),
      },
    }));
  }

  function removeLog(id: string) {
    const before = sharing.log;
    if (
      !change((current) => ({
        ...current,
        sharing: { ...current.sharing, log: current.sharing.log.filter((entry) => entry.id !== id) },
      }))
    )
      return;
    say("Note removed", () => change((current) => ({ ...current, sharing: { ...current.sharing, log: before } })));
  }

  function download(pack: SharePack) {
    downloadTextFile(pack.text, sharePackFileName(pack, now), "text/plain");
    logShare(pack, "download");
    say(`File saved. Attach it to your message to ${pack.to}.`);
  }

  async function copy(pack: SharePack) {
    try {
      await copyTextToClipboard(pack.text);
      logShare(pack, "copy");
      say(`Copied. Paste it into your message to ${pack.to}. Nothing was sent.`);
    } catch {
      say("Could not copy. Your browser blocked the clipboard. Save the file instead.", undefined, "warning");
    }
  }

  function sendActions(pack: SharePack, audience: ShareAudience) {
    const email = audience === "workforce" ? sharing.recipientEmail : undefined;
    return (
      <div className="grid gap-2 p-3">
        <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
          <WorkButton
            variant="secondary"
            icon={Eye}
            onClick={() => setPreview(pack)}
            testId={`admin-sharing-${audience}-preview`}
          >
            Preview
          </WorkButton>
          <WorkButton
            variant="secondary"
            icon={Download}
            onClick={() => download(pack)}
            testId={`admin-sharing-${audience}-download`}
          >
            Save the file
          </WorkButton>
          <WorkButton
            variant="secondary"
            icon={Copy}
            onClick={() => void copy(pack)}
            testId={`admin-sharing-${audience}-copy`}
          >
            Copy the text
          </WorkButton>
          <a
            href={shareMailtoHref(pack, email)}
            onClick={() => logShare(pack, "email")}
            className="work-button"
            data-variant="secondary"
            data-testid={`admin-sharing-${audience}-email`}
          >
            <Mail aria-hidden="true" strokeWidth={2} />
            Email draft
          </a>
        </div>
        <p className="text-xs text-[color:var(--text-muted)]">
          {`${pack.itemCount} ${pack.itemCount === 1 ? "item" : "items"} for ${pack.to}. The email opens in your own mail app.`}
        </p>
      </div>
    );
  }

  const log = recentShareLog(sharing.log);

  return (
    <WorkBody testId="admin-sharing">
      <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
        Sharing
      </PageTitleUnderBand>
      {page.signedOut ? <PaperworkSampleNotice what="sharing choices" testId="admin-sharing-signed-out" /> : null}
      {page.demo ? <PaperworkDemoNotice testId="admin-sharing-demo" /> : null}

      <WorkCard padded testId="admin-sharing-not-live">
        <p className="text-sm font-semibold text-[color:var(--text-heading)]">Not live yet</p>
        <p className="mt-1 text-sm text-[color:var(--text)]">
          PsychSift cannot send your records to a health service yet. That needs new storage and Josh&apos;s approval.
          For now, choose what you would share and send the pack yourself.
        </p>
      </WorkCard>

      {!online ? (
        <PaperworkOfflineNote testId="admin-sharing-offline">
          You are offline. Your choices are kept on this phone. The pack needs your records, which load when you have
          signal.
        </PaperworkOfflineNote>
      ) : null}
      {failed ? <PaperworkUnsavedNote testId="admin-sharing-unsaved" /> : null}

      <WorkSectionLabel>Share with</WorkSectionLabel>
      <WorkCard>
        <WorkIconRow
          icon={Users}
          title={sharing.recipient}
          sub={sharing.recipientEmail ? sharing.recipientEmail : "No email added. The draft opens with no address."}
          end={<span className="text-sm font-semibold text-[color:var(--mode-identity)]">Change</span>}
          onClick={() => setRecipientOpen(true)}
          testId="admin-sharing-recipient"
        />
        <WorkIconRow icon={ShieldCheck} title="Staff Health" sub="Health items go here only" />
      </WorkCard>

      <WorkSectionLabel count={record ? `${onCount} of ${views.length || SHARE_GROUPS.length} on` : undefined}>
        What you would share
      </WorkSectionLabel>
      {record === null || (!page.signedOut && entriesState === "loading") ? (
        <ModeModuleSkeleton rows={5} twoLine testId="admin-sharing-loading" />
      ) : !page.signedOut && entriesState === "failed" ? (
        <AdminLoadFailed
          reason={page.entries.loadError}
          onRetry={page.entries.retry}
          testId="admin-sharing-load-failed"
        />
      ) : (
        <>
          <WorkCard as="ul" testId="admin-sharing-groups">
            {views.map((view) => (
              <li key={view.group} className="work-row" data-testid={`admin-sharing-group-${view.group}`}>
                <span className="work-row__text">
                  <span className="work-row__title">{view.label}</span>
                  <span className="work-row__sub">
                    {`${view.audience === "staff-health" ? "To Staff Health only" : `To ${sharing.recipient}`} · ${view.recorded} of ${view.items.length} recorded`}
                  </span>
                  <span className="work-row__sub">{view.what}</span>
                </span>
                <PaperworkSwitch
                  on={view.on}
                  label={`Share ${view.label} ${view.audience === "staff-health" ? "with Staff Health" : `with ${sharing.recipient}`}`}
                  onToggle={() => toggle(view.group)}
                  testId={`admin-sharing-switch-${view.group}`}
                />
              </li>
            ))}
          </WorkCard>
          {onCount > 0 ? (
            <WorkButton variant="quiet" icon={X} onClick={allOff} testId="admin-sharing-all-off">
              Switch everything off
            </WorkButton>
          ) : null}

          <WorkSectionLabel>Send it yourself</WorkSectionLabel>
          {!workforcePack && !healthPack ? (
            <WorkCard>
              <WorkEmpty
                icon={Send}
                title="Nothing switched on"
                body="Every switch starts off. Turn on what you want to share and the pack appears here."
                testId="admin-sharing-nothing-on"
              />
            </WorkCard>
          ) : null}
          {workforcePack ? (
            <WorkCard testId="admin-sharing-workforce-pack">
              <WorkIconRow
                icon={FileText}
                title={`Pack for ${workforcePack.to}`}
                sub="Your dates, with each status word"
              />
              {sendActions(workforcePack, "workforce")}
            </WorkCard>
          ) : null}
          {healthPack ? (
            <WorkCard testId="admin-sharing-health-pack">
              <WorkIconRow icon={ShieldCheck} title="Pack for Staff Health" sub="Health items only, kept apart" />
              {sendActions(healthPack, "staff-health")}
            </WorkCard>
          ) : null}
        </>
      )}

      <WorkSectionLabel count={log.length ? "Newest first" : undefined}>What you sent</WorkSectionLabel>
      <WorkCard testId="admin-sharing-log">
        {log.length === 0 ? (
          <WorkEmpty
            icon={Inbox}
            title="Nothing sent yet"
            body="Each time you save, copy or email a pack, a note appears here."
          />
        ) : (
          <ul className="work-rows">
            {log.map((entry) => (
              <li key={entry.id} className="work-row" data-testid="admin-sharing-log-row">
                <span className="work-row__text">
                  <span className="work-row__title">{`${entry.to} · ${formatRecordedDate(entry.on)}`}</span>
                  <span className="work-row__sub">{shareLogLine(entry)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeLog(entry.id)}
                  aria-label={`Remove the note for ${entry.to}, ${formatRecordedDate(entry.on)}`}
                  className="work-glass-button"
                  data-testid="admin-sharing-log-remove"
                >
                  <Trash2 aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </WorkCard>

      <WorkSectionLabel>They will not see</WorkSectionLabel>
      <WorkCard>
        <WorkIconRow icon={X} title="Anything you leave off" sub="Every switch starts off" />
        <WorkIconRow icon={Receipt} title="Pay, overtime and tax" sub="These stay on this phone" />
        <WorkIconRow icon={ShieldAlert} title="Health reasons" sub="Go to Staff Health only" />
      </WorkCard>

      <WorkSectionLabel>Related</WorkSectionLabel>
      <WorkCard>
        <WorkIconRow
          icon={ClipboardList}
          title="Compliance"
          sub="Every requirement and its date"
          href={ADMIN_PAGE_HREFS.compliance}
        />
        <WorkIconRow
          icon={Inbox}
          title="Requests"
          sub="Asks you send and track"
          href={ADMIN_WORK_SCREEN_HREFS.requests}
        />
        <WorkIconRow
          icon={FileText}
          title="Documents"
          sub="Where your files are kept"
          href={ADMIN_WORK_SCREEN_HREFS.documents}
        />
      </WorkCard>

      <PaperworkFootNote testId="admin-sharing-footnote">
        Your choices stay on this phone. PsychSift sends nothing. Files you already sent stay with whoever you sent them
        to.
      </PaperworkFootNote>

      <Sheet
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview ? `What ${preview.to} will see` : "Preview"}
        description="Exactly the text in the file and the draft"
        testId="admin-sharing-preview-sheet"
      >
        {preview ? (
          <pre className="whitespace-pre-wrap break-words rounded-[var(--work-radius-field)] border border-[color:var(--work-line)] bg-[color:var(--work-surface)] p-3 font-sans text-sm leading-6 text-[color:var(--text)]">
            {preview.text}
          </pre>
        ) : null}
      </Sheet>

      {recipientOpen ? (
        <RecipientSheet
          name={sharing.recipient}
          email={sharing.recipientEmail ?? ""}
          onClose={() => setRecipientOpen(false)}
          onSave={(name, email) => {
            const before = { recipient: sharing.recipient, recipientEmail: sharing.recipientEmail };
            const ok = change((current) => ({
              ...current,
              sharing: { ...current.sharing, recipient: name, recipientEmail: email || undefined },
            }));
            if (!ok) return false;
            setRecipientOpen(false);
            say("Saved", () => change((current) => ({ ...current, sharing: { ...current.sharing, ...before } })));
            return true;
          }}
        />
      ) : null}
    </WorkBody>
  );
}

function RecipientSheet({
  name: initialName,
  email: initialEmail,
  onClose,
  onSave,
}: {
  readonly name: string;
  readonly email: string;
  readonly onClose: () => void;
  readonly onSave: (name: string, email: string) => boolean;
}) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const trimmedEmail = email.trim();
  const emailError =
    trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail) ? "Check the email address." : null;
  const nameError = name.trim() ? null : "Type who you send it to.";
  const blocked = Boolean(emailError || nameError) || recipientProblem(name);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Who you share with"
      description="Used in the pack and the email draft"
      testId="admin-sharing-recipient-sheet"
      footer={
        <WorkButton
          size="wide"
          disabled={blocked}
          onClick={() => {
            if (!blocked) onSave(name.trim(), trimmedEmail);
          }}
          testId="admin-sharing-recipient-save"
        >
          Save
        </WorkButton>
      }
    >
      <div className="grid gap-3">
        <PaperworkField
          label="Team or person"
          value={name}
          onChange={setName}
          maxLength={60}
          error={nameError}
          checkPatient={RECIPIENT_CHECK}
          testId="admin-sharing-recipient-name"
        />
        <PaperworkField
          label="Email · optional"
          type="email"
          inputMode="email"
          value={email}
          onChange={setEmail}
          maxLength={120}
          error={emailError}
          hint="A work address. It stays on this phone."
          testId="admin-sharing-recipient-email"
        />
      </div>
    </Sheet>
  );
}
