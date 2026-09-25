import assert from "node:assert/strict";
import test from "node:test";
import { squarify } from "./squarify.ts";

test("squarify fills the bounds with the input weights", () => {
  const bounds = { x: 0, y: 0, w: 200, h: 100 };
  const rects = squarify([75, 25, 0], bounds);
  assert.equal(rects[2].w, 0);
  const area = rects.reduce((sum, rect) => sum + rect.w * rect.h, 0);
  assert.ok(Math.abs(area - bounds.w * bounds.h) < 1);
  assert.ok(rects[0].w * rects[0].h > rects[1].w * rects[1].h);
});

test("squarify gives a single child the full rectangle", () => {
  const rects = squarify([10], { x: 4, y: 6, w: 80, h: 40 });
  assert.equal(rects[0].x, 4);
  assert.equal(rects[0].y, 6);
  assert.ok(Math.abs(rects[0].w - 80) < 0.001);
  assert.ok(Math.abs(rects[0].h - 40) < 0.001);
});
