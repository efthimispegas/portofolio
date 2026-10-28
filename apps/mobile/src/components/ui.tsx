import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SymbolView } from "expo-symbols";
import { useTheme } from "../lib/theme";

type IconName =
  | "qr"
  | "location"
  | "wallet"
  | "plus"
  | "scan"
  | "gear"
  | "star"
  | "star.fill"
  | "arrow"
  | "phone"
  | "email"
  | "globe"
  | "share"
  | "trash"
  | "check"
  | "lock"
  | "refresh"
  | "search"
  | "close";
const symbols: Record<IconName, string> = {
  qr: "qrcode",
  location: "mappin.and.ellipse",
  wallet: "wallet.bifold",
  plus: "plus",
  scan: "qrcode.viewfinder",
  gear: "gearshape",
  star: "star",
  "star.fill": "star.fill",
  arrow: "chevron.right",
  phone: "phone",
  email: "envelope",
  globe: "globe",
  share: "square.and.arrow.up",
  trash: "trash",
  check: "checkmark",
  lock: "lock",
  refresh: "arrow.clockwise",
  search: "magnifyingglass",
  close: "xmark",
};
const fallback: Record<
  IconName,
  React.ComponentProps<typeof Ionicons>["name"]
> = {
  qr: "qr-code-outline",
  location: "location-outline",
  wallet: "wallet-outline",
  plus: "add",
  scan: "scan-outline",
  gear: "settings-outline",
  star: "star-outline",
  "star.fill": "star",
  arrow: "chevron-forward",
  phone: "call-outline",
  email: "mail-outline",
  globe: "globe-outline",
  share: "share-outline",
  trash: "trash-outline",
  check: "checkmark",
  lock: "lock-closed-outline",
  refresh: "refresh",
  search: "search",
  close: "close",
};
export function Icon({
  name,
  size = 22,
  color,
}: {
  name: IconName;
  size?: number;
  color: string;
}) {
  return Platform.OS === "ios" ? (
    <SymbolView
      name={symbols[name] as never}
      tintColor={color}
      style={{ width: size, height: size }}
    />
  ) : (
    <Ionicons name={fallback[name]} color={color} size={size} />
  );
}
export function Button({
  title,
  onPress,
  icon,
  secondary = false,
  danger = false,
  busy = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  icon?: IconName;
  secondary?: boolean;
  danger?: boolean;
  busy?: boolean;
  disabled?: boolean;
}) {
  const c = useTheme();
  const color = danger
    ? c.danger
    : secondary
      ? c.tint
      : c.dark
        ? "#112C3B"
        : "#FFF";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: secondary || danger ? c.surface : c.tint,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : icon ? (
        <Icon name={icon} color={color} />
      ) : null}
      <Text style={[styles.buttonText, { color }]}>{title}</Text>
    </Pressable>
  );
}
export function IconButton({
  label,
  name,
  onPress,
}: {
  label: string;
  name: IconName;
  onPress: () => void;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.iconButton}
    >
      <Icon name={name} color={c.tint} />
    </Pressable>
  );
}
export function Section({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: 10, marginTop: 26 }}>
      {title ? (
        <Text
          accessibilityRole="header"
          style={{ fontSize: 19, fontWeight: "600", color: c.text }}
        >
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}
export function Copy({
  children,
  muted = false,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  const c = useTheme();
  return (
    <Text
      style={{
        fontSize: 16,
        lineHeight: 24,
        color: muted ? c.secondary : c.text,
      }}
    >
      {children}
    </Text>
  );
}
export const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  buttonText: {
    fontSize: 17,
    fontWeight: "600",
    flexShrink: 1,
    textAlign: "center",
  },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { padding: 22, paddingBottom: 40, gap: 14 },
  heading: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "700",
    letterSpacing: -1,
  },
  input: {
    fontSize: 17,
    minHeight: 50,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
