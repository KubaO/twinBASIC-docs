// Spike: the fonts an SVG picture's text is drawn in, embedded as subsets.
//
// Chromium names, per node, the font files it drew the node's text with
// (CSS.getPlatformFontsForNode). Each file becomes one private face of the
// picture, "f0", "f1", ...; a run of text lists its faces in the order
// Chromium preferred them, and every character is given to the first face that
// has it -- which is the choice a viewer's own fallback then makes too. At the
// end each face is cut down to exactly the characters given to it, by
// scripts/subset_font.py (fontTools), so the picture carries nothing more.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../../lib/repo-paths.mjs";

const SUBSET_SCRIPT = path.join(REPO_ROOT, "scripts", "subset_font.py");

// --- reading a font's tables ----------------------------------------------------

function tables(buf, index) {
  const off = buf.toString("latin1", 0, 4) === "ttcf" ? buf.readUInt32BE(12 + 4 * index) : 0;
  const out = new Map();
  for (let i = 0; i < buf.readUInt16BE(off + 4); i++) {
    const p = off + 12 + i * 16;
    out.set(buf.toString("latin1", p, p + 4), { offset: buf.readUInt32BE(p + 8), length: buf.readUInt32BE(p + 12) });
  }
  return out;
}

// The PostScript name (name ID 6) of face `index`.
function postScriptName(buf, index) {
  const t = tables(buf, index).get("name");
  if (!t) return null;
  const base = t.offset;
  const strings = base + buf.readUInt16BE(base + 4);
  let mac = null;
  for (let r = 0; r < buf.readUInt16BE(base + 2); r++) {
    const p = base + 6 + r * 12;
    if (buf.readUInt16BE(p + 6) !== 6) continue;
    const s = strings + buf.readUInt16BE(p + 10);
    const e = s + buf.readUInt16BE(p + 8);
    if (buf.readUInt16BE(p) === 3) return Buffer.from(buf.subarray(s, e)).swap16().toString("utf16le");
    if (buf.readUInt16BE(p) === 1) mac = buf.toString("latin1", s, e);
  }
  return mac;
}

/** Face `index`'s own weight class and italic flag, from its OS/2 table. */
export function faceStyle(buf, index = 0) {
  const t = tables(buf, index).get("OS/2");
  if (!t) return { weight: 400, italic: false };
  return { weight: buf.readUInt16BE(t.offset + 4), italic: (buf.readUInt16BE(t.offset + 62) & 0x201) !== 0 };
}

/** Every code point face `index` of the font in `buf` maps to a glyph. */
export function cmapCoverage(buf, index = 0) {
  const out = new Set();
  const t = tables(buf, index).get("cmap");
  if (!t) return out;
  const base = t.offset;
  let best = 0;
  let rank = 0;
  for (let i = 0; i < buf.readUInt16BE(base + 2); i++) {
    const p = base + 4 + i * 8;
    const sub = base + buf.readUInt32BE(p + 4);
    const format = buf.readUInt16BE(sub);
    const r = format === 12 ? 3 : format === 4 && buf.readUInt16BE(p) === 3 ? 2 : format === 4 ? 1 : 0;
    if (r > rank) [best, rank] = [sub, r];
  }
  if (!rank) return out;
  if (buf.readUInt16BE(best) === 12) {
    for (let g = 0; g < buf.readUInt32BE(best + 12); g++) {
      const p = best + 16 + g * 12;
      const first = buf.readUInt32BE(p);
      const gid = buf.readUInt32BE(p + 8);
      for (let c = first; c <= buf.readUInt32BE(p + 4); c++) if (gid + c - first) out.add(c);
    }
    return out;
  }
  const segs = buf.readUInt16BE(best + 6) / 2;
  const ends = best + 14;
  const starts = ends + segs * 2 + 2;
  const deltas = starts + segs * 2;
  const ranges = deltas + segs * 2;
  for (let s = 0; s < segs; s++) {
    const end = buf.readUInt16BE(ends + 2 * s);
    const delta = buf.readInt16BE(deltas + 2 * s);
    const ro = buf.readUInt16BE(ranges + 2 * s);
    for (let c = buf.readUInt16BE(starts + 2 * s); c <= end && c !== 0xffff; c++) {
      let gid = ro ? buf.readUInt16BE(ranges + 2 * s + ro + 2 * (c - buf.readUInt16BE(starts + 2 * s))) : c;
      if (gid) gid = (gid + delta) & 0xffff;
      if (gid) out.add(c);
    }
  }
  return out;
}

/** Map from PostScript name to {file, index} for every font installed for this user. */
export function systemFonts() {
  const dirs = [path.join(process.env.WINDIR ?? "C:/Windows", "Fonts")];
  if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts"));
  const index = new Map();
  for (const dir of dirs) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!/\.(ttf|otf|ttc)$/i.test(n)) continue;
      const file = path.join(dir, n);
      try {
        const buf = fs.readFileSync(file);
        const count = buf.toString("latin1", 0, 4) === "ttcf" ? buf.readUInt32BE(8) : 1;
        for (let k = 0; k < count; k++) {
          const ps = postScriptName(buf, k);
          if (ps && !index.has(ps)) index.set(ps, { file, index: k });
        }
      } catch {
        // An unreadable or malformed file is not a font this tool can use.
      }
    }
  }
  return index;
}

// --- the picture's faces ----------------------------------------------------------

export class PictureFonts {
  constructor({ python = process.env.PYTHON ?? "python", hinting = true } = {}) {
    this.python = python;
    this.hinting = hinting;
    this.system = null;
    this.loaded = new Map();
    this.faces = [];
  }

  /** A source is {ps} for an installed font or {family, data} for a web font (a data: URL). */
  load(src) {
    const key = src.ps ? `ps:${src.ps}` : `web:${src.family}`;
    if (this.loaded.has(key)) return this.loaded.get(key);
    let face = null;
    if (src.ps) {
      this.system ??= systemFonts();
      const hit = this.system.get(src.ps);
      if (hit) {
        const buf = fs.readFileSync(hit.file);
        face = {
          job: { path: hit.file, index: hit.index },
          covers: cmapCoverage(buf, hit.index),
          ...faceStyle(buf, hit.index),
        };
      }
    } else if (src.data) {
      const data = src.data.slice(src.data.indexOf(",") + 1);
      const buf = Buffer.from(data, "base64");
      face = { job: { data }, covers: cmapCoverage(buf), ...faceStyle(buf) };
    }
    if (face) {
      Object.assign(face, { name: `f${this.faces.length}`, used: new Set([0x20]) });
      this.faces.push(face);
    }
    this.loaded.set(key, face);
    return face;
  }

  /**
   * The CSS a run needs to be drawn in its faces, with each character of
   * `text` recorded against the first face that has it; null when none of the
   * run's fonts can be loaded. `weight` and `style` are the computed ones:
   * like Blink (FontPlatformData), a weight of 600 or more on a face lighter
   * than that is emboldened, and italic on an upright face is slanted, so
   * only then does the run ask for bold or italic -- a face declared without
   * descriptors is normal, and the viewer synthesises the same way.
   */
  css(text, sources, weight, style) {
    const faces = sources.map((s) => this.load(s)).filter(Boolean);
    if (!faces.length) return null;
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      (faces.find((f) => f.covers.has(cp)) ?? faces[0]).used.add(cp);
    }
    const [primary] = faces;
    const bold = Number(weight) >= 600 && primary.weight < 600;
    const slant = style !== "normal" && !primary.italic;
    // Stated even when normal: the run may sit where a weight is inherited (the
    // annotation layer's text asks for 600, and gets the Semibold face).
    return `font-family:${faces.map((f) => `"${f.name}"`).join(",")};font-weight:${bold ? "bold" : "normal"};font-style:${slant ? "italic" : "normal"}`;
  }

  /**
   * One @font-face rule per face a run drew with, each a subset of what it
   * drew. Asynchronous: shoot_docs runs several IDEs on one event loop, and a
   * blocking subprocess would stall all of them.
   */
  async faceRules() {
    const used = this.faces.filter((f) => f.used.size > 1);
    if (!used.length) return "";
    const jobs = used.map((f) => ({ ...f.job, unicodes: [...f.used].sort((a, b) => a - b), hinting: this.hinting }));
    const stdout = await new Promise((resolve, reject) => {
      const child = spawn(this.python, [SUBSET_SCRIPT], { windowsHide: true });
      const out = [];
      const err = [];
      child.stdout.on("data", (d) => out.push(d));
      child.stderr.on("data", (d) => err.push(d));
      child.on("error", (e) => reject(new Error(`subset_font.py could not run: ${e.message}`)));
      child.on("close", (code) => {
        if (code === 0) resolve(Buffer.concat(out).toString("utf8"));
        else reject(new Error(`subset_font.py failed: ${Buffer.concat(err).toString("utf8").trim()}`));
      });
      child.stdin.end(JSON.stringify(jobs));
    });
    const results = JSON.parse(stdout);
    return used
      .map((f, i) => `@font-face{font-family:"${f.name}";src:url(data:font/woff2;base64,${results[i].woff2})}`)
      .join("");
  }
}

/** Where renderSvg leaves the picture's @font-face rules to be filled in. */
export const FACES_MARK = "/*@font-face*/";

/** `svg` with its @font-face rules filled in: the subsets of what `fonts` drew. */
export async function withFaces(svg, fonts) {
  return svg.replace(FACES_MARK, fonts ? await fonts.faceRules() : "");
}
