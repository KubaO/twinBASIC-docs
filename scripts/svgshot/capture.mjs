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
//      font a run was drawn with;
//   4. the annotation layer (svg#tbShotAnnotation) as XML, its text moved onto
//      the picture's own faces.
// The measuring layer is removed again before this returns.

import { PictureFonts, withFaces } from "./fonts.mjs";
import { decodeSnapshot, oneLine, renderSvg, scrollbarPartList, scrollersIn, textNeeds } from "./snapshot-svg.mjs";

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
        if (r.right <= view.x || r.bottom <= view.y || r.x >= view.x + view.w || r.y >= view.y + view.h) continue;
        try {
          canvases.push({ x: r.x, y: r.y, w: r.width, h: r.height, href: c.toDataURL("image/png") });
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
function scrollbarParts({ styleNames, parts }) {
  const el = this;
  const cs = getComputedStyle(el);
  // The standard properties turn the ::-webkit-scrollbar styles off.
  if (cs.getPropertyValue("scrollbar-width") !== "auto" || cs.getPropertyValue("scrollbar-color") !== "auto")
    return { custom: false, parts: {} };
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
    return { custom, native, parts: out };
  } finally {
    for (const [rule, text] of restore) rule.selectorText = text;
    host.remove();
  }
}

// Runs in the page: the bytes of the web font `family` as a data: URL. Of
// several @font-face rules for one family, the last one is the one used.
async function webFont(family) {
  const unq = (s) => s.replace(/^["']|["']$/g, "");
  let found = null;
  const visit = (rules, base) => {
    for (const r of rules) {
      if (r instanceof CSSFontFaceRule && unq(r.style.getPropertyValue("font-family")) === family) {
        const m = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(r.style.getPropertyValue("src"));
        if (m) found = new URL(m[1], base).href;
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
  if (!found) return null;
  const blob = await (await fetch(found)).blob();
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
  const { keys, runs, skips } = textNeeds(decoded, view);

  let page;
  const platform = new Map();
  const scrollbars = new Map();
  try {
    const args = JSON.stringify({ keys, runs, skips, view, measureId: MEASURE_ID, overlays: OVERLAYS });
    page = await conn.evaluate(`(${measure})(${args})`, { awaitPromise: true });
    await conn.send("DOM.enable");
    await conn.send("CSS.enable");
    const { root } = await conn.send("DOM.getDocument", { depth: 0 });
    const { nodeIds } = await conn.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: `#${MEASURE_ID} > span[data-k]`,
    });
    for (const [k, nodeId] of nodeIds.entries()) {
      const { fonts: used } = await conn.send("CSS.getPlatformFontsForNode", { nodeId });
      const [key, text] = page.allRuns[k];
      platform.set(`${key}\u0000${text}`, used);
    }
    for (const { l } of scrollersIn(decoded, view)) {
      if (!l.node.backendNodeId) continue;
      const { object } = await conn.send("DOM.resolveNode", { backendNodeId: l.node.backendNodeId });
      try {
        const { result } = await conn.send("Runtime.callFunctionOn", {
          objectId: object.objectId,
          functionDeclaration: String(scrollbarParts),
          arguments: [{ value: { styleNames: PART_STYLES, parts: scrollbarPartList(l) } }],
          returnByValue: true,
        });
        scrollbars.set(l.li, result.value);
      } finally {
        await conn.send("Runtime.releaseObject", { objectId: object.objectId }).catch(() => {});
      }
    }
  } finally {
    await conn.evaluate(`document.getElementById(${JSON.stringify(MEASURE_ID)})?.remove()`).catch(() => {});
    await conn.send("CSS.disable").catch(() => {});
    await conn.send("DOM.disable").catch(() => {});
  }

  // The bytes of each web font a run was drawn with, read once per connection.
  conn.svgWebFonts ??= new Map();
  for (const used of platform.values())
    for (const f of used)
      if (f.isCustomFont && !conn.svgWebFonts.has(f.familyName))
        conn.svgWebFonts.set(
          f.familyName,
          await conn.evaluate(`(${webFont})(${JSON.stringify(f.familyName)})`, { awaitPromise: true }),
        );
  const fontsFor = (key, text) =>
    (platform.get(`${key}\u0000${text}`) ?? [])
      .toSorted((a, b) => b.glyphCount - a.glyphCount)
      .map((f) =>
        f.isCustomFont ? { family: f.familyName, data: conn.svgWebFonts.get(f.familyName) } : { ps: f.postScriptName },
      )
      .filter((s) => s.ps || s.data);

  const fonts = new PictureFonts();
  const overlays = page.overlays.map((xml) =>
    xml.replace(/--tbk:\s*(\d+);?/g, (_, k) => {
      const { key, text } = page.marked[Number(k)];
      const [style, weight] = JSON.parse(key);
      // Into a style="..." attribute: the face names' quotes must not end it.
      const css = fonts.css(text, fontsFor(key, text), weight, style)?.replace(/"/g, "'");
      return css ? `${css};` : "";
    }),
  );
  const widths = new Map(page.allRuns.map(([key, text], k) => [`${key}\u0000${text}`, page.widths[k]]));
  const gaps = new Map(skips.map((skip, k) => [skip.join("\u0000"), page.gaps[k]]));
  const drawn = renderSvg(decoded, {
    clip: view,
    metrics: (key) => page.metrics[key] ?? { ascent: 0, height: 0, line: 0 },
    textWidth: (key, text) => widths.get(`${key}\u0000${text}`) ?? null,
    inkGaps: (...skip) => gaps.get(skip.join("\u0000")) ?? null,
    placeholderColor: page.placeholderColor,
    canvases: page.canvases,
    fonts,
    fontsFor,
    background,
    overlays,
    scrollbars,
  });
  return { svg: oneLine(await withFaces(drawn.svg, fonts)), stats: drawn.stats };
}
