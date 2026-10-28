import { Platform, Text as RNText, Pressable, View } from "react-native";
import { Host, Button, Image, Text, HStack, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  accessibilityAddTraits,
  background,
  buttonStyle,
  clipShape,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import type { SFSymbol } from "sf-symbols-typescript";
import { useTheme } from "../lib/theme";
import { useWallet } from "../lib/wallet-context";
import { cardColors } from "../lib/card-colors";

/** Native SwiftUI buttons, including their focus, press and accessibility behavior. */
export function NativeButton({
  label,
  icon,
  onPress,
  danger = false,
  muted = false,
  busy = false,
}: {
  label: string;
  icon?: SFSymbol;
  onPress: () => void;
  danger?: boolean;
  muted?: boolean;
  busy?: boolean;
}) {
  const c = useTheme();
  if (Platform.OS !== "ios")
    return (
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onPress}
        style={{ minHeight: 44, justifyContent: "center", padding: 12 }}
      >
        <RNText style={{ color: danger ? c.danger : c.tint }}>{label}</RNText>
      </Pressable>
    );
  return (
    <Host
      matchContents={{ vertical: true }}
      colorScheme={c.dark ? "dark" : "light"}
      seedColor={danger ? c.danger : c.tint}
      style={{ width: "100%", minHeight: 44 }}
    >
      <Button
        label={label}
        systemImage={icon}
        role={danger ? "destructive" : "default"}
        onPress={onPress}
        modifiers={[
          buttonStyle(muted ? "bordered" : "borderedProminent"),
          controlSize("large"),
          frame({ maxWidth: Infinity, minHeight: 44 }),
          disabled(busy),
        ]}
      />
    </Host>
  );
}

export function NativeRow({
  title,
  subtitle,
  icon,
  onPress,
  last = false,
  selected = false,
  chevron = true,
}: {
  title: string;
  subtitle?: string;
  icon?: SFSymbol;
  onPress: () => void;
  last?: boolean;
  selected?: boolean;
  chevron?: boolean;
}) {
  const c = useTheme();
  return (
    <View
      style={{ borderBottomWidth: last ? 0 : 0.5, borderBottomColor: c.line }}
    >
      <Host
        matchContents={{ vertical: true }}
        colorScheme={c.dark ? "dark" : "light"}
        seedColor={c.tint}
        style={{ width: "100%", minHeight: subtitle ? 76 : 50 }}
      >
        <Button
          onPress={onPress}
          modifiers={[
            buttonStyle("plain"),
            accessibilityLabel([title, subtitle].filter(Boolean).join(", ")),
            ...(selected ? [accessibilityAddTraits(["isSelected"])] : []),
          ]}
        >
          <HStack
            spacing={12}
            modifiers={[
              padding({ horizontal: 16, vertical: 14 }),
              frame({
                maxWidth: Infinity,
                minHeight: 48,
                alignment: "leading",
              }),
            ]}
          >
            {icon ? <Image systemName={icon} size={22} color={c.tint} /> : null}
            <VStack
              alignment="leading"
              spacing={4}
              modifiers={[frame({ maxWidth: Infinity, alignment: "leading" })]}
            >
              <Text
                modifiers={[
                  font({
                    textStyle: "body",
                    weight: subtitle ? "semibold" : "regular",
                  }),
                  foregroundStyle(c.text),
                ]}
              >
                {title}
              </Text>
              {subtitle ? (
                <Text
                  modifiers={[
                    font({ textStyle: "subheadline" }),
                    foregroundStyle(c.secondary),
                  ]}
                >
                  {subtitle}
                </Text>
              ) : null}
            </VStack>
            {chevron ? (
              <Image systemName="chevron.right" size={13} color={c.secondary} />
            ) : null}
          </HStack>
        </Button>
      </Host>
    </View>
  );
}

export function FilterTile({
  label,
  icon,
  initials,
  color,
  ink,
  selected,
  onPress,
}: {
  label: string;
  icon?: SFSymbol;
  initials?: string;
  color: string;
  ink?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const c = useTheme();
  const palette = cardColors(color);
  return (
    <View style={{ width: 94, minHeight: 116 }}>
      <Host
        matchContents={{ vertical: true }}
        colorScheme={c.dark ? "dark" : "light"}
        style={{ width: 94 }}
      >
        <Button
          onPress={onPress}
          modifiers={[
            buttonStyle("plain"),
            accessibilityLabel(label),
            ...(selected ? [accessibilityAddTraits(["isSelected"])] : []),
          ]}
        >
          <VStack spacing={8} modifiers={[frame({ width: 94 })]}>
            <HStack
              spacing={0}
              modifiers={[
                frame({ width: 76, height: 76 }),
                background(palette.background),
                clipShape("roundedRectangle", 16),
              ]}
            >
              {icon ? (
                <Image systemName={icon} size={32} color="#FFFFFF" />
              ) : (
                <Text
                  modifiers={[
                    font({ size: 27, weight: "semibold" }),
                    foregroundStyle(ink ?? palette.ink),
                  ]}
                >
                  {initials}
                </Text>
              )}
            </HStack>
            <Text
              modifiers={[
                font({ textStyle: "caption" }),
                foregroundStyle(c.text),
                frame({ width: 94 }),
                frame({ minHeight: 32 }),
              ]}
            >
              {label}
            </Text>
          </VStack>
        </Button>
      </Host>
      {selected ? (
        <View
          pointerEvents="none"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: "absolute",
            top: -3,
            left: 6,
            width: 82,
            height: 82,
            borderWidth: 2,
            borderColor: c.tint,
            borderRadius: 19,
          }}
        >
          <View
            style={{
              position: "absolute",
              right: -4,
              top: -4,
              backgroundColor: c.tint,
              borderRadius: 12,
              padding: 3,
            }}
          >
            <Host matchContents>
              <Image systemName="checkmark" size={12} color="#FFFFFF" />
            </Host>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function FilterToken({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const c = useTheme();
  const { language } = useWallet();
  return (
    <Host
      matchContents
      colorScheme={c.dark ? "dark" : "light"}
      seedColor={c.tint}
    >
      <Button
        label={label}
        systemImage="xmark.circle.fill"
        onPress={onPress}
        modifiers={[
          buttonStyle("bordered"),
          controlSize("regular"),
          accessibilityLabel(
            `${label}, ${language === "el" ? "αφαίρεση φίλτρου" : "remove filter"}`,
          ),
        ]}
      />
    </Host>
  );
}
