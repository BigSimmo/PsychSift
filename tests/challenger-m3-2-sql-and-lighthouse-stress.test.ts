import { describe, expect, it } from "vitest";
import {
  POSTGRES_TOKEN_PATTERN,
  classifyMigrationBody,
  hasNoExecutableSql,
  stripMigrationSql,
  stripSqlComments,
} from "./helpers/migration-sql";
import {
  POSTGRES_TOKEN_PATTERN as PR_POSTGRES_TOKEN_PATTERN,
  isValidationGuardSql,
  stripSqlComments as prStripSqlComments,
  retrievalFunctionMigrationPaths,
} from "../scripts/pr-policy.mjs";
import {
  BIMODAL_RUNNER_TOLERANCE_FLOORS,
  DEFAULT_TOLERANCE,
  compareToLighthouseBudget,
  gradeRun,
  isBimodalRunnerVarianceRun,
} from "../scripts/check-lighthouse-budget.mjs";

describe("Challenger M3-2 Empirical Stress Test: SQL Comment Stripping (#81A3YJ)", () => {
  describe("Edge Case 1: URLs with '--' in various lexical contexts", () => {
    it("preserves URL with '--' inside single-quoted strings", () => {
      const sql = "SELECT 'https://example.com/path--segment' AS url;";
      expect(stripMigrationSql(sql)).toBe("SELECT 'https://example.com/path--segment' AS url;");
    });

    it("preserves URL with '--' inside query parameters and hash fragments", () => {
      const sql = "SELECT 'https://api.internal.net/v1/search?query=--flag&filter=--all#section--1' AS url;";
      expect(stripMigrationSql(sql)).toBe(
        "SELECT 'https://api.internal.net/v1/search?query=--flag&filter=--all#section--1' AS url;",
      );
    });

    it("preserves URL with '--' inside anonymous dollar quotes ($$...$$)", () => {
      const sql = "SELECT $$https://service.domain.org/data--pipeline/feed--01$$ AS endpoint;";
      expect(stripMigrationSql(sql)).toBe("SELECT $$https://service.domain.org/data--pipeline/feed--01$$ AS endpoint;");
    });

    it("preserves URL with '--' inside tagged dollar quotes ($tag$...$tag$)", () => {
      const sql = "SELECT $url$https://archive.org/download/item--2026--v1.tar.gz$url$ AS archive_url;";
      expect(stripMigrationSql(sql)).toBe(
        "SELECT $url$https://archive.org/download/item--2026--v1.tar.gz$url$ AS archive_url;",
      );
    });

    it("preserves URL with '--' in double-quoted identifier if used as column alias", () => {
      const sql = 'SELECT 1 AS "https://schema.org/prop--name";';
      expect(stripMigrationSql(sql)).toBe('SELECT 1 AS "https://schema.org/prop--name";');
    });

    it("preserves URL with multiple consecutive and non-consecutive '--'", () => {
      const sql = "INSERT INTO t (url) VALUES ('https://a--b--c.com/foo----bar/--');";
      expect(stripMigrationSql(sql)).toBe("INSERT INTO t (url) VALUES ('https://a--b--c.com/foo----bar/--');");
    });

    it("preserves URL string while stripping trailing authentic comment containing URL", () => {
      const sql = "SELECT 'https://valid.com/keep--me' AS u; -- trailing note https://ignore.com/strip--me\nSELECT 2;";
      expect(stripMigrationSql(sql)).toBe("SELECT 'https://valid.com/keep--me' AS u; SELECT 2;");
    });
  });

  describe("Edge Case 2: Literal '--' in strings and mixed string boundaries", () => {
    it("preserves standalone '--' literal", () => {
      expect(stripMigrationSql("SELECT '--';")).toBe("SELECT '--';");
    });

    it("preserves '--' at the immediate beginning of a single-quoted string", () => {
      const sql = "SELECT '--leading dash text' FROM logs;";
      expect(stripMigrationSql(sql)).toBe("SELECT '--leading dash text' FROM logs;");
    });

    it("preserves '--' at the immediate end of a single-quoted string", () => {
      const sql = "SELECT 'trailing dash text--' FROM logs;";
      expect(stripMigrationSql(sql)).toBe("SELECT 'trailing dash text--' FROM logs;");
    });

    it("preserves multiple strings containing '--' separated by operators and commas", () => {
      const sql = "SELECT 'col--a' || ' -- ' || 'col--b', 'col--c' FROM data;";
      expect(stripMigrationSql(sql)).toBe("SELECT 'col--a' || ' -- ' || 'col--b', 'col--c' FROM data;");
    });

    it("preserves multiline single-quoted string with '--' preserving content with stripSqlComments", () => {
      const sql = "SELECT 'Line 1\n-- Line 2 is part of string\nLine 3' AS multiline;";
      // stripSqlComments without whitespace collapsing preserves newlines verbatim
      expect(stripSqlComments(sql)).toBe("SELECT 'Line 1\n-- Line 2 is part of string\nLine 3' AS multiline;");
      // stripMigrationSql collapses whitespace to spaces while preserving the string content
      expect(stripMigrationSql(sql)).toBe("SELECT 'Line 1 -- Line 2 is part of string Line 3' AS multiline;");
    });

    it("preserves empty string '' without treating adjacent tokens as inside quotes", () => {
      const sql = "SELECT '' AS empty, '--' AS dashes; -- comment\nSELECT 1;";
      expect(stripMigrationSql(sql)).toBe("SELECT '' AS empty, '--' AS dashes; SELECT 1;");
    });
  });

  describe("Edge Case 3: Single quotes escaped as '' (standard SQL)", () => {
    it("preserves single escaped quote containing '--'", () => {
      const sql = "SELECT 'It''s a -- dash test' AS t;";
      expect(stripMigrationSql(sql)).toBe("SELECT 'It''s a -- dash test' AS t;");
    });

    it("preserves multiple escaped quotes interspersed with '--'", () => {
      const sql = "SELECT 'User''s -- profile''s -- data' AS t;";
      expect(stripMigrationSql(sql)).toBe("SELECT 'User''s -- profile''s -- data' AS t;");
    });

    it("preserves single quote literal represented as '''' with adjacent '--'", () => {
      const sql = "SELECT '''' || '--' || '''' AS quote_dash_quote;";
      expect(stripMigrationSql(sql)).toBe("SELECT '''' || '--' || '''' AS quote_dash_quote;");
    });

    it("preserves escaped quotes followed immediately by authentic comment", () => {
      const sql = "SELECT 'Don''t fail' AS msg; -- comment with 'quote''s and -- dashes\nSELECT 2;";
      expect(stripMigrationSql(sql)).toBe("SELECT 'Don''t fail' AS msg; SELECT 2;");
    });

    it("preserves multiple escaped quotes enclosing '--' (odd quote pairs enclosing token)", () => {
      // 5 single quotes: 1 opener + 2 escaped quotes ('') = 5 chars before '--'
      // followed by 2 escaped quotes + 1 closer = 5 chars after '--'
      const sql = "SELECT '''''--''''' AS heavily_quoted;";
      expect(stripMigrationSql(sql)).toBe("SELECT '''''--''''' AS heavily_quoted;");
    });

    it("correctly treats '--' following an even number of quotes as an authentic comment", () => {
      // 6 single quotes: 1 opener + 2 escaped quotes ('') + 1 closer = 6 chars
      // The string literal has closed! The subsequent '--' is an authentic comment
      const sql = "SELECT ''''''-- comment following closed quote\nSELECT 2;";
      expect(stripMigrationSql(sql)).toBe("SELECT '''''' SELECT 2;");
    });
  });

  describe("Edge Case 4: Dollar quotes with nested tags and mixed content", () => {
    it("preserves nested dollar quotes where inner tag differs from outer tag", () => {
      const sql =
        "CREATE OR REPLACE FUNCTION test_fn() RETURNS text AS $body$\n" +
        "BEGIN\n" +
        "  RETURN $inner$SELECT 'data--1';$inner$;\n" +
        "END;\n" +
        "$body$ LANGUAGE plpgsql;";
      expect(stripSqlComments(sql)).toBe(sql);
      expect(stripMigrationSql(sql)).toBe(
        "CREATE OR REPLACE FUNCTION test_fn() RETURNS text AS $body$ BEGIN RETURN $inner$SELECT 'data--1';$inner$; END; $body$ LANGUAGE plpgsql;",
      );
    });

    it("preserves anonymous dollar quotes containing tagged dollar quotes and comments", () => {
      const sql = "DO $$ BEGIN PERFORM $tag$hello -- world$tag$; END $$; -- outer comment";
      expect(stripMigrationSql(sql)).toBe("DO $$ BEGIN PERFORM $tag$hello -- world$tag$; END $$;");
    });

    it("preserves tagged dollar quotes containing embedded single quotes and double quotes with '--'", () => {
      const sql = 'SELECT $json${"query": "SELECT \'--\' AS dash", "alias": "dash--col"}$json$::jsonb;';
      expect(stripMigrationSql(sql)).toBe(
        'SELECT $json${"query": "SELECT \'--\' AS dash", "alias": "dash--col"}$json$::jsonb;',
      );
    });

    it("preserves empty dollar quotes ($$$$ and $tag$$tag$)", () => {
      const sql = "SELECT $$$$ AS empty1, $empty$$empty$ AS empty2; -- comment\nSELECT 1;";
      expect(stripMigrationSql(sql)).toBe("SELECT $$$$ AS empty1, $empty$$empty$ AS empty2; SELECT 1;");
    });

    it("preserves multiple sequential dollar quotes on one line with real comments between them", () => {
      const sql = "SELECT $a$-- in a$a$ /* comment 1 */, $b$-- in b$b$ -- comment 2\n, $c$-- in c$c$;";
      expect(stripMigrationSql(sql)).toBe("SELECT $a$-- in a$a$ , $b$-- in b$b$ , $c$-- in c$c$;");
    });

    it("preserves case sensitivity in dollar tags (different case does not prematurely close tag)", () => {
      const sql = "SELECT $Tag$inner content $tag$ still inner--dash$Tag$ AS val;";
      expect(stripMigrationSql(sql)).toBe("SELECT $Tag$inner content $tag$ still inner--dash$Tag$ AS val;");
    });
  });

  describe("Edge Case 5: Multiline and inline block comments", () => {
    it("strips multiline block comment spanning several lines with '--' inside", () => {
      const sql =
        "/*\n" +
        " * Header\n" +
        " * -- embedded line comment\n" +
        " * -- second embedded line comment\n" +
        " */\n" +
        "SELECT 1;";
      expect(stripMigrationSql(sql)).toBe("SELECT 1;");
    });

    it("strips block comments containing string quotes without opening a string token", () => {
      const sql = "SELECT /* 'single' and \"double\" and $$dollar$$ */ 1;";
      expect(stripMigrationSql(sql)).toBe("SELECT 1;");
    });

    it("strips adjacent block comments without crashing adjacent identifiers", () => {
      const sql = "SELECT/*1*/col1/*2*/FROM/*3*/t;";
      expect(stripMigrationSql(sql)).toBe("SELECT col1 FROM t;");
    });

    it("strips empty block comments (/**/)", () => {
      const sql = "SELECT /**/ 1;";
      expect(stripMigrationSql(sql)).toBe("SELECT 1;");
    });

    it("preserves string containing block comment delimiters ('/* ... */')", () => {
      const sql = "SELECT '/* not a comment -- */' AS str;";
      expect(stripMigrationSql(sql)).toBe("SELECT '/* not a comment -- */' AS str;");
    });

    it("preserves dollar quote containing block comment delimiters", () => {
      const sql = "SELECT $$/* not a comment -- */$$ AS str;";
      expect(stripMigrationSql(sql)).toBe("SELECT $$/* not a comment -- */$$ AS str;");
    });
  });

  describe("Edge Case 6: Mixed quotes and token boundary interactions", () => {
    it("preserves single quote inside double-quoted identifier with '--'", () => {
      const sql = 'SELECT "tbl\'--data"."col" FROM "tbl\'--data";';
      expect(stripMigrationSql(sql)).toBe('SELECT "tbl\'--data"."col" FROM "tbl\'--data";');
    });

    it("preserves double quote inside single-quoted string with '--'", () => {
      const sql = "SELECT 'He said: \"Wait--here\"' AS quote;";
      expect(stripMigrationSql(sql)).toBe("SELECT 'He said: \"Wait--here\"' AS quote;");
    });

    it("preserves fake dollar quote delimiter inside single quote", () => {
      const sql = "SELECT '$tag$not dollar quote--$tag$' AS fake_dollar; -- real comment";
      expect(stripMigrationSql(sql)).toBe("SELECT '$tag$not dollar quote--$tag$' AS fake_dollar;");
    });

    it("preserves fake dollar quote delimiter inside double quote", () => {
      const sql = 'SELECT "$tag$col--name$tag$" FROM t;';
      expect(stripMigrationSql(sql)).toBe('SELECT "$tag$col--name$tag$" FROM t;');
    });

    it("preserves parameter placeholders ($1, $2, $100) next to comments", () => {
      const sql = "SELECT $1, $2, $100 FROM users WHERE id = $1; -- filter by id";
      expect(stripMigrationSql(sql)).toBe("SELECT $1, $2, $100 FROM users WHERE id = $1;");
    });

    it("strips comments immediately adjacent to parameters without whitespace", () => {
      const sql = "SELECT $1--comment\nFROM users;";
      expect(stripMigrationSql(sql)).toBe("SELECT $1 FROM users;");
    });
  });

  describe("Edge Case 7: Authentic '--' comments outside strings ARE stripped", () => {
    it("strips comments at the exact start of file", () => {
      const sql = "-- initial comment\nSELECT 1;";
      expect(stripMigrationSql(sql)).toBe("SELECT 1;");
    });

    it("strips comments with no newline at end of file", () => {
      const sql = "SELECT 1; -- trailing EOF comment";
      expect(stripMigrationSql(sql)).toBe("SELECT 1;");
    });

    it("strips consecutive comment lines", () => {
      const sql = "-- line 1\n-- line 2\n-- line 3\nSELECT 1;\n-- line 4";
      expect(stripMigrationSql(sql)).toBe("SELECT 1;");
    });

    it("strips comment with non-ASCII and Unicode characters", () => {
      const sql = "SELECT 1; -- 🚀 注释 unicode comment äöü\nSELECT 2;";
      expect(stripMigrationSql(sql)).toBe("SELECT 1; SELECT 2;");
    });

    it("strips comment immediately following semicolon", () => {
      const sql = "SELECT 1;--no space\nSELECT 2;";
      expect(stripMigrationSql(sql)).toBe("SELECT 1; SELECT 2;");
    });
  });

  describe("Edge Case 8: Migration body classification & placeholder guards", () => {
    it("classifies pure comment files as comment_only", () => {
      const sql = "-- 20261010000000_placeholder.sql\n" + "/* No DDL applied here */\n" + "-- historical record";
      expect(classifyMigrationBody(sql)).toBe("comment_only");
      expect(hasNoExecutableSql(sql)).toBe(true);
    });

    it("classifies SELECT 1 with comments as select_1", () => {
      const sql = "-- placeholder\nSELECT 1;\n/* done */";
      expect(classifyMigrationBody(sql)).toBe("select_1");
      expect(hasNoExecutableSql(sql)).toBe(true);
    });

    it("classifies SELECT 1 WHERE false as select_1_where_false", () => {
      const sql = "-- placeholder\nSELECT 1 WHERE false; -- no-op";
      expect(classifyMigrationBody(sql)).toBe("select_1_where_false");
      expect(hasNoExecutableSql(sql)).toBe(true);
    });

    it("does not classify queries with '--' strings as comment_only (prevent false no-op)", () => {
      const sql = "SELECT '--';";
      expect(classifyMigrationBody(sql)).toBe("executable");
      expect(hasNoExecutableSql(sql)).toBe(false);
    });

    it("does not classify migration inserting URLs with '--' as no-op", () => {
      const sql = "INSERT INTO sites (url) VALUES ('https://service.wa.gov.au/path--item');";
      expect(classifyMigrationBody(sql)).toBe("executable");
      expect(hasNoExecutableSql(sql)).toBe(false);
    });
  });

  describe("Edge Case 9: PR Policy integration (`scripts/pr-policy.mjs`)", () => {
    it("pr-policy stripSqlComments preserves strings with '--'", () => {
      const sql = "SELECT 'https://example.com/foo--bar' AS u; -- comment";
      expect(prStripSqlComments(sql, { collapseWhitespace: true })).toBe("SELECT 'https://example.com/foo--bar' AS u;");
    });

    it("pr-policy token pattern matches identically to migration-sql token pattern", () => {
      const sample = "SELECT 'str--1', \"col--2\", $$dlr--3$$, $tag$tag--4$tag$, /* blk--5 */ 6 -- ln--7\n;";
      const tokens1 = [...sample.matchAll(POSTGRES_TOKEN_PATTERN)].map((m) => m[0]);
      const tokens2 = [...sample.matchAll(PR_POSTGRES_TOKEN_PATTERN)].map((m) => m[0]);
      expect(tokens1).toEqual(tokens2);
    });

    it("pr-policy retrievalFunctionMigrationPaths ignores functions in comments but catches real functions", () => {
      const commentedOutMigration = {
        "supabase/migrations/20261010000001_commented.sql":
          "-- CREATE OR REPLACE FUNCTION match_document_chunks() RETURNS ...\nSELECT 1;",
      };
      expect(retrievalFunctionMigrationPaths(commentedOutMigration)).toEqual([]);

      const activeMigration = {
        "supabase/migrations/20261010000002_active.sql":
          "-- migration description with https://internal.dev/api--v2\n" +
          "CREATE OR REPLACE FUNCTION match_document_chunks() RETURNS table(...) AS $$\n" +
          "BEGIN\n" +
          "  RETURN QUERY SELECT 1;\n" +
          "END;\n" +
          "$$ LANGUAGE plpgsql;",
      };
      expect(retrievalFunctionMigrationPaths(activeMigration)).toEqual([
        "supabase/migrations/20261010000002_active.sql",
      ]);
    });

    it("isValidationGuardSql allows CREATE INDEX inside comments and strings but forbids real and dollar-quoted DDL", () => {
      // Base valid validation guard structure
      const validGuardBase =
        "SET LOCAL statement_timeout = '5s';\n" +
        "DO $$ BEGIN\n" +
        "  IF NOT EXISTS (SELECT 1 FROM t) THEN\n" +
        "    RAISE EXCEPTION 'Guard check failed';\n" +
        "  END IF;\n" +
        "END $$;";

      // 1. Plain guard is valid
      expect(isValidationGuardSql(validGuardBase)).toBe(true);

      // 2. Real CREATE INDEX makes it invalid
      const realIndex = validGuardBase + "\nCREATE INDEX idx_t ON t(id);";
      expect(isValidationGuardSql(realIndex)).toBe(false);

      // 3. CREATE INDEX inside comment is ignored (remains valid)
      const commentIndex = validGuardBase + "\n-- CREATE INDEX idx_t ON t(id); see https://domain.com/path--segment";
      expect(isValidationGuardSql(commentIndex)).toBe(true);

      // 4. CREATE INDEX inside single-quoted string is ignored (remains valid)
      const stringIndex = validGuardBase + "\nPERFORM format('CREATE INDEX %I ON %I', 'idx_t', 't');";
      expect(isValidationGuardSql(stringIndex)).toBe(true);

      // 4b. Comments and string pins inside a DO body are ignored; the body itself is still code.
      const doBodyPins =
        validGuardBase +
        "\nDO $migration$ BEGIN\n  -- CREATE INDEX idx_t ON t(id);\n  PERFORM 'CREATE INDEX idx_t ON t(id)';\nEND $migration$;";
      expect(isValidationGuardSql(doBodyPins)).toBe(true);

      // 4d. A trailing backslash ends an ordinary string; it only escapes inside E'...'.
      const trailingBackslash = validGuardBase + "\nPERFORM 'C:\\';\nCREATE INDEX idx_t ON t(id);";
      expect(isValidationGuardSql(trailingBackslash)).toBe(false);
      const escapeString = validGuardBase + "\nPERFORM E'it\\'s CREATE INDEX idx_t ON t(id)';";
      expect(isValidationGuardSql(escapeString)).toBe(true);

      // 4c. A nested block comment hides CREATE INDEX entirely, as in PostgreSQL.
      const nestedComment = validGuardBase + "\n/* outer /* inner */ CREATE INDEX idx_t ON t(id); */";
      expect(isValidationGuardSql(nestedComment)).toBe(true);

      // 5. CREATE INDEX inside a dollar quote still counts: dollar-quoted bodies (DO blocks,
      // EXECUTE) run as code, so the guard fails closed rather than trusting them.
      const dollarIndex = validGuardBase + "\nPERFORM $dyn$CREATE INDEX idx_t ON t(id);$dyn$;";
      expect(isValidationGuardSql(dollarIndex)).toBe(false);
    });
  });

  describe("Edge Case 10: Performance and ReDoS Stress Verification", () => {
    it("handles large SQL payload (100,000+ characters) with thousands of string literals and comments in under 50ms", () => {
      const statements: string[] = [];
      for (let i = 0; i < 2000; i++) {
        statements.push(
          `INSERT INTO t (id, url, note) VALUES (${i}, 'https://example.com/item--${i}', 'Note with ''quotes'' and -- dashes'); -- trailing comment ${i}`,
        );
      }
      const largeSql = statements.join("\n");
      expect(largeSql.length).toBeGreaterThan(150000);

      // Keep the fastest of several runs. Catastrophic backtracking makes every run slow, while a
      // single cold run under coverage on a busy CI runner can cross 100 ms on its own (about
      // 102 ms on 12 Oct, against about 25 ms once warm).
      let stripped = "";
      let duration = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 5; run++) {
        const start = performance.now();
        stripped = stripMigrationSql(largeSql);
        duration = Math.min(duration, performance.now() - start);
      }

      expect(stripped).toContain("https://example.com/item--1999");
      expect(stripped).toContain("Note with ''quotes'' and -- dashes");
      expect(stripped).not.toContain("trailing comment");
      expect(duration).toBeLessThan(100); // Must be very fast, well below 100ms
    });

    it("handles long unclosed comment or string safely without catastrophic backtracking", () => {
      const unclosedString = "SELECT '" + "a".repeat(10000) + "-- not closed";
      const start = performance.now();
      stripSqlComments(unclosedString);
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(50);
    });
  });
});

describe("Challenger M3-2 Empirical Stress Test: Lighthouse Budget & Bimodal Runner Variance (#383YXX)", () => {
  const sampleBaseline = {
    "desktop-root": { lcpMs: 800, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
    "mobile-root": { lcpMs: 800, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
    "mobile-documents-search": { lcpMs: 800, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
    "desktop-documents-search": { lcpMs: 800, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
    "mobile-dsm": { lcpMs: 800, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
  };

  describe("Exact bimodal run membership", () => {
    it("recognizes exact bimodal routes and rejects all others", () => {
      // Exactly 4 calibrated routes
      expect(isBimodalRunnerVarianceRun("desktop-root")).toBe(true);
      expect(isBimodalRunnerVarianceRun("mobile-root")).toBe(true);
      expect(isBimodalRunnerVarianceRun("mobile-documents-search")).toBe(true);
      expect(isBimodalRunnerVarianceRun("desktop-documents-search")).toBe(true);

      // Rejects non-bimodal routes
      expect(isBimodalRunnerVarianceRun("mobile-dsm")).toBe(false);
      expect(isBimodalRunnerVarianceRun("desktop-dsm")).toBe(false);
      expect(isBimodalRunnerVarianceRun("mobile-documents")).toBe(false);
      expect(isBimodalRunnerVarianceRun("desktop-documents")).toBe(false);
      expect(isBimodalRunnerVarianceRun("mobile-documents-upload")).toBe(false);
      expect(isBimodalRunnerVarianceRun("documents")).toBe(false);
      expect(isBimodalRunnerVarianceRun("root")).toBe(false);
      expect(isBimodalRunnerVarianceRun("mobile-root-extended")).toBe(false);
      expect(isBimodalRunnerVarianceRun("pre-mobile-root")).toBe(false);

      // Rejects falsy and invalid values
      expect(isBimodalRunnerVarianceRun("")).toBe(false);
      expect(isBimodalRunnerVarianceRun(null as unknown as string)).toBe(false);
      expect(isBimodalRunnerVarianceRun(undefined as unknown as string)).toBe(false);
      expect(isBimodalRunnerVarianceRun(123 as unknown as string)).toBe(false);
      expect(isBimodalRunnerVarianceRun({} as unknown as string)).toBe(false);
    });

    it("verifies BIMODAL_RUNNER_TOLERANCE_FLOORS is calibrated to lcpMs = 200", () => {
      expect(BIMODAL_RUNNER_TOLERANCE_FLOORS.lcpMs).toBe(200);
      // Ensure no unexpected metric floors leaked
      expect(Object.keys(BIMODAL_RUNNER_TOLERANCE_FLOORS)).toEqual(["lcpMs"]);
    });
  });

  describe("LCP Runner Floor accommodation on mobile-root vs non-bimodal routes", () => {
    it("accommodates +175ms LCP scheduling jitter on mobile-root (0 breaches)", () => {
      // Baseline 800ms -> Current 975ms (+175ms delta, +21.875% growth)
      // Delta exceeds default minAbsolute(100) and pct(20%), but is under bimodal floor(200)
      const breaches = gradeRun({ run: "mobile-root", lcpMs: 975, cls: 0, tbtMs: 100 }, sampleBaseline["mobile-root"]);
      expect(breaches).toEqual([]);
    });

    it("flags +175ms LCP regression on non-bimodal route mobile-dsm (1 breach)", () => {
      // Same delta (+175ms, +21.875%) on non-bimodal route must breach
      const breaches = gradeRun({ run: "mobile-dsm", lcpMs: 975, cls: 0, tbtMs: 100 }, sampleBaseline["mobile-dsm"]);
      expect(breaches).toHaveLength(1);
      expect(breaches[0].metric).toBe("lcpMs");
      expect(breaches[0].delta).toBe(175);
    });

    it("accommodates boundary jitter of +199ms on mobile-root (0 breaches)", () => {
      const breaches = gradeRun({ run: "mobile-root", lcpMs: 999, cls: 0, tbtMs: 100 }, sampleBaseline["mobile-root"]);
      expect(breaches).toEqual([]);
    });

    it("catches genuine regression of +201ms on mobile-root (1 breach)", () => {
      // Baseline 800ms -> Current 1001ms (+201ms delta, +25.1% growth)
      // Delta >= 200 and pct > 20%
      const breaches = gradeRun({ run: "mobile-root", lcpMs: 1001, cls: 0, tbtMs: 100 }, sampleBaseline["mobile-root"]);
      expect(breaches).toHaveLength(1);
      expect(breaches[0].run).toBe("mobile-root");
      expect(breaches[0].metric).toBe("lcpMs");
      expect(breaches[0].delta).toBe(201);
    });

    it("does not breach if delta >= 200ms but percentage growth <= 20%", () => {
      // Baseline 2000ms -> Current 2300ms (+300ms delta, +15% growth)
      const baseline = { lcpMs: 2000, cls: 0, tbtMs: 100 };
      const breaches = gradeRun({ run: "mobile-root", lcpMs: 2300, cls: 0, tbtMs: 100 }, baseline);
      expect(breaches).toEqual([]);
    });

    it("catches large regression with large delta and percentage on mobile-root", () => {
      // Baseline 2000ms -> Current 2600ms (+600ms delta, +30% growth)
      const baseline = { lcpMs: 2000, cls: 0, tbtMs: 100 };
      const breaches = gradeRun({ run: "mobile-root", lcpMs: 2600, cls: 0, tbtMs: 100 }, baseline);
      expect(breaches).toHaveLength(1);
      expect(breaches[0].metric).toBe("lcpMs");
      expect(breaches[0].delta).toBe(600);
    });
  });

  describe("Non-LCP metric regression safety on mobile-root", () => {
    it("strictly catches TBT regression on mobile-root (unaffected by LCP bimodal floor)", () => {
      // Baseline tbtMs: 100 -> Current tbtMs: 160 (+60ms delta, +60% growth)
      // Default TBT tolerance: pct: 30, minAbsolute: 50
      const breaches = gradeRun({ run: "mobile-root", lcpMs: 800, cls: 0, tbtMs: 160 }, sampleBaseline["mobile-root"]);
      expect(breaches).toHaveLength(1);
      expect(breaches[0].run).toBe("mobile-root");
      expect(breaches[0].metric).toBe("tbtMs");
      expect(breaches[0].delta).toBe(60);
    });

    it("strictly catches CLS regression on mobile-root (unaffected by LCP bimodal floor)", () => {
      // Baseline cls: 0 -> Current cls: 0.03 (+0.03 delta > absolute 0.02)
      const breaches = gradeRun(
        { run: "mobile-root", lcpMs: 800, cls: 0.03, tbtMs: 100 },
        sampleBaseline["mobile-root"],
      );
      expect(breaches).toHaveLength(1);
      expect(breaches[0].run).toBe("mobile-root");
      expect(breaches[0].metric).toBe("cls");
      expect(breaches[0].delta).toBe(0.03);
    });
  });

  describe("Caller-supplied tolerance interactions on mobile-root", () => {
    it("preserves 200ms runner floor when caller specifies strict minAbsolute lower than 200", () => {
      const strict = {
        ...DEFAULT_TOLERANCE,
        lcpMs: { pct: 5, minAbsolute: 50 },
      };
      // For mobile-root, Math.max(50, 200) = 200 floor
      // +175ms is still protected by 200 floor
      const mobileBreaches = gradeRun({ run: "mobile-root", lcpMs: 975 }, { lcpMs: 800 }, strict);
      expect(mobileBreaches).toEqual([]);

      // For non-bimodal mobile-dsm, Math.max(50, 0) = 50 floor
      // +175ms breaches
      const dsmBreaches = gradeRun({ run: "mobile-dsm", lcpMs: 975 }, { lcpMs: 800 }, strict);
      expect(dsmBreaches).toHaveLength(1);
    });

    it("honours caller-supplied minAbsolute when higher than 200ms floor", () => {
      const relaxed = {
        ...DEFAULT_TOLERANCE,
        lcpMs: { pct: 10, minAbsolute: 300 },
      };
      // Math.max(300, 200) = 300 floor
      // +250ms delta does not breach
      const breaches = gradeRun({ run: "mobile-root", lcpMs: 1050 }, { lcpMs: 800 }, relaxed);
      expect(breaches).toEqual([]);

      // +350ms delta breaches
      const breaches350 = gradeRun({ run: "mobile-root", lcpMs: 1150 }, { lcpMs: 800 }, relaxed);
      expect(breaches350).toHaveLength(1);
    });
  });

  describe("End-to-end compareToLighthouseBudget evaluation", () => {
    it("reports 'ok' when mobile-root has runner jitter within 200ms", () => {
      const rows = [
        { run: "desktop-root", lcpMs: 975, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
        { run: "mobile-root", lcpMs: 975, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
        { run: "mobile-dsm", lcpMs: 820, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
      ];
      const budget = {
        routes: ["/", "/dsm"],
        strategies: ["mobile", "desktop"],
        baseline: {
          "desktop-root": { lcpMs: 800, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
          "mobile-root": { lcpMs: 800, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
          "mobile-dsm": { lcpMs: 800, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
          "desktop-dsm": { lcpMs: 800, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
        },
        enforce: true,
      };

      // When all runs have reports
      const allRows = [
        ...rows,
        { run: "desktop-dsm", lcpMs: 810, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
      ];
      const result = compareToLighthouseBudget(allRows, budget);
      expect(result.status).toBe("ok");
      expect(result.breaches).toHaveLength(0);
    });

    it("reports 'fail' under enforce:true when mobile-root has real regression above 200ms", () => {
      const allRows = [
        { run: "desktop-root", lcpMs: 800, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
        { run: "mobile-root", lcpMs: 1050, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
        { run: "mobile-dsm", lcpMs: 800, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
        { run: "desktop-dsm", lcpMs: 800, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
      ];
      const budget = {
        routes: ["/", "/dsm"],
        strategies: ["mobile", "desktop"],
        baseline: {
          "desktop-root": { lcpMs: 800, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
          "mobile-root": { lcpMs: 800, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
          "mobile-dsm": { lcpMs: 800, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
          "desktop-dsm": { lcpMs: 800, cls: 0, tbtMs: 100, fcpMs: 500, chromeVersion: "HeadlessChrome/130.0.0" },
        },
        enforce: true,
      };

      const result = compareToLighthouseBudget(allRows, budget);
      expect(result.status).toBe("fail");
      expect(result.breaches).toHaveLength(1);
      expect(result.breaches[0].run).toBe("mobile-root");
      expect(result.breaches[0].delta).toBe(250);
    });
  });

  describe("nested block comments (PostgreSQL nests /* */)", () => {
    const sql = "/* outer /* nested */ CREATE FUNCTION public.match_document_chunks() */ SELECT 1;";
    it("strips the whole nested comment in the migration helper", () => {
      expect(stripMigrationSql(sql)).toBe("SELECT 1;");
      expect(stripMigrationSql("/* a /* b */ c */")).toBe("");
    });
    it("strips the whole nested comment in the PR policy", () => {
      expect(prStripSqlComments(sql, { collapseWhitespace: true })).toBe("SELECT 1;");
    });
    it("still keeps comment markers inside literals", () => {
      expect(stripMigrationSql("SELECT '/* not a comment' AS a; -- tail")).toBe("SELECT '/* not a comment' AS a;");
    });
  });
});
