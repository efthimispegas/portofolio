import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import {
  ActivityIndicator,
  Appearance as NativeAppearance,
  Pressable,
  Text,
  View,
} from "react-native";
import * as SQLite from "expo-sqlite";
import { providerCardSchema, type ProviderCard } from "@mastoli/core";
import { Language, messages, MessageKey } from "./i18n";
import { validOrder, walletMigration } from "./wallet-model";

export type Appearance = "system" | "light" | "dark";
export interface SavedCard {
  card: ProviderCard;
  note: string;
  favorite: boolean;
  savedAt: string;
  refreshedAt: string;
  order: number;
  lastOpenedAt: string | null;
}
type Row = {
  payload: string;
  note: string;
  favorite: number;
  saved_at: string;
  refreshed_at: string;
  sort_order: number;
  last_opened_at: string | null;
};
type Wallet = {
  cards: SavedCard[];
  language: Language;
  appearance: Appearance;
  t: (key: MessageKey) => string;
  save: (card: ProviderCard) => Promise<void>;
  remove: (id: string) => Promise<void>;
  note: (id: string, note: string) => Promise<void>;
  favorite: (id: string, value: boolean) => Promise<void>;
  refresh: (card: ProviderCard) => Promise<void>;
  clear: () => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  markOpened: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  setLanguage: (value: Language) => Promise<void>;
  setAppearance: (value: Appearance) => Promise<void>;
};
const Context = createContext<Wallet | null>(null);
export function WalletProvider({ children }: { children: React.ReactNode }) {
  const db = useRef<SQLite.SQLiteDatabase | null>(null);
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [language, setLang] = useState<Language>("el");
  const [appearance, setMode] = useState<Appearance>("system");
  useEffect(() => {
    NativeAppearance.setColorScheme(
      appearance === "system" ? "unspecified" : appearance,
    );
  }, [appearance]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const readVersion = useRef(0);
  const read = useCallback(async () => {
    const version = ++readVersion.current;
    const rows = await db.current!.getAllAsync<Row>(
      "SELECT payload,note,favorite,saved_at,refreshed_at,sort_order,last_opened_at FROM cards ORDER BY sort_order ASC,saved_at DESC,rowid DESC",
    );
    if (version !== readVersion.current) return;
    setCards(
      rows.map((row) => ({
        card: providerCardSchema.parse(JSON.parse(row.payload)),
        note: row.note,
        favorite: row.favorite === 1,
        savedAt: row.saved_at,
        refreshedAt: row.refreshed_at,
        order: row.sort_order,
        lastOpenedAt: row.last_opened_at,
      })),
    );
  }, []);
  const init = useCallback(async () => {
    setError(false);
    try {
      db.current ??= await SQLite.openDatabaseAsync("portofolio-wallet.db");
      await db.current.execAsync(
        "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0, saved_at TEXT NOT NULL, refreshed_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);",
      );
      await db.current.withExclusiveTransactionAsync(async (transaction) => {
        const columns = await transaction.getAllAsync<{ name: string }>(
          "PRAGMA table_info(cards)",
        );
        for (const statement of walletMigration(
          columns.map((column) => column.name),
        ))
          await transaction.execAsync(statement);
      });
      const prefs = await db.current.getAllAsync<{
        key: string;
        value: string;
      }>("SELECT key,value FROM preferences");
      for (const p of prefs) {
        if (p.key === "language" && (p.value === "el" || p.value === "en"))
          setLang(p.value);
        if (
          p.key === "appearance" &&
          ["system", "light", "dark"].includes(p.value)
        )
          setMode(p.value as Appearance);
      }
      await read();
      setReady(true);
    } catch {
      setError(true);
    }
  }, [read]);
  useEffect(() => {
    void init();
  }, [init]);
  const change = async (sql: string, ...args: SQLite.SQLiteBindValue[]) => {
    await db.current!.runAsync(sql, ...args);
    await read();
  };
  const preference = async (key: string, value: string) => {
    await db.current!.runAsync(
      "INSERT INTO preferences(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      key,
      value,
    );
  };
  if (!ready)
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 28,
          backgroundColor: "#F6F6F3",
        }}
      >
        {error ? (
          <>
            <Text
              style={{ fontSize: 17, textAlign: "center", color: "#192B3C" }}
            >
              {messages[language].storageError}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void init()}
              style={{ padding: 20 }}
            >
              <Text style={{ fontSize: 17, color: "#185AC6" }}>
                {messages[language].retry}
              </Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator size="large" />
        )}
      </View>
    );
  return (
    <Context.Provider
      value={{
        cards,
        language,
        appearance,
        t: (key) => messages[language][key],
        save: async (card) => {
          providerCardSchema.parse(card);
          const now = new Date().toISOString();
          await change(
            "INSERT INTO cards(id,payload,saved_at,refreshed_at,sort_order) VALUES(?,?,?,?,(SELECT COALESCE(MIN(sort_order),1)-1 FROM cards)) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,refreshed_at=excluded.refreshed_at",
            card.id,
            JSON.stringify(card),
            now,
            now,
          );
        },
        refresh: async (card) => {
          providerCardSchema.parse(card);
          await change(
            "UPDATE cards SET payload=?,refreshed_at=? WHERE id=?",
            JSON.stringify(card),
            new Date().toISOString(),
            card.id,
          );
        },
        remove: async (id) => change("DELETE FROM cards WHERE id=?", id),
        note: async (id, note) =>
          change("UPDATE cards SET note=? WHERE id=?", note.slice(0, 4000), id),
        favorite: async (id, value) =>
          change("UPDATE cards SET favorite=? WHERE id=?", value ? 1 : 0, id),
        clear: async () => change("DELETE FROM cards"),
        markOpened: async (id) =>
          change(
            "UPDATE cards SET last_opened_at=? WHERE id=?",
            new Date().toISOString(),
            id,
          ),
        clearHistory: async () =>
          change("UPDATE cards SET last_opened_at=NULL"),
        reorder: async (ids) => {
          await db.current!.withExclusiveTransactionAsync(
            async (transaction) => {
              const current = await transaction.getAllAsync<{ id: string }>(
                "SELECT id FROM cards",
              );
              if (
                !validOrder(
                  current.map((row) => row.id),
                  ids,
                )
              )
                throw new Error("Wallet changed during reorder");
              for (const [index, id] of ids.entries())
                await transaction.runAsync(
                  "UPDATE cards SET sort_order=? WHERE id=?",
                  index,
                  id,
                );
            },
          );
          await read();
        },
        setLanguage: async (value) => {
          await preference("language", value);
          setLang(value);
        },
        setAppearance: async (value) => {
          await preference("appearance", value);
          setMode(value);
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWallet() {
  const context = useContext(Context);
  if (!context) throw new Error("WalletProvider missing");
  return context;
}
