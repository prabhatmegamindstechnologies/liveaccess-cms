// The Paragraph box on guides and process areas: Jodit, limited to the agreed tools. It's loaded on demand, because it's
// larger than the rest of the admin. The server cleans every save with the same rules, so this list is only for convenience.
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
import { cleanParagraph, RICH_FONTS, RICH_SIZES, sanitizeRich } from "@liveaccess/shared";

type Control = { args?: unknown[] };
type Props = { id: string; value: string; onChange: (html: string) => void };

const BRAND_COLOURS = ["#C2410C", "#1E3A5F", "#12925A", "#FFF1EA", "#EFF4FF", "#ECFDF3"];
const EMOJI = ["✅", "⚠️", "❌", "ℹ️", "🔧", "⚙️", "🔥", "💧", "📌", "📞"];
const SYMBOLS = ["°", "±", "µ", "≤", "≥", "×", "÷", "²", "³", "Ω", "→", "≈", "€", "£", "™", "®"];

// Jodit's styles fill icons, so each path sets its own fill and stroke.
const line = (d: string, stroke = "#334155", fill = "none", width = 2) => `<path d="${d}" style="fill:${fill};stroke:${stroke};stroke-width:${width};stroke-linecap:round;stroke-linejoin:round"/>`;
const icon = (paths: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${paths}</svg>`;
Jodit.modules.Icon.set("la-font-colour", icon(line("m6 16 6-12 6 12M8 12h8") + line("M4 21h16", "#C2410C", "none", 3)));
Jodit.modules.Icon.set("la-emoji", icon(line("M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM9 10h.01M15 10h.01M8.5 15a4.5 4.5 0 0 0 7 0")));

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

const CONFIG = {
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
    fontsize: { component: "select", list: Jodit.atom(RICH_SIZES) }
  },
  // The core plugins we don't use. Source view, video, upload and the like are in plugins that are never imported above.
  disablePlugins: ["about", "format-block", "iframe", "image", "powered-by-jodit", "stat"],
  buttons: [
    "undo", "redo", "|", "font", "fontsize", "|", "bold", "italic", "underline", "strikethrough", "|",
    colourButton("laFontColour", "la-font-colour", "Font colour", "forecolor"),
    colourButton("laBackground", "brush", "Background colour", "background"),
    "|", "left", "center", "right", "ul", "ol", "|", "table", "link",
    {
      name: "laEmoji", icon: "la-emoji", tooltip: "Emoji", list: Object.fromEntries(EMOJI.map((e) => [e, e])),
      exec: (editor: Jodit, _: unknown, { control }: { control: Control }) => {
        if (!control.args) return false;
        editor.s.insertHTML(String(control.args[0]));
      }
    },
    "symbols", "|", "eraser"
  ]
};

export default function RichTextEditor({ id, value, onChange }: Props) {
  const host = useRef<HTMLTextAreaElement>(null);
  const editor = useRef<Jodit | null>(null);
  const stopHolding = useRef<(() => void) | null>(null);
  const stored = useRef(value);
  // What the editor reports for the value it was given. Matching this means nothing was edited, even if the editor wrote it differently.
  const loaded = useRef({ reported: "", value });
  const send = useRef(onChange);
  send.current = onChange;

  const load = (e: Jodit, html: string) => {
    e.value = cleanParagraph(html, inert);
    loaded.current = { reported: cleanParagraph(e.value, inert), value: html };
  };

  useEffect(() => {
    const e = Jodit.make(host.current!, CONFIG as never);
    e.editor.setAttribute("aria-label", "Paragraph text");
    // Pasted or dropped HTML lands in the live admin page, where a <base> tag could reroute API calls. The save filter is too late
    // for that, so pastes are cleaned first and drops are refused.
    e.e.on("beforePasteInsert", (html: unknown) => (typeof html === "string" ? sanitizeRich(html, inert) : html));
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
    load(e, stored.current);
    e.e.on("change", () => {
      const now = cleanParagraph(e.value, inert);
      const next = now === loaded.current.reported ? loaded.current.value : now;
      if (next === stored.current) return;
      stored.current = next;
      send.current(next);
    });
    editor.current = e;
    return () => {
      editor.current = null;
      stopHolding.current?.();
      e.destruct();
    };
  }, []);

  // A block moved or removed: this box now shows a different block's text.
  useEffect(() => {
    if (value === stored.current || !editor.current) return;
    stored.current = value;
    load(editor.current, value);
  }, [value]);

  return <textarea ref={host} id={id} defaultValue={value} aria-label="Paragraph text" />;
}
