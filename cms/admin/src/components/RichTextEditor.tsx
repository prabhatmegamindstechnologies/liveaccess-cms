// Jodit, limited to the agreed tools, in two modes. "rich": the Paragraph box on guides and process areas (blocks, tables,
// images). "text": one line of text inside an element that's already there (list items, notes, page fields), so only
// text styles and links, and Enter makes a line break. It's loaded on demand, because it's larger than the rest of the
// admin. The server cleans every save with the same rules, so these lists are only for convenience.
import { useEffect, useRef } from "react";
import { Jodit } from "jodit";
// Jodit's main module only loads its core plugins. These are the others the agreed tools need.
import "jodit/esm/plugins/clean-html/clean-html.js";
import "jodit/esm/plugins/clipboard/clipboard.js";
import "jodit/esm/plugins/justify/justify.js";
import "jodit/esm/plugins/key-arrow-outside/key-arrow-outside.js";
import "jodit/esm/plugins/paste/paste.js";
import "jodit/esm/plugins/paste-from-word/paste-from-word.js";
import "jodit/esm/plugins/select/select.js";
import "jodit/esm/plugins/select-cells/select-cells.js";
import "jodit/esm/plugins/symbols/symbols.js";
import "jodit/esm/plugins/tab/tab.js";
import "jodit/esm/plugins/table-keyboard-navigation/table-keyboard-navigation.js";
import { ColorPickerWidget } from "jodit/esm/modules/widget/index.js";
import "jodit/es2021/jodit.min.css";
import { cleanParagraph, normalizeSpace, RICH_FONTS, RICH_SIZES, sanitizeRich, sanitizeText } from "@liveaccess/shared";
import { fromAdmin, toAdmin, type MediaItem } from "../lib/media.ts";

type Control = { args?: unknown[] };
export type EditorMode = "rich" | "text";
type Props = {
  id: string;
  value: string;
  onChange: (html: string) => void;
  /** Rich mode only: opens the Media library. */
  onPickImage?: (insert: (m: MediaItem) => void) => void;
  mode?: EditorMode;
  /** What a screen reader announces for the text box. */
  label?: string;
  /** Put the caret at the end of the text as soon as the editor opens. */
  autoFocus?: boolean;
};

const BRAND_COLOURS = ["#C2410C", "#1E3A5F", "#12925A", "#FFF1EA", "#EFF4FF", "#ECFDF3"];
const EMOJI = ["✅", "⚠️", "❌", "ℹ️", "🔧", "⚙️", "🔥", "💧", "📌", "📞"];
const SYMBOLS = ["°", "±", "µ", "≤", "≥", "×", "÷", "²", "³", "Ω", "→", "≈", "€", "£", "™", "®"];

// Jodit's styles fill icons, so each path sets its own fill and stroke.
const line = (d: string, stroke = "#334155", fill = "none", width = 2) => `<path d="${d}" style="fill:${fill};stroke:${stroke};stroke-width:${width};stroke-linecap:round;stroke-linejoin:round"/>`;
const icon = (paths: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${paths}</svg>`;
Jodit.modules.Icon.set("la-font-colour", icon(line("m6 16 6-12 6 12M8 12h8") + line("M4 21h16", "#C2410C", "none", 3)));
Jodit.modules.Icon.set("la-emoji", icon(line("M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM9 10h.01M15 10h.01M8.5 15a4.5 4.5 0 0 0 7 0")));
Jodit.modules.Icon.set("la-image", icon(line("M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9.5v.01")));

// Never the admin page's own document: parsing HTML there can run it (an <img onerror>, for example).
const inert = document.implementation.createHTMLDocument("");

/** Jodit's stock colour button has text and background on tabs. This opens Jodit's own picker for just one of them. */
const colourButton = (name: string, iconName: string, tooltip: string, command: "forecolor" | "background") => ({
  name, icon: iconName, tooltip,
  popup: (editor: Jodit, _: unknown, close: () => void) => ColorPickerWidget(editor as never, (colour: string) => {
    editor.execCommand(command, false, colour);
    close();
  }, "")
});

// With the caret in text that has no element of its own (a plain paragraph), Jodit finds no size and shows its list's
// first key, which for a list of numbers is "0", so the box read "0px". Fall back to the size the text really has.
type SizeValue = (editor: Jodit, button: unknown) => string | undefined;
const stockSize = (Jodit.defaultOptions.controls as unknown as Record<string, { value: SizeValue }>).fontsize!.value;
const sizeValue: SizeValue = (editor, button) => {
  const own = stockSize(editor, button);
  if (own && own !== "0" && own !== "NaN") return own;
  const px = Math.round(parseFloat(editor.ew.getComputedStyle(editor.editor).fontSize));
  return Number.isFinite(px) && px > 0 ? String(px) : undefined;
};

const emojiButton = {
  name: "laEmoji", icon: "la-emoji", tooltip: "Emoji", list: Object.fromEntries(EMOJI.map((e) => [e, e])),
  exec: (editor: Jodit, _: unknown, { control }: { control: Control }) => {
    if (!control.args) return false;
    editor.s.insertHTML(String(control.args[0]));
  }
};

const BASE = {
  toolbarAdaptive: false,
  toolbarSticky: false,
  statusbar: false,
  allowResizeX: false,
  allowResizeY: false,
  hidePoweredByJodit: true,
  askBeforePasteHTML: false,
  askBeforePasteFromWord: false,
  defaultActionOnPaste: "insert_clear_html",
  defaultActionOnPasteFromWord: "insert_clear_html",
  minHeight: 150,
  style: { fontFamily: RICH_FONTS["Plus Jakarta Sans"], fontSize: "16px" },
  specialCharacters: Jodit.atom(SYMBOLS),
  usePopupForSpecialCharacters: true,
  tableAllowCellResize: false,
  colors: Jodit.atom({ brand: BRAND_COLOURS, ...(Jodit.defaultOptions.colors as object) }),
  link: { noFollowCheckbox: false, openInNewTabCheckbox: true, modeClassName: false, processVideoLink: false },
  popup: { cells: Jodit.atom(["addcolumn", "addrow", "deleteTable"]) },
  controls: {
    // "select" is Jodit's own selector, which shows the current value in the toolbar.
    font: { component: "select", list: Jodit.atom({ "": "Default", ...Object.fromEntries(Object.entries(RICH_FONTS).map(([name, css]) => [css, name])) }) },
    fontsize: { component: "select", list: Jodit.atom(RICH_SIZES), value: sizeValue }
  }
};

const CONFIG = {
  ...BASE,
  // The core plugins we don't use. Source view, video, upload and the like are in plugins that are never imported above.
  disablePlugins: ["about", "format-block", "iframe", "image", "powered-by-jodit", "stat"],
  buttons: [
    "undo", "redo", "|", "font", "fontsize", "|", "bold", "italic", "underline", "strikethrough", "|",
    colourButton("laFontColour", "la-font-colour", "Font colour", "forecolor"),
    colourButton("laBackground", "brush", "Background colour", "background"),
    "|", "left", "center", "right", "ul", "ol", "|", "table", "link",
    // Jodit's own image plugin stays off: it would take any address. This one opens the Media library.
    { name: "laImage", icon: "la-image", tooltip: "Image from the Media library", exec: (editor: Jodit) => { editor.e.fire("laPickImage"); } },
    emojiButton,
    "symbols", "|", "eraser"
  ]
};

// One line of text inside an element the page already has: no blocks, lists, tables, alignment or images.
const TEXT_CONFIG = {
  ...BASE,
  enter: "br",
  minHeight: 44,
  height: "auto",
  disablePlugins: ["about", "format-block", "iframe", "image", "powered-by-jodit", "stat", "table", "justify", "ordered-list", "indent", "hr"],
  buttons: [
    "undo", "redo", "|", "font", "fontsize", "|", "bold", "italic", "underline", "strikethrough", "|",
    colourButton("laFontColour", "la-font-colour", "Font colour", "forecolor"),
    colourButton("laBackground", "brush", "Background colour", "background"),
    "|", "link", emojiButton, "symbols", "|", "eraser"
  ]
};

/** The stored form of a text-mode field: inline HTML only, with no line break left at the end to hold the caret. */
// A loop, not a regex: a regex for "line breaks at the end" retries at every <br> of a long run, which is quadratic.
const cleanText = (html: string, doc: Document) => {
  let out = normalizeSpace(sanitizeText(html, doc));
  while (out.endsWith("<br>")) out = out.slice(0, -4).trimEnd();
  return out;
};

export default function RichTextEditor({ id, value, onChange, onPickImage, mode = "rich", label = "Paragraph text", autoFocus = false }: Props) {
  const host = useRef<HTMLTextAreaElement>(null);
  const editor = useRef<Jodit | null>(null);
  const stopHolding = useRef<(() => void) | null>(null);
  const stored = useRef(value);
  // What the editor reports for the value it was given. Matching this means nothing was edited, even if the editor wrote it differently.
  const loaded = useRef({ reported: "", value });
  const send = useRef(onChange);
  send.current = onChange;
  const pickImage = useRef(onPickImage);
  pickImage.current = onPickImage;

  const text = mode === "text";
  // The editor shows library images through the API; the stored text keeps their site address.
  const clean = (html: string) => (text ? cleanText(html, inert) : cleanParagraph(html, inert));
  const read = (e: Jodit) => clean(fromAdmin(e.value));
  const load = (e: Jodit, html: string) => {
    e.value = toAdmin(clean(html));
    loaded.current = { reported: read(e), value: html };
  };

  useEffect(() => {
    const e = Jodit.make(host.current!, (text ? TEXT_CONFIG : CONFIG) as never);
    e.editor.setAttribute("aria-label", label);
    // Pasted or dropped HTML lands in the live admin page, where a <base> tag could reroute API calls. The save filter is too late
    // for that, so pastes are cleaned first and drops are refused.
    e.e.on("beforePasteInsert", (html: unknown) => (typeof html === "string" ? toAdmin((text ? sanitizeText : sanitizeRich)(fromAdmin(html), inert)) : html));
    e.editor.addEventListener("drop", (ev) => { ev.preventDefault(); ev.stopPropagation(); }, true);
    // The colour popup's hex box and picker take focus, and the text selection with it. Without this the colour lands in the wrong place.
    // It's held from the moment focus enters the popup, because Jodit moves the caret again before it runs the command.
    let selected: Range | null = null, held: Range | null = null;
    e.e.on("changeSelection", () => {
      const s = e.s.sel;
      if (!held && s?.rangeCount && e.editor.contains(s.getRangeAt(0).commonAncestorContainer)) selected = s.getRangeAt(0).cloneRange();
    });
    const hold = (ev: FocusEvent) => {
      if ((ev.target as Element).closest?.(".jodit-color-picker") && e.editor.contains(ev.relatedTarget as Node | null)) held = selected;
    };
    const release = () => { held = null; };
    document.addEventListener("focusin", hold);
    e.editor.addEventListener("mousedown", release);
    e.editor.addEventListener("keydown", release);
    e.e.on("beforeCommand", (command: string) => {
      if (!held || !/^(forecolor|background)$/i.test(command)) return;
      e.s.selectRange(held);
      held = null;
    });
    stopHolding.current = () => document.removeEventListener("focusin", hold);
    // The library opens in its own window, so the caret is put back before the image goes in.
    e.e.on("laPickImage", () => {
      const at = selected;
      pickImage.current?.((m) => {
        if (at) e.s.selectRange(at);
        else e.s.focus();
        const img = e.createInside.element("img");
        img.setAttribute("src", toAdmin(m.src));
        img.setAttribute("alt", m.altText);
        e.s.insertNode(img);
      });
    });
    load(e, stored.current);
    // Jodit's own autofocus runs before the text is loaded, and loading moves the caret, so the caret is placed here.
    if (autoFocus) {
      e.s.focus();
      e.s.setCursorIn(e.editor, false);
    }
    const report = () => {
      const now = read(e);
      const next = now === loaded.current.reported ? loaded.current.value : now;
      if (next === stored.current) return;
      stored.current = next;
      send.current(next);
    };
    e.e.on("change", report);
    editor.current = e;
    return () => {
      editor.current = null;
      stopHolding.current?.();
      // Jodit reports a change a moment after it happens. A field closed sooner (another one opened) would lose it.
      report();
      e.destruct();
    };
  }, []);

  // A block moved or removed: this box now shows a different block's text.
  useEffect(() => {
    if (value === stored.current || !editor.current) return;
    stored.current = value;
    load(editor.current, value);
  }, [value]);

  return <textarea ref={host} id={id} defaultValue={value} aria-label={label} />;
}
