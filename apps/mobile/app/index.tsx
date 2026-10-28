import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, View } from "react-native";
import { Stack } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import type { SearchBarCommands } from "react-native-screens";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { BRAND } from "@mastoli/core";
import { useWallet } from "../src/lib/wallet-context";
import { useTheme } from "../src/lib/theme";
import { useWalletMotion } from "../src/lib/wallet-motion";
import { emptyFilters, type WalletFilters } from "../src/lib/wallet-model";
import {
  NativeWalletStack,
  type StackHandle,
} from "../src/components/native-wallet-stack";
import { NativeWalletDetails } from "../src/components/native-wallet-details";
import { NativeWalletControls } from "../src/components/native-wallet-controls";
import { WalletSearch } from "../src/components/wallet-search";

export default function WalletScreen() {
  const w = useWallet(), c = useTheme(), motion = useWalletMotion();
  const focused = useIsFocused();
  const search = useRef<SearchBarCommands | null>(null),
    stack = useRef<StackHandle | null>(null),
    handoff = useRef(false),
    searchActive = useRef(false),
    hadSession = useRef(false);
  const [searching, setSearching] = useState(false),
    [resetSearch, setResetSearch] = useState(0),
    [filters, setFilters] = useState<WalletFilters>({ ...emptyFilters });
  const searchReveal = useSharedValue(0);
  const handingOff = useSharedValue(false);
  const { artworkReady, reduceMotion } = motion;
  // Restore the existing native controls at the START of return, not after it.
  const detailControls = !!motion.session && motion.phase !== "closing";
  const clearSearchState = useCallback(() => {
    handoff.current = false;
    searchActive.current = false;
    setFilters({ ...emptyFilters });
    setResetSearch((value) => value + 1);
  }, []);
  const dismissSearchKeyboard = useCallback(() => {
    search.current?.blur();
    Keyboard.dismiss();
  }, []);
  const exitSearch = useCallback(() => {
    if (handoff.current) return;
    Keyboard.dismiss();
    searchActive.current = false;
    setSearching(false);
    searchReveal.value = withTiming(0, { duration: 160 }, (finished) => {
      if (finished) runOnJS(clearSearchState)();
    });
  }, [clearSearchState]);
  const result = (id: string) => {
    if (handoff.current || motion.session) return;
    handoff.current = true;
    searchActive.current = false;
    handingOff.value = true;
    setSearching(false);
    dismissSearchKeyboard();
    // Keep the prelaid-out search surface until the shared card is ready.
    // The stack and details are in this same scene: no native route push/pop.
    stack.current?.open(id);
  };
  const beginSearch = useCallback((duration = 160) => {
    if (!focused || motion.session || handoff.current || searchActive.current) return;
    searchActive.current = true;
    setSearching(true);
    searchReveal.value = withTiming(1, { duration });
  }, [focused, motion.session]);
  useEffect(() => {
    // Prepare alongside UIKit's keyboard transition instead of waiting for the
    // later text-field focus callback; hardware keyboards still use onFocus.
    const listener = Keyboard.addListener("keyboardWillShow", (event) => beginSearch(event.duration));
    return () => listener.remove();
  }, [beginSearch]);
  useEffect(() => {
    if (hadSession.current && !motion.session && handoff.current) {
      handingOff.value = false;
      searchReveal.value = 0;
      clearSearchState();
    }
    hadSession.current = !!motion.session;
  }, [motion.session, clearSearchState]);
  useAnimatedReaction(
    () => handingOff.value && artworkReady.value,
    (ready) => {
      if (!ready) return;
      handingOff.value = false;
      searchReveal.value = withTiming(0, { duration: 160 }, (finished) => {
        if (finished) runOnJS(clearSearchState)();
      });
    },
  );
  const searchStyle = useAnimatedStyle(() => ({
    opacity: searchReveal.value,
    transform: [{ translateY: reduceMotion ? 0 : (1 - searchReveal.value) * 8 }],
  }));
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          headerStyle: { backgroundColor: "transparent" },
          headerShadowVisible: false,
          headerLargeTitleShadowVisible: false,
          headerTitleStyle: { color: c.text },
          headerLargeTitleStyle: { color: c.text },
        }}
      />
      <Stack.Title large={!detailControls} style={{ color: c.text }} largeStyle={{ color: c.text }}>
        {detailControls ? "" : BRAND}
      </Stack.Title>
      <NativeWalletControls detail={detailControls} />
      {!detailControls ? <Stack.SearchBar
        ref={search}
        placement="integratedButton"
        allowToolbarIntegration
        hideNavigationBar
        hideWhenScrolling={false}
        obscureBackground={false}
        placeholder={w.language === "el" ? "Αναζήτηση στο Portofolio" : "Search in Portofolio"}
        tintColor={c.tint}
        textColor={c.text}
        onFocus={() => {
          if (motion.session || handoff.current) {
            search.current?.blur();
            return;
          }
          beginSearch();
        }}
        onChangeText={(event) => {
          if (!handoff.current) setFilters((previous) => ({
            ...previous, query: event.nativeEvent.text,
          }));
        }}
        onCancelButtonPress={exitSearch}
      /> : null}
      <Stack.Toolbar placement="bottom">
        <Stack.Toolbar.Spacer />
        <Stack.Toolbar.SearchBarSlot separateBackground />
      </Stack.Toolbar>
      <NativeWalletStack handle={stack} hidden={searching || handoff.current} />
      <NativeWalletDetails />
      <Animated.View
        pointerEvents={searching ? "auto" : "none"}
        accessibilityElementsHidden={!searching}
        importantForAccessibility={searching ? "auto" : "no-hide-descendants"}
        style={[{ position: "absolute", inset: 0, backgroundColor: c.bg }, searchStyle]}
      >
        <WalletSearch
          reset={resetSearch}
          filters={filters}
          onChange={setFilters}
          onOpen={result}
          onDismissKeyboard={dismissSearchKeyboard}
        />
      </Animated.View>
    </View>
  );
}
