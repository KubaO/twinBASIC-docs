// Unit tests for builder/render.mjs's markdown-it plugins, one plugin's
// behaviour at a time, through the site's own createMarkdownIt; and for the
// offline tree's URL rewrite when a link names a file only the website holds
// (builder/offline-rewrite.mjs); and for a picture in two themes, X.png with
// X.light.png beside it (themePairPlugin, and the book's lightOnly from
// builder/theme-pictures.mjs).
//
// The build compares whole pages, so a plugin that goes wrong only on input
// the corpus does not hold passes it: kramdownEllipsisPlugin shortened every
// dot run after a `..` or a code span in the same paragraph, and no page had
// one. These pin such inputs.
//
// Runs with a bare `node --test test/render.test.mjs`: no tree, no build.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { isWebsiteOnlyLink, rewriteHtml, websiteOf } from "../builder/offline-rewrite.mjs";
import { createMarkdownIt } from "../builder/render.mjs";
import { lightOnly, pairSizes, unpairedLightPictures } from "../builder/theme-pictures.mjs";
import { encodePng } from "../scripts/lib/png.mjs";

const md = createMarkdownIt({
  highlighter: null,
  linkTables: { byPath: new Map() },
  baseurl: "",
  staticFiles: new Set(),
});
const inline = (src) => md.renderInline(src, { page: {} });

describe("kramdownEllipsisPlugin", () => {
  const cases = [
    ["three dots", "wait...", "wait…"],
    ["four dots keep the fourth", "wait....", "wait…."],
    ["six dots keep three", "a......", "a…..."],
    ["two dots before a long run", ".. and ....", "… and …."],
    ["several runs in one paragraph", "x.. y... z....", "x… y… z…."],
    [
      "a code span with dots before a long run",
      "`x..` y....",
      '<code class="language-plaintext highlighter-rouge">x..</code> y….',
    ],
    ["guillemets before a long run", "..<<....", "…«…."],
    ["dashes before a long run", "a -- b --- c....", "a – b — c…."],
    ["quotes around a long run", '"word...." x', "“word….” x"],
    ["after ? markdown-it's `?..` stands", "?.... x....", "?.. x…."],
  ];
  for (const [name, src, want] of cases) {
    test(name, () => assert.equal(inline(src), want));
  }

  test("an autolink's dots are left as written", () => {
    assert.equal(inline("<https://x.org/a....b> c...."), '<a href="https://x.org/a....b">https://x.org/a....b</a> c….');
  });

  test("a private-use U+E000 in the text stays as written", () => {
    assert.ok(inline("\u{E000} a....").includes("\u{E000}"));
  });
});

// The offline tree's URL rewrite (builder/offline-rewrite.mjs): a link to a
// file the offline tree holds becomes page-relative; one to a file only the
// website holds becomes the website's absolute URL; one to neither is a miss.
describe("rewriteHtml with a website behind the offline tree", () => {
  const offline = new Set(["/a/Page.html", "/a/b/Other.html", "/a/b/inner.txt"]);
  const online = new Set([...offline, "/a/downloads/File.zip", "/a/Space Name.zip"]);
  const website = websiteOf({ url: "https://site.example/" }, online);
  const rewrite = (html, baseurl = "", site = website) =>
    rewriteHtml(
      html,
      "a",
      ["a"],
      offline,
      { rawResolution: new Map(), seg: new Map(), result: new Map() },
      baseurl,
      site,
    );

  test("a link the offline tree holds is page-relative, as without a website", () => {
    const r = rewrite('<a href="/a/b/Other">x</a><a href="b/inner.txt">y</a>');
    assert.equal(r.rewritten, '<a href="b/Other.html">x</a><a href="b/inner.txt">y</a>');
    assert.equal(r.misses, 0);
  });

  test("a link only the online tree holds is the website's URL, and is no miss", () => {
    const r = rewrite('<a href="downloads/File.zip" download>x</a><a href="/a/downloads/File.zip?v=1#top">y</a>');
    assert.equal(
      r.rewritten,
      '<a href="https://site.example/a/downloads/File.zip" download>x</a>' +
        '<a href="https://site.example/a/downloads/File.zip?v=1#top">y</a>',
    );
    assert.equal(r.misses, 0);
  });

  test("the website's URL carries the base path, and encodes what a path must", () => {
    const r = rewrite('<a href="/base/a/downloads/File.zip">x</a><a href="Space Name.zip">y</a>', "/base");
    assert.equal(
      r.rewritten,
      '<a href="https://site.example/base/a/downloads/File.zip">x</a>' +
        '<a href="https://site.example/base/a/Space%20Name.zip">y</a>',
    );
    assert.equal(r.misses, 0);
  });

  test("a link in neither tree is a miss and is left as written", () => {
    const r = rewrite('<a href="/a/none/File.zip">x</a><a href="missing.zip">y</a>');
    assert.equal(r.rewritten, '<a href="/a/none/File.zip">x</a><a href="missing.zip">y</a>');
    assert.equal(r.misses, 2);
    assert.deepEqual(r.missed, ["/a/none/File.zip", "missing.zip"]);
  });

  test("with no website to point at, a link only the online tree holds is a miss", () => {
    const r = rewrite('<a href="downloads/File.zip">x</a>', "", websiteOf({}, online));
    assert.equal(r.misses, 1);
    assert.equal(r.rewritten, '<a href="downloads/File.zip">x</a>');
  });

  test("a link inside a code sample is left alone", () => {
    const html = '<code>href="downloads/File.zip"</code>';
    assert.equal(rewrite(html).rewritten, html);
  });

  test("only a website link to a file the offline tree lacks is expected there", () => {
    const state = { sitePaths: offline, website, baseurl: "" };
    assert.equal(isWebsiteOnlyLink("https://site.example/a/downloads/File.zip", state), true);
    assert.equal(isWebsiteOnlyLink("https://site.example/a/Page", state), false, "the offline tree holds the page");
    assert.equal(isWebsiteOnlyLink("https://site.example/a/none/File.zip", state), false, "neither tree holds it");
    assert.equal(isWebsiteOnlyLink("https://other.example/a/downloads/File.zip", state), false);
  });
});

// A picture in two themes: the page names X.png, and the build writes the light picture and
// the dark one when X.light.png is among the static files, the book the light one alone.
describe("themePairPlugin and lightOnly", () => {
  const paired = createMarkdownIt({
    highlighter: null,
    linkTables: { byPath: new Map(), byUrl: new Map(), byRedirect: new Map() },
    baseurl: "",
    staticFiles: new Set([
      "IDE/Images/A.png",
      "IDE/Images/A.light.png",
      "IDE/Images/B.png",
      "IDE/Images/S p.png",
      "IDE/Images/S p.light.png",
    ]),
  });
  const render = (src) => paired.render(src, { page: { srcRel: "IDE/Page.md" } }).trim();
  const pair = (src, alt, attrs) =>
    `<img src="/IDE/Images/${src}.light.png" alt="${alt}"${attrs} class="pic-light" loading="lazy" />` +
    `<img src="/IDE/Images/${src}.png" alt="${alt}"${attrs} class="pic-dark" loading="lazy" />`;

  test("a picture with a light sibling is two lazy images, light first, with one alt and size", () => {
    assert.equal(
      render('![The *File* menu](Images/A.png){:width="10" height="5"}'),
      `<p>${pair("A", "The File menu", ' width="10" height="5"')}</p>`,
    );
  });

  test("a picture with no light sibling is one image, as written", () => {
    assert.equal(
      render('![x](Images/B.png){:width="10" height="5"}'),
      '<p><img src="/IDE/Images/B.png" alt="x" width="10" height="5" /></p>',
    );
  });

  test("a picture in a heading, and one whose name is URL-encoded, are paired the same way", () => {
    assert.equal(render("## Folder ![i](Images/A.png)"), `<h2 id="folder-">Folder ${pair("A", "i", "")}</h2>`);
    assert.equal(
      render("![s](Images/S%20p.png)"),
      `<p><img src="/IDE/Images/S%20p.light.png" alt="s" class="pic-light" loading="lazy" />` +
        '<img src="/IDE/Images/S%20p.png" alt="s" class="pic-dark" loading="lazy" /></p>',
    );
  });

  test("the attributes the page gives are copied to both, a class of its own kept beside the theme's", () => {
    assert.equal(
      render('![x](Images/A.png){: .wide width="10" title="t"}'),
      '<p><img src="/IDE/Images/A.light.png" alt="x" class="wide pic-light" width="10" title="t" loading="lazy" />' +
        '<img src="/IDE/Images/A.png" alt="x" class="wide pic-dark" width="10" title="t" loading="lazy" /></p>',
    );
  });

  test("a light picture of another size is shown at the page's scale of its own size", () => {
    const sized = createMarkdownIt({
      highlighter: null,
      linkTables: { byPath: new Map(), byUrl: new Map(), byRedirect: new Map() },
      baseurl: "",
      staticFiles: new Set(["IDE/Images/A.png", "IDE/Images/A.light.png"]),
      pictureSizes: { "IDE/Images/A.light.png": [2432, 62, 2456, 70] },
    });
    assert.equal(
      sized.render('![t](Images/A.png){:width="1228" height="35"}', { page: { srcRel: "IDE/Page.md" } }).trim(),
      '<p><img src="/IDE/Images/A.light.png" alt="t" width="1216" height="31" class="pic-light" loading="lazy" />' +
        '<img src="/IDE/Images/A.png" alt="t" width="1228" height="35" class="pic-dark" loading="lazy" /></p>',
    );
  });

  test("a link to a paired picture is two links, each opening its theme's picture", () => {
    assert.equal(
      render("[Full size](Images/A.png)"),
      '<p><a href="/IDE/Images/A.light.png" class="pic-light">Full size</a>' +
        '<a href="/IDE/Images/A.png" class="pic-dark">Full size</a></p>',
    );
  });

  test("the book keeps the light picture alone, as a plain image, and the light link", () => {
    assert.equal(
      lightOnly(render('![x](Images/A.png){:width="10" height="5"} and [Full size](Images/A.png)')),
      '<p><img src="/IDE/Images/A.light.png" alt="x" width="10" height="5" /> and ' +
        '<a href="/IDE/Images/A.light.png">Full size</a></p>',
    );
    assert.equal(
      lightOnly(render("![x](Images/A.png){: .wide}")),
      '<p><img src="/IDE/Images/A.light.png" alt="x" class="wide" /></p>',
    );
    const unpaired = render("![x](Images/B.png)");
    assert.equal(lightOnly(unpaired), unpaired);
  });

  test("the book leaves code that shows the markup as written", () => {
    const html = '<p><code>&lt;img class="pic-dark" src="A.png" /&gt;</code></p><pre><a class="pic-dark">x</a></pre>';
    assert.equal(lightOnly(html), html);
  });

  test("a page that names a light picture itself is refused, in markdown or raw HTML", () => {
    for (const src of [
      "![x](Images/A.light.png)",
      "[x](Images/A.light.png)",
      "[x](/IDE/Images/A.light.png#top)",
      '<img src="Images/A.light.png">',
      'Text <a href="Images/A.light.png">x</a>.',
    ]) {
      assert.throws(() => render(src), /IDE\/Page\.md: .* names a light picture directly/, src);
    }
  });

  test("a light picture named in code is not a link, and is not refused", () => {
    assert.match(render("`![x](Images/A.light.png)`"), /<code[^>]*>!\[x\]\(Images\/A\.light\.png\)<\/code>/);
  });

  test("the two pictures' sizes are read from their headers", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "theme-pictures-"));
    try {
      const png = (w, h) => encodePng({ width: w, height: h, rgba: new Uint8Array(w * h * 4) });
      writeFileSync(path.join(dir, "A.png"), png(6, 4));
      writeFileSync(path.join(dir, "A.light.png"), png(5, 3));
      writeFileSync(path.join(dir, "B.light.png"), png(1, 1));
      const files = ["A.png", "A.light.png", "B.light.png"].map((f) => ({
        srcRel: `x/${f}`,
        srcPath: path.join(dir, f),
      }));
      assert.deepEqual({ ...(await pairSizes(files)) }, { "x/A.light.png": [5, 3, 6, 4] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a light picture with no dark picture beside it is found", () => {
    assert.deepEqual(unpairedLightPictures(["a/X.png", "a/X.light.png", "b/Y.light.png", "a/Z.light.png"]), [
      "a/Z.light.png",
      "b/Y.light.png",
    ]);
  });
});
