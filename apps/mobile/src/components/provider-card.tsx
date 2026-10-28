import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { categoryLabels, type ProviderCard } from "@mastoli/core";
import { useWallet } from "../lib/wallet-context";
import { Icon } from "./ui";
import { useHighContrast } from "../lib/accessibility-theme";
export function ProviderTile({
  card,
  onPress,
  favorite = false,
}: {
  card: ProviderCard;
  onPress?: () => void;
  favorite?: boolean;
}) {
  const { language, t } = useWallet();
  const { fontScale } = useWindowDimensions();
  const highContrast = useHighContrast();
  const bg = /^#[0-9a-fA-F]{6}$/.test(card.accent) ? card.accent : "#DFE7F5";
  const hex = bg.slice(1);
  const brightness =
    (parseInt(hex.slice(0, 2), 16) * 299 +
      parseInt(hex.slice(2, 4), 16) * 587 +
      parseInt(hex.slice(4, 6), 16) * 114) /
    1000;
  const ink =
    brightness < 145 ? "#FFFFFF" : highContrast ? "#000000" : "#17303B";
  const contents = (
    <>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 13,
              fontWeight: "600",
              color: ink,
              marginBottom: 8,
            }}
          >
            {card.isDemo
              ? t("sample")
              : categoryLabels[card.category][language]}
          </Text>
          <Text
            style={{
              fontSize: 25,
              fontWeight: "700",
              letterSpacing: -0.6,
              color: ink,
            }}
          >
            {card.displayName}
          </Text>
        </View>
        {fontScale <= 1.25 ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              width: 43,
              height: 43,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: ink,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: "600", color: ink }}>
              {card.initials}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={{ fontSize: 16, color: ink, marginTop: 9 }}>
        {card.tagline || categoryLabels[card.category][language]}
      </Text>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          gap: 8,
          marginTop: 30,
        }}
      >
        <Text style={{ fontSize: 14, color: ink, flex: 1 }}>
          {categoryLabels[card.category][language]} · {card.area}
        </Text>
        {favorite ? (
          <Icon name="star.fill" size={17} color={ink} />
        ) : (
          <Icon name="arrow" size={16} color={ink} />
        )}
      </View>
    </>
  );
  const style = {
    backgroundColor: bg,
    borderRadius: 22,
    padding: 23,
    minHeight: 210,
  };
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.displayName}, ${categoryLabels[card.category][language]}, ${card.area}${card.isDemo ? ", " + t("sample") : ""}`}
      onPress={onPress}
      style={({ pressed }) => [style, { opacity: pressed ? 0.8 : 1 }]}
    >
      {contents}
    </Pressable>
  ) : (
    <View style={style}>{contents}</View>
  );
}
