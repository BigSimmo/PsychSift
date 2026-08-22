// src/lib/caring-contacts-server/pool.ts
//
// Adapts a `pg` connection pool to the driver-free `SqlConnectionPool` abstraction the Postgres
// caring-contact store takes (../caring-contacts/db/postgres-repository.ts keeps the sealed
// domain itself free of a `pg` dependency). `withConnection` holds ONE connection for the whole
// callback -- every store transaction spans several statements, and a pool that handed a
// different connection to each one would break both the transaction and the transaction-local
// team scope it depends on. This mirrors the adapter tests/helpers/caring-contacts-postgres.ts
// uses for the contract suite, so the two never drift on what "one connection per transaction"
// means.
import "server-only";

import { Pool } from "pg";

import type { SqlConnectionPool, SqlRow } from "@/lib/caring-contacts/db/postgres-repository";
import { safeErrorLogDetails } from "@/lib/privacy";

import { assertNotClinicalKbProject } from "./config";

export function createCaringContactsPool(url: string): SqlConnectionPool {
  // The guard runs here too, not only in store.ts's caller -- this constructor is itself an
  // exported entry point, and anyone who imports it directly (including a future task) must get
  // the same protection the documented call path gets. Two checks on the one path is defence in
  // depth and costs nothing.
  assertNotClinicalKbProject(url);

  const pool = new Pool({ connectionString: url });
  // `pg` emits 'error' on an idle client's unexpected disconnect. With no listener that is an
  // unhandled Node 'error' event, which crashes the process outright -- so a lost idle connection
  // would take the whole workspace down rather than degrading it. Logged, never rethrown; the
  // redaction helper strips anything path/URL/secret-shaped, so a connection string can never
  // reach this log even indirectly through the driver's own error message.
  pool.on("error", (error) => {
    console.error("[caring-contacts] pool idle-client error", safeErrorLogDetails(error));
  });

  return {
    async withConnection(work) {
      const client = await pool.connect();
      try {
        return await work({
          async query(text, values) {
            const result = await client.query(text, values ? [...values] : undefined);
            return { rows: result.rows as SqlRow[], rowCount: result.rowCount ?? 0 };
          },
        });
      } finally {
        client.release();
      }
    },
  };
}
