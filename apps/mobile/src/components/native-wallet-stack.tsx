import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type ComponentRef,
} from "react";
import {
  AccessibilityInfo,
  Alert,
  AppState,
  findNodeHandle,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  cancelAnimation,
  runOnJS,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { useWallet, type SavedCard } from "../lib/wallet-context";
import { useWalletMotion } from "../lib/wallet-motion";
import {
  liftSpring,
  reorderIndex,
  reorderScrollSpeed,
  reorderSpring,
} from "../lib/wallet-reorder";
import { useTheme } from "../lib/theme";
import { NativeWalletFace } from "./native-wallet-face";
import { NativeButton } from "./native-controls";
import { router } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { cardColors } from "../lib/card-colors";
import { walletGeometry } from "../lib/wallet-geometry";

let entrancePlayed = false;
export type StackHandle = { open: (id: string) => void };
export function NativeWalletStack({
  handle,
  hidden,
}: {
  handle: RefObject<StackHandle | null>;
  hidden: boolean;
}) {
  const w = useWallet(),
    c = useTheme(),
    motion = useWalletMotion(),
    { width, height, fontScale } = useWindowDimensions();
  const geometry = walletGeometry(width);
  const measuredHeaderHeight = useHeaderHeight();
  const stackHeaderHeight = useRef(measuredHeaderHeight);
  // Search and card controls change the same native header. Keep stack geometry stable.
  if (!hidden && !motion.session) stackHeaderHeight.current = measuredHeaderHeight;
  const headerHeight = stackHeaderHeight.current;
  const scroll = useAnimatedRef<Animated.ScrollView>();
  const initialOrder = w.cards.map((x) => x.card.id);
  const order = useSharedValue(initialOrder),
    original = useSharedValue(initialOrder);
  const active = useSharedValue(""),
    liftY = useSharedValue(0),
    fingerY = useSharedValue(0),
    scrollY = useSharedValue(0),
    inset = useSharedValue(0),
    maxScroll = useSharedValue(0);
  const scrollAtLift = useSharedValue(0),
    startY = useSharedValue(0),
    pull = useSharedValue(0),
    entrance = useSharedValue(entrancePlayed ? 1 : 0);
  const viewportTop = useSharedValue(0),
    viewportBottom = useSharedValue(height);
  const [cardHeight, setCardHeight] = useState(geometry.stackHeight);
  const stride = fontScale > 1.25 ? cardHeight + 14 : 88;
  const refs = useRef(new Map<string, ComponentRef<typeof View>>());
  const pending = useRef<string | null>(null);
  const viewport = useRef<ComponentRef<typeof View>>(null);
  const native = Gesture.Native();
  useEffect(() => {
    if (!active.value) {
      order.value = w.cards.map((x) => x.card.id);
      original.value = order.value;
    }
  }, [w.cards]);
  useEffect(() => {
    if (!motion.preferencesReady) return;
    if (!entrancePlayed) {
      entrancePlayed = true;
      entrance.value = motion.reduceMotion
        ? withTiming(1, { duration: 150 })
        : withSpring(1, { damping: 22, stiffness: 150, mass: 1 });
    }
  }, [motion.reduceMotion, motion.preferencesReady]);
  const rollback = useCallback(() => {
    active.value = "";
    order.value = original.value;
    cancelAnimation(liftY);
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") rollback();
    });
    return () => sub.remove();
  }, [rollback]);
  const persist = useCallback(
    async (ids: string[]) => {
      try {
        await w.reorder(ids);
        original.value = ids;
      } catch {
        order.value = original.value;
        Alert.alert(w.t("error"), w.t("retry"));
      }
    },
    [w.reorder, w.t],
  );
  const select = useCallback(
    (id: string) => {
      const item = w.cards.find((x) => x.card.id === id),
        node = refs.current.get(id);
      if (!item || !node) return;
      node.measureInWindow((x, y, width, h) => {
        if (width <= 0 || h <= 0) return;
        motion.open({
          card: item.card,
          frame: { x, y, width, height: h },
          nextCardOffset:
            w.cards.findIndex((entry) => entry.card.id === id) < w.cards.length - 1
              ? stride
              : null,
          measureFrame: (done) => {
            const source = refs.current.get(id);
            if (!source) return done(null);
            source.measureInWindow((sx, sy, sw, sh) =>
              done(sw > 0 && sh > 0 ? { x: sx, y: sy, width: sw, height: sh } : null),
            );
          },
          restoreFocus: () => {
            void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
              if (!enabled) return;
              const tag = findNodeHandle(refs.current.get(id));
              if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
            });
          },
        });
      });
    },
    [w.cards, motion.open, stride],
  );
  const handoff = useCallback(
    (id: string) => {
      const index = w.cards.findIndex((x) => x.card.id === id);
      if (index < 0) return;
      pending.current = id;
      // Restore the retained scroll position unless the requested card is offscreen.
      refs.current.get(id)?.measureInWindow((_x, y, _width, h) => {
        if (
          y < viewportTop.value + headerHeight ||
          y + h > viewportBottom.value - 80
        ) {
          scroll.current?.scrollTo({
            y: Math.max(0, index * stride),
            animated: false,
          });
        }
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (pending.current === id) {
              pending.current = null;
              select(id);
            }
          }),
        );
      });
    },
    [w.cards, stride, select, headerHeight],
  );
  useEffect(() => {
    handle.current = { open: handoff };
    return () => {
      handle.current = null;
    };
  }, [handoff]);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
    inset.value = 0;
    pull.value = active.value ? 0 : Math.max(0, -e.contentOffset.y);
    maxScroll.value = Math.max(
      0,
      e.contentSize.height - e.layoutMeasurement.height + e.contentInset.bottom,
    );
  });
  useFrameCallback((frame) => {
    if (!active.value) return;
    const speed = reorderScrollSpeed(
      fingerY.value,
      viewportTop.value + headerHeight,
      viewportBottom.value - 70,
    );
    if (speed) {
      const next = Math.max(
        -inset.value,
        Math.min(
          maxScroll.value,
          scrollY.value +
            (speed * Math.min(32, frame.timeSincePreviousFrame ?? 16)) / 1000,
        ),
      );
      scrollY.value = next;
      scrollTo(scroll, 0, next, false);
    }
    liftY.value = startY.value + scrollY.value - scrollAtLift.value;
    const index = order.value.indexOf(active.value),
      nextIndex = reorderIndex(liftY.value, index, order.value.length, stride);
    if (index !== nextIndex) {
      const next = order.value.filter((x) => x !== active.value);
      next.splice(nextIndex, 0, active.value);
      order.value = next;
    }
  });
  return (
    <View
      ref={viewport}
      style={{ flex: 1 }}
      pointerEvents={hidden || motion.session ? "none" : "auto"}
      accessibilityElementsHidden={hidden || !!motion.session}
      importantForAccessibility={
        hidden || motion.session ? "no-hide-descendants" : "auto"
      }
      onLayout={() => {
        viewport.current?.measureInWindow((_x, y, _w, h) => {
          viewportTop.value = y;
          viewportBottom.value = y + h;
        });
      }}
    >
      <GestureDetector gesture={native}>
        <Animated.ScrollView
          ref={scroll}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={{
            paddingHorizontal: geometry.stackInset,
            // UIKit changes automatic insets beneath a transparent modal.
            // Explicit native-header spacing keeps the source stack stationary.
            paddingTop: headerHeight + 14,
            paddingBottom: 110,
            flexGrow: 1,
          }}
        >
          <Text style={{ color: c.secondary, fontSize: 15, marginBottom: 14 }}>
            {w.cards.length}{" "}
            {w.t(
              w.cards.length && w.cards.every((x) => x.card.isDemo)
                ? "sampleCardsCount"
                : "savedCount",
            )}
          </Text>
          {w.cards.length ? (
            <>
              <View
                style={{ height: (w.cards.length - 1) * stride + cardHeight }}
              >
                {w.cards.map((item) => (
                  <StackCard
                    key={item.card.id}
                    item={item}
                    refs={refs}
                    native={native}
                    order={order}
                    original={original}
                    active={active}
                    liftY={liftY}
                    startY={startY}
                    scrollY={scrollY}
                    scrollAtLift={scrollAtLift}
                    fingerY={fingerY}
                    pull={pull}
                    entrance={entrance}
                    stride={stride}
                    reduceMotion={motion.reduceMotion}
                    selected={motion.session?.card.id === item.card.id}
                    artworkReady={motion.artworkReady}
                    onSelect={select}
                    onPersist={persist}
                    onHeight={(h) => setCardHeight((prev) => Math.max(prev, h))}
                  />
                ))}
              </View>
              {w.cards.some((x) => x.card.isDemo) ? (
                <Text
                  style={{
                    textAlign: "center",
                    color: c.secondary,
                    fontSize: 12,
                    marginTop: 18,
                  }}
                >
                  {w.t(
                    w.cards.every((x) => x.card.isDemo)
                      ? "sampleStackNotice"
                      : "mixedSampleNotice",
                  )}
                </Text>
              ) : null}
            </>
          ) : (
            <View style={{ flex: 1, justifyContent: "center", gap: 18 }}>
              <Text style={{ fontSize: 26, fontWeight: "700", color: c.text }}>
                {w.t("emptyTitle")}
              </Text>
              <Text style={{ fontSize: 17, color: c.secondary }}>
                {w.t("emptyBody")}
              </Text>
              <NativeButton
                label={w.t("scan")}
                icon="qrcode.viewfinder"
                onPress={() => router.push("/add")}
              />
              <NativeButton
                label={w.t("samples")}
                muted
                onPress={() => router.push("/samples")}
              />
            </View>
          )}
        </Animated.ScrollView>
      </GestureDetector>
    </View>
  );
}
type SV<T> = SharedValue<T>;
type StackCardProps = {
  item: SavedCard;
  refs: RefObject<Map<string, ComponentRef<typeof View>>>;
  native: ReturnType<typeof Gesture.Native>;
  order: SV<string[]>;
  original: SV<string[]>;
  active: SV<string>;
  liftY: SV<number>;
  startY: SV<number>;
  scrollY: SV<number>;
  scrollAtLift: SV<number>;
  fingerY: SV<number>;
  pull: SV<number>;
  entrance: SV<number>;
  stride: number;
  reduceMotion: boolean;
  selected: boolean;
  artworkReady: SV<boolean>;
  onSelect: (id: string) => void;
  onPersist: (ids: string[]) => void;
  onHeight: (height: number) => void;
};
function StackCard(p: StackCardProps) {
  const {
    item,
    order,
    original,
    active,
    liftY,
    startY,
    scrollY,
    scrollAtLift,
    fingerY,
    stride,
    reduceMotion,
    onPersist,
    onSelect,
    selected,
    artworkReady,
    entrance,
    pull,
  } = p;
  const w = useWallet(),
    id = item.card.id,
    y = useSharedValue(w.cards.findIndex((x) => x.card.id === id) * stride),
    liftStart = useSharedValue(0),
    elevation = useSharedValue(0);
  const haptic = () => void Haptics.selectionAsync().catch(() => {});
  useAnimatedReaction(
    () => ({
      target:
        active.value === id ? liftY.value : order.value.indexOf(id) * stride,
      drag: active.value === id,
    }),
    (next, previous) => {
      if (next.drag) {
        // The rendered coordinate follows the finger, so drop starts at that
        // exact coordinate instead of jumping back to the card's old slot.
        y.value = next.target;
      } else if (next.target !== previous?.target || previous?.drag) {
        y.value = reduceMotion
          ? next.target
          : withSpring(next.target, reorderSpring);
      }
      if (next.drag !== previous?.drag) {
        elevation.value = reduceMotion
          ? 0
          : withSpring(next.drag ? 1 : 0, liftSpring);
      }
    },
  );
  const pan = Gesture.Pan()
    .activateAfterLongPress(400)
    .blocksExternalGesture(p.native)
    .onStart((e) => {
      original.value = [...order.value];
      cancelAnimation(y);
      scrollAtLift.value = scrollY.value;
      liftStart.value = y.value;
      startY.value = liftStart.value;
      liftY.value = startY.value;
      active.value = id;
      fingerY.value = e.absoluteY;
      runOnJS(haptic)();
    })
    .onUpdate((e) => {
      startY.value = liftStart.value + e.translationY;
      liftY.value = startY.value + scrollY.value - scrollAtLift.value;
      fingerY.value = e.absoluteY;
    })
    .onEnd(() => {
      const ids = [...order.value];
      active.value = "";
      runOnJS(onPersist)(ids);
    })
    .onFinalize((_e, success) => {
      if (!success && active.value === id) {
        order.value = original.value;
        active.value = "";
      }
    });
  const tap = Gesture.Tap().onEnd((_e, success) => {
    if (success && !active.value) runOnJS(onSelect)(id);
  });
  const style = useAnimatedStyle(() => {
    const index = order.value.indexOf(id),
      lifted = active.value === id;
    return {
      // Restore overlap on release, not after the positional spring's tail.
      // Keep the lifted card above neighbors only while the finger holds it.
      zIndex: lifted ? 10000 : index,
      // Keep the source visible until its replacement is actually mounted.
      opacity:
        selected && artworkReady.value ? 0 : reduceMotion ? entrance.value : 1,
      transform: [
        {
          translateY:
            y.value +
            (reduceMotion
              ? 0
              : (1 - entrance.value) * (140 - index * stride * 0.25) +
                // Add separation to every gap while the scroll view is pulled.
                Math.min(220, pull.value * 0.55) * index * 0.5),
        },
        { scale: 1 + elevation.value * 0.035 },
      ],
      shadowOpacity: 0.07 + elevation.value * 0.15,
      shadowRadius: 7 + elevation.value * 11,
    };
  });
  const move = (direction: number) => {
    const ids = w.cards.map((x) => x.card.id),
      from = ids.indexOf(id),
      to = Math.max(0, Math.min(ids.length - 1, from + direction));
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    void p.onPersist(ids);
  };
  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 0,
            right: 0,
            backgroundColor: cardColors(item.card.accent).background,
            borderRadius: 24,
            shadowColor: "#000000",
            shadowOffset: { width: 0, height: 4 },
          },
          style,
        ]}
      >
        <View
          ref={(node) => {
            if (node) p.refs.current.set(id, node);
            else p.refs.current.delete(id);
          }}
          collapsable={false}
          onLayout={(e) => p.onHeight(e.nativeEvent.layout.height)}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`${item.card.displayName}, ${item.card.area}`}
          accessibilityHint={
            w.language === "el"
              ? "Άνοιγμα κάρτας. Παρατεταμένο πάτημα για αλλαγή σειράς."
              : "Open card. Hold to reorder."
          }
          accessibilityActions={[
            { name: "activate", label: w.t("openCard") },
            {
              name: "earlier",
              label:
                w.language === "el" ? "Μετακίνηση νωρίτερα" : "Move earlier",
            },
            {
              name: "later",
              label: w.language === "el" ? "Μετακίνηση αργότερα" : "Move later",
            },
          ]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === "activate") p.onSelect(id);
            else move(e.nativeEvent.actionName === "earlier" ? -1 : 1);
          }}
        >
          <NativeWalletFace card={item.card} />
        </View>
      </Animated.View>
    </GestureDetector>
  );
}
