import type { ReactNode } from "react";

/**
 * Canonical privacy-page governance copy.
 *
 * Wording is pinned by `tests/privacy-ui.test.ts`. Presentation (page chrome,
 * accordion, processing map) may change; these strings and the
 * `<strong>` spacing on "not a patient-record system" must not drift.
 *
 * Everything here is a claim about *configured application behaviour* that a
 * reader can check against the repository, or expressly qualified, time-stamped
 * provider-account evidence. Contractual posture — data-processing agreements,
 * provider retention terms, zero-retention arrangements — is an operator matter
 * this page deliberately does not assert. See
 * `docs/privacy-impact-assessment.md` and `docs/openai-cross-border-basis.md`.
 */

export const PRIVACY_DRAFT_DISCLAIMER =
  "This is draft product information based on how PsychSift is set up. It is not legal advice, a final privacy policy, or an assertion of governance approval.";

/**
 * ISO date the copy below was last checked against the repository. Rendered as
 * "Describes how PsychSift is set up as of 1 September 2026" — deliberately not
 * "reviewed", which would imply a governance sign-off that PIA-5 records as
 * still outstanding.
 */
export const PRIVACY_CONTENT_AS_OF = "2026-09-01";

export const PRIVACY_IMPORTANT_SHORT =
  "Do not enter identifiable patient details. Processing may include Singapore and the OpenAI API.";

export const PRIVACY_IMPORTANT_FULL =
  "Do not enter identifiable patient details such as names, dates of birth, or record numbers. Requests are processed by the application service in Singapore. With external provider mode configured, question text may be sent to the OpenAI API for retrieval embedding even when the final response is source-only; model-backed answer synthesis also sends the question and selected evidence.";

export const PRIVACY_CLOSING_NOTE =
  "This page describes how the application is configured, not an agreement with you. Report a suspected privacy or access problem through your organisation's approved process.";

export type PrivacySectionId =
  | "what-this-tool-is"
  | "what-is-collected"
  | "how-questions-are-handled"
  | "where-data-is-stored"
  | "external-providers"
  | "who-can-access"
  | "in-this-browser"
  | "retention"
  | "third-parties"
  | "your-responsibilities";

export type PrivacySection = {
  /** Stable slug — the anchor `/privacy#retention` and the accordion's key. */
  id: PrivacySectionId;
  heading: string;
  short: string;
  gist: string;
  /** One entry per paragraph. The panel owns the `<p>`, so bodies never nest one. */
  body: ReactNode[];
};

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    id: "what-this-tool-is",
    heading: "What this tool is",
    short: "Tool",
    gist: "Clinical reference KB — not a patient-record system",
    body: [
      "For this restricted ingestion pilot, only administrators upload licensed public clinical references and wholly invented examples. Do not submit real or deidentified patient cases, patient identifiers or voice. User-private uploads are outside this pilot. This pilot does not establish approval for other features or data uses.",
      <>
        PsychSift is a knowledge base over clinical reference material. It is{" "}
        <strong>not a patient-record system</strong> and its provider-backed features do not ask for patient
        identifiers. The Safety Plan Generator accepts sensitive working content and support contacts but deliberately
        omits a patient-identifier field.
      </>,
      "Treat it as a clinical reference prototype rather than validated clinical decision support. Answers are grounded in the indexed documents and carry citations back to them, and when generation cannot meet the app's quality checks the response degrades to a deterministic source-only answer that still cites real documents. Either way, open the linked source before acting on anything clinical.",
    ],
  },
  {
    id: "what-is-collected",
    heading: "What is collected",
    short: "Collected",
    gist: "Questions, docs, telemetry — safety-plan work stays in-tab",
    body: [
      "Questions, generated answers, account identifiers, uploaded documents, retrieved excerpts, document metadata, and operational or retrieval telemetry may be processed. Free text and uploaded material can contain sensitive information if you enter it. Safety-plan working content is different: it remains in the current browser tab and is not sent to the application service or stored by PsychSift.",
      "Clinical Ask accepts a typed or dictated question and non-identifying Case Context. It cannot guarantee that text is de-identified: identifier-shaped input is blocked as a warning aid, not transformed or certified. Review the transcript and remove identifiable details before asking.",
      "Signing in creates an account record held by the authentication provider. Saved favourites and display preferences are stored against that account so they follow you between devices; they describe how you use the app, not who your patients are.",
    ],
  },
  {
    id: "how-questions-are-handled",
    heading: "How questions are handled",
    short: "Questions",
    gist: "Hashed logs · answers omitted · tab threads up to 12 hours",
    body: [
      <>
        Raw question text is not written to query logs by default; logs use a keyed one-way hash. Generated answer text
        is also omitted from durable query logs by default. A short-lived response cache can contain the answer while
        its read TTL is valid. To make recent answers reappear quickly, completed answer threads may also remain in this
        browser tab for up to 12 hours. That tab-only copy stays in this tab, is not shared across tabs or devices, and
        is never sent to the application service.
      </>,
      "Clinical Ask keeps its draft, transcript, Case Context, clarification answers, and response in ephemeral page memory for the current tab. Raw Clinical Ask content is not placed in the URL or browser history and is not attached to feedback or content-free telemetry. Clearing the case, signing out, changing account, refreshing, or closing the tab discards that in-memory session.",
    ],
  },
  {
    id: "where-data-is-stored",
    heading: "Where data is stored and processed",
    short: "Regions",
    gist: "Sydney storage · Singapore app + worker",
    body: [
      "Documents, extracted evidence, metadata, account records, and owner-scoped operational records are stored in the configured Supabase project in Sydney. The production application and ingestion worker currently run on Railway in Singapore, so questions, retrieved evidence, answers, and ingestion material are processed in or transit through Singapore. File buckets are private and links are time-limited. The operator must verify deployed regions and contractual controls.",
    ],
  },
  {
    id: "external-providers",
    heading: "External provider processing",
    short: "Providers",
    gist: "OpenAI embedding / synthesis may leave Australia",
    body: [
      "Administrator ingestion can send selected reference text to the OpenAI API to create retrieval embeddings. The native PDF path in this pilot sends extracted text for embeddings; it does not send PDF files or images to OpenAI.",
      <>
        When external provider mode is configured, question text may be sent to the OpenAI API to create a retrieval
        embedding, including when the final response is source-only. When model-backed answer synthesis is used, the
        question and selected source excerpts are also sent. This processing may occur outside Australia. The operator
        must verify provider regions, retention terms, contracts, and cross-border obligations.
      </>,
      "The requests the app sends carry deliberate limits: it asks the provider not to retain the response in the provider's own stored-response history, it never sends your raw account identifier — a keyed pseudonym is used instead when the operator configures one — and it asks for the shortest prompt-cache lifetime the model supports. OpenAI states that prompt-cache data may remain on its local GPU machines for up to 24 hours; the app's requested 30-minute lifetime is a minimum cache lifetime, not that maximum or a deletion deadline.",
      "As an interim provider control, the OpenAI organisation inspected on 1 September 2026 has API data sharing and API call logging disabled, and its hosted MCP, web search, file search, image generation, code interpreter, and container-network access disabled. The operator has submitted a Zero Data Retention request, but OpenAI has not yet approved it, and the operator has not yet proved that the production key targets the inspected project. Until approved and configured, OpenAI's standard API controls may retain customer content in abuse-monitoring logs for up to 30 days. These controls reduce optional provider-side processing but do not establish Zero Data Retention, endpoint coverage, or a data-processing agreement.",
      "Those are application settings, and they are the limit of what this page can tell you. Whether a data-processing agreement, a zero-retention arrangement, or a particular storage region is in place for the provider account is an operator and legal matter that the application cannot observe or promise.",
      "Clinical Ask supports server-side external authority search only for an evidence gap, unresolved conflict, staleness, or a source marked needs review. That hosted-search path is disabled in the inspected provider project while governance review is incomplete. If an operator enables it later, returned authority extracts are discarded after the request; the answer retains attributable citations and retrieval dates. This does not mean an authority, source, answer, or feature has received clinical or governance approval.",
    ],
  },
  {
    id: "who-can-access",
    heading: "Who can access your data",
    short: "Access",
    gist: "Shared public corpus · owner-scoped rows · private buckets",
    body: [
      "There are two tiers here, and the difference matters. Reference documents the operator has published to the shared public corpus are searchable, retrievable, and citable by every account, and by anyone who reaches the site without signing in. That is deliberate: the corpus is intended to hold guideline and reference material, not patient data, and it is what the search and answer features read. The controlled ingestion pilot includes bounded malware and identifier-shaped-content checks and source-specific validation. These limited checks do not guarantee de-identification, completeness, suitability or detection of all hidden content. Operators remain responsible for checking the material and their authority to process and publish it.",
      "Everything else stays with its account. Uploading documents is an administrator action, so an ordinary signed-in account holds its log rows and saved items rather than uploads, and a document that has not been published stays with the administrator account that uploaded it. Those rows are stamped with the account that owns them, the server scopes every read to that owner, and database row-level security stands behind it for anything reaching the database directly, so another signed-in user cannot search, retrieve, or cite them. Publishing a document into the shared corpus is an operator action; another user cannot trigger it. The operator can also publish the corpus as a whole rather than document by document: a single service-role switch suspends the per-document approval requirement and makes every stored document public at once, and the same switch reverses it.",
      "Document and image files sit in private storage buckets with no direct browser access. A file opens through a short-lived link that the server mints only after checking that the parent record is either one your account owns or one published to the shared public corpus, and those links expire after ten minutes by default. Within that window the link is usable by anyone holding it, so treat a copied link as the document itself.",
      "Administrative access is a separate question from user access. Server-side work such as ingestion runs with elevated database credentials that are never exposed to the browser, and privileged actions are written to an append-only audit record. The operator of the deployment can also reach stored data through the database provider's own console; who holds that access is an operator control, not an application one.",
    ],
  },
  {
    id: "in-this-browser",
    heading: "What stays in this browser",
    short: "Browser",
    gist: "Session, preferences, recent searches, 12-hour threads",
    body: [
      "Some things never reach the application service because they stay on this device. Your sign-in session, the light or dark theme, display preferences, and saved-item shortcuts are held by this browser. Recent searches use per-tab session storage and disappear when the tab closes. Completed answer threads are kept for up to 12 hours so a recent answer reappears quickly.",
      "Safety-plan working content is stricter again: it exists only in the page's memory while the generator is open, and is discarded when you clear it or close the tab.",
      "Clinical Ask audio is held only long enough to record, upload for transcription, or offer an in-memory retry. The browser recording and retry copy are disposed after transcription, cancellation, clear case, account change, or unmount. Audio is not put into URLs, browser storage, feedback, or telemetry by PsychSift.",
      "You can clear this from inside the app. Settings, under Privacy and security, clears recent searches and saved items; New chat clears the current answer thread; signing out clears the thread and the session; clearing site data in your browser removes the rest. None of that affects documents or logs already stored on the server.",
    ],
  },
  {
    id: "retention",
    heading: "Retention",
    short: "Retention",
    gist: "30-day queries · 90-day logs · hourly cache purge",
    body: [
      "Repository migrations configure 30-day retention for RAG query records, 90-day retention for retrieval logs and query-miss telemetry, and a bounded hourly purge of expired response-cache rows. The operator verified the four expected schedules on production and staging and approved that evidence on 1 September 2026. Uploaded documents remain until removed under the applicable process. Completed answer threads in the current browser tab expire no later than 12 hours after the most recent answer and are also cleared by New chat, sign-out, or an account change. Safety-plan working content has no PsychSift retention: it is discarded when the component is cleared or the tab is closed. Clipboard, print, and PDF copies are outside the app and must follow the organisation's approved record-handling process.",
      "Memory-only Clinical Ask handling is not a zero-retention promise for providers or network infrastructure. Provider retention, regional processing, the separately deployable feedback migration, clinical evaluation, and production readiness must each be verified by the responsible operator before launch.",
      "Audit records are the deliberate exception: they are append-only and retained indefinitely by design, because an access trail that expires cannot answer a later question about who reached what.",
    ],
  },
  {
    id: "third-parties",
    heading: "Third parties involved",
    short: "Third parties",
    gist: "Supabase · Railway · OpenAI · optional error monitoring",
    body: [
      "PsychSift is assembled from three providers, each holding a different part of the system. Supabase hosts the database, the private file storage, and authentication, in its Sydney region. Railway runs the application and the ingestion worker in Singapore. OpenAI, in the United States, creates retrieval embeddings and, when model-backed synthesis is used, generates the answer text.",
      "A fourth is optional. When the operator configures server-side error monitoring, error and performance events are sent to that service with request URLs, headers, bodies, account data, and exception messages stripped before they leave the application; browser session replay is not enabled.",
      "Provider regions, sub-processors, retention terms, and contractual cover are operator responsibilities. This section describes which providers the application is configured to use, not what has been agreed with each of them.",
    ],
  },
  {
    id: "your-responsibilities",
    heading: "Your responsibilities",
    short: "You",
    gist: "No identifiers · verify sources · report issues",
    body: [
      "Do not enter patient-identifiable information. In the Safety Plan Generator, add any patient identifier only after export through your organisation's approved clinical-record process. If your account has administrator upload access, upload only material you are authorised to use. Keep access credentials private, review original linked sources before relying on clinical output, and report suspected privacy or access issues through your organisation's approved process.",
    ],
  },
];

export type PrivacyTone = "accent" | "neutral" | "warn";

export type PrivacyFact = {
  label: string;
  value: string;
  tone: PrivacyTone;
  /** The section that explains this fact — the tile opens it. */
  sectionId: PrivacySectionId;
};

/**
 * The answer layer. Every one of these was previously reachable only by opening
 * the right accordion section and reading a paragraph of prose.
 */
export const PRIVACY_AT_A_GLANCE: PrivacyFact[] = [
  {
    label: "Documents and logs at rest",
    value: "Sydney, Australia",
    tone: "accent",
    sectionId: "where-data-is-stored",
  },
  { label: "Application and worker", value: "Singapore", tone: "neutral", sectionId: "where-data-is-stored" },
  { label: "AI provider", value: "OpenAI, United States", tone: "warn", sectionId: "external-providers" },
  {
    label: "Question text in logs",
    value: "Keyed hash · 30 days",
    tone: "neutral",
    sectionId: "how-questions-are-handled",
  },
  { label: "Retrieval telemetry", value: "90 days", tone: "neutral", sectionId: "retention" },
  { label: "Answer threads in this tab", value: "Up to 12 hours", tone: "neutral", sectionId: "in-this-browser" },
  {
    label: "Safety-plan working content",
    value: "Never leaves this tab",
    tone: "accent",
    sectionId: "in-this-browser",
  },
];

export const PRIVACY_PROCESSING_MAP = [
  {
    place: "Sydney",
    role: "Supabase storage",
    carries: "Documents, evidence, logs, accounts",
    tone: "accent" as const,
  },
  {
    place: "Singapore",
    role: "App + worker",
    carries: "Questions and uploads in transit",
    tone: "neutral" as const,
  },
  {
    place: "External",
    role: "OpenAI API",
    carries: "Question text and excerpts · United States",
    tone: "warn" as const,
  },
];
