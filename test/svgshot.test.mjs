// Tests for scripts/svgshot/snapshot-svg.mjs that need no browser: oneLine, which keeps a
// picture's SVG on one line, so that a CRLF checkout changes only its last line ending. What
// a picture's SVG keeps of an image it embeds is compactImage's, in
// scripts/lib/compact-image.mjs, and test/compact-image.test.mjs tests it.
//
// Runs with a bare `node --test test/svgshot.test.mjs`: no tree, no build.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { oneLine } from "../scripts/svgshot/snapshot-svg.mjs";

describe("oneLine", () => {
  test("puts a break in a tag as a space and one in text as a character reference", () => {
    assert.equal(
      oneLine('<svg>\n<image href="data:image/svg+xml,<svg\nwidth=1>"/>\r\n<text>a\nb</text></svg>\n'),
      '<svg>&#10;<image href="data:image/svg+xml,<svg width=1>"/>&#10;<text>a&#10;b</text></svg>\n',
    );
  });
});
