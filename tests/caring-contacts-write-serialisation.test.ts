import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The one concurrency property in the Postgres store that nothing else can fail on.
 *
 * `ensureTeam` is an unconditional `insert ... on conflict do nothing`, and it is the first
 * statement inside every write transaction. Two same-team writers therefore contend on the teams
 * primary key and queue there, never overlapping anywhere later in the write path -- which is why
 * the one race the database suite proves is only reachable ACROSS teams. Nothing designed that; it
 * falls out of the key, and the source comment at `ensureTeam` says so itself.
 *
 * A comment is not a guard. Making the insert conditional -- an "only if absent" read first, a
 * process cache, a one-time bootstrap -- or moving it after another statement widens the
 * concurrency surface of every write in this store at once, and no behavioural test in the suite
 * would go red: the serialisation it removes is only observable under real contention, which is
 * exactly what a test suite does not reliably produce.
 *
 * So this is a source-text assertion, the same instrument
 * `tests/caring-contacts-explained-automation.dom.test.tsx` and
 * `tests/caring-contact-route-files.test.ts` already use. It is test-only and blocks nothing: it
 * cannot stop the change being made, only stop it being made SILENTLY.
 */
const STORE = "src/lib/caring-contacts/db/postgres-repository.ts";

function storeSource(): string {
  return readFileSync(resolve(process.cwd(), STORE), "utf8");
}

/** Strips line comments so the prose ABOUT the rule is never mistaken for the code obeying it. */
function withoutLineComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

describe("the Postgres store's accidental same-team write serialisation", () => {
  it("keeps ensureTeam an unconditional insert, with no read, cache, or existence check first", () => {
    const source = withoutLineComments(storeSource());
    const body = source.match(
      /async function ensureTeam\(connection: SqlConnection, team: TeamId\): Promise<void> \{([\s\S]*?)\n {2}\}/,
    );
    expect(
      body,
      `${STORE}: could not read the body of ensureTeam. If it moved or changed shape, update this ` +
        "helper -- do not delete the assertion that depends on it.",
    ).not.toBeNull();

    const statements = body![1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");

    // Exactly one statement, and it is the unconditional insert. A second line here is where a
    // `select`-then-`insert`, a `Set` of seen teams, or an early return would go.
    expect(statements).toEqual([
      'await connection.query("insert into caring_contacts.teams (id) values ($1) on conflict (id) do nothing", [team]);',
    ]);
  });

  it("keeps ensureTeam the first statement inside runWrite's transaction", () => {
    const source = withoutLineComments(storeSource());
    const transaction = source.match(
      /return inTransaction\(actor\.teamId, token, async \(connection\) => \{([\s\S]*?)\n/,
    );
    expect(
      transaction,
      `${STORE}: could not read the opening of runWrite's transaction. If it moved or changed ` +
        "shape, update this helper -- do not delete the assertion that depends on it.",
    ).not.toBeNull();

    // The first non-blank line of the transaction body, and nothing before it: an idempotency
    // read, a service-state read, or a lock taken ahead of this line is a writer that reached
    // shared rows before it queued on the team key.
    const rest = source.slice(source.indexOf(transaction![0]) + transaction![0].length);
    const firstStatement = rest
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "");
    expect(firstStatement).toBe("await ensureTeam(connection, actor.teamId);");
  });
});
