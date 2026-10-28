import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { categoryLabels, type Category } from "@mastoli/core";
import type { SFSymbol } from "sf-symbols-typescript";
import { useWallet, type SavedCard } from "../lib/wallet-context";
import { useTheme } from "../lib/theme";
import {
  emptyFilters,
  recentCards,
  searchCards,
  type WalletFilters,
} from "../lib/wallet-model";
import {
  FilterTile,
  FilterToken,
  NativeButton,
  NativeRow,
} from "./native-controls";

const categoryPresentation: Record<
  Category,
  { icon: SFSymbol; color: string }
> = {
  electrician: { icon: "bolt.fill", color: "#D08A00" },
  plumber: { icon: "drop.fill", color: "#247ACE" },
  cooling: { icon: "snowflake", color: "#247ACE" },
  cleaning: { icon: "sparkles", color: "#B64B89" },
  gardening: { icon: "leaf.fill", color: "#287D58" },
  care: { icon: "heart.fill", color: "#D24252" },
  teaching: { icon: "book.fill", color: "#7055B6" },
  beauty: { icon: "scissors", color: "#B64B89" },
  professional: { icon: "briefcase.fill", color: "#856548" },
};
export function WalletSearch({
  reset,
  filters,
  onChange,
  onOpen,
  onDismissKeyboard,
}: {
  reset: number;
  filters: WalletFilters;
  onChange: (filters: WalletFilters) => void;
  onOpen: (id: string) => void;
  onDismissKeyboard: () => void;
}) {
  const inset = useSafeAreaInsets();
  const scroll = useRef<import("react-native").ScrollViewInstance>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: true });
  }, [
    filters.category,
    filters.professional,
    filters.favorites,
    filters.query,
  ]);
  const w = useWallet(),
    c = useTheme(),
    el = w.language === "el";
  const [allRecent, setAllRecent] = useState(false);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    setAllRecent(false);
    setShowAll(false);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [reset]);
  const recent = useMemo(() => recentCards(w.cards), [w.cards]);
  const results = useMemo(
    () => searchCards(w.cards, filters, w.language),
    [w.cards, filters, w.language],
  );
  const categories = useMemo(
    () => [...new Set(w.cards.map((x) => x.card.category))],
    [w.cards],
  );
  const filtering =
    showAll ||
    !!(
      filters.query.trim() ||
      filters.category ||
      filters.professional ||
      filters.favorites
    );
  const title = (text: string, action?: ReactNode) => (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginTop: 26,
        marginBottom: 14,
        paddingHorizontal: 16,
      }}
    >
      <Text
        accessibilityRole="header"
        dynamicTypeRamp="title2"
        style={{ fontSize: 25, fontWeight: "700", color: c.text, flex: 1 }}
      >
        {text}
      </Text>
      {action}
    </View>
  );
  const rows = (items: SavedCard[]) =>
    items.length ? (
      <View
        style={{
          backgroundColor: c.surface,
          borderRadius: 24,
          overflow: "hidden",
          marginHorizontal: 16,
        }}
      >
        {items.map((item, index) => (
          <NativeRow
            key={item.card.id}
            title={item.card.displayName}
            subtitle={`${categoryLabels[item.card.category][w.language]} · ${item.card.area}`}
            onPress={() => onOpen(item.card.id)}
            last={index === items.length - 1}
          />
        ))}
      </View>
    ) : (
      <Text style={{ color: c.secondary, fontSize: 17, marginHorizontal: 32 }}>
        {filtering
          ? w.t("noResults")
          : el
            ? "Δεν έχεις ανοίξει κάρτες ακόμη."
            : "No recently opened cards."}
      </Text>
    );
  const clear = () =>
    Alert.alert(
      el ? "Εκκαθάριση ιστορικού;" : "Clear history?",
      el
        ? "Οι κάρτες, τα αγαπημένα και οι σημειώσεις σου παραμένουν."
        : "Your cards, favorites and notes are kept.",
      [
        { text: w.t("cancel"), style: "cancel" },
        {
          text: el ? "Εκκαθάριση" : "Clear",
          style: "destructive",
          onPress: () =>
            void w
              .clearHistory()
              .catch(() => Alert.alert(w.t("error"), w.t("retry"))),
        },
      ],
    );
  return (
    <ScrollView
      ref={scroll}
      onTouchStart={onDismissKeyboard}
      onScrollBeginDrag={onDismissKeyboard}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ paddingTop: inset.top + 8, paddingBottom: 110 }}
    >
      {allRecent && !filtering ? (
        <>
          {title(
            el ? "Πρόσφατα" : "Recent",
            <View style={{ width: 100 }}>
              <NativeButton
                label={w.t("back")}
                muted
                onPress={() => setAllRecent(false)}
              />
            </View>,
          )}
          {rows(recent)}
          {recent.length ? (
            <View style={{ margin: 16 }}>
              <NativeButton
                label={el ? "Εκκαθάριση ιστορικού" : "Clear history"}
                icon="clock.arrow.circlepath"
                muted
                onPress={clear}
              />
            </View>
          ) : null}
        </>
      ) : (
        <>
          {!filtering ? (
            <>
              {title(el ? "Προτάσεις" : "Suggestions")}
              <View style={{ marginHorizontal: 16 }}>
                <NativeRow
                  title={w.t("all")}
                  icon="magnifyingglass"
                  chevron={false}
                  onPress={() => {
                    setShowAll(true);
                    onChange({ ...emptyFilters });
                  }}
                />
                <NativeRow
                  title={w.t("favorites")}
                  icon="star"
                  chevron={false}
                  onPress={() => onChange({ ...filters, favorites: true })}
                  last
                />
              </View>
              {title(
                el ? "Πρόσφατα" : "Recent",
                <View style={{ width: 110 }}>
                  <NativeButton
                    label={el ? "Όλα" : "See All"}
                    muted
                    onPress={() => setAllRecent(true)}
                  />
                </View>,
              )}
              {rows(recent.slice(0, 3))}
            </>
          ) : (
            <>
              {title(el ? "Αποτελέσματα" : "Results")}
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 8,
                  marginHorizontal: 16,
                  marginBottom: 14,
                }}
              >
                {filters.category ? (
                  <FilterToken
                    label={categoryLabels[filters.category][w.language]}
                    onPress={() => onChange({ ...filters, category: null })}
                  />
                ) : null}
                {filters.professional ? (
                  <FilterToken
                    label={
                      w.cards.find((x) => x.card.id === filters.professional)
                        ?.card.displayName ??
                      (el ? "Επαγγελματίας" : "Professional")
                    }
                    onPress={() => onChange({ ...filters, professional: null })}
                  />
                ) : null}
                {filters.favorites ? (
                  <FilterToken
                    label={w.t("favorites")}
                    onPress={() => onChange({ ...filters, favorites: false })}
                  />
                ) : null}
              </View>
              {rows(results)}
            </>
          )}
          {title(el ? "Κατηγορίες" : "Categories")}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingVertical: 7,
              gap: 10,
            }}
          >
            {categories.map((category) => (
              <FilterTile
                key={category}
                label={categoryLabels[category][w.language]}
                {...categoryPresentation[category]}
                selected={filters.category === category}
                onPress={() =>
                  onChange({
                    ...filters,
                    category: filters.category === category ? null : category,
                  })
                }
              />
            ))}
          </ScrollView>
          {title(el ? "Επαγγελματίες" : "Professionals")}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingVertical: 7,
              gap: 10,
            }}
          >
            {w.cards.map(({ card }) => (
              <FilterTile
                key={card.id}
                label={card.displayName}
                initials={card.initials}
                color={card.accent}
                selected={filters.professional === card.id}
                onPress={() =>
                  onChange({
                    ...filters,
                    professional:
                      filters.professional === card.id ? null : card.id,
                  })
                }
              />
            ))}
          </ScrollView>
        </>
      )}
    </ScrollView>
  );
}
