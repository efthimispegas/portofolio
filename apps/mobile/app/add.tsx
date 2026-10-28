import { useRef, useState, useEffect } from "react";
import {
  Alert,
  Linking,
  Keyboard,
  ScrollView,
  type ScrollViewInstance,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { useWallet } from "../src/lib/wallet-context";
import { useTheme } from "../src/lib/theme";
import { cardSlugFromInput } from "../src/lib/config";
import { Button, Copy, Icon, Section, styles } from "../src/components/ui";
export default function AddCard() {
  const { t } = useWallet();
  const c = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [cameraFailed, setCameraFailed] = useState(false);
  const [active, setActive] = useState(false);
  const locked = useRef(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const pasteY = useRef(0);
  const inputFocused = useRef(false);
  const revealInput = useCallback(() => {
    if (inputFocused.current)
      scroll.current?.scrollTo({
        y: Math.max(0, pasteY.current - 12),
        animated: true,
      });
  }, []);
  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidShow", revealInput);
    return () => subscription.remove();
  }, [revealInput]);
  useFocusEffect(
    useCallback(() => {
      setActive(true);
      locked.current = false;
      return () => setActive(false);
    }, []),
  );
  const intake = (value: string) => {
    if (locked.current) return;
    locked.current = true;
    const slug = cardSlugFromInput(value);
    if (!slug) {
      setError(t("unsafeLink"));
      return;
    }
    setError("");
    Keyboard.dismiss();
    router.replace({ pathname: "/card/[slug]", params: { slug } });
  };
  return (
    <ScrollView
      ref={scroll}
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      <Text
        accessibilityRole="header"
        style={[styles.heading, { color: c.text }]}
      >
        {t("cameraTitle")}
      </Text>
      <Copy muted>{t("cameraBody")}</Copy>
      {permission?.granted && !cameraFailed ? (
        <View
          style={{
            height: 285,
            borderRadius: 22,
            overflow: "hidden",
            backgroundColor: "#153245",
          }}
        >
          {active ? (
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={error ? undefined : ({ data }) => intake(data)}
              onMountError={() => setCameraFailed(true)}
            />
          ) : null}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 38,
              bottom: 38,
              left: 50,
              right: 50,
              borderWidth: 2,
              borderColor: "#FFF",
              borderRadius: 18,
            }}
          />
        </View>
      ) : (
        <View
          style={{
            borderRadius: 22,
            backgroundColor: c.surface,
            padding: 25,
            gap: 18,
            alignItems: "center",
          }}
        >
          <Icon name="scan" color={c.tint} size={54} />
          <Copy muted>
            {cameraFailed
              ? t("cameraError")
              : permission && !permission.canAskAgain
                ? t("cameraDenied")
                : t("cameraFrame")}
          </Copy>
          {!cameraFailed ? (
            <Button
              title={
                permission && !permission.canAskAgain
                  ? t("openSettings")
                  : t("cameraAllow")
              }
              onPress={() =>
                void (
                  permission && !permission.canAskAgain
                    ? Linking.openSettings()
                    : requestPermission()
                ).catch(() => Alert.alert(t("error"), t("cameraError")))
              }
            />
          ) : null}
        </View>
      )}
      {permission?.granted && !cameraFailed ? (
        <Text style={{ color: c.secondary, textAlign: "center", fontSize: 14 }}>
          {t("cameraFrame")}
        </Text>
      ) : null}
      {error ? (
        <View accessibilityLiveRegion="polite" style={{ gap: 12 }}>
          <Text style={{ fontSize: 16, lineHeight: 23, color: c.danger }}>
            {error}
          </Text>
          <Button
            title={t("scanAgain")}
            secondary
            onPress={() => {
              locked.current = false;
              setError("");
            }}
          />
        </View>
      ) : null}
      <View
        onLayout={({ nativeEvent }) => {
          pasteY.current = nativeEvent.layout.y;
        }}
      >
        <Section title={t("paste")}>
          <TextInput
            accessibilityLabel={t("linkHint")}
            onFocus={() => {
              inputFocused.current = true;
              revealInput();
            }}
            onBlur={() => {
              inputFocused.current = false;
            }}
            keyboardAppearance={c.dark ? "dark" : "light"}
            placeholder="https://…/c/…"
            placeholderTextColor={c.secondary}
            value={link}
            onChangeText={(value) => {
              setLink(value);
              setError("");
              locked.current = false;
            }}
            autoCorrect={false}
            autoCapitalize="none"
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={() => intake(link)}
            style={[styles.input, { backgroundColor: c.input, color: c.text }]}
          />
          <Button
            title={t("openCard")}
            disabled={!link.trim()}
            onPress={() => intake(link)}
          />
        </Section>
      </View>
      <Button title={t("close")} secondary onPress={() => router.back()} />
    </ScrollView>
  );
}
