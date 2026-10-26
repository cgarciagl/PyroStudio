import { Marked, type Tokens } from "marked";

/**
 * Markdown → HTML for untrusted text (AI responses, database content).
 *
 * The output is injected with `dangerouslySetInnerHTML` inside a webview that can
 * call Tauri commands, so any script execution would be equivalent to full access
 * to the user's databases. Raw HTML in the source is therefore rendered as text and
 * only http(s)/mailto/anchor links and http(s)/data-image sources are kept.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const SAFE_LINK = /^(https?:|mailto:|#)/i;
const SAFE_IMAGE = /^(https?:|data:image\/(png|jpe?g|gif|webp);)/i;

function cleanUrl(href: string | null | undefined, allowed: RegExp): string | null {
  if (!href) return null;
  // Strip whitespace/control chars browsers ignore (e.g. "java\nscript:").
  const compact = href.replace(/[\u0000- \u007f]+/g, "");
  return allowed.test(compact) ? href : null;
}

const safeMarked = new Marked({
  async: false,
  breaks: true,
  gfm: true,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }: Tokens.Link) {
      const inner = this.parser.parseInline(tokens);
      const url = cleanUrl(href, SAFE_LINK);
      if (!url) return inner;
      const t = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(url)}"${t} target="_blank" rel="noopener noreferrer">${inner}</a>`;
    },
    image({ href, title, text }: Tokens.Image) {
      const url = cleanUrl(href, SAFE_IMAGE);
      if (!url) return escapeHtml(text);
      const t = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${t}>`;
    },
  },
});

export function renderSafeMarkdown(content: string): string {
  if (!content) return "";
  return safeMarked.parse(content) as string;
}
