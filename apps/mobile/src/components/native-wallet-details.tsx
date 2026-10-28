import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type ComponentRef,
} from "react";
import {
  AccessibilityInfo,
  Alert,
  Keyboard,
  Linking,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { BlurView } from "expo-blur";
import { getDefaultHeaderHeight } from "expo-router/react-navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { routeLabels } from "@mastoli/core";
import { useWallet } from "../lib/wallet-context";
import { useTheme } from "../lib/theme";
import { useWalletMotion, motionSpring } from "../lib/wallet-motion";
import { safeContactUrl } from "../lib/config";
import { NativeWalletFace } from "./native-wallet-face";
import { NativeButton, NativeRow } from "./native-controls";
import { walletGeometry } from "../lib/wallet-geometry";

export function NativeWalletDetails() {
  const motion = useWalletMotion();
  if (!motion.session) return null;
  return <DetailsSession key={motion.session.card.id} />;
}
function DetailsSession() {
  const motion = useWalletMotion(),
    w = useWallet(),
    c = useTheme();
  const dimensions = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  // Preserve the approved modal-sized toolbar clearance. Search's animated
  // header height temporarily reaches zero and must not move the card target.
  const headerHeight = getDefaultHeaderHeight(dimensions, true, safeArea.top);
  const { width } = dimensions;
  const geometry = walletGeometry(width);
  const session = motion.session!;
  const saved = w.cards.find((x) => x.card.id === session.card.id);
  const card = saved?.card ?? session.card;
  const hero = useRef<ComponentRef<typeof View>>(null),
    layer = useRef<ComponentRef<typeof View>>(null),
    scroll = useRef<Animated.ScrollView>(null);
  const [note, setNote] = useState(saved?.note ?? "");
  const [reduceTransparency, setReduceTransparency] = useState(true);
  const [ready, setReady] = useState(false);
  const preparing = useRef(false);
  const live = useRef(true);
  const origin = useSharedValue({ x: 0, y: 0 }),
    target = useSharedValue(session.frame),
    scrollY = useSharedValue(0),
    dragStart = useSharedValue(0);
  const {
    progress,
    sourceFrame,
    artworkReady,
    drag,
    reduceMotion,
    settled,
    close,
    phase,
  } = motion;
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((v) => {
      if (live) setReduceTransparency(v);
    });
    const s = AccessibilityInfo.addEventListener(
      "reduceTransparencyChanged",
      setReduceTransparency,
    );
    return () => {
      live = false;
      s.remove();
    };
  }, []);
  const measure = () => {
    if (!live.current) return;
    layer.current?.measureInWindow((x, y) => {
      if (!live.current) return;
      origin.value = { x, y };
      hero.current?.measureInWindow((hx, hy, width, height) => {
        if (!live.current || width <= 0 || height <= 0) return;
        target.value = { x: hx, y: hy, width, height };
        if (!preparing.current) {
          preparing.current = true;
          session.measureFrame((frame) => {
            if (!live.current) return;
            if (frame) sourceFrame.value = frame;
            setReady(true);
          });
        }
      });
    });
  };
  useLayoutEffect(() => {
    live.current = true;
    const frame = requestAnimationFrame(measure);
    return () => {
      live.current = false;
      cancelAnimationFrame(frame);
    };
  }, []);
  useLayoutEffect(() => {
    if (!ready || phase !== "entering") return;
    // Commit the flight layer before hiding the retained source card.
    artworkReady.value = true;
    progress.value = reduceMotion
      ? withTiming(1, { duration: 140 }, (done) => {
          if (done) runOnJS(settled)();
        })
      : withSpring(1, motionSpring, (done) => {
          if (done) runOnJS(settled)();
        });
  }, [ready]);
  const native = Gesture.Native();
  const pan = Gesture.Pan()
    .enabled(phase === "open")
    .activeOffsetY(8)
    .failOffsetY(-8)
    .blocksExternalGesture(native)
    .onStart(() => {
      cancelAnimation(drag);
      dragStart.value = drag.value;
    })
    .onUpdate((e) => {
      drag.value = Math.max(0, dragStart.value + e.translationY);
    })
    .onEnd((e) => {
      if (drag.value > 88 || (drag.value > 20 && e.velocityY > 650)) {
        runOnJS(close)();
      } else drag.value = withSpring(0, motionSpring);
    })
    .onFinalize((_e, success) => {
      if (!success) drag.value = withSpring(0, motionSpring);
    });
  const handleScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const detailScene = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, progress.value)),
  }));
  const content = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(0.65, drag.value / 400),
  }));
  const heroStyle = useAnimatedStyle(() => ({
    opacity: phase === "open" ? 1 : 0,
    zIndex: 1,
    transform: [{ translateY: Math.min(0, scrollY.value) + drag.value }],
  }));
  const flyStyle = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, progress.value));
    const f = sourceFrame.value,
      t = target.value;
    const top = interpolate(
      p, [0, 1], [f.y, t.y - Math.max(0, scrollY.value) + drag.value],
    );
    // Animate layout, not scale: at the stack endpoint the text, padding and
    // corner radius must be identical to the retained source face.
    const height = interpolate(p, [0, 1], [f.height, t.height]);
    const visibleHeight = phase === "closing" && session.nextCardOffset !== null
      ? Math.min(height, Math.max(0, f.y + session.nextCardOffset - top))
      : height;
    return {
      left: interpolate(p, [0, 1], [f.x, t.x]) - origin.value.x,
      top: top - origin.value.y,
      width: interpolate(p, [0, 1], [f.width, t.width]),
      height: visibleHeight,
      overflow: "hidden",
      opacity: !artworkReady.value || phase === "open" ? 0 : reduceMotion ? p : 1,
    };
  });
  const faceFrame = useAnimatedStyle(() => ({
    // Occlusion must crop the full face, never compress its internal layout.
    height: interpolate(
      Math.max(0, Math.min(1, progress.value)),
      [0, 1], [sourceFrame.value.height, target.value.height],
    ),
  }));
  const blurStyle = useAnimatedStyle(() => ({
    // Resolve the material with the return, including the spring's final tail.
    opacity:
      Math.min(1, drag.value / 100) *
      Math.max(0, Math.min(1, progress.value)),
  }));
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch {
      Alert.alert(w.t("error"), w.t("actionUnavailable"));
    }
  };
  const contact = (url: string) =>
    card.isDemo
      ? Alert.alert(w.t("sample"), w.t("demoAction"))
      : void run(() => Linking.openURL(url));
  const group = (title: string, children: ReactNode) => (
    <View style={{ gap: 10, marginTop: 26 }}>
      <Text
        accessibilityRole="header"
        style={{ fontSize: 22, fontWeight: "700", color: c.text }}
      >
        {title}
      </Text>
      <View
        style={{
          borderRadius: 18,
          overflow: "hidden",
          backgroundColor: c.surface,
          borderWidth: 0.5,
          borderColor: c.line,
        }}
      >
        {children}
      </View>
    </View>
  );
  return (
    <View
      ref={layer}
      collapsable={false}
      style={{ position: "absolute", inset: 0 }}
      onAccessibilityEscape={() => motion.close()}
      onLayout={() => requestAnimationFrame(measure)}
    >
      <Animated.View
        needsOffscreenAlphaCompositing
        style={[
          { position: "absolute", inset: 0, backgroundColor: c.bg },
          detailScene,
        ]}
      >
        <GestureDetector gesture={native}>
          <Animated.ScrollView
            ref={scroll}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            contentInsetAdjustmentBehavior="never"
            scrollEnabled={phase === "open"}
            contentContainerStyle={{
              paddingHorizontal: geometry.detailInset,
              paddingTop: headerHeight + 12,
              paddingBottom: 70,
            }}
          >
            <GestureDetector gesture={pan}>
              <Animated.View style={heroStyle}>
                <View
                  ref={hero}
                  collapsable={false}
                  onLayout={() => requestAnimationFrame(measure)}
                >
                  <NativeWalletFace card={card} />
                </View>
              </Animated.View>
            </GestureDetector>
          <Animated.View style={[{ overflow: "hidden" }, content]}>
            {card.isDemo ? (
              <Text style={{ fontSize: 13, color: c.secondary, marginTop: 10 }}>
                {w.t("sample")}
              </Text>
            ) : null}
            {card.description && !card.isDemo ? (
              <Text style={{ fontSize: 17, color: c.text, marginTop: 18 }}>
                {card.description}
              </Text>
            ) : null}
            {card.phone ||
            card.email ||
            safeContactUrl(card.website) ||
            card.links.some((link) => safeContactUrl(link.url))
              ? group(
                  w.t("contact"),
                  <>
                    {card.phone ? (
                      <NativeRow
                        title={w.t("call")}
                        icon="phone"
                        chevron={false}
                        onPress={() =>
                          contact(`tel:${card.phone.replace(/[ ()-]/g, "")}`)
                        }
                      />
                    ) : null}
                    {card.email ? (
                      <NativeRow
                        title={w.t("email")}
                        icon="envelope"
                        chevron={false}
                        onPress={() =>
                          contact(`mailto:${encodeURIComponent(card.email)}`)
                        }
                      />
                    ) : null}
                    {safeContactUrl(card.website) ? (
                      <NativeRow
                        title={w.t("website")}
                        icon="link"
                        chevron={false}
                        onPress={() => contact(safeContactUrl(card.website)!)}
                        last={!card.links.length}
                      />
                    ) : null}
                    {card.links
                      .filter((link) => safeContactUrl(link.url))
                      .map((link, i, links) => (
                        <NativeRow
                          key={link.url}
                          title={link.label}
                          icon="link"
                          chevron={false}
                          last={i === links.length - 1}
                          onPress={() => contact(safeContactUrl(link.url)!)}
                        />
                      ))}
                  </>,
                )
              : null}
            {card.services.length
              ? group(
                  w.t("services"),
                  card.services.map((service, i) => (
                    <Text
                      key={`${i}-${service}`}
                      style={{
                        fontSize: 17,
                        color: c.text,
                        padding: 16,
                        borderBottomWidth:
                          i === card.services.length - 1 ? 0 : 0.5,
                        borderBottomColor: c.line,
                      }}
                    >
                      {service}
                    </Text>
                  )),
                )
              : null}
            {!card.isDemo
              ? group(
                  w.t("scope"),
                  <View style={{ padding: 16, gap: 8 }}>
                    <Text style={{ color: c.text, fontSize: 17 }}>
                      {routeLabels[card.route][w.language]}
                    </Text>
                    <Text style={{ color: c.secondary, fontSize: 15 }}>
                      {card.scope}
                    </Text>
                    {card.verificationLabel ? (
                      <Text style={{ color: c.secondary, fontSize: 15 }}>
                        {card.verificationLabel}
                      </Text>
                    ) : null}
                  </View>,
                )
              : null}
            {group(
              w.t("notes"),
              <TextInput
                value={note}
                onChangeText={setNote}
                accessibilityLabel={w.t("notes")}
                placeholder={w.t("noteHint")}
                placeholderTextColor={c.secondary}
                multiline
                maxLength={4000}
                style={{
                  padding: 16,
                  minHeight: 100,
                  color: c.text,
                  fontSize: 17,
                }}
                onFocus={() =>
                  requestAnimationFrame(() => {
                    scroll.current?.scrollToEnd({ animated: true });
                  })
                }
              />,
            )}
            <Text
              style={{
                fontSize: 13,
                color: c.secondary,
                marginTop: 10,
                marginBottom: 10,
              }}
            >
              {w.t("notesPrivacy")}
            </Text>
            {note !== (saved?.note ?? "") ? (
              <NativeButton
                label={w.t("noteSave")}
                muted
                onPress={() =>
                  void run(async () => {
                    await w.note(card.id, note);
                    Keyboard.dismiss();
                  })
                }
              />
            ) : null}
            {!card.isDemo && saved ? (
              <Text style={{ fontSize: 13, color: c.secondary, marginTop: 18 }}>
                {w.t("updated")}:{" "}
                {new Date(saved.refreshedAt).toLocaleString(
                  w.language === "el" ? "el-GR" : "en-GB",
                )}
              </Text>
            ) : null}
            {!reduceTransparency ? (
              <Animated.View
                pointerEvents="none"
                accessible={false}
                accessibilityElementsHidden
                style={[{ position: "absolute", inset: 0 }, blurStyle]}
              >
                <BlurView
                  tint={c.dark ? "dark" : "light"}
                  intensity={25}
                  style={{ flex: 1 }}
                />
              </Animated.View>
            ) : null}
          </Animated.View>
        </Animated.ScrollView>
      </GestureDetector>
      </Animated.View>
      {ready ? (
        <Animated.View
          pointerEvents="none"
          accessible={false}
          accessibilityElementsHidden
          style={[
            { position: "absolute", transformOrigin: "top left" },
            flyStyle,
          ]}
        >
          <Animated.View style={faceFrame}>
            <NativeWalletFace card={card} fillFrame />
          </Animated.View>
        </Animated.View>
      ) : null}
    </View>
  );
}
