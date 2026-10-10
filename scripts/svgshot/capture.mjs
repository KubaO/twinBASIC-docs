// An SVG picture of a clip of a live page, over a CDP connection: what
// shoot_docs.mjs --svg writes beside each PNG.
//
// Everything is read from the page as it stands when the PNG has just been
// captured, in this order:
//   1. the DOM snapshot (layout, text fragments, computed styles, paint order);
//   2. in a measuring layer added only after the snapshot, so it is in no
//      picture: each font's ascent and the fonts Chromium draws each run of
//      text with (CSS.getPlatformFontsForNode), and the same for the
//      annotation layer's text; and, on a canvas, where an underlined run's ink
//      is in the band its underline skips;
//   3. the pixels of each <canvas> in the clip, and the bytes of each web
//      font a run was drawn with (the @font-face rule the page's own CSS picks
//      for the run's font, which need not be named as the font names itself);
//   4. the annotation layer (svg#tbShotAnnotation) as XML, its text moved onto
//      the picture's own faces.
// The measuring layer is removed again before this returns.
//
// Steps 2 and 3, and the scrollbar styles, are done in each document that shows
// in the clip: the page's, and the <iframe>s of the same process (the ones that
// are documents of their own in the snapshot), each in a world of its own that
// DevTools makes in the frame (Page.createIsolatedWorld), because a font name,
// a style rule and a canvas mean what their own document says. A frame of
// another process is not reached: it has a DevTools target of its own.

import { createHash } from "node:crypto";
import { PictureFonts, withFaces } from "./fonts.mjs";
import {
  decodeSnapshot,
  frameGeometry,
  framesIn,
  frameView,
  oneLine,
  renderSvg,
  scrollbarPartList,
  scrollersIn,
  textNeeds,
  unzoom,
  viewportScroller,
  viewportStyleSources,
} from "./snapshot-svg.mjs";

// The computed styles the converter reads.
export const SNAPSHOT_STYLES = [
  "display",
  "visibility",
  "opacity",
  "color",
  "background-color",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "background-clip",
  "background-origin",
  "background-blend-mode",
  ...["top", "right", "bottom", "left"].flatMap((s) => [`border-${s}-width`, `border-${s}-style`, `border-${s}-color`]),
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "outline-width",
  "outline-style",
  "outline-color",
  "outline-offset",
  "box-shadow",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "text-align",
  "text-align-last",
  "tab-size",
  "text-decoration-line",
  "text-decoration-style",
  "text-decoration-color",
  "text-decoration-thickness",
  "text-decoration-skip-ink",
  "text-underline-offset",
  "text-underline-position",
  "float",
  "appearance",
  "overflow-x",
  "overflow-y",
  "resize",
  "border-collapse",
  "transform",
  "transform-origin",
  "filter",
  "clip-path",
  "position",
  ...["top", "right", "bottom", "left"].map((s) => `padding-${s}`),
  "-webkit-text-fill-color",
];

// What a scrollbar part's box is drawn from: its styles, and its size along the bar.
const PART_STYLES = [
  ...SNAPSHOT_STYLES,
  ...["width", "height", "min-width", "min-height", "max-width", "max-height"],
  ...["top", "right", "bottom", "left"].map((s) => `margin-${s}`),
];

const MEASURE_ID = "tbSvgMeasure";
const OVERLAYS = ["svg#tbShotAnnotation", "#tbShotPointer svg"];

// Runs in the page: the measuring layer, the canvases and the overlays.
function measure({ keys, runs, skips, view, measureId, overlays }) {
  const layer = document.createElement("div");
  layer.id = measureId;
  layer.style.cssText = "position:fixed;left:0;top:0;opacity:0;pointer-events:none;z-index:-2147483647";
  document.body.append(layer);
  const font = ([style, weight, size, family]) =>
    `white-space:pre;line-height:normal;font-family:${family};font-size:${size};font-weight:${weight};font-style:${style}`;

  const metrics = {};
  const probes = keys.map((key) => {
    const d = document.createElement("div");
    d.style.cssText = font(JSON.parse(key));
    const t = document.createElement("span");
    t.textContent = "Hxg";
    const b = document.createElement("span");
    b.style.cssText = "display:inline-block;width:0;height:0";
    d.append(t, b);
    layer.append(d);
    return [key, t, b, d];
  });

  // The overlays, serialised with their text marked for the picture's faces.
  const marked = [];
  const outOverlays = [];
  for (const sel of overlays) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const clone = el.cloneNode(true);
    const texts = [...el.querySelectorAll("text")];
    const cloneTexts = [...clone.querySelectorAll("text")];
    for (const [i, t] of texts.entries()) {
      const cs = getComputedStyle(t);
      const key = JSON.stringify([cs.fontStyle, cs.fontWeight, cs.fontSize, cs.fontFamily]);
      const k = marked.length;
      marked.push({ key, text: t.textContent });
      cloneTexts[i].style.removeProperty("font-family");
      cloneTexts[i].style.setProperty("--tbk", String(k));
    }
    for (const a of ["style", "class", "id"]) clone.removeAttribute(a);
    clone.setAttribute("x", String(r.x));
    clone.setAttribute("y", String(r.y));
    clone.setAttribute("width", String(r.width));
    clone.setAttribute("height", String(r.height));
    clone.setAttribute("overflow", "visible");
    outOverlays.push(new XMLSerializer().serializeToString(clone));
  }

  const allRuns = [...runs, ...marked.map((m) => [m.key, m.text])];
  for (const [k, [key, text]] of allRuns.entries()) {
    const s = document.createElement("span");
    s.dataset.k = String(k);
    s.style.cssText = font(JSON.parse(key));
    s.textContent = text;
    layer.append(s, document.createElement("br"));
  }

  return document.fonts.ready.then(() => {
    // `line` is the height of a line with line-height: normal, `height` the font's content area.
    for (const [key, t, b, d] of probes) {
      const box = t.getClientRects()[0];
      metrics[key] = {
        ascent: b.getBoundingClientRect().bottom - box.top,
        height: box.height,
        line: d.getBoundingClientRect().height,
      };
    }
    // How wide each run of text is laid out, for the text that is aligned in its box.
    const widths = [...layer.querySelectorAll("span[data-k]")].map((s) => s.getBoundingClientRect().width);
    // Where each run's ink is in a band of `height` CSS px that starts `top` px below
    // the baseline, as stretches [from, to] in CSS px from the run's start: the run
    // drawn 16 times as large on a canvas, whose columns with ink in the band (at
    // least a quarter covered) are read back. Chromium reads the same from the
    // outlines, and rounds what it cuts to device pixels. A canvas is at most 32767
    // px wide, so a long run is drawn smaller; a run that cannot be drawn has no gaps.
    const gaps = skips.map(([key, text, top, height]) => {
      const [style, weight, size, family] = JSON.parse(key);
      const font = (scale) => `${style} ${weight} ${Number.parseFloat(size) * scale}px ${family}`;
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.font = font(1);
        const advance = ctx.measureText(text).width;
        const scale = Math.max(1, Math.min(16, Math.floor(30000 / (advance + 8))));
        const edge = 4 * scale;
        // Resizing a canvas resets its font.
        canvas.width = Math.ceil(advance * scale) + 2 * edge;
        canvas.height = Math.max(1, Math.round(height * scale));
        ctx.font = font(scale);
        ctx.fillText(text, edge, -top * scale);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const inked = (x) => {
          for (let y = 0; y < canvas.height; y++) if (data[(y * canvas.width + x) * 4 + 3] >= 64) return true;
          return false;
        };
        const out = [];
        let from = -1;
        for (let x = 0; x <= canvas.width; x++) {
          const ink = x < canvas.width && inked(x);
          if (ink && from < 0) from = x;
          else if (!ink && from >= 0) {
            out.push([(from - edge) / scale, (x - edge) / scale]);
            from = -1;
          }
        }
        return out;
      } catch {
        return [];
      }
    });
    const roots = [document];
    for (let i = 0; i < roots.length; i++)
      for (const e of roots[i].querySelectorAll("*")) if (e.shadowRoot) roots.push(e.shadowRoot);
    // The colour a placeholder is drawn in: the first one in the page's, else a new input's.
    const probe = document.createElement("input");
    probe.placeholder = "x";
    layer.append(probe);
    const holder =
      roots.flatMap((root) => [...root.querySelectorAll("input[placeholder], textarea[placeholder]")])[0] ?? probe;
    const placeholderColor = getComputedStyle(holder, "::placeholder").color;
    const canvases = [];
    for (const root of roots)
      for (const c of root.querySelectorAll("canvas")) {
        const r = c.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        // The view and the layout boxes are in document coordinates, a rectangle is in the viewport's.
        const [x, y] = [r.x + scrollX, r.y + scrollY];
        if (x + r.width <= view.x || y + r.height <= view.y || x >= view.x + view.w || y >= view.y + view.h) continue;
        try {
          canvases.push({ x, y, w: r.width, h: r.height, href: c.toDataURL("image/png") });
        } catch {
          // A tainted canvas cannot be read; the converter says it has no picture.
        }
      }
    return { metrics, widths, gaps, placeholderColor, canvases, overlays: outOverlays, marked, allRuns };
  });
}

// Runs in the page, on a scrolling element (`this`): the computed style of
// each part of its scrollbars that has a ::-webkit-scrollbar style, as
// {custom, parts: {key: style | null}}; `parts` lists the parts Chromium makes,
// each with its pseudo-element (the part of the name after
// "::-webkit-scrollbar") and the scrollbar pseudo-classes it matches.
//
// getComputedStyle cannot name a scrollbar part, nor a state like :vertical,
// and a rule's text cannot be copied to an element of our own: Chromium drops
// a var() shorthand from cssText once a longhand overrides part of it. So each
// rule that styles a part of this element's scrollbars gets, for a moment, one
// more selector: one that matches a probe element standing for that part, with
// the specificity of the selector it stands for, so that Chromium itself
// cascades the rules and resolves their var()s. The probe is an element of an
// unknown name, which no page rule but a `*` one matches, under a hidden
// parent that carries what the part inherits from the element.
//
// `viewport` is set for the scrollbars of a document's viewport, whose style
// source is the <body> or the root element (`this`): they take the standard
// properties from the root element, wherever the rules are.
//
// The result also has `standard`, what the platform's own scrollbar is drawn
// from where nothing custom styles it: {color, width, dark}, the computed
// scrollbar-color and scrollbar-width, and whether the colour scheme in use
// is dark.
function scrollbarParts({ styleNames, parts, viewport = false }) {
  const el = this;
  const cs = getComputedStyle(el);
  const source = viewport ? getComputedStyle(document.documentElement) : cs;
  const schemes = source.getPropertyValue("color-scheme").split(/\s+/);
  const standard = {
    color: source.getPropertyValue("scrollbar-color"),
    width: source.getPropertyValue("scrollbar-width"),
    dark:
      schemes.includes("dark") && (!schemes.includes("light") || matchMedia("(prefers-color-scheme: dark)").matches),
  };
  // The standard properties turn the ::-webkit-scrollbar styles off.
  if (standard.width !== "auto" || standard.color !== "auto") return { custom: false, standard, parts: {} };
  const top = (s) => {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "\\") i++;
      else if (c === '"' || c === "'") {
        for (i++; i < s.length && s[i] !== c; i++) if (s[i] === "\\") i++;
      } else if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (c === "," && !depth) {
        out.push(s.slice(start, i).trim());
        start = i + 1;
      }
    }
    out.push(s.slice(start).trim());
    return out;
  };
  const specificity = (sel) => {
    let [a, b, c] = [0, 0, 0];
    const n = sel.length;
    const ident = (i) => {
      while (i < n && (/[-\w]/.test(sel[i]) || sel[i] === "\\" || sel[i] > "\u007f")) i += sel[i] === "\\" ? 2 : 1;
      return i;
    };
    const close = (i, open, shut) => {
      for (let d = 0; i < n; i++) {
        const ch = sel[i];
        if (ch === "\\") i++;
        else if (ch === '"' || ch === "'") {
          for (i++; i < n && sel[i] !== ch; i++) if (sel[i] === "\\") i++;
        } else if (ch === open) d++;
        else if (ch === shut && --d === 0) return i;
      }
      return n;
    };
    for (let i = 0; i < n; ) {
      const ch = sel[i];
      if (ch === "#") {
        a++;
        i = ident(i + 1);
      } else if (ch === ".") {
        b++;
        i = ident(i + 1);
      } else if (ch === "[") {
        b++;
        i = close(i, "[", "]") + 1;
      } else if (ch === ":" && sel[i + 1] === ":") {
        c++;
        i = ident(i + 2);
        if (sel[i] === "(") i = close(i, "(", ")") + 1;
      } else if (ch === ":") {
        const j = ident(i + 1);
        const name = sel.slice(i + 1, j).toLowerCase();
        if (sel[j] === "(") {
          const k = close(j, "(", ")");
          // :is(), :not() and :has() count as their most specific argument, :where() as nothing.
          if (["is", "not", "has", "matches", "-webkit-any"].includes(name)) {
            const best = top(sel.slice(j + 1, k))
              .map(specificity)
              .reduce((m, s) => ((s[0] - m[0] || s[1] - m[1] || s[2] - m[2]) > 0 ? s : m), [0, 0, 0]);
            a += best[0];
            b += best[1];
            c += best[2];
          } else if (name !== "where") b++;
          i = k + 1;
        } else {
          if (["before", "after", "first-line", "first-letter"].includes(name)) c++;
          else b++;
          i = j;
        }
      } else if (/[-\w\\]/.test(ch) || ch > "\u007f") {
        c++;
        i = ident(i);
      } else i++;
    }
    return [a, b, c];
  };

  // The probes, under a parent that hands down what a part inherits from the element.
  const scope = el.getRootNode();
  const host = document.createElement("tbsb-probes");
  const inherit = ["color", "font-size", "font-family", "visibility", "direction"];
  host.style.setProperty("display", "none");
  for (const name of cs)
    if (name.startsWith("--") || inherit.includes(name)) host.style.setProperty(name, cs.getPropertyValue(name));
  const probes = parts.map((_, k) => {
    const probe = document.createElement("tbsb-probe");
    probe.className = `tbsb-p${k}`;
    host.append(probe);
    return probe;
  });
  const inactive = !document.hasFocus();
  const matched = parts.map(() => false);
  let custom = false;

  // Every style rule that names a scrollbar part, in the element's own scope.
  const rules = [];
  const visit = (list) => {
    for (const r of list) {
      if (r instanceof CSSStyleRule) {
        if (r.selectorText.includes("::-webkit-scrollbar")) rules.push(r);
      } else if (r instanceof CSSImportRule) {
        if (r.styleSheet) visit(r.styleSheet.cssRules);
      } else if (r.cssRules) visit(r.cssRules);
    }
  };
  const sheets =
    scope instanceof ShadowRoot
      ? [...scope.styleSheets, ...scope.adoptedStyleSheets]
      : [...document.styleSheets, ...document.adoptedStyleSheets];
  for (const sheet of sheets) {
    try {
      visit(sheet.cssRules);
    } catch {
      // A cross-origin sheet's rules cannot be read.
    }
  }
  const restore = [];
  try {
    for (const rule of rules) {
      const added = [];
      for (const item of top(rule.selectorText)) {
        const m = /::-webkit-scrollbar(-button|-track-piece|-track|-thumb|-corner)?((?::[-\w]+)*)$/i.exec(item);
        if (!m) continue;
        const prefix = item.slice(0, m.index);
        const owner = prefix === "" || /[\s>+~]$/.test(prefix) ? `${prefix}*` : prefix;
        let mine;
        try {
          mine = el.matches(owner);
        } catch {
          mine = false;
        }
        if (!mine) continue;
        const pseudo = (m[1] ?? "").toLowerCase();
        if (pseudo === "") custom = true;
        const states = m[2].toLowerCase().split(":").filter(Boolean);
        const [a, b, c] = specificity(item);
        for (const [k, p] of parts.entries()) {
          if (p.pseudo !== pseudo) continue;
          if (!states.every((s) => p.states.includes(s) || (s === "window-inactive" && inactive))) continue;
          // A rule with no declarations still gives the part a style of its own.
          matched[k] = true;
          // One class of the probe's own stands in for the pseudo-element, and adds
          // the same to every rule; the rest pad it to the selector's specificity.
          added.push(
            `.tbsb-p${k}${":not(#tbsb-none)".repeat(a)}${`.tbsb-p${k}`.repeat(b)}${":not(tbsb-none)".repeat(c > 0 ? c - 1 : 0)}`,
          );
        }
      }
      if (added.length) {
        restore.push([rule, rule.selectorText]);
        rule.selectorText = `${rule.selectorText}, ${added.join(", ")}`;
      }
    }
    (scope instanceof ShadowRoot ? scope : document.body).append(host);
    const out = {};
    for (const [k, p] of parts.entries()) {
      if (!matched[k]) {
        out[p.key] = null;
        continue;
      }
      const pcs = getComputedStyle(probes[k]);
      out[p.key] = Object.fromEntries(styleNames.map((name) => [name, pcs.getPropertyValue(name)]));
    }
    // The length a part of auto size takes: the platform's classic scrollbar
    // thickness, which is not the thickness of the scrollbar the platform
    // draws now (17 against 15 on Windows). It is the thickness of a custom
    // scrollbar of auto width: one in a shadow root, where no page rule reaches.
    const shadowHost = document.createElement("tbsb-native");
    shadowHost.style.cssText = "position:fixed;left:0;top:0;visibility:hidden";
    const sheet = document.createElement("style");
    sheet.textContent = "div::-webkit-scrollbar{background:transparent}";
    const box = document.createElement("div");
    box.style.cssText = "width:100px;height:100px;overflow:scroll";
    shadowHost.attachShadow({ mode: "open" }).append(sheet, box);
    document.body.append(shadowHost);
    const native = box.offsetWidth - box.clientWidth;
    shadowHost.remove();
    return { custom, standard, native, parts: out };
  } finally {
    for (const [rule, text] of restore) rule.selectorText = text;
    host.remove();
  }
}

// Runs in the page (exported for test/svgshot.test.mjs, which gives it a
// document of its own): the file of the web font each [style, weight, size,
// family] key was drawn with, as {key: {url, italic} | null}. The font is the @font-face
// rule that CSS font matching picks for the first family of the key's list that
// has any: the style asked for, else the other; then the weight, as the rules'
// ranges hold it, else the nearest, which is the one above for a weight over 500
// and the one below for under; of rules that match alike, the last. The name a
// font reports for itself ("Inter Variable") need not be the name the page
// gives it ("Inter"), so the rules are found by the page's names.
export function webFontFiles(keys) {
  const unq = (s) => s.trim().replace(/^["']|["']$/g, "");
  const faces = [];
  const visit = (rules, base) => {
    for (const r of rules) {
      if (r instanceof CSSFontFaceRule) {
        const m = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(r.style.getPropertyValue("src"));
        if (!m) continue;
        const weight = r.style.getPropertyValue("font-weight").trim() || "normal";
        const [lo, hi = lo] = weight.split(/\s+/).map((w) => (w === "normal" ? 400 : w === "bold" ? 700 : Number(w)));
        const style = r.style.getPropertyValue("font-style").trim() || "normal";
        faces.push({
          family: unq(r.style.getPropertyValue("font-family")).toLowerCase(),
          url: new URL(m[1], base).href,
          italic: style !== "normal",
          lo: lo || 400,
          hi: hi || 400,
        });
      } else if (r.cssRules) visit(r.cssRules, base);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      visit(sheet.cssRules, sheet.href ?? document.baseURI);
    } catch {
      // A cross-origin sheet's rules cannot be read.
    }
  }
  const out = {};
  for (const key of keys) {
    const [style, weightText, , list] = JSON.parse(key);
    const weight = Number(weightText) || 400;
    const italic = style !== "normal";
    // Commas inside quotes are not separators.
    const names = (list.match(/"[^"]*"|'[^']*'|[^,]+/g) ?? []).map((n) => unq(n).toLowerCase());
    const family = names.find((n) => faces.some((f) => f.family === n));
    // Ranked by [style missed, weight missed, the wrong side of the weight]; the lowest wins.
    let best = null;
    let rank = null;
    for (const f of faces.filter((f) => f.family === family)) {
      const miss = weight < f.lo ? f.lo - weight : weight > f.hi ? weight - f.hi : 0;
      const wrongSide = weight > 500 ? (f.lo > weight ? 0 : 1) : f.hi < weight ? 0 : 1;
      const candidate = [f.italic === italic ? 0 : 1, miss, wrongSide];
      const before = candidate.findIndex((v, i) => v !== rank?.[i]);
      if (!rank || before < 0 || candidate[before] < rank[before]) {
        best = f;
        rank = candidate;
      }
    }
    out[key] = best && { url: best.url, italic: best.italic };
  }
  return out;
}

// Runs in the page: the bytes of the file at `url` as a data: URL.
async function webFontData(url) {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(blob);
  });
}

/**
 * The SVG picture of `clip` ({x, y, width, height} CSS px; null for the whole
 * viewport) of the page `conn` is attached to. `background` is false for a
 * cut-out. Returns {svg, stats}.
 */
export async function svgOfPage(conn, clip, { background = true } = {}) {
  const snapshot = await conn.send(
    "DOMSnapshot.captureSnapshot",
    { computedStyles: SNAPSHOT_STYLES, includePaintOrder: true, includeDOMRects: true },
    { timeout: 30000 },
  );
  const decoded = decodeSnapshot(snapshot, SNAPSHOT_STYLES);
  let view;
  if (clip) view = { x: clip.x, y: clip.y, w: clip.width, h: clip.height };
  else {
    const { w, h } = await conn.evaluate("({ w: innerWidth, h: innerHeight })");
    view = { x: 0, y: 0, w, h };
  }

  // Runs `expression` in a frame's own world, or in the page's when `context` is undefined.
  const run = async (context, expression, awaitPromise = false) => {
    if (context === undefined) return conn.evaluate(expression, { awaitPromise });
    const r = await conn.send("Runtime.evaluate", {
      expression,
      contextId: context,
      awaitPromise,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };

  // The documents measured: the page's, and each frame of the same process that
  // shows in the picture, each in its own world, with the part of it that shows.
  const docs = [{ doc: decoded, view, context: undefined, geometry: null, inner: null }];
  const measured = new Map();
  conn.svgWebFonts ??= new Map();
  try {
    await conn.send("DOM.enable");
    await conn.send("CSS.enable");
    await conn.send("DOM.getDocument", { depth: 0 });
    for (let i = 0; i < docs.length; i++) {
      const entry = docs[i];
      try {
        measured.set(entry.doc, await measureDocument(entry));
      } catch (error) {
        // A frame that cannot be measured is left out, and renderSvg says so; the page must be.
        if (i === 0) throw error;
        continue;
      }
      for (const { l, doc } of framesIn(entry.doc, entry.view)) {
        let context;
        let inner;
        try {
          ({ executionContextId: context } = await conn.send("Page.createIsolatedWorld", {
            frameId: doc.frameId,
            worldName: "svgshot",
          }));
          inner = await run(context, "({ w: innerWidth, h: innerHeight })");
        } catch {
          // A frame that has gone since the snapshot is not drawn.
          continue;
        }
        const geometry = frameGeometry(l, inner);
        unzoom(doc, geometry.scale);
        const shown = frameView(entry.view, geometry, doc);
        if (shown) docs.push({ doc, view: shown, context, geometry, inner });
      }
    }
  } finally {
    for (const { context } of docs)
      await run(context, `document.getElementById(${JSON.stringify(MEASURE_ID)})?.remove()`).catch(() => {});
    await conn.send("CSS.disable").catch(() => {});
    await conn.send("DOM.disable").catch(() => {});
  }

  // What a document's text needs, measured in the document itself: the page's
  // own fonts, styles and canvases are what its runs are drawn with.
  async function measureDocument({ doc, view, context, geometry, inner }) {
    const { keys, runs, skips } = textNeeds(doc, view);
    const overlays = context === undefined ? OVERLAYS : [];
    const args = JSON.stringify({ keys, runs, skips, view, measureId: MEASURE_ID, overlays });
    const page = await run(context, `(${measure})(${args})`, true);
    // The measuring layer's runs, as DevTools nodes, for the fonts Chromium drew them with.
    const { result: layer } = await conn.send("Runtime.evaluate", {
      expression: `document.getElementById(${JSON.stringify(MEASURE_ID)})`,
      contextId: context,
    });
    const platform = new Map();
    try {
      const { nodeId } = await conn.send("DOM.requestNode", { objectId: layer.objectId });
      const { nodeIds } = await conn.send("DOM.querySelectorAll", { nodeId, selector: "span[data-k]" });
      for (const [k, id] of nodeIds.entries()) {
        const { fonts: used } = await conn.send("CSS.getPlatformFontsForNode", { nodeId: id });
        const [key, text] = page.allRuns[k];
        platform.set(`${key}\u0000${text}`, used);
      }
    } finally {
      await conn.send("Runtime.releaseObject", { objectId: layer.objectId }).catch(() => {});
    }

    // The file of each web font a run was drawn with, which the document's rules pick
    // for the run's font (by the names the document gives, and not the font's own), and
    // its bytes, read once per connection and origin.
    const origin = new URL(doc.url).origin;
    const custom = new Set();
    for (const [id, used] of platform) if (used.some((f) => f.isCustomFont)) custom.add(id.split("\u0000")[0]);
    const files = custom.size ? await run(context, `(${webFontFiles})(${JSON.stringify([...custom])})`) : {};
    for (const file of Object.values(files)) {
      const cached = file && `${origin}|${file.url}`;
      if (!file || conn.svgWebFonts.has(cached)) continue;
      const data = await run(context, `(${webFontData})(${JSON.stringify(file.url)})`, true);
      // Named by its bytes, so that one font the page and a frame both use is one face of the picture.
      conn.svgWebFonts.set(cached, data && { family: createHash("sha1").update(data).digest("hex"), data });
    }
    const fontsFor = (key, text) => {
      const file = files[key];
      const web = file && conn.svgWebFonts.get(`${origin}|${file.url}`);
      let drawn = false;
      return (platform.get(`${key}\u0000${text}`) ?? [])
        .toSorted((a, b) => b.glyphCount - a.glyphCount)
        .map((f) => {
          if (!f.isCustomFont) return { ps: f.postScriptName };
          // One face for the web font, whichever names it reported.
          if (drawn || !web) return null;
          drawn = true;
          return { ...web, weight: JSON.parse(key)[1] };
        })
        .filter((s) => s?.ps || s?.data);
    };

    // Each scrolling box's scrollbar styles, and the frame's viewport's.
    const scrollbars = new Map();
    const partsOf = async (l, nodes, viewport) => {
      for (const node of nodes) {
        if (!node.backendNodeId) continue;
        const { object } = await conn.send("DOM.resolveNode", { backendNodeId: node.backendNodeId });
        try {
          const { result } = await conn.send("Runtime.callFunctionOn", {
            objectId: object.objectId,
            functionDeclaration: String(scrollbarParts),
            arguments: [{ value: { styleNames: PART_STYLES, parts: scrollbarPartList(l), viewport } }],
            returnByValue: true,
          });
          scrollbars.set(l.key, result.value);
          if (result.value.custom) return;
        } finally {
          await conn.send("Runtime.releaseObject", { objectId: object.objectId }).catch(() => {});
        }
      }
    };
    for (const { l } of scrollersIn(doc, view)) await partsOf(l, [l.node], false);
    const bars = geometry && viewportScroller(doc, geometry, inner);
    if (bars) await partsOf(bars, viewportStyleSources(doc), true);

    return { page, skips, fontsFor, scrollbars, inner };
  }

  const fonts = new PictureFonts();
  const envOf = ({ page, skips, fontsFor, scrollbars, inner }) => {
    const widths = new Map(page.allRuns.map(([key, text], k) => [`${key}\u0000${text}`, page.widths[k]]));
    const gaps = new Map(skips.map((skip, k) => [skip.join("\u0000"), page.gaps[k]]));
    return {
      metrics: (key) => page.metrics[key] ?? { ascent: 0, height: 0, line: 0 },
      textWidth: (key, text) => widths.get(`${key}\u0000${text}`) ?? null,
      inkGaps: (...skip) => gaps.get(skip.join("\u0000")) ?? null,
      placeholderColor: page.placeholderColor,
      canvases: page.canvases,
      fontsFor,
      scrollbars,
      inner,
    };
  };
  const mine = measured.get(decoded);
  const overlays = mine.page.overlays.map((xml) =>
    xml.replace(/--tbk:\s*(\d+);?/g, (_, k) => {
      const { key, text } = mine.page.marked[Number(k)];
      const [style, weight] = JSON.parse(key);
      // Into a style="..." attribute: the face names' quotes must not end it.
      const css = fonts.css(text, mine.fontsFor(key, text), weight, style)?.replace(/"/g, "'");
      return css ? `${css};` : "";
    }),
  );
  const drawn = renderSvg(decoded, {
    clip: view,
    ...envOf(mine),
    fonts,
    background,
    overlays,
    frames: (doc) => (measured.has(doc) ? envOf(measured.get(doc)) : null),
  });
  const svg = oneLine(await withFaces(drawn.svg, fonts));
  const failed = fonts.failed?.length ?? 0;
  if (failed) drawn.stats.unsupported["text in a font that could not be cut"] = failed;
  return { svg, stats: drawn.stats };
}
