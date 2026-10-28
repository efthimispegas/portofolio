import { Text, View, useWindowDimensions } from "react-native";
import { SymbolView } from "expo-symbols";
import { categoryLabels, type ProviderCard } from "@mastoli/core";
import { useTheme } from "../lib/theme";
import { useWallet } from "../lib/wallet-context";
import { cardColors } from "../lib/card-colors";
import { walletCardAspectRatio } from "../lib/wallet-geometry";

/** One face is reused at its measured size through stack, flight and details. */
export function NativeWalletFace({
  card,
  fillFrame = false,
}: {
  card: ProviderCard;
  fillFrame?: boolean;
}) {
  const { language } = useWallet(),
    theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const { background: color, ink, darkInk } = cardColors(card.accent);
  return (
    <View
      style={{
        backgroundColor: color,
        borderRadius: 24,
        padding: 20,
        minHeight: 156,
        aspectRatio:
          fillFrame || fontScale > 1.25 ? undefined : walletCardAspectRatio,
        height: fillFrame ? "100%" : undefined,
        justifyContent: "space-between",
        gap: 26,
        borderWidth: theme.highContrast ? 1 : 0,
        borderColor: ink,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text
            style={{
              fontSize: 24,
              fontWeight: "700",
              letterSpacing: -0.5,
              color: ink,
            }}
          >
            {card.displayName}
          </Text>
          <Text style={{ fontSize: 17, color: ink }}>
            {categoryLabels[card.category][language]}
          </Text>
        </View>
        <View
          accessible={false}
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: darkInk
              ? "rgba(0,0,0,0.07)"
              : "rgba(255,255,255,0.16)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{ fontSize: 21, fontWeight: "600", color: ink }}
            maxFontSizeMultiplier={1.25}
          >
            {card.initials}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <SymbolView name="mappin.and.ellipse" tintColor={ink} size={20} />
        <Text style={{ fontSize: 16, color: ink, flex: 1 }}>{card.area}</Text>
      </View>
    </View>
  );
}
