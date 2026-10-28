import { useColorScheme } from "react-native";
import { useWallet } from "./wallet-context";
import { useHighContrast } from "./accessibility-theme";
export function useTheme() {
  const { appearance } = useWallet();
  const system = useColorScheme();
  const highContrast = useHighContrast();
  const dark =
    appearance === "dark" || (appearance === "system" && system === "dark");
  return {
    dark,
    highContrast,
    bg: dark ? "#000000" : "#F7F7F5",
    surface: dark ? "#1C1C1E" : "#FFFFFF",
    text: highContrast
      ? dark
        ? "#FFFFFF"
        : "#000000"
      : dark
        ? "#F4F5F6"
        : "#07172D",
    secondary: highContrast
      ? dark
        ? "#FFFFFF"
        : "#303640"
      : dark
        ? "#B6C1CA"
        : "#606773",
    line: highContrast
      ? dark
        ? "#B6C1CA"
        : "#606773"
      : dark
        ? "#39434D"
        : "#E1E5E5",
    tint: highContrast
      ? dark
        ? "#BED7FF"
        : "#003CA6"
      : dark
        ? "#8CB9FF"
        : "#0755DC",
    danger: highContrast
      ? dark
        ? "#FFD2CE"
        : "#8E160F"
      : dark
        ? "#FF9B93"
        : "#B62E26",
    input: dark ? "#29343F" : "#EBECEB",
  };
}
