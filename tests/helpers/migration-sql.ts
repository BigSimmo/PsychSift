/**
 * Shared normalization for migration SQL bodies.
 *
 * Two independent contracts need the same answer to "does this file execute
 * anything?" — `tests/migration-history-placeholders.test.ts` (every no-op
 * migration must be declared) and `tests/migration-history-guards.test.ts`
 * (a `no_ddl` drift-allowlist guard must point at a genuinely empty file).
 * Keeping one implementation is what stops those two drifting into disagreeing
 * about the same file.
 */

import { scanPostgresTokens } from "../../scripts/pr-policy.mjs";

/**
 * PostgreSQL token pattern covering:
 * - Group 1: Single-quoted string literals with SQL ('') and backslash (\.) escapes.
 * - Group 2: Double-quoted identifiers with SQL ("") and backslash (\.) escapes.
 * - Group 3: Dollar-quoted string constants ($tag$...$tag$ or $$...$$), where Group 4 captures the tag.
 * - Group 5: Multi-line / block comments (/* ... * /).
 * - Group 6: Single-line comments (-- ...).
 *
 * Kept for callers that match individual tokens; stripping uses `scanPostgresTokens`, because
 * this pattern ends a nested block comment at its first `* /`.
 */
export const POSTGRES_TOKEN_PATTERN =
  /('(?:''|\\.|[^'\\])*')|("(?:""|\\.|[^"\\])*")|(\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\4\$)|(\/\*[\s\S]*?\*\/)|(--[^\r\n]*)/g;

export interface StripSqlCommentsOptions {
  /**
   * Whether to collapse all whitespace sequences to a single space and trim.
   * Defaults to false.
   */
  collapseWhitespace?: boolean;
  /**
   * Replacement for stripped comments. Defaults to a single space " " to prevent
   * adjacent tokens from colliding (e.g. `SELECT 1--comment\nFROM t` -> `SELECT 1 FROM t`).
   */
  commentReplacement?: string;
}

/**
 * Strips SQL line (`-- ...`) and block (`/* ... * /`) comments while strictly
 * preserving string literals (`'...'`), double-quoted identifiers (`"..."`), and
 * dollar-quoted literals (`$tag$...$tag$` or `$$...$$`) containing `--` or `/*`.
 */
export function stripSqlComments(sql: string, options: StripSqlCommentsOptions = {}): string {
  const replacement = options.commentReplacement ?? " ";
  // One tokenizer for both contracts: the PR policy's scanner nests block comments the way
  // PostgreSQL does, which the single-regex POSTGRES_TOKEN_PATTERN above cannot.
  const stripped = (scanPostgresTokens(sql) as Array<{ kind: string; text: string }>)
    .map((token) => (token.kind === "comment" ? replacement : token.text))
    .join("");

  if (options.collapseWhitespace) {
    return stripped.replace(/\s+/g, " ").trim();
  }
  return stripped;
}

/** Comments removed, whitespace collapsed. Preserves string and dollar-quoted literals containing '--'. */
export function stripMigrationSql(sql: string): string {
  return stripSqlComments(sql, { collapseWhitespace: true });
}

/**
 * The three shapes a deliberately inert migration takes in this repository.
 * `comment_only` files carry an explanatory header and nothing else;
 * `select_1` and `select_1_where_false` are neutralized bodies kept so remote
 * history keeps a matching local file. Anything else is `executable` — it
 * changes the database and is not a placeholder.
 */
export type MigrationBodyKind = "comment_only" | "select_1" | "select_1_where_false" | "executable";

export function classifyMigrationBody(sql: string): MigrationBodyKind {
  const body = stripMigrationSql(sql);
  if (body === "") return "comment_only";
  if (/^select\s+1\s*;?$/i.test(body)) return "select_1";
  if (/^select\s+1\s+where\s+false\s*;?$/i.test(body)) return "select_1_where_false";
  return "executable";
}

/** True when the file records history but applies no DDL and no data change. */
export function hasNoExecutableSql(sql: string): boolean {
  return classifyMigrationBody(sql) !== "executable";
}
