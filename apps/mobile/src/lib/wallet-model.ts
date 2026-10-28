import { categoryLabels, type Category, type Locale } from "@mastoli/core";
import type { SavedCard } from "./wallet-context";

export type WalletFilters = {
  query: string;
  category: Category | null;
  professional: string | null;
  favorites: boolean;
};
export const emptyFilters: WalletFilters = {
  query: "",
  category: null,
  professional: null,
  favorites: false,
};
export function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("el")
    .replace(/ς/g, "σ")
    .trim();
}
export function searchCards(
  cards: SavedCard[],
  filters: WalletFilters,
  language: Locale,
) {
  const words = normalizeSearch(filters.query).split(/\s+/).filter(Boolean);
  return cards.filter((item) => {
    if (filters.category && item.card.category !== filters.category)
      return false;
    if (filters.professional && item.card.id !== filters.professional)
      return false;
    if (filters.favorites && !item.favorite) return false;
    const haystack = normalizeSearch(
      [
        item.card.displayName,
        item.card.area,
        categoryLabels[item.card.category][language],
        categoryLabels[item.card.category].en,
        categoryLabels[item.card.category].el,
        item.note,
        ...item.card.services,
      ].join(" "),
    );
    return words.every((word) => haystack.includes(word));
  });
}
export function recentCards(cards: SavedCard[]) {
  return cards
    .filter((item) => item.lastOpenedAt)
    .sort((a, b) => b.lastOpenedAt!.localeCompare(a.lastOpenedAt!));
}
export function moveCard(ids: string[], id: string, to: number) {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const next = ids.filter((value) => value !== id);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, id);
  return next;
}
export function validOrder(current: string[], requested: string[]) {
  return (
    current.length === requested.length &&
    new Set(requested).size === requested.length &&
    requested.every((id) => current.includes(id))
  );
}
/** Preserve the legacy order and all customer data when adding local-only features. */
export function walletMigration(columns: string[]) {
  const statements: string[] = [];
  if (!columns.includes("sort_order"))
    statements.push(
      "ALTER TABLE cards ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
      "WITH ordered AS (SELECT id, ROW_NUMBER() OVER (ORDER BY saved_at DESC, rowid DESC)-1 AS position FROM cards) UPDATE cards SET sort_order=(SELECT position FROM ordered WHERE ordered.id=cards.id)",
    );
  if (!columns.includes("last_opened_at"))
    statements.push("ALTER TABLE cards ADD COLUMN last_opened_at TEXT");
  return statements;
}
