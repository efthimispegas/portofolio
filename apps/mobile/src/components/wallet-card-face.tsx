import type { ComponentRef, Ref } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { categoryLabels, type ProviderCard } from "@mastoli/core";
import { useWallet } from "../lib/wallet-context";
import { useTheme } from "../lib/theme";
import { Icon } from "./ui";

export function WalletCardFace({
  card,
  favorite = false,
  front = true,
  showDemoLabel = false,
  onOpen,
  onFavorite,
  onQr,
  openRef,
}: {
  card: ProviderCard;
  favorite?: boolean;
  front?: boolean;
  showDemoLabel?: boolean;
  openRef?: Ref<ComponentRef<typeof View>>;
  onOpen?: () => void;
  onFavorite?: () => void;
  onQr?: () => void;
}) {
  const { language, t } = useWallet();
  const theme = useTheme();
  const bg = /^#[0-9a-fA-F]{6}$/.test(card.accent) ? card.accent : "#DFE7F5";
  const rgb = [1, 3, 5].map((start) =>
    parseInt(bg.slice(start, start + 2), 16),
  );
  const light = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 145;
  const ink = light ? (theme.highContrast ? "#000000" : "#07172D") : "#FFFFFF";
  const muted = theme.highContrast ? ink : light ? "#495768" : "#E0E7EF";
  const header = (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text
            style={{
              fontSize: 25,
              lineHeight: 31,
              letterSpacing: -0.5,
              fontWeight: "700",
              color: ink,
            }}
          >
            {card.displayName}
          </Text>
          <Text style={{ fontSize: 18, lineHeight: 25, color: muted }}>
            {categoryLabels[card.category][language]}
          </Text>
          {card.isDemo && showDemoLabel ? (
            <Text style={{ fontSize: 12, lineHeight: 18, color: muted }}>
              {t("sample")}
            </Text>
          ) : null}
        </View>
        <View
          accessible={false}
          style={{
            width: 57,
            height: 57,
            borderRadius: 29,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: light
              ? "rgba(17,47,58,0.09)"
              : "rgba(255,255,255,0.16)",
          }}
        >
          <Text
            maxFontSizeMultiplier={1.4}
            style={{ fontSize: 21, fontWeight: "600", color: ink }}
          >
            {card.initials}
          </Text>
        </View>
      </View>
      {front ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 9,
            marginTop: 22,
            marginBottom: 6,
          }}
        >
          <Icon name="location" size={20} color={muted} />
          <Text style={{ flex: 1, fontSize: 17, lineHeight: 24, color: muted }}>
            {card.area}
          </Text>
        </View>
      ) : null}
    </>
  );
  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: 24,
        paddingBottom: front ? 14 : 37,
      }}
    >
      {onOpen ? (
        <Pressable
          ref={openRef}
          accessibilityRole="button"
          accessibilityLabel={`${card.displayName}, ${categoryLabels[card.category][language]}, ${card.area}${card.isDemo ? ", " + t("sample") : ""}`}
          accessibilityHint={t("openCard")}
          onPress={onOpen}
          style={({ pressed }) => ({
            paddingHorizontal: 22,
            paddingTop: 26,
            opacity: pressed ? 0.65 : 1,
          })}
        >
          {header}
        </Pressable>
      ) : (
        <View style={{ paddingHorizontal: 22, paddingTop: 26 }}>{header}</View>
      )}
      {front ? (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 16,
            marginTop: 5,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(favorite ? "unfavorite" : "favorite")}
            accessibilityState={{ selected: favorite }}
            disabled={!onFavorite}
            onPress={onFavorite}
            style={faceStyles.action}
          >
            <Icon
              name={favorite ? "star.fill" : "star"}
              color={ink}
              size={25}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("showQr")}
            disabled={!onQr}
            onPress={onQr}
            style={faceStyles.action}
          >
            <Icon name="qr" color={ink} size={25} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
const faceStyles = StyleSheet.create({
  action: {
    width: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
