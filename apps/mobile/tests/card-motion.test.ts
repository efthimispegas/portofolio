import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reverseDuration,
  spatialCardMotion,
  validCardFrame,
} from "../src/lib/card-motion";
const frame = { x: 20, y: 340, width: 362, height: 105 };
test("spatial continuity requires a valid measured source and accessibility permission", () => {
  assert.equal(spatialCardMotion(frame, false, 1), true);
  assert.equal(spatialCardMotion(frame, true, 1), false);
  assert.equal(spatialCardMotion(frame, false, 1.4), false);
  for (const invalid of [
    { ...frame, width: 0 },
    { ...frame, height: -1 },
    { ...frame, x: NaN },
    { ...frame, y: Infinity },
  ]) {
    assert.equal(validCardFrame(invalid), false);
    assert.equal(spatialCardMotion(invalid, false, 1), false);
  }
  // A partially scrolled source can legitimately begin above the viewport.
  assert.equal(validCardFrame({ ...frame, y: -10 }), true);
});
test("interruptions reverse from current progress without a fresh full-duration exit", () => {
  assert.equal(reverseDuration(1, true), 260);
  assert.equal(reverseDuration(0.5, true), 130);
  assert.equal(reverseDuration(0, true), 60);
  assert.equal(reverseDuration(1, false), 140);
  assert.equal(reverseDuration(10, true), 260);
  assert.equal(reverseDuration(NaN, true), 60);
});

test("dismissal reverses only a fully visible hero inside the content viewport", async () => {
  const { canReverseCard } = await import("../src/lib/card-motion");
  const viewport = { x: 0, y: 110, width: 402, height: 720 };
  const visible = { x: 20, y: 122, width: 362, height: 220 };
  assert.equal(canReverseCard(visible, viewport, false), true);
  assert.equal(canReverseCard({ ...visible, y: 110 }, viewport, false), true);
  assert.equal(canReverseCard({ ...visible, y: 610 }, viewport, false), true);
  assert.equal(canReverseCard({ ...visible, y: 60 }, viewport, false), false);
  assert.equal(canReverseCard({ ...visible, y: 700 }, viewport, false), false);
  assert.equal(canReverseCard({ ...visible, y: -400 }, viewport, false), false);
  assert.equal(canReverseCard({ ...visible, x: 100 }, viewport, false), false);
  assert.equal(
    canReverseCard({ ...visible, height: 0 }, viewport, false),
    false,
  );
  assert.equal(canReverseCard(null, viewport, false), false);
  assert.equal(canReverseCard(visible, viewport, true), false);
  assert.equal(
    canReverseCard(visible, { ...viewport, height: NaN }, false),
    false,
  );
});
