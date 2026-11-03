// Preview helpers: the real page in a sandboxed iframe, with a few editor-only styles.
import { API_BASE } from "./api.ts";

// In development the site's CSS/images come through the API; in production the admin shares the site's domain.
export const PREVIEW_BASE = import.meta.env.DEV ? `${API_BASE}/preview-assets/` : "/";

const PREVIEW_CSS =
  "[data-cms-f]{cursor:pointer}" +
  "[data-cms-f]:hover{outline:2px dashed rgba(232,84,26,.55);outline-offset:3px}" +
  "[data-cms-hl]{outline:3px solid #E8541A!important;outline-offset:3px}" +
  "html{scroll-behavior:auto!important}";

/** Page HTML (scripts already removed) → srcdoc with a <base> for assets and the editor styles. */
export function previewDoc(htmlWithoutScripts: string): string {
  const inject = `<base data-cms href="${PREVIEW_BASE}"><style id="cms-preview">${PREVIEW_CSS}</style>`;
  return htmlWithoutScripts.replace(/<head(\s[^>]*)?>/i, (m) => m + inject);
}

/** Outlines one element in the preview and scrolls the iframe (not the admin page) to it. */
export function highlight(doc: Document | null, el: Element | null) {
  if (!doc) return;
  doc.querySelectorAll("[data-cms-hl]").forEach((e) => e.removeAttribute("data-cms-hl"));
  if (!el) return;
  el.setAttribute("data-cms-hl", "");
  const win = doc.defaultView;
  if (!win) return;
  const r = el.getBoundingClientRect();
  if (r.top < 80 || r.bottom > win.innerHeight - 40) win.scrollTo({ top: Math.max(0, r.top + win.scrollY - win.innerHeight / 3) });
}
