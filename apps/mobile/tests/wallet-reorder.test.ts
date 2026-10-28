import assert from "node:assert/strict";
import test from "node:test";
import { reorderIndex, reorderScrollSpeed } from "../src/lib/wallet-reorder";

test("a card can cross several slots, while boundary tremor does not undo the move", () => {
  const stride = 88;
  let slot = reorderIndex(60, 0, 6, stride);
  assert.equal(slot, 1);
  for (const y of [48, 42, 46, 40, 44, 49]) {
    slot = reorderIndex(y, slot, 6, stride);
    assert.equal(slot, 1);
  }
  assert.equal(reorderIndex(30, slot, 6, stride), 0);
  assert.equal(reorderIndex(390, 0, 6, stride), 4);
  assert.equal(reorderIndex(-100, 4, 6, stride), 0);
  assert.equal(reorderIndex(2000, 0, 6, stride), 5);
});

test("edge scrolling ramps from rest and stays bounded beyond either screen edge", () => {
  assert.equal(reorderScrollSpeed(400, 100, 800), 0);
  assert.equal(reorderScrollSpeed(170, 100, 800), 0);
  assert.equal(reorderScrollSpeed(730, 100, 800), 0);
  assert.equal(reorderScrollSpeed(135, 100, 800), -120);
  assert.equal(reorderScrollSpeed(765, 100, 800), 120);
  assert.equal(reorderScrollSpeed(-100, 100, 800), -480);
  assert.equal(reorderScrollSpeed(1000, 100, 800), 480);
});
