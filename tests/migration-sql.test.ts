import { describe, expect, it } from "vitest";
import { classifyMigrationBody, hasNoExecutableSql, stripMigrationSql } from "./helpers/migration-sql";

describe("token-preserving SQL comment stripping (#81A3YJ)", () => {
  describe("single-quoted string literals", () => {
    it("preserves literal '--' in single quotes", () => {
      expect(stripMigrationSql("SELECT '--' AS dash;")).toBe("SELECT '--' AS dash;");
    });

    it("preserves URL with '--' inside single quotes", () => {
      const sql = "SELECT 'https://example.com/path--segment' AS url;";
      expect(stripMigrationSql(sql)).toBe("SELECT 'https://example.com/path--segment' AS url;");
    });

    it("preserves escaped single quotes containing '--'", () => {
      const sql = "SELECT 'It''s a -- test' FROM t;";
      expect(stripMigrationSql(sql)).toBe("SELECT 'It''s a -- test' FROM t;");
    });

    it("preserves PostgreSQL C-style backslash escape strings (E'...') containing '--'", () => {
      const sql = "SELECT E'foo\\'--bar' FROM t;";
      expect(stripMigrationSql(sql)).toBe("SELECT E'foo\\'--bar' FROM t;");
    });

    it("preserves multiple strings containing '--' on the same line", () => {
      const sql = "SELECT 'a--1', 'b--2' FROM t;";
      expect(stripMigrationSql(sql)).toBe("SELECT 'a--1', 'b--2' FROM t;");
    });
  });

  describe("double-quoted identifiers", () => {
    it("preserves double-quoted identifiers with '--'", () => {
      const sql = 'SELECT "col--name" FROM "tbl--data";';
      expect(stripMigrationSql(sql)).toBe('SELECT "col--name" FROM "tbl--data";');
    });

    it("preserves escaped double quotes with '--'", () => {
      const sql = 'SELECT "My ""--"" col" FROM t;';
      expect(stripMigrationSql(sql)).toBe('SELECT "My ""--"" col" FROM t;');
    });

    it("preserves double-quoted identifiers with block comment characters", () => {
      const sql = 'SELECT "col/*test*/" FROM t;';
      expect(stripMigrationSql(sql)).toBe('SELECT "col/*test*/" FROM t;');
    });
  });

  describe("dollar-quoted string constants", () => {
    it("preserves anonymous dollar quotes ($$...$$) containing '--'", () => {
      const sql = "SELECT $$--$$ AS val;";
      expect(stripMigrationSql(sql)).toBe("SELECT $$--$$ AS val;");
    });

    it("preserves tagged dollar quotes ($tag$...$tag$) containing '--'", () => {
      const sql = "SELECT $tag$https://foo--bar$tag$ AS val;";
      expect(stripMigrationSql(sql)).toBe("SELECT $tag$https://foo--bar$tag$ AS val;");
    });

    it("preserves site_content_registry_baselines tag containing URL with '--' (#81A3YJ offset 176107)", () => {
      const sql =
        'SELECT $site_content_registry_baselines${"slug":"Next-Step---Drug-and-Alcohol-Services"}$site_content_registry_baselines$;';
      expect(stripMigrationSql(sql)).toBe(
        'SELECT $site_content_registry_baselines${"slug":"Next-Step---Drug-and-Alcohol-Services"}$site_content_registry_baselines$;',
      );
    });

    it("preserves multiple distinct dollar quotes with '--' in one statement", () => {
      const sql = "SELECT $a$-- in a$a$, $b$-- in b$b$;";
      expect(stripMigrationSql(sql)).toBe("SELECT $a$-- in a$a$, $b$-- in b$b$;");
    });

    it("preserves nested dollar quotes with distinct tags", () => {
      const sql = "CREATE FUNCTION f() AS $$ SELECT $inner$foo -- bar$inner$; $$;";
      expect(stripMigrationSql(sql)).toBe("CREATE FUNCTION f() AS $$ SELECT $inner$foo -- bar$inner$; $$;");
    });
  });

  describe("comments outside quotes are cleanly stripped", () => {
    it("strips single-line comments at the beginning of a file", () => {
      const sql = "-- header comment\nSELECT 1;";
      expect(stripMigrationSql(sql)).toBe("SELECT 1;");
    });

    it("strips single-line comments at the end of a line", () => {
      const sql = "SELECT 1; -- end comment";
      expect(stripMigrationSql(sql)).toBe("SELECT 1;");
    });

    it("strips comments immediately adjacent to literals without whitespace", () => {
      const sql = "SELECT 'val'--comment\nFROM t;";
      expect(stripMigrationSql(sql)).toBe("SELECT 'val' FROM t;");
    });

    it("strips comments containing quotes and dollar delimiters without corrupting lexer state", () => {
      const sql = "-- comment with 'quote' and \"double\" and $$tag$$\nSELECT 1;";
      expect(stripMigrationSql(sql)).toBe("SELECT 1;");
    });

    it("strips block comments (/* ... */)", () => {
      const sql = "SELECT /* block comment */ 1;";
      expect(stripMigrationSql(sql)).toBe("SELECT 1;");
    });

    it("strips block comments containing dashes", () => {
      const sql = "SELECT /* -- block with dashes -- */ 1;";
      expect(stripMigrationSql(sql)).toBe("SELECT 1;");
    });

    it("strips multi-line block comments with asterisks and dashes", () => {
      const sql = "/*\n * header\n * -- subheader\n */\nSELECT 1;";
      expect(stripMigrationSql(sql)).toBe("SELECT 1;");
    });

    it("strips adjacent block comments without crashing keywords", () => {
      const sql = "SELECT/*comment*/1;";
      expect(stripMigrationSql(sql)).toBe("SELECT 1;");
    });
  });

  describe("PostgreSQL parameters and operators", () => {
    it("preserves positional parameters ($1, $2, $12)", () => {
      const sql = "SELECT $1, $2, $12 FROM t WHERE id = $1; -- comment";
      expect(stripMigrationSql(sql)).toBe("SELECT $1, $2, $12 FROM t WHERE id = $1;");
    });
  });

  describe("migration body classification and no-op guards", () => {
    it("classifies comment-only migrations as comment_only", () => {
      const sql = "-- Migration header\n/* historical placeholder */\n-- inert";
      expect(classifyMigrationBody(sql)).toBe("comment_only");
      expect(hasNoExecutableSql(sql)).toBe(true);
    });

    it("classifies SELECT 1 as select_1", () => {
      const sql = "-- placeholder\nSELECT 1;\n-- explanation";
      expect(classifyMigrationBody(sql)).toBe("select_1");
      expect(hasNoExecutableSql(sql)).toBe(true);
    });

    it("classifies SELECT 1 WHERE false as select_1_where_false", () => {
      const sql = "/* no-op */ SELECT 1 WHERE false; -- check";
      expect(classifyMigrationBody(sql)).toBe("select_1_where_false");
      expect(hasNoExecutableSql(sql)).toBe(true);
    });

    it("classifies queries with '--' in string as executable (not empty or truncated)", () => {
      const sql = "SELECT '--';";
      expect(classifyMigrationBody(sql)).toBe("executable");
      expect(hasNoExecutableSql(sql)).toBe(false);
    });

    it("classifies DDL/DML with URLs as executable", () => {
      const sql = "INSERT INTO t VALUES ('https://example.com/a--b');";
      expect(classifyMigrationBody(sql)).toBe("executable");
      expect(hasNoExecutableSql(sql)).toBe(false);
    });
  });
});
