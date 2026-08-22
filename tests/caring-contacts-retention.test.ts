// tests/caring-contacts-retention.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildAuditEvent, type AuditableChange } from "@/lib/caring-contacts/audit";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { actorId, idempotencyKey, pathwayVersionId, teamId } from "@/lib/caring-contacts/ids";
import {
  DEFAULT_RETENTION_POLICY,
  admitRetentionClearance,
  deidentifyAuditEvent,
  deidentifyEpisode,
  isDueForDeidentification,
  type Episode,
  type RetentionPolicy,
} from "@/lib/caring-contacts/retention";

const DOMAIN_ROOT = path.join(process.cwd(), "src", "lib", "caring-contacts");

/**
 * Ruling 26. The word-mention half of rule 1 below exempts the STORAGE LAYER, and only the storage
 * layer: `repository.ts` declares the storage contract, and `in-memory-repository.ts` and
 * `db/postgres-repository.ts` implement it. `markRetentionCleared` is a method on that contract,
 * so all three must be able to NAME the thing they store; renaming the method to dodge a regex
 * would be the tail wagging the dog.
 *
 * The exemption is narrow in both directions, and that is the whole point of it:
 *
 *   * the `years: 7` half of rule 1 is UNTOUCHED and still applies to these three files, so the
 *     literal period this file's title is about cannot appear in them;
 *   * these three additionally carry the COMPENSATING assertion below -- no line that mentions
 *     retention may also contain a digit -- which catches a hard-coded period spelled any other
 *     way (`RETENTION_YEARS = 7`, `retentionYears: 7`, `retention: { years: 7 }`) that the
 *     `years: 7` regex alone would miss.
 *
 * So an allowlisted file is checked MORE strictly than the rest of the domain, not less. Do not
 * add a file here to make a diff pass: a module outside the storage layer has no reason to name
 * retention at all, and the correct fix for one that does is to stop naming it.
 *
 * OPEN FOR THE OWNER (Task 11b): Ruling 26 as written named exactly `repository.ts` and
 * `in-memory-repository.ts`, because at the time it was made the Postgres store did not yet
 * implement `markRetentionCleared`. Task 11b implements it, which puts the word into the third
 * storage file for the same reason it is in the other two. Removing that entry is a one-line
 * revert if the owner rules the other way.
 */
const RETENTION_WORD_ALLOWLIST: readonly string[] = Object.freeze([
  "repository.ts",
  "in-memory-repository.ts",
  "postgres-repository.ts",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

function baseEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    state: "completed",
    patientName: "Jordan Nguyen",
    patientMobileNumber: "+61 491 570 156",
    patientIdentifiers: ["UR-00219384", "MRN-778213"],
    culturalIdentity: "Aboriginal",
    planDates: {
      dischargeAt: new Date("2019-08-05T02:00:00.000Z"),
      completedAt: new Date("2019-08-19T02:00:00.000Z"), // 2019-08-19 10:00 AWST
    },
    pathwayVersionId: pathwayVersionId("PATHWAY-1"),
    teamId: teamId("TEAM-1"),
    outcome: "completedFullCourse",
    counts: { contactsScheduled: 10, contactsSent: 10, contactsDelivered: 9 },
    ...overrides,
  };
}

function baseAuditEvent() {
  const change: AuditableChange = {
    actorId: actorId("ACTOR-1"),
    actorRoles: ["coordinator"],
    teamId: teamId("TEAM-1"),
    action: "generateClinicalRecordSummary",
    objectType: "plan",
    objectId: "PLAN-1",
    outcome: "allowed",
    idempotencyKey: idempotencyKey("IDEMP-1"),
  };
  return buildAuditEvent(change, fixedClock("2019-08-19T02:00:00.000Z"));
}

// ---------------------------------------------------------------------------
// Rule 1 — DEFAULT_RETENTION_POLICY is the sole hard-coded retention period
// ---------------------------------------------------------------------------

describe("rule 1: DEFAULT_RETENTION_POLICY", () => {
  it("is { years: 7 }", () => {
    expect(DEFAULT_RETENTION_POLICY).toEqual({ years: 7 });
  });

  it("is a plain value a caller may override without affecting the default", () => {
    const shorter: RetentionPolicy = { ...DEFAULT_RETENTION_POLICY, years: 1 };
    expect(shorter.years).toBe(1);
    expect(DEFAULT_RETENTION_POLICY.years).toBe(7);
  });

  it("is the only module in src/lib/caring-contacts that hard-codes a retention period", () => {
    const offences: string[] = [];
    for (const file of walk(DOMAIN_ROOT)) {
      if (path.basename(file) === "retention.ts") continue;
      const source = readFileSync(file, "utf8");
      const relative = path.relative(process.cwd(), file);
      // The storage layer may NAME retention (see RETENTION_WORD_ALLOWLIST); the period check
      // below still binds it, as does the stricter per-line check in the test that follows.
      if (!RETENTION_WORD_ALLOWLIST.includes(path.basename(file)) && /retention/i.test(source)) {
        offences.push(`${relative}: mentions "retention"`);
      }
      if (/\byears\s*:\s*7\b/.test(source)) offences.push(`${relative}: hard-codes "years: 7"`);
    }
    expect(offences).toEqual([]);
  });

  it("lets the storage layer name retention, but never on a line that also carries a number", () => {
    const offences: string[] = [];
    const inspected: string[] = [];

    for (const file of walk(DOMAIN_ROOT)) {
      const name = path.basename(file);
      if (!RETENTION_WORD_ALLOWLIST.includes(name)) continue;
      inspected.push(name);

      const relative = path.relative(process.cwd(), file);
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (!/retention/i.test(line)) return;
          if (!/\d/.test(line)) return;
          offences.push(`${relative}:${index + 1}: retention named beside a number -- ${line.trim()}`);
        });
    }

    // Positive control. Without it this assertion would go green on an allowlist that matched no
    // file at all -- after a rename, a move, or a deletion -- and the compensating check would be
    // silently decorative rather than merely wrong.
    expect(inspected.sort()).toEqual([...RETENTION_WORD_ALLOWLIST].sort());
    expect(offences).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — isDueForDeidentification
// ---------------------------------------------------------------------------

describe("rule 2: isDueForDeidentification", () => {
  it("is false one day before the retention period elapses (AWST)", () => {
    const episode = baseEpisode(); // completed 2019-08-19 (AWST)
    const oneDayShort = fixedClock("2026-08-18T02:00:00.000Z"); // 2026-08-18 AWST
    expect(isDueForDeidentification(episode, DEFAULT_RETENTION_POLICY, oneDayShort)).toBe(false);
  });

  it("is true exactly at the seven-year boundary (AWST)", () => {
    const episode = baseEpisode(); // completed 2019-08-19 (AWST)
    const exactlySeven = fixedClock("2026-08-19T02:00:00.000Z"); // 2026-08-19 AWST
    expect(isDueForDeidentification(episode, DEFAULT_RETENTION_POLICY, exactlySeven)).toBe(true);
  });

  it("stays true well past the boundary", () => {
    const episode = baseEpisode();
    const wellPast = fixedClock("2030-01-01T02:00:00.000Z");
    expect(isDueForDeidentification(episode, DEFAULT_RETENTION_POLICY, wellPast)).toBe(true);
  });

  it("respects an overridden, shorter policy", () => {
    const episode = baseEpisode();
    const oneYearLater = fixedClock("2020-08-19T02:00:00.000Z");
    expect(isDueForDeidentification(episode, { years: 1 }, oneYearLater)).toBe(true);
    expect(isDueForDeidentification(episode, DEFAULT_RETENTION_POLICY, oneYearLater)).toBe(false);
  });

  it.each(["draft", "active", "paused"] as const)(
    "is false for a non-terminal state (%s) no matter how much time has passed",
    (state) => {
      const episode = baseEpisode({ state });
      const farFuture = fixedClock("2099-01-01T00:00:00.000Z");
      expect(isDueForDeidentification(episode, DEFAULT_RETENTION_POLICY, farFuture)).toBe(false);
    },
  );

  it.each(["withdrawn", "cancelled", "completed"] as const)(
    "treats %s as a terminal state once its retention period elapses",
    (state) => {
      const episode = baseEpisode({ state });
      const exactlySeven = fixedClock("2026-08-19T02:00:00.000Z");
      expect(isDueForDeidentification(episode, DEFAULT_RETENTION_POLICY, exactlySeven)).toBe(true);
    },
  );

  it("is false for a terminal episode with no recorded completion instant", () => {
    const episode = baseEpisode({ planDates: { dischargeAt: baseEpisode().planDates.dischargeAt, completedAt: null } });
    const farFuture = fixedClock("2099-01-01T00:00:00.000Z");
    expect(isDueForDeidentification(episode, DEFAULT_RETENTION_POLICY, farFuture)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — deidentifyEpisode
// ---------------------------------------------------------------------------

describe("rule 3: deidentifyEpisode", () => {
  it("removes patient name, mobile, identifiers, and cultural identity", () => {
    const deidentified = deidentifyEpisode(baseEpisode()) as unknown as Record<string, unknown>;
    expect(deidentified).not.toHaveProperty("patientName");
    expect(deidentified).not.toHaveProperty("patientMobileNumber");
    expect(deidentified).not.toHaveProperty("patientIdentifiers");
    expect(deidentified).not.toHaveProperty("culturalIdentity");
  });

  it("retains plan dates, pathway version, team, outcome, and counts", () => {
    const original = baseEpisode();
    const deidentified = deidentifyEpisode(original);
    expect(deidentified.planDates).toEqual(original.planDates);
    expect(deidentified.pathwayVersionId).toBe(original.pathwayVersionId);
    expect(deidentified.teamId).toBe(original.teamId);
    expect(deidentified.outcome).toBe(original.outcome);
    expect(deidentified.counts).toEqual(original.counts);
  });

  it("is frozen", () => {
    const deidentified = deidentifyEpisode(baseEpisode());
    expect(Object.isFrozen(deidentified)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — deidentifyAuditEvent
// ---------------------------------------------------------------------------

describe("rule 4: deidentifyAuditEvent", () => {
  it("retains exactly the five named fields: actor, action, timestamp, object type, outcome", () => {
    const original = baseAuditEvent();
    const deidentified = deidentifyAuditEvent(original);

    expect(deidentified.actorId).toBe(original.actorId);
    expect(deidentified.action).toBe(original.action);
    expect(deidentified.timestamp).toBe(original.timestamp);
    expect(deidentified.objectType).toBe(original.objectType);
    expect(deidentified.outcome).toBe(original.outcome);
  });

  it("clears object id", () => {
    const original = baseAuditEvent();
    const deidentified = deidentifyAuditEvent(original);
    expect(deidentified.objectId).not.toBe(original.objectId);
    expect(deidentified.objectId).toBe("");
  });

  it("drops actor roles, team id, and idempotency key entirely", () => {
    const deidentified = deidentifyAuditEvent(baseAuditEvent()) as unknown as Record<string, unknown>;
    expect(deidentified).not.toHaveProperty("actorRoles");
    expect(deidentified).not.toHaveProperty("teamId");
    expect(deidentified).not.toHaveProperty("idempotencyKey");
  });

  it("is frozen", () => {
    const deidentified = deidentifyAuditEvent(baseAuditEvent());
    expect(Object.isFrozen(deidentified)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — idempotent de-identification
// ---------------------------------------------------------------------------

describe("rule 5: idempotent de-identification", () => {
  it("deidentifyEpisode applied twice equals applied once", () => {
    const once = deidentifyEpisode(baseEpisode());
    const twice = deidentifyEpisode(once);
    expect(twice).toEqual(once);
  });

  it("deidentifyAuditEvent applied twice equals applied once", () => {
    const once = deidentifyAuditEvent(baseAuditEvent());
    const twice = deidentifyAuditEvent(once);
    expect(twice).toEqual(once);
  });
});

// ---------------------------------------------------------------------------
// Rule 6 — admitRetentionClearance (Ruling 39)
//
// Tested directly, not only through the two stores that call it. A rule exercised solely through
// its callers is a rule whose own boundaries are untested, and the boundary those callers are
// least likely to reach is the second one below: a terminal episode whose completion instant was
// never recorded. It is refused for the same reason a non-terminal one is, because from the
// storage layer's side they are the same fact — there is no end instant to clear against.
// ---------------------------------------------------------------------------

describe("rule 6: admitRetentionClearance", () => {
  it.each(["withdrawn", "cancelled", "completed"] as const)(
    "admits a %s episode and hands back the instant it ended",
    (state) => {
      const episode = baseEpisode({ state });
      const admitted = admitRetentionClearance(episode);

      expect(admitted).toEqual({ ok: true, value: episode.planDates.completedAt });
    },
  );

  it.each(["draft", "active", "paused"] as const)("refuses a %s episode, which has not ended", (state) => {
    expect(admitRetentionClearance(baseEpisode({ state }))).toEqual({
      ok: false,
      reason: "retention-episode-not-terminal",
    });
  });

  it("refuses a terminal episode whose completion instant was never recorded", () => {
    const episode = baseEpisode({
      planDates: { dischargeAt: baseEpisode().planDates.dischargeAt, completedAt: null },
    });

    // Positive control: the state really is terminal, so this is the completion instant being
    // missing and not the state check firing first.
    expect(episode.state).toBe("completed");
    expect(admitRetentionClearance(episode)).toEqual({
      ok: false,
      reason: "retention-episode-not-terminal",
    });
  });

  it("hands back a copy, so a caller cannot rewrite the episode it asked about", () => {
    const episode = baseEpisode();
    const admitted = admitRetentionClearance(episode);
    if (!admitted.ok) throw new Error("expected an admitted clearance");

    admitted.value.setUTCFullYear(1970);

    expect(episode.planDates.completedAt?.getUTCFullYear()).toBe(2019);
  });
});
