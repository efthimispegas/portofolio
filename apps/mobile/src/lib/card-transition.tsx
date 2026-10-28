import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  AppState,
  Easing,
  findNodeHandle,
  Keyboard,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ProviderCard } from "@mastoli/core";
import { CardDetailContent } from "../components/card-detail-content";
import { WalletCardFace } from "../components/wallet-card-face";
import { PublicQr } from "../components/public-qr";
import { Button, Icon } from "../components/ui";
import { useWallet } from "./wallet-context";
import { useTheme } from "./theme";
import { cardUrl } from "./config";
import {
  reverseDuration,
  canReverseCard,
  spatialCardMotion,
  validCardFrame,
  type CardFrame,
} from "./card-motion";

type Source = {
  card: ProviderCard;
  frame: CardFrame;
  showDemoLabel: boolean;
  restoreFocus: () => void;
};
type Session = Source & { spatial: boolean };
type ContextValue = {
  selectedId: string | null;
  spatial: boolean;
  progress: Animated.Value;
  open: (source: Source) => void;
};
const Context = createContext<ContextValue | null>(null);
export function useCardTransition() {
  const value = useContext(Context);
  if (!value) throw new Error("CardTransitionProvider missing");
  return value;
}

export function CardTransitionProvider({ children }: { children: ReactNode }) {
  const { cards, favorite, t } = useWallet();
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [phase, setPhase] = useState<"entering" | "open" | "closing">(
    "entering",
  );
  const [shown, setShown] = useState(false);
  const [target, setTarget] = useState<CardFrame | null>(null);
  const [qr, setQr] = useState(false);
  const [fadingExit, setFadingExit] = useState(false);
  const closeMeasurementTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [reduceMotion, setReduceMotion] = useState(true);
  const progress = useRef(new Animated.Value(0)).current;
  const run = useRef(0);
  const started = useRef(false);
  const closing = useRef(false);
  const hero = useRef<ComponentRef<typeof View>>(null);
  const closeControl = useRef<ComponentRef<typeof View>>(null);
  const selected = cards.find((entry) => entry.card.id === session?.card.id);
  const card = selected?.card ?? session?.card;
  const finish = useCallback(() => {
    const source = sessionRef.current;
    run.current++;
    progress.stopAnimation();
    if (closeMeasurementTimer.current)
      clearTimeout(closeMeasurementTimer.current);
    progress.setValue(0);
    sessionRef.current = null;
    setSession(null);
    setShown(false);
    setTarget(null);
    setQr(false);
    setFadingExit(false);
    started.current = false;
    closing.current = false;
    const finishedRun = run.current;
    if (source)
      setTimeout(() => {
        if (!sessionRef.current && run.current === finishedRun)
          source.restoreFocus();
      }, 100);
  }, [progress]);
  const settle = useCallback(
    (crossfade: boolean) => {
      if (!sessionRef.current || closing.current) return;
      run.current++;
      progress.stopAnimation();
      progress.setValue(1);
      started.current = true;
      setPhase("open");
      if (crossfade) {
        const next = { ...sessionRef.current, spatial: false };
        sessionRef.current = next;
        setSession(next);
      }
    },
    [progress],
  );
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduceMotion(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value) => {
        setReduceMotion(value);
        if (sessionRef.current) settle(true);
      },
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, [settle]);
  useEffect(() => {
    const link = Linking.addEventListener("url", () => {
      if (sessionRef.current) finish();
    });
    return () => link.remove();
  }, [finish]);
  useEffect(() => {
    if (sessionRef.current) finish();
  }, [pathname, finish]);
  useEffect(() => {
    if (sessionRef.current) settle(true);
  }, [width, fontScale, settle]);
  useEffect(
    () => () => {
      run.current++;
      progress.stopAnimation();
    },
    [progress],
  );
  const open = useCallback(
    (source: Source) => {
      if (sessionRef.current) return;
      const next = {
        ...source,
        spatial: spatialCardMotion(source.frame, reduceMotion, fontScale),
      };
      Keyboard.dismiss();
      sessionRef.current = next;
      started.current = false;
      closing.current = false;
      progress.setValue(0);
      setPhase("entering");
      setFadingExit(false);
      setTarget(null);
      setShown(false);
      setSession(next);
    },
    [fontScale, progress, reduceMotion],
  );
  const measureTarget = useCallback(() => {
    const currentSession = sessionRef.current;
    hero.current?.measureInWindow((x, y, w, h) => {
      const frame = { x, y, width: w, height: h };
      if (
        currentSession === sessionRef.current &&
        !closing.current &&
        validCardFrame(frame)
      )
        setTarget(frame);
    });
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") settle(false);
      if (state === "active" && sessionRef.current)
        requestAnimationFrame(measureTarget);
    });
    return () => subscription.remove();
  }, [measureTarget, settle]);
  useEffect(() => {
    if (!shown || !session?.spatial || target) return;
    const timeout = setTimeout(() => {
      if (!sessionRef.current || closing.current) return;
      const fallback = { ...sessionRef.current, spatial: false };
      sessionRef.current = fallback;
      setSession(fallback);
    }, 500);
    return () => clearTimeout(timeout);
  }, [shown, session, target]);
  const close = useCallback(() => {
    if (qr) {
      setQr(false);
      return;
    }
    const currentSession = sessionRef.current;
    if (!currentSession || closing.current) return;
    closing.current = true;
    const keyboardVisible = Keyboard.isVisible();
    Keyboard.dismiss();
    const token = ++run.current;
    let resolved = false;
    const beginExit = (spatial: boolean, frame?: CardFrame) => {
      if (
        resolved ||
        token !== run.current ||
        sessionRef.current !== currentSession
      )
        return;
      resolved = true;
      if (closeMeasurementTimer.current)
        clearTimeout(closeMeasurementTimer.current);
      if (frame) setTarget(frame);
      setFadingExit(!spatial);
      setPhase("closing");
      progress.stopAnimation((value) => {
        Animated.timing(progress, {
          toValue: 0,
          duration: reverseDuration(value, spatial),
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: false,
        }).start(({ finished }) => {
          if (finished && run.current === token) finish();
        });
      });
    };
    // Interruption reverses the currently visible flight, never a newly measured position.
    if (phase !== "open") {
      beginExit(currentSession.spatial && !keyboardVisible);
      return;
    }
    if (!currentSession.spatial || keyboardVisible || !hero.current) {
      beginExit(false);
      return;
    }
    closeMeasurementTimer.current = setTimeout(() => beginExit(false), 160);
    hero.current.measureInWindow((x, y, w, h) => {
      const frame = { x, y, width: w, height: h };
      const viewport = {
        x: 0,
        y: insets.top + 48,
        width,
        height: height - insets.top - 48 - insets.bottom,
      };
      const spatial = canReverseCard(frame, viewport, keyboardVisible);
      beginExit(spatial, spatial ? frame : undefined);
    });
  }, [finish, progress, qr, phase, insets.top, insets.bottom, width, height]);
  useEffect(() => {
    if (
      !session ||
      !shown ||
      (session.spatial && !target) ||
      started.current ||
      closing.current
    )
      return;
    started.current = true;
    const token = ++run.current;
    Animated.timing(progress, {
      toValue: 1,
      duration: session.spatial ? 360 : 140,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && run.current === token) setPhase("open");
    });
  }, [session, shown, target, progress]);
  const dismissGesture = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy > 12 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > 60 || gesture.vy > 0.7) close();
        },
      }),
    [close],
  );
  const value = useMemo(
    () => ({
      selectedId: shown && session?.spatial ? session.card.id : null,
      spatial: Boolean(session?.spatial),
      progress,
      open,
    }),
    [shown, session, progress, open],
  );
  const detailsOpacity = session?.spatial
    ? progress.interpolate({
        inputRange: [0, 0.55, 1],
        outputRange: [0, 0, 1],
        extrapolate: "clamp",
      })
    : progress;
  const source = session?.frame;
  const share = () =>
    card &&
    void Share.share({
      message: `${card.displayName}\n${cardUrl(card.slug)}`,
    }).catch(() => Alert.alert(t("error"), t("actionUnavailable")));
  return (
    <Context.Provider value={value}>
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={Boolean(session)}
        importantForAccessibility={session ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      <Modal
        visible={Boolean(session)}
        transparent
        animationType="none"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={close}
        onShow={() => {
          setShown(true);
          requestAnimationFrame(measureTarget);
          setTimeout(() => {
            if (!sessionRef.current) return;
            const tag = findNodeHandle(closeControl.current);
            if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
          }, 80);
        }}
      >
        {session && card ? (
          <View style={{ flex: 1 }} accessibilityViewIsModal>
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: c.bg, opacity: progress },
              ]}
            />
            <View
              style={{
                flex: 1,
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
              }}
            >
              <Animated.View
                {...dismissGesture.panHandlers}
                style={{
                  opacity: detailsOpacity,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  minHeight: 48,
                  paddingHorizontal: 16,
                }}
              >
                <Pressable
                  ref={closeControl}
                  accessibilityRole="button"
                  accessibilityLabel={t("close")}
                  onPress={close}
                  style={{
                    minWidth: 44,
                    minHeight: 44,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name="close" color={c.tint} size={22} />
                </Pressable>
                <Animated.Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.4}
                  adjustsFontSizeToFit
                  minimumFontScale={0.9}
                  dynamicTypeRamp="headline"
                  style={{
                    color: c.text,
                    fontSize: 17,
                    fontWeight: "600",
                    flex: 1,
                    textAlign: "center",
                  }}
                >
                  {t(qr ? "qrTitle" : "wallet")}
                </Animated.Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("share")}
                  onPress={share}
                  style={{
                    minWidth: 44,
                    minHeight: 44,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name="share" color={c.tint} size={22} />
                </Pressable>
              </Animated.View>
              <View style={{ flex: 1 }}>
                <View
                  style={{ flex: 1 }}
                  accessibilityElementsHidden={qr}
                  importantForAccessibility={
                    qr ? "no-hide-descendants" : "auto"
                  }
                >
                  <Animated.View
                    style={{
                      flex: 1,
                      opacity: !session.spatial || fadingExit ? progress : 1,
                    }}
                    pointerEvents={phase === "open" ? "auto" : "none"}
                  >
                    <CardDetailContent
                      slug={card.slug}
                      embedded
                      onRemoved={finish}
                      scrollEnabled={phase === "open"}
                      detailsOpacity={
                        session.spatial && !fadingExit ? detailsOpacity : 1
                      }
                      onShowQr={
                        !session.spatial ? () => setQr(true) : undefined
                      }
                      hero={
                        session.spatial ? (
                          <View
                            ref={hero}
                            collapsable={false}
                            onLayout={measureTarget}
                            style={{
                              opacity: phase === "open" || fadingExit ? 1 : 0,
                            }}
                          >
                            <WalletCardFace
                              card={card}
                              favorite={selected?.favorite}
                              showDemoLabel={session.showDemoLabel}
                              onFavorite={() =>
                                void favorite(
                                  card.id,
                                  !selected?.favorite,
                                ).catch(() =>
                                  Alert.alert(t("error"), t("retry")),
                                )
                              }
                              onQr={() => {
                                Keyboard.dismiss();
                                setQr(true);
                              }}
                            />
                          </View>
                        ) : undefined
                      }
                    />
                  </Animated.View>
                </View>
                {qr ? (
                  <View
                    style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}
                  >
                    <ScrollView
                      contentContainerStyle={{
                        flexGrow: 1,
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 24,
                        gap: 22,
                        backgroundColor: c.bg,
                      }}
                    >
                      <Text
                        style={{
                          color: c.text,
                          fontSize: 24,
                          fontWeight: "700",
                          textAlign: "center",
                        }}
                      >
                        {card.displayName}
                      </Text>
                      <View
                        style={{
                          backgroundColor: "#FFF",
                          padding: 12,
                          borderRadius: 20,
                        }}
                      >
                        <PublicQr
                          url={cardUrl(card.slug)}
                          availableSize={Math.min(width - 80, 300)}
                        />
                      </View>
                      <Text
                        selectable
                        style={{
                          color: c.secondary,
                          fontSize: 15,
                          textAlign: "center",
                        }}
                      >
                        {cardUrl(card.slug)}
                      </Text>
                      {card.isDemo ? (
                        <Text style={{ color: c.secondary, fontSize: 15 }}>
                          {t("demoShare")}
                        </Text>
                      ) : null}
                      <Button
                        title={t("back")}
                        secondary
                        onPress={() => setQr(false)}
                      />
                    </ScrollView>
                  </View>
                ) : null}
              </View>
            </View>
            {session.spatial &&
            !fadingExit &&
            source &&
            phase !== "open" &&
            !qr ? (
              <Animated.View
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{
                  position: "absolute",
                  left: source.x,
                  top: source.y,
                  width: target
                    ? progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [source.width, target.width],
                      })
                    : source.width,
                  height: target
                    ? progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [source.height, target.height],
                      })
                    : source.height,
                  overflow: "hidden",
                  borderRadius: 24,
                  transform: [
                    {
                      translateX: target
                        ? progress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, target.x - source.x],
                          })
                        : 0,
                    },
                    {
                      translateY: target
                        ? progress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, target.y - source.y],
                          })
                        : 0,
                    },
                  ],
                }}
              >
                <WalletCardFace
                  card={card}
                  favorite={selected?.favorite}
                  showDemoLabel={session.showDemoLabel}
                />
              </Animated.View>
            ) : null}
          </View>
        ) : null}
      </Modal>
    </Context.Provider>
  );
}
