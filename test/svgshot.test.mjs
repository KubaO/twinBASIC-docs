// Tests for scripts/svgshot/snapshot-svg.mjs that need no browser: oneLine, which keeps a
// picture's SVG on one line, so that a CRLF checkout changes only its last line ending, and
// underlineBand and decoratingBoxes, which place an underline as Chromium does: the figures
// below are the ones scripts/svgshot/bench/decoration.html was fitted to in Edge. What a
// picture's SVG keeps of an image it embeds is compactImage's, in
// scripts/lib/compact-image.mjs, and test/compact-image.test.mjs tests it.
//
// Runs with a bare `node --test test/svgshot.test.mjs`: no tree, no build.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decoratingBoxes, oneLine, underlineBand } from "../scripts/svgshot/snapshot-svg.mjs";

describe("oneLine", () => {
  test("puts a break in a tag as a space and one in text as a character reference", () => {
    assert.equal(
      oneLine('<svg>\n<image href="data:image/svg+xml,<svg\nwidth=1>"/>\r\n<text>a\nb</text></svg>\n'),
      '<svg>&#10;<image href="data:image/svg+xml,<svg width=1>"/>&#10;<text>a&#10;b</text></svg>\n',
    );
  });
});

describe("underlineBand", () => {
  const band = (size, more = {}) => {
    const { offset, thickness } = underlineBand({ "font-size": `${size}px`, ...more });
    return [offset, thickness];
  };

  test("an auto thickness is a tenth of the font size cut down, at least 1", () => {
    assert.deepEqual(
      [8, 19, 20, 29, 30, 40, 64].map((s) => band(s)[1]),
      [1, 1, 2, 2, 3, 4, 6],
    );
  });

  test("an auto offset is half the unrounded thickness rounded up, at least 1", () => {
    assert.deepEqual(
      [13, 20, 21, 40, 44].map((s) => band(s)[0]),
      [1, 1, 2, 2, 3],
    );
  });

  test("a given thickness is rounded, and a percentage is of the font size", () => {
    assert.equal(band(13, { "text-decoration-thickness": "1.5px" })[1], 2);
    assert.equal(band(13, { "text-decoration-thickness": "2.5px" })[1], 3);
    assert.equal(band(13, { "text-decoration-thickness": "20%" })[1], 3);
  });

  test("a given offset is rounded and adds no gap: the IDE's tip, 13px with 2px", () => {
    assert.deepEqual(band(13, { "text-underline-offset": "2px" }), [2, 1]);
    assert.equal(band(13, { "text-underline-offset": "0px" })[0], 0);
  });
});

describe("decoratingBoxes", () => {
  const chain = (...styles) => {
    let node = null;
    for (const style of styles) node = { style, parent: node };
    return node;
  };
  const u = { "text-decoration-line": "underline" };

  test("collects every decorating ancestor, nearest first, through blocks", () => {
    const outer = { ...u, display: "block", color: "red" };
    const inner = { ...u, display: "inline", color: "blue" };
    assert.deepEqual(decoratingBoxes(chain(outer, { display: "block" }, inner)), [inner, outer]);
  });

  test("stops at an atomic inline box, a float or a positioned box, whose own line counts", () => {
    for (const stop of [{ display: "inline-block" }, { float: "left" }, { position: "absolute" }]) {
      const own = { ...u, display: "inline", ...stop };
      assert.deepEqual(decoratingBoxes(chain({ ...u, display: "block" }, own)), [own]);
    }
  });
});
