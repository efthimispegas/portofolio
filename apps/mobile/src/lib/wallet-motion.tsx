import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AccessibilityInfo, Alert, AppState, Keyboard } from "react-native";
import {
  cancelAnimation,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
  type SharedValue,
} from "react-native-reanimated";
import type { ProviderCard } from "@mastoli/core";
import type { CardFrame } from "./card-motion";
import { useWallet } from "./wallet-context";

export const motionSpring = { damping: 24, stiffness: 260, mass: 1 };
export type WalletSource = {
  card: ProviderCard;
  frame: CardFrame;
  nextCardOffset: number | null;
  measureFrame: (done: (frame: CardFrame | null) => void) => void;
  restoreFocus: () => void;
};
type Motion = {
  session: WalletSource | null;
  phase: "entering" | "open" | "closing";
  progress: SharedValue<number>;
  sourceFrame: SharedValue<CardFrame>;
  artworkReady: SharedValue<boolean>;
  drag: SharedValue<number>;
  reduceMotion: boolean;
  preferencesReady: boolean;
  open: (source: WalletSource) => void;
  settled: () => void;
  close: (finishAnimation?: boolean) => void;
  complete: () => void;
};
const Context = createContext<Motion | null>(null);
export function WalletMotionProvider({ children }: { children: ReactNode }) {
  const w = useWallet();
  const wallet = useRef(w);
  wallet.current = w;
  const [session, setSession] = useState<WalletSource | null>(null);
  const sessionRef = useRef<WalletSource | null>(null);
  const [phase, setPhase] = useState<Motion["phase"]>("entering");
  const wasSettled = useRef(false);
  const progress = useSharedValue(0),
    sourceFrame = useSharedValue<CardFrame>({ x: 0, y: 0, width: 0, height: 0 }),
    artworkReady = useSharedValue(false),
    drag = useSharedValue(0);
  const [reduceMotion, setReduceMotion] = useState(true);
  const [preferencesReady, setPreferencesReady] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (live) setReduceMotion(v);
      })
      .catch(() => {})
      .finally(() => {
        if (live) setPreferencesReady(true);
      });
    const s = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      live = false;
      s.remove();
    };
  }, []);
  const complete = useCallback(() => {
    const old = sessionRef.current;
    sessionRef.current = null;
    cancelAnimation(progress);
    cancelAnimation(drag);
    progress.value = 0;
    drag.value = 0;
    artworkReady.value = false;
    setSession(null);
    if (old) {
      requestAnimationFrame(() => requestAnimationFrame(old.restoreFocus));
    }
  }, []);
  const settled = useCallback(() => {
    if (!sessionRef.current) return;
    if (!wasSettled.current) {
      const { markOpened, t } = wallet.current;
      void markOpened(sessionRef.current.card.id).catch(() =>
        Alert.alert(t("error"), t("retry")),
      );
    }
    wasSettled.current = true;
    setPhase("open");
  }, []);
  const open = useCallback((source: WalletSource) => {
    if (sessionRef.current) return;
    Keyboard.dismiss();
    sessionRef.current = source;
    wasSettled.current = false;
    progress.value = 0;
    drag.value = 0;
    sourceFrame.value = source.frame;
    artworkReady.value = false;
    setPhase("entering");
    setSession(source);
  }, []);
  const close = useCallback(
    (finishAnimation = true) => {
      if (!sessionRef.current) return;
      Keyboard.dismiss();
      cancelAnimation(progress);
      if (!finishAnimation) {
        complete();
        return;
      }
      const source = sessionRef.current;
      // Search/header dismissal can change the stack's screen coordinates.
      // Return to the mounted card's current frame, never a search-era snapshot.
      source.measureFrame((frame) => {
        if (sessionRef.current !== source) return;
        if (frame) sourceFrame.value = frame;
        setPhase("closing");
        progress.value = reduceMotion
          ? withTiming(0, { duration: 120 }, (finished) => {
              if (finished) {
                artworkReady.value = false;
                runOnJS(complete)();
              }
            })
          : withSpring(0, motionSpring, (finished) => {
              if (finished) {
                // Both faces observe this on the same UI frame. React cleanup
                // can follow without briefly displaying two different faces.
                artworkReady.value = false;
                runOnJS(complete)();
              }
            });
      });
    },
    [reduceMotion, complete],
  );
  useEffect(() => {
    const s = AppState.addEventListener("change", (state) => {
      if (state === "active" || !sessionRef.current) return;
      cancelAnimation(progress);
      cancelAnimation(drag);
      drag.value = 0;
      if (wasSettled.current) {
        progress.value = 1;
        setPhase("open");
      } else complete();
    });
    return () => s.remove();
  }, [complete]);
  useEffect(() => {
    if (
      sessionRef.current &&
      !w.cards.some((item) => item.card.id === sessionRef.current!.card.id)
    )
      complete();
  }, [w.cards, complete]);
  return (
    <Context.Provider
      value={{
        session,
        phase,
        progress,
        sourceFrame,
        artworkReady,
        drag,
        reduceMotion,
        preferencesReady,
        open,
        settled,
        close,
        complete,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWalletMotion() {
  const value = useContext(Context);
  if (!value) throw Error("WalletMotionProvider missing");
  return value;
}
