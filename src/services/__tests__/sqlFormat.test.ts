import { describe, it, expect } from "vitest";
import { formatSql } from "../sqlFormat";
import { DEFAULT_SQL_FORMAT } from "../../stores/preferenceStore";

describe("formatSql", () => {
  it("formats with uppercase keywords by default", () => {
    const out = formatSql("select a, b from t where a = 1 and b = 2", DEFAULT_SQL_FORMAT);
    expect(out).toContain("SELECT");
    expect(out).toContain("\n  AND b = 2");
  });

  it("honors lowercase keywords and tab indentation", () => {
    const out = formatSql("SELECT a FROM t WHERE x = 1 AND y = 2", {
      ...DEFAULT_SQL_FORMAT,
      keywordCase: "lower",
      indent: "tab",
    });
    expect(out).toBe("select a\nfrom t\nwhere x = 1\n\tand y = 2");
  });

  it("keeps single-line clause bodies next to their keyword", () => {
    expect(formatSql("SELECT * FROM `ragnos`.`ci_sessions` LIMIT 100;", DEFAULT_SQL_FORMAT)).toBe(
      "SELECT *\nFROM `ragnos`.`ci_sessions`\nLIMIT 100;",
    );
  });

  it("joins single-line clauses inside subqueries but not multi-line bodies", () => {
    const out = formatSql("select id from t where x in (select id from u where z = 1) and y = 2", DEFAULT_SQL_FORMAT);
    expect(out).toBe(
      "SELECT id\nFROM t\nWHERE\n  x IN (\n    SELECT id\n    FROM u\n    WHERE z = 1\n  )\n  AND y = 2",
    );
  });

  it("keeps the first WHERE/HAVING condition on the keyword line", () => {
    const out = formatSql(
      "select a from t where a = 1 and b = 2 or c is null group by a having count(*) > 1 and max(b) < 3",
      DEFAULT_SQL_FORMAT,
    );
    expect(out).toBe(
      "SELECT a\nFROM t\nWHERE a = 1\n  AND b = 2\n  OR c IS NULL\nGROUP BY a\nHAVING COUNT(*) > 1\n  AND MAX(b) < 3",
    );
  });

  it("puts JOINs at the FROM level with extra ON conditions indented below", () => {
    const out = formatSql(
      "select a.id from a inner join b on b.a_id = a.id and b.active = 1 left join c on c.id = b.c_id where a.x = 1",
      DEFAULT_SQL_FORMAT,
    );
    expect(out).toBe(
      "SELECT a.id\nFROM a\nINNER JOIN b ON b.a_id = a.id\n  AND b.active = 1\nLEFT JOIN c ON c.id = b.c_id\nWHERE a.x = 1",
    );
  });

  it("moves a joined subquery together with its JOIN", () => {
    const out = formatSql("select a.id from a join (select id from z) x on x.id = a.id", DEFAULT_SQL_FORMAT);
    expect(out).toBe("SELECT a.id\nFROM a\nJOIN (\n  SELECT id\n  FROM z\n) x ON x.id = a.id");
  });

  it("does not pull CASE bodies onto the keyword line", () => {
    const out = formatSql("select case when a then 1 end as c from t", DEFAULT_SQL_FORMAT);
    expect(out).toContain("  CASE\n    WHEN a THEN 1\n  END");
  });

  it("keeps short lists on the keyword line and packs long ones into ~60-char lines", () => {
    const out = formatSql(
      "select u.id, u.nombre, u.email, count(p.id) as pedidos, max(p.fecha) as ultimo_pedido, u.telefono " +
        "from usuarios u, pedidos p group by u.id, u.nombre order by u.nombre",
      DEFAULT_SQL_FORMAT,
    );
    expect(out).toBe(
      "SELECT u.id, u.nombre, u.email, COUNT(p.id) AS pedidos,\n  MAX(p.fecha) AS ultimo_pedido, u.telefono\n" +
        "FROM usuarios u, pedidos p\nGROUP BY u.id, u.nombre\nORDER BY u.nombre",
    );
  });

  it("keeps multi-line list items on their own lines and packs subqueries inside them", () => {
    const out = formatSql(
      "select a, case when x then 1 else 2 end as c, b, d, (select max(z) from w) as m from t",
      DEFAULT_SQL_FORMAT,
    );
    expect(out).toBe(
      "SELECT a,\n  CASE\n    WHEN x THEN 1\n    ELSE 2\n  END AS c,\n  b, d,\n" +
        "  (\n    SELECT MAX(z)\n    FROM w\n  ) AS m\nFROM t",
    );
  });

  it("puts one list item per line when listStyle is onePerLine", () => {
    const out = formatSql("select a, b from t group by a, b", { ...DEFAULT_SQL_FORMAT, listStyle: "onePerLine" });
    expect(out).toBe("SELECT\n  a,\n  b\nFROM t\nGROUP BY\n  a,\n  b");
  });

  it("keeps named placeholders", () => {
    expect(formatSql("select * from t where id = :id", DEFAULT_SQL_FORMAT)).toContain(":id");
  });
});
