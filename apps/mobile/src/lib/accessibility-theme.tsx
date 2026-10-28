import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { AccessibilityInfo, Platform } from "react-native";
const Context = createContext(false);
/** React to the OS Increase Contrast setting, including live changes. */
export function AccessibilityThemeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [highContrast, setHighContrast] = useState(false);
  useEffect(() => {
    let active = true;
    const update = (enabled: boolean) => {
      if (active) setHighContrast(enabled);
    };
    const query =
      Platform.OS === "ios"
        ? AccessibilityInfo.isDarkerSystemColorsEnabled()
        : AccessibilityInfo.isHighTextContrastEnabled();
    void query.then(update).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(
      Platform.OS === "ios"
        ? "darkerSystemColorsChanged"
        : "highTextContrastChanged",
      update,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return <Context.Provider value={highContrast}>{children}</Context.Provider>;
}
export function useHighContrast() {
  return useContext(Context);
}
