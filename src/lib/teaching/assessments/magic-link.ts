import {
  CASE_COMPLEXITIES,
  EPA_OBSERVED,
  EPAS,
  SUPERVISION_LEVELS,
  epa as getEpaContent,
  type CaseComplexity,
  type EpaNumber,
  type EpaObserved,
  type SupervisionLevel,
} from "@/lib/teaching/assessments/content";
import { EPA_FEEDBACK_MAX, GUEST_KINDS, type GuestKind } from "@/lib/teaching/assessments/model";
import { checkPatientDetail } from "@/lib/work-text/patient-detail-check";

export const EPA_MAGIC_LINK_TTL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type EpaCode = EpaNumber | "EPA 1" | "EPA 2" | "EPA 3" | "EPA 4" | "EPA1" | "EPA2" | "EPA3" | "EPA4" | string;

export type EpaMagicLinkCompletedSubmission = {
  readonly level: SupervisionLevel;
  readonly complexity: CaseComplexity | null;
  readonly observed: EpaObserved;
  readonly strengths: string;
  readonly improvements: string;
  readonly assessorName: string;
  readonly submittedAt: string;
};

export type EpaMagicLinkRecord = {
  readonly id: string;
  readonly tokenHash: string;
  readonly epaNumber: EpaNumber;
  readonly epaCode: string;
  readonly epaTitle: string;
  readonly epaFormal: string;
  readonly epaDetail: string;
  readonly traineeName: string;
  readonly supervisorName: string;
  readonly supervisorRole: string;
  readonly clinicalSetting: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: "pending" | "completed" | "expired";
  readonly completedAt: string | null;
  readonly submission: EpaMagicLinkCompletedSubmission | null;
};

export type CreateEpaMagicLinkInput = {
  readonly epaCode: EpaCode;
  readonly traineeName: string;
  readonly supervisorName: string;
  readonly supervisorRole?: GuestKind | string;
  readonly clinicalSetting?: string | null;
  readonly now?: Date;
  readonly ttlDays?: number;
};

export type EpaMagicLinkSubmission = {
  readonly level?: SupervisionLevel | null;
  readonly entrustmentLevel?: SupervisionLevel | null;
  readonly complexity?: CaseComplexity | null;
  readonly observed?: EpaObserved | null;
  readonly strengths?: string | null;
  readonly note?: string | null;
  readonly improvements?: string | null;
  readonly better?: string | null;
  readonly assessorName?: string | null;
};

export type EpaMagicLinkLookupResult =
  | {
      readonly ok: true;
      readonly status: "pending";
      readonly request: EpaMagicLinkRecord;
    }
  | {
      readonly ok: false;
      readonly status: "not_found" | "expired" | "completed";
      readonly code: "magic_link_not_found" | "magic_link_expired" | "magic_link_already_used";
      readonly message: string;
      readonly request?: EpaMagicLinkRecord;
    };

export type EpaMagicLinkSubmitResult =
  | {
      readonly ok: true;
      readonly status: "completed";
      readonly request: EpaMagicLinkRecord;
    }
  | {
      readonly ok: false;
      readonly status: "not_found" | "expired" | "completed" | "invalid";
      readonly code:
        | "magic_link_not_found"
        | "magic_link_expired"
        | "magic_link_already_used"
        | "patient_detail_detected"
        | "invalid_submission";
      readonly message: string;
    };

// Standard FIPS 180-4 SHA-256 round constants (isomorphic across browser and Node.js).
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/**
 * Compute the lowercase hex SHA-256 digest of a magic-link token.
 * Raw tokens are never stored at rest; only this digest is persisted in the store.
 */
export function hashEpaMagicToken(token: string): string {
  const bytes = new TextEncoder().encode(token.trim());
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => word.toString(16).padStart(8, "0")).join("");
}

const URL_SAFE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function generateRandomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += URL_SAFE_ALPHABET[bytes[i]! & 63]!;
  }
  return out;
}

function normalizeEpaNumber(code: EpaCode): EpaNumber {
  if (typeof code === "number" && (code === 1 || code === 2 || code === 3 || code === 4)) {
    return code;
  }
  const trimmed = String(code).trim();
  const match = trimmed.match(/^(?:EPA\s*)?([1-4])$/i);
  if (!match) {
    throw new EpaMagicLinkError("Choose a valid EPA code (EPA 1 to EPA 4).", "invalid_epa_code", 400);
  }
  return Number(match[1]) as EpaNumber;
}

function normalizeRoleLabel(role: GuestKind | string | undefined): string {
  if (!role) return "External supervisor";
  const matched = GUEST_KINDS.find((kind) => kind.id === role);
  if (matched) return matched.title;
  return role.trim() || "External supervisor";
}

const MAX_MAGIC_LINKS = 2000;

const globalMagicLinks = globalThis as unknown as {
  __psychsiftEpaMagicLinks?: Map<string, EpaMagicLinkRecord>;
  __psychsiftEpaMagicRateLimits?: Map<string, { windowStartMs: number; count: number; resetAtMs: number }>;
};

const magicLinkStore = (globalMagicLinks.__psychsiftEpaMagicLinks ??= new Map<string, EpaMagicLinkRecord>());
const magicRateLimitStore = (globalMagicLinks.__psychsiftEpaMagicRateLimits ??= new Map<
  string,
  { windowStartMs: number; count: number; resetAtMs: number }
>());

function getNodePersistenceFilePath(): string | null {
  if (typeof window !== "undefined") return null;
  if (typeof process === "undefined" || !process.versions?.node) return null;
  const tempRoot = process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp";
  return `${tempRoot.replace(/[\\/]+$/, "")}/psychsift-epa-magic-links.json`;
}

function loadPersistedMagicLinksIntoStore(): void {
  const filePath = getNodePersistenceFilePath();
  if (!filePath) return;
  try {
    const req = (0, eval)("require") as (id: string) => {
      existsSync: (p: string) => boolean;
      readFileSync: (p: string, enc: string) => string;
    };
    const fs = req("node:fs");
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, EpaMagicLinkRecord>;
    if (!parsed || typeof parsed !== "object") return;
    for (const [hash, record] of Object.entries(parsed)) {
      const current = magicLinkStore.get(hash);
      if (!current || (current.status !== "completed" && record.status === "completed")) {
        magicLinkStore.set(hash, record);
      }
    }
  } catch {
    // Non-fatal fallback to in-memory map in restricted environments
  }
}

function persistMagicLinksFromStore(): void {
  const filePath = getNodePersistenceFilePath();
  if (!filePath) return;
  try {
    const req = (0, eval)("require") as (id: string) => {
      writeFileSync: (p: string, data: string, enc: string) => void;
    };
    const fs = req("node:fs");
    const serialized: Record<string, EpaMagicLinkRecord> = {};
    for (const [hash, record] of magicLinkStore.entries()) {
      serialized[hash] = record;
    }
    fs.writeFileSync(filePath, JSON.stringify(serialized), "utf8");
  } catch {
    // Non-fatal fallback to in-memory map in restricted environments
  }
}

export class EpaMagicLinkError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: { code: string };

  constructor(message: string, code = "magic_link_patient_details", status = 400) {
    super(message);
    this.name = "EpaMagicLinkError";
    this.code = code;
    this.status = status;
    this.details = { code };
  }
}

function evictMagicLinkStoreIfNeeded(now: Date) {
  if (magicLinkStore.size < MAX_MAGIC_LINKS) return;
  const nowMs = now.getTime();
  for (const [key, entry] of magicLinkStore.entries()) {
    if (entry.status === "expired" || nowMs > Date.parse(entry.expiresAt)) {
      magicLinkStore.delete(key);
    }
  }
  if (magicLinkStore.size >= MAX_MAGIC_LINKS) {
    for (const [key, entry] of magicLinkStore.entries()) {
      if (magicLinkStore.size < MAX_MAGIC_LINKS) break;
      if (entry.status !== "completed") {
        magicLinkStore.delete(key);
      }
    }
  }
  while (magicLinkStore.size >= MAX_MAGIC_LINKS) {
    const oldestKey = magicLinkStore.keys().next().value;
    if (oldestKey === undefined) break;
    magicLinkStore.delete(oldestKey);
  }
}

function assertSafeMagicLinkRequestInput(input: CreateEpaMagicLinkInput) {
  const checks: Array<{ value: string | null | undefined; allowName: boolean }> = [
    { value: input.traineeName, allowName: true },
    { value: input.supervisorName, allowName: true },
    { value: input.clinicalSetting, allowName: false },
  ];
  for (const item of checks) {
    const text = item.value?.trim();
    if (!text) continue;
    const problem = checkPatientDetail(text, { allowName: item.allowName, allowCapitals: true });
    if (problem) {
      throw new EpaMagicLinkError(problem.body, "magic_link_patient_details", 400);
    }
  }
}

function buildMagicLinkRecord(tokenHash: string, input: CreateEpaMagicLinkInput): EpaMagicLinkRecord {
  assertSafeMagicLinkRequestInput(input);
  const now = input.now ?? new Date();
  const ttlDays = input.ttlDays ?? EPA_MAGIC_LINK_TTL_DAYS;
  const epaNumber = normalizeEpaNumber(input.epaCode);
  const info = getEpaContent(epaNumber) ?? EPAS[0]!;
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlDays * DAY_MS).toISOString();

  return {
    id: `epa-link-${tokenHash.slice(0, 12)}`,
    tokenHash,
    epaNumber,
    epaCode: `EPA ${epaNumber}`,
    epaTitle: info.title,
    epaFormal: info.formal,
    epaDetail: info.detail,
    traineeName: input.traineeName.trim() || "Trainee Doctor",
    supervisorName: input.supervisorName.trim() || "External Supervisor",
    supervisorRole: normalizeRoleLabel(input.supervisorRole),
    clinicalSetting: input.clinicalSetting?.trim() || null,
    createdAt,
    expiresAt,
    status: "pending",
    completedAt: null,
    submission: null,
  };
}

export function createEpaMagicLinkRequest(input: CreateEpaMagicLinkInput): {
  readonly token: string;
  readonly tokenHash: string;
  readonly urlPath: string;
  readonly expiresAt: string;
  readonly request: EpaMagicLinkRecord;
} {
  loadPersistedMagicLinksIntoStore();
  const now = input.now ?? new Date();
  const token = generateRandomToken(32);
  const tokenHash = hashEpaMagicToken(token);
  const record = buildMagicLinkRecord(tokenHash, { ...input, now });

  evictMagicLinkStoreIfNeeded(now);
  magicLinkStore.set(tokenHash, record);
  persistMagicLinksFromStore();

  return {
    token,
    tokenHash,
    urlPath: `/teaching/assessments/respond/${token}`,
    expiresAt: record.expiresAt,
    request: record,
  };
}

export function registerEpaMagicLinkRecord(token: string, input: CreateEpaMagicLinkInput): EpaMagicLinkRecord {
  loadPersistedMagicLinksIntoStore();
  const trimmed = token.trim();
  if (!trimmed || trimmed.length < 24 || !/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new EpaMagicLinkError("Check the assessment link token and try again.", "invalid_magic_link_token", 400);
  }
  const now = input.now ?? new Date();
  const tokenHash = hashEpaMagicToken(trimmed);
  const existing = magicLinkStore.get(tokenHash);
  if (existing) {
    throw new EpaMagicLinkError("This EPA assessment link has already been issued.", "magic_link_already_issued", 409);
  }
  const record = buildMagicLinkRecord(tokenHash, { ...input, now });
  evictMagicLinkStoreIfNeeded(now);
  magicLinkStore.set(tokenHash, record);
  persistMagicLinksFromStore();
  return record;
}

export type PublicMagicLinkRateLimitBucket = "teaching-epa-magic-link-read" | "teaching-epa-magic-link-write";

export function consumePublicApiRateLimit(
  request: Request,
  bucket: PublicMagicLinkRateLimitBucket,
  nowMs: number = Date.now(),
): {
  limited: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: string;
} {
  const limit = bucket === "teaching-epa-magic-link-read" ? 60 : 20;
  const windowMs = 60_000;
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1);
  const ip = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown-ip";
  const key = `${bucket}:${ip}`;

  const existing = magicRateLimitStore.get(key);
  if (existing && nowMs >= existing.resetAtMs) {
    magicRateLimitStore.delete(key);
  }
  if (magicRateLimitStore.size >= MAX_MAGIC_LINKS) {
    for (const [k, v] of magicRateLimitStore.entries()) {
      if (nowMs >= v.resetAtMs) magicRateLimitStore.delete(k);
    }
  }

  const current = magicRateLimitStore.get(key);
  const windowStartMs = current && nowMs - current.windowStartMs < windowMs ? current.windowStartMs : nowMs;
  const count = (current && current.windowStartMs === windowStartMs ? current.count : 0) + 1;
  const resetAtMs = windowStartMs + windowMs;
  magicRateLimitStore.set(key, { windowStartMs, count, resetAtMs });

  return {
    limited: count > limit,
    limit,
    remaining: Math.max(limit - count, 0),
    retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000)),
    resetAt: new Date(resetAtMs).toISOString(),
  };
}

export function getEpaMagicLinkByToken(token: string, now: Date = new Date()): EpaMagicLinkLookupResult {
  loadPersistedMagicLinksIntoStore();
  const trimmed = token.trim();
  if (!trimmed || trimmed.length < 16) {
    return {
      ok: false,
      status: "not_found",
      code: "magic_link_not_found",
      message: "That assessment link was not found.",
    };
  }
  const tokenHash = hashEpaMagicToken(trimmed);
  const record = magicLinkStore.get(tokenHash);
  if (!record) {
    return {
      ok: false,
      status: "not_found",
      code: "magic_link_not_found",
      message: "That assessment link was not found.",
    };
  }
  if (record.status === "completed") {
    return {
      ok: false,
      status: "completed",
      code: "magic_link_already_used",
      message: "This EPA assessment link has already been submitted.",
      request: record,
    };
  }
  if (now.getTime() > Date.parse(record.expiresAt)) {
    const expiredRecord: EpaMagicLinkRecord = { ...record, status: "expired" };
    magicLinkStore.set(tokenHash, expiredRecord);
    persistMagicLinksFromStore();
    return {
      ok: false,
      status: "expired",
      code: "magic_link_expired",
      message: "This EPA assessment link has expired. Ask the doctor to send a fresh link.",
      request: expiredRecord,
    };
  }
  return {
    ok: true,
    status: "pending",
    request: record,
  };
}

const VALID_LEVELS = new Set<SupervisionLevel>(SUPERVISION_LEVELS.map((item) => item.id));
const VALID_COMPLEXITIES = new Set<CaseComplexity>(CASE_COMPLEXITIES.map((item) => item.id));
const VALID_OBSERVED = new Set<EpaObserved>(EPA_OBSERVED.map((item) => item.id));

export function submitEpaMagicLinkResponse(
  token: string,
  submission: EpaMagicLinkSubmission,
  now: Date = new Date(),
): EpaMagicLinkSubmitResult {
  const lookup = getEpaMagicLinkByToken(token, now);
  if (!lookup.ok) {
    return {
      ok: false,
      status: lookup.status,
      code: lookup.code,
      message: lookup.message,
    };
  }

  const level = submission.level ?? submission.entrustmentLevel ?? null;
  if (!level || !VALID_LEVELS.has(level)) {
    return {
      ok: false,
      status: "invalid",
      code: "invalid_submission",
      message: "Choose a supervision level first.",
    };
  }

  const complexity = submission.complexity ?? null;
  if (complexity !== null && !VALID_COMPLEXITIES.has(complexity)) {
    return {
      ok: false,
      status: "invalid",
      code: "invalid_submission",
      message: "Choose a valid case complexity.",
    };
  }

  const observed = submission.observed ?? "direct";
  if (!VALID_OBSERVED.has(observed)) {
    return {
      ok: false,
      status: "invalid",
      code: "invalid_submission",
      message: "Choose how the clinical interaction was observed.",
    };
  }

  const strengths = (submission.strengths ?? submission.note ?? "").trim();
  const improvements = (submission.improvements ?? submission.better ?? "").trim();
  const assessorName = (submission.assessorName ?? lookup.request.supervisorName).trim();

  if (strengths.length > EPA_FEEDBACK_MAX || improvements.length > EPA_FEEDBACK_MAX) {
    return {
      ok: false,
      status: "invalid",
      code: "invalid_submission",
      message: `Keep feedback under ${EPA_FEEDBACK_MAX} characters.`,
    };
  }

  for (const text of [strengths, improvements]) {
    if (!text) continue;
    const problem = checkPatientDetail(text);
    if (problem) {
      return {
        ok: false,
        status: "invalid",
        code: "patient_detail_detected",
        message: problem.body,
      };
    }
  }

  if (assessorName) {
    const nameProblem = checkPatientDetail(assessorName, { allowCapitals: true });
    if (nameProblem) {
      return {
        ok: false,
        status: "invalid",
        code: "patient_detail_detected",
        message: nameProblem.body,
      };
    }
  }

  const submittedAt = now.toISOString();
  const completedRecord: EpaMagicLinkRecord = {
    ...lookup.request,
    status: "completed",
    completedAt: submittedAt,
    submission: {
      level,
      complexity,
      observed,
      strengths,
      improvements,
      assessorName: assessorName || lookup.request.supervisorName,
      submittedAt,
    },
  };

  magicLinkStore.set(lookup.request.tokenHash, completedRecord);
  persistMagicLinksFromStore();

  return {
    ok: true,
    status: "completed",
    request: completedRecord,
  };
}
