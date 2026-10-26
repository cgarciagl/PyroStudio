import { describe, expect, it } from "vitest";
import { renderSafeMarkdown } from "../safeMarkdown";

describe("renderSafeMarkdown", () => {
  it("renders normal markdown", () => {
    const html = renderSafeMarkdown("**hola** `x`\n\n- a");
    expect(html).toContain("<strong>hola</strong>");
    expect(html).toContain("<code>x</code>");
    expect(html).toContain("<li>a</li>");
  });

  it("escapes raw HTML blocks and inline tags", () => {
    const html = renderSafeMarkdown('<img src=x onerror="alert(1)">\n\ntexto <script>alert(1)</script>');
    expect(html).not.toMatch(/<img|<script/i);
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops javascript: and other unsafe URLs", () => {
    for (const md of ["[x](javascript:alert(1))", "[x](java\nscript:alert(1))", "[x](JAVASCRIPT:alert(1))", "![i](javascript:alert(1))", "[x](data:text/html,<script>)"]) {
      expect(renderSafeMarkdown(md)).not.toMatch(/href="(?!https?:|mailto:|#)|src="javascript/i);
    }
  });

  it("keeps safe links with noopener", () => {
    const html = renderSafeMarkdown("[doc](https://mariadb.com/kb)");
    expect(html).toContain('href="https://mariadb.com/kb"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("escapes attribute-breaking characters in links", () => {
    const html = renderSafeMarkdown('[x](https://a.com/"onmouseover="alert(1))');
    expect(html).not.toContain('"onmouseover="');
  });
});
