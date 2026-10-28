import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { demoCards } from "@mastoli/core";
import { cardColors } from "../src/lib/card-colors";
import {
  emptyFilters,
  searchCards,
  recentCards,
  moveCard,
  validOrder,
  walletMigration,
} from "../src/lib/wallet-model";
const cards = demoCards.map((card, index) => ({
  card,
  note: index === 0 ? "Σύσταση Μαρία" : "",
  favorite: index === 0,
  savedAt: "2026-10-25",
  refreshedAt: "2026-10-25",
  order: index,
  lastOpenedAt: index === 0 ? "2026-10-26T10:00:00Z" : null,
}));
test("category, professional and accent-insensitive text all constrain results", () => {
  assert.equal(
    searchCards(
      cards,
      {
        ...emptyFilters,
        category: "plumber",
        professional: "demo-nikos",
        query: "νικοσ μαρια",
      },
      "el",
    ).length,
    1,
  );
  assert.equal(
    searchCards(
      cards,
      {
        ...emptyFilters,
        category: "cleaning",
        professional: "demo-nikos",
        query: "",
      },
      "el",
    ).length,
    0,
  );
  assert.equal(
    searchCards(cards, { ...emptyFilters, query: "PLUMBER" }, "el")[0].card.id,
    "demo-nikos",
  );
  assert.equal(
    searchCards(cards, { ...emptyFilters, favorites: true }, "en").length,
    1,
  );
});
test("history uses opens and filtering never mutates saved order", () => {
  const before = cards.map((x) => x.card.id);
  assert.deepEqual(
    recentCards(cards).map((x) => x.card.id),
    ["demo-nikos"],
  );
  assert.deepEqual(
    cards.map((x) => x.card.id),
    before,
  );
  assert.deepEqual(moveCard(before, "demo-nikos", 2), [
    before[1],
    before[2],
    before[0],
  ]);
  assert.equal(validOrder(before, [before[0], before[0], before[2]]), false);
  assert.equal(validOrder(before, before.slice(1)), false);
});
test("SQLite migration preserves legacy order, notes, favorites and payloads; rerun is inert", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE cards(id TEXT PRIMARY KEY,payload TEXT,note TEXT,favorite INTEGER,saved_at TEXT,refreshed_at TEXT); INSERT INTO cards VALUES('old','{}','keep me',1,'2026-10-24','2026-10-26'),('new','{}','another',0,'2026-10-25','2026-10-26'),('tie','{}','last insert',0,'2026-10-25','2026-10-26')",
  );
  const columns = () =>
    db
      .prepare("PRAGMA table_info(cards)")
      .all()
      .map((row) => String(row.name));
  for (const sql of walletMigration(columns())) db.exec(sql);
  assert.deepEqual(
    db
      .prepare("SELECT id FROM cards ORDER BY sort_order")
      .all()
      .map((row) => row.id),
    ["tie", "new", "old"],
  );
  assert.equal(
    db.prepare("SELECT note FROM cards WHERE id='old'").get()!.note,
    "keep me",
  );
  assert.equal(
    db.prepare("SELECT favorite FROM cards WHERE id='old'").get()!.favorite,
    1,
  );
  assert.deepEqual(walletMigration(columns()), []);
  db.exec(
    "UPDATE cards SET last_opened_at='2026-10-26' WHERE id='old'; UPDATE cards SET last_opened_at=NULL",
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cards").get()!.n, 3);
  db.close();
});

test("professional accents keep card and filter text at 4.5:1 contrast", () => {
  const luminance = (hex: string) =>
    [1, 3, 5]
      .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  for (let r = 0; r < 256; r += 17)
    for (let g = 0; g < 256; g += 17)
      for (let b = 0; b < 256; b += 17) {
        const accent = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
        const { background, ink } = cardColors(accent);
        const values = [luminance(background), luminance(ink)].sort(
          (a, b) => a - b,
        );
        assert.ok((values[1] + 0.05) / (values[0] + 0.05) >= 4.5, accent);
      }
  assert.equal(cardColors("invalid").background, "#DFE7F5");
});
