// Draws each picture's SVG again from its bundle (bundle.mjs), the converter as it
// is now, without taking the picture again: what to run after a change to the
// converter, in place of shoot_docs.mjs --svg. Each SVG is judged against its PNG
// and written or removed as shoot_docs.mjs does (keep.mjs).
//
// A bundle answers only what the converter asked when the picture was taken. A
// picture is left as it is, and listed as needing a retake, when its PNG is no
// longer the one its bundle was taken with, when its bundle lacks a computed style
// the converter now reads, or when the converter asks a question its bundle has no
// answer for (a miss the capture did not have). The list ends with the
// shoot_docs.mjs command that takes them again.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { exitOnCrash, numberOption, parseCli, printHelpAndExit, regexOption, withUsageError } from "../../lib/cli.mjs";
import { REPO_ROOT } from "../../lib/repo-paths.mjs";
import { launchBrowser } from "../lib/browser.mjs";
import { pngHash, readBundle, renderBundle } from "./bundle.mjs";
import { SNAPSHOT_STYLES } from "./capture.mjs";
import { holdsUserName, judgeSvg, SVG_FAITHFUL, writeSvg } from "./keep.mjs";

exitOnCrash();

const USAGE = `usage: node scripts/svgshot/replay.mjs [--only <regex>] [--bundles <dir>] [--out <dir>] [--diffs <dir>] [--jobs N] [-h, --help]

Draws each picture's SVG again from the bundle shoot_docs.mjs --svg saved when it
took the picture, with the converter as it is now, and writes it beside its PNG
as shoot_docs.mjs does: written when no more than ${SVG_FAITHFUL}% of its pixels
are far off the PNG's and its bytes differ from the file's, else not written and
an older one removed. Takes no picture and starts no IDE; needs Python with
fontTools, as --svg does.

A picture whose PNG is not the one its bundle was taken with, whose bundle lacks a
computed style the converter now reads, or for which the converter asks something
its bundle cannot answer, is left as it is and listed as needing a retake, with
the shoot_docs.mjs command that takes them again.

  --only <regex>   only the pictures whose path under docs (with .light for a
                   light one) matches
  --bundles <dir>  the bundle cache (default .svgshot-bundles in the repository)
  --out <dir>      the folder the pictures are in (default docs)
  --diffs <dir>    write each SVG's difference map there, as <name>.svg-diff.png
  --jobs N         pictures drawn at once (default 6)
  -h, --help       print this text and exit

Exit codes:
  0  every picture was drawn again: written, unchanged, or left as a PNG
  1  a picture needs a retake, could not be drawn, or its SVG holds the Windows
     user name
  2  the tool could not run: a refused command line, no bundle cache, no browser,
     or a crash`;

const { values } = withUsageError(() =>
  parseCli(process.argv.slice(2), {
    options: {
      only: { type: "string" },
      bundles: { type: "string" },
      out: { type: "string" },
      diffs: { type: "string" },
      jobs: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    stopAt: ["help"],
  }),
);
if (values.help) printHelpAndExit(USAGE);
const only = values.only === undefined ? null : withUsageError(() => regexOption(values.only, { option: "--only" }));
const jobs = withUsageError(() =>
  numberOption(values.jobs ?? "6", { option: "--jobs", integer: true, min: 1, max: 32 }),
);
const bundlesRoot = path.resolve(values.bundles ?? path.join(REPO_ROOT, ".svgshot-bundles"));
const outRoot = path.resolve(values.out ?? path.join(REPO_ROOT, "docs"));
const diffsRoot = values.diffs === undefined ? null : path.resolve(values.diffs);
if (!existsSync(bundlesRoot)) {
  console.error(`replay: no bundle cache at ${bundlesRoot}; shoot_docs.mjs --svg writes it`);
  process.exit(2);
}
const USER = userInfo().username;

// Every bundle under the cache, as the picture's path under docs with forward slashes.
const SUFFIX = ".bundle.json.gz";
const outs = readdirSync(bundlesRoot, { recursive: true })
  .map((f) => String(f).replace(/\\/g, "/"))
  .filter((f) => f.endsWith(SUFFIX))
  .map((f) => `${f.slice(0, -SUFFIX.length)}.png`)
  .filter((out) => !only || only.test(out))
  .sort();

const counts = {};
const retakes = [];
let failed = 0;
const say = (out, line) => console.log(`${out.replace(/\.png$/i, ".svg")}: ${line}`);
const browser = await launchBrowser();

async function replay(out) {
  const bundle = readBundle(path.join(bundlesRoot, out.replace(/\.png$/i, SUFFIX)));
  const pngFile = path.join(outRoot, out);
  const svgFile = pngFile.replace(/\.png$/i, ".svg");
  const retake = (why) => {
    retakes.push({ out, why });
    counts["need a retake"] = (counts["need a retake"] ?? 0) + 1;
    say(out, `left as it is, needs a retake (${why})`);
  };
  if (!existsSync(pngFile)) return retake("the PNG is gone");
  const png = readFileSync(pngFile);
  if (pngHash(png) !== bundle.png) return retake("the PNG is not the one the bundle was taken with");
  const lacking = SNAPSHOT_STYLES.filter((s) => !bundle.styles.includes(s));
  if (lacking.length) return retake(`the bundle has no ${lacking.join(", ")}`);
  const { svg, stats, misses } = await renderBundle(bundle);
  const had = new Set(bundle.misses ?? []);
  const fresh = misses.filter((m) => !had.has(m));
  if (fresh.length)
    return retake(
      `no answer for ${fresh.length} question${fresh.length > 1 ? "s" : ""}: ${fresh.slice(0, 3).join("; ")}`,
    );
  if (holdsUserName(svg, USER)) throw new Error("the SVG holds the Windows user name");
  const { diff, faithful, measures } = await judgeSvg(browser, svg, png, stats);
  if (diffsRoot) {
    mkdirSync(diffsRoot, { recursive: true });
    writeFileSync(
      path.join(diffsRoot, `${out.replace(/[\\/]/g, "__").replace(/\.png$/i, "")}.svg-diff.png`),
      diff.diff,
    );
  }
  let state;
  if (!faithful) {
    state = existsSync(svgFile) ? "removed" : "not written";
    if (state === "removed") rmSync(svgFile);
    say(out, `${state}, the PNG is kept (${measures})`);
  } else {
    state = writeSvg(svgFile, svg);
    say(out, `${state} (${measures})`);
  }
  counts[state] = (counts[state] ?? 0) + 1;
}

try {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(jobs, outs.length) }, async () => {
      while (next < outs.length) {
        const out = outs[next++];
        try {
          await replay(out);
        } catch (e) {
          failed++;
          counts.failed = (counts.failed ?? 0) + 1;
          say(out, `FAILED: ${e.message}`);
        }
      }
    }),
  );
} finally {
  await browser.close();
}

console.log(
  `\n${outs.length} bundle${outs.length === 1 ? "" : "s"}: ${
    Object.entries(counts)
      .map(([k, n]) => `${n} ${k}`)
      .join(", ") || "none"
  }`,
);
if (retakes.length) {
  // shoot_docs.mjs --only matches a shot's out, the dark picture's path: one regex for all.
  const names = [...new Set(retakes.map((r) => path.posix.basename(r.out).replace(/(\.light)?\.png$/i, "")))];
  const regex = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  console.log(`to take them again: node scripts/shoot_docs.mjs --svg --only "${regex}"`);
}
process.exit(failed || retakes.length ? 1 : 0);
