import { logger } from "@/lib/logger";
import { PublicApiError } from "@/lib/http";
import { EPAS, epa as getEpaContent, type EpaNumber } from "@/lib/teaching/assessments/content";
import {
  buildMagicLinkRecord,
  EPA_MAGIC_LINK_TTL_DAYS,
  EpaMagicLinkError,
  generateRandomToken,
  hashEpaMagicToken,
  validateEpaMagicLinkSubmission,
  type CreateEpaMagicLinkInput,
  type EpaMagicLinkCompletedSubmission,
  type EpaMagicLinkRecord,
  type EpaMagicLinkSubmission,
} from "@/lib/teaching/assessments/magic-link";

/*
 * Durable store for visiting-supervisor EPA feedback links (#MAAXAX), in
 * `public.teaching_epa_magic_links` through the service-role admin client.
 *
 * Only the SHA-256 of a token is stored. The doctor who made a link is the only
 * account that can list or cancel it; the supervisor reaches it by token alone.
 * What the supervisor sends is feedback for the doctor to copy into CLA, kept on
 * the link's own row, never an assessment record.
 */

/** A doctor may have this many links waiting at once, so a loop cannot fill the table. */
export const EPA_MAGIC_LINK_MAX_PENDING = 20;
/** The most links a doctor's list returns, newest first. */
const LIST_LIMIT = 50;

export type EpaMagicLinkRow = {
  id: string;
  registrar_id: string;
  token_hash: string;
  epa_number: number;
  trainee_name: string;
  supervisor_name: string;
  supervisor_role: string;
  clinical_setting: string | null;
  status: "pending" | "completed" | "revoked";
  response: EpaMagicLinkCompletedSubmission | null;
  created_at: string;
  expires_at: string;
  completed_at: string | null;
  revoked_at: string | null;
  updated_at: string;
};

type DbErrorLike = { message?: string; code?: string };
type QueryResult<T> = PromiseLike<{ data: T | null; error: DbErrorLike | null; count?: number | null }>;

type FilterBuilder<T> = QueryResult<T> & {
  eq(column: string, value: string): FilterBuilder<T>;
  gt(column: string, value: string): FilterBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): FilterBuilder<T>;
  limit(count: number): FilterBuilder<T>;
  select(columns?: string, options?: { count?: "exact"; head?: boolean }): FilterBuilder<T>;
  maybeSingle(): QueryResult<EpaMagicLinkRow>;
  single(): QueryResult<EpaMagicLinkRow>;
};

export type EpaMagicLinksTableClient = {
  from(table: "teaching_epa_magic_links"): {
    select(columns?: string, options?: { count?: "exact"; head?: boolean }): FilterBuilder<EpaMagicLinkRow[]>;
    insert(values: Omit<EpaMagicLinkRow, "id" | "created_at" | "completed_at" | "revoked_at" | "response">): {
      select(columns?: string): { single(): QueryResult<EpaMagicLinkRow> };
    };
    update(values: Partial<EpaMagicLinkRow>): FilterBuilder<EpaMagicLinkRow[]>;
  };
};

const COLUMNS =
  "id, registrar_id, token_hash, epa_number, trainee_name, supervisor_name, supervisor_role, clinical_setting, status, response, created_at, expires_at, completed_at, revoked_at, updated_at";

/** What the doctor sees in their list. Never the token or its hash. */
export type EpaMagicLinkSummary = {
  readonly id: string;
  readonly epaCode: string;
  readonly epaTitle: string;
  readonly supervisorName: string;
  readonly supervisorRole: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: "pending" | "completed" | "revoked" | "expired";
  readonly completedAt: string | null;
  readonly submission: EpaMagicLinkCompletedSubmission | null;
};

/** What the supervisor's page receives. No ids, no hash, no account details. */
export type EpaMagicLinkPublicRecord = Omit<EpaMagicLinkRecord, "id" | "tokenHash">;

export type DurableMagicLinkLookup =
  | { readonly ok: true; readonly request: EpaMagicLinkPublicRecord; readonly row: EpaMagicLinkRow }
  | {
      readonly ok: false;
      readonly status: 404 | 409 | 410;
      readonly code: "magic_link_not_found" | "magic_link_expired" | "magic_link_already_used" | "magic_link_revoked";
      readonly message: string;
    };

function databaseError(error: DbErrorLike | null): PublicApiError {
  logger.error("epa_magic_link_store_error", { code: error?.code ?? null });
  return new PublicApiError("Supervisor links are unavailable right now. Try again shortly.", 503, {
    code: "assessment_store_unavailable",
  });
}

function epaNumberOf(row: EpaMagicLinkRow): EpaNumber {
  return (row.epa_number >= 1 && row.epa_number <= 4 ? row.epa_number : 1) as EpaNumber;
}

function displayStatus(row: EpaMagicLinkRow, now: Date): EpaMagicLinkSummary["status"] {
  if (row.status !== "pending") return row.status;
  return now.getTime() > Date.parse(row.expires_at) ? "expired" : "pending";
}

export function rowToSummary(row: EpaMagicLinkRow, now: Date = new Date()): EpaMagicLinkSummary {
  const epaNumber = epaNumberOf(row);
  return {
    id: row.id,
    epaCode: `EPA ${epaNumber}`,
    epaTitle: (getEpaContent(epaNumber) ?? EPAS[0]!).title,
    supervisorName: row.supervisor_name,
    supervisorRole: row.supervisor_role,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: displayStatus(row, now),
    completedAt: row.completed_at,
    submission: row.status === "completed" ? row.response : null,
  };
}

export function rowToPublicRecord(row: EpaMagicLinkRow, now: Date = new Date()): EpaMagicLinkPublicRecord {
  const epaNumber = epaNumberOf(row);
  const info = getEpaContent(epaNumber) ?? EPAS[0]!;
  const status = displayStatus(row, now);
  return {
    epaNumber,
    epaCode: `EPA ${epaNumber}`,
    epaTitle: info.title,
    epaFormal: info.formal,
    epaDetail: info.detail,
    traineeName: row.trainee_name,
    supervisorName: row.supervisor_name,
    supervisorRole: row.supervisor_role,
    clinicalSetting: row.clinical_setting,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: status === "revoked" ? "expired" : status,
    completedAt: row.completed_at,
    submission: row.status === "completed" ? row.response : null,
  };
}

function isUsableToken(token: string): boolean {
  return token.length >= 24 && token.length <= 128 && /^[A-Za-z0-9_-]+$/.test(token);
}

export class DurableEpaMagicLinkRepository {
  private readonly db: EpaMagicLinksTableClient;

  constructor(client: unknown) {
    this.db = client as EpaMagicLinksTableClient;
  }

  /** Makes a link for the signed-in doctor. The raw token is returned once and never stored. */
  async create(
    registrarId: string,
    input: Omit<CreateEpaMagicLinkInput, "now" | "ttlDays" | "persist">,
    now: Date = new Date(),
  ): Promise<{ token: string; urlPath: string; link: EpaMagicLinkSummary }> {
    const { count, error: countError } = await this.db
      .from("teaching_epa_magic_links")
      .select("id", { count: "exact", head: true })
      .eq("registrar_id", registrarId)
      .eq("status", "pending")
      .gt("expires_at", now.toISOString());
    if (countError) throw databaseError(countError);
    if ((count ?? 0) >= EPA_MAGIC_LINK_MAX_PENDING) {
      throw new EpaMagicLinkError(
        `You have ${EPA_MAGIC_LINK_MAX_PENDING} links waiting. Cancel one before sending another.`,
        "magic_link_limit_reached",
        409,
      );
    }

    const token = generateRandomToken(32);
    const tokenHash = hashEpaMagicToken(token);
    // Builds the same record the in-memory story uses, so the patient-detail and EPA checks match.
    const record = buildMagicLinkRecord(tokenHash, { ...input, now, ttlDays: EPA_MAGIC_LINK_TTL_DAYS });
    const { data, error } = await this.db
      .from("teaching_epa_magic_links")
      .insert({
        registrar_id: registrarId,
        token_hash: tokenHash,
        epa_number: record.epaNumber,
        trainee_name: record.traineeName,
        supervisor_name: record.supervisorName,
        supervisor_role: record.supervisorRole,
        clinical_setting: record.clinicalSetting,
        status: "pending",
        expires_at: record.expiresAt,
        updated_at: now.toISOString(),
      })
      .select(COLUMNS)
      .single();
    if (error || !data) throw databaseError(error);
    logger.info("epa_magic_link_created", { epaNumber: record.epaNumber, expiresAt: record.expiresAt });
    return { token, urlPath: `/teaching/assessments/respond/${token}`, link: rowToSummary(data, now) };
  }

  async listForRegistrar(registrarId: string, now: Date = new Date()): Promise<EpaMagicLinkSummary[]> {
    const { data, error } = await this.db
      .from("teaching_epa_magic_links")
      .select(COLUMNS)
      .eq("registrar_id", registrarId)
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT);
    if (error) throw databaseError(error);
    return (data ?? []).map((row) => rowToSummary(row, now));
  }

  /** Cancels one of the doctor's own waiting links. False when it is not theirs or no longer waiting. */
  async revoke(registrarId: string, id: string, now: Date = new Date()): Promise<boolean> {
    const { data, error } = await this.db
      .from("teaching_epa_magic_links")
      .update({ status: "revoked", revoked_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("id", id)
      .eq("registrar_id", registrarId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw databaseError(error);
    if (data) logger.info("epa_magic_link_revoked", { method: "owner" });
    return Boolean(data);
  }

  async lookup(token: string, now: Date = new Date()): Promise<DurableMagicLinkLookup> {
    const trimmed = token.trim();
    const notFound = {
      ok: false,
      status: 404,
      code: "magic_link_not_found",
      message: "That assessment link was not found.",
    } as const;
    if (!isUsableToken(trimmed)) return notFound;
    const { data, error } = await this.db
      .from("teaching_epa_magic_links")
      .select(COLUMNS)
      .eq("token_hash", hashEpaMagicToken(trimmed))
      .maybeSingle();
    if (error) throw databaseError(error);
    if (!data) return notFound;
    if (data.status === "completed") {
      return {
        ok: false,
        status: 409,
        code: "magic_link_already_used",
        message: "This EPA feedback link has already been used.",
      };
    }
    if (data.status === "revoked") {
      return {
        ok: false,
        status: 410,
        code: "magic_link_revoked",
        message: "The doctor cancelled this link. Ask them to send a fresh one.",
      };
    }
    if (now.getTime() > Date.parse(data.expires_at)) {
      return {
        ok: false,
        status: 410,
        code: "magic_link_expired",
        message: "This EPA feedback link has expired. Ask the doctor to send a fresh link.",
      };
    }
    return { ok: true, request: rowToPublicRecord(data, now), row: data };
  }

  /**
   * Stores the supervisor's answer once. The update only matches a link that is still waiting and
   * unexpired, so two sends at once cannot both land.
   */
  async submit(
    token: string,
    submission: EpaMagicLinkSubmission,
    now: Date = new Date(),
  ): Promise<
    | { ok: true; request: EpaMagicLinkPublicRecord }
    | { ok: false; status: 400 | 404 | 409 | 410; code: string; message: string }
  > {
    const found = await this.lookup(token, now);
    if (!found.ok) return found;
    const checked = validateEpaMagicLinkSubmission(submission, found.row.supervisor_name);
    if (!checked.ok) return { ok: false, status: 400, code: checked.code, message: checked.message };

    const submittedAt = now.toISOString();
    const response: EpaMagicLinkCompletedSubmission = { ...checked.value, submittedAt };
    const { data, error } = await this.db
      .from("teaching_epa_magic_links")
      .update({ status: "completed", response, completed_at: submittedAt, updated_at: submittedAt })
      .eq("token_hash", found.row.token_hash)
      .eq("status", "pending")
      .gt("expires_at", submittedAt)
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw databaseError(error);
    if (!data) {
      // Lost a race with another send, a cancel or the expiry: report what the link is now.
      const after = await this.lookup(token, now);
      return after.ok
        ? { ok: false, status: 409, code: "magic_link_already_used", message: "This link changed. Reload it." }
        : after;
    }
    logger.info("epa_magic_link_completed", { epaNumber: data.epa_number });
    return { ok: true, request: rowToPublicRecord(data, now) };
  }
}
